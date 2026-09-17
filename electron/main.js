import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, powerSaveBlocker, Notification, clipboard } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import checkDiskSpace from 'check-disk-space'
import { resolveWithinRoot } from './utils/safePath.js'
import { StreamManager } from './utils/StreamManager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win
let client
let tray
let streamManager = null
let isQuitting = false
let appConfig = {} // Cache config in memory for sync access
let isRestarting = false // Guard against concurrent restarts

// Global process error guards
process.on('uncaughtException', (err) => {
  console.error('[Main Process] Uncaught Exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[Main Process] Unhandled Rejection:', reason)
})

// Config persistence
const CONFIG_PATH = path.join(app.getPath('userData'), 'nexus-config.json')

async function getLastDownloadPath() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(data)
    if (config.downloadPath) return config.downloadPath
  } catch (e) {
    // ignore
  }
  return path.join(os.homedir(), 'Downloads', 'Nexus')
}

async function saveLastDownloadPath(downloadPath) {
  try {
    let config = {}
    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8')
      config = JSON.parse(data)
    } catch { } // ignore

    config.downloadPath = downloadPath
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

// Open trackers injected as client defaults so every torrent — user magnets,
// .torrent files, and search results — discovers more peers without rewriting
// the magnet itself (WebTorrent merges client.tracker.announce automatically).
const OPEN_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://9.rarbg.to:2710/announce',
  'udp://9.rarbg.com:2710/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://retracker.lanta.net:2710/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://opentor.net:6969/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'http://open.tracker.cl:1337/announce'
]

// Extra DHT bootstrap nodes on top of WebTorrent's 3 defaults — more doors
// into the DHT means faster peer discovery, especially for fresh magnets.
const DHT_BOOTSTRAP = [
  'router.bittorrent.com:6881',
  'router.utorrent.com:6881',
  'dht.transmissionbt.com:6881',
  'dht.libtorrent.org:25401',
  'router.bitcomet.com:554'
]

async function initWebTorrent() {
  const { default: WebTorrent } = await import('webtorrent')

  const maxConnections = Number(appConfig.maxConns) || 1000
  const opts = {
    // Max-throughput tuning: maximize concurrent peers + full discovery stack.
    maxConns: maxConnections,
    maxWebConns: 100,
    dht: { bootstrap: DHT_BOOTSTRAP },
    lsd: true,
    utPex: true,
    natUpnp: true,
    natPmp: true,
    tracker: {
      announce: OPEN_TRACKERS,
      getAnnounceOpts: () => ({ numwant: 200 })
    }
  }
  if (appConfig.networkPort) {
    console.log('[WebTorrent] Initializing on port:', appConfig.networkPort)
    opts.port = appConfig.networkPort // Common alias
    opts.torrentPort = appConfig.networkPort
    // Do not force dhtPort to same port to avoid EADDRINUSE on Windows
  }

  client = new WebTorrent(opts)

  client.on('listening', () => {
    const addr = client.address()
    console.log(`[WebTorrent] Client listening on ${addr.address}:${addr.port} (TCP/UDP)`)
  })

  client.on('error', (err) => {
    console.error('WebTorrent Error:', err)
  })

  // Apply saved limits from memory cache (use -1 for unlimited)
  if (appConfig.downloadLimit && appConfig.downloadLimit > 0) {
    client.throttleDownload(appConfig.downloadLimit)
  } else {
    client.throttleDownload(-1)
  }
  if (appConfig.uploadLimit && appConfig.uploadLimit > 0) {
    client.throttleUpload(appConfig.uploadLimit)
  } else {
    client.throttleUpload(-1)
  }
}

// Format bytes to human readable
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]} `
}

// State management
let managedTorrents = [] // { infoHash, magnetURI, path, paused, name }

let isSaving = false
let saveQueued = false
let lastSaveTime = 0
const SAVE_THROTTLE = 2000 // 2 seconds

// Power Save Blocker ID
let powerSaveId = null

// Speed-schedule state: true while the scheduled cap window is applied
let scheduleActive = false

// Re-verify operations in flight (double-click guard)
const pendingReverify = new Set()

// Extract a btih hash from a magnet link, if present
function extractBtih(source) {
  if (typeof source !== 'string') return null
  const m = source.match(/xt=urn:btih:([a-zA-Z0-9]+)/i)
  return m ? m[1].toLowerCase() : null
}

function updatePowerSaveBlocker() {
  const isDownloading = client && client.torrents.some(t => !t.done && t.progress < 1 && !t.paused)
  // Only block power save if downloading AND insomnia mode is enabled
  const shouldBlock = isDownloading && appConfig.insomniaMode

  if (shouldBlock && !powerSaveId) {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension')
    console.log('[PowerSave] Enabled blocker (ID:', powerSaveId, ')')
  } else if (!shouldBlock && powerSaveId) {
    powerSaveBlocker.stop(powerSaveId)
    console.log('[PowerSave] Disabled blocker (ID:', powerSaveId, ')')
    powerSaveId = null
  }
}

async function saveTorrentsState() {
  // If already saving, queue another one
  if (isSaving) {
    saveQueued = true
    return
  }

  // Throttle
  const now = Date.now()
  if (now - lastSaveTime < SAVE_THROTTLE) {
    if (!saveQueued) {
      saveQueued = true
      setTimeout(saveTorrentsState, SAVE_THROTTLE - (now - lastSaveTime))
    }
    return
  }

  isSaving = true
  saveQueued = false
  lastSaveTime = now

  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
    const config = JSON.parse(data || '{}')
    config.torrents = managedTorrents
    // Atomic write to prevent file corruption
    const tmpPath = `${CONFIG_PATH}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2))
    await fs.rename(tmpPath, CONFIG_PATH)
  } catch (e) {
    console.error('Failed to save state:', e)
  } finally {
    isSaving = false
    // If changes happened while saving, trigger another one
    if (saveQueued) {
      saveTorrentsState()
    }
  }
}

async function loadTorrentsState() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
    const config = JSON.parse(data || '{}')
    if (Array.isArray(config.torrents)) {
      managedTorrents = config.torrents.map(t => {
        const totalUploaded = t.totalUploaded || (t.ratio && t.length ? Math.round(t.ratio * t.length) : 0)
        const totalDownloaded = t.totalDownloaded || t.downloaded || (t.done && t.length ? t.length : 0)
        return {
          ...t,
          infoHash: (t.infoHash || '').toLowerCase(),
          deselectedFiles: Array.isArray(t.deselectedFiles) ? t.deselectedFiles : [],
          baseUploaded: totalUploaded,
          baseDownloaded: totalDownloaded,
          totalUploaded: totalUploaded,
          totalDownloaded: totalDownloaded
        }
      })
    }
  } catch (e) { }
}

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
    appConfig = JSON.parse(data || '{}')
  } catch (e) {
    appConfig = {}
  }
}


