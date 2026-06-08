// src/renderer/src/components/TerminalView.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Terminal as TerminalModel } from '@shared/types'
import { getXtermTheme, MONO_FONT } from '../theme'
import { ContextMenu, type MenuItem } from './ContextMenu'

export function TerminalView({ terminal, active }: { terminal: TerminalModel; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)

  // Clipboard actions, shared by the keyboard shortcuts and the right-click menu.
  const copySelection = useCallback(() => {
    const sel = xtermRef.current?.getSelection()
    if (sel) void navigator.clipboard.writeText(sel)
  }, [])
  const paste = useCallback(() => {
    const term = xtermRef.current
    if (!term) return
    // term.paste() (not raw writePty) so bracketed-paste mode is honoured — agents
    // like claude/codex rely on it to receive multi-line pastes as a single block.
    void navigator.clipboard.readText().then((text) => {
      if (text) { term.paste(text); term.focus() }
    })
  }, [])
  const selectAll = useCallback(() => {
    const term = xtermRef.current
    if (!term) return
    term.selectAll()
    term.focus()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: MONO_FONT,
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: getXtermTheme(),
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

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true

      // Shift+Enter → insert a newline (LF) instead of submitting (CR).
      // Plain Enter still sends CR ("submit"); claude/codex and most readline/Ink
      // TUIs treat a bare LF (same as Ctrl+J) as "insert newline".
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
          (e.code === 'Enter' || e.code === 'NumpadEnter')) {
        window.terminaltor.writePty(terminal.id, '\n')
        return false
      }

      // Ctrl+Shift+C / Ctrl+Shift+V copy-paste
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
        copySelection()
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
        paste()
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

  const items: MenuItem[] = []
  if (menu?.hasSelection) items.push({ label: 'Kopiraj', onSelect: copySelection })
  items.push({ label: 'Nalijepi', onSelect: paste })
  items.push({ label: 'Označi sve', onSelect: selectAll })

  // Right-click opens a copy/paste menu. Capture phase so we win even when the
  // running app (claude/codex) has mouse-tracking on and would grab the event.
  // (For free-form drag selection under mouse-tracking, hold Shift while dragging.)
  return (
    <div
      className="relative h-full w-full"
      onContextMenuCapture={(e) => {
        e.preventDefault()
        const hasSelection = (xtermRef.current?.getSelection()?.length ?? 0) > 0
        setMenu({ x: e.clientX, y: e.clientY, hasSelection })
      }}
    >
      <div ref={hostRef} className="h-full w-full" />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
