import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportToast } from './ExportToast'

describe('ExportToast', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ExportToast progress={null} notice={null} onDismiss={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows summarization progress', () => {
    render(<ExportToast progress={{ done: 1, total: 3, current: 'auth/claude' }} notice={null} onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summarizing sessions 1/3 — auth/claude')
  })

  it('shows a dismissible notice when done', async () => {
    const onDismiss = vi.fn()
    render(<ExportToast progress={null} notice="Exported to /tmp/x.zip" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exported to /tmp/x.zip')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('progress wins over a stale notice', () => {
    render(<ExportToast progress={{ done: 0, total: 2, current: '' }} notice="old" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summarizing sessions 0/2')
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })
})
