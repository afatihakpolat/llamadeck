import React, { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { Box, Cpu, Zap, Database, Sliders, Wind, Server, FileText, GitBranch, Search, Star, Lock } from 'lucide-react'
import type { CommandParam } from '../../../shared/types'
import {
  getBooleanCommandFlag,
  isCommaListSelectCommand,
  isDefaultTrueBooleanCommand,
  parseCommaListCommandValue,
  toggleCommaListCommandValue
} from '../utils/commandArgs'

interface DisplayCategory {
  name: string
  icon: string
  commands: CommandParam[]
}

const iconMap: Record<string, React.ReactNode> = {
  Box: <Box size={14} />,
  Cpu: <Cpu size={14} />,
  Zap: <Zap size={14} />,
  Database: <Database size={14} />,
  Sliders: <Sliders size={14} />,
  Wind: <Wind size={14} />,
  Server: <Server size={14} />,
  FileText: <FileText size={14} />,
  GitBranch: <GitBranch size={14} />,
  Star: <Star size={14} />
}
const FEATURED_ARGS = ['--ctx-size', '--gpu-layers', '--threads', '--batch-size', '--flash-attn']

function formatDefaultValue(value: string | number | boolean | null | undefined): string | null {
  if (value === undefined) return null
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === '') return 'empty'
  return String(value)
}

function getDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0

  const normalized = value.toString().toLowerCase()
  if (normalized.includes('e-')) {
    const [, exponent = '0'] = normalized.split('e-')
    const mantissa = normalized.split('e-')[0]
    const mantissaDecimals = mantissa.includes('.') ? mantissa.split('.')[1].length : 0
    return Number(exponent) + mantissaDecimals
  }

  if (!normalized.includes('.')) return 0
  return normalized.split('.')[1].length
}

function getDescriptionRange(cmd: CommandParam): { min?: number; max?: number } {
  const rangeMatch = cmd.description.match(/valid range\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i)
  if (!rangeMatch) return {}

  return {
    min: Number(rangeMatch[1]),
    max: Number(rangeMatch[2])
  }
}

function getNumberPrecision(cmd: CommandParam): number {
  const descriptionNumbers = cmd.description.match(/-?\d+\.\d+/g) ?? []
  const candidates = [cmd.default, cmd.min, cmd.max]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .concat(descriptionNumbers.map(Number).filter(Number.isFinite))

  const precision = candidates.reduce((maxPrecision, value) => {
    return Math.max(maxPrecision, getDecimalPlaces(value))
  }, 0)

  return precision
}

function getNumberStep(cmd: CommandParam): number {
  const precision = getNumberPrecision(cmd)

  return precision > 0 ? 10 ** -precision : 1
}

function clampNumber(value: number, cmd: CommandParam): number {
  const descriptionRange = getDescriptionRange(cmd)
  const min = cmd.min ?? descriptionRange.min ?? -Infinity
  const max = cmd.max ?? descriptionRange.max ?? Infinity
  return Math.min(max, Math.max(min, value))
}

function snapNumberToStep(value: number, step: number, min?: number): number {
  const origin = min ?? 0
  const precision = getDecimalPlaces(step)
  const snappedValue = origin + Math.round((value - origin) / step) * step

  return Number(snappedValue.toFixed(precision))
}

function adjustNumberValue(currentValue: unknown, delta: number, cmd: CommandParam): number {
  const step = getNumberStep(cmd)
  const descriptionRange = getDescriptionRange(cmd)
  const min = cmd.min ?? descriptionRange.min
  const baseValue = typeof currentValue === 'number'
    ? currentValue
    : typeof cmd.default === 'number'
      ? cmd.default
      : cmd.min ?? 0
  const snappedBaseValue = snapNumberToStep(baseValue, step, min)
  const nextValue = clampNumber(snappedBaseValue + delta * step, cmd)
  const precision = getDecimalPlaces(step)

  return Number(nextValue.toFixed(precision))
}

function isCommandConfigured(cmd: CommandParam, args: Record<string, any>): boolean {
  return Object.prototype.hasOwnProperty.call(args, cmd.arg)
}

