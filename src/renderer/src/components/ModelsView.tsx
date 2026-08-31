import React, { useState, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import type { ModelFileInfo, ModelDownloadInfo } from '../store/useStore'
import {
  HardDrive, Download, Trash, Pause, Play, X, Link, FolderOpen,
  Pencil, Check, AlertCircle, Loader2, RefreshCw, ChevronDown
} from 'lucide-react'

interface ModelFolderNode {
  name: string
  path: string
  size: number
  totalModels: number
  models: ModelFileInfo[]
  children: ModelFolderNode[]
}

function formatBytes(b: number) {
  if (!b) return '—'
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function createFolderNode(name: string, path: string): ModelFolderNode {
  return {
    name,
    path,
    size: 0,
    totalModels: 0,
    models: [],
    children: []
  }
}

function sortFolderTree(nodes: ModelFolderNode[]): ModelFolderNode[] {
  return [...nodes]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((node) => ({
      ...node,
      models: [...node.models].sort((left, right) => left.name.localeCompare(right.name)),
      children: sortFolderTree(node.children)
    }))
}

function buildFolderTree(models: ModelFileInfo[]): ModelFolderNode[] {
  const rootNodes: ModelFolderNode[] = []

  for (const model of models) {
    const segments = model.folder.split('/').filter(Boolean)
    let currentLevel = rootNodes
    let currentNode: ModelFolderNode | null = null
    let currentPath = ''

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment

      let nextNode = currentLevel.find((node) => node.name === segment)
      if (!nextNode) {
        nextNode = createFolderNode(segment, currentPath)
        currentLevel.push(nextNode)
      }

      nextNode.size += model.size
      nextNode.totalModels += 1
      currentNode = nextNode
      currentLevel = nextNode.children
    }

    if (!currentNode) {
      currentNode = createFolderNode('Root', 'Root')
      currentNode.size += model.size
      currentNode.totalModels += 1
      currentNode.models.push(model)
      rootNodes.push(currentNode)
      continue
    }

    currentNode.models.push(model)
  }

  return sortFolderTree(rootNodes)
}
function formatSpeed(bps?: number) {
  if (!bps) return ''
  const mbps = bps / (1024 * 1024)
  return `${mbps.toFixed(1)} MB/s`
}
function UrlDownloadModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [hfFiles, setHfFiles] = useState<{ name: string; size: number; downloadUrl: string }[]>([])
  const [error, setError] = useState('')
  function parseHfRepoId(url: string): string | null {
    const m = url.match(/huggingface\.co\/([^/]+\/[^/]+?)(?:\/|$)/)
    return m ? m[1] : null
  }
  function isDirectGguf(url: string) {
    return url.toLowerCase().includes('.gguf') || url.toLowerCase().includes('.ggml') || url.toLowerCase().includes('.bin')
  }
  async function handleAnalyze() {
    setError(''); setHfFiles([]); setLoading(true)
    try {
      if (isDirectGguf(url)) {
        const filename = url.split('/').pop()?.split('?')[0] || 'model.gguf'
        const folder = url.includes('huggingface.co') ? (parseHfRepoId(url)?.split('/').pop() || 'downloads') : 'downloads'
        await window.api.startModelDownload({ url, filename, modelFolder: folder })
        onClose()
      } else {
        const repoId = parseHfRepoId(url)
        if (!repoId) throw new Error('Unrecognized URL. Paste a direct .gguf link or a HuggingFace model page URL.')
        const res = await window.api.hfGetFiles(repoId)
        if ('error' in res) throw new Error((res as any).error)
        setHfFiles(res as any)
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  async function handleDownloadFile(file: { name: string; downloadUrl: string }) {
    const repoId = parseHfRepoId(url) || 'downloads'
    await window.api.startModelDownload({ url: file.downloadUrl, filename: file.name, repoId, modelFolder: repoId.split('/').pop() })
    onClose()
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Download by URL</h2>
        </div>
        <div className="modal-body">
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Paste a direct <strong>.gguf</strong> URL, or a HuggingFace model page link.<br />
            Example: <code>https://huggingface.co/TheBloke/Llama-2-7B-GGUF</code>
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" style={{ flex: 1 }} type="url" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAnalyze()} autoFocus />
            <button className="btn btn-primary" onClick={handleAnalyze} disabled={!url.trim() || loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <Link size={14} />} Analyze
            </button>
          </div>
          {error && <div className="hub-error" style={{ marginTop: 10 }}><AlertCircle size={14} />{error}</div>}
          {hfFiles.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="hub-detail-section-label">Choose a GGUF file to download</div>
              {hfFiles.map(f => (
                <div key={f.name} className="hub-file-row" style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hub-file-name" style={{ fontSize: 12 }}>{f.name}</div>
                    <div className="hub-file-size">{formatBytes(f.size)}</div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handleDownloadFile(f)}>
                    <Download size={13} /> Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
function DownloadRow({ dl }: { dl: ModelDownloadInfo }) {
  const removeModelDownload = useStore((state) => state.removeModelDownload)
  const isPaused = dl.phase === 'paused'
  const isDone = dl.phase === 'done'
  const isErr = dl.phase === 'error'
  
  const [pending, setPending] = useState<'pausing' | 'resuming' | null>(null)

  async function togglePause() {
    if (isPaused) {
      setPending('resuming')
      await window.api.resumeModelDownload(dl.id)
    } else {
      setPending('pausing')
      await window.api.pauseModelDownload(dl.id)
    }
    
    setTimeout(() => setPending(null), 1500)
  }
  async function cancel() {
    await window.api.cancelModelDownload(dl.id)
    removeModelDownload(dl.id)
  }

  const showSpeed = dl.phase === 'downloading' && !pending && dl.speed && dl.speed > 0
  const statusLabel = pending === 'pausing'
    ? 'Pausing…'
    : pending === 'resuming'
    ? 'Resuming…'
    : isPaused
    ? 'Paused'
    : isErr
    ? 'Failed'
    : isDone
    ? 'Complete'
    : showSpeed
    ? formatSpeed(dl.speed)
    : `${dl.percent}%`

  return (
    <div className={`models-dl-row ${isDone ? 'done' : ''} ${isErr ? 'error' : ''}`}>
      <div className="models-dl-meta">
        <span className="models-dl-name">{dl.filename}</span>
        <span className="models-dl-size">
          {formatBytes(dl.receivedBytes)} / {formatBytes(dl.totalBytes)}
        </span>
      </div>
      <div className="models-dl-bar-row">
        <div className="models-dl-bar">
          <div className="models-dl-fill" style={{ width: `${dl.percent}%`, background: isErr ? 'var(--danger)' : isDone ? 'var(--success)' : 'var(--accent)', opacity: isPaused || pending ? 0.5 : 1, transition: 'width 0.3s ease' }} />
        </div>
        <span className="models-dl-pct" style={{ minWidth: 80, textAlign: 'right', color: isPaused ? 'var(--text-muted)' : 'inherit' }}>
          {statusLabel}
        </span>
        {!isDone && !isErr && (
          <>
            <button
              className="btn btn-ghost btn-icon"
              onClick={togglePause}
              disabled={!!pending}
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {pending
                ? <Loader2 size={13} className="spin" />
                : isPaused
                ? <Play size={13} />
                : <Pause size={13} />}
            </button>
            <button className="btn btn-ghost btn-icon text-danger" onClick={cancel} title="Cancel">
              <X size={13} />
            </button>
          </>
        )}
        {(isDone || isErr) && (
          <button className="btn btn-ghost btn-icon" onClick={() => removeModelDownload(dl.id)} title="Dismiss">
            <X size={13} />
          </button>
        )}
      </div>
      {isErr && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Download failed</div>}
      {isDone && <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>✓ Saved to {dl.destPath}</div>}
    </div>
  )
}

function ModelFileRow({ model, onDeleted }: { model: ModelFileInfo; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState(model.name.replace(/\.[^.]+$/, ''))
  async function handleDelete() {
    if (!confirm(`Delete "${model.name}"? This cannot be undone.`)) return
    const res = await window.api.deleteModel(model.path)
    if (res.success) onDeleted()
    else {
      useStore.getState().pushNotification({
        tone: 'danger',
        title: 'Model could not be deleted',
        message: res.error || model.name
      })
    }
  }

  async function handleRename() {
    if (!newName.trim() || newName === model.name.replace(/\.[^.]+$/, '')) { setEditing(false); return }
    const res = await window.api.renameModel(model.path, newName.trim())
    if (res.success) { setEditing(false); onDeleted()  }
    else {
      useStore.getState().pushNotification({
        tone: 'danger',
        title: 'Model could not be renamed',
        message: res.error || model.name
      })
    }
  }

  return (
    <div className="models-file-row">
      <div className="models-file-icon"><HardDrive size={16} /></div>
      <div className="models-file-meta">
        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="form-input" style={{ padding: '4px 8px', fontSize: 12, flex: 1 }} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false) }} autoFocus />
            <button className="btn btn-primary btn-sm btn-icon" onClick={handleRename}><Check size={13} /></button>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(false)}><X size={13} /></button>
          </div>
        ) : (
          <span className="models-file-name">{model.name}</span>
        )}
        <div className="models-file-sub">
          <span>{formatBytes(model.size)}</span>
        </div>
      </div>
      <div className="models-file-actions">
        <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} title="Rename"><Pencil size={14} /></button>
        <button className="btn btn-ghost btn-icon" onClick={() => window.api.openFolder(model.path.substring(0, model.path.lastIndexOf('/') === -1 ? model.path.lastIndexOf('\\') : model.path.lastIndexOf('/')))} title="Open folder"><FolderOpen size={14} /></button>
        <button className="btn btn-ghost btn-icon text-danger" onClick={handleDelete} title="Delete"><Trash size={14} /></button>
      </div>
    </div>
  )
}

function FolderTreeSection({
  node,
  depth,
  collapsedFolders,
  onToggle,
  onDeleted
}: {
  node: ModelFolderNode
  depth: number
  collapsedFolders: Record<string, boolean>
  onToggle: (folderPath: string) => void
  onDeleted: () => void
}) {
  const isCollapsed = collapsedFolders[node.path] !== false

  return (
    <div style={{ marginTop: depth === 0 ? 16 : 10, marginLeft: depth * 18 }}>
      <button
        type="button"
        className="models-section-title"
        onClick={() => onToggle(node.path)}
        style={{
          fontSize: 12,
          marginBottom: isCollapsed ? 0 : 10,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: 'pointer',
          color: 'inherit'
        }}
        aria-expanded={!isCollapsed}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FolderOpen size={13} />
          <span>{node.name}</span>
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
            ({node.totalModels}) · {formatBytes(node.size)}
          </span>
        </span>
        <ChevronDown
          size={14}
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.18s ease'
          }}
        />
      </button>
      {!isCollapsed && (
        <>
          {node.children.map((child) => (
            <FolderTreeSection
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsedFolders={collapsedFolders}
              onToggle={onToggle}
              onDeleted={onDeleted}
            />
          ))}
          {node.models.map((model) => (
            <ModelFileRow key={model.path} model={model} onDeleted={onDeleted} />
          ))}
        </>
      )}
    </div>
  )
}

