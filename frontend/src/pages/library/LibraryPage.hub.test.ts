import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'LibraryPage.vue'), 'utf8')

describe('LibraryPage per-paper hub', () => {
  it('turns the paper detail view into a working hub with status + key parameters', () => {
    expect(source).toContain('data-testid="paper-hub"')
    expect(source).toContain('const paperHubStats = computed')
    expect(source).toContain('const paperKeyParams = computed')
    // status card surfaces records + candidates-needing-review
    expect(source).toContain('paperHubStats.records')
    expect(source).toContain('paperHubStats.candidates')
    expect(source).toContain('need review')
    // key parameters summarised from extracted records
    expect(source).toContain('paperKeyParams.cof')
    expect(source).toContain('paperKeyParams.temp')
    expect(source).toContain('paperKeyParams.load')
    expect(source).toContain('paperKeyParams.commonIl')
  })

  it('offers jump-into-Database actions scoped to the paper', () => {
    expect(source).toContain("function openPaperInDatabase(entityType: 'record' | 'candidate')")
    expect(source).toContain("emit('open-database', {")
    expect(source).toContain('dataset: paperPrimaryDataset.value')
    expect(source).toContain("@click=\"openPaperInDatabase('record')\"")
    expect(source).toContain("@click=\"openPaperInDatabase('candidate')\"")
    expect(source).toContain('Open in Database')
    expect(source).toContain('Review {{ paperHubStats.candidates }}')
  })
})
