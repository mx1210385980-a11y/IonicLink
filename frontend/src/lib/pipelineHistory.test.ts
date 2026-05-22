import { describe, expect, it } from 'vitest'

import type { BatchFile, DiffusionLibraryRecord, Literature } from '@/lib/api'
import {
  recentDiffusionLiteratureHistory,
  recentExtractionHistory,
  recentLiteratureHistory,
} from '@/lib/pipelineHistory'

function file(id: string, status: BatchFile['status'], completedAt?: string): BatchFile {
  return {
    id,
    name: `${id}.pdf`,
    status,
    progress: status === 'success' ? 100 : 0,
    records: [],
    ...(completedAt ? { completedAt } : {}),
  } as BatchFile
}

function literature(id: number, status: Literature['status'], createdAt: string, recordCount = 1): Literature {
  return {
    id,
    doi: '',
    title: `Paper ${id}`,
    authors: '',
    journal: '',
    year: 2026,
    status,
    recordCount,
    candidateCount: 0,
    created_at: createdAt,
  } as Literature
}

function diffusionRecord(literatureId: number, title: string, index: number): DiffusionLibraryRecord {
  return {
    id: `d-${literatureId}-${index}`,
    fileId: String(literatureId),
    extractor_type: 'diffusion',
    literature_id: literatureId,
    literatureId,
    literatureTitle: title,
    literatureDoi: `10.1234/${literatureId}`,
    material_name: '',
    ionic_liquid: '',
  } as DiffusionLibraryRecord
}

describe('recentExtractionHistory', () => {
  it('returns the latest five extracted files without queued, failed, or no-data rows', () => {
    const rows = [
      file('queued', 'uploaded'),
      file('oldest', 'success', '2026-05-20T01:00:00Z'),
      file('failed', 'error'),
      file('one', 'success', '2026-05-21T01:00:00Z'),
      file('two', 'success', '2026-05-21T02:00:00Z'),
      file('three', 'success', '2026-05-21T03:00:00Z'),
      file('four', 'success', '2026-05-21T04:00:00Z'),
      file('five', 'success', '2026-05-21T05:00:00Z'),
      file('empty', 'no_data'),
    ]

    expect(recentExtractionHistory(rows).map((item) => item.id)).toEqual([
      'five',
      'four',
      'three',
      'two',
      'one',
    ])
  })

  it('uses current list order as the fallback recency when timestamps are absent', () => {
    const rows = [
      file('first', 'success'),
      file('middle', 'success'),
      file('latest', 'success'),
    ]

    expect(recentExtractionHistory(rows, 2).map((item) => item.id)).toEqual(['latest', 'middle'])
  })

  it('keeps the latest five literature rows that have extracted records', () => {
    const rows = [
      literature(1, 'completed', '2026-05-21T01:00:00Z'),
      literature(2, 'failed', '2026-05-21T02:00:00Z', 3),
      literature(3, 'completed', '2026-05-21T03:00:00Z'),
      literature(4, 'completed', '2026-05-21T04:00:00Z'),
      literature(5, 'no_data', '2026-05-21T05:00:00Z', 0),
      literature(6, 'completed', '2026-05-21T06:00:00Z'),
      literature(7, 'completed', '2026-05-21T07:00:00Z'),
      literature(8, 'completed', '2026-05-21T08:00:00Z'),
    ]

    expect(recentLiteratureHistory(rows).map((item) => item.id)).toEqual([8, 7, 6, 4, 3])
  })

  it('keeps no-data literature if reviewable records exist', () => {
    const rows = [
      literature(1, 'no_data', '2026-05-21T01:00:00Z', 2),
      literature(2, 'no_data', '2026-05-21T02:00:00Z', 0),
    ]

    expect(recentLiteratureHistory(rows).map((item) => item.id)).toEqual([1])
  })

  it('groups diffusion library records by literature before taking recent history', () => {
    const rows = [
      diffusionRecord(12, 'Diffusion Paper 12', 1),
      diffusionRecord(12, 'Diffusion Paper 12', 2),
      diffusionRecord(11, 'Diffusion Paper 11', 1),
      diffusionRecord(10, 'Diffusion Paper 10', 1),
      { ...diffusionRecord(0, 'Missing literature', 1), literature_id: 0, literatureId: 0 },
    ]

    expect(recentDiffusionLiteratureHistory(rows, 2)).toEqual([
      expect.objectContaining({ literatureId: 12, title: 'Diffusion Paper 12', recordCount: 2 }),
      expect.objectContaining({ literatureId: 11, title: 'Diffusion Paper 11', recordCount: 1 }),
    ])
  })
})