// Shared add flow used by the add-torrent handler, watch-folder importer, and
// stream promote-to-download. Resolves once metadata is ready.
async function addTorrentBySource(torrentId, downloadDir) {
  if (!client) await initWebTorrent()

  // Robust file handling: If Uint8Array or Buffer, wrap in Buffer. If file path, read it to buffer.
  let torrentSource = torrentId;
  if (torrentId instanceof Uint8Array || Buffer.isBuffer(torrentId)) {
    torrentSource = Buffer.from(torrentId);
  } else if (typeof torrentId === 'string' && (torrentId.endsWith('.torrent') || torrentId.includes(path.sep))) {
    try {
      // Try to read it as a file
      const buffer = await fs.readFile(torrentId);
      console.log('[DEBUG] Read file to buffer, size:', buffer.length);
      torrentSource = buffer;
    } catch (e) {
      // If read fails, assume it might be a magnet or URL, proceed with original string
      console.warn('[WARN] Failed to read torrent file path, using raw string:', e);
    }
  }

  return new Promise((resolve, reject) => {
    // Metadata may never arrive for a dead magnet: stop the promise hanging
    // forever (the Add dialog "Starting..." state).
    const METADATA_TIMEOUT_MS = 120000
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { client.remove(torrentSource, () => { }) } catch { }
      reject(new Error('Timed out waiting for torrent metadata. Check the magnet/peers and retry.'))
    }, METADATA_TIMEOUT_MS)
    try { timer.unref?.() } catch { }
    const safeResolve = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v) }
    const safeReject = (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e) }
    try {
      console.log('[DEBUG] Calling client.add with type:', typeof torrentSource, Buffer.isBuffer(torrentSource) ? 'Buffer' : 'String');

      // Dedup: a magnet for an already-active torrent resolves to the live one
      const preHash = extractBtih(torrentSource)
      if (preHash) {
        const dupe = client.get(preHash)
        if (dupe) {
          const dupeHash = (dupe.infoHash || '').toLowerCase()
          if (!managedTorrents.find(t => (t.infoHash || '').toLowerCase() === dupeHash)) {
            managedTorrents.push({
              infoHash: dupeHash,
              magnetURI: dupe.magnetURI,
              path: downloadDir,
              paused: false,
              name: dupe.name,
              deselectedFiles: [],
              strategy: 'rarest',
              baseUploaded: 0,
              baseDownloaded: 0,
              totalUploaded: 0,
              totalDownloaded: 0,
              ratio: 0
            })
            saveTorrentsState()
          }
          setupTorrentEventListeners(dupe)
          safeResolve({ infoHash: dupeHash, name: dupe.name, magnetURI: dupe.magnetURI })
          return
        }
      }

      // Add to WebTorrent
      client.add(torrentSource, { path: downloadDir }, async (torrent) => {
        try {
          const normHash = (torrent.infoHash || '').toLowerCase();

          // Disk-space pre-check now that the real payload size is known
          const need = torrent.length || 0
          if (need > 0) {
            try {
              const { free } = await checkDiskSpace(downloadDir)
              if (free < need) {
                try { client.remove(torrent, () => { }) } catch { }
                throw new Error(`Not enough disk space: need ${formatBytes(need)}, only ${formatBytes(free)} free on the destination drive.`)
              }
            } catch (e) {
              if (/Not enough disk space/.test(e.message || '')) {
                safeReject(e)
                return
              }
              console.warn('[DiskCheck] Skipped pre-check:', e.message)
            }
          }

          // Add to managed state
          const exists = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === normHash)
          if (!exists) {
            managedTorrents.push({
              infoHash: normHash,
              magnetURI: torrent.magnetURI,
              path: downloadDir,
              paused: false,
              name: torrent.name,
              deselectedFiles: [],
              strategy: 'rarest',
              baseUploaded: 0,
              baseDownloaded: 0,
              totalUploaded: 0,
              totalDownloaded: 0,
              ratio: 0
            })
            saveTorrentsState()
          } else if (exists.strategy) {
            try { torrent.strategy = exists.strategy } catch { }
          }

          setupTorrentEventListeners(torrent)

          safeResolve({
            infoHash: normHash,
            name: torrent.name,
            magnetURI: torrent.magnetURI
          })
        } catch (e) {
          safeReject(e)
        }
      })
    } catch (err) {
      console.error('Failed to add torrent:', err)
      safeReject(err)
    }
  })
}

function notifyUser(title, body, withSound = false) {
  try {
    if (appConfig.enableNotifications === false) return
    new Notification({ title, body, silent: !withSound }).show()
    if (withSound && appConfig.enableSound !== false) shell.beep()
  } catch (e) {
    console.warn('[Notify]', e.message)
  }
}

// Auto-pause seeding torrents once the configured ratio or seed-time goal is met.
// completedAt is stamped on first sight of a finished torrent so enabling a goal
// later starts counting from that moment.
function checkSeedingGoals() {
  if (!client) return
  const ratioLimit = Number(appConfig.seedRatioLimit) || 0
  const timeLimitMin = Number(appConfig.seedTimeLimitMin) || 0
  if (ratioLimit <= 0 && timeLimitMin <= 0) return

  const now = Date.now()
  let changed = false

  client.torrents.forEach(t => {
    const tHash = (t.infoHash || '').toLowerCase()
    const managed = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === tHash)
    if (!managed || managed.paused) return
    if (!t.done && t.progress < 1) return

    if (!managed.completedAt) {
      managed.completedAt = now
      changed = true
      return
    }

    const baseUp = managed.baseUploaded || 0
    const lifetimeUploaded = baseUp + (t.uploaded || 0)
    const targetLength = t.length || managed.length || 0
    const lifetimeDownloaded = targetLength > 0 ? targetLength : (t.downloaded || 0)
    const ratio = lifetimeDownloaded > 0 ? (lifetimeUploaded / lifetimeDownloaded) : 0
    const seededMin = (now - managed.completedAt) / 60000

    const hit = (ratioLimit > 0 && ratio >= ratioLimit) ||
      (timeLimitMin > 0 && seededMin >= timeLimitMin)
    if (!hit) return

    // Mirror pause-torrent accounting, then drop from the swarm
    managed.totalUploaded = lifetimeUploaded
    managed.baseUploaded = lifetimeUploaded
    managed.done = true
    managed.progress = 1
    managed.downloaded = targetLength || managed.downloaded || 0
    managed.totalDownloaded = Math.max(managed.totalDownloaded || 0, targetLength)
    managed.baseDownloaded = managed.totalDownloaded
    managed.ratio = ratio
    managed.length = targetLength
    managed.paused = true
    changed = true

    try { client.remove(tHash, () => { }) } catch { }
    console.log(`[SeedingGoal] Auto-paused ${managed.name} (ratio ${ratio.toFixed(2)}, seeded ${Math.round(seededMin)}m)`)
    notifyUser('Seeding goal reached', `${managed.name || 'Torrent'} paused at ratio ${ratio.toFixed(2)}.`)
  })

  if (changed) saveTorrentsState()
}

function applyConfiguredLimits() {
  if (!client) return
  const dl = Number(appConfig.downloadLimit) || 0
  const ul = Number(appConfig.uploadLimit) || 0
  try {
    client.throttleDownload(dl > 0 ? dl : -1)
    client.throttleUpload(ul > 0 ? ul : -1)
  } catch (e) {
    console.warn('[Scheduler] Failed to apply limits:', e.message)
  }
}

function toMinutes(str) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Math.min(23, parseInt(m[1], 10)) * 60 + Math.min(59, parseInt(m[2], 10))
}

// Flip between scheduled caps and configured limits as the time window opens/closes.
// Supports overnight windows (e.g. 22:00 -> 08:00).
function evaluateSpeedSchedule() {
  const s = appConfig.speedSchedule
  if (!s || !s.enabled) {
    if (scheduleActive) {
      scheduleActive = false
      applyConfiguredLimits()
      console.log('[Scheduler] Schedule disabled, restored configured limits')
    }
    return
  }
  const start = toMinutes(s.start)
  const end = toMinutes(s.end)
  if (start === null || end === null || start === end) return

  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const inWindow = start < end ? (cur >= start && cur < end) : (cur >= start || cur < end)

  if (inWindow && !scheduleActive) {
    scheduleActive = true
    if (!client) return
    const dl = Number(s.dlKB) || 0
    const ul = Number(s.ulKB) || 0
    try {
      client.throttleDownload(dl > 0 ? dl * 1024 : -1)
      client.throttleUpload(ul > 0 ? ul * 1024 : -1)
      console.log('[Scheduler] Capped window active')
    } catch (e) {
      console.warn('[Scheduler]', e.message)
    }
  } else if (!inWindow && scheduleActive) {
    scheduleActive = false
    applyConfiguredLimits()
    console.log('[Scheduler] Window ended, restored configured limits')
  }
}

// Watch-folder auto-add (.torrent drop-in directory)
let watchFolderWatcher = null
const watchFileTimers = new Map()

function stopWatchFolder() {
  try { watchFolderWatcher?.close() } catch { }
  watchFolderWatcher = null
  watchFileTimers.forEach(t => clearTimeout(t))
  watchFileTimers.clear()
}

async function importWatchFile(fullPath, watchFolder) {
  try {
    const st = await fs.stat(fullPath).catch(() => null)
    if (!st || !st.isFile()) return
    // Stable-size check: skip files that are still being written
    await new Promise(r => setTimeout(r, 1200))
    const st2 = await fs.stat(fullPath).catch(() => null)
    if (!st2 || st2.size !== st.size) {
      scheduleWatchFile(fullPath, watchFolder)
      return
    }
    const buffer = await fs.readFile(fullPath)
    const downloadDir = await getLastDownloadPath()
    const result = await addTorrentBySource(buffer, downloadDir)
    console.log(`[WatchFolder] Auto-added ${result.name}`)
    notifyUser('Torrent added', `${result.name || 'Torrent'} was picked up from the watch folder.`)
    // Archive the processed file so it is not re-added on restart
    try {
      const processedDir = path.join(watchFolder, 'processed')
      await fs.mkdir(processedDir, { recursive: true })
      await fs.rename(fullPath, path.join(processedDir, path.basename(fullPath)))
    } catch (e) {
      console.warn('[WatchFolder] Could not archive file:', e.message)
    }
  } catch (e) {
    console.warn('[WatchFolder] Failed to import', fullPath, e.message)
  }
}

