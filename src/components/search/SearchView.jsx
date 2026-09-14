import React, { useState } from 'react'
import { Search, Download, Play, Users, Loader2, AlertTriangle, Film, Globe } from 'lucide-react'
import clsx from 'clsx'

const formatBytes = (bytes) => {
  if (!+bytes) return null
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function SearchView({ onStreamMagnet, defaultPath }) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('apibay') // 'apibay' | 'yts'
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [error, setError] = useState(null)
  const [busyMagnet, setBusyMagnet] = useState(null)

  const runSearch = async (e) => {
    e?.preventDefault()
    if (query.trim().length < 2 || !window.ipcRenderer) return
    setStatus('loading')
    setError(null)
    try {
      const rows = await window.ipcRenderer.invoke('search-torrents', { query: query.trim(), provider })
      setResults(rows || [])
      setStatus('done')
    } catch (err) {
      setError(err.message || 'Search failed')
      setStatus('error')
    }
  }

  const handleDownload = async (row) => {
    if (!window.ipcRenderer) return
    setBusyMagnet(row.magnet)
    try {
      let dest = defaultPath
      if (!dest) dest = await window.ipcRenderer.invoke('get-download-path')
      await window.ipcRenderer.invoke('add-torrent', row.magnet, dest)
    } catch (err) {
      alert('Failed to add torrent: ' + (err.message || err))
    } finally {
      setBusyMagnet(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
      {/* Search hero */}
      <div className="glass-panel p-6 rounded-3xl border border-border shadow-xl">
        <form onSubmit={runSearch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={provider === 'yts' ? 'Search movies… (e.g. Dune)' : 'Search torrents… (e.g. Big Buck Bunny)'}
              className="w-full bg-secondary/60 border border-border rounded-xl py-3 pl-11 pr-4 text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex gap-2">
            {[
              { id: 'apibay', label: 'General', icon: Globe },
              { id: 'yts', label: 'Movies', icon: Film }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={clsx(
                  "flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition-colors",
                  provider === p.id
                    ? "bg-primary/20 text-primary border-primary/40"
                    : "bg-secondary/60 text-muted-foreground border-border hover:text-foreground"
                )}
              >
                <p.icon size={14} />
                <span>{p.label}</span>
              </button>
            ))}
            <button
              type="submit"
              disabled={status === 'loading' || query.trim().length < 2}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold shadow-lg shadow-blue-500/25 transition-all active:scale-95"
            >
              {status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              <span>Search</span>
            </button>
          </div>
        </form>
        <p className="text-[11px] text-muted-foreground mt-3">
          Results come from public indexes and may vary in availability — check the swarm health before downloading large payloads.
        </p>
      </div>

      {/* Error */}
      {status === 'error' && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center gap-2 text-xs">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {status === 'done' && (
        <div className="glass-panel p-6 rounded-3xl border border-border shadow-xl space-y-2">
          <h3 className="text-sm font-bold text-foreground pb-2 border-b border-border/50">
            {results.length === 0 ? 'No results found' : `${results.length} result${results.length === 1 ? '' : 's'}`}
          </h3>
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {results.map((row, i) => (
              <div
                key={`${row.infoHash}-${i}`}
                className="p-3.5 rounded-2xl bg-secondary/30 hover:bg-secondary/60 border border-border/40 transition-all flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{row.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                    <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                      <Users size={12} /> {row.seeders} seeds
                    </span>
                    <span>{row.leechers} leechers</span>
                    <span>{row.sizeStr || formatBytes(row.size) || 'Unknown size'}</span>
                    <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border/60">{row.provider}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onStreamMagnet && onStreamMagnet(row.magnet)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold border border-border/60 transition-all active:scale-95"
                    title="Preview instantly in Stream Video"
                  >
                    <Play size={13} className="fill-current" />
                    <span>Stream</span>
                  </button>
                  <button
                    onClick={() => handleDownload(row)}
                    disabled={busyMagnet === row.magnet}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all active:scale-95"
                  >
                    {busyMagnet === row.magnet ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    <span>Download</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
