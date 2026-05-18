import React from 'react'
import { useStore } from '../store/useStore'
import { RefreshCw } from 'lucide-react'
interface Props {
  onCheckUpdates: () => void
}
export default function Titlebar({ onCheckUpdates }: Props) {
  const { checkingUpdate } = useStore()
  return (
    <header className="titlebar">
      {}
      <div className="titlebar-logo">
        <img
          src="./icon.png"
          alt="LlamaDeck"
          className="titlebar-logo-icon brand-logo-img"
          draggable={false}
        />
        <span className="titlebar-brand-text">LlamaDeck</span>
      </div>
      {}
      <div className="titlebar-drag-region" />
      <div className="titlebar-actions">
        <button
          className={`btn btn-ghost btn-icon ${checkingUpdate ? 'spin-btn' : ''}`}
          onClick={onCheckUpdates}
          title="Check for llama.cpp updates"
          disabled={checkingUpdate}
        >
          <RefreshCw size={15} className={checkingUpdate ? 'spin' : ''} />
        </button>
      </div>
    </header>
  )
}
