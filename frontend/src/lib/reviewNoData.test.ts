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
    const diagnostic = reviewNoDataDiagnostic({
      ...batchFile('no_data'),
      errorMessage: 'Loaded from literature library',
    })

    expect(diagnostic.title).toContain('扩散')
    expect(diagnostic.message).toContain('未找到')
    expect(diagnostic.hints.join(' ')).toContain('图表')
  })

  it('turns figure-only diffusion no-data into a clear manual-estimate workflow', () => {
    const diagnostic = reviewNoDataDiagnostic({
      ...batchFile('no_data'),
      errorMessage: 'chunk 1: No explicit diffusion coefficient values with units are provided in the text or figure…',
    })

    expect(diagnostic.kind).toBe('diffusion_figure_estimate')
    expect(diagnostic.title).toBe('需要图表估读')
    expect(diagnostic.message).toContain('图注')
    expect(diagnostic.primaryActionLabel).toBe('用当前页估读')
    expect(diagnostic.hints.join(' ')).toContain('原始轴单位')
  })
})