function scheduleWatchFile(fullPath, watchFolder) {
  if (!fullPath.toLowerCase().endsWith('.torrent')) return
  if (watchFileTimers.has(fullPath)) return
  const timer = setTimeout(() => {
    watchFileTimers.delete(fullPath)
    importWatchFile(fullPath, watchFolder)
  }, 2000)
  watchFileTimers.set(fullPath, timer)
}

function startWatchFolder() {
  stopWatchFolder()
  const folder = appConfig.watchFolder
  if (!folder || !fsSync.existsSync(folder)) return
  // Import any .torrent files already waiting in the folder
  fs.readdir(folder).then(files => {
    files.filter(f => f.toLowerCase().endsWith('.torrent'))
      .forEach(f => scheduleWatchFile(path.join(folder, f), folder))
  }).catch(() => { })
  try {
    watchFolderWatcher = fsSync.watch(folder, (eventType, filename) => {
      if (!filename) return
      scheduleWatchFile(path.join(folder, filename), folder)
    })
    watchFolderWatcher.on('error', (e) => console.warn('[WatchFolder] Watcher error:', e.message))
    console.log(`[WatchFolder] Watching ${folder}`)
  } catch (e) {
    console.warn('[WatchFolder] Failed to start:', e.message)
  }
}

// Move a finished payload to the "completed" folder ( if configured ), then
// resume seeding from the new location. Guarded so repeat done-events are no-ops.
async function maybeMoveCompleted(torrent) {
  const destRoot = appConfig.moveCompletedTo
  if (!destRoot) return
  const normHash = (torrent.infoHash || '').toLowerCase()
  const managed = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === normHash)
  const currentDir = managed?.path || torrent.path
  if (!currentDir) return
  if (path.resolve(currentDir) === path.resolve(destRoot)) return // already home
  const name = torrent.name || managed?.name
  if (!name) return
  const srcFull = path.join(currentDir, name)
  if (!fsSync.existsSync(srcFull)) return
  let destFull = path.join(destRoot, name)
  if (fsSync.existsSync(destFull)) {
    destFull = path.join(destRoot, `${name} [${normHash.slice(0, 6)}]`)
    if (fsSync.existsSync(destFull)) return // avoid clobbering an existing payload
  }
  // Drop from the swarm while files move
  try {
    await new Promise(res => {
      try { client.remove(normHash, () => res()) } catch { res() }
    })
  } catch { }
  await fs.mkdir(destRoot, { recursive: true })
  await fs.rename(srcFull, destFull)
  if (managed) {
    managed.path = destRoot
    saveTorrentsState()
  }
  console.log(`[MoveComplete] Moved ${name} to ${destRoot}`)
  notifyUser('Download moved', `${name} was moved to the completed folder.`)
  if (client && managed && !managed.paused) {
    try {
      client.add(managed.magnetURI, { path: destRoot, strategy: managed.strategy || 'rarest' }, (t) => {
        setupTorrentEventListeners(t)
      })
    } catch (e) {
      console.warn('[MoveComplete] Re-seed failed:', e.message)
    }
  }
}

