import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'LibraryPage.vue'), 'utf8')

describe('LibraryPage brand entry', () => {
  it('does not own the Home/Library shell chrome', () => {
    expect(source).not.toContain('aria-label="Go to home"')
    expect(source).not.toContain('@click="emit(\'open-home\')"')
    expect(source).not.toContain('<span>IonicLink</span>')
    expect(source).not.toContain('<button type="button" class="rounded-lg bg-slate-100 px-4 py-2">Recents</button>')
  })
})
