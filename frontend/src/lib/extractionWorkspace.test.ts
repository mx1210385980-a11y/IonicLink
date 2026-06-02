import { describe, expect, it } from 'vitest'
import { buildPdfUploadExtractionItems, type UploadExtractionStateItem } from './extractionWorkspace'

type Paper = {
  id: string
  title: string
  cachedRecordCount?: number
}

function completedItem(id: string): UploadExtractionStateItem<Paper> {
  return {
    id,
    title: `Paper ${id}`,
    status: 'completed',
    message: 'Completed earlier.',
    records: 2,
    extractedRows: [{ id: `${id}-row` }],
    progress: 100,
  }
}

describe('buildPdfUploadExtractionItems', () => {
  it('preserves completed preview rows when retrying only recoverable uploads', () => {
    const existing = [
      completedItem('ok-paper'),
      {
        id: 'retry-paper',
        title: 'Retry paper',
        status: 'no_data',
        message: 'No data with previous mode.',
        records: 0,
        extractedRows: [],
        progress: 100,
      },
    ] satisfies Array<UploadExtractionStateItem<Paper>>

    const next = buildPdfUploadExtractionItems(
      [{ id: 'retry-paper', title: 'Retry paper' }],
      existing,
      { isCachedPaper: () => false },
    )

    expect(next.find((item) => item.id === 'ok-paper')).toMatchObject({
      status: 'completed',
      records: 2,
      extractedRows: [{ id: 'ok-paper-row' }],
    })
    expect(next.find((item) => item.id === 'retry-paper')).toMatchObject({
      status: 'queued',
      records: 0,
      extractedRows: [],
      progress: 4,
    })
  })

  it('keeps cached result rows while refreshing cached extraction items', () => {
    const existing = [completedItem('cached-paper')]

    const next = buildPdfUploadExtractionItems(
      [{ id: 'cached-paper', title: 'Cached paper', cachedRecordCount: 3 }],
      existing,
      { isCachedPaper: () => true },
    )

    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      status: 'completed',
      records: 3,
      extractedRows: [{ id: 'cached-paper-row' }],
      progress: 100,
    })
  })
})
