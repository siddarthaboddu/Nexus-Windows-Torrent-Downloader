# Nexus Torrent: Issues, Bugs & Improvement Audit

This document records the identified bugs, reliability hazards, performance bottlenecks, and architectural improvement opportunities in the **Nexus Windows Torrent Downloader** codebase.

---

## 🚨 Category 1: Critical Bugs & Reliability Hazards

### 1. Packaged App Failure — Preload Script Not Found (`preload.js` vs `preload.mjs`)
- **Severity**: **Critical**
- **Affected File**: [`electron/main.js` (Line 601)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/main.js#L601)
- **Problem**:
  `package.json` specifies `"type": "module"`. As a result, Vite's build tooling outputs `dist-electron/preload.mjs`. However, `main.js` hardcodes:
  ```javascript
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
  }
  ```
  Because `dist-electron/preload.js` does not exist on disk, Electron fails to load the preload script in packaged builds.
- **Impact**: `window.ipcRenderer` remains `undefined` in production. The entire frontend cannot communicate with the main process, rendering the packaged application non-functional.
- **Recommended Fix**:
  Dynamically resolve between `.mjs` and `.js`:
  ```javascript
  import fsSync from 'node:fs'
  const preloadPath = fsSync.existsSync(path.join(__dirname, 'preload.mjs'))
    ? path.join(__dirname, 'preload.mjs')
    : path.join(__dirname, 'preload.js')
  ```

---

### 2. Accidental Root Download Directory Deletion Risk in `remove-torrent`
- **Severity**: **High / Data Loss Hazard**
- **Affected File**: [`electron/main.js` (Lines 468–477)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/main.js#L468-L477)
- **Problem**:
  When removing a torrent with `deleteData = true`:
  ```javascript
  const fullPath = path.join(t.path, t.name)
  await fs.rm(fullPath, { recursive: true, force: true })
  ```
  If a torrent is removed before metadata finishes resolving (`t.name` is undefined or empty string `""`), `path.join(t.path, "")` evaluates to **`t.path`** (the base download folder, e.g., `C:\Users\<User>\Downloads\Nexus` or `Downloads`).
- **Impact**: Recursively deletes the user's entire downloads folder, destroying unrelated user files.
- **Recommended Fix**:
  Guard against empty/missing `t.name` and assert path separation:
  ```javascript
  if (deleteData && t && t.path && t.name) {
    const fullPath = path.join(t.path, t.name)
    if (path.resolve(fullPath) !== path.resolve(t.path)) {
      await fs.rm(fullPath, { recursive: true, force: true })
    }
  }
  ```

---

### 3. "Force Re-check" Feature Is Broken (Missing Hook Export & Unpassed Prop)
- **Severity**: **High / Broken Feature**
- **Affected Files**:
  1. [`src/hooks/useTorrents.js` (Lines 50–51)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/hooks/useTorrents.js#L50-L51)
  2. [`src/components/dashboard/TorrentList.jsx` (Lines 170–185)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/components/dashboard/TorrentList.jsx#L170-L185)
- **Problem**:
  1. `useTorrents()` defines `reverify` in `App.jsx`, but `useTorrents.js` does not return `reverify` in its exported object.
  2. In `TorrentList.jsx`, `onReverify` is accepted as a prop on `TorrentList`, but is never passed down to `<TorrentCard />`.
- **Impact**: Clicking the "Force Re-check" icon in the torrent list does nothing.
- **Recommended Fix**:
  - In `useTorrents.js`: Return `reverify` in the hook return object.
  - In `TorrentList.jsx`: Add `onReverify={onReverify}` to `<TorrentCard />`.

---

### 4. Resumed Torrents Never Trigger Notifications or Completion Chimes
- **Severity**: **Medium**
- **Affected File**: [`electron/main.js` (Lines 530–542)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/main.js#L530-L542)
- **Problem**:
  In `ipcMain.handle('resume-torrent')`, `client.add` callback is empty:
  ```javascript
  client.add(t.magnetURI, { path: t.path }, (torrent) => {
    // On success
  })
  ```
  `setupTorrentEventListeners(torrent)` is omitted.
- **Impact**: Any torrent resumed after being paused will never trigger desktop notifications or completion sounds when it finishes.
- **Recommended Fix**:
  Call `setupTorrentEventListeners(torrent)` inside the resume callback.

---

### 5. Unhandled `error` on Torrent Instances Can Crash Electron
- **Severity**: **High / Crash Hazard**
- **Affected File**: [`electron/main.js` (Lines 887–916)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/main.js#L887-L916)
- **Problem**:
  Only `client.on('error')` is registered. In WebTorrent, individual `Torrent` instances are EventEmitters that emit `'error'` events (e.g. disk write failures, corrupted pieces, tracker transport failures).
- **Impact**: Unhandled `'error'` events on EventEmitters throw unhandled exceptions in Node.js, crashing the entire Electron process.
- **Recommended Fix**:
  Add an error listener inside `setupTorrentEventListeners(torrent)`:
  ```javascript
  torrent.on('error', (err) => {
    console.error(`[Torrent Error] ${torrent.name || torrent.infoHash}:`, err)
  })
  ```

---

## ⚡ Category 2: Performance Bottlenecks & Resource Leaks

### 6. Continuous Disk I/O Thrashing Every Second
- **Severity**: **Medium / Performance & Hardware Wear**
- **Affected File**: [`electron/main.js` (Lines 823–831 & Line 875)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/main.js#L823-L831)
- **Problem**:
  1. Inside `setInterval(..., 1000)`, `main.js` reads and parses `CONFIG_PATH` from disk every second to check `config.showSpeedInTray`, ignoring the existing in-memory `appConfig` cache.
  2. `saveTorrentsState()` is called unconditionally on every interval tick even if all torrents are paused or 0 torrents exist, rewriting JSON to disk every 2 seconds indefinitely.
- **Impact**: Prevents storage drive sleep, degrades SSD write endurance, and wastes battery on laptops.
- **Recommended Fix**:
  - Read `appConfig.showSpeedInTray` from the in-memory cache.
  - Only invoke `saveTorrentsState()` when active transfer progress has changed or on lifecycle events (pause, resume, add, remove, complete).

---

### 7. IPC Listener Memory Leaks in React
- **Severity**: **Medium**
- **Affected Files**:
  1. [`src/App.jsx` (Lines 44–50)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/App.jsx#L44-L50)
  2. [`src/components/modals/AddTorrentModal.jsx` (Line 12)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/components/modals/AddTorrentModal.jsx#L12)
- **Problem**:
  - In `App.jsx`, `window.ipcRenderer.on('open-magnet-link')` does not retain or invoke its unlisten callback in `useEffect` cleanup.
  - `AddTorrentModal.jsx` calls `useTorrents()` purely to get `selectFolder()`. This needlessly subscribes the modal to the 1-second `torrents-update` stream, causing re-renders every second.
- **Impact**: Leaked event listeners across re-renders and unnecessary render cycles in modal dialogs.
- **Recommended Fix**:
  - Capture and call the unlisten callback for `open-magnet-link` on unmount.
  - Use `window.ipcRenderer.invoke('select-folder')` directly in `AddTorrentModal.jsx`.

---

### 8. Broken `window.ipcRenderer.off` in Preload
- **Severity**: **Low / API Contract Violation**
- **Affected File**: [`electron/preload.js` (Lines 5–12)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/electron/preload.js#L5-L12)
- **Problem**:
  In `preload.js`, `on` wraps the incoming callback in an internal closure (`subscription`). `off` tries to pass the user callback directly to `ipcRenderer.removeListener(channel, listener)`, which never matches.
- **Impact**: Manual listener removals via `ipcRenderer.off` fail silently.
- **Recommended Fix**:
  Maintain a `listenerMap = new Map()` mapping user listeners to wrapped subscriptions.

---

## 💎 Category 3: High-Value UX & Feature Improvements

### 9. Cumulative Lifetime Share Ratio Across Sessions
- **Status**: Enhancement
- **Description**:
  Currently, share ratio calculates `t.uploaded / t.downloaded`. If a finished torrent is reloaded in a new session, `t.downloaded` is `0`, causing the ratio to reset to `0.00`.
- **Improvement**: Track `totalUploaded` and `totalDownloaded` in `managedTorrents` persisted state so lifetime ratio remains accurate.

---

### 10. Selective File Downloads (File Priority)
- **Status**: Enhancement
- **Description**:
  Currently, adding a multi-file torrent downloads every file by default.
- **Improvement**: Add checkboxes in `TorrentDetails.jsx` under the Files tab to let users toggle files on or off using WebTorrent's `file.select()` and `file.deselect()`.

---

### 11. Auto-Expand Root Folder in File Tree
- **Status**: Enhancement
- **Affected File**: [`src/components/dashboard/TorrentDetails.jsx` (Line 55)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/components/dashboard/TorrentDetails.jsx#L55)
- **Description**:
  Folders initialize with `isOpen = false`. In single-folder torrents, users are forced to click through nested folders to inspect files.
- **Improvement**: Set `isOpen = level === 0` so the root-level files/directories are visible by default.

---

### 12. Dynamic Sidebar Speed Gauge
- **Status**: Enhancement
- **Affected File**: [`src/components/layout/Sidebar.jsx` (Lines 98 & 105)](file:///D:/Projects/Personals/Nexus-Windows-Torrent-Downloader-1/src/components/layout/Sidebar.jsx#L98)
- **Description**:
  Maximum download speed is hardcoded to `10 MB/s` and upload to `2 MB/s`. High-speed connections max out the progress bars immediately.
- **Improvement**: Dynamically scale the gauge according to configured limits (`config.downloadLimit` / `config.uploadLimit`) or active session peaks.

---

## 📋 Recommended Implementation Order

1. **Phase 1 (Immediate Stability & Safety)**:
   - Fix 1: Preload script path fallback in `electron/main.js`.
   - Fix 2: Safety guard in `remove-torrent` to prevent root directory deletion.
   - Fix 3: Wire up `reverify` in `useTorrents.js` and `TorrentList.jsx`.
   - Fix 4: Attach event listeners on resumed torrents.
   - Fix 5: Add `torrent.on('error')` handler.
2. **Phase 2 (Performance & Efficiency)**:
   - Fix 6: Remove 1-second file read thrashing and debounce disk writes to only dirty states.
   - Fix 7 & 8: Fix Preload listener cleanup and prevent `AddTorrentModal` unnecessary re-renders.
3. **Phase 3 (UX & Feature Polish)**:
   - Auto-expand root folder in files tree.
   - Dynamic gauge scaling in sidebar.
   - Persistent cumulative ratio tracking.
