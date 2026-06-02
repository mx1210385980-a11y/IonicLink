import { describe, expect, it } from 'vitest'

import {
  confidenceTierLabel,
  extractionReviewStatusForRow,
  missingFieldLabels,
} from '@/lib/extractionReview'

describe('PDF upload weak candidate display helpers', () => {
  it('keeps weak candidates visible as review rows instead of no-data', () => {
    const row = {
      review_status: 'needs_review',
      record_origin: 'weak_candidate',
      confidence_tier: 'low',
      missing_fields: ['normal_load', 'speed'],
      field_evidence_json: {},
    } as any

    expect(extractionReviewStatusForRow(row)).toBe('needs_review')
    expect(confidenceTierLabel(row.confidence_tier)).toBe('Low confidence')
    expect(missingFieldLabels(row.missing_fields)).toEqual(['Missing load', 'Missing speed'])
  })
})
