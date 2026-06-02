import { describe, expect, it } from 'vitest'

import {
  confidenceTierLabel,
  extractionReviewSummary,
  extractionReviewStatusForRow,
  firstAvailablePdfUploadReviewFieldKey,
  firstPdfUploadReviewFieldKey,
  missingFieldLabels,
  pdfUploadReviewFieldKeys,
} from './extractionReview'

const grounded = (value: string | number) => ({
  value: String(value),
  review_state: 'confirmed',
  evidence: { quote: String(value), page: 1 },
})

describe('extractionReviewStatusForRow', () => {
  it('marks approved rows as published', () => {
    expect(extractionReviewStatusForRow({
      review_status: 'approved',
      field_evidence_json: {},
    })).toBe('published')
  })

  it('marks rows with flagged required evidence as flagged', () => {
    expect(extractionReviewStatusForRow({
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        material_name: grounded('Probe N/A / Graphite'),
        cof: {
          value: '0.023',
          review_state: 'flagged',
          evidence: { quote: 'wrong value', page: 1 },
        },
      },
    })).toBe('flagged')
  })

  it('honors explicit backend flagged review status', () => {
    expect(extractionReviewStatusForRow({
      review_status: 'flagged',
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        material_name: grounded('Probe N/A / Graphite'),
        cof: grounded('0.023'),
      },
    })).toBe('flagged')
  })

  it('marks rows with missing required evidence as needs_review', () => {
    expect(extractionReviewStatusForRow({
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        cof: grounded('0.023'),
      },
    })).toBe('needs_review')
  })

  it('marks grounded required evidence as ready', () => {
    expect(extractionReviewStatusForRow({
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        material_name: grounded('Probe N/A / Graphite'),
        cof: grounded('0.023'),
      },
    })).toBe('ready')
  })

  it('uses backend evidence quality to keep weakly sourced rows in review', () => {
    expect(extractionReviewStatusForRow({
      evidence_score: 0.45,
      evidence_grade: 'weak',
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        material_name: grounded('Probe N/A / Graphite'),
        cof: grounded('0.023'),
      },
    })).toBe('needs_review')
  })

  it('marks rows with canonical material evidence as ready', () => {
    expect(extractionReviewStatusForRow({
      field_evidence_json: {
        ionic_liquid: grounded('[N88812][A12BMB]'),
        material: grounded('Graphite'),
        cof: grounded('0.023'),
      },
    })).toBe('ready')
  })

  it('marks grounded diffusion evidence as ready', () => {
    expect(extractionReviewStatusForRow({
      extractor_type: 'diffusion',
      field_evidence_json: {
        system_name: grounded('[BMIM][BF4] in CNT'),
        ionic_liquid: grounded('[BMIM][BF4]'),
        diffusing_ion: grounded('cation'),
        d_cation: grounded('1.2e-10'),
        d_unit: grounded('m2/s'),
      },
    })).toBe('ready')
  })

  it('marks diffusion rows with uppercase coefficient evidence as ready', () => {
    expect(extractionReviewStatusForRow({
      extractor_type: 'diffusion',
      field_evidence_json: {
        system_name: grounded('[BMIM][BF4] in CNT'),
        ionic_liquid: grounded('[BMIM][BF4]'),
        diffusing_ion: grounded('cation'),
        D_cation: grounded('1.2e-10'),
        d_unit: grounded('m2/s'),
      },
    })).toBe('ready')
  })

  it('keeps diffusion rows in review when the diffusing ion is missing', () => {
    expect(extractionReviewStatusForRow({
      extractor_type: 'diffusion',
      field_evidence_json: {
        system_name: grounded('[BMIM][BF4] in CNT'),
        ionic_liquid: grounded('[BMIM][BF4]'),
        D_cation: grounded('1.2e-10'),
        d_unit: grounded('m2/s'),
      },
    })).toBe('needs_review')
  })

  it('keeps diffusion rows in review when the diffusion unit is missing', () => {
    expect(extractionReviewStatusForRow({
      extractor_type: 'diffusion',
      field_evidence_json: {
        system_name: grounded('[BMIM][BF4] in CNT'),
        ionic_liquid: grounded('[BMIM][BF4]'),
        diffusing_ion: grounded('cation'),
        D_cation: grounded('1.2e-10'),
      },
    })).toBe('needs_review')
  })

  it('marks diffusion rows with missing coefficient evidence as needs_review', () => {
    expect(extractionReviewStatusForRow({
      extractor_type: 'diffusion',
      field_evidence_json: {
        system_name: grounded('[BMIM][BF4] in CNT'),
        ionic_liquid: grounded('[BMIM][BF4]'),
        diffusing_ion: grounded('cation'),
        d_unit: grounded('m2/s'),
      },
    })).toBe('needs_review')
  })
})

