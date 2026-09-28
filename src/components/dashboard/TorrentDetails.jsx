import React, { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Share2, HardDrive, Clock, Activity, File, Folder, FolderOpen, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Key, Check, ExternalLink, Copy, X } from 'lucide-react';
import clsx from 'clsx';

// Helper to format time remaining (seconds)
function formatTime(seconds) {
    if (!seconds || seconds === Infinity || isNaN(seconds)) return '--';

    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

const buildFileTree = (files) => {
    const root = {};

    files.forEach((file, index) => {
        const fileData = { ...file, index: file.index !== undefined ? file.index : index };
        // Normalize path separators and split
        const parts = file.path.split(/[\\/]/);
        let current = root;
        let currentPath = '';

        parts.forEach((part, i) => {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!current[part]) {
                current[part] = {
                    name: part,
                    path: currentPath,
                    type: i === parts.length - 1 ? 'file' : 'folder',
                    children: {},
                    fileData: i === parts.length - 1 ? fileData : null
                };
            }
            current = current[part].children;
        });
    });

    return root;
};

const getAllFileIndices = (node) => {
    if (node.type === 'file' && node.fileData) {
        return [node.fileData.index];
    }
    let indices = [];
    if (node.children) {
        Object.values(node.children).forEach(child => {
            indices = indices.concat(getAllFileIndices(child));
        });
    }
    return indices;
};

const getFolderSelectionStatus = (node) => {
    const collectFiles = (n) => {
        if (n.type === 'file' && n.fileData) return [n.fileData];
        let res = [];
        if (n.children) {
            Object.values(n.children).forEach(c => {
                res = res.concat(collectFiles(c));
            });
        }
        return res;
    };

    const allFiles = collectFiles(node);
    if (allFiles.length === 0) return { checked: false, indeterminate: false };
    const selectedCount = allFiles.filter(f => f.selected !== false).length;

    if (selectedCount === allFiles.length) {
        return { checked: true, indeterminate: false };
    }
    if (selectedCount === 0) {
        return { checked: false, indeterminate: false };
    }
    return { checked: false, indeterminate: true };
};

