import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'api.ts'), 'utf8')

describe('reading report API timing', () => {
  it('keeps report submission short because the backend continues in background', () => {
    const startReportSource = source.slice(
      source.indexOf('export async function startReadingReport'),
      source.indexOf('export async function updateReadingReport'),
    )

    expect(startReportSource).toContain('timeout: 20000')
    expect(startReportSource).not.toContain('timeout: 300000')
  })
})
