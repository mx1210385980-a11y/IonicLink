import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, getRawCandidates } from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getRawCandidates', () => {
  it('builds the raw-candidates URL with status + extractor_type and returns data', async () => {
    const payload = {
      literature_id: 70,
      run_id: 'run-70',
      status: 'completed',
      total: 2,
      returned: 2,
      skip: 0,
      limit: 1000,
      filter: 'all',
      rollup: {
        kept: 1,
        dropped: 1,
        dropped_by_reason: { no_target_metric: 1 },
        by_page: { '1': { kept: 1, dropped: 0 }, '2': { kept: 0, dropped: 1 } },
      },
      items: [],
    }
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: payload } as any)

    const result = await getRawCandidates(70, { status: 'all' })

    expect(spy).toHaveBeenCalledTimes(1)
    const url = spy.mock.calls[0]![0] as string
    expect(url.startsWith('/api/extract/70/raw-candidates?')).toBe(true)
    expect(url).toContain('status=all')
    expect(url).toContain('extractor_type=tribology')
    expect(result.rollup.kept).toBe(1)
    expect(result.rollup.dropped).toBe(1)
    expect(result.rollup.by_page['2']?.dropped).toBe(1)
  })

  it('passes skip/limit/status/extractorType through', async () => {
    const spy = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { items: [], rollup: { kept: 0, dropped: 0, dropped_by_reason: {}, by_page: {} } } } as any)

    await getRawCandidates(5, { status: 'dropped', skip: 200, limit: 50, extractorType: 'diffusion' })

    const url = spy.mock.calls[0]![0] as string
    expect(url).toContain('status=dropped')
    expect(url).toContain('extractor_type=diffusion')
    expect(url).toContain('skip=200')
    expect(url).toContain('limit=50')
  })
})
