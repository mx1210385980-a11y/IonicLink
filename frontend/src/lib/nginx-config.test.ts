import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('frontend nginx config', () => {
  it('serves Vite module workers with a JavaScript MIME type', () => {
    const config = readFileSync(resolve(__dirname, '../../nginx.conf'), 'utf8')

    expect(config).toMatch(/location\s+~\*\s+\\\.mjs\$/)
    expect(config).toMatch(/types\s*\{[\s\S]*application\/javascript\s+mjs;[\s\S]*\}/)
    expect(config).toMatch(/try_files\s+\$uri\s+=404;/)
  })

  it('does not let retired public assets fall back to the SPA shell', () => {
    const config = readFileSync(resolve(__dirname, '../../nginx.conf'), 'utf8')

    expect(config).toContain('location = /guide.mp4')
    expect(config).toContain('location = /vite.svg')
    expect(config).toMatch(/location\s+=\s+\/guide\.mp4\s*\{[\s\S]*return\s+404;[\s\S]*\}/)
    expect(config).toMatch(/location\s+=\s+\/vite\.svg\s*\{[\s\S]*return\s+404;[\s\S]*\}/)
  })
})
