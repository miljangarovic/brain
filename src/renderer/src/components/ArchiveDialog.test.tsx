import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchiveDialog } from './ArchiveDialog'
import type { Group } from '@shared/types'

const group: Group = {
  id: 'g1', name: 'proj', cwd: '/p', collapsed: false,
  features: [
    { id: 'f1', name: 'auth', collapsed: false, terminals: [{ id: 't1', name: 's', cwd: '/p' }] }
  ],
  archivedFeatures: [
    { id: 'fa', name: 'old-ui', collapsed: false, terminals: [] }
  ]
}
const noop = () => {}

function renderDialog(overrides: Partial<Parameters<typeof ArchiveDialog>[0]> = {}) {
  const props = { group, onArchive: noop, onRestore: noop, onDeleteArchived: noop, onClose: noop, ...overrides }
  return render(<ArchiveDialog {...props} />)
}

describe('ArchiveDialog', () => {
  it('lists active and archived features with terminal counts', () => {
    renderDialog()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('1 terminal')).toBeInTheDocument()
    expect(screen.getByText('old-ui')).toBeInTheDocument()
    expect(screen.getByText('0 terminals')).toBeInTheDocument()
  })

  it('Archive / Restore / trash call up with the feature id', async () => {
    const onArchive = vi.fn(); const onRestore = vi.fn(); const onDeleteArchived = vi.fn()
    renderDialog({ onArchive, onRestore, onDeleteArchived })
    await userEvent.click(screen.getByLabelText('Archive feature auth'))
    expect(onArchive).toHaveBeenCalledWith('f1')
    await userEvent.click(screen.getByLabelText('Restore feature old-ui'))
    expect(onRestore).toHaveBeenCalledWith('fa')
    await userEvent.click(screen.getByLabelText('Delete archived feature old-ui'))
    expect(onDeleteArchived).toHaveBeenCalledWith('fa')
  })

  it('shows empty-state lines when a section has no features', () => {
    renderDialog({ group: { ...group, features: [], archivedFeatures: [] } })
    expect(screen.getByText('No active features.')).toBeInTheDocument()
    expect(screen.getByText('Nothing archived yet.')).toBeInTheDocument()
  })

  it('does not close when a drag from inside the dialog releases on the backdrop', () => {
    const onClose = vi.fn()
    const { container } = renderDialog({ onClose })
    const backdrop = container.firstElementChild as HTMLElement
    fireEvent.mouseDown(backdrop.firstElementChild as HTMLElement)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape, the X button, and a backdrop click — but not an inner click', async () => {
    const onClose = vi.fn()
    const { container } = renderDialog({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByLabelText('Close archive'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(container.firstChild as HTMLElement) // backdrop
    expect(onClose).toHaveBeenCalledTimes(3)
    await userEvent.click(screen.getByText('auth'))            // inner content
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
