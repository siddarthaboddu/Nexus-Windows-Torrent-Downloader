import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { app } from 'electron'

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'ts', 'ogv', '3gp'
])

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
    this.tempCacheRoot = path.join(app.getPath('temp'), 'nexus-stream-cache')
    this.isUsingMainClient = false
  }

  getMimeType(fileName) {
    const ext = path.extname(fileName || '').toLowerCase().replace('.', '')
    return MIME_TYPES[ext] || 'video/mp4'
  }

  isVideoFile(fileName) {
    const ext = path.extname(fileName || '').toLowerCase().replace('.', '')
    return VIDEO_EXTENSIONS.has(ext)
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
        // Ephemeral client for streaming
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
        this.parsedTorrents.set((existingInStream.infoHash || '').toLowerCase(), existingInStream)
        return resolve(this.formatTorrentMetadata(existingInStream))
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for torrent metadata. Please verify magnet/peers.'))
      }, 60000)

      try {
        const torrent = client.add(torrentSource, { path: tempDir, deselect: true }, (t) => {
          clearTimeout(timeout)
          this.parsedTorrents.set((t.infoHash || '').toLowerCase(), t)
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
    const files = (torrent.files || []).map((f, idx) => ({
      index: idx,
      name: f.name,
      path: f.path,
      length: f.length,
      isVideo: this.isVideoFile(f.name),
      extension: path.extname(f.name).toLowerCase().replace('.', '')
    }))

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

    this.activeTorrent = torrent
    this.activeFileIndex = selectedIndex
    this.activeFile = targetFile

    // 4. Prioritize piece downloading for the chosen file
    // Deselect other files so bandwidth is 100% focused on current stream
    torrent.files.forEach((f, idx) => {
      if (idx !== selectedIndex) {
        try { f.deselect() } catch { }
      }
    })

    // Select the target file
    try {
      targetFile.select()
    } catch (e) {
      console.warn('[StreamManager] Error selecting file:', e)
    }

    // 5. Start HTTP Range 206 Streaming Server
    const mimeType = this.getMimeType(targetFile.name)

    const server = http.createServer((req, res) => {
      const range = req.headers.range
      const fileSize = targetFile.length

      // Set CORS headers for Electron webview/fetch compatibility
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (range) {
        // Parse Range header e.g. "bytes=0-1048576"
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1

        if (isNaN(start) || start >= fileSize || (end && end >= fileSize)) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`
          })
          res.end()
          return
        }

        const chunkSize = (end - start) + 1
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

    // Listen on dynamic available port
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        this.serverPort = address.port
        this.httpServer = server
        console.log(`[StreamManager] Stream server active at http://127.0.0.1:${this.serverPort}/stream`)
        resolve()
      })
      server.on('error', reject)
    })

    return {
      streamUrl: `http://127.0.0.1:${this.serverPort}/stream`,
      fileName: targetFile.name,
      fileLength: targetFile.length,
      fileIndex: selectedIndex,
      infoHash: normHash,
      mimeType,
      isExternalPlayerFriendly: !['mp4', 'webm'].includes(path.extname(targetFile.name).toLowerCase().replace('.', ''))
    }
  }

  /**
   * Stop HTTP server without destroying torrent
   */
  async stopServerOnly() {
    if (this.httpServer) {
      try {
        if (typeof this.httpServer.closeAllConnections === 'function') {
          this.httpServer.closeAllConnections()
        }
      } catch { }
      await new Promise((resolve) => {
        this.httpServer.close(() => {
          this.httpServer = null
          this.serverPort = null
          resolve()
        })
      })
    }
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
    if (hash) this.parsedTorrents.delete(hash)

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
   * Promote the current stream torrent into persistent download mode
   */
  async promoteToDownload(destinationPath) {
    if (!this.activeTorrent) {
      throw new Error('No active stream to save')
    }

    const magnetURI = this.activeTorrent.magnetURI
    const infoHash = (this.activeTorrent.infoHash || '').toLowerCase()
    const name = this.activeTorrent.name

    return {
      magnetURI,
      infoHash,
      name,
      destinationPath
    }
  }
}
