import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Share2, HardDrive, Clock, Activity, File, Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
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

        parts.forEach((part, i) => {
            if (!current[part]) {
                current[part] = {
                    name: part,
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

const FileTreeNode = ({ node, level = 0, onToggleFile }) => {
    const [isOpen, setIsOpen] = useState(level === 0);
    const folderCheckboxRef = React.useRef(null);

    const isFolder = node.type === 'folder';
    const folderStatus = isFolder ? getFolderSelectionStatus(node) : null;

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
                    "flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors",
                    node.type === 'folder'
                        ? 'hover:bg-secondary text-foreground'
                        : 'hover:bg-secondary text-muted-foreground'
                )}
                style={{ paddingLeft: `${level * 1.5 + 0.5}rem` }}
                onClick={() => node.type === 'folder' && setIsOpen(!isOpen)}
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
            </div>

            {/* Recursively Render Children */}
            {isOpen && node.type === 'folder' && (
                <div className="animate-in slide-in-from-top-1 duration-200 fade-in">
                    {sortedChildren.map((child) => (
                        <FileTreeNode key={child.name} node={child} level={level + 1} onToggleFile={onToggleFile} />
                    ))}
                </div>
            )}
        </div>
    );
};

const TorrentDetails = ({ torrent, onToggleFile }) => {
    const [speedHistory, setSpeedHistory] = useState([]);
    const [activeTab, setActiveTab] = useState('overview');

    // Mock accumulating speed history for now
    useEffect(() => {
        setSpeedHistory(prev => {
            const newPoint = {
                time: new Date().toLocaleTimeString(),
                speed: torrent.downloadSpeed / 1024 / 1024 // MB/s
            };
            const newHistory = [...prev, newPoint];
            if (newHistory.length > 20) newHistory.shift();
            return newHistory;
        });
    }, [torrent.downloadSpeed]);

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
                    <div className="h-64 bg-secondary/50 rounded-xl p-4 border border-border">
                        <h4 className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                            <Activity size={14} /> Download Speed (MB/s)
                        </h4>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={speedHistory} margin={{ top: 10, right: 10, left: -20, bottom: 35 }}>
                                <defs>
                                    <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
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
                                    formatter={(val) => [`${val.toFixed(2)} MB/s`, 'Speed']}
                                />
                                <Area type="monotone" dataKey="speed" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSpeed)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
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
                            <div className="text-xs text-blue-500 mt-1">
                                of {formatBytes(torrent.length)}
                            </div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Clock size={16} /> <span className="text-xs font-medium">Time Left</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">
                                {formatTime(torrent.timeRemaining)}
                            </div>
                        </div>
                        <div className="bg-secondary/50 p-4 rounded-xl border border-border col-span-2">
                            <div className="flex items-center gap-2 text-muted-foreground mb-2">
                                <Activity size={16} /> <span className="text-xs font-medium">Share Ratio</span>
                            </div>
                            <div className="text-2xl font-bold text-foreground">{torrent.ratio?.toFixed(2) || '0.00'}</div>
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
                                    <FileTreeNode key={node.name} node={node} level={0} onToggleFile={onToggleFile} />
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
        </div>
    );
};

export default TorrentDetails;
