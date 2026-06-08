import type { OrchestrixApi } from '@shared/api'

declare global {
  interface Window {
    orchestrix: OrchestrixApi
  }
}

export {}
