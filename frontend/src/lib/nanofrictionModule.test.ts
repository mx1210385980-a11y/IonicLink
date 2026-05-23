import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_PUBLIC_TERMS,
  NANOFriction_PUBLIC_COPY,
  NANOFriction_TARGET_METRICS,
  buildNanofrictionStartPayload,
  containsForbiddenPublicTerm,
} from './nanofrictionModule'
import { normalizeSection, SECTION_OPTIONS_BY_VIEW } from './platform'

describe('nanofriction modeling public module', () => {
  it('registers a dedicated modeling section', () => {
    expect(SECTION_OPTIONS_BY_VIEW.modeling).toContain('nanofriction')
    expect(normalizeSection('modeling', 'nanofriction')).toBe('nanofriction')
  })

  it('keeps public module copy free of internal shorthand', () => {
    const visibleText = JSON.stringify(NANOFriction_PUBLIC_COPY)
    expect(FORBIDDEN_PUBLIC_TERMS.some((term) => visibleText.includes(term))).toBe(false)
    expect(containsForbiddenPublicTerm(visibleText)).toBe(false)
  })

  it('captures the thesis target metrics used by the dashboard', () => {
    expect(NANOFriction_TARGET_METRICS.dataset.totalRows).toBe(212)
    expect(NANOFriction_TARGET_METRICS.dataset.trainingRows).toBe(169)
    expect(NANOFriction_TARGET_METRICS.dataset.testingRows).toBe(37)
    expect(NANOFriction_TARGET_METRICS.dataset.externalRows).toBe(6)
    expect(NANOFriction_TARGET_METRICS.testing.r2).toBe(0.991)
    expect(NANOFriction_TARGET_METRICS.external.r2).toBe(0.985)
  })

  it('builds the fixed reproduction payload for the built-in dataset', () => {
    const payload = buildNanofrictionStartPayload(42, 'μ')

    expect(payload.cleaned_dataset_id).toBe(42)
    expect(payload.target).toBe('μ')
    expect(payload.algorithm).toBe('high_cof_segmented')
    expect(payload.data_options.split_strategy).toBe('wff_thesis')
    expect(payload.data_options.training_view).toBe('all')
    expect(payload.data_options.target_outlier_strategy).toBe('off')
    expect(payload.hyperparameters.base_models).toEqual(['catboost', 'random_forest', 'xgboost'])
    expect(payload.hyperparameters.meta_model).toBe('catboost')
  })
})
