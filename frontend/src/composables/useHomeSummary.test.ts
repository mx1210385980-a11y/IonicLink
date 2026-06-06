import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHomeSummary } from './useHomeSummary'
import { searchRecords } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  getDashboardStats: vi.fn(async () => ({
    total_records: 0,
    cof_stats: { min: null, max: null, avg: null },
    confidence_stats: { breakdown: {} },
  })),
  listLiterature: vi.fn(async () => [
    {
      id: 138,
      title: 'Ionic liquid lubrication: influence of ion structure, surface potential and sliding velocity',
      doi: '10.1039/c3cp52638k',
      authors: 'Hua Li, Mark W. Rutland, Rob Atkin',
      journal: 'Physical Chemistry Chemical Physics',
      year: 2013,
      created_at: '2026-06-03T10:37:40',
      recordCount: 0,
      candidateCount: 45,
      tribologyRecordCount: 0,
      tribologyCandidateCount: 45,
      totalCount: 45,
    },
  ]),
  getLatestExtractionRun: vi.fn(async () => ({
    run_id: 'run-138',
    literature_id: 138,
    status: 'completed',
    created_at: '2026-06-03T10:35:49',
    updated_at: '2026-06-03T10:37:40',
    candidate_count: 45,
    final_count: 45,
    summary: { candidate_count: 45, final_count: 45 },
  })),
  getMentorProgress: vi.fn(async () => null),
  listCleanedDatasets: vi.fn(async () => ({ items: [] })),
  searchRecords: vi.fn(),
}))

describe('useHomeSummary', () => {
  beforeEach(() => {
    vi.mocked(searchRecords).mockImplementation(async (filter: { entityType?: string }) => ({
      total: filter.entityType === 'candidate' ? 101 : 409,
      skip: 0,
      limit: 1,
      items: [],
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('counts remote review candidates as visible home rows and pending review', async () => {
    let result!: ReturnType<typeof useHomeSummary>

    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        const homeSummary = useHomeSummary({
          files: ref([]),
          activeRun: ref(null),
          latestWorkflow: ref(null),
          preferredTrainingDatasetId: ref(null),
        })

        result = homeSummary
        return () => h('div')
      },
    }))

    app.mount(root)
    await flushPromises()
    await nextTick()

    expect(result.summary.value.health.datasetReadyRecords).toBe(45)
    expect(result.summary.value.health.officialDatabaseRecords).toBe(409)
    expect(result.summary.value.today.reviewPending).toBe(101)
    expect(result.hasData.value).toBe(true)

    app.unmount()
    root.remove()
  })

  it('separates approved official records from pending review candidates', async () => {
    let result!: ReturnType<typeof useHomeSummary>

    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        const homeSummary = useHomeSummary({
          files: ref([]),
          activeRun: ref(null),
          latestWorkflow: ref(null),
          preferredTrainingDatasetId: ref(null),
        })

        result = homeSummary
        return () => h('div')
      },
    }))

    app.mount(root)
    await flushPromises()
    await nextTick()

    expect(result.summary.value.health.officialDatabaseRecords).toBe(409)
    expect(result.summary.value.today.reviewPending).toBe(101)
    expect(searchRecords).toHaveBeenCalledWith({ entityType: 'candidate' }, 0, 1, { scope: 'active' })
    expect(searchRecords).toHaveBeenCalledWith({ entityType: 'record' }, 0, 1, { scope: 'active' })

    app.unmount()
    root.remove()
  })

  it('prefers canonical review queue totals over stale literature candidate counts', async () => {
    vi.mocked(searchRecords).mockImplementation(async (filter: { entityType?: string }) => ({
      total: filter.entityType === 'candidate' ? 44 : 1,
      skip: 0,
      limit: 1,
      items: [],
    }))

    let result!: ReturnType<typeof useHomeSummary>

    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        const homeSummary = useHomeSummary({
          files: ref([]),
          activeRun: ref(null),
          latestWorkflow: ref(null),
          preferredTrainingDatasetId: ref(null),
        })

        result = homeSummary
        return () => h('div')
      },
    }))

    app.mount(root)
    await flushPromises()
    await nextTick()

    expect(result.summary.value.today.reviewPending).toBe(44)
    expect(result.summary.value.health.officialDatabaseRecords).toBe(1)

    app.unmount()
    root.remove()
  })
})

async function flushPromises() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}
