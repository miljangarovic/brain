import { useState, useCallback } from 'react'
import { AppState, createInitialState } from './store'

export function useStore() {
  const [state, setState] = useState<AppState>(() => createInitialState())
  const apply = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), [])
  return { state, setState, apply }
}
