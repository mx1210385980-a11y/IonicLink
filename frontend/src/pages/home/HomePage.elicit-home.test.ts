import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'HomePage.vue'), 'utf8')

describe('HomePage extraction entry', () => {
  it('presents a small public extraction start surface', () => {
    expect(source).toContain('IonicLink Extract')
    expect(source).toContain('Add papers. Review rows.')
    expect(source).toContain('Upload PDFs, choose Lubrication or Diffusion')
    expect(source).toContain('Upload PDF papers')
    expect(source).toContain('Start a clean extraction run.')
    expect(source).toContain("target: 'upload-pdfs'")
    expect(source).toContain('aria-label="Upload PDF papers"')
    expect(source).toContain("label: 'Database'")
    expect(source).toContain("target: 'database'")
    expect(source).toContain("label: 'Evidence'")
    expect(source).toContain("target: 'library/explorer'")
  })

  it('keeps only the useful extraction counters', () => {
    expect(source).toContain('const extractionStatusItems = computed')
    expect(source).toContain("label: 'Active'")
    expect(source).toContain('summary.value.today.runningRuns')
    expect(source).toContain("label: 'Rows'")
    expect(source).toContain('summary.value.health.datasetReadyRecords')
    expect(source).toContain("label: 'Review'")
    expect(source).toContain('summary.value.today.reviewPending')
  })

  it('removes the old command-center and research dashboard noise', () => {
    expect(source).not.toContain('Extraction command center')
    expect(source).not.toContain('Extract, verify, publish.')
    expect(source).not.toContain('modeMenuSections')
    expect(source).not.toContain('activeModeLabel')
    expect(source).not.toContain('modeMenuOpen')
    expect(source).not.toContain('WORKFLOWS')
    expect(source).not.toContain('TOOLS')
    expect(source).not.toContain('Research agent')
    expect(source).not.toContain('Report')
    expect(source).not.toContain('Systematic review')
    expect(source).not.toContain('suggestedCards')
    expect(source).not.toContain('v-for="card in suggestedCards"')
    expect(source).not.toContain('Extract COF from selected PDFs')
    expect(source).not.toContain('Review evidence for tables and figures')
    expect(source).not.toContain('Build a modeling dataset')
    expect(source).not.toContain('<textarea')
    expect(source).not.toContain('Extended')
    expect(source).not.toContain('HomeLiteratureChat')
    expect(source).not.toContain('HomeHealthSnapshot')
  })
})
