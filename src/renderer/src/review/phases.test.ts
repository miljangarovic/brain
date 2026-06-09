import { describe, it, expect } from 'vitest'
import { PHASE_ORDER, PHASE_LABEL, nextPhase, afterApply } from './phases'

describe('phases', () => {
  it('orders intent → spec → impl', () => {
    expect(PHASE_ORDER).toEqual(['intent', 'spec', 'impl'])
  })
  it('nextPhase walks the pipeline and ends at null', () => {
    expect(nextPhase('intent')).toBe('spec')
    expect(nextPhase('spec')).toBe('impl')
    expect(nextPhase('impl')).toBeNull()
  })
  it('has a human label per phase', () => {
    expect(PHASE_LABEL.intent).toBe('Intent')
    expect(PHASE_LABEL.spec).toBe('Spec/plan')
    expect(PHASE_LABEL.impl).toBe('Implementation')
  })
  it('afterApply iterates while under the cap', () => {
    expect(afterApply(1, 5)).toEqual({ type: 'iterate', round: 2 })
  })
  it('afterApply stops once the next round would exceed the cap', () => {
    expect(afterApply(5, 5)).toEqual({ type: 'stop' })
  })
})
