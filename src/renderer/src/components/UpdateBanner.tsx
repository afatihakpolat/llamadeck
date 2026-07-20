import React, { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage
} from '../utils/storageMigration'
import { X, Download, Loader2 } from 'lucide-react'
import type { BackendBuildFlavor, BackendVersion, Template } from '../../../shared/types'

interface BackendSourceUpdateResult {
  snapshot: {
    paths: { models: string; templates: string; backend: string }
    models: Array<{ name: string; path: string; size: number; folder: string }>
    backends: BackendVersion[]
  }
  templates: Template[]
  activeBackendName: string
}

function hasInstalledBuild(backends: BackendVersion[], tagName: string, flavor: BackendBuildFlavor): boolean {
  const expectedBackendName = flavor === 'cpu' ? `${tagName}-cpu` : tagName
  return backends.some((backend) => backend.name === expectedBackendName)
}

function formatUpdateProgress(progress: { percent: number; phase: string } | null): string {
  if (!progress) return ''

  const labels: Record<string, string> = {
    starting: 'Starting source update',
    environment: 'Loading build environment',
    fetching: 'Fetching upstream changes',
    resetting: 'Resetting repository',
    configuring: 'Configuring build',
    building: 'Compiling source',
    finalizing: 'Finalizing build',
    done: 'Build complete',
    cancelled: 'Update cancelled'
  }

  const label = labels[progress.phase] || progress.phase
  if (progress.phase === 'done' || progress.phase === 'cancelled') return label
  return `${label}... ${progress.percent || 0}%`
}

export default function UpdateBanner() {
  const {
    releaseInfo, updateDismissed, setUpdateDismissed,
    downloadProgress, setDownloadProgress, setBackends, backends,
    setActiveBackend, setCommandsSchema, setCards, setModels, setPaths, setReleaseInfo
  } = useStore()
  const [updatingSource, setUpdatingSource] = useState(false)
  const notifPref = readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.updateNotification) || 'banner'
  const latestTagName = releaseInfo?.tagName?.trim() || ''
  const canBuildCpu = Boolean(latestTagName) && !hasInstalledBuild(backends, latestTagName, 'cpu')
  const canBuildCuda = Boolean(latestTagName) && !hasInstalledBuild(backends, latestTagName, 'cuda')
  if (!releaseInfo || releaseInfo.error || updateDismissed || releaseInfo.isNewer === false || notifPref === 'manual' || (!canBuildCpu && !canBuildCuda)) return null

  async function applyBackendUpdateResult(result: BackendSourceUpdateResult) {
    const currentActiveBackend = useStore.getState().activeBackend

    setPaths(result.snapshot.paths)
    setModels(result.snapshot.models)
    setBackends(result.snapshot.backends)
    setCards(result.templates.map((template) => ({ template, status: 'idle', expanded: false })))

    const nextActiveBackend = currentActiveBackend
      ? result.snapshot.backends.find((backend) => backend.name === currentActiveBackend.name) ?? currentActiveBackend
      : result.snapshot.backends.find((backend) => backend.name === result.activeBackendName) ?? result.snapshot.backends[0] ?? null

    if (nextActiveBackend) {
      setActiveBackend(nextActiveBackend)
    }

    const commands = nextActiveBackend
      ? await window.api.getCommands(nextActiveBackend.name)
      : await window.api.getCommands('')

    setCommandsSchema(commands)
    setReleaseInfo(await window.api.checkUpdates())
  }

  const handleSourceUpdate = async (flavor: BackendBuildFlavor) => {
    if (!releaseInfo?.tagName) return

    setUpdatingSource(true)
    try {
      const res = await window.api.updateBackendSource(releaseInfo.tagName, flavor)
      if (res.success) {
        await applyBackendUpdateResult(res.result)
        setUpdateDismissed(true)
      } else if (res.cancelled) {
        return
      } else {
        alert(`Source update failed: ${res.error}`)
      }
    } catch (error) {
      alert(`Source update failed: ${String(error)}`)
    } finally {
      setUpdatingSource(false)
      setDownloadProgress(null)
    }
  }
  return (
    <div className="update-banner">
      {downloadProgress || updatingSource ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
      <span>
        <strong>{releaseInfo.name || releaseInfo.tagName}</strong> is available —{' '}
        <button onClick={() => window.api.openExternal(releaseInfo.url)}>
          View upstream tag
        </button>
        {' '}·{' '}
        {updatingSource || downloadProgress ? (
          <span style={{ opacity: 0.8 }}>
            {formatUpdateProgress(downloadProgress)}
          </span>
        ) : (
          <>
            {canBuildCpu && (
              <button onClick={() => void handleSourceUpdate('cpu')}>
                Build CPU
              </button>
            )}
            {canBuildCpu && canBuildCuda && ' or '}
            {canBuildCuda && (
              <button onClick={() => void handleSourceUpdate('cuda')}>
                Build CUDA
              </button>
            )}
          </>
        )}
      </span>
      {downloadProgress || updatingSource ? (
        <button 
          className="dismiss text-danger" 
          onClick={() => { void window.api.cancelBackendDownload() }} 
          title="Cancel Update"
        >
          Cancel
        </button>
      ) : (
        <button className="dismiss" onClick={() => setUpdateDismissed(true)} title="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
