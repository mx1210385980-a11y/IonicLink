import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_PUBLIC_TERMS,
  NANOFriction_PUBLIC_COPY,
  NANOFriction_TARGET_METRICS,
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
})
