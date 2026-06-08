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
