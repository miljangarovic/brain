import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    passWithNoTests: true,
    // Agent worktrees live under .claude/worktrees/ — their checked-out copies
    // of the suite must not run against this checkout's dependencies.
    exclude: [...defaultExclude, '**/.claude/**']
  }
})
