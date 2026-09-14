import { useState, useEffect, useRef, useCallback } from 'react'

export function useTorrentStream() {
  const [status, setStatus] = useState('idle') // 'idle' | 'parsing' | 'ready' | 'streaming' | 'error'
  const [torrentInfo, setTorrentInfo] = useState(null)
  const [streamData, setStreamData] = useState(null)
  const [streamStats, setStreamStats] = useState({
    active: false,
    downloadSpeed: 0,
    uploadSpeed: 0,
    numPeers: 0,
    progress: 0,
    downloaded: 0,
    length: 0
  })
  const [error, setError] = useState(null)

  const pollingRef = useRef(null)

  // Poll status when streaming
  useEffect(() => {
    if (status === 'streaming') {
      const poll = async () => {
        try {
          if (window.ipcRenderer) {
            const stats = await window.ipcRenderer.invoke('stream-get-status')
            if (stats && stats.active) {
              setStreamStats(stats)
            }
          }
        } catch (e) {
          console.warn('[useTorrentStream] Failed to poll status:', e)
        }
      }

      poll()
      pollingRef.current = setInterval(poll, 1000)
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [status])

  // Parse metadata from magnet link or torrent file
  const parseTorrent = useCallback(async (source) => {
    try {
      setStatus('parsing')
      setError(null)
      if (!window.ipcRenderer) {
        throw new Error('IPC renderer not available')
      }
      const info = await window.ipcRenderer.invoke('stream-parse-torrent', source)
      setTorrentInfo(info)
      setStatus('ready')
      return info
    } catch (err) {
      console.error('[useTorrentStream] parseTorrent error:', err)
      setError(err.message || 'Failed to parse torrent metadata')
      setStatus('error')
      throw err
    }
  }, [])

  // Start streaming a specific file
  const startStream = useCallback(async (infoHash, fileIndex) => {
    try {
      setError(null)
      if (!window.ipcRenderer) {
        throw new Error('IPC renderer not available')
      }
      const data = await window.ipcRenderer.invoke('stream-start', { infoHash, fileIndex })
      setStreamData(data)
      setStatus('streaming')
      return data
    } catch (err) {
      console.error('[useTorrentStream] startStream error:', err)
      setError(err.message || 'Failed to start stream')
      setStatus('error')
      throw err
    }
  }, [])

  // Stop streaming
  const stopStream = useCallback(async () => {
    try {
      if (window.ipcRenderer) {
        await window.ipcRenderer.invoke('stream-stop')
      }
    } catch (err) {
      console.warn('[useTorrentStream] stopStream error:', err)
    } finally {
      setStatus('idle')
      setStreamData(null)
      setStreamStats({
        active: false,
        downloadSpeed: 0,
        uploadSpeed: 0,
        numPeers: 0,
        progress: 0,
        downloaded: 0,
        length: 0
      })
      setError(null)
    }
  }, [])

  // Open stream in external player (e.g. VLC)
  const openExternal = useCallback(async (url) => {
    try {
      if (window.ipcRenderer) {
        await window.ipcRenderer.invoke('stream-open-external', url || streamData?.streamUrl)
      }
    } catch (err) {
      console.error('[useTorrentStream] openExternal error:', err)
    }
  }, [streamData])

  // Promote current stream to persistent download
  const promoteToDownload = useCallback(async (destinationPath) => {
    try {
      if (!window.ipcRenderer) throw new Error('IPC renderer not available')
      const result = await window.ipcRenderer.invoke('stream-promote-to-download', { destinationPath })
      return result
    } catch (err) {
      console.error('[useTorrentStream] promoteToDownload error:', err)
      throw err
    }
  }, [])

  // Reset to initial state
  const reset = useCallback(() => {
    stopStream()
    setTorrentInfo(null)
    setError(null)
    setStatus('idle')
  }, [stopStream])

  return {
    status,
    torrentInfo,
    streamData,
    streamStats,
    error,
    parseTorrent,
    startStream,
    stopStream,
    openExternal,
    promoteToDownload,
    reset,
    setTorrentInfo,
    setStatus
  }
}