interface Props {
  templateId?: string
  args: Record<string, any>
  onChange?: (args: Record<string, any>) => void
  modelPathFallback?: string
  serverPortFallback?: number
  disabled?: boolean
}
export default function CmdParamsEditor({ templateId, args, onChange, modelPathFallback, serverPortFallback, disabled: disabledProp }: Props) {
  const { commandsSchema, updateCard, cards } = useStore()
  const [searchQuery, setSearchQuery] = useState('')

  const card = templateId ? cards.find(c => c.template.id === templateId) : null
  const isRunning = card?.status === 'running'
  const disabled = disabledProp || isRunning
  const cmdPreview = useMemo(() => {
    const parts: React.ReactNode[] = []
    const commandsByArg = new Map<string, CommandParam>()

    commandsSchema?.categories.forEach((category) => {
      category.commands.forEach((command) => {
        commandsByArg.set(command.arg, command)
      })
    })

    parts.push(<span key="base">llama-server</span>)
    const finalModelPath = card?.template.modelPath || modelPathFallback
    if (finalModelPath) {
        parts.push(' ', <span key="arg-m" className="arg">-m</span>, ' ', <span key="val-m" className="val">"{finalModelPath}"</span>)
    }
    Object.entries(args).forEach(([key, val]) => {
      const command = commandsByArg.get(key)
      const booleanFlag = command ? getBooleanCommandFlag(command, val) : null

      if (booleanFlag) {
        parts.push(' ', <span key={`arg-${booleanFlag}`} className="arg">{booleanFlag}</span>)
      } else if (val === true) {
        parts.push(' ', <span key={`arg-${key}`} className="arg">{key}</span>)
      } else if (val !== false && val !== null && val !== '') {
        parts.push(' ', <span key={`arg-${key}`} className="arg">{key}</span>, ' ', <span key={`val-${key}`} className="val">{val}</span>)
      }
    })
    const finalPort = card?.template.serverPort || serverPortFallback
    if (finalPort && args['--port'] === undefined) {
         parts.push(' ', <span key="arg-port" className="arg">--port</span>, ' ', <span key="val-port" className="val">{finalPort}</span>)
    }
    return parts
  }, [args, cards, commandsSchema, templateId, modelPathFallback, serverPortFallback])
  const filteredCategories = useMemo<DisplayCategory[]>(() => {
    if (!commandsSchema) return []
    let allCommands: CommandParam[] = []
    commandsSchema.categories.forEach(cat => allCommands.push(...cat.commands))
    const q = searchQuery.toLowerCase()
    let visibleCategories: DisplayCategory[]

    if (q) {
      visibleCategories = commandsSchema.categories.map(cat => ({
        ...cat,
        commands: cat.commands.filter(cmd => 
          cmd.label.toLowerCase().includes(q) || 
          cmd.arg.toLowerCase().includes(q) || 
          (cmd.short && cmd.short.toLowerCase().includes(q))
        )
      })).filter(cat => cat.commands.length > 0)
    } else {
      const featuredCommands = allCommands.filter(c => FEATURED_ARGS.includes(c.arg))
      const cats = commandsSchema.categories.map(cat => ({
        ...cat,
        commands: cat.commands.filter(c => !FEATURED_ARGS.includes(c.arg))
      })).filter(cat => cat.commands.length > 0)

      if (featuredCommands.length > 0) {
        featuredCommands.sort((a, b) => FEATURED_ARGS.indexOf(a.arg) - FEATURED_ARGS.indexOf(b.arg))
        cats.unshift({
          name: 'Main Settings',
          icon: 'Star',
          commands: featuredCommands
        })
      }

      visibleCategories = cats
    }

    if (q) {
      return visibleCategories
    }

    const configuredCommands = visibleCategories.flatMap((category) => {
      return category.commands.filter((command) => isCommandConfigured(command, args))
    })

    if (configuredCommands.length === 0) {
      return visibleCategories
    }

    const configuredCommandArgs = new Set(configuredCommands.map((command) => command.arg))
    const remainingCategories = visibleCategories.map((category) => ({
      ...category,
      commands: category.commands.filter((command) => !configuredCommandArgs.has(command.arg))
    })).filter((category) => category.commands.length > 0)

    return [{
      name: 'Configured Parameters',
      icon: 'Sliders',
      commands: configuredCommands
    }, ...remainingCategories]
  }, [args, commandsSchema, searchQuery])
  if (!commandsSchema) {
    return <div className="text-muted text-sm">No commands schema loaded. Ensure a backend is installed.</div>
  }
  const handleUpdate = (cmd: CommandParam, value: any) => {
    const newArgs = { ...args }
    if (cmd.type === 'boolean') {
      const shouldRemove = value === cmd.default || (value === false && !isDefaultTrueBooleanCommand(cmd))
      if (shouldRemove) {
        delete newArgs[cmd.arg]
      } else {
        newArgs[cmd.arg] = value
      }
    } else if (value === null || value === '') {
        delete newArgs[cmd.arg]
    } else {
        newArgs[cmd.arg] = value
    }
    if (onChange) {
        onChange(newArgs)
    } else if (templateId) {
        updateCard(templateId, { args: newArgs })
    }
  }
  const renderCommand = (cmd: CommandParam) => {
    if (cmd.arg === '--model' || cmd.arg === '--port') return null
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(args, cmd.arg)
    const isCommaListSelect = isCommaListSelectCommand(cmd)
    const val = hasExplicitValue
      ? args[cmd.arg]
      : cmd.type === 'boolean'
        ? cmd.default === true
        : ''
    const isActive = hasExplicitValue
    const defaultValue = formatDefaultValue(cmd.default)
    const descriptionRange = getDescriptionRange(cmd)
    const numericStep = cmd.type === 'number' ? getNumberStep(cmd) : undefined
    const numericMin = cmd.type === 'number' ? (cmd.min ?? descriptionRange.min) : undefined
    const numericMax = cmd.type === 'number' ? (cmd.max ?? descriptionRange.max) : undefined
    const commaListValues = isCommaListSelect ? parseCommaListCommandValue(val) : []
    return (
      <div key={cmd.arg} className={`cmd-row ${isActive ? 'active-param' : ''} ${cmd.type === 'text' || isCommaListSelect ? 'cmd-row-full' : ''}`}>
        <div className="cmd-label-group">
          <div className="cmd-label tooltip-wrap">
            {cmd.label}
            <span className="tooltip">{cmd.description}</span>
          </div>
          <div className="cmd-arg">{cmd.short ? `${cmd.short}, ` : ''}{cmd.arg}</div>
          {defaultValue !== null && <div className="cmd-default">Default: {defaultValue}</div>}
        </div>
        <div className="cmd-input-group">
          {cmd.type === 'boolean' && (
            <div className="toggle-wrap">
              <label className="toggle" style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
                <input type="checkbox" checked={!!val} onChange={(e) => handleUpdate(cmd, e.target.checked)} disabled={disabled} />
                <span className="toggle-track"></span>
                <span className="toggle-thumb"></span>
              </label>
            </div>
          )}
          {cmd.type === 'number' && (
            <div className="num-input-wrap">
              <button type="button" className="num-btn" onClick={() => handleUpdate(cmd, adjustNumberValue(val, -1, cmd))} disabled={disabled}>-</button>
              <input
                type="number" className="cmd-input num" value={val} placeholder={cmd.default?.toString()} min={numericMin} max={numericMax} step={numericStep}
                onChange={(e) => handleUpdate(cmd, e.target.value === '' ? '' : Number(e.target.value))}
                disabled={disabled}
              />
              <button type="button" className="num-btn" onClick={() => handleUpdate(cmd, adjustNumberValue(val, 1, cmd))} disabled={disabled}>+</button>
            </div>
          )}
          {cmd.type === 'string' && (
            <input type="text" className="cmd-input" value={val} placeholder={cmd.placeholder || cmd.default?.toString()} onChange={(e) => handleUpdate(cmd, e.target.value)} disabled={disabled} />
          )}
          {cmd.type === 'select' && isCommaListSelect && (
            <div className="cmd-multi-select" role="group" aria-label={cmd.label}>
              {(cmd.options || []).map((opt) => {
                const checked = commaListValues.includes(opt)
                return (
                  <label key={opt} className={`cmd-multi-option ${checked ? 'active' : ''} ${disabled ? 'disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleUpdate(cmd, toggleCommaListCommandValue(val, opt, cmd.options || [], cmd.default))}
                      disabled={disabled}
                    />
                    <span>{opt}</span>
                  </label>
                )
              })}
            </div>
          )}
          {cmd.type === 'select' && !isCommaListSelect && (
            <select className="cmd-select" value={val} onChange={(e) => handleUpdate(cmd, e.target.value)} disabled={disabled}>
              <option value="">{defaultValue !== null ? `Default (${defaultValue})` : 'Default'}</option>
              {cmd.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          )}
        </div>
        {cmd.type === 'text' && (
          <textarea className="cmd-textarea" value={val} placeholder={cmd.placeholder} onChange={(e) => handleUpdate(cmd, e.target.value)} disabled={disabled} />
        )}
      </div>
    )
  }
  return (
    <div className="params-editor-container">
      {disabled && isRunning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 12, borderRadius: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)', fontSize: 12
        }}>
          <Lock size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
          Parameters are locked while the model is running. Stop it first to make changes.
        </div>
      )}
      <div className="params-search-box">
        <Search size={16} style={{ color: 'var(--text-muted)' }} />
        <input 
          type="text" 
          className="form-input" 
          placeholder="Search parameters..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="params-scroll-area" style={disabled ? { opacity: 0.55, pointerEvents: 'none', userSelect: 'none' } : {}}>
        {filteredCategories.length === 0 ? (
           <div className="text-center py-6 text-sm text-muted">No parameters matched your search.</div>
        ) : (
          filteredCategories.map((cat) => (
            <div key={cat.name} className="cmd-section">
              <div className="cmd-section-header" style={cat.name === 'Main Settings' ? { color: 'var(--text)' } : {}}>
                {iconMap[cat.icon]} {cat.name}
              </div>
              <div className="cmd-grid">
                {cat.commands.map(renderCommand)}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="cmd-section" style={{ marginBottom: 0, marginTop: 16 }}>
        <div className="cmd-section-header">Preview</div>
        <div className="cmd-preview">
          {cmdPreview}
        </div>
      </div>
    </div>
  )
}