const FileTreeNode = ({ node, level = 0, onToggleFile, infoHash, onOpenFile, onOpenFileFolder, onContextMenu }) => {
    const [isOpen, setIsOpen] = useState(level === 0);
    const folderCheckboxRef = React.useRef(null);

    const isFolder = node.type === 'folder';
    const folderStatus = isFolder ? getFolderSelectionStatus(node) : null;
    const filePath = isFolder ? node.path : (node.fileData?.path || node.path);

    React.useEffect(() => {
        if (folderCheckboxRef.current && isFolder) {
            folderCheckboxRef.current.indeterminate = folderStatus.indeterminate;
        }
    }, [folderStatus, isFolder]);

    const handleCheckboxClick = (e) => {
        e.stopPropagation();
        if (!onToggleFile) return;

        if (isFolder) {
            const indices = getAllFileIndices(node);
            const newSelected = !folderStatus.checked;
            onToggleFile(indices, newSelected);
        } else if (node.fileData) {
            const newSelected = node.fileData.selected === false;
            onToggleFile([node.fileData.index], newSelected);
        }
    };

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onContextMenu) {
            onContextMenu(e, node, filePath, isFolder);
        }
    };

    const handleDoubleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isFolder) {
            setIsOpen(!isOpen);
        } else {
            if (onOpenFile) {
                onOpenFile(infoHash, filePath);
            } else if (window.ipcRenderer) {
                window.ipcRenderer.invoke('open-torrent-file', { infoHash, filePath });
            }
        }
    };

    const handleClick = () => {
        if (isFolder) {
            setIsOpen(!isOpen);
        }
    };

    // Sort children: folders first, then files
    const sortedChildren = node.children
        ? Object.values(node.children).sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        })
        : [];

    const isFileDeselected = node.type === 'file' && node.fileData?.selected === false;

    return (
        <div className="select-none">
            <div
                className={clsx(
                    "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors group",
                    node.type === 'folder'
                        ? 'hover:bg-secondary text-foreground'
                        : 'hover:bg-secondary text-muted-foreground'
                )}
                style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                title={node.type === 'file' ? "Double-click to open • Right-click for options" : "Right-click for options"}
            >
                {/* Expander Icon for Folders */}
                <div className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground">
                    {node.type === 'folder' && (
                        isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    )}
                </div>

                {/* Selection Checkbox */}
                {onToggleFile && (
                    <input
                        type="checkbox"
                        ref={isFolder ? folderCheckboxRef : null}
                        checked={isFolder ? folderStatus.checked : (node.fileData?.selected !== false)}
                        onChange={handleCheckboxClick}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-0 focus:ring-offset-0 bg-secondary/80 cursor-pointer shrink-0"
                        title={isFolder ? "Toggle all files in folder" : (node.fileData?.selected !== false ? "Deselect file" : "Select file")}
                    />
                )}

                {/* Type Icon */}
                <div className={`shrink-0 ${node.type === 'folder' ? 'text-blue-500' : 'text-muted-foreground'}`}>
                    {node.type === 'folder' ? (
                        isOpen ? <FolderOpen size={16} /> : <Folder size={16} />
                    ) : (
                        <File size={16} />
                    )}
                </div>

                {/* Name */}
                <div className={clsx(
                    "flex-1 min-w-0 truncate text-sm",
                    isFileDeselected && "opacity-50 line-through"
                )}>
                    {node.name}
                </div>

                {/* File Details */}
                {node.type === 'file' && node.fileData && (
                    <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground shrink-0 ml-2">
                        {isFileDeselected && (
                            <span className="text-muted-foreground/60 italic text-[11px]">Skipped</span>
                        )}
                        <span>{formatBytes(node.fileData.length)}</span>
                        <span className={node.fileData.progress === 1 ? 'text-emerald-500' : 'text-blue-500'}>
                            {Math.round(node.fileData.progress * 100)}%
                        </span>
                    </div>
                )}

                {/* Quick Actions (shown on hover) */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                    {node.type === 'file' && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onOpenFile) onOpenFile(infoHash, filePath);
                                else if (window.ipcRenderer) window.ipcRenderer.invoke('open-torrent-file', { infoHash, filePath });
                            }}
                            className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
                            title="Open file"
                        >
                            <ExternalLink size={14} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenFileFolder) onOpenFileFolder(infoHash, filePath);
                            else if (window.ipcRenderer) window.ipcRenderer.invoke('open-torrent-file-folder', { infoHash, filePath });
                        }}
                        className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
                        title={node.type === 'folder' ? "Open folder in Explorer" : "Open containing folder"}
                    >
                        <FolderOpen size={14} />
                    </button>
                </div>
            </div>

            {/* Recursively Render Children */}
            {isOpen && node.type === 'folder' && (
                <div className="animate-in slide-in-from-top-1 duration-200 fade-in">
                    {sortedChildren.map((child) => (
                        <FileTreeNode
                            key={child.name}
                            node={child}
                            level={level + 1}
                            onToggleFile={onToggleFile}
                            infoHash={infoHash}
                            onOpenFile={onOpenFile}
                            onOpenFileFolder={onOpenFileFolder}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const TorrentDetails = ({ torrent, onToggleFile, onOpenFile, onOpenFileFolder, onSetStrategy }) => {
    const [speedHistory, setSpeedHistory] = useState([]);
    const [activeTab, setActiveTab] = useState('overview');
    const [copiedHash, setCopiedHash] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const [copiedPath, setCopiedPath] = useState(false);

    useEffect(() => {
        if (!contextMenu) return;

        const handleOutside = (e) => {
            if (!e.target.closest('#torrent-file-context-menu')) {
                setContextMenu(null);
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setContextMenu(null);
        };

        window.addEventListener('pointerdown', handleOutside);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', () => setContextMenu(null), true);

        return () => {
            window.removeEventListener('pointerdown', handleOutside);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', () => setContextMenu(null), true);
        };
    }, [contextMenu]);

    const handleContextMenu = (e, node, filePath, isFolder) => {
        e.preventDefault();
        e.stopPropagation();

        const menuWidth = 230;
        const menuHeight = 220;
        let x = e.clientX;
        let y = e.clientY;

        if (x + menuWidth > window.innerWidth) {
            x = window.innerWidth - menuWidth - 10;
        }
        if (y + menuHeight > window.innerHeight) {
            y = window.innerHeight - menuHeight - 10;
        }

        setCopiedPath(false);
        setContextMenu({
            x: Math.max(10, x),
            y: Math.max(10, y),
            filePath,
            isFolder,
            isSelected: node.fileData?.selected !== false,
            fileIndex: node.fileData?.index,
            name: node.name
        });
    };

    const handleCopyHash = () => {
        if (torrent.infoHash) {
            navigator.clipboard.writeText(torrent.infoHash);
            setCopiedHash(true);
            setTimeout(() => setCopiedHash(false), 2000);
        }
    };

    // Sample download & upload speed history periodically
    const speedRef = useRef({ dl: torrent.downloadSpeed, ul: torrent.uploadSpeed });
    useEffect(() => {
        speedRef.current = { dl: torrent.downloadSpeed, ul: torrent.uploadSpeed };
    }, [torrent.downloadSpeed, torrent.uploadSpeed]);

    useEffect(() => {
        const interval = setInterval(() => {
            setSpeedHistory(prev => {
                const newPoint = {
                    time: new Date().toLocaleTimeString(),
                    download: +(speedRef.current.dl / 1024 / 1024).toFixed(2), // MB/s
                    upload: +(speedRef.current.ul / 1024 / 1024).toFixed(2) // MB/s
                };
                const newHistory = [...prev, newPoint];
                if (newHistory.length > 25) newHistory.shift();
                return newHistory;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="mt-4 p-4 glass rounded-xl animate-in slide-in-from-top-2">

            {/* Tabs */}
            <div className="flex gap-4 mb-6 border-b border-border pb-2">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`text-sm font-medium transition-colors relative px-2 py-1 ${activeTab === 'overview' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Overview
                    {activeTab === 'overview' && <div className="absolute -bottom-3 left-0 right-0 h-0.5 bg-primary rounded-full" />}
                </button>
                <button
                    onClick={() => setActiveTab('files')}
                    className={`text-sm font-medium transition-colors relative px-2 py-1 ${activeTab === 'files' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Files ({torrent.files?.length || 0})
                    {activeTab === 'files' && <div className="absolute -bottom-3 left-0 right-0 h-0.5 bg-primary rounded-full" />}
                </button>
            </div>

            {activeTab === 'overview' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
                    {/* Chart */}
                    <div className="h-64 bg-secondary/50 rounded-xl p-4 border border-border flex flex-col">
                        <div className="flex items-center justify-between mb-3 shrink-0">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                <Activity size={14} /> Network Speeds
                            </h4>
                            <div className="flex items-center gap-3 text-xs">
                                <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> DL: {(torrent.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s
                                </span>
                                <span className="flex items-center gap-1.5 text-blue-500 font-medium">
                                    <span className="w-2 h-2 rounded-full bg-blue-500" /> UL: {(torrent.uploadSpeed / 1024 / 1024).toFixed(2)} MB/s
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={speedHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorDownload" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorUpload" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.1} vertical={false} />
                                    <XAxis dataKey="time" hide />
                                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(val) => `${val.toFixed(1)}`} domain={[0, 'dataMax + 0.5']} />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'hsl(var(--popover))',
                                            borderColor: 'hsl(var(--border))',
                                            color: 'hsl(var(--popover-foreground))',
                                            borderRadius: '0.5rem'
                                        }}
                                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                                        labelStyle={{ display: 'none' }}
                                        formatter={(val, name) => [`${Number(val).toFixed(2)} MB/s`, name === 'download' ? 'Download' : 'Upload']}
                                    />
                                    <Area type="monotone" dataKey="download" name="download" stroke="#10b981" fillOpacity={1} fill="url(#colorDownload)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="upload" name="upload" stroke="#3b82f6" fillOpacity={1} fill="url(#colorUpload)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Detailed Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Share2 size={16} /> <span className="text-xs font-medium">Seeds</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{torrent.connectedSeeds || 0}</div>
                            <div className="text-xs text-emerald-500 mt-1">Connected</div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Share2 size={16} /> <span className="text-xs font-medium">Peers</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{torrent.connectedPeers || 0}</div>
                            <div className="text-xs text-blue-500 mt-1">Connected</div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <HardDrive size={16} /> <span className="text-xs font-medium">Downloaded</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{formatBytes(torrent.downloaded)}</div>
                            <div className="text-xs text-emerald-500 mt-1">
                                of {formatBytes(torrent.length)}
                            </div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <ArrowUp size={16} /> <span className="text-xs font-medium">Uploaded</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{formatBytes(torrent.uploaded || 0)}</div>
                            <div className="text-xs text-blue-500 mt-1">Lifetime total</div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Clock size={16} /> <span className="text-xs font-medium">Time Left</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">
                                {formatTime(torrent.timeRemaining)}
                            </div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Activity size={16} /> <span className="text-xs font-medium">Share Ratio</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{torrent.ratio?.toFixed(2) || '0.00'}</div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <ArrowDown size={16} /> <span className="text-xs font-medium">Download Strategy</span>
                            </div>
                            <div className="flex gap-1.5">
                                {[
                                    { id: 'sequential', label: 'Sequential' },
                                    { id: 'rarest', label: 'Rarest first' }
                                ].map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        disabled={torrent.paused}
                                        onClick={() => onSetStrategy && onSetStrategy(torrent.infoHash, s.id)}
                                        className={clsx(
                                            "flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                                            (torrent.strategy || 'rarest') === s.id
                                                ? "bg-primary/20 text-primary border-primary/40"
                                                : "bg-secondary/40 text-muted-foreground border-border/60 hover:text-foreground"
                                        )}
                                        title={s.id === 'sequential' ? 'Download pieces in order — best for previews' : 'Download rarest pieces first — can finish faster'}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border col-span-2 flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                    <Key size={16} /> <span className="text-xs font-medium">Info Hash</span>
                                </div>
                                <div className="font-mono text-xs text-foreground truncate select-all">
                                    {torrent.infoHash || '--'}
                                </div>
                            </div>
                            {torrent.infoHash && (
                                <button
                                    onClick={handleCopyHash}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground border border-border/60 rounded-lg transition-colors shrink-0"
                                    title="Copy Info Hash"
                                >
                                    {copiedHash ? <Check size={14} className="text-emerald-500" /> : <Key size={14} />}
                                    <span>{copiedHash ? 'Copied' : 'Copy Hash'}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="animate-in fade-in duration-300">
                    <div className="flex flex-col gap-1 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                        {torrent.files && torrent.files.length > 0 ? (
                            (() => {
                                const tree = buildFileTree(torrent.files);
                                return Object.values(tree).map((node) => (
                                    <FileTreeNode
                                        key={node.name}
                                        node={node}
                                        level={0}
                                        onToggleFile={onToggleFile}
                                        infoHash={torrent.infoHash}
                                        onOpenFile={onOpenFile}
                                        onOpenFileFolder={onOpenFileFolder}
                                        onContextMenu={handleContextMenu}
                                    />
                                ));
                            })()
                        ) : (
                            <div className="text-center py-10 text-muted-foreground">
                                <p>No files information available yet.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* In-App Right-Click Context Menu */}
            {contextMenu && (
                <div
                    id="torrent-file-context-menu"
                    className="fixed z-50 min-w-[210px] bg-popover/95 backdrop-blur-md text-popover-foreground border border-border/80 rounded-xl shadow-2xl p-1.5 animate-in fade-in zoom-in-95 duration-100 select-none text-xs font-medium"
                    style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header with File/Folder Name */}
                    <div className="px-2.5 py-1.5 mb-1 text-[11px] text-muted-foreground truncate border-b border-border/50 max-w-[240px]" title={contextMenu.name}>
                        {contextMenu.name}
                    </div>

                    {/* Action 1: Open File / Open Folder */}
                    {!contextMenu.isFolder ? (
                        <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary text-foreground hover:text-foreground transition-colors text-left"
                            onClick={() => {
                                const fp = contextMenu.filePath;
                                setContextMenu(null);
                                if (onOpenFile) onOpenFile(torrent.infoHash, fp);
                                else if (window.ipcRenderer) window.ipcRenderer.invoke('open-torrent-file', { infoHash: torrent.infoHash, filePath: fp });
                            }}
                        >
                            <ExternalLink size={15} className="text-primary" />
                            <span>Open File</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary text-foreground hover:text-foreground transition-colors text-left"
                            onClick={() => {
                                const fp = contextMenu.filePath;
                                setContextMenu(null);
                                if (onOpenFileFolder) onOpenFileFolder(torrent.infoHash, fp);
                                else if (window.ipcRenderer) window.ipcRenderer.invoke('open-torrent-file-folder', { infoHash: torrent.infoHash, filePath: fp });
                            }}
                        >
                            <FolderOpen size={15} className="text-primary" />
                            <span>Open Folder</span>
                        </button>
                    )}

                    {/* Action 2: Open Containing Folder */}
                    <button
                        type="button"
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary text-foreground hover:text-foreground transition-colors text-left"
                        onClick={() => {
                            const fp = contextMenu.filePath;
                            setContextMenu(null);
                            if (onOpenFileFolder) onOpenFileFolder(torrent.infoHash, fp);
                            else if (window.ipcRenderer) window.ipcRenderer.invoke('open-torrent-file-folder', { infoHash: torrent.infoHash, filePath: fp });
                        }}
                    >
                        <FolderOpen size={15} className="text-muted-foreground" />
                        <span>{contextMenu.isFolder ? 'Show in Explorer' : 'Open Containing Folder'}</span>
                    </button>

                    <div className="h-px bg-border/60 my-1" />

                    {/* Action 3: Copy File / Folder Path */}
                    <button
                        type="button"
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary text-foreground hover:text-foreground transition-colors text-left"
                        onClick={async () => {
                            const fp = contextMenu.filePath;
                            let fullPath = fp;
                            try {
                                if (window.ipcRenderer) {
                                    const resolvedPath = await window.ipcRenderer.invoke('get-torrent-file-path', {
                                        infoHash: torrent.infoHash,
                                        filePath: fp
                                    });
                                    if (resolvedPath) fullPath = resolvedPath;
                                }
                            } catch {
                                // ignore
                            }
                            navigator.clipboard.writeText(fullPath);
                            setCopiedPath(true);
                            setTimeout(() => {
                                setContextMenu(null);
                            }, 500);
                        }}
                    >
                        {copiedPath ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} className="text-muted-foreground" />}
                        <span>{copiedPath ? 'Copied to Clipboard!' : (contextMenu.isFolder ? 'Copy Folder Path' : 'Copy File Path')}</span>
                    </button>

                    {/* Action 4: Include / Exclude Download */}
                    {!contextMenu.isFolder && typeof contextMenu.fileIndex === 'number' && onToggleFile && (
                        <>
                            <div className="h-px bg-border/60 my-1" />
                            <button
                                type="button"
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary text-foreground hover:text-foreground transition-colors text-left"
                                onClick={() => {
                                    const idx = contextMenu.fileIndex;
                                    const newSel = !contextMenu.isSelected;
                                    setContextMenu(null);
                                    onToggleFile([idx], newSel);
                                }}
                            >
                                {contextMenu.isSelected ? (
                                    <>
                                        <X size={15} className="text-muted-foreground" />
                                        <span>Exclude from Download</span>
                                    </>
                                ) : (
                                    <>
                                        <Check size={15} className="text-emerald-500" />
                                        <span>Include in Download</span>
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default TorrentDetails;
