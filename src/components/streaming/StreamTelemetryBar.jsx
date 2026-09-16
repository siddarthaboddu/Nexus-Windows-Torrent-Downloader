import React from 'react'
import { ArrowDown, ArrowUp, Users, ExternalLink, Download, XCircle } from 'lucide-react'

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function StreamTelemetryBar({
  stats = {},
  streamData = {},
  onOpenExternal,
  onPromoteToDownload,
  onStop
}) {
  const downloadSpeedFormatted = stats.downloadSpeed ? `${formatBytes(stats.downloadSpeed)}/s` : '0 KB/s'
  const uploadSpeedFormatted = stats.uploadSpeed ? `${formatBytes(stats.uploadSpeed)}/s` : '0 KB/s'
  const percentBuffered = Math.min(Math.round((stats.progress || 0) * 100), 100)
  const isLocal = Boolean(stats.local)
  const peerDetail = stats.numPeers
    ? `${stats.seeders || 0} seed · ${stats.unchokedPeers || 0} unchoked${stats.queuedPeers ? ` · ${stats.queuedPeers} queued` : ''}`
    : 'No live peers'

  return (
    <div className="glass-panel px-4 py-3 rounded-2xl border border-border/80 shadow-xl flex flex-wrap items-center justify-between gap-4 backdrop-blur-xl bg-background/80">
      {/* Telemetry Metrics */}
      <div className="flex items-center gap-6 text-xs flex-wrap">
        {/* Download Speed */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <ArrowDown size={15} />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] font-medium uppercase">Download</div>
            <div className="font-mono font-bold text-emerald-400">{downloadSpeedFormatted}</div>
          </div>
        </div>

        {/* Upload Speed */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
            <ArrowUp size={15} />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] font-medium uppercase">Upload</div>
            <div className="font-mono font-bold text-blue-400">{uploadSpeedFormatted}</div>
          </div>
        </div>

        {/* Active connections — discovered/queued peers are intentionally
            separate from the established WebTorrent wire count. */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
            <Users size={15} />
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] font-medium uppercase">{isLocal ? 'Source' : 'Peers'}</div>
            <div className="font-mono font-bold text-purple-400">{isLocal ? 'Local disk' : (stats.numPeers || 0)}</div>
            {!isLocal && <div className="text-[9px] text-muted-foreground whitespace-nowrap">{peerDetail}</div>}
          </div>
        </div>

        {/* Buffered Progress */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <div>
            <div className="text-muted-foreground text-[10px] font-medium uppercase flex justify-between">
              <span>Stream Buffer</span>
              <span className="font-mono text-foreground font-semibold">{percentBuffered}%</span>
            </div>
            <div className="w-28 h-1.5 bg-secondary rounded-full overflow-hidden mt-1 border border-border/50">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${percentBuffered}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => onOpenExternal(streamData?.streamUrl)}
          title="Open in VLC or Default Media Player"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground text-xs font-semibold border border-border/60 transition-colors shadow-sm"
        >
          <ExternalLink size={14} />
          <span>Open in VLC / Player</span>
        </button>

        {onPromoteToDownload && (
          <button
            onClick={onPromoteToDownload}
            title="Keep this torrent permanently in your downloads"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary text-xs font-semibold border border-primary/30 transition-colors shadow-sm"
          >
            <Download size={14} />
            <span>Keep & Save</span>
          </button>
        )}

        <button
          onClick={onStop}
          title="Stop streaming and delete temporary video cache"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-semibold border border-rose-500/30 transition-colors shadow-sm"
        >
          <XCircle size={14} />
          <span>Stop Stream</span>
        </button>
      </div>
    </div>
  )
}
