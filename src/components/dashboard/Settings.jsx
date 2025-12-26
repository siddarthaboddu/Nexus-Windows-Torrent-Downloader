import React, { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeProvider';
import { Folder, Moon, Sun, Monitor, ArrowDown } from 'lucide-react';
import clsx from 'clsx';

const Settings = () => {
    const [config, setConfig] = useState({
        downloadPath: '',
        theme: 'dark' // Default
    });
    const [isLoading, setIsLoading] = useState(true);

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
                insomniaMode: cfg.insomniaMode
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

    const updateConfig = async (newValues) => {
        // Optimistic update
        const updated = { ...config, ...newValues };
        setConfig(updated);

        // If theme is in newValues, it's handled by setTheme separately if needed, 
        // but here we are primarily updating OTHER config. 
        // Actually, let's separate theme updates to use setTheme via the UI buttons directly.

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
                            value={config.downloadLimit !== undefined ? config.downloadLimit / 1024 : ''}
                            onChange={(e) => setConfig({ ...config, downloadLimit: Number(e.target.value) * 1024 })}
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
                            value={config.uploadLimit !== undefined ? config.uploadLimit / 1024 : ''}
                            onChange={(e) => setConfig({ ...config, uploadLimit: Number(e.target.value) * 1024 })}
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
