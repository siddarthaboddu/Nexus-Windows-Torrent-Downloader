import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { app } from 'electron'
import { capRangeLength, parseRangeHeader } from './rangeParser.js'
import { resolveWithinRoot } from './safePath.js'
import { MAX_STREAM_RANGE_BYTES, computeSeekWindow, shouldMoveWindow } from './streamWindow.js'

// Chromium commonly requests `Range: bytes=N-`. Do not hand that unbounded
// range to WebTorrent: its FileIterator then selects N..EOF at stream
// priority, which competes with the new location after a forward seek.
// MAX_STREAM_RANGE_BYTES bounds it; the read-ahead window that follows the
// playhead lives in streamWindow.js.

// Larger read chunks than Node's 64KB default. Each chunk is a syscall plus a
// pipe write on the hot path, so fewer/larger chunks measurably reduce
// per-byte overhead for high-bitrate playback.
const STREAM_HIGH_WATER_MARK = 1024 * 1024

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'ts', 'ogv', '3gp'
])

const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa'])

const SUBTITLE_LANG_LABELS = {
  en: 'English', eng: 'English',
  es: 'Spanish', spa: 'Spanish',
  fr: 'French', fre: 'French', fra: 'French',
  de: 'German', ger: 'German', deu: 'German',
  hi: 'Hindi', hin: 'Hindi',
  te: 'Telugu', tel: 'Telugu',
  ta: 'Tamil', tam: 'Tamil',
  ml: 'Malayalam', mal: 'Malayalam',
  kn: 'Kannada', kan: 'Kannada',
  pt: 'Portuguese', por: 'Portuguese',
  it: 'Italian', ita: 'Italian',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  ru: 'Russian', rus: 'Russian',
  ja: 'Japanese', jpn: 'Japanese',
  ko: 'Korean', kor: 'Korean',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  ar: 'Arabic', ara: 'Arabic'
}

function detectSubtitleLang(fileName) {
  const base = (fileName || '').toLowerCase()
  // Matches ".en.", "_en_", "-en-", "[en]", "(en)", ".eng.", etc.
  const m = base.match(/[.\-_ [()\]]+([a-z]{2,3})(?=[.\-_ [()\]])/i)
  if (m) {
    const code = m[1].toLowerCase()
    if (SUBTITLE_LANG_LABELS[code]) {
      return { code, label: SUBTITLE_LANG_LABELS[code] }
    }
    return { code, label: code.toUpperCase() }
  }
  return { code: 'und', label: 'Unknown' }
}

function srtToVtt(text) {
  let normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '')
  // Already WebVTT? Still normalize comma timestamps just in case.
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  if (/^WEBVTT/m.test(normalized)) return normalized
  // Strip numeric-only cue identifiers that SRT uses ("1\n00:00:01,000 --> ...")
  // is valid VTT too, so just prepend the header.
  return `WEBVTT\n\n${normalized.trim()}\n`
}

function assTimeToVtt(t) {
  // ASS: H:MM:SS.cc -> HH:MM:SS.mmm
  const m = String(t || '').trim().match(/^(-?\d+):(\d{2}):(\d{2})[.:](\d{2,3})$/)
  if (!m) return null
  const h = String(m[1]).padStart(2, '0')
  let ms = m[4]
  if (ms.length === 2) ms = `${ms}0`
  return `${h}:${m[2]}:${m[3]}.${ms}`
}

function assToVtt(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  const lines = normalized.split('\n')
  const cues = []
  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue
    // Dialogue: Layer, Start, End, Style, Name, ML, MR, MV, Effect, Text...
    // Split into max 10 parts so commas inside Text survive.
    const body = line.slice('Dialogue:'.length).trim()
    const parts = body.split(',')
    if (parts.length < 10) continue
    const start = assTimeToVtt(parts[1])
    const end = assTimeToVtt(parts[2])
    if (!start || !end) continue
    const rawText = parts.slice(9).join(',')
    const clean = rawText
      .replace(/\{[^}]*\}/g, '') // ASS override tags
      .replace(/\\N/gi, '\n') // hard line break
      .replace(/\\n/gi, '\n')
      .replace(/\\h/g, ' ')
      .trim()
    if (!clean) continue
    cues.push(`${start} --> ${end}\n${clean}`)
  }
  if (cues.length === 0) {
    // Unparseable ASS: strip tags and serve as a single note cue rather than failing.
    const stripped = normalized.replace(/\{[^}]*\}/g, '').trim().slice(0, 2000)
    if (!stripped) return 'WEBVTT\n\n'
    return `WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n[Subtitle format not fully supported — open in VLC]\n`
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