function setupIpcHandlers() {
  ipcMain.handle('select-folder', async () => {
    const defaultPath = await getLastDownloadPath()
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select Download Destination',
      defaultPath: defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })

    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })

  ipcMain.handle('add-torrent', async (event, torrentId, destinationPath) => {
    if (!client) await initWebTorrent()

    console.log('[DEBUG] add-torrent called with:', torrentId);
    let downloadDir = destinationPath;

    // If no path provided, fallback to dialog (legacy behavior)
    if (!downloadDir) {
      const defaultPath = await getLastDownloadPath()
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Select Download Destination',
        defaultPath: defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })

      if (canceled || filePaths.length === 0) {
        throw new Error('Selection canceled')
      }
      downloadDir = filePaths[0]
    }

    // Save as new default
    await saveLastDownloadPath(downloadDir)

    return addTorrentBySource(torrentId, downloadDir)
  })

  function openTorrentFolderInternal(infoHash) {
    const targetHash = (infoHash || '').toLowerCase();
    let torrentPath = null;
    let torrentName = null;

    if (client) {
      const active = client.get(targetHash);
      if (active) {
        torrentPath = active.path;
        torrentName = active.name;
      }
    }

    if (!torrentPath) {
      const managed = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash);
      if (managed) {
        torrentPath = managed.path;
        torrentName = managed.name;
      }
    }

    if (torrentPath) {
      const possiblePath = torrentName ? path.join(torrentPath, torrentName) : torrentPath;
      try {
        if (fsSync.existsSync(possiblePath)) {
          shell.showItemInFolder(possiblePath);
        } else {
          shell.openPath(torrentPath);
        }
      } catch {
        shell.openPath(torrentPath);
      }
    }
  }

  function resolveTorrentPath(infoHash, relativePath = '') {
    let torrentPath = null;
    let torrentName = null;

    const hashLower = (infoHash || '').toLowerCase();

    if (client) {
      const active = client.torrents?.find(t => (t.infoHash || '').toLowerCase() === hashLower) || client.get(infoHash);
      if (active) {
        torrentPath = active.path;
        torrentName = active.name;
      }
    }

    if (!torrentPath) {
      const managed = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === hashLower || t.infoHash === infoHash);
      if (managed) {
        torrentPath = managed.path;
        torrentName = managed.name;
      }
    }

    if (!torrentPath) {
      torrentPath = appConfig.downloadPath || path.join(os.homedir(), 'Downloads', 'Nexus');
    }

    // Normalize separators
    const cleanRelative = (relativePath || '').replace(/[/\\]+/g, path.sep).replace(/^[\\/]+/, '');

    // Containment root: renderer-supplied paths must never escape the download dir
    const containedRoot = path.resolve(torrentPath);
    const isContained = (p) => {
      const r = path.resolve(p);
      return r === containedRoot || r.startsWith(containedRoot + path.sep);
    };

    if (!cleanRelative) {
      const candidate = torrentName ? path.join(torrentPath, torrentName) : torrentPath;
      const exists = fsSync.existsSync(candidate);
      let isDirectory = true;
      if (exists) {
        try { isDirectory = fsSync.statSync(candidate).isDirectory(); } catch { }
      }
      return { targetPath: candidate, torrentPath, exists, isDirectory };
    }

    // Test candidate paths in priority order
    const candidates = [
      path.join(torrentPath, cleanRelative),
      torrentName ? path.join(torrentPath, torrentName, cleanRelative) : null,
      torrentName && cleanRelative.toLowerCase().startsWith(torrentName.toLowerCase())
        ? path.join(torrentPath, cleanRelative.slice(torrentName.length).replace(/^[\\/]+/, ''))
        : null
    ].filter(Boolean);

    for (const cand of candidates) {
      if (!isContained(cand)) continue;
      if (fsSync.existsSync(cand)) {
        let isDir = false;
        try { isDir = fsSync.statSync(cand).isDirectory(); } catch { }
        return { targetPath: cand, torrentPath, exists: true, isDirectory: isDir };
      }
    }

    // If none exist yet, choose best target path (clamped inside the download dir)
    let fallback = (torrentName && !cleanRelative.toLowerCase().startsWith(torrentName.toLowerCase()))
      ? path.join(torrentPath, torrentName, cleanRelative)
      : path.join(torrentPath, cleanRelative);
    if (!isContained(fallback)) fallback = torrentPath;

    return { targetPath: fallback, torrentPath, exists: false, isDirectory: false };
  }

  ipcMain.handle('get-torrent-file-path', async (event, { infoHash, filePath }) => {
    const resolved = resolveTorrentPath(infoHash, filePath);
    return resolved ? resolved.targetPath : null;
  })

  ipcMain.handle('open-torrent-folder', async (event, infoHash) => {
    openTorrentFolderInternal(infoHash);
  })

  ipcMain.handle('open-torrent-file', async (event, { infoHash, filePath }) => {
    const resolved = resolveTorrentPath(infoHash, filePath);
    if (!resolved) {
      return { success: false, error: 'Torrent download path not found' };
    }
    const { targetPath, exists, torrentPath } = resolved;
    try {
      if (exists) {
        const openErr = await shell.openPath(targetPath);
        if (openErr) {
          console.warn('Failed to open file with shell.openPath:', openErr);
          shell.showItemInFolder(targetPath);
          return { success: false, error: openErr };
        }
        return { success: true };
      } else {
        // If file not yet on disk, open containing folder instead
        let dir = path.dirname(targetPath);
        while (!fsSync.existsSync(dir) && dir !== torrentPath && path.dirname(dir) !== dir) {
          dir = path.dirname(dir);
        }
        shell.openPath(fsSync.existsSync(dir) ? dir : torrentPath);
        return { success: true, warning: 'File not fully downloaded yet. Opened folder instead.' };
      }
    } catch (e) {
      console.error('Error opening file:', e);
      return { success: false, error: e.message };
    }
  })

  ipcMain.handle('open-torrent-file-folder', async (event, { infoHash, filePath }) => {
    const resolved = resolveTorrentPath(infoHash, filePath);
    if (!resolved) {
      return { success: false, error: 'Torrent download path not found' };
    }
    const { targetPath, torrentPath, exists } = resolved;
    try {
      if (exists) {
        shell.showItemInFolder(targetPath);
      } else {
        let dir = path.dirname(targetPath);
        while (!fsSync.existsSync(dir) && dir !== torrentPath && path.dirname(dir) !== dir) {
          dir = path.dirname(dir);
        }
        if (fsSync.existsSync(dir)) {
          shell.openPath(dir);
        } else {
          shell.openPath(torrentPath);
        }
      }
      return { success: true };
    } catch (e) {
      console.error('Error opening file folder:', e);
      return { success: false, error: e.message };
    }
  })

  ipcMain.handle('show-torrent-file-menu', async (event, { infoHash, filePath, isFolder, isSelected, fileIndex }) => {
    const resolved = resolveTorrentPath(infoHash, filePath);
    if (!resolved) return;
    const { targetPath, torrentPath, exists } = resolved;

    const template = [];

    if (!isFolder) {
      template.push({
        label: exists ? 'Open' : 'Open (Not downloaded yet)',
        enabled: exists,
        click: async () => {
          try {
            if (fsSync.existsSync(targetPath)) {
              await shell.openPath(targetPath);
            }
          } catch (err) {
            console.error('Failed to open file:', err);
          }
        }
      });

      template.push({
        label: 'Open Containing Folder',
        click: () => {
          try {
            if (fsSync.existsSync(targetPath)) {
              shell.showItemInFolder(targetPath);
            } else {
              let dir = path.dirname(targetPath);
              while (!fsSync.existsSync(dir) && dir !== torrentPath && path.dirname(dir) !== dir) {
                dir = path.dirname(dir);
              }
              shell.openPath(fsSync.existsSync(dir) ? dir : torrentPath);
            }
          } catch (err) {
            console.error('Failed to open containing folder:', err);
          }
        }
      });
    } else {
      template.push({
        label: 'Open Folder',
        click: () => {
          try {
            if (fsSync.existsSync(targetPath)) {
              shell.openPath(targetPath);
            } else {
              shell.openPath(torrentPath);
            }
          } catch (err) {
            console.error('Failed to open folder:', err);
          }
        }
      });

      template.push({
        label: 'Show in Explorer',
        click: () => {
          try {
            if (fsSync.existsSync(targetPath)) {
              shell.showItemInFolder(targetPath);
            } else {
              shell.openPath(torrentPath);
            }
          } catch (err) {
            console.error('Failed to show folder in explorer:', err);
          }
        }
      });
    }

    template.push({ type: 'separator' });

    template.push({
      label: isFolder ? 'Copy Folder Path' : 'Copy File Path',
      click: () => {
        try {
          clipboard.writeText(targetPath);
        } catch (err) {
          console.error('Failed to copy path to clipboard:', err);
        }
      }
    });

    if (!isFolder && typeof fileIndex === 'number') {
      template.push({ type: 'separator' });
      template.push({
        label: isSelected !== false ? 'Exclude from Download' : 'Include in Download',
        click: () => {
          applyToggleFileSelection(infoHash, [fileIndex], isSelected === false);
        }
      });
    }

    const winSender = BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: winSender });
  })

  ipcMain.handle('show-torrent-context-menu', async (event, infoHash) => {
    const targetHash = (infoHash || '').toLowerCase();
    const t = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === targetHash);
    const active = client ? client.get(targetHash) : null;
    const isPaused = t ? t.paused : !active;

    const template = [
      {
        label: 'Open Folder',
        click: () => {
          openTorrentFolderInternal(infoHash);
        }
      },
      {
        label: isPaused ? 'Resume Torrent' : 'Pause Torrent',
        click: () => {
          const winSender = BrowserWindow.fromWebContents(event.sender);
          winSender?.webContents.send('context-menu-toggle-pause', infoHash);
        }
      },
      {
        label: 'Copy Magnet Link',
        enabled: !!(t?.magnetURI || active?.magnetURI),
        click: () => {
          const uri = t?.magnetURI || active?.magnetURI;
          if (uri) clipboard.writeText(uri);
        }
      },
      {
        label: 'Force Re-check',
        click: () => {
          const winSender = BrowserWindow.fromWebContents(event.sender);
          winSender?.webContents.send('context-menu-reverify', infoHash);
        }
      },
      { type: 'separator' },
      {
        label: 'Delete Torrent...',
        click: () => {
          const winSender = BrowserWindow.fromWebContents(event.sender);
          winSender?.webContents.send('context-menu-delete-torrent', infoHash);
        }
      }
    ];

    const winSender = BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: winSender });
  })

  ipcMain.handle('get-download-path', async () => {
    return await getLastDownloadPath()
  })

  ipcMain.handle('get-config', async () => {
    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
      const config = JSON.parse(data || '{}')

      // If no port configured (random), return the actual active port
      if (!config.networkPort && client) {
        try {
          const address = client.address()
          if (address && address.port) {
            config.networkPort = address.port
          }
        } catch (e) { }
      }

      return config
    } catch { return {} }
  })

  ipcMain.handle('set-config', async (event, newConfig) => {
    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
      const config = JSON.parse(data || '{}')
      const updated = { ...config, ...newConfig }
      appConfig = updated // Update in-memory cache
      await fs.writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2))

      // Apply side effects
      if (newConfig.maxConns !== undefined) {
        const conns = Math.max(10, Math.min(2000, Number(newConfig.maxConns) || 1000))
        console.log('[Config] Setting max connections:', conns)
        if (client) client.maxConns = conns
        if (streamManager) streamManager.setMaxConns(conns)
      }

      if (client) {
        if (typeof newConfig.downloadLimit === 'number') {
          console.log('[Config] Setting download limit:', newConfig.downloadLimit)
          client.throttleDownload(newConfig.downloadLimit === 0 ? -1 : newConfig.downloadLimit)
        }
        if (typeof newConfig.uploadLimit === 'number') {
          console.log('[Config] Setting upload limit:', newConfig.uploadLimit)
          client.throttleUpload(newConfig.uploadLimit === 0 ? -1 : newConfig.uploadLimit)
        }
      }

      // Restart engine if port changed
      if (newConfig.networkPort !== undefined && newConfig.networkPort !== config.networkPort) {
        if (isRestarting) {
          console.log('[Config] Restart already in progress, skipping duplicate folder...')
          return updated
        }

        console.log('[Config] Port changed, restarting engine...')
        isRestarting = true

        if (client && !client.destroyed) {
          const oldClient = client
          client = null

          oldClient.destroy(() => {
            console.log('[Engine] Old client destroyed')
            setTimeout(async () => {
              await initWebTorrent()
              await restoreSession()
              isRestarting = false
              console.log('[Engine] Restarted on new port')
            }, 1000) // Reduced back to 1s as concurrency was likely the issue
          })
        } else {
          // No active client, start immediately
          await initWebTorrent()
          await restoreSession()
          isRestarting = false
        }
      }

      // Restart the watch-folder watcher when its path changes
      if (newConfig.watchFolder !== undefined && newConfig.watchFolder !== config.watchFolder) {
        setTimeout(() => { try { startWatchFolder() } catch (e) { console.warn('[WatchFolder]', e.message) } }, 500)
      }

      // Apply Start with Windows setting
      if (typeof newConfig.startWithWindows === 'boolean') {
        console.log('[Config] Setting auto-launch:', newConfig.startWithWindows)
        app.setLoginItemSettings({
          openAtLogin: newConfig.startWithWindows,
          openAsHidden: false,
          path: process.execPath,
          args: app.isPackaged ? [] : [path.resolve(__dirname, '..')]
        })
      }

      // Notify renderers
      if (win) {
        win.webContents.send('config-updated', updated)
      }

      // Re-evaluate the speed schedule against the new config
      try { evaluateSpeedSchedule() } catch (e) { console.warn('[Scheduler]', e.message) }

      // Apply LAN-sharing bind for future streams
      try {
        if (streamManager && newConfig.lanSharing !== undefined) {
          streamManager.setLanSharing(!!newConfig.lanSharing)
        }
      } catch (e) { console.warn('[StreamManager]', e.message) }

      return updated
    } catch (e) {
      console.error('Failed to update config:', e)
      throw e
    }
  })

  ipcMain.handle('get-torrents', async () => {
    // Return combined list of active WebTorrent torrents AND paused managed torrents

    // Map active torrents
    const activeMap = new Map()
    if (client) {
      client.torrents.forEach(t => {
        const tHash = (t.infoHash || '').toLowerCase()
        const managed = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === tHash)
        const baseUp = managed?.baseUploaded || 0
        const baseDown = managed?.baseDownloaded || 0
        const lifetimeUploaded = baseUp + (t.uploaded || 0)
        const targetLength = t.length || managed?.length || 0
        const isDone = t.done || (managed && managed.done) || t.progress >= 1
        const lifetimeDownloaded = isDone && targetLength > 0
          ? targetLength
          : Math.max(t.downloaded || 0, baseDown + (t.downloaded || 0))
        const currentRatio = lifetimeDownloaded > 0 ? (lifetimeUploaded / lifetimeDownloaded) : 0

        const deselected = managed?.deselectedFiles || []
        const filesMapped = (t.files || []).map((f, idx) => ({
          name: f.name,
          path: f.path,
          length: f.length,
          downloaded: f.downloaded,
          progress: f.progress,
          selected: !deselected.includes(idx) && !deselected.includes(f.path),
          index: idx
        }))

        activeMap.set(tHash, {
          infoHash: tHash,
          name: t.name,
          progress: isDone ? 1 : t.progress,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          numPeers: t.numPeers,
          timeRemaining: t.timeRemaining,
          downloaded: isDone && targetLength > 0 ? targetLength : t.downloaded,
          length: targetLength,
          ratio: currentRatio,
          uploaded: lifetimeUploaded,
          state: isDone ? 'Seeding' : 'Downloading',
          paused: false,
          strategy: managed?.strategy || 'rarest',
          files: filesMapped
        })
      })
    }

    // Merge with managed state
    return managedTorrents.map(managed => {
      const mHash = (managed.infoHash || '').toLowerCase()
      const active = activeMap.get(mHash)
      if (active) {
        // Update managed name if missing
        if (!managed.name && active.name) {
          managed.name = active.name
          saveTorrentsState()
        }
        return active
      } else {
        const pTotalDown = (managed.done && managed.length) ? managed.length : (managed.totalDownloaded || managed.downloaded || 0)
        const pTotalUp = managed.totalUploaded || 0
        const pRatio = managed.ratio || (pTotalDown > 0 ? (pTotalUp / pTotalDown) : 0)

        // It's paused or error or loading - use persisted values
        return {
          infoHash: mHash,
          name: managed.name || 'Paused Torrent',
          progress: (managed.done || managed.progress >= 1) ? 1 : (managed.progress || 0),
          downloadSpeed: 0,
          uploadSpeed: 0,
          numPeers: 0,
          timeRemaining: 0,
          downloaded: pTotalDown,
          length: managed.length || 0,
          ratio: pRatio,
          uploaded: pTotalUp,
          state: (managed.done || managed.progress >= 1) ? 'Completed' : 'Paused',
          paused: true,
          strategy: managed.strategy || 'rarest',
          done: managed.done || managed.progress >= 1,
          files: (managed.files || []).map((f, idx) => ({
            ...f,
            selected: !(managed.deselectedFiles || []).includes(idx) && !(managed.deselectedFiles || []).includes(f.path),
            index: f.index !== undefined ? f.index : idx
          }))
        }
      }
    })
  })

  ipcMain.handle('remove-torrent', async (event, infoHash, deleteData) => {
    const targetHash = (infoHash || '').toLowerCase()
    // Find the torrent to get details
    let t = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)

    // Fallback to active torrent if not found in managed (edge case)
    if (!t && client) {
      const active = client.get(targetHash)
      if (active) t = { name: active.name, path: active.path }
    }

    if (client) {
      // Await removal so managed-state and disk work cannot race it
      try {
        await new Promise((res) => {
          try { client.remove(targetHash, () => res()) } catch { res() }
        })
      } catch (e) { }
    }

    // Remove from managed state
    managedTorrents = managedTorrents.filter(mt => (mt.infoHash || '').toLowerCase() !== targetHash)
    await saveTorrentsState()

    // Delete files if requested
    if (deleteData && t && t.path && t.name) {
      try {
        // Standard WebTorrent behavior:
        // If multi-file: path/name/
        // If single-file: path/name
        // t.path stored in managed state is the download destination directory.
        // Containment: never delete outside the download directory, even for
        // hostile torrent names.
        const fullPath = resolveWithinRoot(t.path, t.name)
        if (fullPath && path.resolve(fullPath) !== path.resolve(t.path)) {
          await fs.rm(fullPath, { recursive: true, force: true })
        }
      } catch (e) {
        console.error('Failed to delete files:', e)
        // Optional: send error back to renderer or log
      }
    }
  })

  ipcMain.handle('pause-torrent', (event, infoHash) => {
    if (!client) return

    const targetHash = (infoHash || '').toLowerCase()
    // Get active torrent to save state
    const torrent = client.get(targetHash)

    // Update managed state with final progress
    const t = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (t) {
      if (torrent) {
        const sessionUp = torrent.uploaded || 0
        const sessionDown = torrent.downloaded || 0
        t.totalUploaded = (t.baseUploaded || 0) + sessionUp
        t.baseUploaded = t.totalUploaded

        const targetLength = torrent.length || t.length || 0
        t.done = t.done || torrent.done || (typeof torrent.progress === 'number' && torrent.progress >= 1)
        if (t.done) {
          t.progress = 1
          t.downloaded = targetLength || t.downloaded || 0
          t.totalDownloaded = Math.max(t.totalDownloaded || 0, targetLength)
        } else {
          t.progress = Math.max(t.progress || 0, torrent.progress || 0)
          t.downloaded = Math.max(t.downloaded || 0, sessionDown)
          t.totalDownloaded = Math.max(t.totalDownloaded || 0, (t.baseDownloaded || 0) + sessionDown)
        }
        t.baseDownloaded = t.totalDownloaded
        t.length = targetLength
        t.ratio = t.totalDownloaded > 0 ? (t.totalUploaded / t.totalDownloaded) : 0

        console.log(`[DEBUG] Pausing ${t.name}: Progress = ${t.progress}, Ratio = ${t.ratio.toFixed(2)}, Done = ${t.done}`)
      } else {
        console.log(`[DEBUG] Pausing ${t.name} but active torrent not found!`)
      }
      t.paused = true
      saveTorrentsState()
    }

    // Remove from WebTorrent client
    if (torrent) {
      try {
        client.remove(targetHash, (err) => { if (err) console.warn(err) })
      } catch (e) { console.warn('Remove failed:', e) }
    }
  })

  ipcMain.handle('resume-torrent', (event, infoHash) => {
    if (!client) return

    const targetHash = (infoHash || '').toLowerCase()
    const t = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (t) {
      // Dedup: already in the swarm (double-click guard) — just unpause state
      if (client.get(targetHash)) {
        t.paused = false
        saveTorrentsState()
        return
      }
      // Re-anchor base stats so session addition is correct
      t.baseUploaded = t.totalUploaded || t.baseUploaded || 0
      t.baseDownloaded = t.totalDownloaded || t.baseDownloaded || 0

      // Re-add to WebTorrent
      client.add(t.magnetURI, { path: t.path, strategy: t.strategy || 'rarest' }, (torrent) => {
        setupTorrentEventListeners(torrent)
      })
      t.paused = false
      saveTorrentsState()
    }
  })

  function applyToggleFileSelection(infoHash, fileIndexOrIndices, selected) {
    const targetHash = (infoHash || '').toLowerCase()
    const indices = Array.isArray(fileIndexOrIndices) ? fileIndexOrIndices : [fileIndexOrIndices]
    const managed = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (managed) {
      managed.deselectedFiles = managed.deselectedFiles || []
    }
    const active = client ? client.get(targetHash) : null

    for (const idx of indices) {
      if (active && active.files && active.files[idx]) {
        if (selected) {
          active.files[idx].select()
        } else {
          active.files[idx].deselect()
        }
      }
      if (managed) {
        if (selected) {
          managed.deselectedFiles = managed.deselectedFiles.filter(i => i !== idx && i !== active?.files?.[idx]?.path)
        } else {
          if (!managed.deselectedFiles.includes(idx)) {
            managed.deselectedFiles.push(idx)
          }
        }
      }
    }

    if (managed && managed.files) {
      managed.files = managed.files.map((f, i) => {
        const fileIdx = f.index !== undefined ? f.index : i
        if (indices.includes(fileIdx)) {
          return { ...f, selected }
        }
        return f
      })
    }

    saveTorrentsState()
    return true
  }

  ipcMain.handle('toggle-file-selection', async (event, infoHash, fileIndexOrIndices, selected) => {
    return applyToggleFileSelection(infoHash, fileIndexOrIndices, selected)
  })

  ipcMain.handle('set-torrent-strategy', async (event, infoHash, strategy) => {
    const allowed = ['sequential', 'rarest']
    if (!allowed.includes(strategy)) throw new Error('Invalid download strategy')
    const targetHash = (infoHash || '').toLowerCase()
    const managed = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (managed) {
      managed.strategy = strategy
      saveTorrentsState()
    }
    if (client) {
      const active = client.get(targetHash)
      if (active) {
        try { active.strategy = strategy } catch (e) {
          console.warn('[Strategy] Failed to apply:', e.message)
        }
      }
    }
    return { success: true, strategy }
  })

  ipcMain.handle('play-sound', () => {
    shell.beep()
  })

  ipcMain.handle('get-random-port', async () => {
    // Return a random port between 1024 and 65535
    return Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024
  })

  ipcMain.handle('test-notification', () => {
    console.log('[DEBUG] Testing Notification')
    new Notification({
      title: 'Nexus Torrent',
      body: 'This is a test notification from Nexus Torrent!',
      silent: false
    }).show()
  })

  ipcMain.handle('reverify-torrent', (event, infoHash) => {
    if (!client) return

    const targetHash = (infoHash || '').toLowerCase()
    const t = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (t) {
      // Double-invocation guard: a re-check is already running
      if (pendingReverify.has(targetHash)) return
      pendingReverify.add(targetHash)
      console.log(`[Reverify] Force re-checking ${t.name}...`)

      // Remove from active client first (keeping data)
      const active = client.get(targetHash)
      if (active) {
        client.remove(targetHash, () => {
          // Once removed, immediately re-add to force hashing
          // Ensure we set paused=false
          t.paused = false
          client.add(t.magnetURI, { path: t.path, strategy: t.strategy || 'rarest' }, (torrent) => {
            console.log(`[Reverify] Started re-check for ${torrent.name}`)
            setupTorrentEventListeners(torrent)
            pendingReverify.delete(targetHash)
          })
          saveTorrentsState()
        })
      } else {
        // If it was paused, just resume it (WebTorrent verifies on add anyway)
        t.paused = false
        client.add(t.magnetURI, { path: t.path }, (torrent) => {
          console.log(`[Reverify] Started re-check for ${torrent.name}`)
          setupTorrentEventListeners(torrent)
        })
        saveTorrentsState()
      }
    }
  })

  ipcMain.handle('pause-all-torrents', () => {
    managedTorrents.forEach(t => {
      if (!t.paused) {
        const tHash = (t.infoHash || '').toLowerCase()
        const active = client ? client.get(tHash) : null
        if (active) {
          const sessionUp = active.uploaded || 0
          const sessionDown = active.downloaded || 0
          t.totalUploaded = (t.baseUploaded || 0) + sessionUp
          t.baseUploaded = t.totalUploaded
          const targetLength = active.length || t.length || 0
          t.done = t.done || active.done || active.progress >= 1
          t.totalDownloaded = t.done && targetLength > 0 ? targetLength : Math.max(t.totalDownloaded || 0, (t.baseDownloaded || 0) + sessionDown)
          t.baseDownloaded = t.totalDownloaded
          t.ratio = t.totalDownloaded > 0 ? (t.totalUploaded / t.totalDownloaded) : 0
          try { client.remove(tHash, () => { }) } catch { }
        }
        t.paused = true
      }
    })
    saveTorrentsState()
    return true
  })

  ipcMain.handle('resume-all-torrents', () => {
    if (!client) return false
    managedTorrents.forEach(t => {
      if (t.paused) {
        // Dedup: already in the swarm — just flip state, don't re-add
        if (client.get((t.infoHash || '').toLowerCase())) {
          t.paused = false
          return
        }
        t.baseUploaded = t.totalUploaded || t.baseUploaded || 0
        t.baseDownloaded = t.totalDownloaded || t.baseDownloaded || 0
        try {
          client.add(t.magnetURI, { path: t.path, strategy: t.strategy || 'rarest' }, (torrent) => {
            setupTorrentEventListeners(torrent)
          })
        } catch { }
        t.paused = false
      }
    })
    saveTorrentsState()
    return true
  })

  // --- Live Video Streaming Feature Handlers ---
  ipcMain.handle('stream-parse-torrent', async (event, source) => {
    if (!streamManager) streamManager = new StreamManager(
      () => client,
      (infoHash) => managedTorrents.find(t => (t.infoHash || '').toLowerCase() === (infoHash || '').toLowerCase()) || null,
      () => Number(appConfig.maxConns) || 1000
    )
    return await streamManager.parseTorrent(source)
  })

  ipcMain.handle('stream-start', async (event, { infoHash, fileIndex }) => {
    if (!streamManager) streamManager = new StreamManager(
      () => client,
      (hash) => managedTorrents.find(t => (t.infoHash || '').toLowerCase() === (hash || '').toLowerCase()) || null,
      () => Number(appConfig.maxConns) || 1000
    )
    return await streamManager.startStreaming(infoHash, fileIndex)
  })

  ipcMain.handle('stream-stop', async () => {
    if (streamManager) {
      return await streamManager.stopStreaming()
    }
    return { success: true }
  })

  ipcMain.handle('stream-get-status', () => {
    if (streamManager) {
      return streamManager.getStatus()
    }
    return { active: false }
  })

  ipcMain.handle('stream-open-external', async (event, url) => {
    // Allowlist http(s) only: the renderer must not be able to launch
    // arbitrary protocols (file:, magnet:, ms-*, ...) on this PC.
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return { success: true }
    }
    console.warn('[Security] Blocked open-external for non-http URL')
    return { success: false }
  })

  ipcMain.handle('stream-promote-to-download', async (event, { destinationPath }) => {
    if (!streamManager) throw new Error('Stream manager not initialized')
    const info = await streamManager.promoteToDownload(destinationPath)
    if (!client) await initWebTorrent()

    // Dedup: already downloading/seeding — nothing to do
    const existingHash = (info.infoHash || '').toLowerCase()
    if (existingHash && client.get(existingHash)) {
      return { success: true, infoHash: existingHash }
    }

    return new Promise((resolve, _reject) => {
      client.add(info.magnetURI, { path: destinationPath, strategy: 'rarest' }, (torrent) => {
        const normHash = (torrent.infoHash || '').toLowerCase()
        const exists = managedTorrents.find(t => (t.infoHash || '').toLowerCase() === normHash)
        if (!exists) {
          managedTorrents.push({
            infoHash: normHash,
            magnetURI: torrent.magnetURI,
            path: destinationPath,
            paused: false,
            name: torrent.name,
            deselectedFiles: [],
            strategy: 'rarest',
            baseUploaded: 0,
            baseDownloaded: 0,
            totalUploaded: 0,
            totalDownloaded: 0,
            ratio: 0
          })
          saveTorrentsState()
        }
        setupTorrentEventListeners(torrent)
        resolve({ success: true, infoHash: normHash })
      })
    })
  })

  // --- Built-in Torrent Search (public sources, rendered in SearchView) ---
  const PUBLIC_TRACKERS = OPEN_TRACKERS

  function buildSearchMagnet(infoHash, name) {
    const tr = PUBLIC_TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('')
    return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name || infoHash)}${tr}`
  }

  function parseSizeToBytes(str) {
    const m = String(str || '').trim().match(/^([\d.]+)\s*([KMGT]i?B|B)$/i)
    if (!m) return 0
    const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
    const unit = m[2].toUpperCase().replace('IB', 'B')
    return Math.round(parseFloat(m[1]) * (units[unit] || 0))
  }

  async function fetchJson(url, timeoutMs = 15000) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'NexusTorrent/1.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  ipcMain.handle('search-torrents', async (event, { query, provider }) => {
    const q = String(query || '').trim()
    if (q.length < 2) throw new Error('Enter at least 2 characters to search')
    const prov = provider === 'yts' ? 'yts' : 'apibay'

    try {
      if (prov === 'yts') {
        const data = await fetchJson(`https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(q)}&limit=20&sort_by=like_count&order_by=desc`)
        const movies = data?.data?.movies || []
        const out = []
        movies.forEach(m => {
          (m.torrents || []).forEach(t => {
            if (!t.hash) return
            const name = `${m.title_english || m.title} (${m.year}) [${t.quality}]`
            out.push({
              provider: 'yts',
              name,
              size: parseSizeToBytes(t.size),
              sizeStr: t.size || '',
              seeders: t.seeds || 0,
              leechers: t.peers || 0,
              infoHash: String(t.hash).toLowerCase(),
              magnet: buildSearchMagnet(t.hash, name)
            })
          })
        })
        return out
      }

      const data = await fetchJson(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`)
      if (!Array.isArray(data)) return []
      return data.slice(0, 50).map(r => {
        const name = r.name || 'Unknown'
        const size = Number(r.size) || 0
        return {
          provider: 'apibay',
          name,
          size,
          sizeStr: formatBytes(size),
          seeders: Number(r.seeders) || 0,
          leechers: Number(r.leechers) || 0,
          infoHash: String(r.info_hash || '').toLowerCase(),
          magnet: buildSearchMagnet(r.info_hash, name)
        }
      })
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Search timed out. Check your connection and retry.')
      throw new Error(`Search failed: ${e.message}`)
    }
  })

  ipcMain.handle('get-lan-ip', async () => {
    try {
      const ifaces = os.networkInterfaces()
      for (const addrs of Object.values(ifaces)) {
        for (const a of addrs || []) {
          if (a.family === 'IPv4' && !a.internal) return a.address
        }
      }
    } catch (e) {
      console.warn('[LanIP]', e.message)
    }
    return null
  })
}

