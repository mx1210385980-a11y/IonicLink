import { describe, expect, it } from 'vitest'

import { evidencePreviewErrorMessage } from './evidencePreviewErrors'

describe('evidencePreviewErrorMessage', () => {
  it('turns stale load preview HTTP failures into a user-friendly fallback message', () => {
    const message = evidencePreviewErrorMessage({
      message: 'Request failed with status code 422',
      response: {
        status: 422,
        data: { detail: 'Page is outside the PDF page range.' },
      },
    })

    expect(message).toBe('PDF highlight unavailable; showing stored field evidence instead.')
    expect(message).not.toContain('422')
    expect(message).not.toContain('Page is outside')
  })
})
