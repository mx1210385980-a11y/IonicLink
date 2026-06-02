import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

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
    ...overrides,
  } as RecordResponse
}

describe('useRecordEditing', () => {
  it('rebuilds the edit snapshot when reopening a record after cancelling', () => {
    const editing = useRecordEditing({
      result: ref<PaginatedRecordResponse>({ items: [], total: 0, skip: 0, limit: 20 } as PaginatedRecordResponse),
      evidenceData: ref({}),
      evidenceModalRecord: ref(null),
      markGraphDirty: vi.fn(),
    })

    const row = record()
    editing.openEditModal(row)
    editing.updateActiveEditingField('speedValue', '999')
    editing.closeEditDrawer()
    editing.openEditModal(row)

    expect(editing.activeEditValues.value?.speedValue).toBe('6 μm/s')
  })
})
