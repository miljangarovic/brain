import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalKindIcon, GridIcon, TrashIcon, BellIcon, SpeakerIcon, SpeakerMutedIcon, DocIcon, ArchiveIcon, FileCodeIcon } from './icons'

describe('TerminalKindIcon', () => {
  it('renders the matching icon per kind', () => {
    const { rerender } = render(<TerminalKindIcon kind="claude" />)
    expect(screen.getByTestId('icon-claude')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="codex" />)
    expect(screen.getByTestId('icon-codex')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="shell" />)
    expect(screen.getByTestId('icon-shell')).toBeInTheDocument()
  })
})

describe('GridIcon', () => {
  it('renders a grid glyph', () => {
    render(<GridIcon />)
    expect(screen.getByTestId('icon-grid')).toBeInTheDocument()
  })
})

describe('TrashIcon', () => {
  it('renders a trash glyph', () => {
    render(<TrashIcon />)
    expect(screen.getByTestId('icon-trash')).toBeInTheDocument()
  })
})

describe('attention icons', () => {
  it('renders the bell icon', () => {
    render(<BellIcon />)
    expect(screen.getByTestId('icon-bell')).toBeInTheDocument()
  })
  it('renders the speaker icon', () => {
    render(<SpeakerIcon />)
    expect(screen.getByTestId('icon-speaker')).toBeInTheDocument()
  })
  it('renders the muted speaker icon', () => {
    render(<SpeakerMutedIcon />)
    expect(screen.getByTestId('icon-speaker-muted')).toBeInTheDocument()
  })
})

describe('DocIcon and ArchiveIcon', () => {
  it('DocIcon and ArchiveIcon render with their test ids', () => {
    render(<><DocIcon /><ArchiveIcon /></>)
    expect(screen.getByTestId('icon-doc')).toBeInTheDocument()
    expect(screen.getByTestId('icon-archive')).toBeInTheDocument()
  })
})

describe('FileCodeIcon', () => {
  it('FileCodeIcon renders with its test id', () => {
    render(<FileCodeIcon />)
    expect(screen.getByTestId('icon-file-code')).toBeInTheDocument()
  })
})
