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
  it('prefills the suggested spec path on mount', async () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
  })

  it('starts a spec review with chosen reviewer + intent', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
    fireEvent.change(screen.getByLabelText('Intent (optional)'), { target: { value: 'auth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', kind: 'spec', specPath: '/p/docs/spec.md', intent: 'auth' })
  })

  it('implementation review needs no spec path', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Implementation'))
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', kind: 'impl', specPath: undefined, intent: '' })
  })
})
