import React, { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeProvider';
import { Folder, Moon, Sun, Monitor, ArrowDown, Shield, RefreshCw, Bell, Volume2, Play, Upload, Timer, FolderSearch, Archive, Wifi } from 'lucide-react';
import clsx from 'clsx';

const Settings = () => {
    const [config, setConfig] = useState({
        downloadPath: '',
        theme: 'dark' // Default
    });
    const [isLoading, setIsLoading] = useState(true);
    const [portLoading, setPortLoading] = useState(false);

    const { theme, setTheme } = useTheme();

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const cfg = await window.ipcRenderer.invoke('get-config');
            const resolvedPath = await window.ipcRenderer.invoke('get-download-path');

            setConfig({
                downloadPath: cfg.downloadPath || resolvedPath,
                // Theme is handled by useTheme now, but we keep other config
                downloadLimit: cfg.downloadLimit,
                uploadLimit: cfg.uploadLimit,
                startWithWindows: cfg.startWithWindows,
                minimizeToTray: cfg.minimizeToTray,
                insomniaMode: cfg.insomniaMode,
                networkPort: cfg.networkPort,
                enableNotifications: cfg.enableNotifications !== false, // Default true
                enableSound: cfg.enableSound !== false, // Default true
                compactMode: cfg.compactMode,
                showSpeedInTray: cfg.showSpeedInTray,
                seedRatioLimit: cfg.seedRatioLimit || 0,
                seedTimeLimitMin: cfg.seedTimeLimitMin || 0,
                speedSchedule: cfg.speedSchedule || { enabled: false, start: '22:00', end: '08:00', dlKB: 0, ulKB: 0 },
                watchFolder: cfg.watchFolder || '',
                moveCompletedTo: cfg.moveCompletedTo || '',
                lanSharing: !!cfg.lanSharing,
                maxConns: cfg.maxConns || 1000
            });
        } catch (e) {
            console.error('Failed to load settings:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectFolder = async () => {
        try {
            const folder = await window.ipcRenderer.invoke('select-folder');
            if (folder) {
                updateConfig({ downloadPath: folder });
            }
        } catch (e) {
            console.error('Failed to select folder:', e);
        }
    };

    const handleSelectWatchFolder = async () => {
        try {
            const folder = await window.ipcRenderer.invoke('select-folder');
            if (folder) {
                updateConfig({ watchFolder: folder });
            }
        } catch (e) {
            console.error('Failed to select watch folder:', e);
        }
    };

    const handleSelectCompletedFolder = async () => {
        try {
            const folder = await window.ipcRenderer.invoke('select-folder');
            if (folder) {
                updateConfig({ moveCompletedTo: folder });
            }
        } catch (e) {
            console.error('Failed to select completed folder:', e);
        }
    };

    const updateConfig = async (newValues) => {
        // Optimistic update
        const updated = { ...config, ...newValues };
        setConfig(updated);

        try {
            await window.ipcRenderer.invoke('set-config', newValues);
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    };

    if (isLoading) {
        return <div className="p-12 text-center text-muted-foreground">Loading settings...</div>;
    }

    return (
        <div className="space-y-8 animate-in slide-in-from-bottom-5 duration-500">
            {/* Download Location */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Folder className="text-primary" />
                    <h3 className="text-lg font-semibold">Download Location</h3>
                </div>
                <p className="text-sm text-muted-foreground">Default folder for new downloads.</p>

                <div className="flex gap-3">
                    <div className="flex-1 p-3 bg-secondary/50 rounded-lg border border-border/50 text-sm font-mono truncate text-muted-foreground">
                        {config.downloadPath || 'Not set'}
                    </div>
                    <button
                        onClick={handleSelectFolder}
                        className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground font-medium rounded-lg transition-colors"
                    >
                        Change
                    </button>
                </div>

                <div className="flex items-center gap-3 pt-2">
                    <FolderSearch size={16} className="text-sky-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">Watch Folder <span className="text-xs text-muted-foreground font-normal">— auto-add dropped .torrent files</span></p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{config.watchFolder || 'Off'}</p>
                    </div>
                    {config.watchFolder ? (
                        <button
                            onClick={() => updateConfig({ watchFolder: '' })}
                            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium rounded-lg transition-colors"
                        >
                            Disable
                        </button>
                    ) : (
                        <button
                            onClick={handleSelectWatchFolder}
                            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium rounded-lg transition-colors"
                        >
                            Choose
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <Archive size={16} className="text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">Completed Folder <span className="text-xs text-muted-foreground font-normal">— move finished downloads here</span></p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{config.moveCompletedTo || 'Off'}</p>
                    </div>
                    {config.moveCompletedTo ? (
                        <button
                            onClick={() => updateConfig({ moveCompletedTo: '' })}
                            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium rounded-lg transition-colors"
                        >
                            Disable
                        </button>
                    ) : (
                        <button
                            onClick={handleSelectCompletedFolder}
                            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium rounded-lg transition-colors"
                        >
                            Choose
                        </button>
                    )}
                </div>
            </div>

            {/* Appearance */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Sun className="text-yellow-500" />
                    <h3 className="text-lg font-semibold">Appearance</h3>
                </div>
                <p className="text-sm text-muted-foreground">Choose your preferred interface theme.</p>

                <div className="grid grid-cols-3 gap-4">
                    <ThemeOption
                        label="Dark"
                        icon={Moon}
                        active={theme === 'dark'}
                        onClick={() => setTheme('dark')}
                    />
                    <ThemeOption
                        label="Light"
                        icon={Sun}
                        active={theme === 'light'}
                        onClick={() => setTheme('light')}
                    />
                    <ThemeOption
                        label="System"
                        icon={Monitor}
                        active={theme === 'system'}
                        onClick={() => setTheme('system')}
                    />
                </div>
            </div>

            {/* System Settings */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Monitor className="text-purple-500" />
                    <h3 className="text-lg font-semibold">System</h3>
                </div>
                <p className="text-sm text-muted-foreground">Manage application behavior and startup.</p>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Start with Windows</p>
                            <p className="text-xs text-muted-foreground">Launch Nexus automatically.</p>
                        </div>
                        <div
                            onClick={() => updateConfig({ startWithWindows: !config.startWithWindows })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.startWithWindows ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.startWithWindows ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Minimize to Tray</p>
                            <p className="text-xs text-muted-foreground">Keep running in background.</p>
                        </div>
                        <div
                            onClick={() => updateConfig({ minimizeToTray: !config.minimizeToTray })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.minimizeToTray ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.minimizeToTray ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Insomnia Mode</p>
                            <p className="text-xs text-muted-foreground">Prevent sleep while downloading.</p>
                        </div>
                        <div
                            onClick={() => updateConfig({ insomniaMode: !config.insomniaMode })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.insomniaMode ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.insomniaMode ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Network Settings */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Shield className="text-emerald-500" />
                    <h3 className="text-lg font-semibold">Network</h3>
                </div>
                <p className="text-sm text-muted-foreground">Manage connection and privacy settings.</p>

                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-secondary/20 p-4 rounded-xl border border-border/50">
                            <label className="block text-sm font-medium text-foreground mb-2">Incoming Port</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    value={config.networkPort || ''}
                                    placeholder="e.g. 52621"
                                    onChange={(e) => setConfig({ ...config, networkPort: parseInt(e.target.value) || 0 })}
                                    className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                                />
                                <button
                                    onClick={async () => {
                                        setPortLoading(true);
                                        try {
                                            const port = await window.ipcRenderer.invoke('get-random-port');
                                            updateConfig({ networkPort: port }); // Save immediately
                                        } finally {
                                            setPortLoading(false);
                                        }
                                    }}
                                    disabled={portLoading}
                                    className="p-2 bg-secondary hover:bg-secondary/80 rounded-lg text-foreground transition-colors disabled:opacity-50"
                                    title="Randomize Port"
                                >
                                    <RefreshCw size={20} className={portLoading ? "animate-spin" : ""} />
                                </button>
                                <button
                                    onClick={() => updateConfig({ networkPort: config.networkPort })}
                                    className="px-3 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors text-sm"
                                >
                                    Apply
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Changing the port will restart the connection engine.
                            </p>
                        </div>

                        <div className="bg-secondary/20 p-4 rounded-xl border border-border/50">
                            <label className="block text-sm font-medium text-foreground mb-2">Max Swarm Connections</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="50"
                                    max="2000"
                                    step="50"
                                    value={config.maxConns || 1000}
                                    placeholder="e.g. 1000"
                                    onChange={(e) => setConfig({ ...config, maxConns: parseInt(e.target.value) || 0 })}
                                    className="flex-1 bg-background/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                                />
                                <button
                                    onClick={() => updateConfig({ maxConns: config.maxConns || 1000 })}
                                    className="px-3 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors text-sm"
                                >
                                    Apply
                                </button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Max concurrent seeds & peers to connect to (default: 1000, max: 2000).
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div className="flex items-center gap-2">
                            <Wifi size={16} className="text-muted-foreground" />
                            <div>
                                <p className="text-sm font-medium text-foreground">LAN Sharing</p>
                                <p className="text-xs text-muted-foreground">Let phones, TVs and PCs on your network reach active streams. Applies to the next stream.</p>
                            </div>
                        </div>
                        <div
                            onClick={() => updateConfig({ lanSharing: !config.lanSharing })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.lanSharing ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.lanSharing ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Notification Settings */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Bell className="text-amber-500" />
                    <h3 className="text-lg font-semibold">Notifications</h3>
                </div>
                <p className="text-sm text-muted-foreground">Configure alerts and sounds.</p>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Enable Desktop Alerts</p>
                            <p className="text-xs text-muted-foreground">Show popup when download finishes.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => window.ipcRenderer.invoke('test-notification')}
                                className="p-2 bg-secondary hover:bg-secondary/80 rounded-full text-foreground transition-colors"
                                title="Test Notification"
                            >
                                <Bell size={14} className="fill-current" />
                            </button>
                            <div
                                onClick={() => updateConfig({ enableNotifications: !config.enableNotifications })}
                                className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.enableNotifications ? "bg-primary" : "bg-secondary")}
                            >
                                <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.enableNotifications ? "translate-x-6" : "translate-x-0")} />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div className="flex items-center gap-2">
                            <Volume2 size={16} className="text-muted-foreground" />
                            <div>
                                <p className="text-sm font-medium text-foreground">Play Sound on Completion</p>
                                <p className="text-xs text-muted-foreground">Play a subtle chime.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => window.ipcRenderer.invoke('play-sound')}
                                className="p-2 bg-secondary hover:bg-secondary/80 rounded-full text-foreground transition-colors"
                                title="Test Sound"
                            >
                                <Play size={14} className="fill-current" />
                            </button>
                            <div
                                onClick={() => updateConfig({ enableSound: !config.enableSound })}
                                className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.enableSound ? "bg-primary" : "bg-secondary")}
                            >
                                <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.enableSound ? "translate-x-6" : "translate-x-0")} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* UI Customization */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <Monitor className="text-pink-500" />
                    <h3 className="text-lg font-semibold">Interface</h3>
                </div>
                <p className="text-sm text-muted-foreground">Customize the look and feel.</p>

                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Compact Mode</p>
                            <p className="text-xs text-muted-foreground">Denser list view with smaller padding.</p>
                        </div>
                        <div
                            onClick={() => updateConfig({ compactMode: !config.compactMode })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.compactMode ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.compactMode ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                        <div>
                            <p className="text-sm font-medium text-foreground">Show Speed in Tray</p>
                            <p className="text-xs text-muted-foreground">Display DL/UL speeds in tray tooltip.</p>
                        </div>
                        <div
                            onClick={() => updateConfig({ showSpeedInTray: !config.showSpeedInTray })}
                            className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.showSpeedInTray ? "bg-primary" : "bg-secondary")}
                        >
                            <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.showSpeedInTray ? "translate-x-6" : "translate-x-0")} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Bandwidth Limits */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <div className="p-1 bg-emerald-500/10 rounded">
                        <ArrowDown className="text-emerald-500" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold">Bandwidth Limits</h3>
                </div>
                <p className="text-sm text-muted-foreground">Set hard limits for transfer speeds (0 = Unlimited).</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            Download Limit <span className="text-xs opacity-50">(KB/s)</span>
                        </label>
                        <input
                            type="number"
                            min="0"
                            placeholder="0 (Unlimited)"
                            value={config.downloadLimit > 0 ? config.downloadLimit / 1024 : ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setConfig({ ...config, downloadLimit: val === '' ? 0 : Math.max(0, Number(val)) * 1024 });
                            }}
                            className="w-full bg-secondary/50 border border-border/50 rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            Upload Limit <span className="text-xs opacity-50">(KB/s)</span>
                        </label>
                        <input
                            type="number"
                            min="0"
                            placeholder="0 (Unlimited)"
                            value={config.uploadLimit > 0 ? config.uploadLimit / 1024 : ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setConfig({ ...config, uploadLimit: val === '' ? 0 : Math.max(0, Number(val)) * 1024 });
                            }}
                            className="w-full bg-secondary/50 border border-border/50 rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={() => updateConfig({ downloadLimit: config.downloadLimit, uploadLimit: config.uploadLimit })}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                    >
                        Save Limits
                    </button>
                </div>
            </div>

            {/* Speed Scheduler */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <div className="p-1 bg-sky-500/10 rounded">
                        <Timer className="text-sky-500" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold">Speed Scheduler</h3>
                </div>
                <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-xl border border-border/50">
                    <div>
                        <p className="text-sm font-medium text-foreground">Scheduled Caps</p>
                        <p className="text-xs text-muted-foreground">Apply different limits during a daily window (e.g. capped daytime, unlimited overnight).</p>
                    </div>
                    <div
                        onClick={() => updateConfig({ speedSchedule: { ...(config.speedSchedule || {}), enabled: !(config.speedSchedule?.enabled) } })}
                        className={clsx("w-12 h-6 rounded-full p-1 cursor-pointer transition-colors relative", config.speedSchedule?.enabled ? "bg-primary" : "bg-secondary")}
                    >
                        <div className={clsx("w-4 h-4 rounded-full bg-white shadow-sm transition-transform", config.speedSchedule?.enabled ? "translate-x-6" : "translate-x-0")} />
                    </div>
                </div>

                {config.speedSchedule?.enabled && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">From</label>
                            <input
                                type="time"
                                value={config.speedSchedule?.start || '22:00'}
                                onChange={(e) => setConfig({ ...config, speedSchedule: { ...config.speedSchedule, start: e.target.value } })}
                                className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">To</label>
                            <input
                                type="time"
                                value={config.speedSchedule?.end || '08:00'}
                                onChange={(e) => setConfig({ ...config, speedSchedule: { ...config.speedSchedule, end: e.target.value } })}
                                className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Down (KB/s)</label>
                            <input
                                type="number"
                                min="0"
                                placeholder="0 = Unlimited"
                                value={config.speedSchedule?.dlKB || ''}
                                onChange={(e) => setConfig({ ...config, speedSchedule: { ...config.speedSchedule, dlKB: Math.max(0, Number(e.target.value)) || 0 } })}
                                className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Up (KB/s)</label>
                            <input
                                type="number"
                                min="0"
                                placeholder="0 = Unlimited"
                                value={config.speedSchedule?.ulKB || ''}
                                onChange={(e) => setConfig({ ...config, speedSchedule: { ...config.speedSchedule, ulKB: Math.max(0, Number(e.target.value)) || 0 } })}
                                className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                            />
                        </div>
                    </div>
                )}

                {config.speedSchedule?.enabled && (
                    <div className="flex justify-end pt-2">
                        <button
                            onClick={() => updateConfig({ speedSchedule: config.speedSchedule })}
                            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                        >
                            Save Schedule
                        </button>
                    </div>
                )}
            </div>

            {/* Seeding Goals */}
            <div className="glass-panel p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-white mb-2">
                    <div className="p-1 bg-emerald-500/10 rounded">
                        <Upload className="text-emerald-500" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold">Seeding Goals</h3>
                </div>
                <p className="text-sm text-muted-foreground">Auto-pause finished torrents once a goal is met (0 = off).</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            Target Ratio
                        </label>
                        <input
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="e.g. 2.0"
                            value={config.seedRatioLimit > 0 ? config.seedRatioLimit : ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setConfig({ ...config, seedRatioLimit: val === '' ? 0 : Math.max(0, Number(val)) });
                            }}
                            className="w-full bg-secondary/50 border border-border/50 rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            Seed Time <span className="text-xs opacity-50">(minutes)</span>
                        </label>
                        <input
                            type="number"
                            min="0"
                            placeholder="e.g. 1440"
                            value={config.seedTimeLimitMin > 0 ? config.seedTimeLimitMin : ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                setConfig({ ...config, seedTimeLimitMin: val === '' ? 0 : Math.max(0, Math.round(Number(val))) });
                            }}
                            className="w-full bg-secondary/50 border border-border/50 rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={() => updateConfig({ seedRatioLimit: Number(config.seedRatioLimit) || 0, seedTimeLimitMin: Number(config.seedTimeLimitMin) || 0 })}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                    >
                        Save Goals
                    </button>
                </div>
            </div>
        </div>
    );
};

const ThemeOption = ({ label, icon: Icon, active, onClick }) => (
    <button
        onClick={onClick}
        className={clsx(
            "flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-all duration-200",
            active
                ? "bg-primary/20 border-primary text-primary"
                : "bg-secondary/20 border-border/50 text-muted-foreground hover:bg-secondary/40 hover:border-border"
        )}
    >
        <Icon size={24} />
        <span className="text-sm font-medium">{label}</span>
    </button>
);

export default Settings;
