import type { BatchFile, DiffusionLibraryRecord, Literature } from '@/lib/api'

const EXTRACTED_STATUSES = new Set(['success', 'completed'])
const NON_EXTRACTED_LITERATURE_STATUSES = new Set([
  'cancelled',
  'error',
  'extracting',
  'failed',
  'processing',
  'queued',
  'running',
  'uploaded',
  'uploading',
])

function normalizedStatus(file: BatchFile | null | undefined) {
  return String(file?.status || '').trim().toLowerCase()
}

function historyTimestamp(file: BatchFile, fallbackIndex: number) {
  const raw = (
    (file as any).completedAt
    ?? (file as any).completed_at
    ?? (file as any).extractedAt
    ?? (file as any).extracted_at
    ?? (file as any).updatedAt
    ?? (file as any).updated_at
    ?? (file as any).createdAt
    ?? (file as any).created_at
  )
  const parsed = raw ? Date.parse(String(raw)) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackIndex
}

export function recentExtractionHistory(files: BatchFile[], limit = 5): BatchFile[] {
  return (Array.isArray(files) ? files : [])
    .map((file, index) => ({ file, index, timestamp: historyTimestamp(file, index) }))
    .filter(({ file }) => Boolean(file?.id) && EXTRACTED_STATUSES.has(normalizedStatus(file)))
    .sort((left, right) => {
      if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp
      return right.index - left.index
    })
    .slice(0, Math.max(0, limit))
    .map(({ file }) => file)
}

function normalizedLiteratureStatus(literature: Literature | null | undefined) {
  return String(literature?.status || '').trim().toLowerCase()
}

function literatureRecordCount(literature: Literature | null | undefined) {
  const recordCount = Number(literature?.recordCount || 0)
  const candidateCount = Number(literature?.candidateCount || 0)
  return Math.max(0, Number.isFinite(recordCount) ? recordCount : 0)
    + Math.max(0, Number.isFinite(candidateCount) ? candidateCount : 0)
}

function literatureTimestamp(literature: Literature, fallbackIndex: number) {
  const raw = (
    (literature as any).updatedAt
    ?? (literature as any).updated_at
    ?? literature.reviewedAt
    ?? literature.submittedAt
    ?? (literature as any).createdAt
    ?? literature.created_at
  )
  const parsed = raw ? Date.parse(String(raw)) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackIndex
}

export function recentLiteratureHistory(literature: Literature[], limit = 5): Literature[] {
  return (Array.isArray(literature) ? literature : [])
    .map((item, index) => ({ item, index, timestamp: literatureTimestamp(item, index) }))
    .filter(({ item }) => {
      const status = normalizedLiteratureStatus(item)
      return Boolean(item?.id)
        && literatureRecordCount(item) > 0
        && (EXTRACTED_STATUSES.has(status) || !NON_EXTRACTED_LITERATURE_STATUSES.has(status))
    })
    .sort((left, right) => {
      if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp
      return right.index - left.index
    })
    .slice(0, Math.max(0, limit))
    .map(({ item }) => item)
}

export function extractionHistoryRecordCount(literature: Literature | null | undefined) {
  return literatureRecordCount(literature)
}

export type DiffusionLiteratureHistory = {
  literatureId: number
  title: string
  doi: string
  recordCount: number
  timestamp: number
}

function diffusionLiteratureId(record: DiffusionLibraryRecord | null | undefined) {
  return Number(record?.literature_id ?? record?.literatureId ?? record?.literature?.id ?? 0)
}

function diffusionRecordTimestamp(record: DiffusionLibraryRecord, fallbackIndex: number) {
  const literature = record.literature || {}
  const raw = (
    (record as any).extractedAt
    ?? (record as any).extracted_at
    ?? (record as any).updatedAt
    ?? (record as any).updated_at
    ?? (record as any).createdAt
    ?? (record as any).created_at
    ?? (literature as any).updatedAt
    ?? (literature as any).updated_at
    ?? (literature as any).createdAt
    ?? (literature as any).created_at
  )
  const parsed = raw ? Date.parse(String(raw)) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackIndex
}

export function recentDiffusionLiteratureHistory(
  records: DiffusionLibraryRecord[],
  limit = 5,
): DiffusionLiteratureHistory[] {
  const rows = Array.isArray(records) ? records : []
  const grouped = new Map<number, DiffusionLiteratureHistory>()
  rows.forEach((record, index) => {
    const literatureId = diffusionLiteratureId(record)
    if (!Number.isFinite(literatureId) || literatureId <= 0) return

    const literature = record.literature || {}
    const existing = grouped.get(literatureId)
    const fallbackTimestamp = rows.length - index
    const timestamp = diffusionRecordTimestamp(record, fallbackTimestamp)
    const title = String(record.literatureTitle || record.literature_title || literature.title || '').trim()
    const doi = String(record.literatureDoi || record.literature_doi || literature.doi || '').trim()

    grouped.set(literatureId, {
      literatureId,
      title: existing?.title || title || `Literature ${literatureId}`,
      doi: existing?.doi || doi,
      recordCount: (existing?.recordCount || 0) + 1,
      timestamp: Math.max(existing?.timestamp ?? Number.NEGATIVE_INFINITY, timestamp),
    })
  })

  return [...grouped.values()]
    .sort((left, right) => {
      if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp
      return right.literatureId - left.literatureId
    })
    .slice(0, Math.max(0, limit))
}