function convertSubtitleToVtt(text, ext) {
  if (ext === 'vtt') {
    let normalized = (text || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
    if (/^WEBVTT/m.test(normalized)) return normalized
    return srtToVtt(normalized)
  }
  if (ext === 'ass' || ext === 'ssa') return assToVtt(text)
  return srtToVtt(text) // .srt default
}

async function readTorrentFileText(file) {
  const stream = file.createReadStream()
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  try { stream.destroy?.() } catch { }
  return Buffer.concat(chunks).toString('utf8')
}

const MIME_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp'
}

export class StreamManager {
  constructor(getMainClient, getManagedTorrent = null, getMaxConns = null) {
    this.getMainClient = getMainClient
    this.getManagedTorrent = getManagedTorrent
    this.getMaxConns = getMaxConns
    this.streamClient = null
    this.httpServer = null
    this.serverPort = null
    this.activeTorrent = null // Torrent currently being streamed
    this.activeFileIndex = null
    this.activeFile = null
    this.activeInfoHash = null
    this.activeLocalStream = null
    this.activeStream = null // Current active read stream if any
    this.subtitleCache = new Map() // `${infoHash}:${fileIndex}` -> converted WebVTT buffer
    this.mainTorrentStreamState = null // Selection/strategy to restore after main-client playback
    this.parsedTorrents = new Map() // infoHash -> the instance used for metadata selection
    this.parsedLocalStreams = new Map() // infoHash -> verified files already on disk
    this.parsedAt = new Map() // infoHash -> Date.now() of parse, for stale-entry eviction
    // Sweep parsed-but-never-streamed torrents so abandoned picks stop
    // consuming swarm handles and temp disk. Runs every 5 minutes.
    this._evictTimer = setInterval(() => {
      this.evictStaleParsed().catch(() => { })
    }, 5 * 60 * 1000)
    try { this._evictTimer.unref?.() } catch { }
    this.tempCacheRoot = path.join(app.getPath('temp'), 'nexus-stream-cache')
    this.isUsingMainClient = false
    // Loopback-only by default. LAN sharing (other devices on your network can
    // reach the stream) binds 0.0.0.0 instead — toggled from Settings.
    this.bindHost = '127.0.0.1'
  }

  setMaxConns(conns) {
    const valid = Math.max(10, Math.min(2000, Number(conns) || 1000))
    if (this.streamClient && !this.streamClient.destroyed) {
      this.streamClient.maxConns = valid
      console.log(`[StreamManager] Updated streamClient.maxConns to ${valid}`)
    }
  }

  setLanSharing(enabled) {
    this.bindHost = enabled ? '0.0.0.0' : '127.0.0.1'
    console.log(`[StreamManager] LAN sharing ${enabled ? 'enabled (0.0.0.0)' : 'disabled (127.0.0.1)'}. Applies to the next stream.`)
  }

  trackParsed(torrent) {
    const hash = (torrent.infoHash || '').toLowerCase()
    if (!hash) return
    this.parsedTorrents.set(hash, torrent)
    this.parsedAt.set(hash, Date.now())
  }

  untrackParsed(infoHash) {
    const hash = (infoHash || '').toLowerCase()
    if (!hash) return
    this.parsedTorrents.delete(hash)
    this.parsedLocalStreams.delete(hash)
    this.parsedAt.delete(hash)
  }

  getInfoHashFromSource(source) {
    if (typeof source !== 'string') return null
    const magnetMatch = source.match(/xt=urn:btih:([a-zA-Z0-9]+)/i)
    if (magnetMatch) return magnetMatch[1].toLowerCase()
    const candidate = source.trim().toLowerCase()
    return /^[a-f0-9]{40}$/.test(candidate) ? candidate : null
  }

  /**
   * A persistent download starts with a low-priority whole-torrent selection.
   * Suspend it while using that torrent as a stream source: otherwise its
   * sequential scheduler backfills byte zero in parallel with a forward seek.
   */
  prepareMainTorrentForStreaming(torrent, infoHash) {
    if (!this.isUsingMainClient || !torrent || torrent.destroyed || !torrent.pieces?.length) return

    this.restoreMainTorrentDownload()
    this.mainTorrentStreamState = {
      torrent,
      infoHash,
      strategy: torrent.strategy
    }
    try {
      torrent.deselect(0, torrent.pieces.length - 1)
    } catch (e) {
      console.warn('[StreamManager] Could not suspend main download selection:', e.message)
    }
  }

  /** Restore the persistent torrent's user-selected files after playback. */
  restoreMainTorrentDownload() {
    const state = this.mainTorrentStreamState
    this.mainTorrentStreamState = null
    const torrent = state?.torrent
    if (!torrent || torrent.destroyed || !torrent.pieces?.length) return

    try {
      torrent.deselect(0, torrent.pieces.length - 1)
      const managed = this.getManagedTorrent?.(state.infoHash)
      const deselected = new Set(managed?.deselectedFiles || [])
      torrent.files.forEach((file, index) => {
        if (deselected.has(index) || deselected.has(file.path)) return
        file.select(0)
      })
      torrent.strategy = managed?.strategy || state.strategy || 'sequential'
    } catch (e) {
      console.warn('[StreamManager] Could not restore main download selection:', e.message)
    }
  }

