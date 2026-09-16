import React, { useState, useEffect, useRef } from 'react'
import { useTorrentStream } from '../../hooks/useTorrentStream'
import TorrentSourceInput from './TorrentSourceInput'
import StreamFilePicker from './StreamFilePicker'
import StreamCinemaPlayer from './StreamCinemaPlayer'
import StreamTelemetryBar from './StreamTelemetryBar'
import { AlertTriangle, X, Check } from 'lucide-react'

export default function StreamView({ activeTorrents = [], streamRequest }) {
  const {
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
    reset
  } = useTorrentStream()

  const [notification, setNotification] = useState(null)
  const lastRequestRef = useRef(0)

  // Search tab can hand off a magnet to stream instantly
  useEffect(() => {
    if (streamRequest?.magnet && streamRequest.ts !== lastRequestRef.current) {
      lastRequestRef.current = streamRequest.ts
      parseTorrent(streamRequest.magnet).catch(() => { })
    }
  }, [streamRequest, parseTorrent])

  const showNotification = (msg, type = 'success') => {
    setNotification({ msg, type })
    setTimeout(() => {
      setNotification(null)
    }, 4000)
  }

  const handlePromote = async () => {
    try {
      if (!window.ipcRenderer) return
      const folder = await window.ipcRenderer.invoke('select-folder')
      if (!folder) return

      await promoteToDownload(folder)
      showNotification('Torrent added to active transfers queue! Downloading in background.')
    } catch (err) {
      console.error('Failed to promote stream to download:', err)
      showNotification('Failed to save torrent to downloads.', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="glass-panel px-4 py-3 rounded-2xl border border-border shadow-2xl flex items-center gap-3 bg-background/90 backdrop-blur-xl">
            {notification.type === 'success' ? (
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                <Check size={16} />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center">
                <AlertTriangle size={16} />
              </div>
            )}
            <span className="text-xs font-semibold text-foreground">{notification.msg}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-muted-foreground hover:text-foreground ml-2"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Error Alert Card */}
      {error && (
        <div className="max-w-4xl mx-auto p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-between text-xs animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={reset}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 font-semibold transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Main Streaming Views */}
      {(status === 'idle' || status === 'parsing') && (
        <TorrentSourceInput
          onSelectSource={parseTorrent}
          onCancel={reset}
          isLoading={status === 'parsing'}
          activeTorrents={activeTorrents}
        />
      )}

      {status === 'ready' && torrentInfo && (
        <StreamFilePicker
          torrentInfo={torrentInfo}
          onSelectFile={(index) => startStream(torrentInfo.infoHash, index)}
          onCancel={reset}
        />
      )}

      {status === 'streaming' && streamData && (
        <div className="max-w-6xl mx-auto space-y-4 animate-in fade-in duration-500">
          <StreamTelemetryBar
            stats={streamStats}
            streamData={streamData}
            onOpenExternal={openExternal}
            onPromoteToDownload={streamData.isLocal ? undefined : handlePromote}
            onStop={stopStream}
          />

          <StreamCinemaPlayer
            streamData={streamData}
            torrentInfo={torrentInfo}
            streamStats={streamStats}
            onSwitchFile={(index) => startStream(torrentInfo.infoHash, index)}
            onOpenExternal={openExternal}
          />
        </div>
      )}
    </div>
  )
}
