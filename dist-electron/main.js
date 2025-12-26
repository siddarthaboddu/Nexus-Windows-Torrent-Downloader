"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_url = require("node:url");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
const __dirname$1 = path.dirname(node_url.fileURLToPath(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("main.js", document.baseURI).href));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(__dirname$1, "../public");
let win;
let client;
const CONFIG_PATH = path.join(electron.app.getPath("userData"), "nexus-config.json");
async function getLastDownloadPath() {
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(data);
    if (config.downloadPath) return config.downloadPath;
  } catch (e) {
  }
  return path.join(os.homedir(), "Downloads", "Nexus");
}
async function saveLastDownloadPath(downloadPath) {
  try {
    let config = {};
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8");
      config = JSON.parse(data);
    } catch {
    }
    config.downloadPath = downloadPath;
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}
async function initWebTorrent() {
  const { default: WebTorrent } = await import("webtorrent");
  client = new WebTorrent();
  client.on("error", (err) => {
    console.error("WebTorrent Error:", err);
  });
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
    const config = JSON.parse(data || "{}");
    if (config.downloadLimit) client.throttleDownload(config.downloadLimit);
    if (config.uploadLimit) client.throttleUpload(config.uploadLimit);
  } catch (e) {
    console.error("Failed to apply limits:", e);
  }
}
let managedTorrents = [];
let isSaving = false;
let saveQueued = false;
let lastSaveTime = 0;
const SAVE_THROTTLE = 2e3;
async function saveTorrentsState() {
  if (isSaving) {
    saveQueued = true;
    return;
  }
  const now = Date.now();
  if (now - lastSaveTime < SAVE_THROTTLE) {
    if (!saveQueued) {
      saveQueued = true;
      setTimeout(saveTorrentsState, SAVE_THROTTLE - (now - lastSaveTime));
    }
    return;
  }
  isSaving = true;
  saveQueued = false;
  lastSaveTime = now;
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
    const config = JSON.parse(data || "{}");
    config.torrents = managedTorrents;
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save state:", e);
  } finally {
    isSaving = false;
    if (saveQueued) {
      saveTorrentsState();
    }
  }
}
async function loadTorrentsState() {
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
    const config = JSON.parse(data || "{}");
    if (Array.isArray(config.torrents)) {
      managedTorrents = config.torrents;
    }
  } catch (e) {
  }
}
function setupIpcHandlers() {
  electron.ipcMain.handle("select-folder", async () => {
    const defaultPath = await getLastDownloadPath();
    const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
      title: "Select Download Destination",
      defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });
  electron.ipcMain.handle("add-torrent", async (event, torrentId, destinationPath) => {
    if (!client) await initWebTorrent();
    console.log("[DEBUG] add-torrent called with:", torrentId);
    let downloadDir = destinationPath;
    if (!downloadDir) {
      const defaultPath = await getLastDownloadPath();
      const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
        title: "Select Download Destination",
        defaultPath,
        properties: ["openDirectory", "createDirectory"]
      });
      if (canceled || filePaths.length === 0) {
        throw new Error("Selection canceled");
      }
      downloadDir = filePaths[0];
    }
    await saveLastDownloadPath(downloadDir);
    let torrentSource = torrentId;
    if (typeof torrentId === "string" && (torrentId.endsWith(".torrent") || torrentId.includes(path.sep))) {
      try {
        const buffer = await fs.readFile(torrentId);
        console.log("[DEBUG] Read file to buffer, size:", buffer.length);
        torrentSource = buffer;
      } catch (e) {
        console.warn("[WARN] Failed to read torrent file path, using raw string:", e);
      }
    }
    return new Promise((resolve, reject) => {
      try {
        console.log("[DEBUG] Calling client.add with type:", typeof torrentSource, Buffer.isBuffer(torrentSource) ? "Buffer" : "String");
        client.add(torrentSource, { path: downloadDir }, (torrent) => {
          const exists = managedTorrents.find((t) => t.infoHash === torrent.infoHash);
          if (!exists) {
            managedTorrents.push({
              infoHash: torrent.infoHash,
              magnetURI: torrent.magnetURI,
              path: downloadDir,
              paused: false,
              name: torrent.name
            });
            saveTorrentsState();
          }
          torrent.on("trackerAnnounce", () => {
            console.log(`[Announce] ${torrent.name} announced to tracker`);
          });
          resolve({
            infoHash: torrent.infoHash,
            name: torrent.name,
            magnetURI: torrent.magnetURI
          });
        });
      } catch (err) {
        console.error("Failed to add torrent:", err);
        reject(err);
      }
    });
  });
  electron.ipcMain.handle("open-torrent-folder", async (event, infoHash) => {
    const torrent = activeMap.get(infoHash) || managedTorrents.find((t) => t.infoHash === infoHash);
    if (torrent && torrent.path) {
      torrent.path;
      const possiblePath = path.join(torrent.path, torrent.name);
      try {
        await fs.access(possiblePath);
        electron.shell.openPath(possiblePath);
      } catch {
        electron.shell.openPath(torrent.path);
      }
    }
  });
  electron.ipcMain.handle("get-download-path", async () => {
    return await getLastDownloadPath();
  });
  electron.ipcMain.handle("get-config", async () => {
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
      return JSON.parse(data || "{}");
    } catch {
      return {};
    }
  });
  electron.ipcMain.handle("set-config", async (event, newConfig) => {
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
      const config = JSON.parse(data || "{}");
      const updated = { ...config, ...newConfig };
      await fs.writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2));
      if (client) {
        if (typeof newConfig.downloadLimit === "number") {
          console.log("[Config] Setting download limit:", newConfig.downloadLimit);
          client.throttleDownload(newConfig.downloadLimit === 0 ? -1 : newConfig.downloadLimit);
        }
        if (typeof newConfig.uploadLimit === "number") {
          console.log("[Config] Setting upload limit:", newConfig.uploadLimit);
          client.throttleUpload(newConfig.uploadLimit === 0 ? -1 : newConfig.uploadLimit);
        }
      }
      return updated;
    } catch (e) {
      console.error("Failed to update config:", e);
      throw e;
    }
  });
  electron.ipcMain.handle("get-torrents", async () => {
    const activeMap2 = /* @__PURE__ */ new Map();
    if (client) {
      client.torrents.forEach((t) => {
        activeMap2.set(t.infoHash, {
          infoHash: t.infoHash,
          name: t.name,
          progress: t.progress,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          numPeers: t.numPeers,
          timeRemaining: t.timeRemaining,
          downloaded: t.downloaded,
          length: t.length,
          ratio: t.ratio,
          state: t.done ? "Seeding" : "Downloading",
          paused: false
        });
      });
    }
    return managedTorrents.map((managed) => {
      const active = activeMap2.get(managed.infoHash);
      if (active) {
        if (!managed.name && active.name) {
          managed.name = active.name;
          saveTorrentsState();
        }
        return active;
      } else {
        return {
          infoHash: managed.infoHash,
          name: managed.name || "Paused Torrent",
          progress: managed.done || managed.progress >= 1 ? 1 : managed.progress || 0,
          downloadSpeed: 0,
          uploadSpeed: 0,
          numPeers: 0,
          timeRemaining: 0,
          downloaded: managed.done && managed.length ? managed.length : managed.downloaded || 0,
          length: managed.length || 0,
          ratio: managed.ratio || 0,
          state: managed.done || managed.progress >= 1 ? "Completed" : "Paused",
          paused: true,
          done: managed.done || managed.progress >= 1
        };
      }
    });
  });
  electron.ipcMain.handle("remove-torrent", async (event, infoHash, deleteData) => {
    let t = managedTorrents.find((t2) => t2.infoHash === infoHash);
    if (!t && client) {
      const active = client.get(infoHash);
      if (active) t = { name: active.name, path: active.path };
    }
    if (client) {
      try {
        client.remove(infoHash, (e) => {
        });
      } catch (e) {
      }
    }
    managedTorrents = managedTorrents.filter((mt) => mt.infoHash !== infoHash);
    await saveTorrentsState();
    if (deleteData && t && t.path) {
      try {
        const fullPath = path.join(t.path, t.name);
        await fs.rm(fullPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Failed to delete files:", e);
      }
    }
  });
  electron.ipcMain.handle("pause-torrent", (event, infoHash) => {
    if (!client) return;
    const torrent = client.get(infoHash);
    const t = managedTorrents.find((t2) => t2.infoHash === infoHash);
    if (t) {
      if (torrent) {
        if (typeof torrent.progress === "number") {
          if (t.done) {
            t.progress = 1;
          } else {
            t.progress = Math.max(t.progress || 0, torrent.progress);
          }
        }
        if (typeof torrent.downloaded === "number") {
          t.downloaded = Math.max(t.downloaded || 0, torrent.downloaded);
        }
        t.length = torrent.length || t.length;
        t.ratio = Math.max(t.ratio || 0, torrent.ratio || 0);
        t.done = t.done || torrent.done || typeof torrent.progress === "number" && torrent.progress >= 1;
        console.log(`[DEBUG] Pausing ${t.name}: ManagedProgress=${t.progress}, ManagedDone=${t.done}`);
      } else {
        console.log(`[DEBUG] Pausing ${t.name} but active torrent not found!`);
      }
      t.paused = true;
      saveTorrentsState();
    }
    if (torrent) {
      try {
        client.remove(infoHash, (err) => {
          if (err) console.warn(err);
        });
      } catch (e) {
        console.warn("Remove failed:", e);
      }
    }
  });
  electron.ipcMain.handle("resume-torrent", (event, infoHash) => {
    if (!client) return;
    const t = managedTorrents.find((t2) => t2.infoHash === infoHash);
    if (t) {
      client.add(t.magnetURI, { path: t.path }, (torrent) => {
      });
      t.paused = false;
      saveTorrentsState();
    }
  });
}
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    // Frameless for custom UI
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "Nexus",
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0a",
      symbolColor: "#ffffff",
      height: 32
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
    if (client) client.destroy();
  }
});
async function restoreSession() {
  if (!client || managedTorrents.length === 0) return;
  console.log(`[Startup] Restoring ${managedTorrents.length} sessions...`);
  managedTorrents.forEach((t) => {
    if (!t.paused) {
      try {
        console.log(`[Startup] Resuming: ${t.name || t.infoHash}`);
        client.add(t.magnetURI, { path: t.path }, (torrent) => {
          console.log(`[Startup] Active: ${torrent.name}`);
        });
      } catch (e) {
        console.error(`[Startup] Failed to resume ${t.infoHash}:`, e);
      }
    }
  });
}
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(async () => {
  await loadTorrentsState();
  await initWebTorrent();
  await restoreSession();
  setupIpcHandlers();
  createWindow();
  setInterval(() => {
    if (win) {
      const activeMap2 = /* @__PURE__ */ new Map();
      if (client) {
        client.torrents.forEach((t) => {
          const connectedSeeds = t.wires.filter((w) => w.isSeeder).length;
          const connectedPeers = t.wires.length - connectedSeeds;
          activeMap2.set(t.infoHash, {
            infoHash: t.infoHash,
            name: t.name,
            progress: t.progress,
            downloadSpeed: t.downloadSpeed,
            uploadSpeed: t.uploadSpeed,
            numPeers: t.numPeers,
            // Total connected
            connectedSeeds,
            connectedPeers,
            timeRemaining: t.timeRemaining / 1e3,
            // ms to s
            downloaded: t.downloaded,
            length: t.length,
            ratio: t.ratio,
            state: t.done ? "Seeding" : "Downloading",
            paused: false,
            files: t.files.map((f) => ({
              name: f.name,
              path: f.path,
              length: f.length,
              downloaded: f.downloaded,
              progress: f.progress
            }))
          });
        });
      }
      const uiTorrents = managedTorrents.map((managed) => {
        const active = activeMap2.get(managed.infoHash);
        if (active) {
          managed.progress = active.progress;
          managed.downloaded = active.downloaded;
          managed.length = active.length;
          managed.ratio = active.ratio;
          managed.name = active.name || managed.name;
          managed.done = active.state === "Seeding" || active.progress >= 1;
          if (managed.done) {
            console.log(`[DEBUG] Syncing completed: ${managed.name} (${managed.progress})`);
          }
          return active;
        }
        return {
          infoHash: managed.infoHash,
          name: managed.name || "Paused",
          progress: managed.done ? 1 : managed.progress || 0,
          downloadSpeed: 0,
          uploadSpeed: 0,
          numPeers: 0,
          timeRemaining: 0,
          downloaded: managed.done && managed.length ? managed.length : managed.downloaded || 0,
          length: managed.length || 0,
          ratio: managed.ratio || 0,
          state: managed.done ? "Completed" : "Paused",
          paused: true,
          done: managed.done || false
        };
      });
      win.webContents.send("torrents-update", uiTorrents);
      saveTorrentsState();
    }
  }, 1e3);
  await loadTorrentsState();
  win.webContents.openDevTools();
});
