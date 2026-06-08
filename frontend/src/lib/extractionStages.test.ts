import { describe, expect, it } from 'vitest'

import {
  STAGE_BANDS,
  isActiveRunStatus,
  isTerminalRunStatus,
  mapStageToProgress,
  stageBandId,
  stageBandIndex,
} from './extractionStages'

describe('run status classification', () => {
  it('classifies terminal statuses', () => {
    for (const s of ['completed', 'failed', 'error', 'cancelled', 'no_data', 'COMPLETED']) {
      expect(isTerminalRunStatus(s)).toBe(true)
    }
    expect(isTerminalRunStatus('running')).toBe(false)
    expect(isTerminalRunStatus(null)).toBe(false)
  })

  it('classifies active statuses', () => {
    for (const s of ['queued', 'running', 'processing', 'extracting']) {
      expect(isActiveRunStatus(s)).toBe(true)
    }
    expect(isActiveRunStatus('completed')).toBe(false)
  })
})

describe('mapStageToProgress (parity with prior useAppShell values)', () => {
  it('returns 100 for terminal-ish statuses', () => {
    expect(mapStageToProgress('stage_c.text', 'completed')).toBe(100)
    expect(mapStageToProgress('stage_a', 'no_data')).toBe(100)
  })

  it('maps each stage band to its prior numeric value', () => {
    expect(mapStageToProgress('', 'running')).toBe(8)
    expect(mapStageToProgress('stage_a.profile', 'running')).toBe(14)
    expect(mapStageToProgress('stage_b.abbrev', 'running')).toBe(24)
    expect(mapStageToProgress('stage_c.fast_text_start', 'running')).toBe(62)
    expect(mapStageToProgress('stage_c.figure_retry', 'running')).toBe(50)
    expect(mapStageToProgress('stage_c.figure', 'running')).toBe(44)
    expect(mapStageToProgress('stage_c.text', 'running')).toBe(62)
    expect(mapStageToProgress('fallback_table', 'running')).toBe(74)
    expect(mapStageToProgress('stage_d.validation', 'running')).toBe(82)
    expect(mapStageToProgress('stage_e.finalize', 'running')).toBe(94)
    expect(mapStageToProgress('unknown_stage', 'running')).toBe(18)
  })
})

describe('stage bands', () => {
  it('has five ordered bands', () => {
    expect(STAGE_BANDS.map((b) => b.id)).toEqual([
      'stage_a', 'stage_b', 'stage_c', 'stage_d', 'stage_e',
    ])
  })

  it('maps stages (and claude_pdf substages) to a band', () => {
    expect(stageBandId('stage_a.claude_pdf')).toBe('stage_a')
    expect(stageBandId('stage_c.claude_pdf.rows')).toBe('stage_c')
    expect(stageBandId('fallback_table')).toBe('stage_c')
    expect(stageBandId('stage_e.finalize')).toBe('stage_e')
    expect(stageBandId('')).toBeNull()
    expect(stageBandIndex('stage_d.validation')).toBe(3)
    expect(stageBandIndex('nope')).toBe(-1)
  })
})
