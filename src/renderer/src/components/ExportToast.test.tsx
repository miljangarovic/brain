import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportToast } from './ExportToast'
import type { ExportProgress, ExportSessionState } from '@shared/exportTypes'

const prog = (done: number, total: number, states: ExportSessionState[]): ExportProgress => ({
  done, total,
  items: states.map((state, i) => ({ label: `feat/term${i}`, state }))
})

describe('ExportToast', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ExportToast progress={null} notice={null} onDismiss={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows percentage, counts and the per-session list', () => {
    render(<ExportToast progress={prog(2, 5, ['done', 'done', 'running', 'pending', 'error'])} notice={null} onDismiss={() => {}} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Exporting — 40%')
    expect(status).toHaveTextContent('2/5')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(status).toHaveTextContent('feat/term3')
  })

  it('shows a writing-archive line when there are no sessions', () => {
    render(<ExportToast progress={prog(0, 0, [])} notice={null} onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Writing archive…')
  })

  it('shows a dismissible notice when done', async () => {
    const onDismiss = vi.fn()
    render(<ExportToast progress={null} notice="Exported to /tmp/x.zip" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exported to /tmp/x.zip')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('progress wins over a stale notice', () => {
    render(<ExportToast progress={prog(0, 2, ['running', 'pending'])} notice="old" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exporting — 0%')
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })
})
