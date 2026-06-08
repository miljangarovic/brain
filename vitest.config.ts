import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'], passWithNoTests: true }
})
