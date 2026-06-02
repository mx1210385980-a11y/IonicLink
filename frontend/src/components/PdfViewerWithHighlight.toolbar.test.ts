import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('PdfViewerWithHighlight toolbar', () => {
  const source = readFileSync(resolve(__dirname, './PdfViewerWithHighlight.vue'), 'utf8')

  it('keeps the paper-reader controls wired into the PDF tab', () => {
    for (const testId of [
      'pdf-page-prev',
      'pdf-page-current',
      'pdf-page-next',
      'pdf-zoom-out',
      'pdf-zoom-in',
      'pdf-search-toggle',
      'pdf-download',
      'pdf-search-panel',
    ]) {
      expect(source).toContain(`data-testid="${testId}"`)
    }
  })

  it('keeps search in an Elicit-style right rail outside the PDF scroll region', () => {
    expect(source).toContain('data-testid="pdf-stage"')
    expect(source).toContain('data-testid="pdf-scroll-region"')
    expect(source).toContain("searchOpen ? 'grid-cols-[minmax(0,1fr)_24rem]'")
    expect(source).toContain('stageRef.value.clientWidth')
    expect(source).not.toContain("searchOpen ? 'grid-cols-[minmax(0,1fr)_22rem]'")
    expect(source).not.toContain('absolute right-0')
  })

  it('keeps toolbar groups fixed in Elicit-like relative positions', () => {
    expect(source).toContain('data-testid="pdf-toolbar"')
    expect(source).toContain('max-w-[58rem]')
    expect(source).toContain('data-testid="pdf-page-controls"')
    expect(source).toContain('data-testid="pdf-zoom-controls"')
    expect(source).toContain('data-testid="pdf-toolbar-actions"')
    expect(source).toContain('justify-start')
    expect(source).toContain('justify-center')
    expect(source).toContain('justify-end')
  })

  it('keeps PDF.js objects raw and only scrolls the internal PDF pane while navigating', () => {
    expect(source).toContain('markRaw')
    expect(source).toContain('shallowRef')
    expect(source).toContain('pdfDoc.value = markRaw(pdf)')
    expect(source).toContain('function scrollElementIntoPdfView')
    expect(source).toContain('container.scrollTo')
    expect(source).not.toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
  })
})
