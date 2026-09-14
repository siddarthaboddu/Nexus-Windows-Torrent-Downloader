import React, { useState } from 'react'
import { Film, Play, ArrowLeft, CheckCircle2, FileVideo, HardDrive, Users, FileText } from 'lucide-react'
import clsx from 'clsx'

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function StreamFilePicker({ torrentInfo, onSelectFile, onCancel }) {
  const [filterVideosOnly, setFilterVideosOnly] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  if (!torrentInfo) return null

  const allFiles = torrentInfo.files || []
  const videoFiles = allFiles.filter(f => f.isVideo)

  const displayedFiles = (filterVideosOnly && videoFiles.length > 0 ? videoFiles : allFiles).filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getBadgeColor = (ext) => {
    switch (ext) {
      case 'mp4':
      case 'm4v':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
      case 'webm':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      case 'mkv':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
      case 'avi':
      case 'mov':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      default:
        return 'bg-secondary text-muted-foreground border-border'
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-400">
      {/* Torrent Header Card */}
      <div className="glass-panel p-6 rounded-3xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white shadow-lg shadow-blue-500/20">
            <Film size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                Ready to Stream
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {torrentInfo.infoHash.slice(0, 10)}...
              </span>
            </div>
            <h2 className="text-xl font-bold text-foreground truncate mt-1">{torrentInfo.name}</h2>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <HardDrive size={14} />
                {formatBytes(torrentInfo.length)}
              </span>
              <span className="flex items-center gap-1">
                <FileVideo size={14} />
                {videoFiles.length} {videoFiles.length === 1 ? 'Video' : 'Videos'} ({allFiles.length} files total)
              </span>
              <span className="flex items-center gap-1">
                <Users size={14} />
                {torrentInfo.numPeers} Peers
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onCancel}
          className="self-start md:self-center flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground text-xs font-semibold border border-border/60 transition-colors"
        >
          <ArrowLeft size={16} />
          <span>Choose Different Torrent</span>
        </button>
      </div>

      {/* File List Controls */}
      <div className="glass-panel p-6 rounded-3xl border border-border shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/50">
          <div>
            <h3 className="text-base font-bold text-foreground">Select File to Stream</h3>
            <p className="text-xs text-muted-foreground">Only the selected video file will be streamed sequentially.</p>
          </div>

          <div className="flex items-center gap-3">
            {videoFiles.length > 0 && (
              <button
                onClick={() => setFilterVideosOnly(!filterVideosOnly)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 border",
                  filterVideosOnly
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                )}
              >
                <CheckCircle2 size={14} />
                <span>Videos Only ({videoFiles.length})</span>
              </button>
            )}

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search file name..."
              className="px-3 py-1.5 rounded-lg bg-secondary/60 border border-border text-foreground placeholder-muted-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Files Listing */}
        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {displayedFiles.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText size={36} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-semibold">No files match your filter.</p>
              <p className="text-xs mt-1">Try disabling "Videos Only" to see non-standard files.</p>
            </div>
          ) : (
            displayedFiles.map((file) => (
              <div
                key={file.index}
                className="group p-3.5 rounded-2xl bg-secondary/30 hover:bg-secondary/70 border border-border/40 hover:border-primary/40 transition-all flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={clsx("px-2 py-1 rounded-md text-[10px] font-bold uppercase border tracking-wider flex-shrink-0", getBadgeColor(file.extension))}>
                    {file.extension || 'FILE'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{formatBytes(file.length)}</span>
                      {file.path && file.path !== file.name && (
                        <span className="truncate opacity-75">in {file.path}</span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => onSelectFile(file.index)}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-blue-600 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all active:scale-95"
                >
                  <Play size={14} className="fill-current" />
                  <span>Stream This</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
