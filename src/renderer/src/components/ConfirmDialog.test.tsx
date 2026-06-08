import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('shows the message and confirms', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog message="Obrisati X?" onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getByText('Obrisati X?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Obriši' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog message="Obrisati X?" onConfirm={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
