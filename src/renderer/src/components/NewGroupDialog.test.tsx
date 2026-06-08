import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewGroupDialog } from './NewGroupDialog'

describe('NewGroupDialog', () => {
  it('submits name and cwd', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Ime grupe'), 'proj')
    await userEvent.type(screen.getByLabelText('Radni direktorijum'), '/home/me/proj')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'proj', cwd: '/home/me/proj' })
  })

  it('uses empty cwd (home) when left blank, but requires a name', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Ime grupe'), 'g')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'g', cwd: '' })
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<NewGroupDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
