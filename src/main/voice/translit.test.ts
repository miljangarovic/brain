import { describe, it, expect } from 'vitest'
import { toLatin } from './translit'

describe('toLatin', () => {
  it('transliterates a Serbian Cyrillic sentence', () => {
    expect(toLatin('Прикажи грид за фичу фајл пејнс')).toBe('Prikaži grid za fiču fajl pejns')
  })
  it('handles the digraph letters љ њ џ in both cases', () => {
    expect(toLatin('љуља Љиљана, њива Њ, џеп Џ')).toBe('ljulja Ljiljana, njiva Nj, džep Dž')
  })
  it('covers ђ ћ ж ч ш and uppercase', () => {
    expect(toLatin('Ђурђевак ћошак Жижак Чвор Шума')).toBe('Đurđevak ćošak Žižak Čvor Šuma')
  })
  it('leaves latin text and punctuation untouched', () => {
    expect(toLatin('dodaj claude terminal u feature file-panes!')).toBe('dodaj claude terminal u feature file-panes!')
  })
  it('mixed scripts: only cyrillic characters change', () => {
    expect(toLatin('додај terminal у file-panes')).toBe('dodaj terminal u file-panes')
  })
})
