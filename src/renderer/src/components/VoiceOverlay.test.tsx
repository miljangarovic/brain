import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoiceOverlay } from './VoiceOverlay'
import type { VoiceUiState } from '../voice/machine'

const noop = () => {}
const renderState = (state: VoiceUiState, onConfirm = vi.fn(), onCancel = vi.fn()) => {
  render(<VoiceOverlay state={state} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('VoiceOverlay', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<VoiceOverlay state={{ kind: 'idle' }} onConfirm={noop} onCancel={noop} />)
    expect(container.firstChild).toBeNull()
  })
  it('listening shows the hint', () => {
    renderState({ kind: 'listening' })
    expect(screen.getByText(/Listening/)).toBeInTheDocument()
  })
  it('processing shows label and transcript', () => {
    renderState({ kind: 'processing', label: 'Parsing…', transcript: 'prebaci na grid' })
    expect(screen.getByText('Parsing…')).toBeInTheDocument()
    expect(screen.getByText(/prebaci na grid/)).toBeInTheDocument()
  })
  it('downloading shows progress percentage', () => {
    renderState({ kind: 'downloading', received: 250, total: 1000 })
    expect(screen.getByText(/25%/)).toBeInTheDocument()
  })
  it('confirm: Enter confirms with the edited prompt, Escape cancels', () => {
    const { onConfirm, onCancel } = renderState({
      kind: 'confirm', transcript: 'dodaj terminal', summary: 'New claude terminal in "file-panes"',
      descriptor: { type: 'addTerminal', featureId: 'f1', kind: 'claude', prompt: 'stari' },
      editablePrompt: 'stari'
    })
    expect(screen.getByText(/New claude terminal/)).toBeInTheDocument()
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'novi prompt' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('novi prompt')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
  it('confirm without editablePrompt has no textarea and confirms with undefined', () => {
    const { onConfirm } = renderState({
      kind: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"',
      descriptor: { type: 'closeTerminal', terminalId: 't1' }
    })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })
  it('toast and error render their text with a dismiss button', () => {
    const { onCancel } = renderState({ kind: 'error', message: 'Groq request timed out', transcript: 'xyz' })
    expect(screen.getByText(/timed out/)).toBeInTheDocument()
    expect(screen.getByText(/xyz/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onCancel).toHaveBeenCalled()
  })
  it('Escape cancels during processing (spec: Esc cancels at any stage)', () => {
    const { onCancel } = renderState({ kind: 'processing', label: 'Transcribing…' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
