import { useState, useEffect, useRef } from 'react'
import Layout from './components/layout/Layout'
import TorrentList from './components/dashboard/TorrentList'
import Settings from './components/dashboard/Settings'
import AddTorrentModal from './components/modals/AddTorrentModal'
import DeleteTorrentModal from './components/modals/DeleteTorrentModal'
import StreamView from './components/streaming/StreamView'
import { useTorrents } from './hooks/useTorrents'
import { Plus } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const {
    torrents,
    addTorrent,
    removeTorrent,
    pauseTorrent,
    resumeTorrent,
    openFolder,
    reverify,
    toggleFileSelection,
    setTorrentStrategy,
    pauseAll,
    resumeAll,
    openFile,
    openFileFolder,
    showFileContextMenu,
    showTorrentContextMenu
  } = useTorrents()

  const [deleteModal, setDeleteModal] = useState({ isOpen: false, torrent: null })
  const [defaultPath, setDefaultPath] = useState('')
  const [appConfig, setAppConfig] = useState({ compactMode: false })
  const [initialMagnet, setInitialMagnet] = useState('')
  const [initialFile, setInitialFile] = useState(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)

  const torrentsRef = useRef(torrents)
  useEffect(() => {
    torrentsRef.current = torrents
  }, [torrents])

  const openDeleteModal = (infoHash) => {
    const targetHash = (infoHash || '').toLowerCase()
    const torrent = torrentsRef.current.find(t => (t.infoHash || '').toLowerCase() === targetHash)
    if (torrent) {
      setDeleteModal({ isOpen: true, torrent })
    }
  }

  useEffect(() => {
    let mounted = true;
    let removeConfigListener = null;
    let removeMagnetListener = null;
    let removeIncomingListener = null;
    let removeTogglePause = null;
    let removeDeleteTorrent = null;
    let removeReverify = null;

    const initConfig = async () => {
      try {
        if (window.ipcRenderer) {
          // Fetch default download path
          const path = await window.ipcRenderer.invoke('get-download-path')
          if (!mounted) return;
          setDefaultPath(path)

          // Fetch full config
          const config = await window.ipcRenderer.invoke('get-config')
          if (!mounted) return;
          setAppConfig(config)

          // Listen for updates
          if (mounted) {
            removeConfigListener = window.ipcRenderer.on('config-updated', (newConfig) => {
              if (mounted) setAppConfig(newConfig)
            })

            // Listen for magnet links from main process
            removeMagnetListener = window.ipcRenderer.on('open-magnet-link', (magnetLink) => {
              console.log('[App] Received magnet link:', magnetLink)
              if (mounted) {
                setInitialMagnet(magnetLink)
                setInitialFile(null)
                setIsAddModalOpen(true)
              }
            })

            // Listen for incoming torrents (.torrent files or magnets)
            removeIncomingListener = window.ipcRenderer.on('open-incoming-torrent', (incoming) => {
              console.log('[App] Received incoming torrent:', incoming)
              if (!mounted) return;
              if (incoming.type === 'magnet') {
                setInitialMagnet(incoming.value)
                setInitialFile(null)
                setIsAddModalOpen(true)
              } else if (incoming.type === 'file') {
                setInitialFile({ name: incoming.name, path: incoming.path })
                setInitialMagnet('')
                setIsAddModalOpen(true)
              }
            })

            // Context menu event listeners
            removeTogglePause = window.ipcRenderer.on('context-menu-toggle-pause', (hash) => {
              const target = torrentsRef.current.find(t => t.infoHash === hash)
              if (target) {
                if (target.state === 'Paused' || target.state === 'Completed') {
                  resumeTorrent(hash)
                } else {
                  pauseTorrent(hash)
                }
              }
            })

            removeDeleteTorrent = window.ipcRenderer.on('context-menu-delete-torrent', (hash) => {
              openDeleteModal(hash)
            })

            removeReverify = window.ipcRenderer.on('context-menu-reverify', (hash) => {
              reverify(hash)
            })
          }
        }
      } catch (e) {
        console.error('Failed to load initial config:', e)
      }
    }
    initConfig()

    return () => {
      mounted = false;
      if (removeConfigListener) removeConfigListener();
      if (removeMagnetListener) removeMagnetListener();
      if (removeIncomingListener) removeIncomingListener();
      if (removeTogglePause) removeTogglePause();
      if (removeDeleteTorrent) removeDeleteTorrent();
      if (removeReverify) removeReverify();
    }
  }, [])

  const handleWindowDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  }

  const handleWindowDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving the window
    if (e.relatedTarget === null) {
      setIsDraggingFile(false);
    }
  }

  const handleWindowDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.torrent')) {
        alert('Unsupported file type. Please drop a valid .torrent file.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target.readyState === FileReader.DONE) {
          setInitialFile({
            name: file.name,
            data: evt.target.result
          });
          setInitialMagnet('');
          setIsAddModalOpen(true);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }


  const handleConfirmDelete = (deleteData) => {
    if (deleteModal.torrent) {
      removeTorrent(deleteModal.torrent.infoHash, deleteData)
    }
    setDeleteModal({ isOpen: false, torrent: null })
  }

  console.log('[App] Rendering...', { activeTab, isAddModalOpen })

  const stats = {
    downloadSpeed: torrents.reduce((acc, t) => acc + t.downloadSpeed, 0),
    uploadSpeed: torrents.reduce((acc, t) => acc + t.uploadSpeed, 0)
  }

  return (
    <div
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
      className="h-full w-full"
    >
      <Layout activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} config={appConfig}>
        {isDraggingFile && (
          <div className="fixed inset-0 z-[999] bg-background/80 backdrop-blur-md border-4 border-dashed border-primary flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 rounded-2xl bg-card border border-border shadow-2xl flex flex-col items-center gap-3">
              <Plus size={48} className="text-primary animate-bounce" />
              <h3 className="text-xl font-bold text-foreground">Drop .torrent file to download</h3>
              <p className="text-sm text-muted-foreground">Release anywhere to open and add this torrent</p>
            </div>
          </div>
        )}

        <div className="p-8 pb-20">
          <div className="flex justify-between items-center mb-8 animate-accordion-down">
            <h2 className="text-3xl font-bold text-foreground tracking-tight">
              {activeTab === 'dashboard' ? 'Overview' :
                activeTab === 'transfers' ? 'Active Transfers' :
                  activeTab === 'stream' ? 'Stream Video' :
                    'Settings'}
            </h2>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-blue-600 rounded-lg text-white font-medium transition-colors shadow-lg shadow-blue-500/25"
            >
              <Plus size={18} />
              <span>Add Torrent</span>
            </button>
          </div>

          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-5 duration-500">
              {/* Stats Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-32 relative overflow-hidden group">
                  <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <svg width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                  </div>
                  <span className="text-muted-foreground font-medium text-sm">Active Downloads</span>
                  <span className="text-3xl font-bold text-foreground">{torrents.filter(t => !t.done).length}</span>
                </div>
                <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-32 relative overflow-hidden">
                  <div className="w-20 h-20 bg-blue-500/20 rounded-full blur-2xl absolute -right-4 -top-4" />
                  <span className="text-muted-foreground font-medium text-sm">Total Download Speed</span>
                  <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                    {/* Calculate total speed */}
                    {(() => {
                      const totalSpeed = torrents.reduce((acc, t) => acc + t.downloadSpeed, 0);
                      const k = 1024;
                      const sizes = ['B', 'KB', 'MB', 'GB'];
                      if (totalSpeed === 0) return '0 KB/s';
                      const i = Math.floor(Math.log(totalSpeed) / Math.log(k));
                      return `${parseFloat((totalSpeed / Math.pow(k, i)).toFixed(1))} ${sizes[i]}/s`;
                    })()}
                  </span>
                </div>
                <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-32 relative overflow-hidden">
                  <div className="w-20 h-20 bg-purple-500/20 rounded-full blur-2xl absolute -right-4 -top-4" />
                  <span className="text-muted-foreground font-medium text-sm">Active Peers</span>
                  <span className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                    {torrents.reduce((acc, t) => acc + t.numPeers, 0)}
                  </span>
                </div>
              </div>

              {/* Recent Activity */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h3>
                <TorrentList
                  torrents={torrents}
                  onRemove={openDeleteModal}
                  onPause={pauseTorrent}
                  onResume={resumeTorrent}
                  onReverify={reverify}
                  openFolder={openFolder}
                  compactMode={appConfig.compactMode}
                  onToggleFile={toggleFileSelection}
                  onSetStrategy={setTorrentStrategy}
                  onPauseAll={pauseAll}
                  onResumeAll={resumeAll}
                  openFile={openFile}
                  openFileFolder={openFileFolder}
                  showFileContextMenu={showFileContextMenu}
                  showTorrentContextMenu={showTorrentContextMenu}
                />
              </div>
            </div>
          )}

          {activeTab === 'transfers' && (
            <div className="animate-in slide-in-from-bottom-5 duration-500">
              <TorrentList
                torrents={torrents}
                onRemove={openDeleteModal}
                onPause={pauseTorrent}
                onResume={resumeTorrent}
                onReverify={reverify}
                openFolder={openFolder}
                compactMode={appConfig.compactMode}
                onToggleFile={toggleFileSelection}
                onPauseAll={pauseAll}
                onResumeAll={resumeAll}
                openFile={openFile}
                openFileFolder={openFileFolder}
                showFileContextMenu={showFileContextMenu}
                showTorrentContextMenu={showTorrentContextMenu}
              />
            </div>
          )}

          <div className={activeTab === 'stream' ? 'block animate-in slide-in-from-bottom-5 duration-500' : 'hidden'}>
            <StreamView activeTorrents={torrents} />
          </div>

          {activeTab === 'settings' && (
            <Settings />
          )}
        </div>

        <AddTorrentModal
          key={isAddModalOpen ? `${initialMagnet}-${initialFile?.name || 'manual'}` : 'closed'}
          isOpen={isAddModalOpen}
          onClose={() => {
            setIsAddModalOpen(false)
            setInitialMagnet('') // Reset after closing
            setInitialFile(null)
          }}
          onAdd={addTorrent}
          defaultPath={defaultPath}
          initialMagnet={initialMagnet}
          initialFile={initialFile}
        />

        <DeleteTorrentModal
          isOpen={deleteModal.isOpen}
          onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
          onConfirm={handleConfirmDelete}
          torrentName={deleteModal.torrent?.name}
        />
      </Layout>
    </div>
  )
}

export default App