export default function ModelsView() {
  const { models, setModels, modelDownloads, upsertModelDownload, paths } = useStore(useShallow((state) => ({
    models: state.models,
    setModels: state.setModels,
    modelDownloads: state.modelDownloads,
    upsertModelDownload: state.upsertModelDownload,
    paths: state.paths
  })))
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    const m = await window.api.listModels()
    setModels(m)
    setLoading(false)
  }, [setModels])

  useEffect(() => {
    refresh()

    window.api.listModelDownloads().then((list: any[]) => {
      list.forEach(dl => upsertModelDownload(dl))
    })
  }, [])

  const downloads = Object.values(modelDownloads)
  const activeDownloads = downloads.filter(d => d.phase !== 'cancelled')
  const folderTree = buildFolderTree(models)

  function toggleFolder(folder: string) {
    setCollapsedFolders((current) => ({
      ...current,
      [folder]: current[folder] === undefined ? false : !current[folder]
    }))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Models</h1>
          <p className="page-subtitle">
            {models.length} model{models.length !== 1 ? 's' : ''} installed
            {activeDownloads.length > 0 ? ` · ${activeDownloads.length} downloading` : ''}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-icon" onClick={refresh} title="Refresh" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button className="btn btn-secondary" onClick={() => paths && window.api.openFolder(paths.models)} disabled={!paths} title={paths?.models}>
            <FolderOpen size={15} /> Open Folder
          </button>
          <button className="btn btn-primary" onClick={() => setShowUrlModal(true)}>
            <Download size={15} /> Download by URL
          </button>
        </div>
      </div>

      {activeDownloads.length > 0 && (
        <div className="models-section">
          <div className="models-section-title">
            <Loader2 size={13} className="spin" /> Active Downloads
          </div>
          {activeDownloads.map(dl => <DownloadRow key={dl.id} dl={dl} />)}
        </div>
      )}

      <div className="models-section">
        <div className="models-section-title">
          <HardDrive size={13} /> Installed Models
        </div>
        {loading && models.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: 13 }}>
            <Loader2 size={16} className="spin" style={{ display: 'block', margin: '0 auto 8px' }} /> Loading...
          </div>
        )}
        {!loading && models.length === 0 && (
          <div className="empty-state" style={{ padding: '40px 24px' }}>
            <div className="empty-state-icon"><HardDrive size={28} /></div>
            <h3>No models yet</h3>
            <p>Download a model from the Model Hub or use the "Download by URL" button.</p>
            <button className="btn btn-primary" onClick={() => setShowUrlModal(true)}>
              <Download size={15} /> Download by URL
            </button>
          </div>
        )}

        {folderTree.map((node) => (
          <FolderTreeSection
            key={node.path}
            node={node}
            depth={0}
            collapsedFolders={collapsedFolders}
            onToggle={toggleFolder}
            onDeleted={refresh}
          />
        ))}
      </div>
      {showUrlModal && <UrlDownloadModal onClose={() => { setShowUrlModal(false); refresh() }} />}
    </div>
  )
}
