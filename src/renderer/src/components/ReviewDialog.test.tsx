import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewDialog } from './ReviewDialog'

beforeEach(() => {
  // @ts-expect-error test stub
  window.brain = {
    suggestSpec: vi.fn().mockResolvedValue('/p/docs/spec.md'),
    pickFile: vi.fn().mockResolvedValue('/p/other.md')
  }
})

const baseProps = { originName: 'claude', defaultReviewer: 'codex' as const, cwd: '/p' }

describe('ReviewDialog', () => {
  it('defaults to the spec phase with maxRounds 3 and a visible spec field', async () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Spec/plan')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Max rounds')).toHaveValue('3')
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
  })

  it('starts an intent review with the chosen reviewer and maxRounds', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Intent'))
    fireEvent.change(screen.getByLabelText('Max rounds'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'intent', maxRounds: 4, specPath: undefined, intent: '' })
  })

  it('spec phase prefills the spec file and passes it on start', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'spec', maxRounds: 3, specPath: '/p/docs/spec.md', intent: '' })
  })

  it('closes on Escape', () => {
    const onCancel = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('ignores non-digit input in Max rounds', () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    const rounds = screen.getByLabelText('Max rounds')
    fireEvent.change(rounds, { target: { value: 'abc' } })
    expect(rounds).toHaveValue('3')
    fireEvent.change(rounds, { target: { value: '3e' } })
    expect(rounds).toHaveValue('3')
    fireEvent.change(rounds, { target: { value: '12' } })
    expect(rounds).toHaveValue('12')
  })

  it('allows clearing Max rounds while editing and clamps it to 1 on start', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    const rounds = screen.getByLabelText('Max rounds')
    fireEvent.change(rounds, { target: { value: '' } })
    expect(rounds).toHaveValue('')
    fireEvent.click(screen.getByLabelText('Intent'))
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ maxRounds: 1 }))
  })

  it('does not close when a drag from inside the dialog releases on the backdrop', () => {
    const onCancel = vi.fn()
    const { container } = render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={onCancel} />)
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.mouseDown(backdrop.firstElementChild as HTMLElement) // selection starts inside
    fireEvent.click(backdrop) // mouse released over the backdrop → click lands there
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('closes on a click that starts and ends on the backdrop', () => {
    const onCancel = vi.fn()
    const { container } = render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={onCancel} />)
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