function findIncomingTorrent(args) {
  if (!Array.isArray(args)) return null
  for (const arg of args) {
    if (typeof arg !== 'string') continue
    if (arg.startsWith('magnet:')) {
      return { type: 'magnet', value: arg }
    }
    if (arg.toLowerCase().endsWith('.torrent')) {
      try {
        if (fsSync.existsSync(arg)) {
          return { type: 'file', path: arg, name: path.basename(arg) }
        }
      } catch { }
    }
  }
  return null
}

function createWindow() {
  const bounds = appConfig.windowBounds || {}
  win = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    frame: false, // Frameless for custom UI
    webPreferences: {
      preload: fsSync.existsSync(path.join(__dirname, 'preload.mjs'))
        ? path.join(__dirname, 'preload.mjs')
        : path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Nexus Torrent',
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 32
    }
  })

  if (bounds.isMaximized) {
    win.maximize()
  }

  // Debounced window bounds persistence
  let boundsTimer = null
  const saveBounds = () => {
    if (!win) return
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(async () => {
      if (!win) return
      try {
        const isMaximized = win.isMaximized()
        const currentBounds = isMaximized ? (appConfig.windowBounds || {}) : win.getBounds()
        appConfig.windowBounds = {
          ...currentBounds,
          isMaximized
        }
        const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
        const config = JSON.parse(data || '{}')
        config.windowBounds = appConfig.windowBounds
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
      } catch (e) { }
    }, 500)
  }

  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  win.on('close', (event) => {
    if (isQuitting) return

    // Use cached config - synchronous check required for event.preventDefault()
    if (appConfig.minimizeToTray) {
      event.preventDefault()
      win.hide()
      return
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())

    // Check for magnet link or .torrent file in startup args (Cold start)
    const incoming = findIncomingTorrent(process.argv)
    if (incoming) {
      console.log('[Main] Found incoming torrent at startup:', incoming)
      setTimeout(() => {
        if (incoming.type === 'magnet') {
          win?.webContents.send('open-magnet-link', incoming.value)
        }
        win?.webContents.send('open-incoming-torrent', incoming)
      }, 1000)
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

app.on('before-quit', () => {
  isQuitting = true

  if (powerSaveId) {
    try { powerSaveBlocker.stop(powerSaveId) } catch { }
    powerSaveId = null
  }

  // Snapshot active torrent metrics to managedTorrents
  if (client && client.torrents.length > 0) {
    client.torrents.forEach(t => {
      const normHash = (t.infoHash || '').toLowerCase()
      const managed = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === normHash)
      if (managed) {
        const sessionUp = t.uploaded || 0
        const sessionDown = t.downloaded || 0
        managed.totalUploaded = (managed.baseUploaded || 0) + sessionUp
        const targetLength = t.length || managed.length || 0
        const isDone = t.done || managed.done || t.progress >= 1
        managed.totalDownloaded = isDone && targetLength > 0
          ? targetLength
          : Math.max(managed.totalDownloaded || 0, (managed.baseDownloaded || 0) + sessionDown)
        managed.ratio = managed.totalDownloaded > 0 ? (managed.totalUploaded / managed.totalDownloaded) : 0
        managed.done = isDone
        managed.progress = isDone ? 1 : t.progress
      }
    })
  }

  // Synchronously flush state to disk before exiting
  try {
    const data = fsSync.readFileSync(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(data || '{}')
    config.torrents = managedTorrents
    fsSync.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    console.log('[Shutdown] Torrents state saved synchronously.')
  } catch (e) {
    console.error('[Shutdown] Failed to flush state on quit:', e)
  }

  if (client && !client.destroyed) {
    try {
      client.destroy((err) => {
        if (err) console.error('[Shutdown] WebTorrent client destroy callback error:', err)
      })
    } catch (e) {
      console.warn('[Shutdown] WebTorrent client destroy exception:', e)
    }
  }
  client = null

  if (streamManager) {
    try {
      streamManager.stopStreaming()
      streamManager.cleanTempCache()
    } catch (e) {
      console.warn('[Shutdown] streamManager cleanup exception:', e)
    }
    streamManager = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

async function restoreSession() {
  if (!client || managedTorrents.length === 0) return

  console.log(`[Startup] Restoring ${managedTorrents.length} sessions...`)
  managedTorrents.forEach(t => {
    if (!t.paused) {
      // Re-add active torrents (Downloading or Seeding)
      try {
        console.log(`[Startup] Resuming: ${t.name || t.infoHash} `)
        client.add(t.magnetURI, { path: t.path, strategy: t.strategy || 'rarest' }, (torrent) => {
          console.log(`[Startup] Active: ${torrent.name} `)
          setupTorrentEventListeners(torrent)
        })
      } catch (e) {
        console.error(`[Startup] Failed to resume ${t.infoHash}: `, e)
      }
    }
  })
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Required for Windows Notifications
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nexus.torrent')
}

// Register as default protocol client for magnet links
if (!app.isDefaultProtocolClient('magnet')) {
  // Define arguments for Windows to ensure we get the URL
  app.setAsDefaultProtocolClient('magnet', process.execPath, [path.resolve(process.argv[1] || '.')])
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()

      // Find incoming torrent in second-instance arguments
      const incoming = findIncomingTorrent(commandLine)
      if (incoming) {
        console.log('[Main] Received incoming torrent via second-instance:', incoming)
        if (incoming.type === 'magnet') {
          win.webContents.send('open-magnet-link', incoming.value)
        }
        win.webContents.send('open-incoming-torrent', incoming)
      }
    }
  })
}

app.whenReady().then(async () => {
  try {
    await loadConfig() // Load config first for correct tray/window behavior
    await loadTorrentsState()
  } catch (e) {
    console.error('[Startup] Failed to load config/state:', e)
  }

  setupIpcHandlers()
  createWindow()

  // Clean leftover temp streaming cache from previous sessions
  try {
    if (!streamManager) streamManager = new StreamManager(
      () => client,
      (infoHash) => managedTorrents.find(t => (t.infoHash || '').toLowerCase() === (infoHash || '').toLowerCase()) || null,
      () => Number(appConfig.maxConns) || 1000
    )
    streamManager.cleanTempCache()
  } catch (e) {
    console.warn('[Startup] Failed to clean stream temp cache:', e)
  }

  try {
    await initWebTorrent()
    await restoreSession() // Resume seeding/downloading
  } catch (e) {
    console.error('[Startup] Failed to initialize WebTorrent:', e)
  }

  // Apply the speed schedule ( if configured ) and re-check every 30s
  try { evaluateSpeedSchedule() } catch (e) { console.warn('[Scheduler]', e.message) }
  setInterval(() => {
    try { evaluateSpeedSchedule() } catch (e) { console.warn('[Scheduler]', e.message) }
  }, 30000)

  // Persist progress every 10s instead of on every 1s UI tick (disk-friendly).
  // Pause/remove/quit paths still save immediately.
  setInterval(() => {
    try {
      if (client && client.torrents.length > 0) saveTorrentsState()
    } catch (e) { console.warn('[Save]', e.message) }
  }, 10000)

  // Start the .torrent watch folder ( if configured )
  try { startWatchFolder() } catch (e) { console.warn('[WatchFolder]', e.message) }

  // Apply LAN-sharing bind from saved config (applies to future streams)
  try {
    if (streamManager) streamManager.setLanSharing(!!appConfig.lanSharing)
  } catch (e) { console.warn('[StreamManager]', e.message) }

  // Apply saved Start with Windows setting
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
    const config = JSON.parse(data || '{}')
    if (typeof config.startWithWindows === 'boolean') {
      app.setLoginItemSettings({
        openAtLogin: config.startWithWindows,
        openAsHidden: false,
        path: process.execPath,
        args: app.isPackaged ? [] : [path.resolve(__dirname, '..')]
      })
      console.log('[Startup] Auto-launch configured:', config.startWithWindows)
    }
  } catch (e) {
    console.error('[Startup] Failed to apply auto-launch setting:', e)
  }

  // Initialize Tray
  try {
    const iconPath = path.join(process.env.VITE_PUBLIC, 'tray.png')
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('Nexus Torrent')
    tray.setIgnoreDoubleClickEvents(true)
    tray.on('click', () => {
      if (win) {
        if (win.isVisible()) {
          if (win.isFocused()) win.hide()
          else win.focus()
        } else {
          win.show()
          win.focus()
        }
      }
    })

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Nexus Torrent', click: () => { win?.show(); win?.focus() } },
      { type: 'separator' },
      {
        label: 'Quit', click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(contextMenu)
  } catch (e) {
    console.error('Failed to create tray:', e)
  }

  // Send updates every second
  setInterval(async () => {
    if (win) {
      let totalDownloadSpeed = 0
      let totalUploadSpeed = 0

      // Map active torrents
      const activeMap = new Map()
      if (client) {
        client.torrents.forEach(t => {
          // Calculate connected seeds/peers
          const connectedSeeds = t.wires.filter(w => w.isSeeder).length
          const connectedPeers = t.wires.length - connectedSeeds

          totalDownloadSpeed += t.downloadSpeed
          totalUploadSpeed += t.uploadSpeed

          updatePowerSaveBlocker()



          const tHash = (t.infoHash || '').toLowerCase()
          const managed = managedTorrents.find(m => (m.infoHash || '').toLowerCase() === tHash)
          const baseUp = managed?.baseUploaded || 0
          const baseDown = managed?.baseDownloaded || 0
          const lifetimeUploaded = baseUp + (t.uploaded || 0)
          const targetLength = t.length || managed?.length || 0
          const isDone = t.done || (managed && managed.done) || t.progress >= 1
          const lifetimeDownloaded = isDone && targetLength > 0
            ? targetLength
            : Math.max(t.downloaded || 0, baseDown + (t.downloaded || 0))
          const currentRatio = lifetimeDownloaded > 0 ? (lifetimeUploaded / lifetimeDownloaded) : 0

          const deselected = managed?.deselectedFiles || []
          const filesMapped = (t.files || []).map((f, idx) => ({
            name: f.name,
            path: f.path,
            length: f.length,
            downloaded: f.downloaded,
            progress: f.progress,
            selected: !deselected.includes(idx) && !deselected.includes(f.path),
            index: idx
          }))

          activeMap.set(tHash, {
            infoHash: tHash,
            name: t.name,
            progress: isDone ? 1 : t.progress,
            downloadSpeed: t.downloadSpeed,
            uploadSpeed: t.uploadSpeed,
            numPeers: t.numPeers, // Total connected
            connectedSeeds,
            connectedPeers,
            timeRemaining: t.timeRemaining / 1000, // ms to s
            downloaded: isDone && targetLength > 0 ? targetLength : t.downloaded,
            length: targetLength,
            ratio: currentRatio,
            uploaded: lifetimeUploaded,
            state: isDone ? 'Seeding' : 'Downloading',
            paused: false,
            strategy: managed?.strategy || 'rarest',
            files: filesMapped
          })
        })
      }

      // Update Tray Tooltip if enabled
      if (appConfig.showSpeedInTray && tray) {
        tray.setToolTip(`Nexus Torrent | DL: ${formatBytes(totalDownloadSpeed)}/s | UL: ${formatBytes(totalUploadSpeed)}/s`)
      } else if (tray) {
        tray.setToolTip('Nexus Torrent')
      }

      const uiTorrents = managedTorrents.map(managed => {
        const mHash = (managed.infoHash || '').toLowerCase()
        const active = activeMap.get(mHash)
        if (active) {
          // Sync crucial stats to managed state (persisted on pause)
          managed.progress = active.progress
          managed.downloaded = active.downloaded
          managed.length = active.length
          managed.ratio = active.ratio
          managed.totalUploaded = active.uploaded
          managed.totalDownloaded = active.downloaded
          managed.name = active.name || managed.name
          managed.done = active.state === 'Seeding' || active.progress >= 1
          // Persist files for offline viewing
          managed.files = active.files

          return active
        }

        const pTotalDown = (managed.done && managed.length) ? managed.length : (managed.totalDownloaded || managed.downloaded || 0)
        const pTotalUp = managed.totalUploaded || 0
        const pRatio = managed.ratio || (pTotalDown > 0 ? (pTotalUp / pTotalDown) : 0)

        return {
          infoHash: mHash,
          name: managed.name || 'Paused',
          progress: managed.done ? 1 : (managed.progress || 0),
          downloadSpeed: 0,
          uploadSpeed: 0,
          numPeers: 0,
          timeRemaining: 0,
          downloaded: pTotalDown,
          length: managed.length || 0,
          ratio: pRatio,
          uploaded: pTotalUp,
          state: managed.done ? 'Completed' : 'Paused',
          paused: true,
          strategy: managed.strategy || 'rarest',
          done: managed.done || false,
          files: (managed.files || []).map((f, idx) => ({
            ...f,
            selected: !(managed.deselectedFiles || []).includes(idx) && !(managed.deselectedFiles || []).includes(f.path),
            index: f.index !== undefined ? f.index : idx
          }))
        }
      })

      win.webContents.send('torrents-update', uiTorrents)

      // Enforce seeding goals (auto-pause finished torrents past ratio/time limits)
      try { checkSeedingGoals() } catch (e) { console.warn('[SeedingGoal]', e.message) }
    }
  }, 1000)

  // Initial load
  await loadTorrentsState()

  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }
})

function applyFileSelections(torrent) {
  const normHash = (torrent.infoHash || '').toLowerCase()
  const managed = managedTorrents.find(mt => (mt.infoHash || '').toLowerCase() === normHash)
  if (!managed || !Array.isArray(managed.deselectedFiles) || managed.deselectedFiles.length === 0) return

  const apply = () => {
    if (!torrent.files || torrent.files.length === 0) return
    torrent.files.forEach((file, index) => {
      if (managed.deselectedFiles.includes(index) || managed.deselectedFiles.includes(file.path)) {
        file.deselect()
      }
    })
  }

  if (torrent.files && torrent.files.length > 0) {
    apply()
  } else {
    torrent.once('ready', apply)
  }
}

function setupTorrentEventListeners(torrent) {
  // Prevent unhandled error events from crashing the Electron process
  torrent.on('error', (err) => {
    console.error(`[Torrent Error] ${torrent.name || torrent.infoHash}:`, err)
  })

  // Apply persisted file selections (deselected files)
  applyFileSelections(torrent)

  // Listen for tracker updates
  torrent.on('trackerAnnounce', () => {
    console.log(`[Announce] ${torrent.name} announced to tracker`)
  })

  // Notification on completion
  torrent.on('done', async () => {
    console.log(`[Done] ${torrent.name} finished downloading`)

    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
      const config = JSON.parse(data || '{}')

      if (config.enableNotifications) {
        new Notification({
          title: 'Download Complete',
          body: `${torrent.name} has finished downloading.`,
          silent: !config.enableSound
        }).show()

        if (config.enableSound) {
          shell.beep()
        }
      }
    } catch (e) { console.error('Notification error:', e) }

    // Move finished payload to the completed folder ( if configured )
    try { await maybeMoveCompleted(torrent) } catch (e) { console.warn('[MoveComplete]', e.message) }

    saveTorrentsState()
  })
}
