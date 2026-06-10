import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { MONO_FONT } from '../theme'

// Minimal dark theme from the app palette (CSS variables defined in index.css).
const appTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--od-surface)', color: 'var(--od-fg)', height: '100%', fontSize: '13px' },
  '.cm-content': { fontFamily: MONO_FONT, caretColor: 'var(--od-accent)' },
  '.cm-gutters': { backgroundColor: 'var(--od-surface)', color: 'var(--od-fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--od-accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--od-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--od-accent) 25%, transparent)'
  },
  '.cm-cursor': { borderLeftColor: 'var(--od-accent)' }
}, { dark: true })

// CodeMirror 6 wrapper: language loads lazily by filename so no grammar ships
// in the main bundle until a file of that type is actually opened.
export function CodeEditor({ value, path, onChange }: {
  value: string
  path: string
  onChange: (text: string) => void
}) {
  const [lang, setLang] = useState<Extension | null>(null)
  useEffect(() => {
    let stale = false
    const name = path.split('/').pop() ?? ''
    const desc = LanguageDescription.matchFilename(languages, name)
    if (!desc) { setLang(null); return }
    void desc.load().then((support) => { if (!stale) setLang(support) })
    return () => { stale = true }
  }, [path])
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={appTheme}
      extensions={lang ? [lang, EditorView.lineWrapping] : [EditorView.lineWrapping]}
      height="100%"
      style={{ height: '100%' }}
    />
  )
}
