import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf-8')

describe('App account menu', () => {
  it('does not render account chrome in the extraction-first public shell', () => {
    expect(source).not.toContain('accountMenuOpen')
    expect(source).not.toContain('Account settings')
    expect(source).not.toContain('Log out')
    expect(source).not.toContain('@click="logoutFromAccountMenu"')
    expect(source).not.toContain('handleLogout()')
    expect(source).not.toContain('operatorInitial')
    expect(source).not.toContain('operatorAccountLine')
    expect(source).not.toContain('aria-label="Account menu"')
  })
})