  /**
   * Return a streamable, fully verified local torrent record when the Stream
   * tab was opened from a completed/paused transfer. Paused persistent
   * torrents are deliberately removed from the main WebTorrent client, so
   * falling through to the ephemeral client here would download the same
   * files from the swarm again.
   */
  async findVerifiedLocalStream(source) {
    const infoHash = this.getInfoHashFromSource(source)
    if (!infoHash || !this.getManagedTorrent) return null

    const managed = this.getManagedTorrent(infoHash)
    if (!managed || !(managed.done || Number(managed.progress) >= 1) || !managed.path) return null

    const files = Array.isArray(managed.files) ? managed.files : []
    if (files.length === 0) return null

    const verifiedFiles = []
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      const relativePath = file?.path || file?.name
      const length = Number(file?.length)
      if (!relativePath || !Number.isSafeInteger(length) || length < 0) return null

      const localPath = resolveWithinRoot(managed.path, relativePath)
      if (!localPath) return null
      try {
        const stat = await fs.stat(localPath)
        if (!stat.isFile() || stat.size !== length) return null
      } catch {
        return null
      }

      const name = file.name || path.basename(relativePath)
      const extension = path.extname(name).toLowerCase().replace('.', '')
      const isSubtitle = this.isSubtitleFile(name)
      const lang = isSubtitle ? detectSubtitleLang(name) : null
      verifiedFiles.push({
        index: Number.isInteger(file.index) ? file.index : index,
        name,
        path: relativePath,
        localPath,
        length,
        isVideo: this.isVideoFile(name),
        isSubtitle,
        subtitleLang: lang?.code || null,
        subtitleLabel: lang?.label || null,
        extension
      })
    }

