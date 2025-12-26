import { useState, useEffect } from 'react'
import Layout from './components/layout/Layout'
import TorrentList from './components/dashboard/TorrentList'
import Settings from './components/dashboard/Settings'
import AddTorrentModal from './components/modals/AddTorrentModal'
import DeleteTorrentModal from './components/modals/DeleteTorrentModal'
import { useTorrents } from './hooks/useTorrents'
import { Plus } from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const { torrents, addTorrent, removeTorrent, pauseTorrent, resumeTorrent, openFolder, reverify } = useTorrents()

  const [deleteModal, setDeleteModal] = useState({ isOpen: false, torrent: null })
  const [defaultPath, setDefaultPath] = useState('')
  const [appConfig, setAppConfig] = useState({ compactMode: false })

  useEffect(() => {
    let mounted = true;
    let removeConfigListener = null;

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
          }
        }
      } catch (e) {
        console.error('Failed to load initial config:', e)
      }
    }
    initConfig()

    return () => {
      mounted = false;
      if (removeConfigListener) {
        removeConfigListener()
      }
    }
  }, [])

  const openDeleteModal = (infoHash) => {
    const torrent = torrents.find(t => t.infoHash === infoHash)
    if (torrent) {
      setDeleteModal({ isOpen: true, torrent })
    }
  }

  const handleConfirmDelete = (deleteData) => {
    if (deleteModal.torrent) {
      removeTorrent(deleteModal.torrent.infoHash, deleteData)
    }
    setDeleteModal({ isOpen: false, torrent: null })
  }

  console.log('[App] Rendering...', { activeTab, isAddModalOpen })

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      <div className="p-8 pb-20">
        <div className="flex justify-between items-center mb-8 animate-accordion-down">
          <h2 className="text-3xl font-bold text-white tracking-tight">
            {activeTab === 'dashboard' ? 'Overview' :
              activeTab === 'transfers' ? 'Active Transfers' :
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
                <span className="text-3xl font-bold text-white">{torrents.filter(t => !t.done).length}</span>
              </div>
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between h-32 relative overflow-hidden">
                <div className="w-20 h-20 bg-blue-500/20 rounded-full blur-2xl absolute -right-4 -top-4" />
                <span className="text-muted-foreground font-medium text-sm">Total Download Speed</span>
                <span className="text-3xl font-bold text-emerald-400">
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
                <span className="text-3xl font-bold text-indigo-400">
                  {torrents.reduce((acc, t) => acc + t.numPeers, 0)}
                </span>
              </div>
            </div>

            {/* Recent Activity */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
              <TorrentList
                torrents={torrents}
                onRemove={openDeleteModal}
                onPause={pauseTorrent}
                onResume={resumeTorrent}
                onReverify={reverify}
                openFolder={openFolder}
                compactMode={appConfig.compactMode}
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
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <Settings />
        )}
      </div>

      <AddTorrentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={addTorrent}
        defaultPath={defaultPath}
      />

      <DeleteTorrentModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
        onConfirm={handleConfirmDelete}
        torrentName={deleteModal.torrent?.name}
      />
    </Layout>
  )
}

export default App
