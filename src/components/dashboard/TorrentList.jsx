import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Pause, Play, Trash2, Package, ChevronDown, ChevronUp, Folder, RotateCw, Link, Check, Search, PauseCircle, PlayCircle } from 'lucide-react';
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

const TorrentCard = ({
    torrent,
    onRemove,
    onTogglePause,
    onReverify,
    openFolder,
    compactMode,
    onToggleFile,
    openFile,
    openFileFolder,
    showFileContextMenu,
    showTorrentContextMenu
}) => {
    const [expanded, setExpanded] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopyMagnet = (e) => {
        e.stopPropagation();
        if (torrent.magnetURI) {
            navigator.clipboard.writeText(torrent.magnetURI);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleContextMenu = (e) => {
        if (e.target.closest('.custom-scrollbar') || e.target.closest('button') || e.target.closest('input')) {
            return;
        }
        e.preventDefault();
        if (showTorrentContextMenu) {
            showTorrentContextMenu(torrent.infoHash);
        } else if (window.ipcRenderer) {
            window.ipcRenderer.invoke('show-torrent-context-menu', torrent.infoHash);
        }
    };

    return (
        <div
            className={clsx("glass-panel rounded-xl mb-3 hover:bg-secondary/40 transition-all group",
                compactMode ? "p-2" : "p-4"
            )}
            onContextMenu={handleContextMenu}
        >
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
                            onClick={handleCopyMagnet}
                            className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition"
                            title={copied ? "Magnet link copied!" : "Copy Magnet Link"}
                        >
                            {copied ? <Check size={16} className="text-emerald-500" /> : <Link size={16} />}
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
                            title="Delete Torrent"
                        >
                            <Trash2 size={16} />
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); onReverify && onReverify(torrent.infoHash); }}
                            className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition"
                            title="Force Re-check"
                        >
                            <RotateCw size={16} />
                        </button>
                    </div>
                    <div className="text-muted-foreground pl-2 border-l border-border">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{((torrent.progress || 0) * 100).toFixed(1)}%</span>
                    <span>•</span>
                    <span>{formatBytes(torrent.downloaded || 0)} / {formatBytes(torrent.length || 0)}</span>
                    {torrent.state === 'Downloading' && torrent.timeRemaining ? (
                        <span className="text-muted-foreground/70">• {formatTime(torrent.timeRemaining)} remaining</span>
                    ) : null}
                </div>
                <div className="flex gap-3">
                    <span className="flex items-center gap-1 text-emerald-500"><ArrowDown size={12} /> {formatBytes(torrent.downloadSpeed)}/s</span>
                    <span className="flex items-center gap-1 text-blue-500"><ArrowUp size={12} /> {formatBytes(torrent.uploadSpeed)}/s</span>
                    <span title={`${torrent.connectedPeers || 0} Leechers, ${torrent.connectedSeeds || 0} Seeds`} className="cursor-help border-b border-dotted border-muted-foreground/50">
                        {torrent.numPeers || 0} peers
                    </span>
                </div>
            </div>

            <ProgressBar progress={torrent.progress || 0} />

            {expanded && (
                <TorrentDetails
                    torrent={torrent}
                    onToggleFile={(fileIndices, selected) => onToggleFile && onToggleFile(torrent.infoHash, fileIndices, selected)}
                    onOpenFile={openFile}
                    onOpenFileFolder={openFileFolder}
                    onContextMenu={showFileContextMenu}
                />
            )}
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

const TorrentList = ({
    torrents,
    onRemove,
    onPause,
    onResume,
    onReverify,
    openFolder,
    compactMode,
    onToggleFile,
    onPauseAll,
    onResumeAll,
    openFile,
    openFileFolder,
    showFileContextMenu,
    showTorrentContextMenu
}) => {
    const [searchQuery, setSearchQuery] = useState('');

    if (torrents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <p>No active downloads</p>
            </div>
        )
    }

    const q = searchQuery.trim().toLowerCase();
    const filteredTorrents = q
        ? torrents.filter(t => (t.name || '').toLowerCase().includes(q) || (t.infoHash || '').toLowerCase().includes(q))
        : torrents;

    const groups = {
        Downloading: filteredTorrents.filter(t => t.state === 'Downloading'),
        Seeding: filteredTorrents.filter(t => t.state === 'Seeding'),
        Paused: filteredTorrents.filter(t => t.state === 'Paused'),
        Completed: filteredTorrents.filter(t => t.state === 'Completed')
    };

    const groupOrder = ['Downloading', 'Seeding', 'Paused', 'Completed'];

    return (
        <div className="w-full space-y-6">
            {/* Toolbar: Search and Bulk Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/30 p-2.5 rounded-xl border border-border/50">
                <div className="relative flex-1 max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search torrents by name or hash..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-1.5 bg-secondary/50 border border-border/50 rounded-lg text-sm text-foreground focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/60"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground p-1"
                        >
                            ✕
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {onPauseAll && (
                        <button
                            onClick={onPauseAll}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 hover:bg-secondary border border-border/50 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                            title="Pause all active transfers"
                        >
                            <PauseCircle size={14} />
                            <span>Pause All</span>
                        </button>
                    )}
                    {onResumeAll && (
                        <button
                            onClick={onResumeAll}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 hover:bg-secondary border border-border/50 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                            title="Resume all paused transfers"
                        >
                            <PlayCircle size={14} />
                            <span>Resume All</span>
                        </button>
                    )}
                </div>
            </div>

            {filteredTorrents.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <p className="text-sm">No torrents matching "{searchQuery}"</p>
                </div>
            ) : (
                <div className="space-y-8">
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
                                            onReverify={onReverify}
                                            compactMode={compactMode}
                                            onToggleFile={onToggleFile}
                                            openFile={openFile}
                                            openFileFolder={openFileFolder}
                                            showFileContextMenu={showFileContextMenu}
                                            showTorrentContextMenu={showTorrentContextMenu}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TorrentList;
