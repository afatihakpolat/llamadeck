import React from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import type { StartupFailure } from '../utils/appInitialization'

interface StartupStatusScreenProps {
  failure?: StartupFailure | null
  onRetry?: () => void
}

const BOOT_STEPS = ['Workspace', 'Backends', 'Sessions'] as const

export default function StartupStatusScreen({ failure = null, onRetry }: StartupStatusScreenProps) {
  const failed = failure !== null

  return (
    <main className={`startup-shell ${failed ? 'failed' : 'loading'}`}>
      <section className="startup-card">
        <div className="startup-brand">
          <img src="./icon.png" alt="" className="startup-logo" draggable={false} />
          <div>
            <span className="startup-brand-name">LlamaDeck</span>
            <span className="startup-brand-mode">Local model control</span>
          </div>
        </div>

        <div className="startup-copy">
          {failed ? (
            <>
              <span className="startup-state-icon"><AlertTriangle size={20} /></span>
              <span className="startup-eyebrow">Startup recovery</span>
              <h1>Local workspace did not finish loading</h1>
              <p>{failure.message}</p>
              <span className="startup-failed-stage">Stopped at: {failure.stage}</span>
            </>
          ) : (
            <>
              <span className="startup-eyebrow">Starting safely</span>
              <h1>Loading your local workspace</h1>
              <p>Checking folders, backends, templates, and running sessions in parallel.</p>
            </>
          )}
        </div>

        <div className="startup-trace" aria-label={failed ? 'Startup failed' : 'Startup progress'}>
          {BOOT_STEPS.map((step, index) => (
            <span key={step} className={failed ? (index === 0 ? 'failed' : 'idle') : 'active'}>
              <i />
              {step}
            </span>
          ))}
        </div>

        {failed ? (
          <div className="startup-actions">
            <button className="btn btn-primary" onClick={onRetry} disabled={!onRetry}>
              <RefreshCw size={15} /> Try again
            </button>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} /> Reload interface
            </button>
          </div>
        ) : (
          <span className="startup-working" role="status">Connecting to the desktop service…</span>
        )}

        {failed ? (
          <details className="error-details startup-error-details">
            <summary>Technical details</summary>
            <pre>{failure.details}</pre>
          </details>
        ) : null}
      </section>
    </main>
  )
}
