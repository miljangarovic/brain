import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarkdownView } from './MarkdownView'

beforeEach(() => {
  ;(window as unknown as { brain: { openExternal: ReturnType<typeof vi.fn> } }).brain = { openExternal: vi.fn() } as never
})

describe('MarkdownView', () => {
  it('renders gfm markdown (headings, lists, tables)', () => {
    render(<MarkdownView source={'# Title\n\n- item\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('item')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('intercepts http(s) link clicks and opens them externally (raw attribute, not resolved href)', async () => {
    render(<MarkdownView source={'[site](https://example.com)'} />)
    await userEvent.click(screen.getByRole('link', { name: 'site' }))
    expect(window.brain.openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('relative and anchor links are swallowed — the renderer never navigates, nothing opens', async () => {
    render(<MarkdownView source={'[see](./other.md) [top](#section)'} />)
    await userEvent.click(screen.getByRole('link', { name: 'see' }))
    await userEvent.click(screen.getByRole('link', { name: 'top' }))
    expect(window.brain.openExternal).not.toHaveBeenCalled()
  })
})
