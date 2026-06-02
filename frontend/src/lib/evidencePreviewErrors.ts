const PDF_PREVIEW_FALLBACK_MESSAGE = 'PDF highlight unavailable; showing stored field evidence instead.'

export function evidencePreviewErrorMessage(error: unknown): string {
  const err = error as {
    message?: unknown
    response?: {
      status?: unknown
      data?: { detail?: unknown } | string | null
    } | null
  }
  const status = Number(err?.response?.status)
  const detail = typeof err?.response?.data === 'string'
    ? err.response.data
    : String(err?.response?.data?.detail || '')
  const message = String(err?.message || '')
  const combined = `${status || ''} ${detail} ${message}`.toLowerCase()

  if (
    status === 422
    || status === 404
    || combined.includes('bbox')
    || combined.includes('page is outside')
    || combined.includes('pdf file not available')
    || combined.includes('unable to render')
  ) {
    return PDF_PREVIEW_FALLBACK_MESSAGE
  }

  return PDF_PREVIEW_FALLBACK_MESSAGE
}
