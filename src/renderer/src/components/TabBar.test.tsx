// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]
function noop() {}

// Defaults for the review props; spread into each render so
// existing assertions stay focused on the behavior under test.
const reviewProps = {
  reviewStatus: {},
  onReviewTerminal: noop,
}

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" liveAgents={{}} onSelect={noop} onClose={noop} {...reviewProps} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<TabBar terminals={terms} activeId="a" liveAgents={{}} onSelect={onSelect} onClose={noop} {...reviewProps} />)
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar terminals={terms} activeId="a" liveAgents={{}} onSelect={onSelect} onClose={onClose} {...reviewProps} />)
    await userEvent.click(screen.getByLabelText('Zatvori tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the kind icon on an agent tab', () => {
    const agentTerms: Terminal[] = [{ id: 'a', name: 'claude', cwd: '', kind: 'claude' }]
    render(<TabBar terminals={agentTerms} activeId="a" liveAgents={{}} onSelect={noop} onClose={noop} {...reviewProps} />)
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('a live agent overrides the tab icon', () => {
    const t = [{ id: 'a', name: 'work', cwd: '' }]
    render(<TabBar terminals={t} activeId="a" liveAgents={{ a: 'claude' }}
      onSelect={noop} onClose={noop} {...reviewProps} />)
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })
})
