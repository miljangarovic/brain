// One Dark Vivid theme.
//
// The single source of truth for all colors is the `:root` CSS custom properties
// in `index.css`. The chrome reads them through Tailwind semantic tokens
// (tailwind.config.mjs maps e.g. `surface` -> var(--od-surface)); xterm.js needs
// plain color strings, so `getXtermTheme()` reads the same variables at runtime.
// This keeps the terminal palette and the UI palette perfectly in sync.

import type { ITheme } from '@xterm/xterm'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function getXtermTheme(): ITheme {
  return {
    background: cssVar('--od-surface'),
    foreground: cssVar('--od-fg'),
    cursor: cssVar('--od-accent-strong'),
    cursorAccent: cssVar('--od-surface'),
    selectionBackground: cssVar('--od-sel'),
    selectionForeground: cssVar('--od-fg-bright'),

    black: cssVar('--od-black'),
    red: cssVar('--od-red'),
    green: cssVar('--od-green'),
    yellow: cssVar('--od-yellow'),
    blue: cssVar('--od-accent'),
    magenta: cssVar('--od-magenta'),
    cyan: cssVar('--od-cyan'),
    white: cssVar('--od-white'),

    brightBlack: cssVar('--od-bright-black'),
    brightRed: cssVar('--od-red'),
    brightGreen: cssVar('--od-green'),
    brightYellow: cssVar('--od-orange'),
    brightBlue: cssVar('--od-accent-strong'),
    brightMagenta: cssVar('--od-magenta'),
    brightCyan: cssVar('--od-cyan'),
    brightWhite: cssVar('--od-bright-white')
  }
}

// Preferred monospace stack — leads with JetBrains Mono to echo the IntelliJ /
// One Dark Vivid origin, falling back gracefully when it isn't installed.
export const MONO_FONT =
  "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', 'Cascadia Code', ui-monospace, 'DejaVu Sans Mono', monospace"
