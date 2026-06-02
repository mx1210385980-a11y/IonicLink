import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf-8')

describe('App account menu', () => {
  it('renders a compact account dropdown with logout wired to the session handler', () => {
    expect(source).toContain('accountMenuOpen')
    expect(source).toContain('Account settings')
    expect(source).toContain('Log out')
    expect(source).toContain('@click="logoutFromAccountMenu"')
    expect(source).toContain('handleLogout()')
  })

  it('shows identity details in the top-right account surface', () => {
    expect(source).toContain('operatorInitial')
    expect(source).toContain('operatorName')
    expect(source).toContain('operatorAccountLine')
    expect(source).toContain('aria-label="Account menu"')
  })
})
