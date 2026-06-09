import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewDialog } from './ReviewDialog'

beforeEach(() => {
  // @ts-expect-error test stub
  window.orchestrix = {
    suggestSpec: vi.fn().mockResolvedValue('/p/docs/spec.md'),
    pickFile: vi.fn().mockResolvedValue('/p/other.md')
  }
})

const baseProps = { originName: 'claude', defaultReviewer: 'codex' as const, cwd: '/p' }

describe('ReviewDialog', () => {
  it('defaults to the intent phase with maxRounds 5 and no spec field', () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Intent')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Max rounds')).toHaveValue(5)
    expect(screen.queryByLabelText('Spec file')).toBeNull()
  })

  it('starts an intent review with the chosen reviewer and maxRounds', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Max rounds'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'intent', maxRounds: 3, specPath: undefined, intent: '' })
  })

  it('spec phase shows + prefills the spec file and passes it on start', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Spec/plan'))
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'spec', maxRounds: 5, specPath: '/p/docs/spec.md', intent: '' })
  })

  it('closes on Escape', () => {
    const onCancel = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
