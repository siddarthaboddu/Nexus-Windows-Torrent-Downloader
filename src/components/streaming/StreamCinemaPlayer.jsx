import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Loader2,
  ListVideo,
  ExternalLink,
  AlertCircle
} from 'lucide-react'
import clsx from 'clsx'

const formatTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
  }
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
}

export default function StreamCinemaPlayer({
  streamData,
  torrentInfo,
  onSwitchFile,
  onOpenExternal
}) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const controlsTimeoutRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [bufferedPercent, setBufferedPercent] = useState(0)
  const [isBuffering, setIsBuffering] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showRateMenu, setShowRateMenu] = useState(false)
  const [showFileDrawer, setShowFileDrawer] = useState(false)
  const [playbackError, setPlaybackError] = useState(null)

  // Auto-hide controls after user inactivity
  const handleUserActivity = useCallback(() => {
    setShowControls(true)
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current)
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false)
        setShowRateMenu(false)
      }, 2500)
    }
  }, [isPlaying])

  useEffect(() => {
    if (!isPlaying) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
      return
    }

    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false)
      setShowRateMenu(false)
    }, 2500)

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    }
  }, [isPlaying])

  // Video event handlers
  const handleTimeUpdate = () => {
    if (!videoRef.current) return
    setCurrentTime(videoRef.current.currentTime)

    // Calculate buffered percentage
    const buffered = videoRef.current.buffered
    if (buffered.length > 0) {
      const end = buffered.end(buffered.length - 1)
      const dur = videoRef.current.duration
      if (dur > 0) {
        setBufferedPercent(Math.min((end / dur) * 100, 100))
      }
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0)
      setIsBuffering(false)
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(false)
      })
    }
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play().then(() => setIsPlaying(true)).catch((e) => {
        console.warn('Playback error:', e)
      })
    }
    handleUserActivity()
  }

  const seek = (time) => {
    if (!videoRef.current) return
    const target = Math.max(0, Math.min(time, duration))
    videoRef.current.currentTime = target
    setCurrentTime(target)
    handleUserActivity()
  }

  const handleSeekChange = (e) => {
    const percent = parseFloat(e.target.value)
    if (duration > 0) {
      seek((percent / 100) * duration)
    }
  }

  const skipSeconds = (offset) => {
    if (videoRef.current) {
      seek(videoRef.current.currentTime + offset)
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (videoRef.current) {
      videoRef.current.volume = val
      videoRef.current.muted = val === 0
      setIsMuted(val === 0)
    }
  }

  const changePlaybackRate = (rate) => {
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
    setShowRateMenu(false)
    handleUserActivity()
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch(console.error)
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch(console.error)
    }
  }

  const togglePiP = async () => {
    if (!videoRef.current) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await videoRef.current.requestPictureInPicture()
      }
    } catch (e) {
      console.warn('PiP error:', e)
    }
  }

  // Ref wrapper for keyboard controls to avoid reattaching global event listener
  const handlersRef = useRef({
    togglePlay,
    skipSeconds,
    toggleMute,
    toggleFullscreen
  })
  useEffect(() => {
    handlersRef.current = {
      togglePlay,
      skipSeconds,
      toggleMute,
      toggleFullscreen
    }
  })

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't interfere if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault()
          handlersRef.current.togglePlay()
          break
        case 'arrowleft':
        case 'j':
          e.preventDefault()
          handlersRef.current.skipSeconds(-10)
          break
        case 'arrowright':
        case 'l':
          e.preventDefault()
          handlersRef.current.skipSeconds(10)
          break
        case 'arrowup':
          e.preventDefault()
          setVolume((v) => {
            const nv = Math.min(1, v + 0.1)
            if (videoRef.current) videoRef.current.volume = nv
            return nv
          })
          break
        case 'arrowdown':
          e.preventDefault()
          setVolume((v) => {
            const nv = Math.max(0, v - 0.1)
            if (videoRef.current) videoRef.current.volume = nv
            return nv
          })
          break
        case 'f':
          e.preventDefault()
          handlersRef.current.toggleFullscreen()
          break
        case 'm':
          e.preventDefault()
          handlersRef.current.toggleMute()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const videoFiles = torrentInfo?.files?.filter((f) => f.isVideo) || []

  return (
    <div
      ref={containerRef}
      onMouseMove={handleUserActivity}
      className={clsx(
        "relative rounded-3xl overflow-hidden bg-black aspect-video flex items-center justify-center select-none shadow-2xl border border-border/80 group",
        isFullscreen && "rounded-none w-screen h-screen border-none"
      )}
    >
      {/* HTML5 Video Element */}
      <video
        ref={videoRef}
        src={streamData.streamUrl}
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false)
          setPlaybackError(null)
        }}
        onError={(e) => {
          console.warn('[VideoPlayer] Playback Error:', e)
          setIsBuffering(false)
          setPlaybackError('Your browser/Chromium cannot decode this video or audio codec directly.')
        }}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
      />

      {/* Buffering Indicator */}
      {isBuffering && !playbackError && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs gap-3">
          <div className="w-16 h-16 rounded-full bg-background/80 backdrop-blur-md flex items-center justify-center shadow-2xl border border-border/50">
            <Loader2 size={32} className="text-primary animate-spin" />
          </div>
          <p className="text-white text-xs font-semibold tracking-wider uppercase drop-shadow-md bg-black/60 px-3 py-1 rounded-full">
            Buffering from Swarm...
          </p>
        </div>
      )}

      {/* Playback Error Fallback Card */}
      {playbackError && (
        <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center gap-4 z-30">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
            <AlertCircle size={30} />
          </div>
          <div className="max-w-md space-y-1">
            <h3 className="text-lg font-bold text-foreground">External Playback Recommended</h3>
            <p className="text-xs text-muted-foreground">{playbackError}</p>
            <p className="text-xs text-muted-foreground mt-2">
              The BitTorrent swarm stream is working properly at <span className="font-mono text-primary font-medium">{streamData.streamUrl}</span>.
            </p>
          </div>
          <button
            onClick={() => onOpenExternal(streamData.streamUrl)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-blue-600 text-white font-semibold text-sm shadow-lg shadow-blue-500/25 transition-all active:scale-95"
          >
            <ExternalLink size={16} />
            <span>Open in VLC or Default Player</span>
          </button>
        </div>
      )}

      {/* Center Play Button Overlay on Pause */}
      {!isPlaying && !isBuffering && !playbackError && (
        <button
          onClick={togglePlay}
          className="absolute inset-auto w-20 h-20 rounded-full bg-primary/90 hover:bg-primary text-white flex items-center justify-center shadow-2xl shadow-blue-500/50 backdrop-blur-md transition-transform transform hover:scale-110 active:scale-95 z-20"
        >
          <Play size={36} className="fill-current ml-1" />
        </button>
      )}

      {/* Video Title Header Overlay */}
      <div
        className={clsx(
          "absolute top-0 inset-x-0 p-5 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between transition-opacity duration-300 pointer-events-auto z-20",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="min-w-0 pr-4">
          <h4 className="text-white text-sm font-semibold truncate drop-shadow-md">{streamData.fileName}</h4>
          <p className="text-white/70 text-xs truncate drop-shadow-md">{torrentInfo?.name}</p>
        </div>

        {videoFiles.length > 1 && (
          <button
            onClick={() => setShowFileDrawer(!showFileDrawer)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 hover:bg-black/80 text-white text-xs font-semibold border border-white/20 backdrop-blur-md transition-colors"
          >
            <ListVideo size={14} />
            <span>Files ({videoFiles.length})</span>
          </button>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div
        className={clsx(
          "absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent transition-opacity duration-300 z-20",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {/* Timeline Scrubber */}
        <div className="relative mb-3 flex items-center group/timeline">
          {/* Buffer Bar */}
          <div className="absolute inset-x-0 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/40 transition-all duration-300"
              style={{ width: `${bufferedPercent}%` }}
            />
          </div>

          {/* Played Progress Bar */}
          <div
            className="absolute left-0 h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full pointer-events-none"
            style={{ width: `${playedPercent}%` }}
          />

          {/* Interactive Range Input */}
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={playedPercent || 0}
            onChange={handleSeekChange}
            className="w-full h-4 opacity-0 cursor-pointer z-10"
          />
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between text-white text-xs">
          {/* Left Controls: Play, Skip, Time */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current" />}
            </button>

            <button
              onClick={() => skipSeconds(-10)}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title="Skip -10s"
            >
              <RotateCcw size={16} />
            </button>

            <button
              onClick={() => skipSeconds(10)}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title="Skip +10s"
            >
              <RotateCw size={16} />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/volume">
              <button
                onClick={toggleMute}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-white/30 rounded-full accent-primary cursor-pointer transition-all"
              />
            </div>

            {/* Time Stamp */}
            <div className="font-mono text-white/90 text-xs ml-2 select-none">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          {/* Right Controls: Speed, PiP, Fullscreen */}
          <div className="flex items-center gap-2 relative">
            {/* Speed Selector */}
            <div className="relative">
              <button
                onClick={() => setShowRateMenu(!showRateMenu)}
                className="px-2 py-1 hover:bg-white/20 rounded-lg text-xs font-semibold transition-colors"
              >
                {playbackRate}x
              </button>
              {showRateMenu && (
                <div className="absolute bottom-8 right-0 bg-secondary/90 backdrop-blur-xl border border-border/80 rounded-xl py-1 shadow-2xl z-30 min-w-[70px]">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => changePlaybackRate(rate)}
                      className={clsx(
                        "w-full text-left px-3 py-1 text-xs hover:bg-primary/30 transition-colors",
                        playbackRate === rate ? "text-primary font-bold" : "text-foreground"
                      )}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Picture-in-Picture */}
            {document.pictureInPictureEnabled && (
              <button
                onClick={togglePiP}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                title="Picture in Picture"
              >
                <PictureInPicture2 size={16} />
              </button>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Playlist / File Switcher Drawer */}
      {showFileDrawer && (
        <div className="absolute inset-y-0 right-0 w-80 bg-background/95 backdrop-blur-xl border-l border-border p-4 shadow-2xl z-30 flex flex-col gap-3 animate-in slide-in-from-right duration-300">
          <div className="flex items-center justify-between pb-2 border-b border-border/60">
            <h4 className="text-sm font-bold text-foreground">Episodes & Files</h4>
            <button
              onClick={() => setShowFileDrawer(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {videoFiles.map((f) => (
              <div
                key={f.index}
                onClick={() => {
                  if (f.index !== streamData.fileIndex) {
                    onSwitchFile(f.index)
                  }
                  setShowFileDrawer(false)
                }}
                className={clsx(
                  "p-2.5 rounded-xl cursor-pointer text-xs transition-all flex items-center justify-between gap-2 border",
                  f.index === streamData.fileIndex
                    ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                    : "bg-secondary/40 text-foreground border-transparent hover:bg-secondary/80"
                )}
              >
                <span className="truncate flex-1">{f.name}</span>
                {f.index === streamData.fileIndex && (
                  <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 animate-pulse" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
