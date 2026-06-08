// src/renderer/src/components/TerminalView.tsx
import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Terminal as TerminalModel } from '@shared/types'

const THEME = { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' }

export function TerminalView({ terminal, active }: { terminal: TerminalModel; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    xtermRef.current = term
    fitRef.current = fit
    try { fit.fit() } catch { /* host may be hidden */ }

    window.terminaltor.createPty({
      id: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell ?? '',
      cols: term.cols || 80,
      rows: term.rows || 24,
      startupCommand: terminal.startupCommand
    })

    const offData = window.terminaltor.onPtyData((id, data) => { if (id === terminal.id) term.write(data) })
    const offExit = window.terminaltor.onPtyExit((id) => {
      if (id === terminal.id) term.write('\r\n\x1b[33m[proces završen]\x1b[0m\r\n')
    })
    const inputDisposable = term.onData((data) => window.terminaltor.writePty(terminal.id, data))

    // Ctrl+Shift+C / Ctrl+Shift+V copy-paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      if (e.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => window.terminaltor.writePty(terminal.id, text))
        return false
      }
      return true
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        window.terminaltor.resizePty(terminal.id, term.cols, term.rows)
      } catch { /* hidden */ }
    })
    ro.observe(host)

    return () => {
      offData()
      offExit()
      inputDisposable.dispose()
      ro.disconnect()
      term.dispose()
      window.terminaltor.killPty(terminal.id)
    }
    // Mount-once: PTY lifecycle is tied to this component's lifetime, not to prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When this terminal becomes visible, refit (xterm can't measure while display:none) and focus.
  useEffect(() => {
    if (!active) return
    const term = xtermRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    try {
      fit.fit()
      window.terminaltor.resizePty(terminal.id, term.cols, term.rows)
      term.focus()
    } catch { /* ignore */ }
  }, [active, terminal.id])

  return <div ref={hostRef} className="h-full w-full" />
}
