import React, { useState } from 'react';
import { useTheme } from '../../contexts/ThemeProvider';
import { LayoutDashboard, ArrowDownUp, Film, Settings, Activity, Sun, Moon } from 'lucide-react';
import clsx from 'clsx';

const NavItem = ({ icon: Icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={clsx(
            "flex items-center w-full p-3 mb-2 rounded-xl transition-all duration-300 group",
            active
                ? "bg-primary/20 text-primary shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
    >
        <Icon size={20} className={clsx("mr-3", active && "animate-pulse")} />
        <span className="font-medium">{label}</span>
        {active && <div className="ml-auto w-1 h-1 bg-primary rounded-full shadow-[0_0_10px_currentColor]" />}
    </button>
);

const formatBytes = (bytes) => {
    if (bytes === 0) return '0 KB/s';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}/s`;
};

const Sidebar = ({ activeTab, setActiveTab, stats = { downloadSpeed: 0, uploadSpeed: 0 }, config = {} }) => {
    const { theme, setTheme } = useTheme();
    const [peakDown, setPeakDown] = useState(10 * 1024 * 1024);
    const [peakUp, setPeakUp] = useState(2 * 1024 * 1024);

    if (stats.downloadSpeed > peakDown) {
        setPeakDown(stats.downloadSpeed);
    }
    if (stats.uploadSpeed > peakUp) {
        setPeakUp(stats.uploadSpeed);
    }

    const maxDown = (config?.downloadLimit && config.downloadLimit > 0) ? config.downloadLimit : Math.max(peakDown, 10 * 1024 * 1024);
    const maxUp = (config?.uploadLimit && config.uploadLimit > 0) ? config.uploadLimit : Math.max(peakUp, 2 * 1024 * 1024);

    const downPercent = Math.min(Math.round((stats.downloadSpeed / maxDown) * 100), 100);
    const upPercent = Math.min(Math.round((stats.uploadSpeed / maxUp) * 100), 100);

    return (
        <aside className="w-64 h-full flex flex-col p-4 glass border-r border-border relative z-10 bg-background/60 backdrop-blur-xl">
            <div className="flex items-center gap-3 px-2 mb-10 mt-6">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Activity className="text-white" size={18} />
                </div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-muted-foreground tracking-tight">
                    Nexus Torrent
                </h1>
            </div>

            <nav className="flex-1">
                <NavItem
                    icon={LayoutDashboard}
                    label="Dashboard"
                    active={activeTab === 'dashboard'}
                    onClick={() => setActiveTab('dashboard')}
                />
                <NavItem
                    icon={ArrowDownUp}
                    label="Transfers"
                    active={activeTab === 'transfers'}
                    onClick={() => setActiveTab('transfers')}
                />
                <NavItem
                    icon={Film}
                    label="Stream Video"
                    active={activeTab === 'stream'}
                    onClick={() => setActiveTab('stream')}
                />
                <NavItem
                    icon={Settings}
                    label="Settings"
                    active={activeTab === 'settings'}
                    onClick={() => setActiveTab('settings')}
                />
            </nav>

            {/* Theme Toggle */}
            <div className="mb-4">
                {(() => {
                    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                    return (
                        <button
                            onClick={() => setTheme(isDark ? 'light' : 'dark')}
                            className="flex items-center justify-between w-full p-3 rounded-xl bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-all duration-300 border border-border/50"
                        >
                            <span className="text-sm font-medium flex items-center gap-2">
                                {isDark ? <Moon size={16} /> : <Sun size={16} />}
                                {isDark ? 'Dark Mode' : 'Light Mode'}
                            </span>
                            <div className={clsx(
                                "w-8 h-4 rounded-full relative transition-colors duration-300",
                                isDark ? "bg-primary/50" : "bg-slate-300"
                            )}>
                                <div className={clsx(
                                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-300 shadow-sm",
                                    isDark ? "left-4.5 translate-x-3.5" : "left-0.5"
                                )} />
                            </div>
                        </button>
                    );
                })()}
            </div>

            {/* Mini Stats in Sidebar */}
            <div className="p-4 rounded-xl bg-card/40 border border-border backdrop-blur-sm">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-muted-foreground">Down</span>
                    <span className="text-xs font-mono text-emerald-400">{formatBytes(stats.downloadSpeed)}</span>
                </div>
                <div className="w-full h-1 bg-secondary rounded-full mb-3 overflow-hidden" title={`Limit/Peak: ${formatBytes(maxDown)}`}>
                    <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${downPercent}%` }} />
                </div>
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-muted-foreground">Up</span>
                    <span className="text-xs font-mono text-blue-400">{formatBytes(stats.uploadSpeed)}</span>
                </div>
                <div className="w-full h-1 bg-secondary rounded-full overflow-hidden" title={`Limit/Peak: ${formatBytes(maxUp)}`}>
                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${upPercent}%` }} />
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
