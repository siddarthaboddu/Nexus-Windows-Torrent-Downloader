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
  AlertCircle,
  Captions,
  CaptionsOff,
  Upload,
  Check,
  Cast,
  Copy,
  Gauge,
  Languages
} from 'lucide-react'
import clsx from 'clsx'

// Client-side SRT -> WebVTT (Chromium <track> only understands WebVTT)
const convertSrtToVtt = (text) => {
  let normalized = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '')
  normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  if (/^WEBVTT/m.test(normalized)) return normalized
  return `WEBVTT\n\n${normalized.trim()}\n`
}

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

const GATE_SECONDS = 12 // start playback only with this much contiguous buffer
const GATE_TIMEOUT_MS = 45000 // ...or after this long, whichever comes first
const PREBUFFER_SECONDS = 15 * 60 // opt-in deep buffer: pause and fill this far ahead, then auto-resume
const RESUME_KEY = (h, i) => `nexus:pos:${h}:${i}`

const loadSavedPosition = (infoHash, fileIndex) => {
  try {
    const raw = localStorage.getItem(RESUME_KEY(infoHash, fileIndex))
    if (!raw) return null
    const { t, d } = JSON.parse(raw)
    return (typeof t === 'number' && t > 10) ? { t, d } : null
  } catch {
    return null
  }
}

const savePosition = (infoHash, fileIndex, t, d) => {
  try {
    localStorage.setItem(RESUME_KEY(infoHash, fileIndex), JSON.stringify({ t, d, ts: Date.now() }))
  } catch {
    // private mode / quota — resume is best-effort
  }
}

const clearSavedPosition = (infoHash, fileIndex) => {
  try {
    localStorage.removeItem(RESUME_KEY(infoHash, fileIndex))
  } catch {
    // best-effort: stale resume entries are harmless
  }
}

const isTimeBuffered = (video, t) => {
  try {
    const b = video.buffered
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) && t <= b.end(i)) return true
    }
  } catch {
    // video not ready — treat as unbuffered
  }
  return false
}

// Contiguous buffered seconds ahead of the playhead + total buffered %.
const bufferInfo = (video) => {
  try {
    const b = video.buffered
    const now = video.currentTime || 0
    const dur = video.duration || 0
    let ahead = 0
    let total = 0
    for (let i = 0; i < b.length; i++) {
      const s = b.start(i)
      const e = b.end(i)
      total += Math.max(0, e - s)
      if (now >= s && now <= e) ahead = Math.max(0, e - now)
    }
    return { ahead, pct: dur > 0 ? Math.min((total / dur) * 100, 100) : 0 }
  } catch {
    return { ahead: 0, pct: 0 }
  }
}

