import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

vi.mock('@/lib/api', () => ({
  getLatestExtractionRun: vi.fn(),
  getExtractionRun: vi.fn(),
  getRawCandidates: vi.fn(),
  extractData: vi.fn(),
  cancelExtraction: vi.fn(),
}))

import {
  cancelExtraction,
  extractData,
  getLatestExtractionRun,
  getRawCandidates,
} from '@/lib/api'
import { useExtractionProcess } from './useExtractionProcess'

const mockLatest = getLatestExtractionRun as unknown as ReturnType<typeof vi.fn>
const mockRaw = getRawCandidates as unknown as ReturnType<typeof vi.fn>
const mockExtract = extractData as unknown as ReturnType<typeof vi.fn>
const mockCancel = cancelExtraction as unknown as ReturnType<typeof vi.fn>

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'run-1',
    literature_id: 70,
    status: 'running',
    candidate_count: 0,
    final_count: 0,
    dropped_by_reason: {},
    page_coverage: {},
    progress_log: [{ stage: 'stage_c.claude_pdf.capture', message: 'capturing full PDF via Claude' }],
    summary: { pipeline: 'claude_pdf', current_stage: 'stage_c.claude_pdf.capture', claude_pdf: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 20 } } },
    created_at: '2026-06-07T10:00:00Z',
    updated_at: '2026-06-07T10:00:05Z',
    ...overrides,
  }
}

function rawFixture() {
  return {
    literature_id: 70,
    run_id: 'run-1',
    status: 'completed',
    total: 2,
    returned: 2,
    skip: 0,
    limit: 2000,
    filter: 'all',
    rollup: {
      kept: 1,
      dropped: 1,
      dropped_by_reason: { no_target_metric: 1 },
      by_page: { '1': { kept: 1, dropped: 0 }, '2': { kept: 0, dropped: 1 } },
    },
    items: [
      { id: 1, stage: 'stage_c.claude_pdf', modality: 'claude_pdf', page: 1, source_figure: null, raw: { cof: '0.08' }, normalized: { cof: '0.08' }, drop_reason: null, merged_into: null },
      { id: 2, stage: 'stage_c.claude_pdf', modality: 'claude_pdf', page: 2, source_figure: null, raw: { cof: null }, normalized: null, drop_reason: 'no_target_metric', merged_into: null },
    ],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useExtractionProcess state machine', () => {
  it('idle → running → terminal: fetches raw once on terminal and stops polling', async () => {
    mockLatest.mockResolvedValueOnce(runFixture({ status: 'running' }))
    mockRaw.mockResolvedValue(rawFixture())

    const lit = ref<number | null>(70)
    const proc = useExtractionProcess({ literatureId: lit, autoStart: false })

    await proc.refresh()
    expect(proc.phase.value).toBe('running')
    expect(proc.isClaudePdf.value).toBe(true)
    expect(proc.tokenUsage.value.input).toBe(100)
    expect(mockRaw).not.toHaveBeenCalled()

    // Next poll returns terminal.
    mockLatest.mockResolvedValueOnce(runFixture({ status: 'completed', final_count: 1 }))
    await proc.refresh()
    expect(proc.phase.value).toBe('terminal')
    expect(proc.progressPercent.value).toBe(100)
    expect(mockRaw).toHaveBeenCalledTimes(1)
    expect(proc.rollup.value?.kept).toBe(1)
    expect(proc.itemsByPage.value).toHaveLength(2)
    expect(proc.itemsByPage.value[0]!.page).toBe(1)

    // A further refresh does not refetch raw.
    mockLatest.mockResolvedValueOnce(runFixture({ status: 'completed', final_count: 1 }))
    await proc.refresh()
    expect(mockRaw).toHaveBeenCalledTimes(1)
  })

  it('treats a 404 latest-run as idle, not an error', async () => {
    mockLatest.mockRejectedValueOnce({ response: { status: 404 } })
    const proc = useExtractionProcess({ literatureId: ref(99), autoStart: false })
    await proc.refresh()
    expect(proc.phase.value).toBe('idle')
    expect(proc.run.value).toBeNull()
    expect(proc.error.value).toBeNull()
  })

  it('surfaces non-404 errors', async () => {
    mockLatest.mockRejectedValueOnce({ response: { status: 500, data: { detail: 'boom' } } })
    const proc = useExtractionProcess({ literatureId: ref(1), autoStart: false })
    await proc.refresh()
    expect(proc.error.value).toBe('boom')
  })

  it('start() triggers extractData then begins polling for an active run', async () => {
    mockExtract.mockResolvedValue({})
    mockLatest.mockResolvedValue(runFixture({ status: 'running' }))
    const proc = useExtractionProcess({ literatureId: ref(70), autoStart: false })

    await proc.start(true, 'auto')
    expect(mockExtract).toHaveBeenCalledTimes(1)
    expect(mockExtract.mock.calls[0]![0]).toBe('70')
    expect(proc.phase.value).toBe('running')
    proc.stop()
  })

  it('cancel() calls cancelExtraction and refreshes', async () => {
    mockCancel.mockResolvedValue({})
    mockLatest.mockResolvedValue(runFixture({ status: 'cancelled' }))
    const proc = useExtractionProcess({ literatureId: ref(70), autoStart: false })
    await proc.cancel()
    expect(mockCancel).toHaveBeenCalledTimes(1)
    expect(proc.phase.value).toBe('terminal')
  })

  it('autoStart: a run already terminal fetches raw once and never starts a timer', async () => {
    vi.useFakeTimers()
    mockLatest.mockResolvedValue(runFixture({ status: 'completed', final_count: 1 }))
    mockRaw.mockResolvedValue(rawFixture())

    const proc = useExtractionProcess({ literatureId: ref(70), pollIntervalMs: 1000 })
    await flushMicrotasks()
    expect(proc.phase.value).toBe('terminal')
    expect(mockRaw).toHaveBeenCalledTimes(1)

    // No polling should occur after terminal.
    await vi.advanceTimersByTimeAsync(3000)
    expect(mockLatest).toHaveBeenCalledTimes(1)
    proc.stop()
  })
})
