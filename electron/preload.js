import { contextBridge, ipcRenderer } from 'electron'

const listenerMap = new Map()

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
    on: (channel, listener) => {
        const subscription = (event, ...args) => listener(...args)
        if (!listenerMap.has(listener)) {
            listenerMap.set(listener, new Map())
        }
        listenerMap.get(listener).set(channel, subscription)
        ipcRenderer.on(channel, subscription)
        return () => {
            ipcRenderer.removeListener(channel, subscription)
            const map = listenerMap.get(listener)
            if (map) {
                map.delete(channel)
                if (map.size === 0) listenerMap.delete(listener)
            }
        }
    },
    off: (channel, listener) => {
        const map = listenerMap.get(listener)
        if (map && map.has(channel)) {
            const subscription = map.get(channel)
            ipcRenderer.removeListener(channel, subscription)
            map.delete(channel)
            if (map.size === 0) listenerMap.delete(listener)
        } else {
            ipcRenderer.removeListener(channel, listener)
        }
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
