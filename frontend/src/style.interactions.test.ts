import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'style.css'), 'utf8')

describe('global interaction cursors', () => {
  it('uses a pointer cursor for clickable navigation and switching controls', () => {
    expect(source).toContain('button:not(:disabled)')
    expect(source).toContain('a[href]')
    expect(source).toContain('[role="button"]')
    expect(source).toContain('cursor: pointer;')
  })

  it('keeps disabled controls from looking clickable', () => {
    expect(source).toContain('button:disabled')
    expect(source).toContain('aria-disabled="true"')
    expect(source).toContain('cursor: not-allowed;')
  })
})
