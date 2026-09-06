import React, { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import { ChevronDown, Cpu, Loader2, Sparkles, Zap } from 'lucide-react'
import type {
  BackendAccelerator,
  BackendBuildFlavor,
  BackendBuildMode,
  BackendBuildOptions,
  BackendBuildType,
  BackendVersion
} from '../../../shared/types'
import { resolveBuildFlavor } from '../../../shared/types'

const ALL_FLAVORS: BackendBuildFlavor[] = [
  'cuda', 'cpu', 'vulkan', 'cuda-rpc', 'cpu-rpc', 'vulkan-rpc'
]

function expectedFolderName(tagName: string, flavor: BackendBuildFlavor): string {
  if (flavor === 'cuda') return tagName
  return `${tagName}-${flavor}`
}

function hasInstalledFlavor(backends: BackendVersion[], tagName: string, flavor: BackendBuildFlavor): boolean {
  if (!tagName) return false
  return backends.some((backend) => backend.name === expectedFolderName(tagName, flavor))
}

function acceleratorHint(accelerator: BackendAccelerator): string {
  if (accelerator === 'cuda') return 'Uses your NVIDIA GPU. Requires nvcc and the Visual Studio C++ toolchain.'
  if (accelerator === 'cpu') return 'CPU-only build. Works on any Windows machine without extra SDKs.'
  return 'Uses the LunarG Vulkan SDK. Early-adopter; known Windows crash issues upstream.'
}

function buildModeHint(buildMode: BackendBuildMode): string {
  if (buildMode === 'parallel') return 'Parallel: default 4 scheduler copies. Recommended for higher concurrent throughput.'
  return 'Single: one scheduler copy. Saves VRAM with no single-user throughput cost.'
}

export default function BuildOptionsModal() {
  const {
    showBuildOptions, buildOptionsTag, setShowBuildOptions,
    backends, releaseInfo, setBackends, setModels, setPaths,
    setActiveBackend, setCommandsSchema, setCards, setReleaseInfo
  } = useStore(useShallow((state) => ({
    showBuildOptions: state.showBuildOptions,
    buildOptionsTag: state.buildOptionsTag,
    setShowBuildOptions: state.setShowBuildOptions,
    backends: state.backends,
    releaseInfo: state.releaseInfo,
    setBackends: state.setBackends,
    setModels: state.setModels,
    setPaths: state.setPaths,
    setActiveBackend: state.setActiveBackend,
    setCommandsSchema: state.setCommandsSchema,
    setCards: state.setCards,
    setReleaseInfo: state.setReleaseInfo
  })))

  const [accelerator, setAccelerator] = useState<BackendAccelerator>('cuda')
  const [enableRpc, setEnableRpc] = useState(false)
  const [buildMode, setBuildMode] = useState<BackendBuildMode>('parallel')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [buildType, setBuildType] = useState<BackendBuildType>('Release')
  const [cudaArch, setCudaArch] = useState('native')
  const [faAllQuants, setFaAllQuants] = useState(true)
  const [building, setBuilding] = useState(false)

  const tag = (buildOptionsTag || releaseInfo?.tagName || '').trim()
  const selectedFlavor = resolveBuildFlavor(accelerator, enableRpc)
  const comboAlreadyInstalled = useMemo(
    () => hasInstalledFlavor(backends, tag, selectedFlavor),
    [backends, tag, selectedFlavor]
  )
  const installedVariants = useMemo(() => {
    if (!tag) return [] as BackendBuildFlavor[]
    return ALL_FLAVORS.filter((flavor) => hasInstalledFlavor(backends, tag, flavor))
  }, [backends, tag])

  useEffect(() => {
    if (!showBuildOptions) return
    setAccelerator('cuda')
    setEnableRpc(false)
    setBuildMode('parallel')
    setShowAdvanced(false)
    setBuildType('Release')
    setCudaArch('native')
    setFaAllQuants(true)
    setBuilding(false)
  }, [showBuildOptions])

  function closeModal() {
    if (building) return
    setShowBuildOptions(false)
  }

  async function applyBackendUpdateResult(result: {
    snapshot: { paths: { models: string; templates: string; backend: string }; models: Array<{ name: string; path: string; size: number; folder: string }>; backends: BackendVersion[] }
    templates: { id: string; name: string; description?: string; backendVersion?: string; modelPath?: string; serverPort: number; args: Record<string, string | number | boolean | null>; launchMode?: 'chat' | 'api'; createdAt: string; updatedAt: string; _file?: string; pricing?: { inputCostPerMillion: number; cacheCostPerMillion: number; outputCostPerMillion: number } }[]
    activeBackendName: string
  }) {
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

  async function handleBuild() {
    if (!tag || comboAlreadyInstalled || building) return

    const options: BackendBuildOptions = {
      accelerator,
      enableRpc,
      buildMode,
      buildType,
      cudaArch: accelerator === 'cuda' ? cudaArch.trim() : '',
      faAllQuants: accelerator === 'cuda' && faAllQuants
    }

    setBuilding(true)
    try {
      const res = await window.api.updateBackendSource(tag, options)
      if (res.success) {
        await applyBackendUpdateResult(res.result)
        setShowBuildOptions(false)
      } else if (res.cancelled) {
        return
      } else {
        useStore.getState().pushNotification({
          tone: 'danger',
          title: 'Source build failed',
          message: res.error || 'The llama.cpp source build did not complete.'
        })
      }
    } catch (error) {
      useStore.getState().pushNotification({
        tone: 'danger',
        title: 'Source build failed',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBuilding(false)
      useStore.getState().setDownloadProgress(null)
    }
  }

  function handleCancelBuild() {
    void window.api.cancelBackendDownload()
  }

  if (!showBuildOptions) return null

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Build Options</h2>
            <div className="form-hint" style={{ marginTop: 4 }}>
              llama.cpp {tag ? `· ${tag}` : ''}
            </div>
          </div>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Compute backend</label>
            <div className="launch-mode-row">
              <button
                type="button"
                className={`launch-mode-btn ${accelerator === 'cuda' ? 'active' : ''}`}
                onClick={() => setAccelerator('cuda')}
              >
                <Sparkles size={13} /> CUDA <span style={{ marginLeft: 4, opacity: 0.75 }}>(Recommended)</span>
              </button>
              <button
                type="button"
                className={`launch-mode-btn ${accelerator === 'cpu' ? 'active' : ''}`}
                onClick={() => setAccelerator('cpu')}
              >
                <Cpu size={13} /> CPU Only
              </button>
              <button
                type="button"
                className={`launch-mode-btn ${accelerator === 'vulkan' ? 'active' : ''}`}
                onClick={() => setAccelerator('vulkan')}
              >
                <Zap size={13} /> Vulkan
              </button>
            </div>
            <div className="form-hint">{acceleratorHint(accelerator)}</div>
          </div>

          <div className="form-group">
            <label className="form-label">Extra</label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={enableRpc}
                onChange={(event) => setEnableRpc(event.target.checked)}
              />
              <span>Enable RPC backend (-DGGML_RPC=ON)</span>
            </label>
            <div className="form-hint">Only for distributed inference across machines. Requires an RPC server to do anything useful.</div>
          </div>

          <div className="form-group">
            <label className="form-label">Scheduler</label>
            <div className="launch-mode-row">
              <button
                type="button"
                className={`launch-mode-btn ${buildMode === 'parallel' ? 'active' : ''}`}
                onClick={() => setBuildMode('parallel')}
              >
                Parallel <span style={{ marginLeft: 4, opacity: 0.75 }}>(Recommended)</span>
              </button>
              <button
                type="button"
                className={`launch-mode-btn ${buildMode === 'single' ? 'active' : ''}`}
                onClick={() => setBuildMode('single')}
              >
                Single (Save VRAM)
              </button>
            </div>
            <div className="form-hint">{buildModeHint(buildMode)}</div>
          </div>

          {installedVariants.length > 0 && (
            <div className="form-group">
              <label className="form-label">Already installed for {tag}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {installedVariants.map((flavor) => (
                  <span key={flavor} className="version-badge">{flavor}</span>
                ))}
              </div>
              <div className="form-hint">Pick a different combination to build another variant.</div>
            </div>
          )}

          {comboAlreadyInstalled && (
            <div className="form-hint" style={{ marginBottom: 12, color: 'var(--success)' }}>
              This combination is already installed for {tag}. Choose a different accelerator or RPC toggle to build a new variant.
            </div>
          )}

          <div className="collapsible-section">
            <button
              type="button"
              className="collapsible-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span>Advanced</span>
              <ChevronDown
                size={14}
                style={{ marginLeft: 'auto', transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 180ms' }}
              />
            </button>
            {showAdvanced && (
              <div className="collapsible-body">
                <div className="form-group">
                  <label className="form-label">Build type</label>
                  <select
                    className="form-select"
                    value={buildType}
                    onChange={(event) => setBuildType(event.target.value as BackendBuildType)}
                  >
                    <option value="Release">Release</option>
                    <option value="RelWithDebInfo">RelWithDebInfo</option>
                    <option value="Debug">Debug</option>
                  </select>
                  <div className="form-hint">Release is the default and recommended for normal use.</div>
                </div>
                <div className="form-group">
                  <label className="form-label">CUDA architecture</label>
                  <input
                    type="text"
                    className="form-input"
                    value={cudaArch}
                    onChange={(event) => setCudaArch(event.target.value)}
                    placeholder="native"
                    disabled={accelerator !== 'cuda'}
                  />
                  <div className="form-hint">
                    Leave as <code>native</code> for auto-detection. Use a comma-separated list (e.g. <code>75;86;89</code>) to target specific GPUs.
                  </div>
                </div>
                <div className="form-group mb-0">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={faAllQuants}
                      onChange={(event) => setFaAllQuants(event.target.checked)}
                      disabled={accelerator !== 'cuda'}
                    />
                    <span>Enable Flash Attention for all quantizations (-DGGML_CUDA_FA_ALL_QUANTS=ON)</span>
                  </label>
                  <div className="form-hint">Improves throughput on quantized KV caches. Requires CUDA.</div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          {building ? (
            <button type="button" className="btn btn-ghost text-danger" onClick={handleCancelBuild}>
              Cancel Build
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={closeModal}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { void handleBuild() }}
            disabled={building || !tag || comboAlreadyInstalled}
          >
            {building ? <Loader2 size={14} className="spin" /> : null}
            {building ? 'Building…' : 'Build'}
          </button>
        </div>
      </div>
    </div>
  )
}
