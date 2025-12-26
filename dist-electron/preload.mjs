"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on: (channel, listener) => {
    const subscription = (event, ...args) => listener(...args);
    electron.ipcRenderer.on(channel, subscription);
    return () => electron.ipcRenderer.removeListener(channel, subscription);
  },
  off: (channel, ...args) => {
    electron.ipcRenderer.removeListener(channel, ...args);
  },
  removeAllListeners: (channel) => {
    electron.ipcRenderer.removeAllListeners(channel);
  },
  send: (channel, ...args) => {
    electron.ipcRenderer.send(channel, ...args);
  },
  invoke: (channel, ...args) => {
    return electron.ipcRenderer.invoke(channel, ...args);
  }
});
