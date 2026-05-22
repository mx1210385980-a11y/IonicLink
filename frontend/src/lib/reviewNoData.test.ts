import { describe, expect, it } from 'vitest'

import type { BatchFile } from '@/lib/api'
import { reviewNoDataDiagnostic, shouldHydrateReviewFile } from '@/lib/reviewNoData'

function batchFile(status: BatchFile['status'], records: BatchFile['records'] = []): BatchFile {
  return {
    id: '108',
    name: 'Diffusion paper.pdf',
    status,
    progress: 100,
    extractor_type: 'diffusion',
    records,
    errorMessage: 'No explicit diffusion coefficient values with units were found in text or tables.',
  }
}

describe('review no-data helpers', () => {
  it('does not hydrate a no-data diffusion review file with zero records', () => {
    expect(shouldHydrateReviewFile(batchFile('no_data'))).toBe(false)
  })

  it('still hydrates cached successful files that have no loaded records yet', () => {
    expect(shouldHydrateReviewFile(batchFile('success'))).toBe(true)
  })

  it('explains why an empty diffusion review has nothing to audit', () => {
    const diagnostic = reviewNoDataDiagnostic(batchFile('no_data'))

    expect(diagnostic.title).toContain('扩散')
    expect(diagnostic.message).toContain('No explicit diffusion coefficient')
    expect(diagnostic.hints.join(' ')).toContain('图表')
  })
})
