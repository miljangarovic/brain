// src/renderer/src/components/TerminalView.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Terminal as TerminalModel } from '@shared/types'
import { agentResumeCommand } from '../agents'
import { getXtermTheme, MONO_FONT } from '../theme'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { registerTail, unregisterTail, readXtermTail } from '../attention/tailRegistry'
import { markTouched } from '../attention/touched'
import { classifyKeyEvent } from './termKeys'

// `resume` is set only for agent terminals restored after an app restart: their
// PTY spawns resuming the terminal's own prior conversation (by session id when
// known — claude --resume / codex resume <id> — else the cwd's most recent) so it
// continues instead of starting fresh. No effect for plain shells or freshly
// created terminals — a fresh mount always uses the terminal's saved
// startupCommand verbatim (it embeds any --session-id pin, and for reviewers
// the whole review prompt).
export function TerminalView({ terminal, active, resume }: { terminal: TerminalModel; active: boolean; resume?: boolean }) {
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
    markTouched(terminal.id) // right-click paste also counts as engaging the terminal
    // term.paste() (not raw writePty) so bracketed-paste mode is honoured — agents
    // like claude/codex rely on it to receive multi-line pastes as a single block.
    void navigator.clipboard.readText().then((text) => {
      if (text) { term.paste(text); term.focus() }
    })
  }, [terminal.id])
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

    // Let attention routing read this terminal's recent output (to tell a
    // permission prompt from a finished turn) when it goes idle.
    registerTail(terminal.id, () => readXtermTail(term, 20))

    window.brain.createPty({
      id: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell ?? '',
      cols: term.cols || 80,
      rows: term.rows || 24,
      startupCommand: (resume ? agentResumeCommand({ kind: terminal.kind, sessionId: terminal.sessionId }) : undefined) ?? terminal.startupCommand
    })

    const offData = window.brain.onPtyData((id, data) => { if (id === terminal.id) term.write(data) })
    const offExit = window.brain.onPtyExit((id) => {
      if (id === terminal.id) term.write('\r\n\x1b[33m[process exited]\x1b[0m\r\n')
    })
    const inputDisposable = term.onData((data) => window.brain.writePty(terminal.id, data))

    term.attachCustomKeyEventHandler((e) => {
      // A real keypress in this terminal marks it "engaged" — attention's idle
      // signals only fire for terminals you've actually worked in. (Must be a key
      // event, NOT term.onData: xterm auto-replies to TUI queries via onData,
      // which would falsely mark every agent touched on startup.)
      if (e.type === 'keydown') markTouched(terminal.id)

      switch (classifyKeyEvent(e)) {
        case 'newline':
          window.brain.writePty(terminal.id, '\n')
          return false
        case 'copy':
          copySelection()
          return false
        case 'paste':
          paste()
          return false
        case 'swallow':
          return false
        default:
          return true
      }
    })

    const ro = new ResizeObserver((entries) => {
      // Skip while hidden (display:none → 0×0). Fitting a hidden container makes
      // xterm/FitAddon mis-measure and resize the PTY to a bogus (tiny) width,
      // which reflows TUIs like claude/codex — coming back then shows broken
      // wrapping. Only fit when the host actually has a layout size.
      const rect = entries[entries.length - 1]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
      try {
        fit.fit()
        window.brain.resizePty(terminal.id, term.cols, term.rows)
      } catch { /* ignore */ }
    })
    ro.observe(host)

    return () => {
      // Dispose only the renderer-side resources. Deliberately DO NOT killPty
      // here: this cleanup also runs on HMR/Fast Refresh (and StrictMode)
      // remounts, and killing the shell then would terminate the user's running
      // process (e.g. claude mid-task) and respawn it. The PTY is owned by the
      // workspace — App kills it when the terminal is actually removed. On a
      // remount the new mount's createPty is a no-op (the PTY still exists) and
      // simply re-attaches to the live shell.
      offData()
      offExit()
      inputDisposable.dispose()
      ro.disconnect()
      unregisterTail(terminal.id)
      term.dispose()
    }
    // Mount-once: the PTY lives as long as the terminal exists in the workspace,
    // not as long as this component instance does.
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
      window.brain.resizePty(terminal.id, term.cols, term.rows)
      term.focus()
    } catch { /* ignore */ }
  }, [active, terminal.id])

  const items: MenuItem[] = []
  if (menu?.hasSelection) items.push({ label: 'Copy', onSelect: copySelection })
  items.push({ label: 'Paste', onSelect: paste })
  items.push({ label: 'Select all', onSelect: selectAll })

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
