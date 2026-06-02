import { describe, expect, it } from 'vitest'

import {
  extractionSaveStatus,
  extractorTypesForTemplate,
  nextPollFailureState,
  nextActivePollState,
  runReviewableCounts,
  summarizeUploadBatch,
} from './libraryExtractionWorkflow'

describe('library extraction workflow guards', () => {
  it('maps the selected template to exactly the supported extraction lane', () => {
    expect(extractorTypesForTemplate('lubrication')).toEqual(['tribology'])
    expect(extractorTypesForTemplate('diffusion')).toEqual(['diffusion'])
    expect(extractorTypesForTemplate('conductivity')).toEqual([])
  })

  it('blocks saving until extraction produced real records for the selected template', () => {
    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'lubrication',
      runningExtraction: false,
      progressItems: [],
      selectedPapers: [{ id: 1, tribologyRecordCount: 0 }],
    })).toMatchObject({ canSave: false })

    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'lubrication',
      runningExtraction: false,
      progressItems: [{ paperId: 1, status: 'no_data', finalCount: 0 }],
      selectedPapers: [{ id: 1, tribologyRecordCount: 0 }],
    })).toMatchObject({
      canSave: false,
      message: 'Extraction finished with no records. Adjust the template or review the paper evidence before saving.',
    })

    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'lubrication',
      runningExtraction: false,
      progressItems: [{ paperId: 1, status: 'completed', finalCount: 2 }],
      selectedPapers: [{ id: 1, tribologyRecordCount: 0 }],
    })).toMatchObject({ canSave: true })
  })

  it('allows saving existing database records after the library refresh', () => {
    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'diffusion',
      runningExtraction: false,
      progressItems: [],
      selectedPapers: [{ id: 1, diffusionRecordCount: 3 }],
    })).toMatchObject({ canSave: true })
  })

  it('allows opening Database when extraction produced reviewable candidates only', () => {
    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'diffusion',
      runningExtraction: false,
      progressItems: [{ paperId: 1, status: 'completed', finalCount: 0, candidateCount: 3 }],
      selectedPapers: [{ id: 1, diffusionRecordCount: 0 }],
    })).toMatchObject({
      canSave: true,
      message: 'Extraction table saved. Opening Database.',
    })

    expect(extractionSaveStatus({
      selectedCount: 1,
      selectedTemplate: 'lubrication',
      runningExtraction: false,
      progressItems: [],
      selectedPapers: [{ id: 1, tribologyRecordCount: 0, tribologyCandidateCount: 2 }],
    })).toMatchObject({ canSave: true })
  })

  it('counts reviewable candidates from run summary when top-level counts are stale', () => {
    expect(runReviewableCounts({
      final_count: 0,
      candidate_count: 0,
      summary: {
        final_count: 0,
        candidate_count: 2,
        weak_candidate_count: 5,
      },
    })).toEqual({
      finalCount: 0,
      candidateCount: 5,
      reviewableCount: 5,
    })

    expect(runReviewableCounts({
      final_count: 1,
      candidate_count: 3,
      summary: {
        final_count: 4,
        candidate_count: 2,
      },
    })).toEqual({
      finalCount: 4,
      candidateCount: 3,
      reviewableCount: 7,
    })
  })

  it('turns repeated polling API failures into a terminal failed state', () => {
    expect(nextPollFailureState(2, ['tribology'], 3)).toEqual({
      failureCount: 3,
      shouldFail: true,
      message: 'Extraction status check failed repeatedly. The run was released so you can retry.',
    })
    expect(nextPollFailureState(0, ['tribology'], 3)).toMatchObject({
      failureCount: 1,
      shouldFail: false,
    })
  })

  it('turns endless successful active polling into a releasable stalled state', () => {
    expect(nextActivePollState(119, 120)).toEqual({
      activeCount: 120,
      shouldRelease: true,
      message: 'Background worker did not finish in time. The run was released so you can retry.',
    })
    expect(nextActivePollState(0, 120)).toMatchObject({
      activeCount: 1,
      shouldRelease: false,
    })
  })

  it('summarizes mixed upload results with failed files retained for retry', () => {
    const queuedFiles = [
      { name: 'ok.pdf', size: 100, lastModified: 1 },
      { name: 'bad.pdf', size: 200, lastModified: 2 },
      { name: 'also-ok.pdf', size: 300, lastModified: 3 },
    ]

    const result = summarizeUploadBatch(queuedFiles, [
      { fileName: 'ok.pdf', success: true },
      { fileName: 'bad.pdf', success: false, error: 'DOI metadata parse failed' },
      { fileName: 'also-ok.pdf', success: true },
    ])

    expect(result.successCount).toBe(2)
    expect(result.failCount).toBe(1)
    expect(result.retryFiles.map((file) => file.name)).toEqual(['bad.pdf'])
    expect(result.message).toBe('2 uploaded, 1 failed: bad.pdf - DOI metadata parse failed')
  })
})
