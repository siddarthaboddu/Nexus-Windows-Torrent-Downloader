import React from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';

const DeleteTorrentModal = ({ isOpen, onClose, onConfirm, torrentName }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 relative animate-in zoom-in-95 duration-200">

                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center mb-6">
                    <div className="p-3 bg-red-500/10 text-red-500 rounded-xl mb-4">
                        <AlertTriangle size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-foreground mb-2">Remove Torrent?</h2>
                    <p className="text-muted-foreground text-sm">
                        Are you sure you want to remove <span className="text-foreground font-medium">"{torrentName}"</span>?
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => onConfirm(false)}
                        className="w-full py-3 px-4 bg-secondary hover:bg-secondary/80 text-foreground rounded-xl font-medium transition-colors border border-border flex items-center justify-center gap-2"
                    >
                        Remove from list
                    </button>

                    <button
                        onClick={() => onConfirm(true)}
                        className="w-full py-3 px-4 bg-destructive/10 hover:bg-destructive/20 text-destructive hover:text-destructive rounded-xl font-medium transition-colors border border-destructive/20 flex items-center justify-center gap-2 group"
                    >
                        <Trash2 size={18} className="group-hover:scale-110 transition-transform" />
                        Remove with data
                    </button>

                    <button
                        onClick={onClose}
                        className="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteTorrentModal;
