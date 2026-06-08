import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

import ReadingReportPanel from './ReadingReportPanel.vue'
import type { ReadingReportResponse } from '@/lib/api'

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
  mountedApp = createApp({ render: () => h(ReadingReportPanel as any, props) })
  mountedApp.mount(host)
  return host
}

function report(overrides: Partial<ReadingReportResponse> = {}): ReadingReportResponse {
  return {
    success: true,
    literature_id: 12,
    extractor_type: 'tribology',
    status: 'completed',
    report_markdown: '## Paper Snapshot\n\n- Ionic liquid: **[EMIM][TFSI]**\n- Main finding: low friction under the reported test conditions.',
    prompt_version: 'reading-report-v1',
    model: 'fake-model',
    provider: 'fake',
    error_message: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe('ReadingReportPanel', () => {
  it('renders a compact loading state', async () => {
    const el = mount({ report: null, loading: true })
    await nextTick()

    expect(el.textContent || '').toContain('Reading paper')
    expect(el.textContent || '').toContain('Preparing the first model report')
  })

  it('renders markdown report content and follow-up actions', async () => {
    const el = mount({ report: report(), loading: false })
    await nextTick()

    expect(el.querySelector('[data-testid="reading-report-display-table"]')).not.toBeNull()
    expect(el.textContent || '').toContain('Ionic liquid')
    expect(el.innerHTML).toContain('<strong>[EMIM][TFSI]</strong>')
    expect(el.textContent || '').toContain('Generate candidates')
    expect(el.textContent || '').toContain('Deep extraction')
  })

  it('renders only the report body in reader mode', async () => {
    const el = mount({ report: report(), loading: false, reader: true })
    await nextTick()

    expect(el.querySelector('[data-testid="reading-report-display-table"]')).not.toBeNull()
    expect(el.textContent || '').toContain('Ionic liquid')
    expect(el.textContent || '').not.toContain('Generate candidates')
    expect(el.textContent || '').not.toContain('Deep extraction')
    expect(el.textContent || '').not.toContain('LLM reading report')
  })

  it('keeps editable reports in display mode until Edit is clicked', async () => {
    const onSave = vi.fn()
    const onEditingChange = vi.fn()
    const el = mount({ report: report(), loading: false, reader: true, editable: true, saveLabel: 'Save to Library', onSave, onEditingChange })
    await nextTick()

    expect(el.querySelector('textarea')).toBeNull()
    expect(el.querySelector('[data-testid="reading-report-display-table"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="reading-report-edit-mode"]')).toBeNull()
    expect(el.textContent || '').toContain('Ionic liquid')
    expect(el.textContent || '').toContain('Save to Library')
    expect(el.textContent || '').toContain('Edit')

    const saveToLibrary = el.querySelector('[data-testid="save-report-to-library"]') as HTMLButtonElement | null
    saveToLibrary?.click()
    expect(onSave).toHaveBeenCalledWith(report().report_markdown)

    const edit = el.querySelector('[data-testid="edit-reading-report"]') as HTMLButtonElement | null
    edit?.click()
    await nextTick()

    const textarea = el.querySelector('textarea') as HTMLTextAreaElement | null
    expect(textarea?.value).toContain('Paper Snapshot')
    expect(el.querySelector('[data-testid="reading-report-display-table"]')).toBeNull()
    expect(el.querySelector('[data-testid="reading-report-edit-mode"]')).not.toBeNull()
    expect(onEditingChange).toHaveBeenCalledWith(true)
  })

  it('saves edited markdown from the explicit edit mode', async () => {
    const onSave = vi.fn()
    const onEditingChange = vi.fn()
    const el = mount({ report: report(), loading: false, reader: true, editable: true, saveLabel: 'Save to Library', onSave, onEditingChange })
    await nextTick()

    const edit = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Edit'))
    edit?.click()
    await nextTick()

    const textarea = el.querySelector('textarea') as HTMLTextAreaElement | null
    textarea!.value = '## Edited report\n\nManual note.'
    textarea!.dispatchEvent(new Event('input'))
    await nextTick()

    expect(el.textContent || '').toContain('Cancel')
    const save = el.querySelector('[data-testid="save-edited-reading-report"]') as HTMLButtonElement | null
    save?.click()

    expect(onSave).toHaveBeenCalledWith('## Edited report\n\nManual note.')
  })

  it('emits editing state when canceling an edit', async () => {
    const onEditingChange = vi.fn()
    const el = mount({ report: report(), loading: false, reader: true, editable: true, onEditingChange })
    await nextTick()

    const edit = el.querySelector('[data-testid="edit-reading-report"]') as HTMLButtonElement | null
    edit?.click()
    await nextTick()

    const cancel = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Cancel'))
    cancel?.click()
    await nextTick()

    expect(onEditingChange).toHaveBeenCalledWith(true)
    expect(onEditingChange).toHaveBeenCalledWith(false)
    expect(el.querySelector('textarea')).toBeNull()
  })

  it('defaults to a compact table view even when the model returns prose bullets', async () => {
    const el = mount({
      report: report({
        report_markdown: [
          '## Paper Snapshot',
          '',
          '- System studied: [BMIM][BF4] on steel.',
          '- Method / setup: reciprocating sliding test.',
          '- Main results: lower COF than the reference lubricant.',
          '',
          '## Limitations',
          '',
          'Exact repeatability details require checking the PDF.',
        ].join('\n'),
      }),
      loading: false,
      reader: true,
      editable: true,
    })
    await nextTick()

    const table = el.querySelector('[data-testid="reading-report-display-table"]')
    expect(table).not.toBeNull()
    expect(table?.textContent || '').toContain('System studied')
    expect(table?.textContent || '').toContain('[BMIM][BF4] on steel.')
    expect(table?.textContent || '').toContain('Limitations')
    expect(el.querySelector('textarea')).toBeNull()
  })

  it('keeps reader toolbar separate from the scrollable report body', async () => {
    const el = mount({ report: report(), loading: false, reader: true, editable: true, saveLabel: 'Save to Library' })
    await nextTick()

    expect(el.querySelector('[data-testid="reading-report-toolbar"]')).not.toBeNull()
    expect(el.querySelector('.reading-report--reader [data-testid="reading-report-toolbar"]')).toBeNull()

    const edit = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Edit'))
    edit?.click()
    await nextTick()

    expect(el.textContent || '').not.toContain('Save to Library')
    expect(Array.from(el.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Save')).toBe(true)
  })

  it('renders pipe tables as readable tables', async () => {
    const el = mount({
      report: report({
        report_markdown: [
          '## Materials',
          '',
          '| Category | Details |',
          '| --- | --- |',
          '| Ionic liquids | [N88812][A12BMB] |',
          '| Surface | HOPG graphite |',
        ].join('\n'),
      }),
      loading: false,
      reader: true,
      editable: true,
    })
    await nextTick()

    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelectorAll('th')).toHaveLength(2)
    expect(el.textContent || '').not.toContain('| --- | --- |')
  })

  it('emits action events from the ready state', async () => {
    const onGenerateCandidates = vi.fn()
    const onDeepExtraction = vi.fn()
    const el = mount({
      report: report(),
      loading: false,
      onGenerateCandidates,
      onDeepExtraction,
    })
    await nextTick()

    const buttons = Array.from(el.querySelectorAll('button'))
    buttons.find((button) => button.textContent?.includes('Generate candidates'))?.click()
    buttons.find((button) => button.textContent?.includes('Deep extraction'))?.click()

    expect(onGenerateCandidates).toHaveBeenCalledTimes(1)
    expect(onDeepExtraction).toHaveBeenCalledTimes(1)
  })

  it('shows a retry affordance for failed reports', async () => {
    const onRetry = vi.fn()
    const el = mount({
      report: report({ success: false, status: 'failed', report_markdown: '', error_message: 'model unavailable' }),
      loading: false,
      onRetry,
    })
    await nextTick()

    expect(el.textContent || '').toContain('model unavailable')
    const retry = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Retry'))
    retry?.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
