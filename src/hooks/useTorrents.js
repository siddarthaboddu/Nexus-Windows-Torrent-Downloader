import { useState, useEffect, useCallback } from 'react';

export function useTorrents() {
    const [torrents, setTorrents] = useState([]);

    useEffect(() => {
        // Listen for updates from main process
        if (!window.ipcRenderer) return;

        const removeListener = window.ipcRenderer.on('torrents-update', (data) => {
            setTorrents(data);
        });

        return () => {
            removeListener();
        };
    }, []);

    const addTorrent = useCallback(async (magnetLink, path) => {
        try {
            const result = await window.ipcRenderer.invoke('add-torrent', magnetLink, path);
            console.log('Torrent added:', result);
            return result;
        } catch (error) {
            console.error('Failed to add torrent:', error);
            throw error;
        }
    }, []);

    const selectFolder = useCallback(async () => {
        return await window.ipcRenderer.invoke('select-folder');
    }, []);

    const openFolder = useCallback(async (infoHash) => {
        await window.ipcRenderer.invoke('open-torrent-folder', infoHash);
    }, []);

    const removeTorrent = useCallback(async (infoHash, deleteData = false) => {
        await window.ipcRenderer.invoke('remove-torrent', infoHash, deleteData);
    }, []);

    const pauseTorrent = useCallback(async (infoHash) => {
        await window.ipcRenderer.invoke('pause-torrent', infoHash);
    }, []);

    const resumeTorrent = useCallback(async (infoHash) => {
        await window.ipcRenderer.invoke('resume-torrent', infoHash);
    }, []);

    const reverify = useCallback(async (infoHash) => {
        await window.ipcRenderer.invoke('reverify-torrent', infoHash);
    }, []);

    const toggleFileSelection = useCallback(async (infoHash, fileIndexOrIndices, selected) => {
        await window.ipcRenderer.invoke('toggle-file-selection', infoHash, fileIndexOrIndices, selected);
    }, []);

    const pauseAll = useCallback(async () => {
        await window.ipcRenderer.invoke('pause-all-torrents');
    }, []);

    const resumeAll = useCallback(async () => {
        await window.ipcRenderer.invoke('resume-all-torrents');
    }, []);

    return { torrents, addTorrent, removeTorrent, pauseTorrent, resumeTorrent, selectFolder, openFolder, reverify, toggleFileSelection, pauseAll, resumeAll };
}
