import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'SourceGroundingView.vue'), 'utf-8')
const appSource = readFileSync(resolve(__dirname, '../App.vue'), 'utf-8')
const highlightTypeSource = readFileSync(resolve(__dirname, '../types/pdf-highlight.ts'), 'utf-8')

describe('SourceGroundingView evidence workspace', () => {
  it('surfaces matched text instead of a coordinate-only evidence list', () => {
    expect(highlightTypeSource).toContain('matchedText?: string | null')
    expect(appSource).toContain('matchedText: highlight.matched_text')
    expect(source).toContain('Evidence Workspace')
    expect(source).toContain('evidenceLabel(item)')
    expect(source).toContain('item.matchedText')
    expect(source).not.toContain('{{ item.id }}')
    expect(source).not.toContain('({{ item.coords.x.toFixed(0) }}, {{ item.coords.y.toFixed(0) }})')
  })

  it('uses separate empty states for missing PDF highlights and missing source PDFs', () => {
    expect(source).toContain('No page-level evidence located')
    expect(source).toContain('No source document available')
    expect(source).toContain('pdfUrl ?')
  })
})
