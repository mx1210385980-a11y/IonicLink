import { describe, expect, it } from 'vitest'

import { buildReviewProgressChartData, formatReviewCompletion } from './reviewProgress'

describe('review progress helpers', () => {
  it('formats review completion as an easy percentage', () => {
    expect(formatReviewCompletion(0.4)).toBe('40%')
    expect(formatReviewCompletion(null)).toBe('0%')
  })

  it('builds chart data from iteration trend rows', () => {
    const data = buildReviewProgressChartData([
      { date: '2026-06-01', reviewedLiterature: 1, approvedRecords: 3, unpromotedCandidates: 9, reviewCompletionRate: 0.25 },
      { date: '2026-06-02', reviewedLiterature: 2, approvedRecords: 5, unpromotedCandidates: 4, reviewCompletionRate: 0.56 },
    ])

    const completionDataset = data.datasets[0]
    const recordsDataset = data.datasets[1]

    expect(data.labels).toEqual(['06/01', '06/02'])
    expect(completionDataset?.label).toBe('Review completion')
    expect(completionDataset?.data).toEqual([25, 56])
    expect(recordsDataset?.label).toBe('Approved records')
    expect(recordsDataset?.data).toEqual([3, 5])
  })
})
