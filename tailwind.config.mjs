/** @type {import('tailwindcss').Config} */
// Semantic One Dark Vivid tokens. Values live in :root (index.css) so the
// terminal canvas (theme.ts) and the chrome stay in lockstep.
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--od-surface)',
        panel: 'var(--od-panel)',
        elevated: 'var(--od-elevated)',
        field: 'var(--od-field)',
        hover: 'var(--od-hover)',
        sel: 'var(--od-sel)',
        line: 'var(--od-line)',
        divider: 'var(--od-divider)',
        fg: {
          DEFAULT: 'var(--od-fg)',
          bright: 'var(--od-fg-bright)',
          muted: 'var(--od-fg-muted)'
        },
        accent: {
          DEFAULT: 'var(--od-accent)',
          strong: 'var(--od-accent-strong)'
        },
        danger: 'var(--od-red)',
        success: 'var(--od-green)',
        caution: 'var(--od-yellow)'
      }
    }
  },
  plugins: []
}
