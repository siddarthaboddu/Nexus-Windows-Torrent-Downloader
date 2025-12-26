import { app, BrowserWindow, nativeImage, Tray, Menu, ipcMain, dialog, shell, Notification, powerSaveBlocker } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname$1, "../public");
let win;
let client;
let tray;
let isQuitting = false;
const CONFIG_PATH = path.join(app.getPath("userData"), "nexus-config.json");
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
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]} `;
}
let managedTorrents = [];
let isSaving = false;
let saveQueued = false;
let lastSaveTime = 0;
const SAVE_THROTTLE = 2e3;
let powerSaveId = null;
function updatePowerSaveBlocker() {
  const isDownloading = client && client.torrents.some((t) => !t.done && t.progress < 1 && !t.paused);
  if (isDownloading && !powerSaveId) {
    powerSaveId = powerSaveBlocker.start("prevent-app-suspension");
    console.log("[PowerSave] Enabled blocker (ID:", powerSaveId, ")");
  } else if (!isDownloading && powerSaveId) {
    powerSaveBlocker.stop(powerSaveId);
    console.log("[PowerSave] Disabled blocker (ID:", powerSaveId, ")");
    powerSaveId = null;
  }
}
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
  ipcMain.handle("select-folder", async () => {
    const defaultPath = await getLastDownloadPath();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Select Download Destination",
      defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });
  ipcMain.handle("add-torrent", async (event, torrentId, destinationPath) => {
    if (!client) await initWebTorrent();
    console.log("[DEBUG] add-torrent called with:", torrentId);
    let downloadDir = destinationPath;
    if (!downloadDir) {
      const defaultPath = await getLastDownloadPath();
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
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
          setupTorrentEventListeners(torrent);
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
  ipcMain.handle("open-torrent-folder", async (event, infoHash) => {
    let torrentPath = null;
    let torrentName = null;
    if (client) {
      const active = client.get(infoHash);
      if (active) {
        torrentPath = active.path;
        torrentName = active.name;
      }
    }
    if (!torrentPath) {
      const managed = managedTorrents.find((t) => t.infoHash === infoHash);
      if (managed) {
        torrentPath = managed.path;
        torrentName = managed.name;
      }
    }
    if (torrentPath) {
      const possiblePath = torrentName ? path.join(torrentPath, torrentName) : torrentPath;
      try {
        await fs.access(possiblePath);
        shell.showItemInFolder(possiblePath);
      } catch {
        shell.openPath(torrentPath);
      }
    }
  });
  ipcMain.handle("get-download-path", async () => {
    return await getLastDownloadPath();
  });
  ipcMain.handle("get-config", async () => {
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
      return JSON.parse(data || "{}");
    } catch {
      return {};
    }
  });
  ipcMain.handle("set-config", async (event, newConfig) => {
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
      if (win) {
        win.webContents.send("config-updated", updated);
      }
      return updated;
    } catch (e) {
      console.error("Failed to update config:", e);
      throw e;
    }
  });
  ipcMain.handle("get-torrents", async () => {
    const activeMap = /* @__PURE__ */ new Map();
    if (client) {
      client.torrents.forEach((t) => {
        activeMap.set(t.infoHash, {
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
      const active = activeMap.get(managed.infoHash);
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
  ipcMain.handle("remove-torrent", async (event, infoHash, deleteData) => {
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
  ipcMain.handle("pause-torrent", (event, infoHash) => {
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
        console.log(`[DEBUG] Pausing ${t.name}: ManagedProgress = ${t.progress}, ManagedDone = ${t.done} `);
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
  ipcMain.handle("resume-torrent", (event, infoHash) => {
    if (!client) return;
    const t = managedTorrents.find((t2) => t2.infoHash === infoHash);
    if (t) {
      client.add(t.magnetURI, { path: t.path }, (torrent) => {
      });
      t.paused = false;
      saveTorrentsState();
    }
  });
  ipcMain.handle("play-sound", () => {
    shell.beep();
  });
  ipcMain.handle("get-random-port", async () => {
    return Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
  });
  ipcMain.handle("test-notification", () => {
    console.log("[DEBUG] Testing Notification");
    new Notification({
      title: "Nexus Test",
      body: "This is a test notification from Nexus!",
      silent: false
    }).show();
  });
  ipcMain.handle("reverify-torrent", (event, infoHash) => {
    if (!client) return;
    const t = managedTorrents.find((t2) => t2.infoHash === infoHash);
    if (t) {
      console.log(`[Reverify] Force re-checking ${t.name}...`);
      const active = client.get(infoHash);
      if (active) {
        client.remove(infoHash, (e) => {
          t.paused = false;
          client.add(t.magnetURI, { path: t.path }, (torrent) => {
            console.log(`[Reverify] Started re-check for ${torrent.name}`);
            setupTorrentEventListeners(torrent);
          });
          saveTorrentsState();
        });
      } else {
        t.paused = false;
        client.add(t.magnetURI, { path: t.path }, (torrent) => {
          console.log(`[Reverify] Started re-check for ${torrent.name}`);
          setupTorrentEventListeners(torrent);
        });
        saveTorrentsState();
      }
    }
  });
}
function createWindow() {
  win = new BrowserWindow({
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
  win.on("close", async (event) => {
    if (isQuitting) return;
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
      const config = JSON.parse(data || "{}");
      if (config.minimizeToTray) {
        event.preventDefault();
        win.hide();
        return;
      }
    } catch (e) {
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
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    if (client) client.destroy();
  }
});
async function restoreSession() {
  if (!client || managedTorrents.length === 0) return;
  console.log(`[Startup] Restoring ${managedTorrents.length} sessions...`);
  managedTorrents.forEach((t) => {
    if (!t.paused) {
      try {
        console.log(`[Startup] Resuming: ${t.name || t.infoHash} `);
        client.add(t.magnetURI, { path: t.path }, (torrent) => {
          console.log(`[Startup] Active: ${torrent.name} `);
          setupTorrentEventListeners(torrent);
        });
      } catch (e) {
        console.error(`[Startup] Failed to resume ${t.infoHash}: `, e);
      }
    }
  });
}
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
if (process.platform === "win32") {
  app.setAppUserModelId("com.nexus.torrent");
}
app.whenReady().then(async () => {
  await loadTorrentsState();
  await initWebTorrent();
  await restoreSession();
  setupIpcHandlers();
  createWindow();
  try {
    const iconPath = path.join(process.env.VITE_PUBLIC, "tray.png");
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("Nexus");
    tray.setIgnoreDoubleClickEvents(true);
    tray.on("click", () => {
      if (win) {
        if (win.isVisible()) {
          if (win.isFocused()) win.hide();
          else win.focus();
        } else {
          win.show();
          win.focus();
        }
      }
    });
    const contextMenu = Menu.buildFromTemplate([
      { label: "Show Nexus", click: () => {
        win?.show();
        win?.focus();
      } },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  } catch (e) {
    console.error("Failed to create tray:", e);
  }
  setInterval(async () => {
    if (win) {
      let totalDownloadSpeed = 0;
      let totalUploadSpeed = 0;
      const activeMap = /* @__PURE__ */ new Map();
      if (client) {
        client.torrents.forEach((t) => {
          const connectedSeeds = t.wires.filter((w) => w.isSeeder).length;
          const connectedPeers = t.wires.length - connectedSeeds;
          totalDownloadSpeed += t.downloadSpeed;
          totalUploadSpeed += t.uploadSpeed;
          updatePowerSaveBlocker();
          activeMap.set(t.infoHash, {
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
            ratio: t.ratio || (t.downloaded > 0 ? t.uploaded / t.downloaded : 0),
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
      try {
        const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
        const config = JSON.parse(data || "{}");
        if (config.showSpeedInTray && tray) {
          tray.setToolTip(`Nexus | DL: ${formatBytes(totalDownloadSpeed)}/s | UL: ${formatBytes(totalUploadSpeed)}/s`);
        } else if (tray) {
          tray.setToolTip("Nexus");
        }
      } catch (e) {
      }
      const uiTorrents = managedTorrents.map((managed) => {
        const active = activeMap.get(managed.infoHash);
        if (active) {
          managed.progress = active.progress;
          managed.downloaded = active.downloaded;
          managed.length = active.length;
          managed.ratio = active.ratio;
          managed.name = active.name || managed.name;
          managed.done = active.state === "Seeding" || active.progress >= 1;
          managed.files = active.files;
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
          done: managed.done || false,
          files: managed.files || []
        };
      });
      win.webContents.send("torrents-update", uiTorrents);
      saveTorrentsState();
    }
  }, 1e3);
  await loadTorrentsState();
  win.webContents.openDevTools();
});
function setupTorrentEventListeners(torrent) {
  torrent.on("trackerAnnounce", () => {
    console.log(`[Announce] ${torrent.name} announced to tracker`);
  });
  torrent.on("done", async () => {
    console.log(`[Done] ${torrent.name} finished downloading`);
    try {
      const data = await fs.readFile(CONFIG_PATH, "utf-8").catch(() => "{}");
      const config = JSON.parse(data || "{}");
      if (config.enableNotifications) {
        new Notification({
          title: "Download Complete",
          body: `${torrent.name} has finished downloading.`,
          silent: !config.enableSound
        }).show();
        if (config.enableSound) {
          shell.beep();
        }
      }
    } catch (e) {
      console.error("Notification error:", e);
    }
    saveTorrentsState();
  });
}
