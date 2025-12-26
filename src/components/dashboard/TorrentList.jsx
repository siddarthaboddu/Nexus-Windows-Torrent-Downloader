import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Pause, Play, Trash2, Package, ChevronDown, ChevronUp, Folder } from 'lucide-react';
import TorrentDetails from './TorrentDetails';
import clsx from 'clsx';

const ProgressBar = ({ progress }) => (
    <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mt-2">
        <div
            className={clsx("h-full transition-all duration-300 ease-out",
                progress >= 1 ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${progress * 100}%` }}
        />
    </div>
);

const TorrentCard = ({ torrent, onRemove, onTogglePause, openFolder, compactMode }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={clsx("glass-panel rounded-xl mb-3 hover:bg-secondary/40 transition-all group",
            compactMode ? "p-2" : "p-4"
        )}>
            <div
                className="flex justify-between items-start mb-2 cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={clsx("rounded-lg transition-colors flex items-center justify-center",
                        torrent.state === 'Seeding' ? "bg-emerald-500/10 text-emerald-500" :
                            torrent.state === 'Completed' ? "bg-muted text-muted-foreground" :
                                "bg-primary/10 text-primary",
                        compactMode ? "p-1.5 w-8 h-8" : "p-2 w-10 h-10"
                    )}>
                        <Package size={compactMode ? 16 : 20} />
                    </div>
                    <div className="min-w-0">
                        <h4 className={clsx("font-medium text-foreground truncate", compactMode ? "text-xs" : "text-sm")}>{torrent.name || 'Fetching metadata...'}</h4>
                        {!compactMode && (
                            <div className="flex items-center gap-2">
                                <span className={clsx("text-xs font-medium px-2 py-0.5 rounded-full inline-block",
                                    torrent.state === 'Seeding' ? "bg-emerald-500/10 text-emerald-500" :
                                        torrent.state === 'Completed' ? "bg-secondary text-muted-foreground" :
                                            "text-muted-foreground p-0 bg-transparent"
                                )}>
                                    {torrent.state}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Actions always visible on hover or if expanded */}
                    <div className={clsx("flex gap-2 transition-opacity", expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                        <button
                            onClick={(e) => { e.stopPropagation(); onTogglePause() }}
                            className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition"
                            title={torrent.state === 'Paused' || torrent.state === 'Completed' ? "Resume" : "Pause"}
                        >
                            {torrent.state === 'Paused' || torrent.state === 'Completed' ? <Play size={16} /> : <Pause size={16} />}
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); openFolder && openFolder(torrent.infoHash); }}
                            className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition"
                            title="Open Folder"
                        >
                            <Folder size={16} />
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); onRemove(torrent.infoHash); }}
                            className="p-1.5 hover:bg-destructive/20 rounded text-muted-foreground hover:text-destructive transition"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                    <div className="text-muted-foreground pl-2 border-l border-border">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <div className="flex gap-2">
                    <span>{(torrent.progress * 100).toFixed(1)}%</span>
                    {torrent.state === 'Downloading' && torrent.timeRemaining && (
                        <span className="text-muted-foreground/70">• {formatTime(torrent.timeRemaining)} remaining</span>
                    )}
                </div>
                <div className="flex gap-3">
                    <span className="flex items-center gap-1 text-emerald-500"><ArrowDown size={12} /> {formatBytes(torrent.downloadSpeed)}/s</span>
                    <span className="flex items-center gap-1 text-blue-500"><ArrowUp size={12} /> {formatBytes(torrent.uploadSpeed)}/s</span>
                    <span title={`${torrent.connectedPeers} Leechers (Downloaders), ${torrent.connectedSeeds} Seeds (Uploaders)`} className="cursor-help border-b border-dotted border-muted-foreground/50">
                        {torrent.numPeers} peers
                    </span>
                </div>
            </div>

            <ProgressBar progress={torrent.progress} />

            {expanded && <TorrentDetails torrent={torrent} />}
        </div>
    )
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

function formatTime(seconds) {
    if (!seconds || seconds === Infinity) return '∞';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

const TorrentList = ({ torrents, onRemove, onPause, onResume, openFolder, compactMode }) => {
    if (torrents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <p>No active downloads</p>
            </div>
        )
    }

    const groups = {
        Downloading: torrents.filter(t => t.state === 'Downloading'),
        Seeding: torrents.filter(t => t.state === 'Seeding'),
        Paused: torrents.filter(t => t.state === 'Paused'),
        Completed: torrents.filter(t => t.state === 'Completed')
    };

    const groupOrder = ['Downloading', 'Seeding', 'Paused', 'Completed'];

    return (
        <div className="w-full space-y-8">
            {groupOrder.map(status => {
                const list = groups[status];
                if (!list || list.length === 0) return null;

                return (
                    <div key={status} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                            {status}
                            <span className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full text-xs">{list.length}</span>
                        </h3>
                        <div className="space-y-3">
                            {list.map((torrent) => (
                                <TorrentCard
                                    key={torrent.infoHash}
                                    torrent={torrent}
                                    onRemove={onRemove}
                                    onTogglePause={() => {
                                        if (torrent.state === 'Paused' || torrent.state === 'Completed') {
                                            onResume(torrent.infoHash)
                                        } else {
                                            onPause(torrent.infoHash)
                                        }
                                    }}
                                    openFolder={openFolder}
                                    compactMode={compactMode}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default TorrentList;
