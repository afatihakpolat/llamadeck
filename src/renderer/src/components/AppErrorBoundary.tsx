import React from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { getErrorMessage } from '../utils/notifications'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
  componentStack: string
}

export default class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: ''
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary:', error, info)
    this.setState({ componentStack: info.componentStack || '' })
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <main className="fatal-error-shell">
        <section className="fatal-error-card">
          <div className="fatal-error-mark"><AlertTriangle size={22} /></div>
          <div>
            <span className="fatal-error-eyebrow">Interface recovery</span>
            <h1>LlamaDeck hit an interface error</h1>
            <p>
              Running model processes were not stopped. Reload the interface to reconnect to the current app state.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={15} /> Reload interface
          </button>
          <details className="error-details">
            <summary>Technical details</summary>
            <pre>{getErrorMessage(error)}{componentStack}</pre>
          </details>
        </section>
      </main>
    )
  }
}
