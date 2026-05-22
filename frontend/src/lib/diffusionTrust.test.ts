import { describe, expect, it } from 'vitest'

import {
  classifyDiffusionNormalizationState,
  classifyDiffusionSourceTier,
} from '@/lib/diffusionTrust'

describe('diffusion trust classification', () => {
  it('marks manual graph estimates as figure-estimated and still pending normalization', () => {
    const record = {
      record_origin: 'manual_figure_estimate',
      D_cation: 1.2,
      D_unit: '10^-10 m2/s',
      field_evidence_json: {
        d_cation: {
          value: 1.2,
          evidence: { source_type: 'figure', source_label: 'Fig. 4' },
        },
      },
    }

    expect(classifyDiffusionSourceTier(record).id).toBe('figure_estimate')
    expect(classifyDiffusionNormalizationState(record).id).toBe('pending')
  })

  it('marks grounded table values as original-source records with ready normalization', () => {
    const record = {
      D_total: 5.7,
      D_unit: 'A2 ps-1',
      diffusion_normalization: {
        status: 'ready',
        primary: {
          status: 'normalized',
          value_10e12_m2_s: 570,
        },
      },
      field_evidence_json: {
        d_total: {
          value: 5.7,
          grounding_mode: 'explicit',
          evidence: { source_type: 'table', matched_text: '5.7 x 10-1' },
        },
      },
    }

    expect(classifyDiffusionSourceTier(record)).toMatchObject({
      id: 'original_source',
      label: '原文摘录',
    })
    expect(classifyDiffusionNormalizationState(record)).toMatchObject({
      id: 'ready',
      label: '已归一化',
    })
  })

  it('keeps inferred coefficient rows as model candidates', () => {
    const record = {
      record_origin: 'llm_extraction',
      D_anion: 0.42,
      D_unit: 'm2/s',
      field_evidence_json: {
        d_anion: {
          value: 0.42,
          grounding_mode: 'inferred',
          evidence: { source_type: 'unknown' },
        },
      },
    }

    expect(classifyDiffusionSourceTier(record)).toMatchObject({
      id: 'model_candidate',
      label: '模型候选',
    })
  })
})
