import { describe, expect, it } from 'vitest'

import { isPaperReviewed, reviewBadgesForPaper } from './reviewBadges'

describe('reviewBadgesForPaper', () => {
  it('exposes reviewed status separately from candidate badges', () => {
    expect(isPaperReviewed({ submissionStatus: 'approved' })).toBe(true)
    expect(isPaperReviewed({ reviewedAt: '2026-06-02T00:00:00Z' })).toBe(true)
    expect(reviewBadgesForPaper({ submissionStatus: 'approved' })).toEqual([])
  })

  it('marks literature with unpromoted candidates as needing review', () => {
    expect(reviewBadgesForPaper({ tribologyCandidateCount: 2 }).map((badge) => badge.label)).toEqual(['Needs review'])
  })

  it('keeps candidate residue visible even when the paper is reviewed', () => {
    expect(reviewBadgesForPaper({
      submissionStatus: 'approved',
      tribologyCandidateCount: 1,
      diffusionCandidateCount: 1,
    }).map((badge) => badge.label)).toEqual(['Needs review'])
  })
})
