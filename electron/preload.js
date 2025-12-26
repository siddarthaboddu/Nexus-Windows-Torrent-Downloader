import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
    on: (channel, listener) => {
        const subscription = (event, ...args) => listener(...args)
        ipcRenderer.on(channel, subscription)
        return () => ipcRenderer.removeListener(channel, subscription)
    },
    off: (channel, ...args) => {
        ipcRenderer.removeListener(channel, ...args)
    },
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel)
    },
    send: (channel, ...args) => {
        ipcRenderer.send(channel, ...args)
    },
    invoke: (channel, ...args) => {
        return ipcRenderer.invoke(channel, ...args)
    },
})
