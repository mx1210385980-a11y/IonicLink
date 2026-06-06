import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const correctRecordMock = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, correctRecord: (...args: unknown[]) => correctRecordMock(...args) }
})

import { useRecordEditing } from './useRecordEditing'
import type { PaginatedRecordResponse, RecordResponse } from '@/lib/api'

function record(overrides: Partial<RecordResponse> = {}): RecordResponse {
  return {
    id: 7,
    lubricant: '[BMIM][AOT]',
    temperature: '298.15 K',
    potential: '',
    waterContent: '',
    speedValue: '6 μm/s',
    shearRate: '',
    loadValue: '10 nN',
    probeMaterial: 'SiO2',
    probeGeometry: '',
    probeRadius: '',
    probeRoughness: '',
    substrateMaterial: 'Au(111)',
    substrateCoating: '',
    substrateRoughness: '',
    filmThickness: '2 nm',
    cofRaw: '0.01',
    cofValue: 0.01,
    materialName: 'Au(111)',
    surfaceRoughness: '',
    confidence: 0.5,
    ...overrides,
  } as RecordResponse
}

function setup() {
  return useRecordEditing({
    result: ref<PaginatedRecordResponse>({ items: [], total: 0, skip: 0, limit: 20 } as PaginatedRecordResponse),
    evidenceData: ref({}),
    evidenceModalRecord: ref(null),
    markGraphDirty: vi.fn(),
  })
}

describe('useRecordEditing correction flow', () => {
  beforeEach(() => correctRecordMock.mockReset())

  it('previews edits via the dry-run correction service', async () => {
    const editing = setup()
    const row = record()
    editing.openEditModal(row)
    editing.updateActiveEditingField('cof', '0.5')

    correctRecordMock.mockResolvedValueOnce({
      success: true,
      id: 7,
      committed: false,
      dryRun: true,
      diff: { cof_value: { before: 0.01, after: 0.5 }, cof_raw: { before: '0.01', after: '0.5' } },
      candidateIds: [],
      confidence: 0.8,
    })

    await editing.previewActiveCorrection()

    expect(correctRecordMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ fields: expect.objectContaining({ cof_value: 0.5, cof_raw: '0.5' }) }),
      { dryRun: true },
    )
    expect(editing.correctionReviewMode.value).toBe(true)
    expect(editing.correctionPreview.value?.confidence).toBe(0.8)
    // Preview must not mutate the live row yet.
    expect(row.cofValue).toBe(0.01)
  })

  it('commits the correction, updates the row, and closes the drawer', async () => {
    const editing = setup()
    const row = record()
    editing.openEditModal(row)
    editing.updateActiveEditingField('lubricant', '[EMIM][TFSI]')

    correctRecordMock.mockResolvedValueOnce({
      success: true, id: 7, committed: false, dryRun: true,
      diff: { lubricant: { before: '[BMIM][AOT]', after: '[EMIM][TFSI]' } },
      candidateIds: [], confidence: 0.7,
    })
    await editing.previewActiveCorrection()

    correctRecordMock.mockResolvedValueOnce({
      success: true, id: 7, committed: true, dryRun: false,
      diff: { lubricant: { before: '[BMIM][AOT]', after: '[EMIM][TFSI]' } },
      candidateIds: [], confidence: 0.9,
    })
    await editing.commitActiveCorrection()

    // The committing call must NOT pass dryRun.
    expect(correctRecordMock).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ fields: expect.objectContaining({ lubricant: '[EMIM][TFSI]' }) }),
    )
    expect(row.lubricant).toBe('[EMIM][TFSI]')
    expect(row.confidence).toBe(0.9)
    expect(editing.editDrawerRecord.value).toBeNull()
    expect(editing.correctionReviewMode.value).toBe(false)
  })

  it('surfaces an error and keeps the drawer open when the preview fails', async () => {
    const editing = setup()
    const row = record()
    editing.openEditModal(row)
    correctRecordMock.mockRejectedValueOnce({ response: { data: { detail: 'not correctable' } } })

    await editing.previewActiveCorrection()

    expect(editing.correctionError.value).toBe('not correctable')
    expect(editing.correctionReviewMode.value).toBe(false)
    expect(editing.editDrawerRecord.value).not.toBeNull()
  })
})
