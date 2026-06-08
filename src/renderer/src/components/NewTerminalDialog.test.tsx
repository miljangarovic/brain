import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTerminalDialog } from './NewTerminalDialog'

describe('NewTerminalDialog', () => {
  it('submits name, cwd and startup command', async () => {
    const onCreate = vi.fn()
    render(<NewTerminalDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Ime'), 'claude-api')
    await userEvent.type(screen.getByLabelText('Radni direktorijum (cwd)'), '/home/me/proj')
    await userEvent.type(screen.getByLabelText('Startup komanda'), 'claude')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'claude-api', cwd: '/home/me/proj', startupCommand: 'claude' })
  })

  it('does not submit with an empty name', async () => {
    const onCreate = vi.fn()
    render(<NewTerminalDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<NewTerminalDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
