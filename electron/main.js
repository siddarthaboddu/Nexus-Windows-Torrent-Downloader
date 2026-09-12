import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, powerSaveBlocker, Notification, clipboard } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let win
let client
let tray
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

async function initWebTorrent() {
  const { default: WebTorrent } = await import('webtorrent')

  const opts = {}
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
    // config.downloadPath is handled separately or we can merge it here if needed, 
    // but managedTorrents is the high frequency part.
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
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

// Track swarm stats per torrent
const swarmStats = new Map() // infoHash -> { seeds: 0, peers: 0 }

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

    // Robust file handling: If it looks like a torrent file path, read it to buffer
    let torrentSource = torrentId;
    if (typeof torrentId === 'string' && (torrentId.endsWith('.torrent') || torrentId.includes(path.sep))) {
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
      try {
        console.log('[DEBUG] Calling client.add with type:', typeof torrentSource, Buffer.isBuffer(torrentSource) ? 'Buffer' : 'String');

        // Add to WebTorrent
        client.add(torrentSource, { path: downloadDir }, (torrent) => {
          // Add to managed state
          const exists = managedTorrents.find(t => t.infoHash === torrent.infoHash)
          if (!exists) {
            managedTorrents.push({
              infoHash: torrent.infoHash,
              magnetURI: torrent.magnetURI,
              path: downloadDir,
              paused: false,
              name: torrent.name,
              deselectedFiles: [],
              baseUploaded: 0,
              baseDownloaded: 0,
              totalUploaded: 0,
              totalDownloaded: 0,
              ratio: 0
            })
            saveTorrentsState()
          }

          setupTorrentEventListeners(torrent)

          resolve({
            infoHash: torrent.infoHash,
            name: torrent.name,
            magnetURI: torrent.magnetURI
          })
        })
      } catch (err) {
        console.error('Failed to add torrent:', err)
        reject(err)
      }
    })
  })

  function openTorrentFolderInternal(infoHash) {
    let torrentPath = null;
    let torrentName = null;

    if (client) {
      const active = client.get(infoHash);
      if (active) {
        torrentPath = active.path;
        torrentName = active.name;
      }
    }

    if (!torrentPath) {
      const managed = managedTorrents.find(t => t.infoHash === infoHash);
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
      if (fsSync.existsSync(cand)) {
        let isDir = false;
        try { isDir = fsSync.statSync(cand).isDirectory(); } catch { }
        return { targetPath: cand, torrentPath, exists: true, isDirectory: isDir };
      }
    }

    // If none exist yet, choose best target path
    const fallback = (torrentName && !cleanRelative.toLowerCase().startsWith(torrentName.toLowerCase()))
      ? path.join(torrentPath, torrentName, cleanRelative)
      : path.join(torrentPath, cleanRelative);

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
    const t = managedTorrents.find(m => m.infoHash === infoHash);
    const active = client ? client.get(infoHash) : null;
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
        const managed = managedTorrents.find(m => m.infoHash === t.infoHash)
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

        activeMap.set(t.infoHash, {
          infoHash: t.infoHash,
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
          files: filesMapped
        })
      })
    }

    // Merge with managed state
    return managedTorrents.map(managed => {
      const active = activeMap.get(managed.infoHash)
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
          infoHash: managed.infoHash,
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
    // Find the torrent to get details
    let t = managedTorrents.find(t => t.infoHash === infoHash)

    // Fallback to active torrent if not found in managed (edge case)
    if (!t && client) {
      const active = client.get(infoHash)
      if (active) t = { name: active.name, path: active.path }
    }

    if (client) {
      // Remove from client
      try {
        client.remove(infoHash, (e) => { })
      } catch (e) { }
    }

    // Remove from managed state
    managedTorrents = managedTorrents.filter(mt => mt.infoHash !== infoHash)
    await saveTorrentsState()

    // Delete files if requested
    if (deleteData && t && t.path && t.name) {
      try {
        // Standard WebTorrent behavior:
        // If multi-file: path/name/
        // If single-file: path/name
        // t.path stored in managed state is the download destination directory.

        const fullPath = path.join(t.path, t.name)
        if (path.resolve(fullPath) !== path.resolve(t.path)) {
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

    // Get active torrent to save state
    const torrent = client.get(infoHash)

    // Update managed state with final progress
    const t = managedTorrents.find(t => t.infoHash === infoHash)
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
        client.remove(infoHash, (err) => { if (err) console.warn(err) })
      } catch (e) { console.warn('Remove failed:', e) }
    }
  })

  ipcMain.handle('resume-torrent', (event, infoHash) => {
    if (!client) return

    const t = managedTorrents.find(t => t.infoHash === infoHash)
    if (t) {
      // Re-anchor base stats so session addition is correct
      t.baseUploaded = t.totalUploaded || t.baseUploaded || 0
      t.baseDownloaded = t.totalDownloaded || t.baseDownloaded || 0

      // Re-add to WebTorrent
      client.add(t.magnetURI, { path: t.path }, (torrent) => {
        setupTorrentEventListeners(torrent)
      })
      t.paused = false
      saveTorrentsState()
    }
  })

  function applyToggleFileSelection(infoHash, fileIndexOrIndices, selected) {
    const indices = Array.isArray(fileIndexOrIndices) ? fileIndexOrIndices : [fileIndexOrIndices]
    const managed = managedTorrents.find(t => t.infoHash === infoHash)
    if (managed) {
      managed.deselectedFiles = managed.deselectedFiles || []
    }
    const active = client ? client.get(infoHash) : null

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

    const t = managedTorrents.find(t => t.infoHash === infoHash)
    if (t) {
      console.log(`[Reverify] Force re-checking ${t.name}...`)

      // Remove from active client first (keeping data)
      const active = client.get(infoHash)
      if (active) {
        client.remove(infoHash, (e) => {
          // Once removed, immediately re-add to force hashing
          // Ensure we set paused=false
          t.paused = false
          client.add(t.magnetURI, { path: t.path }, (torrent) => {
            console.log(`[Reverify] Started re-check for ${torrent.name}`)
            setupTorrentEventListeners(torrent)
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
        const active = client ? client.get(t.infoHash) : null
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
          try { client.remove(t.infoHash, () => { }) } catch { }
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
        t.baseUploaded = t.totalUploaded || t.baseUploaded || 0
        t.baseDownloaded = t.totalDownloaded || t.baseDownloaded || 0
        try {
          client.add(t.magnetURI, { path: t.path }, (torrent) => {
            setupTorrentEventListeners(torrent)
          })
        } catch { }
        t.paused = false
      }
    })
    saveTorrentsState()
    return true
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
      const managed = managedTorrents.find(m => m.infoHash === t.infoHash)
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
        client.add(t.magnetURI, { path: t.path }, (torrent) => {
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

  try {
    await initWebTorrent()
    await restoreSession() // Resume seeding/downloading
  } catch (e) {
    console.error('[Startup] Failed to initialize WebTorrent:', e)
  }

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



          const managed = managedTorrents.find(m => m.infoHash === t.infoHash)
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

          activeMap.set(t.infoHash, {
            infoHash: t.infoHash,
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
        const active = activeMap.get(managed.infoHash)
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
          infoHash: managed.infoHash,
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
          done: managed.done || false,
          files: (managed.files || []).map((f, idx) => ({
            ...f,
            selected: !(managed.deselectedFiles || []).includes(idx) && !(managed.deselectedFiles || []).includes(f.path),
            index: f.index !== undefined ? f.index : idx
          }))
        }
      })

      win.webContents.send('torrents-update', uiTorrents)

      // Trigger throttled save only if active torrents exist
      if (client && client.torrents.length > 0) {
        saveTorrentsState()
      }
    }
  }, 1000)

  // Initial load
  await loadTorrentsState()

  if (!app.isPackaged) {
    win.webContents.openDevTools()
  }
})

function applyFileSelections(torrent) {
  const managed = managedTorrents.find(mt => mt.infoHash === torrent.infoHash)
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

    saveTorrentsState()
  })
}
