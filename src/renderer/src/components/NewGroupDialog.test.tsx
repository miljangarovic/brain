import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewGroupDialog } from './NewGroupDialog'

describe('NewGroupDialog', () => {
  it('submits name and cwd', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Project name'), 'proj')
    await userEvent.type(screen.getByLabelText('Working directory'), '/home/me/proj')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'proj', cwd: '/home/me/proj' })
  })

  it('uses empty cwd (home) when left blank, but requires a name', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Project name'), 'g')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'g', cwd: '' })
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<NewGroupDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onCancel = vi.fn()
    render(<NewGroupDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })

  it('fills cwd from the native folder picker', async () => {
    ;(window as unknown as { brain: { pickDirectory: () => Promise<string | null> } }).brain = {
      pickDirectory: vi.fn().mockResolvedValue('/picked/dir')
    }
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await userEvent.type(screen.getByLabelText('Project name'), 'g')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'g', cwd: '/picked/dir' })
  })
})
