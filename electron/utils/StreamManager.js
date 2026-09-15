import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { app } from 'electron'
import { parseRangeHeader } from './rangeParser.js'

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
  constructor(getMainClient) {
    this.getMainClient = getMainClient
    this.streamClient = null
    this.httpServer = null
    this.serverPort = null
    this.activeTorrent = null // Torrent currently being streamed
    this.activeFileIndex = null
    this.activeFile = null
    this.activeStream = null // Current active read stream if any
    this.parsedTorrents = new Map() // infoHash -> the instance used for metadata selection
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
    this.parsedAt.delete(hash)
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
      await this.cleanTempCache(hash)
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
      this.streamClient = new WebTorrent({
        // Ephemeral client for streaming: wide peer net, but sequential
        // piece order (WebTorrent default) so playback fills ahead first.
        maxConns: 200,
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
            'http://tracker.openbittorrent.com:80/announce',
            'http://open.tracker.cl:1337/announce'
          ]
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
        const torrent = client.add(torrentSource, { path: tempDir, deselect: true }, (t) => {
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

    // 1. Use the exact instance that supplied the file picker. A matching
    // persistent torrent can exist without its metadata/files being ready.
    let torrent = null
    this.isUsingMainClient = false

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

    if (!torrent) {
      throw new Error(`Torrent with infoHash ${normHash} was not found in streaming engine.`)
    }

    // 2. Stop any existing HTTP streaming server
    await this.stopServerOnly()

    // 3. Locate target file
    const selectedIndex = Number(fileIndex)
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
      throw new Error('Invalid stream file selection.')
    }

    const targetFile = torrent.files?.[selectedIndex]
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

    this.activeTorrent = torrent
    this.activeFileIndex = selectedIndex
    this.activeFile = targetFile

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

    // Select the target file
    try {
      targetFile.select()
    } catch (e) {
      console.warn('[StreamManager] Error selecting file:', e)
    }

    // Playback needs pieces in order; the shared main-client torrent may be
    // on rarest-first for raw speed, so force sequential for the stream.
    try {
      torrent.strategy = 'sequential'
    } catch { }

    // 5. Start HTTP Range 206 Streaming Server
    const mimeType = this.getMimeType(targetFile.name)

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
        const subFile = Number.isInteger(subIndex) ? torrent.files?.[subIndex] : null
        if (!subFile || !this.isSubtitleFile(subFile.name)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Subtitle not found')
          return
        }
        try { subFile.select() } catch { }
        try {
          const raw = await readTorrentFileText(subFile)
          const ext = path.extname(subFile.name).toLowerCase().replace('.', '')
          const vtt = convertSubtitleToVtt(raw, ext)
          const body = Buffer.from(vtt, 'utf8')
          res.writeHead(200, {
            'Content-Type': 'text/vtt;charset=utf-8',
            'Content-Length': body.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
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
        const { start, end } = parsed
        const chunkSize = (end - start) + 1
        // NOTE: no manual torrent.critical() here. file.createReadStream()
        // already prioritizes its own window via FileIterator, and critical
        // flags are sticky (never cleared) — marking 10MB on every Range
        // request accumulates until everything is "critical", which defeats
        // prioritization and thrashes the swarm.
        // Seek-aware window instead: a *removable* high-priority selection
        // (~50MB) that follows the playback position. Progressive buffering
        // reuses the same start (no churn); a forward seek jumps start and
        // moves the window, so the swarm fetches upcoming video first rather
        // than backfilling the skipped gap. The gap still downloads afterwards
        // at normal priority via the file-wide selection, so nothing is lost.
        try {
          const pieceLen = torrent.pieceLength || 0
          const fileStartPiece = targetFile._startPiece ?? 0
          const fileEndPiece = targetFile._endPiece ?? (torrent.pieces ? torrent.pieces.length - 1 : -1)
          if (pieceLen > 0 && fileEndPiece >= fileStartPiece) {
            const reqPiece = Math.min(fileEndPiece, Math.max(fileStartPiece,
              Math.floor(((targetFile.offset || 0) + start) / pieceLen)))
            const windowPieces = Math.max(4, Math.min(64, Math.ceil((50 * 1024 * 1024) / pieceLen)))
            const winStart = reqPiece
            const winEnd = Math.min(fileEndPiece, reqPiece + windowPieces)
            const prev = this.seekWindow
            const moved = !prev || Math.abs(winStart - prev.start) > Math.max(4, Math.floor(windowPieces / 4))
            if (moved && winEnd >= winStart) {
              if (prev) { try { torrent.deselect(prev.start, prev.end) } catch { /* stale */ } }
              torrent.select(winStart, winEnd, 1)
              this.seekWindow = { start: winStart, end: winEnd }
            }
          }
        } catch { /* prioritization is best-effort */ }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        })

        const stream = targetFile.createReadStream({ start, end })
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
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        })

        const stream = targetFile.createReadStream()
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
    const subtitles = (torrent.files || [])
      .map((f, idx) => ({ f, idx }))
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
      isExternalPlayerFriendly: !['mp4', 'webm'].includes(path.extname(targetFile.name).toLowerCase().replace('.', ''))
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
    const hash = (torrent?.infoHash || '').toLowerCase()

    this.activeTorrent = null
    this.activeFile = null
    this.activeFileIndex = null
    this.isUsingMainClient = false
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
    if (!this.activeTorrent || !this.httpServer) {
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

    const targetLength = f?.length || t.length || 0
    const downloaded = f?.downloaded || t.downloaded || 0
    const progress = targetLength > 0 ? (downloaded / targetLength) : 0

    return {
      active: true,
      infoHash: (t.infoHash || '').toLowerCase(),
      fileName: f?.name || t.name,
      downloadSpeed: t.downloadSpeed || 0,
      uploadSpeed: t.uploadSpeed || 0,
      numPeers: t.numPeers || 0,
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
