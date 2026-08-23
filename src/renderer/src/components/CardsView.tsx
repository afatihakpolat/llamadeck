import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import ModelCard from './ModelCard'
import { ChevronDown, Folder, FolderOpen, Plus, Search, Upload } from 'lucide-react'
import type { Template } from '../../../shared/types'
import { groupTemplatesByModelFolder } from '../utils/templateGrouping'
import {
  DEFAULT_TEMPLATE_SORT_MODE,
  TEMPLATE_SORT_OPTIONS,
  buildTemplateUsageMap,
  sortCardsByMode,
  sortTemplateGroupsByMode,
  type TemplateSortMode,
  type TemplateUsage
} from '../utils/templateSorting'
import { LLAMADECK_STORAGE_KEYS, readLlamaDeckStorage, writeLlamaDeckStorage } from '../utils/storageMigration'

function readStoredTemplateSortMode(): TemplateSortMode {
  if (typeof window === 'undefined') return DEFAULT_TEMPLATE_SORT_MODE

  const storedValue = readLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.templateSort)
  return storedValue === 'most-used' || storedValue === 'name' || storedValue === 'default'
    ? storedValue
    : DEFAULT_TEMPLATE_SORT_MODE
}

export default function CardsView() {
  const { cards, setShowCreateModal, addCard, templateSearch, setTemplateSearch } = useStore()
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [sortMode, setSortMode] = useState<TemplateSortMode>(readStoredTemplateSortMode)
  const [templateUsage, setTemplateUsage] = useState<Map<string, TemplateUsage>>(() => new Map())

  useEffect(() => {
    let active = true

    async function loadTemplateUsage() {
      try {
        const snapshot = await window.api.getUsageStats({ limit: 1 })
        if (active) {
          setTemplateUsage(buildTemplateUsageMap(snapshot.templateRollups))
        }
      } catch (error) {
        // Keep the last known usage counts; ranking degrades to name order only.
        console.warn('Failed to load template usage for sorting:', error)
      }
    }

    void loadTemplateUsage()
    const unsubscribe = window.api.onUsageUpdated(() => {
      void loadTemplateUsage()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  function changeSortMode(mode: TemplateSortMode) {
    setSortMode(mode)
    if (typeof window !== 'undefined') {
      writeLlamaDeckStorage(LLAMADECK_STORAGE_KEYS.templateSort, mode)
    }
  }

  async function handleImport() {
    const template = await window.api.importTemplate()
    if (template) {
      addCard(template as Template)
    }
  }

  const normalizedSearch = templateSearch.trim().toLowerCase()
  const sortedCards = useMemo(
    () => sortCardsByMode(cards, sortMode, templateUsage),
    [cards, sortMode, templateUsage]
  )
  const filtered = useMemo(() => {
    if (!normalizedSearch) return sortedCards

    return sortedCards.filter((card) => (
      card.template.name.toLowerCase().includes(normalizedSearch) ||
      (card.template.description || '').toLowerCase().includes(normalizedSearch) ||
      (card.template.modelPath || '').toLowerCase().includes(normalizedSearch)
    ))
  }, [sortedCards, normalizedSearch])
  const visibleGroups = useMemo(
    () => sortTemplateGroupsByMode(groupTemplatesByModelFolder(filtered), sortMode, templateUsage),
    [filtered, sortMode, templateUsage]
  )

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupId]: !current[groupId]
    }))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Templates</h1>
          <p className="page-subtitle">
            {cards.length === 0
              ? 'Create your first template to get started'
              : normalizedSearch
                ? `${filtered.length} of ${cards.length} template${cards.length !== 1 ? 's' : ''}`
                : `${cards.length} template${cards.length !== 1 ? 's' : ''} in ${visibleGroups.length} model group${visibleGroups.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={handleImport}>
            <Upload size={15} />
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={15} />
            New Template
          </button>
        </div>
      </div>
      {}
      {cards.length > 0 && (
        <div className="template-search-bar">
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            className="template-search-input"
            placeholder="Search templates or model folders..."
            value={templateSearch}
            onChange={e => setTemplateSearch(e.target.value)}
          />
          {templateSearch && (
            <button
              className="template-search-clear"
              onClick={() => setTemplateSearch('')}
              title="Clear"
            >×</button>
          )}
          <span className="template-search-divider" aria-hidden="true" />
          <label className="template-sort-label" htmlFor="template-sort-select">Sort</label>
          <select
            id="template-sort-select"
            className="template-sort-select"
            value={sortMode}
            onChange={(event) => changeSortMode(event.target.value as TemplateSortMode)}
          >
            {TEMPLATE_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
      {cards.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </div>
          <h3>No templates yet</h3>
          <p>Create a template to configure and launch a llama.cpp model with one click.</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={15} />
            Create Template
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 24px' }}>
          <h3 style={{ fontSize: 15 }}>No matches</h3>
          <p>No templates or model folders found for "{templateSearch}".</p>
          <button className="btn btn-ghost" onClick={() => setTemplateSearch('')}>Clear search</button>
        </div>
      ) : (
        <div className="template-groups">
          {visibleGroups.map((group) => {
            const isExpanded = Boolean(normalizedSearch) || expandedGroups[group.id] === true
            const runningCount = group.cards.reduce(
              (count, card) => count + (card.status === 'running' ? 1 : 0),
              0
            )

            return (
              <section className={`template-group ${isExpanded ? 'open' : ''}`} key={group.id}>
                <button
                  type="button"
                  className="template-group-header"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="template-group-name">
                    {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                    <span title={group.label}>{group.label}</span>
                  </span>
                  <span className="template-group-summary">
                    {runningCount > 0 ? (
                      <span className="template-group-running">
                        <span className="status-dot running" />
                        {runningCount} running
                      </span>
                    ) : null}
                    <span>{group.cards.length} template{group.cards.length !== 1 ? 's' : ''}</span>
                    <ChevronDown className="template-group-chevron" size={16} />
                  </span>
                </button>
                <div className="template-group-body" hidden={!isExpanded}>
                  <div className="cards-grid">
                    {group.cards.map((card) => (
                      <ModelCard key={card.template.id} card={card} />
                    ))}
                  </div>
                </div>
              </section>
            )
          })}
          <button className="template-add-button" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            <span>Add Template</span>
          </button>
        </div>
      )}
    </div>
  )
}
