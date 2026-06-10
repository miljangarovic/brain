import type { TerminalKind } from '@shared/types'

type IconProps = { className?: string }

export function ClaudeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-claude" aria-hidden="true" focusable="false"
      stroke="#d97757" strokeWidth="2.4" strokeLinecap="round"
    >
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => (
        <line key={a} x1="12" y1="12" x2="12" y2="3.5" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export function CodexIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-codex" aria-hidden="true" focusable="false"
      fill="none" stroke="#10a37f" strokeWidth="2" strokeLinejoin="round"
    >
      <path d="M12 2.5 L20.4 7.25 V16.75 L12 21.5 L3.6 16.75 V7.25 Z" />
      <circle cx="12" cy="12" r="2.6" fill="#10a37f" stroke="none" />
    </svg>
  )
}

export function ShellIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-shell" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M5 8l3.5 4L5 16" />
      <path d="M12.5 16H18" />
    </svg>
  )
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-grid" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-trash" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function TerminalKindIcon({ kind, className }: { kind: TerminalKind; className?: string }) {
  if (kind === 'claude') return <ClaudeIcon className={className} />
  if (kind === 'codex') return <CodexIcon className={className} />
  return <ShellIcon className={className} />
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={`animate-spin ${className ?? ''}`}
      data-testid="icon-spinner" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 3 a9 9 0 0 1 9 9" />
    </svg>
  )
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-bell" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-speaker" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </svg>
  )
}

export function SpeakerMutedIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-speaker-muted" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9l4 6M20 9l-4 6" />
    </svg>
  )
}

// Grid-style picker icons: each sketches the pane arrangement it selects.
export function LayoutBigRightIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-layout-big-right" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="17" rx="1.2" />
    </svg>
  )
}

export function LayoutBigLeftIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-layout-big-left" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="7" height="17" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  )
}

export function LayoutRowsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-layout-rows" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="9.75" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="16" width="17" height="4.5" rx="1.2" />
    </svg>
  )
}

export function LayoutColsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-layout-cols" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="4.5" height="17" rx="1.2" />
      <rect x="9.75" y="3.5" width="4.5" height="17" rx="1.2" />
      <rect x="16" y="3.5" width="4.5" height="17" rx="1.2" />
    </svg>
  )
}
