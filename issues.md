# Known Issues & Backlog

> **Status: audited 2026-09-28.** Every item from the previous revision of this
> file has been re-verified against the current code. All 12 are now resolved
> except the one noted in "Open". The old list was stale and repeatedly led to
> re-investigating problems that had already been fixed, so this revision records
> what is actually outstanding.

## ✅ Resolved

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Packaged app failed to boot — preload script not found (`preload.js` vs `preload.mjs`) | `createWindow()` probes for `preload.mjs` and falls back to `preload.js` (`electron/main.js:1691`) |
| 2 | `remove-torrent` could delete the download root | `resolveWithinRoot()` containment check rejects any path equal to or outside `t.path` (`main.js:1300`, `utils/safePath.js`, 5 unit tests) |
| 3 | "Force Re-check" was inert (hook missing, prop unpassed) | `reverify` exported from `useTorrents`, wired through `App.jsx` → `TorrentList` → `TorrentCard` |
| 4 | Resumed torrents never notified or chimed on completion | `setupTorrentEventListeners()` is called on all 8 add paths, including session restore (`main.js:358` … `1853`) |
| 5 | Unhandled `error` on a torrent could crash Electron | `torrent.on('error')` attached centrally, plus process-level `uncaughtException` / `unhandledRejection` guards |
| 6 | Disk I/O thrashing every second | `showSpeedInTray` reads the in-memory `appConfig`; state persists on a 10s interval instead of 1s, with immediate saves on pause/remove/quit |
| 7 | IPC listener leaks in React | All `ipcRenderer.on()` subscriptions capture and call their unlisten callback on unmount (`App.jsx:96–108`); `AddTorrentModal` no longer calls `useTorrents()` |
| 8 | `window.ipcRenderer.off` never matched its wrapped listener | `preload.js` keeps a `listenerMap` from user callback → wrapped subscription |
| 9 | Share ratio reset each session | `baseUploaded` / `baseDownloaded` carried in persisted `managedTorrents`; ratio is lifetime, not per-session |
| 10 | No selective file downloads | `applyFileSelections()` + per-file checkboxes in the Files tree (`file.select()` / `file.deselect()`) |
| 11 | File tree collapsed by default | `useState(level === 0)` auto-expands the root (`TorrentDetails.jsx:97`) |
| 12 | Speed gauge pinned to a hardcoded 10 MB/s / 2 MB/s | Scales to configured limits, falling back to session peaks (`Sidebar.jsx`) |

## 🔴 Open

### 1. `reverify-torrent` destroys and re-adds the torrent
- **File**: `electron/main.js` — `reverify-torrent` handler
- **Problem**: To force a rehash it calls `client.remove()` then `client.add()`.
  That re-announces the infoHash to every tracker, tears down and rebuilds the
  whole swarm, and briefly drops all peer connections.
- **Impact**: Slow, tracker-hostile, and visible to peers as repeated connects.
- **Note**: Not yet confirmed whether WebTorrent exposes a less destructive
  rehash path — worth checking `torrent._verifyPieces` / `store` internals
  before writing a replacement.

### 2. `torrents-update` still ships full file lists every second
- **File**: `electron/main.js` — the 1Hz broadcast, and its twin in `get-torrents`
- **Problem**: Each tick builds a fresh `files` array for every *active* torrent
  and structured-clones it across the process boundary. Paused/managed torrents
  are now cached (`managedFilesForUi()`), but active ones are not.
- **Impact**: Scales with library size × files per torrent. Mostly wasted,
  since the Files tab is usually closed.
- **Fix direction**: Split the feed — cheap stats at 1Hz, file lists fetched on
  demand when a torrent is expanded. This changes the renderer contract and was
  deliberately left out of the perf commits because it cannot be verified
  without running the app.

### 3. The whole engine shares one Node event loop
- **Files**: `electron/main.js`, `electron/utils/StreamManager.js`
- **Problem**: Swarm I/O, the streaming HTTP server, and all torrent management
  run in Electron's main process. GC pauses in the swarm directly stall byte
  delivery to the video element, and vice versa.
- **Blocker**: WebTorrent `Torrent` objects cannot cross a process boundary.
  `startStreaming` detects `isUsingMainClient` via
  `mainClient.get(hash) === torrent`, so isolating the engine would force every
  torrent onto the separate stream client — undoing the duplicate-swarm fix and
  giving already-downloading torrents a second, empty piece store.
- **Fix direction**: Requires the stream client to become the sole owner of all
  torrents. That is a rewrite of torrent lifecycle, persistence, and the IPC
  surface — a scoping conversation, not a patch.

## ⚪ Housekeeping

- **Bundle size**: the renderer bundle is 673 kB (198 kB gzipped), dominated by
  `recharts`. `npm run build` warns about it. `recharts` is only used by the
  speed chart in `TorrentDetails`; lazy-loading it behind `React.lazy` would
  cut initial parse time. Not done — it trades a flash of layout for startup.
