import React, { useState, useRef, useEffect } from 'react';
import { X, Magnet, Upload, Folder, ArrowRight, ArrowLeft } from 'lucide-react';
import { useTorrents } from '../../hooks/useTorrents';

const AddTorrentModal = ({ isOpen, onClose, onAdd, defaultPath }) => {
    const [step, setStep] = useState(1);
    const [magnet, setMagnet] = useState('');
    const [filePath, setFilePath] = useState(null); // Store selected file path
    const [destination, setDestination] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef(null);
    const { selectFolder } = useTorrents();

    // Update destination when defaultPath changes or modal opens
    useEffect(() => {
        if (defaultPath && !destination) {
            setDestination(defaultPath);
        }
    }, [defaultPath, isOpen]);

    if (!isOpen) return null;

    const resetState = () => {
        setStep(1);
        setMagnet('');
        setFilePath(null);
        // Don't reset destination if we have a default
        setDestination(defaultPath || '');
        setIsLoading(false);
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Read file immediately to ArrayBuffer to ensure we have content
        // This bypasses 'file.path' issues in strict Context Isolation
        const reader = new FileReader();
        reader.onload = (evt) => {
            if (evt.target.readyState === FileReader.DONE) {
                const arrayBuffer = evt.target.result;
                setFilePath({
                    name: file.name,
                    data: arrayBuffer // Store raw data
                });
                setMagnet('');
                setStep(2);
            }
        };
        reader.readAsArrayBuffer(file);

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleNext = () => {
        if (magnet || filePath) setStep(2);
    };

    // useEffect removed to prevent crash. Will implement via props.

    const handleBrowseFolder = async () => {
        try {
            const folder = await selectFolder();
            if (folder) setDestination(folder);
        } catch (error) {
            console.error('Failed to select folder:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            // If filePath has data, wrap in Uint8Array. IPC handles this natively.
            const payload = filePath?.data ? new Uint8Array(filePath.data) : (magnet || filePath);

            await onAdd(payload, destination);
            handleClose();
        } catch (e) {
            console.error(e);
            alert('Failed to add torrent: ' + e.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={handleClose} />

            <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl relative z-10 overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-semibold text-foreground">
                            {step === 1 ? 'Add Torrent' : 'Download Destination'}
                        </h3>
                        <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-full transition-colors text-muted-foreground hover:text-foreground">
                            <X size={20} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {step === 1 ? (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm text-muted-foreground mb-2">Magnet Link or URL</label>
                                    <div className="relative">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                            <Magnet size={18} />
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="magnet:?xt=urn:btih:..."
                                            className="w-full bg-input/50 border border-border rounded-xl py-3 pl-10 pr-4 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all font-mono text-sm"
                                            value={magnet}
                                            onChange={(e) => { setMagnet(e.target.value); setFilePath(null); }}
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handleNext();
                                                }
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="h-px bg-border flex-1" />
                                    <span className="text-xs text-muted-foreground uppercase tracking-widest">OR</span>
                                    <div className="h-px bg-border flex-1" />
                                </div>

                                <input type="file" accept=".torrent" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="w-full py-8 border-2 border-dashed border-border rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all group flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary"
                                >
                                    <Upload size={24} className="group-hover:scale-110 transition-transform" />
                                    <span className="text-sm">Click to select .torrent file</span>
                                </button>

                                <div className="flex justify-end pt-2">
                                    <button
                                        type="button"
                                        disabled={!magnet}
                                        onClick={handleNext}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all"
                                    >
                                        Next <ArrowRight size={16} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="p-4 bg-secondary/50 rounded-lg border border-border/50">
                                    <h4 className="text-sm font-medium text-foreground mb-1">Source</h4>
                                    <p className="text-xs text-muted-foreground font-mono truncate">
                                        {filePath?.name || magnet}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm text-muted-foreground mb-2">Save to</label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                                <Folder size={18} />
                                            </div>
                                            <input
                                                type="text"
                                                readOnly
                                                value={destination || 'Default Download Folder'}
                                                className="w-full bg-input/50 border border-border rounded-xl py-3 pl-10 pr-4 text-foreground cursor-default focus:outline-none"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleBrowseFolder}
                                            className="px-4 py-2 border border-border rounded-xl hover:bg-secondary text-foreground font-medium transition-colors"
                                        >
                                            Browse
                                        </button>
                                    </div>
                                </div>

                                <div className="border-t border-border pt-6 flex justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setStep(1)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                                    >
                                        <ArrowLeft size={16} /> Back
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="px-6 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all"
                                    >
                                        {isLoading ? 'Starting...' : 'Start Download'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AddTorrentModal;
