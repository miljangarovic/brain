import type { BrainApi } from '@shared/api'

declare global {
  interface Window {
    brain: BrainApi
  }
}

export {}
