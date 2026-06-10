import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu } from './ContextMenu'

// The deferred (one-frame) registration of the dismiss listeners has to elapse
// before outside interactions can close the menu.
const flushFrame = () => new Promise<number>((r) => requestAnimationFrame(r))

describe('ContextMenu', () => {
  it('renders items and fires their action, then closes', async () => {
    const onClose = vi.fn(), a = vi.fn()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Rename', onSelect: a }]} />)
    await userEvent.click(screen.getByText('Rename'))
    expect(a).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  // xterm with TUI mouse-tracking on (claude/codex) cancels mousedown — the
  // event never bubbles to window. Dismissal must work in the capture phase.
  it('closes on outside mousedown even when the target swallows bubbling (xterm)', async () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="term" />
        <ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Copy', onSelect: vi.fn() }]} />
      </>
    )
    await flushFrame()
    const term = screen.getByTestId('term')
    term.addEventListener('mousedown', (e) => e.stopPropagation()) // xterm's cancelEvent
    fireEvent.mouseDown(term)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape even when the focused terminal swallows bubbling (xterm)', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="term" tabIndex={0} />
        <ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Copy', onSelect: vi.fn() }]} />
      </>
    )
    const term = screen.getByTestId('term')
    term.addEventListener('keydown', (e) => e.stopPropagation()) // xterm's cancelEvent
    fireEvent.keyDown(term, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('consumes the Escape so it does not leak into the terminal app', () => {
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Copy', onSelect: vi.fn() }]} />)
    const notPrevented = fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(notPrevented).toBe(false) // default was prevented → won't reach xterm
  })

  it('does not close from a mousedown inside the menu', async () => {
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Copy', onSelect: vi.fn() }]} />)
    await flushFrame()
    fireEvent.mouseDown(screen.getByText('Copy'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('submenu', () => {
  function makeItems() {
    return [
      { label: 'Plain', onSelect: vi.fn() },
      { label: 'New', children: [
        { label: 'Claude', onSelect: vi.fn() },
        { label: 'Terminal', onSelect: vi.fn() }
      ] }
    ]
  }

  it('an item with children shows the arrow and opens its submenu on hover', () => {
    const onClose = vi.fn()
    const items = makeItems()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={items} />)

    // submenu not visible yet
    expect(screen.queryByRole('menuitem', { name: 'Claude' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Terminal' })).not.toBeInTheDocument()

    // the parent item should have the arrow indicator and aria attributes
    const newItem = screen.getByRole('menuitem', { name: /New/ })
    expect(newItem).toHaveAttribute('aria-haspopup', 'menu')
    expect(newItem).toHaveAttribute('aria-expanded', 'false')

    // hover the container wrapping the 'New' button
    fireEvent.mouseEnter(newItem.closest('.relative')!)

    // submenu children are now visible
    expect(screen.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument()

    // aria-expanded flips to true
    expect(newItem).toHaveAttribute('aria-expanded', 'true')
  })

  it('clicking a submenu entry selects it and closes the whole menu', () => {
    const onClose = vi.fn()
    const items = makeItems()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={items} />)

    // open the submenu
    const newItem = screen.getByRole('menuitem', { name: /New/ })
    fireEvent.mouseEnter(newItem.closest('.relative')!)

    // click the child
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude' }))
    expect(items[1].children![0].onSelect).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the parent item itself does nothing', () => {
    const onClose = vi.fn()
    const items = makeItems()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={items} />)

    fireEvent.click(screen.getByRole('menuitem', { name: /New/ }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hovering another item closes the submenu', () => {
    const onClose = vi.fn()
    const items = makeItems()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={items} />)

    // open submenu
    const newItem = screen.getByRole('menuitem', { name: /New/ })
    fireEvent.mouseEnter(newItem.closest('.relative')!)
    expect(screen.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument()

    // hover Plain (no children) → submenu should close
    const plainItem = screen.getByRole('menuitem', { name: 'Plain' })
    fireEvent.mouseEnter(plainItem.closest('.relative')!)
    expect(screen.queryByRole('menuitem', { name: 'Claude' })).not.toBeInTheDocument()
  })
})
