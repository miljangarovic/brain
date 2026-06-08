import type { TerminaltorApi } from '@shared/api'

declare global {
  interface Window {
    terminaltor: TerminaltorApi
  }
}

export {}
