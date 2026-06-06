import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'HomePage.vue'), 'utf8')

describe('HomePage extraction entry', () => {
  it('presents a small public extraction start surface', () => {
    expect(source).toContain('IonicLink Extract')
    expect(source).toContain('Add papers. Review rows.')
    expect(source).toContain('Upload PDFs, extract the data, review the evidence.')
    expect(source).toContain('Upload PDF papers')
    expect(source).toContain('Start a clean extraction run.')
    expect(source).toContain('No papers in this workspace yet.')
    expect(source).toContain('Your first useful step is importing a source PDF.')
    expect(source).toContain("target: 'upload-pdfs'")
    expect(source).toContain('aria-label="Upload PDF papers"')
    expect(source).toContain("label: 'Database'")
    expect(source).toContain("target: 'database'")
    expect(source).toContain("label: 'Review Queue'")
    expect(source).toContain("target: 'review-evidence'")
    expect(source).not.toContain("label: 'Evidence'")
    expect(source).not.toContain("detail: 'Check sources'")
  })

  it('keeps only the useful extraction counters', () => {
    expect(source).toContain('const extractionStatusItems = computed')
    expect(source).toContain("label: 'Needs review'")
    expect(source).toContain("value: loading.value ? '--' : summary.value.today.reviewPending")
    expect(source).not.toContain("label: 'Active'")
    expect(source).not.toContain("label: 'Running'")
    expect(source).not.toContain("label: 'Rows'")
    expect(source).not.toContain("label: 'Review'")
    expect(source).toContain('summary.value.today.reviewPending')
    expect(source).toContain("label: 'Official database'")
    expect(source).toContain("value: loading.value ? '--' : summary.value.health.officialDatabaseRecords")
    expect(source).toContain('return !loading.value')
  })

  it('uses a single centered column instead of the sidebar dashboard', () => {
    // Centered single column — no right-hand stat sidebar.
    expect(source).toContain('place-items-center')
    expect(source).toContain('max-w-[30rem]')
    expect(source).not.toContain('lg:grid-cols-[minmax(0,1fr)_18rem]')
    expect(source).not.toContain('<aside')
    // The wordy sidebar cards and per-stat descriptions are gone.
    expect(source).not.toContain('Ready for library')
    expect(source).not.toContain("description: 'Machine-extracted rows waiting for approval.'")
    expect(source).not.toContain("description: 'Approved rows available for search and export.'")
    // Counters demoted to one quiet inline metric line (no big stat tiles).
    expect(source).not.toContain('text-3xl font-black leading-none')
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
