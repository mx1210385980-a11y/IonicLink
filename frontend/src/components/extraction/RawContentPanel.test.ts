import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, h, type App } from 'vue'

import RawContentPanel from './RawContentPanel.vue'
import type { PageGroup } from '@/composables/useExtractionProcess'

let mountedApp: App<Element> | null = null
let host: HTMLElement | null = null

afterEach(() => {
  mountedApp?.unmount()
  mountedApp = null
  host?.remove()
  host = null
})

function mount(props: Record<string, unknown>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  mountedApp = createApp({ render: () => h(RawContentPanel as any, props) })
  mountedApp.mount(host)
  return host
}

function groups(): PageGroup[] {
  return [
    {
      page: 1,
      label: 'Page 1',
      kept: 1,
      dropped: 0,
      items: [
        { id: 1, stage: 'stage_c.claude_pdf', modality: 'claude_pdf', page: 1, source_figure: 'Fig. 1', raw: { cof: '0.08', normal_load: '5 N' }, normalized: { cof: '0.08' }, drop_reason: null, merged_into: null },
      ],
    },
    {
      page: 2,
      label: 'Page 2',
      kept: 0,
      dropped: 1,
      items: [
        { id: 2, stage: 'stage_c.claude_pdf', modality: 'claude_pdf', page: 2, source_figure: null, raw: { material_name: 'Steel' }, normalized: null, drop_reason: 'no_target_metric', merged_into: null },
      ],
    },
  ]
}

const rollup = {
  kept: 1,
  dropped: 1,
  dropped_by_reason: { no_target_metric: 1 },
  by_page: { '1': { kept: 1, dropped: 0 }, '2': { kept: 0, dropped: 1 } },
}

describe('RawContentPanel', () => {
  it('renders per-page groups, rollup, and drop reasons', async () => {
    const el = mount({ groups: groups(), rollup, loading: false, phase: 'terminal' })
    await nextTick()
    const text = el.textContent || ''
    expect(text).toContain('Page 1')
    expect(text).toContain('Page 2')
    expect(text).toContain('1 kept')
    expect(text).toContain('1 dropped')
    expect(text).toContain('no_target_metric')
    // headline of a kept raw row
    expect(text).toContain('cof=0.08')
  })

  it('shows the live placeholder before the run is terminal', async () => {
    const el = mount({ groups: [], rollup: null, loading: false, phase: 'running' })
    await nextTick()
    expect(el.textContent || '').toContain('appear here as soon as the run finishes')
  })

  it('filters to dropped rows when the Dropped tab is clicked', async () => {
    const el = mount({ groups: groups(), rollup, loading: false, phase: 'terminal' })
    await nextTick()
    const droppedTab = Array.from(el.querySelectorAll('button')).find((b) =>
      (b.textContent || '').trim().startsWith('Dropped'),
    ) as HTMLButtonElement
    droppedTab.click()
    await nextTick()
    const text = el.textContent || ''
    // Page 2 (the dropped one) remains; Page 1's kept-only group is filtered out.
    expect(text).toContain('Page 2')
    expect(text).not.toContain('Page 1')
  })
})
