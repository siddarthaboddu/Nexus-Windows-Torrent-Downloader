import React, { useState, useRef } from 'react'
import { Play, UploadCloud, Link as LinkIcon, Loader2, Film, Sparkles, FolderDown, X } from 'lucide-react'
import clsx from 'clsx'

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function TorrentSourceInput({ onSelectSource, onCancel, isLoading, activeTorrents = [] }) {
  const [magnetInput, setMagnetInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const handleMagnetSubmit = (e) => {
    e.preventDefault()
    const trimmed = magnetInput.trim()
    if (!trimmed) return
    onSelectSource(trimmed)
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.torrent')) {
      alert('Please select a valid .torrent file.')
      return
    }

    const reader = new FileReader()
    reader.onload = (evt) => {
      if (evt.target?.readyState === FileReader.DONE) {
        onSelectSource(new Uint8Array(evt.target.result))
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.torrent')) {
        alert('Please drop a valid .torrent file.')
        return
      }
      const reader = new FileReader()
      reader.onload = (evt) => {
        if (evt.target?.readyState === FileReader.DONE) {
          onSelectSource(new Uint8Array(evt.target.result))
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {/* Hero Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold tracking-wide uppercase">
          <Sparkles size={14} className="animate-spin-slow" />
          <span>Dual-Mode Live Video Streaming</span>
        </div>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight sm:text-5xl">
          Watch Torrents <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-500">Instantly</span>
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base">
          Stream movies, TV shows, and video clips sequentially straight from the BitTorrent swarm. No waiting for full downloads, zero permanent disk clutter.
        </p>
      </div>

      {/* Main Input Card */}
      <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-border shadow-2xl relative overflow-hidden backdrop-blur-xl">
        {isLoading && (
          <div className="absolute inset-0 z-20 bg-background/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
            <Loader2 size={42} className="text-primary animate-spin" />
            <div className="text-center">
              <h4 className="text-lg font-bold text-foreground">Fetching Torrent Metadata</h4>
              <p className="text-sm text-muted-foreground">Connecting to trackers and DHT swarm to inspect video files...</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold border border-border/60 transition-all active:scale-95"
            >
              <X size={14} />
              <span>Cancel</span>
            </button>
          </div>
        )}

        {/* Magnet Link Form */}
        <form onSubmit={handleMagnetSubmit} className="space-y-4">
          <label className="block text-sm font-semibold text-foreground">
            Paste Magnet Link or Torrent URL
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                <LinkIcon size={18} />
              </div>
              <input
                type="text"
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                placeholder="magnet:?xt=urn:btih:... or https://..."
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/40 border border-border/80 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm transition-all shadow-inner"
              />
            </div>
            <button
              type="submit"
              disabled={!magnetInput.trim() || isLoading}
              className={clsx(
                "flex items-center gap-2 px-6 py-3 rounded-xl font-medium text-sm transition-all shadow-lg",
                magnetInput.trim() && !isLoading
                  ? "bg-primary hover:bg-blue-600 text-white shadow-blue-500/25 cursor-pointer scale-100 active:scale-95"
                  : "bg-secondary text-muted-foreground opacity-50 cursor-not-allowed"
              )}
            >
              <Play size={16} className="fill-current" />
              <span>Inspect & Stream</span>
            </button>
          </div>
        </form>

        <div className="flex items-center my-6">
          <div className="flex-grow border-t border-border/60"></div>
          <span className="flex-shrink mx-4 text-xs font-semibold uppercase text-muted-foreground tracking-wider">or drop file</span>
          <div className="flex-grow border-t border-border/60"></div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={clsx(
            "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-300",
            isDragging
              ? "border-primary bg-primary/10 scale-[1.01]"
              : "border-border/80 hover:border-primary/50 hover:bg-secondary/20"
          )}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".torrent"
            className="hidden"
          />
          <div className="w-14 h-14 rounded-2xl bg-secondary/80 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
            <UploadCloud size={28} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">Click to browse or drop a .torrent file here</p>
            <p className="text-xs text-muted-foreground mt-0.5">Supports single-file & multi-episode media torrents</p>
          </div>
        </div>
      </div>

      {/* Quick Stream from Active Downloads */}
      {activeTorrents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground px-1">
            <FolderDown size={18} className="text-primary" />
            <span>Or Stream from Active Transfers</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeTorrents.slice(0, 4).map((t) => (
              <div
                key={t.infoHash}
                onClick={() => onSelectSource(t.infoHash)}
                className="glass-panel p-4 rounded-2xl border border-border/60 hover:border-primary/50 cursor-pointer flex items-center justify-between group transition-all duration-200"
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-white transition-colors">
                    <Film size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(t.length)} • {t.numPeers || 0} peers</p>
                  </div>
                </div>
                <button className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-secondary group-hover:bg-primary group-hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5">
                  <Play size={12} className="fill-current" />
                  <span>Stream</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
