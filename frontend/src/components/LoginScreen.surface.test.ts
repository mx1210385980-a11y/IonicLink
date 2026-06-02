import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'LoginScreen.vue'), 'utf-8')

describe('LoginScreen surface', () => {
  it('uses the compact single-column auth surface instead of the old showcase page', () => {
    expect(source).toContain('Sign in')
    expect(source).toContain('Continue with Github')
    expect(source).toContain('Continue with Google')
    expect(source).toContain('Work email')
    expect(source).toContain('Use single sign-on')
    expect(source).toContain('type="email"')
    expect(source).not.toContain('capabilityRows')
    expect(source).not.toContain('bootstrap_credentials')
  })

  it('keeps the existing credential submit contract', () => {
    expect(source).toContain("(e: 'submit', payload: { username: string; password: string }): void")
    expect(source).toContain('username.value.trim()')
    expect(source).toContain('password.value')
    expect(source).toContain('@submit.prevent="handleSubmit"')
  })
})
