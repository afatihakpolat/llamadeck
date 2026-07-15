import React, { useEffect, useRef } from 'react'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { yaml } from '@codemirror/lang-yaml'
import { basicSetup } from 'codemirror'
import { tags } from '@lezer/highlight'
import { validateLiteLlmConfig, type LiteLlmConfigValidation } from '../../../shared/liteLlmConfig'

interface LiteLlmConfigEditorProps {
  value: string
  canSave: boolean
  onChange: (value: string) => void
  onSave: () => void
  onValidationChange: (source: string, validation: LiteLlmConfigValidation) => void
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--code-bg)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    minHeight: '420px',
    maxHeight: '620px',
    overflow: 'auto',
    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    fontSize: '12px',
    lineHeight: '1.7'
  },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 18px 0 8px' },
  '.cm-gutters': {
    color: 'var(--text-muted)',
    backgroundColor: 'color-mix(in srgb, var(--code-bg) 86%, var(--surface))',
    borderRight: '1px solid var(--border)'
  },
  '.cm-gutterElement': { padding: '0 10px 0 8px' },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)'
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--focus-ring) !important'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-foldPlaceholder': {
    color: 'var(--text-secondary)',
    backgroundColor: 'var(--surface-2)',
    borderColor: 'var(--border)'
  },
  '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--surface-2)' },
  '.cm-panel.cm-search': { padding: '8px 10px' },
  '.cm-panel input, .cm-panel button': {
    color: 'var(--text)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)'
  },
  '.cm-tooltip': {
    color: 'var(--text)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-md)'
  }
})

const yamlHighlightStyle = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: '#93c5fd' },
  { tag: [tags.string, tags.special(tags.string)], color: '#fcd34d' },
  { tag: [tags.number, tags.bool, tags.null], color: '#c4b5fd' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: [tags.meta, tags.processingInstruction], color: '#f0abfc' },
  { tag: tags.punctuation, color: '#94a3b8' }
])

function yamlDiagnostics(validation: LiteLlmConfigValidation): Diagnostic[] {
  return validation.diagnostics.map((diagnostic) => ({
    from: diagnostic.from,
    to: diagnostic.to,
    severity: diagnostic.severity,
    source: 'YAML',
    message: diagnostic.message
  }))
}

export default function LiteLlmConfigEditor({ value, canSave, onChange, onSave, onValidationChange }: LiteLlmConfigEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onValidationChangeRef = useRef(onValidationChange)
  const canSaveRef = useRef(canSave)
  const applyingExternalValueRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onValidationChangeRef.current = onValidationChange
    canSaveRef.current = canSave
  }, [canSave, onChange, onSave, onValidationChange])

  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      parent: hostRef.current,
      doc: value,
      extensions: [
        basicSetup,
        yaml(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          'aria-label': 'LiteLLM proxy YAML configuration',
          'aria-multiline': 'true',
          spellcheck: 'false'
        }),
        editorTheme,
        syntaxHighlighting(yamlHighlightStyle),
        lintGutter(),
        linter((editor) => {
          const source = editor.state.doc.toString()
          const validation = validateLiteLlmConfig(source)
          onValidationChangeRef.current(source, validation)
          return yamlDiagnostics(validation)
        }, { delay: 400 }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              if (canSaveRef.current) onSaveRef.current()
              return true
            }
          },
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalValueRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        })
      ]
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return

    applyingExternalValueRef.current = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    applyingExternalValueRef.current = false
  }, [value])

  return <div ref={hostRef} className="litellm-config-editor" />
}
