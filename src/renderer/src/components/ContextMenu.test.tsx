import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu } from './ContextMenu'

describe('ContextMenu', () => {
  it('renders items and fires their action, then closes', async () => {
    const onClose = vi.fn(), a = vi.fn()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Rename', onSelect: a }]} />)
    await userEvent.click(screen.getByText('Rename'))
    expect(a).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