    return {
      infoHash,
      name: managed.name || 'Local Torrent',
      magnetURI: managed.magnetURI,
      length: Number(managed.length) || verifiedFiles.reduce((sum, file) => sum + file.length, 0),
      files: verifiedFiles
    }
  }

  formatLocalStreamMetadata(localStream) {
    return {
      infoHash: localStream.infoHash,
      name: localStream.name,
      magnetURI: localStream.magnetURI,
      length: localStream.length,
      numPeers: 0,
      isLocal: true,
      files: localStream.files.map(({ localPath: _localPath, ...file }) => file)
    }
  }

  async evictStaleParsed() {
    const TTL = 15 * 60 * 1000
    const now = Date.now()
    for (const [hash, at] of this.parsedAt) {
      if (now - at < TTL) continue
      if (this.activeTorrent && (this.activeTorrent.infoHash || '').toLowerCase() === hash) continue
      const t = this.parsedTorrents.get(hash)
      this.untrackParsed(hash)
      try {
        if (t && !t.destroyed && this.streamClient && this.streamClient.get(hash) === t) {
          await new Promise(res => {
            try { this.streamClient.remove(t, () => res()) } catch { res() }
          })
          console.log(`[StreamManager] Evicted stale parsed torrent ${hash}`)
        }
      } catch (e) {
        console.warn('[StreamManager] Eviction failed:', e.message)
      }
      if (t) await this.cleanTempCache(hash)
    }
  }

  getMimeType(fileName) {
    const ext = path.extname(fileName || '').toLowerCase().replace('.', '')
    return MIME_TYPES[ext] || 'video/mp4'
  }

  isVideoFile(fileName) {
    const ext = path.extname(fileName || '').toLowerCase().replace('.', '')
    return VIDEO_EXTENSIONS.has(ext)
  }

  isSubtitleFile(fileName) {
    const ext = path.extname(fileName || '').toLowerCase().replace('.', '')
    return SUBTITLE_EXTENSIONS.has(ext)
  }

  async ensureTempDir(infoHash = '') {
    const targetDir = infoHash ? path.join(this.tempCacheRoot, infoHash) : this.tempCacheRoot
    try {
      await fs.mkdir(targetDir, { recursive: true })
    } catch (e) {
      console.warn('[StreamManager] Could not create temp dir:', e)
    }
    return targetDir
  }

  async getStreamClient() {
    if (!this.streamClient || this.streamClient.destroyed) {
      const { default: WebTorrent } = await import('webtorrent')
      const targetMaxConns = (this.getMaxConns ? this.getMaxConns() : null) || 1000
      this.streamClient = new WebTorrent({
        // Ephemeral client for streaming: maximize peer net and aggressive discovery
        maxConns: targetMaxConns,
        maxWebConns: 100,
        dht: {
          bootstrap: [
            'router.bittorrent.com:6881',
            'router.utorrent.com:6881',
            'dht.transmissionbt.com:6881',
            'dht.libtorrent.org:25401',
            'router.bitcomet.com:554'
          ]
        },
        lsd: true,
        utPex: true,
        natUpnp: true,
        natPmp: true,
        tracker: {
          announce: [
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
          ],
          getAnnounceOpts: () => ({ numwant: 200 })
        }
      })

      this.streamClient.on('error', (err) => {
        console.error('[StreamManager] Client Error:', err)
      })
    }
    return this.streamClient
  }

  /**
   * Parses metadata from magnet link, .torrent file path, or buffer.
   * Returns torrent summary and list of all files with video indicators.
   */
  async parseTorrent(source) {
    // Completed local transfers are the fastest and most reliable stream
    // source. Prefer them before looking for a live swarm.
    const localStream = await this.findVerifiedLocalStream(source)
    if (localStream) {
      this.parsedLocalStreams.set(localStream.infoHash, localStream)
      this.parsedAt.set(localStream.infoHash, Date.now())
      return this.formatLocalStreamMetadata(localStream)
    }

    // Check if main client already has this torrent
    const mainClient = this.getMainClient?.()
    let existingTorrent = null

    if (typeof source === 'string' && source.startsWith('magnet:?')) {
      const match = source.match(/xt=urn:btih:([a-zA-Z0-9]+)/i)
      if (match && mainClient) {
        const hash = match[1].toLowerCase()
        existingTorrent = mainClient.get(hash)
      }
    } else if (typeof source === 'string' && mainClient) {
      const hash = source.toLowerCase()
      existingTorrent = mainClient.get(hash)
    }

    if (existingTorrent && existingTorrent.metadata && existingTorrent.files?.length) {
      this.parsedTorrents.set((existingTorrent.infoHash || '').toLowerCase(), existingTorrent)
      return this.formatTorrentMetadata(existingTorrent)
    }

    // The main client already owns this infoHash but its metadata has not
    // landed yet. Adding the same infoHash to a second client would run two
    // independent swarms for one torrent — peers are split across both, the
    // piece stores diverge, and both DHTs bootstrap. Wait on the instance the
    // main client already has instead.
    if (existingTorrent) {
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            existingTorrent.removeListener?.('metadata', onMetadata)
            reject(new Error('Timed out waiting for torrent metadata. Please verify magnet/peers.'))
          }, 60000)
          const onMetadata = () => {
            clearTimeout(timeout)
            if (!existingTorrent.files?.length) {
              reject(new Error('Torrent metadata is not ready for the selected file. Please retry.'))
              return
            }
            this.parsedTorrents.set((existingTorrent.infoHash || '').toLowerCase(), existingTorrent)
            resolve(this.formatTorrentMetadata(existingTorrent))
          }
          existingTorrent.once?.('metadata', onMetadata)
          // Metadata may have completed between the check above and the
          // listener registration.
          if (existingTorrent.metadata && existingTorrent.files?.length) onMetadata()
        })
      } catch (err) {
        console.warn('[StreamManager] Main-client metadata wait failed:', err.message)
      }
    }

    const client = await this.getStreamClient()
    const tempDir = await this.ensureTempDir()

    // Robust source preparation
    let torrentSource = source
    if (source instanceof Uint8Array || Buffer.isBuffer(source)) {
      torrentSource = Buffer.from(source)
    } else if (typeof source === 'string' && (source.endsWith('.torrent') || source.includes(path.sep))) {
      try {
        torrentSource = await fs.readFile(source)
      } catch (e) {
        console.warn('[StreamManager] Could not read file path as buffer, fallback to raw string:', e)
      }
    }

    return new Promise((resolve, reject) => {
      // Check if already in streamClient
      let existingInStream = null
      try {
        if (typeof source === 'string' && source.startsWith('magnet:?')) {
          const match = source.match(/xt=urn:btih:([a-zA-Z0-9]+)/i)
          if (match) existingInStream = client.get(match[1].toLowerCase())
        }
      } catch { }

      if (existingInStream && existingInStream.metadata && existingInStream.files?.length) {
        this.trackParsed(existingInStream)
        return resolve(this.formatTorrentMetadata(existingInStream))
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for torrent metadata. Please verify magnet/peers.'))
      }, 60000)

      try {
        const torrent = client.add(torrentSource, { path: tempDir, deselect: true, maxWebConns: 100 }, (t) => {
          clearTimeout(timeout)
          this.trackParsed(t)
          resolve(this.formatTorrentMetadata(t))
        })
        if (torrent && typeof torrent.on === 'function') {
          torrent.on('error', (err) => {
            console.warn('[StreamManager] Ephemeral torrent error:', err)
          })
        }
      } catch (err) {
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  formatTorrentMetadata(torrent) {
    const files = (torrent.files || []).map((f, idx) => {
      const extension = path.extname(f.name).toLowerCase().replace('.', '')
      const isSubtitle = SUBTITLE_EXTENSIONS.has(extension)
      const lang = isSubtitle ? detectSubtitleLang(f.name) : null
      return {
        index: idx,
        name: f.name,
        path: f.path,
        length: f.length,
        isVideo: this.isVideoFile(f.name),
        isSubtitle,
        subtitleLang: lang?.code || null,
        subtitleLabel: lang?.label || null,
        extension
      }
    })

    return {
      infoHash: (torrent.infoHash || '').toLowerCase(),
      name: torrent.name || 'Unknown Torrent',
      magnetURI: torrent.magnetURI,
      length: torrent.length || 0,
      numPeers: torrent.numPeers || 0,
      files
    }
  }

  /**
   * Start streaming a specific file index from the torrent.
   * Spawns an internal HTTP Range 206 server and returns the stream URL.
   */
  async startStreaming(infoHash, fileIndex = 0) {
    const normHash = (infoHash || '').toLowerCase()
    const localStream = this.parsedLocalStreams.get(normHash) || null

    // 1. Use the exact instance that supplied the file picker. A matching
    // persistent torrent can exist without its metadata/files being ready.
    let torrent = null
    this.isUsingMainClient = false

    if (!localStream) {
      const mainClient = this.getMainClient?.()
      const parsedTorrent = this.parsedTorrents.get(normHash)
      if (parsedTorrent && !parsedTorrent.destroyed) {
        torrent = parsedTorrent
        this.isUsingMainClient = Boolean(mainClient && mainClient.get(normHash) === torrent)
      }

      if (!torrent) {
        const streamClient = await this.getStreamClient()
        torrent = streamClient.get(normHash)
      }

      if (!torrent && mainClient) {
        const mainTorrent = mainClient.get(normHash)
        if (mainTorrent?.metadata && mainTorrent.files?.length) {
          torrent = mainTorrent
          this.isUsingMainClient = true
        }
      }
    }

    if (!localStream && !torrent) {
      throw new Error(`Torrent with infoHash ${normHash} was not found in streaming engine.`)
    }

    // 2. Stop any existing HTTP streaming server
    await this.stopServerOnly()

    // 3. Locate target file
    const selectedIndex = Number(fileIndex)
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
      throw new Error('Invalid stream file selection.')
    }

    const targetFile = localStream?.files?.find(file => file.index === selectedIndex) || torrent?.files?.[selectedIndex]
    if (!targetFile) {
      throw new Error('Torrent metadata is not ready for the selected file. Please retry.')
    }

    // Drop any seek window left on the previous torrent (before swapping)
    try {
      if (this.seekWindow && this.activeTorrent && !this.activeTorrent.destroyed) {
        this.activeTorrent.deselect(this.seekWindow.start, this.seekWindow.end)
      }
    } catch { /* best-effort */ }
    this.seekWindow = null

    // A prior main-client stream may be switching files or sources.
    this.restoreMainTorrentDownload()

    this.activeTorrent = torrent
    this.activeFileIndex = selectedIndex
    this.activeFile = targetFile
    this.activeInfoHash = normHash
    this.activeLocalStream = localStream

    if (torrent) {
      this.prepareMainTorrentForStreaming(torrent, normHash)
      // 4. Prioritize piece downloading for the chosen file
      // Keep tiny sidecar subtitle files selected so they download
      // alongside the video; deselect everything else.
      torrent.files.forEach((f, idx) => {
        if (idx === selectedIndex) return
        try {
          if (this.isSubtitleFile(f.name)) f.select()
          else f.deselect()
        } catch { }
      })

      // Do not add a full-file selection here. With sequential piece
      // scheduling, that selection always backfills from byte zero after a
      // forward seek. The bounded HTTP reader supplies only the active range
      // (priority 1) and the moving seek window supplies the upcoming range
      // (priority 2), so swarm demand stays at the playhead.

      // Playback needs pieces in order; the shared main-client torrent may be
      // on rarest-first for raw speed, so force sequential for the stream.
      try {
        torrent.strategy = 'sequential'
      } catch { }
    }

    // 5. Start HTTP Range 206 Streaming Server
    const mimeType = this.getMimeType(targetFile.name)
    const localFilePath = localStream ? targetFile.localPath : null
    const createVideoReadStream = (options = undefined) => (
      localFilePath
        ? fsSync.createReadStream(localFilePath, { highWaterMark: STREAM_HIGH_WATER_MARK, ...options })
        : targetFile.createReadStream(options)
    )

    // Immutable for the life of this server: the infoHash, file index and
    // length fully identify the bytes. Lets the media cache revalidate with a
    // cheap 304 instead of refetching a whole range.
    const streamETag = `"${normHash}-${selectedIndex}-${targetFile.length}"`

    const server = http.createServer(async (req, res) => {
      // CORS: same-origin page loads need no header, but <track> fetches run
      // in CORS mode. Echo only loopback origins so arbitrary websites
      // cannot read the local stream.
      const reqOrigin = req.headers.origin
      if (reqOrigin && /^(https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?|null)$/.test(reqOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', reqOrigin)
        res.setHeader('Vary', 'Origin')
      }
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const reqUrl = (req.url || '/').split('?')[0]

      // --- Sidecar subtitle route: /subtitles/:fileIndex -> converted WebVTT ---
      if (reqUrl.startsWith('/subtitles/')) {
        const subIndex = Number(reqUrl.slice('/subtitles/'.length))
        const subFile = Number.isInteger(subIndex)
          ? (localStream?.files?.find(file => file.index === subIndex) || torrent?.files?.[subIndex])
          : null
        if (!subFile || !this.isSubtitleFile(subFile.name)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Subtitle not found')
          return
        }
        if (torrent) {
          try { subFile.select() } catch { }
        }
        // Cache the converted WebVTT per stream. Re-opening the CC menu
        // otherwise re-reads the subtitle from the swarm and re-runs the
        // format conversion on every request.
        const cacheKey = `${normHash}:${subIndex}`
        const cached = this.subtitleCache.get(cacheKey)
        if (cached) {
          res.writeHead(200, {
            'Content-Type': 'text/vtt;charset=utf-8',
            'Content-Length': cached.length,
            'Cache-Control': 'private, max-age=3600'
          })
          res.end(cached)
          return
        }
        try {
          const raw = localStream
            ? await fs.readFile(subFile.localPath, 'utf8')
            : await readTorrentFileText(subFile)
          const ext = path.extname(subFile.name).toLowerCase().replace('.', '')
          const vtt = convertSubtitleToVtt(raw, ext)
          const body = Buffer.from(vtt, 'utf8')
          this.subtitleCache.set(cacheKey, body)
          res.writeHead(200, {
            'Content-Type': 'text/vtt;charset=utf-8',
            'Content-Length': body.length,
            'Cache-Control': 'private, max-age=3600'
          })
          res.end(body)
        } catch (err) {
          console.warn('[StreamManager] Subtitle serve error:', err)
          if (!res.headersSent) res.writeHead(500)
          res.end()
        }
        return
      }

      const range = req.headers.range
      const fileSize = targetFile.length

      if (range) {
        const parsed = parseRangeHeader(range, fileSize)
        if (!parsed) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          })
          res.end()
          return
        }
        // Limit every response, including an open-ended `bytes=N-` request.
        // This prevents a reader from pinning N..EOF at FileIterator's
        // priority after the player has moved to another timestamp.
        const { start, end } = capRangeLength(parsed, MAX_STREAM_RANGE_BYTES)
        const chunkSize = (end - start) + 1
        // Revalidation: the media cache re-asks for a range it already holds.
        // Answer 304 so the bytes are not sent again.
        if (req.headers['if-none-match'] === streamETag) {
          res.writeHead(304, {
            'ETag': streamETag,
            // RFC 7232: a 304 answering a range request still reports which
            // range the stored response covers.
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Cache-Control': 'private, max-age=3600'
          })
          res.end()
          return
        }
        // NOTE: no manual torrent.critical() here. file.createReadStream()
        // already prioritizes its own window via FileIterator, and critical
        // flags are sticky (never cleared) — marking 10MB on every Range
        // request accumulates until everything is "critical", which defeats
        // prioritization and thrashes the swarm.
        // Seek-aware window: a removable, highest-priority selection that
        // follows the playback position, so the swarm always has forward
        // demand. Progressive buffering reuses the same start (no churn); a
        // seek re-anchors it. The arithmetic lives in streamWindow.js so the
        // behaviour that prevents mid-playback stalls is unit-tested.
        if (torrent) {
          try {
            const next = computeSeekWindow({
              pieceLength: torrent.pieceLength || 0,
              fileStartPiece: targetFile._startPiece ?? 0,
              fileEndPiece: targetFile._endPiece ?? (torrent.pieces ? torrent.pieces.length - 1 : -1),
              fileOffset: targetFile.offset || 0,
              requestStart: start
            })
            if (next && shouldMoveWindow(this.seekWindow, next)) {
              const prev = this.seekWindow
              // isStreamSelection must match the select() that created it,
              // otherwise the deselect is a no-op and the stale window keeps
              // its high priority forever.
              if (prev) { try { torrent.deselect(prev.start, prev.end) } catch { /* stale */ } }
              // FileIterator uses priority 1 for the bounded HTTP response.
              // The moving playback window must outrank it after a seek.
              torrent.select(next.start, next.end, 2)
              this.seekWindow = next
            }
          } catch { /* prioritization is best-effort */ }
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          // The old no-store policy forbade Chromium from retaining a single
          // byte, so every stall and every re-buffer had to re-request from
          // here. This is a loopback server serving immutable torrent content,
          // so a private cache is safe and keeps already-fetched media
          // available when the swarm stutters.
          'Cache-Control': 'private, max-age=3600',
          'ETag': streamETag
        })

        const stream = createVideoReadStream({ start, end })
        stream.pipe(res)

        req.on('close', () => stream.destroy())
        res.on('close', () => stream.destroy())
        res.on('finish', () => stream.destroy())
        stream.on('error', (err) => {
          console.warn('[StreamManager] ReadStream Range error:', err)
          if (!res.headersSent) {
            res.writeHead(500)
          }
          res.end()
        })
      } else {
        // Non-range request: stream full file
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Cache-Control': 'private, max-age=3600',
          'ETag': streamETag
        })

        const stream = createVideoReadStream()
        stream.pipe(res)

        req.on('close', () => stream.destroy())
        res.on('close', () => stream.destroy())
        res.on('finish', () => stream.destroy())
        stream.on('error', (err) => {
          console.warn('[StreamManager] ReadStream full error:', err)
          if (!res.headersSent) {
            res.writeHead(500)
          }
          res.end()
        })
      }
    })

    // TCP tuning: Nagle's algorithm can hold back small writes behind a full
    // segment, and Node's 5s keep-alive default closes the connection between
    // sequential range requests. Both add latency per response.
    server.keepAliveTimeout = 72 * 1000
    server.headersTimeout = 75 * 1000
    server.on('connection', (socket) => {
      try { socket.setNoDelay(true) } catch { /* best-effort */ }
    })

    // Listen on dynamic available port (loopback, or LAN when sharing is on)
    await new Promise((resolve, reject) => {
      server.listen(0, this.bindHost, () => {
        const address = server.address()
        this.serverPort = address.port
        this.httpServer = server
        console.log(`[StreamManager] Stream server active at http://127.0.0.1:${this.serverPort}/stream`)
        resolve()
      })
      server.on('error', reject)
    })

    const baseUrl = `http://127.0.0.1:${this.serverPort}`
    const subtitles = (localStream?.files || torrent?.files || [])
      .map((f, idx) => ({ f, idx: localStream ? f.index : idx }))
      .filter(({ f }) => this.isSubtitleFile(f.name))
      .map(({ f, idx }) => {
        const lang = detectSubtitleLang(f.name)
        return {
          index: idx,
          name: f.name,
          lang: lang.code,
          label: `${f.name.split(/[\\/]/).pop()} · ${lang.label}`,
          url: `${baseUrl}/subtitles/${idx}`
        }
      })

    return {
      streamUrl: `${baseUrl}/stream`,
      fileName: targetFile.name,
      fileLength: targetFile.length,
      fileIndex: selectedIndex,
      infoHash: normHash,
      mimeType,
      subtitles,
      isLocal: Boolean(localStream),
      isExternalPlayerFriendly: !['mp4', 'webm'].includes(path.extname(targetFile.name).toLowerCase().replace('.', ''))
    }
  }

  /**
   * Re-anchor the read-ahead window to a seek target ahead of the player's
   * HTTP range request, so the swarm starts fetching the destination
   * immediately instead of after the request round trip.
   *
   * Best-effort and purely advisory: the subsequent range request recomputes
   * the window and corrects it if the estimated offset was off.
   *
   * @param {number} requestStart estimated byte offset of the seek target
   * @returns {boolean} true when the window was actually moved
   */
  prefetchAt(requestStart) {
    const torrent = this.activeTorrent
    if (!torrent || torrent.destroyed || this.activeLocalStream) return false

    try {
      const next = computeSeekWindow({
        pieceLength: torrent.pieceLength || 0,
        fileStartPiece: this.activeFile?._startPiece ?? 0,
        fileEndPiece: this.activeFile?._endPiece ?? (torrent.pieces ? torrent.pieces.length - 1 : -1),
        fileOffset: this.activeFile?.offset || 0,
        requestStart
      })
      if (!next || !shouldMoveWindow(this.seekWindow, next)) return false

      const prev = this.seekWindow
      if (prev) { try { torrent.deselect(prev.start, prev.end) } catch { /* stale */ } }
      torrent.select(next.start, next.end, 2)
      this.seekWindow = next
      return true
    } catch {
      return false
    }
  }

  /**
   * Stop HTTP server without destroying torrent.
   * Never hangs: detaches first, then races close() against a 3s timeout.
   */
  async stopServerOnly() {
    const server = this.httpServer
    if (!server) return
    this.httpServer = null
    this.serverPort = null
    try {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
    } catch { }
    await Promise.race([
      new Promise((resolve) => {
        try {
          server.close(() => resolve())
        } catch {
          resolve()
        }
      }),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ])
  }

  /**
   * Stop streaming completely and clean up resources
   */
  async stopStreaming() {
    await this.stopServerOnly()

    const torrent = this.activeTorrent
    const isUsingMain = this.isUsingMainClient
    const hash = this.activeInfoHash || (torrent?.infoHash || '').toLowerCase()

    this.restoreMainTorrentDownload()

    this.activeTorrent = null
    this.activeFile = null
    this.activeFileIndex = null
    this.activeInfoHash = null
    this.activeLocalStream = null
    this.isUsingMainClient = false
    this.subtitleCache.clear()
    if (hash) this.untrackParsed(hash)

    // If it was an ephemeral streamClient torrent, remove it and clean temp files
    if (torrent && !isUsingMain && this.streamClient) {
      try {
        this.streamClient.remove(torrent, async () => {
          if (hash) {
            await this.cleanTempCache(hash)
          }
        })
      } catch (e) {
        console.warn('[StreamManager] Error removing ephemeral torrent:', e)
      }
    }
    return { success: true }
  }

  /**
   * Get real-time streaming telemetry
   */
  getStatus() {
    if ((!this.activeTorrent && !this.activeLocalStream) || !this.httpServer) {
      return {
        active: false,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        progress: 0,
        downloaded: 0,
        length: 0,
        bufferRatio: 0
      }
    }

    const t = this.activeTorrent
    const f = this.activeFile

    if (this.activeLocalStream) {
      return {
        active: true,
        local: true,
        infoHash: this.activeInfoHash,
        fileName: f?.name || this.activeLocalStream.name,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        seeders: 0,
        unchokedPeers: 0,
        queuedPeers: 0,
        progress: 1,
        downloaded: f?.length || 0,
        length: f?.length || 0,
        timeRemaining: 0,
        streamUrl: `http://127.0.0.1:${this.serverPort}/stream`
      }
    }

    const targetLength = f?.length || t.length || 0
    const downloaded = f?.downloaded || t.downloaded || 0
    const progress = targetLength > 0 ? (downloaded / targetLength) : 0

    // Single pass over the wire list. This runs on a 1Hz IPC poll and can hold
    // up to maxConns entries, so two .filter() passes meant two intermediate
    // arrays per tick.
    let seeders = 0
    let unchokedPeers = 0
    for (const wire of t.wires || []) {
      if (wire.isSeeder) seeders++
      if (!wire.peerChoking) unchokedPeers++
    }

    return {
      active: true,
      infoHash: (t.infoHash || '').toLowerCase(),
      fileName: f?.name || t.name,
      downloadSpeed: t.downloadSpeed || 0,
      uploadSpeed: t.uploadSpeed || 0,
      numPeers: t.numPeers || 0,
      seeders,
      unchokedPeers,
      queuedPeers: Math.max(0, t._numQueued || 0),
      progress,
      downloaded,
      length: targetLength,
      timeRemaining: t.timeRemaining || 0,
      streamUrl: `http://127.0.0.1:${this.serverPort}/stream`
    }
  }

  /**
   * Purge a specific temporary hash directory or entire cache
   */
  async cleanTempCache(infoHash = '') {
    try {
      const targetDir = infoHash ? path.join(this.tempCacheRoot, infoHash) : this.tempCacheRoot
      if (fsSync.existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true })
        console.log(`[StreamManager] Purged temp cache: ${targetDir}`)
      }
    } catch (e) {
      console.warn('[StreamManager] Failed to purge temp cache:', e)
    }
  }

  /**
   * Promote the current stream torrent into persistent download mode.
   * Best-effort carry-over: copies already-streamed bytes into the destination
   * so the permanent download verifies and keeps those pieces instead of
   * starting from zero. The live stream is untouched and keeps playing.
   */
  async promoteToDownload(destinationPath) {
    const torrent = this.activeTorrent
    if (!torrent) {
      throw new Error('No active stream to save')
    }

    const magnetURI = torrent.magnetURI
    const infoHash = (torrent.infoHash || '').toLowerCase()
    const name = torrent.name

    if (!this.isUsingMainClient && this.activeFile) {
      try {
        const srcFull = path.join(this.tempCacheRoot, infoHash, this.activeFile.path)
        const destFull = path.join(destinationPath, this.activeFile.path)
        if (fsSync.existsSync(srcFull) && !fsSync.existsSync(destFull)) {
          await fs.mkdir(path.dirname(destFull), { recursive: true })
          await fs.copyFile(srcFull, destFull)
          console.log(`[StreamManager] Carried streamed bytes into ${destFull}`)
        }
      } catch (e) {
        console.warn('[StreamManager] Piece carry-over failed, download starts fresh:', e.message)
      }
    }

    return {
      magnetURI,
      infoHash,
      name,
      destinationPath
    }
  }
}