export default function StreamCinemaPlayer({
  streamData,
  torrentInfo,
  streamStats = {},
  onSwitchFile,
  onOpenExternal
}) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const controlsTimeoutRef = useRef(null)
  const gateTimerRef = useRef(null)
  const savePosRef = useRef(0)
  const lastUiBufferRef = useRef({ ahead: 0, pct: 0, at: 0 })
  const cueBaseRef = useRef(new Map()) // trackId -> [{ cue, start, end }]
  const subtitleDelayRef = useRef(0)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [bufferedPercent, setBufferedPercent] = useState(0)
  const [bufferAhead, setBufferAhead] = useState(0) // contiguous seconds ahead of playhead
  const [isBuffering, setIsBuffering] = useState(true)
  const [isGating, setIsGating] = useState(true) // buffer-gated autoplay
  const [waitingForPieces, setWaitingForPieces] = useState(false)
  const [prebuffering, setPrebuffering] = useState(false) // deep 15-min buffer mode
  const [autoplayNext, setAutoplayNext] = useState(true)
  const [resumeNote, setResumeNote] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showRateMenu, setShowRateMenu] = useState(false)
  const [showFileDrawer, setShowFileDrawer] = useState(false)
  const [playbackError, setPlaybackError] = useState(null)
  const [showStats, setShowStats] = useState(false)
  const [audioTracks, setAudioTracks] = useState([]) // { index, label, language, enabled }
  const [showAudioMenu, setShowAudioMenu] = useState(false)
  const [subtitleDelay, setSubtitleDelay] = useState(0) // seconds, -5..+5
  const [subtitleSize, setSubtitleSize] = useState('m') // s | m | l
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false)
  const [showCastMenu, setShowCastMenu] = useState(false)
  const [lanIp, setLanIp] = useState(null) // null = not fetched, false = unavailable
  const [copiedLan, setCopiedLan] = useState(false)
  const [uploadedSubs, setUploadedSubs] = useState([]) // { id, label, url }
  const [activeSubtitle, setActiveSubtitle] = useState('off') // 'off' | subtitle url | uploaded id
  const subtitleInputRef = useRef(null)

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
        setShowSubtitleMenu(false)
        setShowCastMenu(false)
        setShowAudioMenu(false)
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
      setShowSubtitleMenu(false)
      setShowCastMenu(false)
      setShowAudioMenu(false)
    }, 2500)

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    }
  }, [isPlaying])

  // Push buffer UI state only on material change: progress/timeupdate fire
  // constantly during a live download and naive setState each event
  // re-renders the whole player tree (jank mistaken for stream lag).
  const pushBufferState = useCallback((ahead, pct, force = false) => {
    const prev = lastUiBufferRef.current
    const now = Date.now()
    if (!force
      && Math.abs(ahead - prev.ahead) < 0.5
      && Math.abs(pct - prev.pct) < 1
      && now - prev.at < 1000) return
    lastUiBufferRef.current = { ahead, pct, at: now }
    setBufferAhead(ahead)
    setBufferedPercent(pct)
  }, [])

  // Video event handlers
  const tryPlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.play().then(() => {
      setIsPlaying(true)
      setIsBuffering(false)
      setIsGating(false)
      setWaitingForPieces(false)
    }).catch((e) => {
      console.warn('Playback blocked:', e)
      setIsPlaying(false)
    })
  }, [])

  const ungateAndPlay = useCallback(() => {
    if (gateTimerRef.current) {
      clearTimeout(gateTimerRef.current)
      gateTimerRef.current = null
    }
    setIsGating(false)
    setWaitingForPieces(false)
    tryPlay()
  }, [tryPlay])

  // Opt-in deep buffer: pause and let the swarm fill up to 15 min ahead of
  // the playhead, then resume automatically. The torrent keeps downloading
  // while the video is paused, so this trades one wait for smooth playback.
  const startPrebuffer = useCallback(() => {
    const video = videoRef.current
    if (video) { try { video.pause() } catch { /* already paused */ } }
    if (gateTimerRef.current) {
      clearTimeout(gateTimerRef.current)
      gateTimerRef.current = null
    }
    setIsGating(false)
    setIsBuffering(false)
    setWaitingForPieces(false)
    setIsPlaying(false)
    setPrebuffering(true)
  }, [])

  const cancelPrebuffer = useCallback(() => {
    setPrebuffering(false)
  }, [])

  useEffect(() => {
    if (!prebuffering) return
    const id = setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const { ahead, pct } = bufferInfo(video)
      pushBufferState(ahead, pct, true)
      const dur = video.duration || 0
      const remain = dur - video.currentTime
      const need = Math.min(PREBUFFER_SECONDS, Math.max(0, remain - 5))
      if (need <= GATE_SECONDS || ahead >= need || pct >= 99) {
        setPrebuffering(false)
        const v = videoRef.current
        if (v) {
          v.play().then(() => {
            setIsPlaying(true)
            setIsBuffering(false)
          }).catch(() => setIsPlaying(false))
        }
      }
    }, 1000)
    return () => clearInterval(id)
  }, [prebuffering, pushBufferState])

  const handleTimeUpdate = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const now = video.currentTime
    setCurrentTime(now)

    const { ahead, pct } = bufferInfo(video)
    pushBufferState(ahead, pct)

    // Piece-arrival clears the "waiting" state once the playhead is covered
    if (waitingForPieces && isTimeBuffered(video, now)) {
      setWaitingForPieces(false)
    }

    // Persist resume position (throttled, long-form only)
    const dur = video.duration || 0
    if (dur > 60 && now > 10 && now < dur - 15 && Date.now() - savePosRef.current > 5000) {
      savePosRef.current = Date.now()
      savePosition(streamData?.infoHash, streamData?.fileIndex, now, dur)
    }
  }

  const handleProgress = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const { ahead, pct } = bufferInfo(video)
    pushBufferState(ahead, pct)

    const dur = video.duration || 0
    const enough = ahead >= GATE_SECONDS
      || pct >= 90
      || (dur > 0 && dur < 30 && pct >= 50)
    if (isGating && enough && !playbackError && !prebuffering) {
      ungateAndPlay()
    }
    if (waitingForPieces && isTimeBuffered(video, video.currentTime)) {
      setWaitingForPieces(false)
    }
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    const dur = video.duration || 0
    setDuration(dur)

    // Fresh stream: gate autoplay until enough contiguous buffer arrives
    setIsGating(true)
    setIsBuffering(true)
    setWaitingForPieces(false)
    setBufferAhead(0)
    setBufferedPercent(0)
    setResumeNote(null)
    cueBaseRef.current = new Map()

    // Resume where we left off (long-form only, not near the end)
    const saved = loadSavedPosition(streamData?.infoHash, streamData?.fileIndex)
    if (saved && dur > 60 && saved.t < dur - 15) {
      try { video.currentTime = saved.t } catch {
        // seeking before data arrives — playback starts from 0 instead
      }
      setCurrentTime(saved.t)
      setResumeNote(`Resumed from ${formatTime(saved.t)}`)
      setTimeout(() => setResumeNote(null), 4000)
    }

    // Multi-audio detection (progressive enhancement — unsupported = no menu)
    try {
      const at = video.audioTracks
      if (at && at.length > 1) {
        setAudioTracks(Array.from({ length: at.length }, (_, i) => ({
          index: i,
          label: at[i].label || `Track ${i + 1}`,
          language: at[i].language || '',
          enabled: !!at[i].enabled
        })))
      } else {
        setAudioTracks([])
      }
    } catch {
      setAudioTracks([])
    }

    // Fallback: never gate longer than the timeout
    if (gateTimerRef.current) clearTimeout(gateTimerRef.current)
    gateTimerRef.current = setTimeout(() => {
      gateTimerRef.current = null
      ungateAndPlay()
    }, GATE_TIMEOUT_MS)
  }

  const handleEnded = () => {
    setIsPlaying(false)
    clearSavedPosition(streamData?.infoHash, streamData?.fileIndex)
    if (!autoplayNext) return
    const files = (torrentInfo?.files || []).filter((f) => f.isVideo).sort((a, b) => a.index - b.index)
    const pos = files.findIndex((f) => f.index === streamData?.fileIndex)
    const next = pos >= 0 ? files[pos + 1] : null
    if (next && onSwitchFile) {
      onSwitchFile(next.index)
    }
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      setPrebuffering(false) // manual play overrides deep-buffer mode
      videoRef.current.play().then(() => setIsPlaying(true)).catch((e) => {
        console.warn('Playback error:', e)
      })
    }
    handleUserActivity()
  }

  const seek = (time) => {
    if (!videoRef.current) return
    const target = Math.max(0, Math.min(time, duration))
    const jumpingToSparse = !isTimeBuffered(videoRef.current, target)
    videoRef.current.currentTime = target
    setCurrentTime(target)
    if (jumpingToSparse && isGating === false) {
      setWaitingForPieces(true)
      setIsBuffering(true)
    }
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
  const toggleCaptions = () => {
    setActiveSubtitle((prev) => {
      if (prev !== 'off') return 'off'
      const first = (streamData?.subtitles || [])[0]?.url || uploadedSubs[0]?.id
      return first || 'off'
    })
  }
  const handlersRef = useRef({
    togglePlay,
    skipSeconds,
    toggleMute,
    toggleFullscreen,
    toggleCaptions
  })
  useEffect(() => {
    handlersRef.current = {
      togglePlay,
      skipSeconds,
      toggleMute,
      toggleFullscreen,
      toggleCaptions
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
        case 'c':
          e.preventDefault()
          handlersRef.current.toggleCaptions()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ---- Subtitles (sidecar .srt/.vtt/.ass from torrent + manual upload) ----
  // Note: embedded MKV/MP4 subtitle tracks are ignored by Chromium and
  // remain a VLC-only path via "Open in VLC".
  const torrentSubs = streamData?.subtitles || []
  const allSubtitleTracks = [
    ...torrentSubs.map((s) => ({ id: s.url, label: s.label, lang: s.lang, url: s.url, kind: 'torrent' })),
    ...uploadedSubs
  ]

  // Default to first torrent subtitle when a new stream starts.
  // Uploaded subs are kept across file switches; blob URLs are revoked on unmount.
  const uploadedSubsRef = useRef([])
  uploadedSubsRef.current = uploadedSubs
  useEffect(() => {
    setActiveSubtitle(torrentSubs.length > 0 ? torrentSubs[0].url : 'off')
    setShowSubtitleMenu(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamData?.streamUrl])

  useEffect(() => {
    return () => {
      uploadedSubsRef.current.forEach((t) => {
        try { URL.revokeObjectURL(t.url) } catch (e) { console.warn('[Subtitles] Revoke failed:', e) }
      })
    }
  }, [])

  // Shift all sidecar cue timings by the chosen delay (VTTCues are mutable).
  // Declared above the effects that consume it so dep arrays stay honest.
  const applySubtitleDelay = useCallback((offset) => {
    const video = videoRef.current
    if (!video) return
    const els = video.querySelectorAll('track')
    els.forEach((el) => {
      const track = el.track
      if (!track || !track.cues) return
      const id = el.getAttribute('data-track-id')
      if (!cueBaseRef.current.has(id)) {
        try {
          cueBaseRef.current.set(id, Array.from(track.cues).map((c) => ({ cue: c, start: c.startTime, end: c.endTime })))
        } catch {
          return
        }
      }
      cueBaseRef.current.get(id).forEach(({ cue, start, end }) => {
        try {
          cue.startTime = Math.max(0, start + offset)
          cue.endTime = Math.max(0.2, end + offset)
        } catch {
          // read-only cue in this browser — offset skipped for it
        }
      })
    })
  }, [])

  // Apply selection to the underlying TextTrackList (<track default> alone
  // does not switch after load)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !video.textTracks) return
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i]
      const trackEl = video.querySelectorAll('track')[i]
      const trackId = trackEl?.getAttribute('data-track-id')
      track.mode = activeSubtitle !== 'off' && trackId === activeSubtitle ? 'showing' : 'disabled'
    }
    // Cues load async — re-apply the sync offset once they're present
    applySubtitleDelay(subtitleDelayRef.current)
  }, [activeSubtitle, allSubtitleTracks.length, streamData?.streamUrl, applySubtitleDelay])

  const handleSubtitleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const vtt = /\.vtt$/i.test(file.name) ? convertSrtToVtt(text) : convertSrtToVtt(text)
      const blob = new Blob([vtt], { type: 'text/vtt' })
      const url = URL.createObjectURL(blob)
      const id = `upload-${Date.now()}`
      const entry = { id, label: `${file.name} (custom)`, lang: 'custom', url, kind: 'upload' }
      setUploadedSubs((prev) => [...prev, entry])
      setActiveSubtitle(id)
    } catch (err) {
      console.warn('[Subtitles] Failed to load custom subtitle:', err)
    } finally {
      if (subtitleInputRef.current) subtitleInputRef.current.value = ''
      setShowSubtitleMenu(false)
      handleUserActivity()
    }
  }

  const subtitlesOn = activeSubtitle !== 'off'

  useEffect(() => {
    subtitleDelayRef.current = subtitleDelay
    applySubtitleDelay(subtitleDelay)
  }, [subtitleDelay, applySubtitleDelay])

  // Live stats ticker (refreshes dropped-frame + resolution reads)
  useEffect(() => {
    if (!showStats) return
    const id = setInterval(() => {
      if (videoRef.current) {
        const { ahead, pct } = bufferInfo(videoRef.current)
        pushBufferState(ahead, pct, true)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [showStats, pushBufferState])

  // Reset per-stream playback state (delay/size prefs survive file switches)
  useEffect(() => {
    setWaitingForPieces(false)
    setPrebuffering(false)
    setBufferAhead(0)
    setAudioTracks([])
    setShowAudioMenu(false)
    setResumeNote(null)
    return () => {
      if (gateTimerRef.current) {
        clearTimeout(gateTimerRef.current)
        gateTimerRef.current = null
      }
    }
  }, [streamData?.streamUrl])

  const selectAudioTrack = (index) => {
    const video = videoRef.current
    try {
      const at = video?.audioTracks
      if (at) {
        for (let i = 0; i < at.length; i++) at[i].enabled = (i === index)
        setAudioTracks(Array.from({ length: at.length }, (_, i) => ({
          index: i,
          label: at[i].label || `Track ${i + 1}`,
          language: at[i].language || '',
          enabled: i === index
        })))
      }
    } catch (e) {
      console.warn('[Audio] Switch failed:', e)
    }
    setShowAudioMenu(false)
    handleUserActivity()
  }

  // Slow-swarm + stall messaging from existing telemetry
  const swarmSpeed = streamStats.downloadSpeed || 0
  const swarmPeers = streamStats.numPeers || 0
  const swarmDead = swarmPeers === 0
  const swarmSlow = !swarmDead && swarmSpeed < 50 * 1024
  const stalled = waitingForPieces || swarmDead || swarmSlow
  const prebufferNeed = Math.min(PREBUFFER_SECONDS, Math.max(0, (duration - currentTime) - 5))
  const stallMessage = waitingForPieces
    ? 'Waiting for pieces…'
    : isGating
      ? `Preparing stream… ${Math.round(bufferedPercent)}%`
      : swarmDead
        ? 'Waiting for peers…'
        : 'Buffering from Swarm…'
  const stallHint = waitingForPieces
    ? 'You jumped ahead of the download — pieces are on the way.'
    : isGating
      ? 'Playback starts automatically with enough buffer.'
      : swarmDead
        ? 'No peers connected yet. The stream starts when the swarm responds.'
        : swarmSlow
          ? 'Slow swarm — leave it buffering or open in VLC.'
          : null

  const playbackQuality = (() => {
    if (!showStats) return null
    try {
      const q = videoRef.current?.getVideoPlaybackQuality?.()
      return q ? { dropped: q.droppedVideoFrames, total: q.totalVideoFrames } : null
    } catch {
      return null
    }
  })()

  const cueFontSize = subtitleSize === 's' ? '0.8em' : subtitleSize === 'l' ? '1.15em' : '0.95em'

  // ---- Cast / other-device playback ----
  // The stream URL is loopback-only unless LAN sharing is enabled in Settings.
  const openCastMenu = async () => {
    const next = !showCastMenu
    setShowCastMenu(next)
    if (next && lanIp === null && window.ipcRenderer) {
      try {
        setLanIp(await window.ipcRenderer.invoke('get-lan-ip'))
      } catch {
        setLanIp(false)
      }
    }
    handleUserActivity()
  }
  const lanUrl = lanIp && streamData?.streamUrl
    ? streamData.streamUrl.replace('127.0.0.1', lanIp)
    : null
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedLan(true)
      setTimeout(() => setCopiedLan(false), 1500)
    } catch (e) {
      console.warn('[Cast] Copy failed:', e)
    }
  }

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
      <style>{`video::cue { background: rgba(0,0,0,0.7); color: #fff; font-size: ${cueFontSize}; }`}</style>
      <video
        ref={videoRef}
        key={streamData.streamUrl}
        src={streamData.streamUrl}
        crossOrigin="anonymous"
        onClick={togglePlay}
        onTimeUpdate={handleTimeUpdate}
        onProgress={handleProgress}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false)
          setPlaybackError(null)
          setIsGating(false)
          setWaitingForPieces(false)
          if (gateTimerRef.current) {
            clearTimeout(gateTimerRef.current)
            gateTimerRef.current = null
          }
        }}
        onError={(e) => {
          console.warn('[VideoPlayer] Playback Error:', e)
          setIsBuffering(false)
          setPlaybackError('Your browser/Chromium cannot decode this video or audio codec directly.')
        }}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
      >
        {allSubtitleTracks.map((t) => (
          <track
            key={t.id}
            data-track-id={t.id}
            kind="subtitles"
            src={t.url}
            srcLang={t.lang || 'und'}
            label={t.label}
          />
        ))}
      </video>

      {/* Buffering / Gating / Pre-buffering Indicator */}
      {(isBuffering || isGating || prebuffering) && !playbackError && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs gap-3">
          <div className="w-16 h-16 rounded-full bg-background/80 backdrop-blur-md flex items-center justify-center shadow-2xl border border-border/50">
            <Loader2 size={32} className="text-primary animate-spin" />
          </div>
          {prebuffering ? (
            <>
              <p className="text-white text-xs font-semibold tracking-wider uppercase drop-shadow-md bg-black/60 px-3 py-1 rounded-full">
                Pre-buffering {formatTime(bufferAhead)} / {formatTime(prebufferNeed)}
              </p>
              <p className="text-white/80 text-[11px] drop-shadow-md bg-black/60 px-3 py-1 rounded-full max-w-md text-center">
                The download keeps running while paused — playback resumes automatically at 15 min ahead.
              </p>
              <button
                onClick={cancelPrebuffer}
                className="pointer-events-auto px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold backdrop-blur-md transition-all active:scale-95"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="text-white text-xs font-semibold tracking-wider uppercase drop-shadow-md bg-black/60 px-3 py-1 rounded-full">
                {stallMessage}
              </p>
              {stallHint && (
                <p className="text-white/80 text-[11px] drop-shadow-md bg-black/60 px-3 py-1 rounded-full max-w-md text-center">
                  {stallHint}
                </p>
              )}
              {isGating && (
                <button
                  onClick={ungateAndPlay}
                  className="pointer-events-auto px-4 py-1.5 rounded-full bg-primary hover:bg-blue-600 text-white text-xs font-semibold shadow-lg transition-all active:scale-95"
                >
                  Play now
                </button>
              )}
              {!isGating && stalled && (
                <div className="flex items-center gap-2 pointer-events-auto">
                  <button
                    onClick={startPrebuffer}
                    className="px-4 py-1.5 rounded-full bg-primary hover:bg-blue-600 text-white text-xs font-semibold shadow-lg transition-all active:scale-95"
                  >
                    Pre-buffer 15 min
                  </button>
                  <button
                    onClick={() => onOpenExternal(streamData.streamUrl)}
                    className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold backdrop-blur-md transition-all active:scale-95"
                  >
                    Open in VLC instead
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Resume notice */}
      {resumeNote && !playbackError && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <p className="text-white text-xs font-semibold bg-black/70 px-3 py-1.5 rounded-full border border-white/10">
            {resumeNote}
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
      {!isPlaying && !isBuffering && !playbackError && !prebuffering && (
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

      {/* Stats-for-nerds overlay */}
      {showStats && (
        <div className="absolute top-20 left-4 z-20 bg-black/70 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 font-mono text-[11px] text-white/90 space-y-0.5 pointer-events-none">
          <p>Video: {videoRef.current?.videoWidth || '?'}×{videoRef.current?.videoHeight || '?'} · {streamData.mimeType || 'video'}</p>
          <p>Buffered ahead: {Math.round(bufferAhead)}s ({Math.round(bufferedPercent)}%)</p>
          <p>Swarm: {((streamStats.downloadSpeed || 0) / 1024).toFixed(0)} KB/s · {streamStats.numPeers || 0} peers · {Math.round((streamStats.progress || 0) * 100)}%</p>
          {playbackQuality && (
            <p>Dropped frames: {playbackQuality.dropped} / {playbackQuality.total}</p>
          )}
        </div>
      )}

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
            aria-label="Seek"
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
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={18} className="fill-current" /> : <Play size={18} className="fill-current" />}
            </button>

            <button
              onClick={() => skipSeconds(-10)}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title="Skip -10s"
              aria-label="Skip back 10 seconds"
            >
              <RotateCcw size={16} />
            </button>

            <button
              onClick={() => skipSeconds(10)}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title="Skip +10s"
              aria-label="Skip forward 10 seconds"
            >
              <RotateCw size={16} />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-1.5 group/volume">
              <button
                onClick={toggleMute}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                aria-label="Volume"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-white/30 rounded-full accent-primary cursor-pointer transition-all"
              />
            </div>

            {/* Time Stamp */}
            <div className="font-mono text-white/90 text-xs ml-2 select-none flex items-center gap-1.5">
              <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
              {bufferAhead > 1 && (
                <span className="text-[10px] text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-1.5 py-0.5 rounded-full" title="Contiguous video buffered ahead of the playhead">
                  +{Math.round(bufferAhead)}s
                </span>
              )}
            </div>
          </div>

          {/* Right Controls: Cast, Subtitles, Speed, PiP, Fullscreen */}
          <div className="flex items-center gap-2 relative">
            {/* Cast / Other devices */}
            <div className="relative">
              <button
                onClick={openCastMenu}
                className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                title="Watch on another device"
                aria-label="Watch on another device. Activate to open cast options."
              >
                <Cast size={16} />
              </button>
              {showCastMenu && (
                <div className="absolute bottom-9 right-0 bg-secondary/95 backdrop-blur-xl border border-border/80 rounded-xl py-1 shadow-2xl z-30 min-w-[250px] max-w-[320px]">
                  <button
                    onClick={() => copyText(streamData.streamUrl)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center gap-2"
                  >
                    <Copy size={12} />
                    <span>{copiedLan ? 'Copied!' : 'Copy stream URL'}</span>
                  </button>
                  <button
                    onClick={() => { onOpenExternal(streamData.streamUrl); setShowCastMenu(false) }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center gap-2"
                  >
                    <ExternalLink size={12} />
                    <span>Open in browser / default player</span>
                  </button>
                  <div className="border-t border-border/60 mt-1 pt-1 px-3 py-1.5">
                    <p className="text-[11px] font-semibold text-foreground mb-0.5">Phone / TV / another PC</p>
                    {lanUrl ? (
                      <button
                        onClick={() => copyText(lanUrl)}
                        className="text-[11px] text-primary hover:underline font-mono break-all text-left"
                        title="Click to copy"
                      >
                        {lanUrl}
                      </button>
                    ) : (
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        {lanIp === false
                          ? 'No LAN address found on this PC.'
                          : 'Enable LAN Sharing in Settings, then point VLC (or any player) on the other device at the address shown here.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* Audio tracks (multi-audio files only) */}
            {audioTracks.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => setShowAudioMenu(!showAudioMenu)}
                  className="p-2 hover:bg-white/20 rounded-xl transition-colors"
                  title="Audio track"
                  aria-label="Choose audio track"
                >
                  <Languages size={16} />
                </button>
                {showAudioMenu && (
                  <div className="absolute bottom-9 right-0 bg-secondary/95 backdrop-blur-xl border border-border/80 rounded-xl py-1 shadow-2xl z-30 min-w-[180px]">
                    {audioTracks.map((t) => (
                      <button
                        key={t.index}
                        onClick={() => selectAudioTrack(t.index)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="truncate flex-1">
                          {t.label}{t.language ? ` · ${t.language}` : ''}
                        </span>
                        {t.enabled && <Check size={12} className="text-primary flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Stats for nerds */}
            <div className="relative">
              <button
                onClick={() => { setShowStats(!showStats); handleUserActivity() }}
                className={clsx(
                  "p-2 rounded-xl transition-colors",
                  showStats ? "bg-primary/40 text-white" : "hover:bg-white/20"
                )}
                title="Playback statistics"
                aria-label="Toggle playback statistics"
              >
                <Gauge size={16} />
              </button>
            </div>
            {/* Subtitles / CC */}
            <div className="relative">
              <button
                onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                className={clsx(
                  "p-2 rounded-xl transition-colors",
                  subtitlesOn ? "bg-primary/40 text-white" : "hover:bg-white/20"
                )}
                title={subtitlesOn ? 'Subtitles on (C)' : 'Subtitles off (C)'}
                aria-label={subtitlesOn ? 'Subtitles on. Activate to change.' : 'Subtitles off. Activate to change.'}
              >
                {subtitlesOn ? <Captions size={16} /> : <CaptionsOff size={16} className="opacity-60" />}
              </button>
              {showSubtitleMenu && (
                <div className="absolute bottom-9 right-0 bg-secondary/95 backdrop-blur-xl border border-border/80 rounded-xl py-1 shadow-2xl z-30 min-w-[220px] max-w-[300px]">
                  <button
                    onClick={() => { setActiveSubtitle('off'); setShowSubtitleMenu(false); handleUserActivity() }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center justify-between gap-2"
                  >
                    <span>Off</span>
                    {activeSubtitle === 'off' && <Check size={12} className="text-primary" />}
                  </button>
                  {allSubtitleTracks.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setActiveSubtitle(t.id); setShowSubtitleMenu(false); handleUserActivity() }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center justify-between gap-2"
                      title={t.url}
                    >
                      <span className="truncate flex-1">{t.label}</span>
                      {activeSubtitle === t.id && <Check size={12} className="text-primary flex-shrink-0" />}
                    </button>
                  ))}
                  <div className="border-t border-border/60 mt-1 pt-1">
                    <div className="px-3 py-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>Sync offset</span>
                        <span className="font-mono text-foreground">{subtitleDelay > 0 ? `+${subtitleDelay.toFixed(1)}s` : `${subtitleDelay.toFixed(1)}s`}</span>
                      </div>
                      <input
                        type="range"
                        min="-5"
                        max="5"
                        step="0.1"
                        value={subtitleDelay}
                        onChange={(e) => setSubtitleDelay(parseFloat(e.target.value))}
                        className="w-full h-1 bg-white/30 rounded-full accent-primary cursor-pointer"
                        aria-label="Subtitle sync offset in seconds"
                      />
                    </div>
                    <div className="px-3 py-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">Size</span>
                      <div className="flex gap-1">
                        {[
                          { id: 's', label: 'S' },
                          { id: 'm', label: 'M' },
                          { id: 'l', label: 'L' }
                        ].map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSubtitleSize(s.id)}
                            className={clsx(
                              "w-7 h-6 rounded-md text-[11px] font-bold transition-colors",
                              subtitleSize === s.id ? "bg-primary text-white" : "bg-secondary text-muted-foreground hover:text-foreground"
                            )}
                            aria-label={`Subtitle size ${s.label}`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => subtitleInputRef.current?.click()}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-primary/30 transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Upload size={12} />
                      <span>Load .srt / .vtt…</span>
                    </button>
                    <p className="px-3 py-1 text-[10px] text-muted-foreground leading-snug">
                      Embedded MKV subs need VLC via the external-player button.
                    </p>
                  </div>
                </div>
              )}
              <input
                ref={subtitleInputRef}
                type="file"
                accept=".srt,.vtt"
                className="hidden"
                onChange={handleSubtitleUpload}
              />
            </div>
            {/* Speed Selector */}
            <div className="relative">
              <button
                onClick={() => setShowRateMenu(!showRateMenu)}
                className="px-2 py-1 hover:bg-white/20 rounded-lg text-xs font-semibold transition-colors"
                aria-label={`Playback speed ${playbackRate}x. Activate to change.`}
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
                aria-label="Toggle picture in picture"
              >
                <PictureInPicture2 size={16} />
              </button>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/20 rounded-xl transition-colors"
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoplayNext(!autoplayNext)}
                className={clsx(
                  "text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors",
                  autoplayNext ? "bg-primary/20 text-primary border-primary/40" : "text-muted-foreground border-border hover:text-foreground"
                )}
                title="Automatically play the next file when this one ends"
              >
                Autoplay: {autoplayNext ? 'On' : 'Off'}
              </button>
              <button
                onClick={() => setShowFileDrawer(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
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