describe('pdfUploadReviewFieldKeys', () => {
  it('maps table cells to backend review field keys', () => {
    expect(pdfUploadReviewFieldKeys('Ionic liquid')).toEqual(['ionic_liquid', 'lubricant'])
    expect(pdfUploadReviewFieldKeys('Tribopair')).toEqual(['material', 'material_name', 'probe_material', 'substrate_material'])
    expect(pdfUploadReviewFieldKeys('Conditions')).toEqual(['temperature', 'load', 'speed', 'potential', 'water_content'])
    expect(pdfUploadReviewFieldKeys('COF')).toEqual(['cof'])
  })

  it('returns the first backend field key for actions', () => {
    expect(firstPdfUploadReviewFieldKey('COF')).toBe('cof')
    expect(firstPdfUploadReviewFieldKey('Unknown')).toBe('')
  })

  it('chooses the clicked field key with evidence for actions', () => {
    expect(firstAvailablePdfUploadReviewFieldKey(
      'Tribopair',
      ['probe_material', 'substrate_material'],
      { probe_material: grounded('Steel probe') },
    )).toBe('probe_material')
  })

  it('chooses uppercase diffusion clicked field keys with evidence for actions', () => {
    expect(firstAvailablePdfUploadReviewFieldKey(
      'Diffusion',
      ['D_total', 'D_cation', 'D_anion', 'diffusion_standard_fields'],
      { D_cation: grounded('1.2e-10') },
    )).toBe('D_cation')
  })

  it('falls back to the label mapping when clicked field keys have no evidence', () => {
    expect(firstAvailablePdfUploadReviewFieldKey(
      'COF',
      ['cof_extracted'],
      {},
    )).toBe('cof_extracted')
    expect(firstAvailablePdfUploadReviewFieldKey(
      'COF',
      [],
      {},
    )).toBe('cof')
  })
})

describe('extractionReviewSummary', () => {
  it('summarizes mixed rows', () => {
    expect(extractionReviewSummary(['ready', 'ready', 'needs_review', 'flagged'])).toEqual({
      ready: 2,
      needsReview: 2,
      published: 0,
      label: '2 ready / 2 need review',
    })
  })

  it('summarizes all published rows', () => {
    expect(extractionReviewSummary(['published', 'published'])).toEqual({
      ready: 0,
      needsReview: 0,
      published: 2,
      label: '2 published',
    })
  })
})

describe('weak candidate review metadata', () => {
  it('marks backend weak candidates as needing review', () => {
    expect(extractionReviewStatusForRow({
      review_status: 'needs_review',
      record_origin: 'weak_candidate',
      confidence_tier: 'low',
      missing_fields: ['normal_load', 'speed'],
      field_evidence_json: {},
    })).toBe('needs_review')
  })

  it('formats missing field chips for users', () => {
    expect(missingFieldLabels(['normal_load', 'speed', 'ionic_liquid'])).toEqual([
      'Missing load',
      'Missing speed',
      'Missing IL',
    ])
  })

  it('formats confidence tiers', () => {
    expect(confidenceTierLabel('low')).toBe('Low confidence')
    expect(confidenceTierLabel('medium')).toBe('Medium confidence')
    expect(confidenceTierLabel('high')).toBe('High confidence')
  })
})
