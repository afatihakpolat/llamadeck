import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import {
  LLAMADECK_STORAGE_KEYS,
  readLlamaDeckStorage
} from '../utils/storageMigration'
import { X, Download, Loader2 } from 'lucide-react'
import type { BackendBuildFlavor, BackendVersion } from '../../../shared/types'

function hasInstalledBuild(backends: BackendVersion[], tagName: string, flavor: BackendBuildFlavor): boolean {
  if (!tagName) return false
  const expectedBackendName = flavor === 'cuda' ? tagName : `${tagName}-${flavor}`
  return backends.some((backend) => backend.name === expectedBackendName)
}

function allFlavorsInstalled(backends: BackendVersion[], tagName: string): boolean {
  const allFlavors: BackendBuildFlavor[] = ['cuda', 'cpu', 'vulkan', 'cuda-rpc', 'cpu-rpc', 'vulkan-rpc']
  return allFlavors.every((flavor) => hasInstalledBuild(backends, tagName, flavor))
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
    downloadProgress, backends, setShowBuildOptions
  } = useStore(useShallow((state) => ({
    releaseInfo: state.releaseInfo,
    updateDismissed: state.updateDismissed,
    setUpdateDismissed: state.setUpdateDismissed,
    downloadProgress: state.downloadProgress,
    backends: state.backends,
    setShowBuildOptions: state.setShowBuildOptions
  })))
  const notifPref = readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.updateNotification) || 'banner'
  const latestTagName = releaseInfo?.tagName?.trim() || ''
  const allInstalled = latestTagName ? allFlavorsInstalled(backends, latestTagName) : true
  if (
    !releaseInfo
    || releaseInfo.error
    || updateDismissed
    || releaseInfo.isNewer === false
    || notifPref === 'manual'
    || allInstalled
  ) {
    return null
  }

  return (
    <div className="update-banner">
      {downloadProgress ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
      <span>
        <strong>{releaseInfo.name || releaseInfo.tagName}</strong> is available —{' '}
        <button onClick={() => window.api.openExternal(releaseInfo.url)}>
          View upstream tag
        </button>
        {' '}·{' '}
        {downloadProgress ? (
          <span style={{ opacity: 0.8 }}>
            {formatUpdateProgress(downloadProgress)}
          </span>
        ) : (
          <button onClick={() => setShowBuildOptions(true, latestTagName)}>
            Build
          </button>
        )}
      </span>
      {downloadProgress ? (
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
