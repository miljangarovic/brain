import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('shows the message and confirms', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog message="Delete X?" onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getByText('Delete X?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog message="Delete X?" onConfirm={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Escape dismisses only the topmost dialog: capture+stop keeps it from underlying listeners', () => {
    // Simulate an underlying listener registered before render (e.g. ArchiveDialog mounted first)
    const underneath = vi.fn()
    window.addEventListener('keydown', underneath)
    const onCancel = vi.fn()
    render(<ConfirmDialog message="m" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(underneath).not.toHaveBeenCalled()
    window.removeEventListener('keydown', underneath)
  })
})
