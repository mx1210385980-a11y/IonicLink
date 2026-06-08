import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'LibraryPage.vue'), 'utf8')

describe('LibraryPage per-paper hub', () => {
  it('turns the paper detail view into a working hub with status + key parameters', () => {
    expect(source).toContain('data-testid="paper-hub"')
    expect(source).toContain('const paperHubStats = computed')
    expect(source).toContain('const paperKeyParams = computed')
    expect(source).toContain('paper-detail-compact-hub')
    expect(source).toContain('paper-detail-shell mx-auto max-w-[54rem]')
    expect(source).not.toContain('mt-6 grid gap-3 sm:grid-cols-2')
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

  it('keeps paper detail counts synchronized after loading details', () => {
    expect(source).toContain('function syncSelectedPaperFromDetails')
    expect(source).toContain('syncSelectedPaperFromDetails(details)')
    expect(source).toContain('...(selectedPaperDetails.value || {})')
    expect(source).toContain('items.value = items.value.map((item) => item.id === merged.id ? { ...item, ...merged } : item)')
  })

  it('loads the saved reading report as the first paper detail view', () => {
    expect(source).toContain('getReadingReport')
    expect(source).toContain('ReadingReportPanel')
    expect(source).toContain("const paperDetailTab = ref<'report' | 'plain' | 'pdf' | 'figures'>('report')")
    expect(source).toContain('const paperReadingReport = ref<ReadingReportResponse | null>(null)')
    expect(source).toContain('async function loadPaperReadingReport')
    expect(source).toContain("@click=\"switchPaperDetailTab('report')\"")
    expect(source).toContain("paperDetailTab === 'report'")
    expect(source).toContain(':reader="true"')
    expect(source).toContain('No reading report yet.')
  })

  it('lets saved reading reports be edited in place from Library', () => {
    expect(source).toContain('updateReadingReport')
    expect(source).toContain('async function savePaperReadingReport')
    expect(source).toContain(':editable="true"')
    expect(source).toContain('save-label="Save to Library"')
    expect(source).toContain('@save="savePaperReadingReport"')
    expect(source).toContain('paperReadingReportSaving')
  })

  it('marks Library report edits as candidate-affecting and refreshes paper stats', () => {
    expect(source).toContain('const paperReadingReportSaveMessage = ref')
    expect(source).toContain('const reportChanged = markdown.trim() !==')
    expect(source).toContain('Report saved to Library. Generate candidates again from the edited report.')
    expect(source).toContain('Report saved to Library.')
    expect(source).toContain('await loadPaperDetail()')
    expect(source).toContain('paperReadingReportSaveMessage = ref')
  })
})
