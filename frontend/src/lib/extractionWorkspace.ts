import type {
  BatchFile,
  ExtractionResponse,
  ExtractorType,
  TribologyData,
} from '@/lib/api'

export type WorkspaceTranslator = (key: any, params?: Record<string, string | number>) => string

export type UploadInitialStateResponse = {
  file_id: string
  filename: string
  status?: string | null
  extractor_type?: ExtractorType | string | null
}

export function deriveValidationStatus(reviewStatus?: string | null): TribologyData['validationStatus'] {
  const normalized = String(reviewStatus || '').trim().toLowerCase()
  if (normalized === 'approved') return 'verified'
  if (normalized === 'flagged' || normalized === 'needs_evidence') return 'warning'
  return 'unverified'
}

export function hasExtractionWarnings(records: TribologyData[], extractorType: ExtractorType = 'tribology'): boolean {
  const hasLowConfidence = records.some((record) => {
    const confidence = Number(record.confidence ?? record.confidence_details?.score ?? record.confidenceDetails?.score)
    return Number.isFinite(confidence) && confidence < 0.8
  })
  if (hasLowConfidence) return true

  if (extractorType === 'diffusion') {
    return records.some((record) => {
      const hasCoefficient = [record.D_total, record.D_cation, record.D_anion].some((value) => value !== null && value !== undefined)
      return !record.system_name || !record.ionic_liquid || !hasCoefficient
    })
  }
  return records.some((record) => !record.cof || record.cof === '-' || record.cof === 'null')
}

export function setFileProcessing(batchFile: BatchFile | undefined, progress: number, message: string) {
  if (!batchFile) return
  batchFile.status = 'processing'
  batchFile.progress = Math.min(96, Math.max(batchFile.progress || 0, progress))
  batchFile.progressMessage = message
  batchFile.errorMessage = undefined
}

export function setFileUploadProgress(batchFile: BatchFile | undefined, percent: number | null | undefined, t: WorkspaceTranslator) {
  if (!batchFile) return
  const currentStatus = String(batchFile.status || '').toLowerCase()
  const isUploadPlaceholder = String(batchFile.id || '').startsWith('uploading-')
  if (currentStatus && currentStatus !== 'uploading' && !isUploadPlaceholder) {
    return
  }
  const normalizedPercent = Number(percent)
  const hasPercent = Number.isFinite(normalizedPercent)
  const boundedPercent = hasPercent ? Math.max(0, Math.min(100, Math.round(normalizedPercent))) : null
  batchFile.status = 'uploading'
  batchFile.progress = boundedPercent == null
    ? Math.max(batchFile.progress || 0, 10)
    : Math.max(batchFile.progress || 0, Math.min(88, 6 + Math.round(boundedPercent * 0.82)))
  batchFile.progressMessage = boundedPercent != null && boundedPercent >= 100
    ? t('progress.upload_server_processing')
    : t('progress.uploading_percent', { percent: boundedPercent ?? Math.round(batchFile.progress || 0) })
  batchFile.errorMessage = undefined
}

export function setFileError(batchFile: BatchFile | undefined, message: string, t: WorkspaceTranslator) {
  if (!batchFile) return
  batchFile.status = 'error'
  batchFile.progress = 0
  batchFile.progressMessage = t('progress.needs_review')
  batchFile.errorMessage = message
}

export function setFileSuccess(batchFile: BatchFile | undefined, message: string) {
  if (!batchFile) return
  batchFile.status = 'success'
  batchFile.progress = 100
  batchFile.progressMessage = message
  batchFile.errorMessage = undefined
}

export function setFileNoData(batchFile: BatchFile | undefined, message: string) {
  if (!batchFile) return
  batchFile.status = 'no_data'
  batchFile.progress = 100
  batchFile.progressMessage = message
  batchFile.errorMessage = message
}

export function setFileCancelled(batchFile: BatchFile | undefined, message: string = 'Extraction stopped.') {
  if (!batchFile) return
  batchFile.status = 'cancelled'
  batchFile.progress = Math.max(0, Math.round(batchFile.progress || 0))
  batchFile.progressMessage = message
  batchFile.errorMessage = message
}

export function createUploadPlaceholder(
  file: File,
  context: {
    extractorType: ExtractorType
    scopeKey?: string
    t: WorkspaceTranslator
  },
): BatchFile {
  return {
    id: `uploading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    scopeKey: context.scopeKey,
    extractor_type: context.extractorType,
    status: 'uploading',
    progress: 6,
    progressMessage: context.t('progress.uploading_file', { name: file.name }),
    records: [],
    hasWarnings: false,
    disablePdfPreview: true,
  }
}

export function replaceBatchFileId(batchFile: BatchFile, nextId: string) {
  const previousId = batchFile.id
  batchFile.id = nextId
  batchFile.disablePdfPreview = false
  return previousId
}

export function uploadErrorMessage(error: any, t: WorkspaceTranslator) {
  const status = Number(error?.response?.status || 0)
  if (status === 413) {
    return t('progress.upload_too_large')
  }
  const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message
  return t('progress.upload_failed', { message: detail || 'Unknown error' })
}

function resolveExtractorType(value: unknown, fallback: ExtractorType = 'tribology'): ExtractorType {
  return value === 'diffusion' || value === 'tribology' ? value : fallback
}

function normalizeMetadata(value: unknown): BatchFile['metadata'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const title = String(raw.title || '').trim()
  const authors = String(raw.authors || '').trim()
  const doi = String(raw.doi || '').trim()
  const journal = String(raw.journal || '').trim()
  const yearCandidate = Number(raw.year)
  const normalizedYear = Number.isFinite(yearCandidate) && yearCandidate > 0
    ? Math.round(yearCandidate)
    : new Date().getFullYear()
  const optionalText = (field: unknown) => {
    const normalized = String(field || '').trim()
    return normalized || null
  }

  return {
    title,
    authors,
    doi,
    journal,
    year: normalizedYear,
    issn: optionalText(raw.issn),
    volume: optionalText(raw.volume),
    issue: optionalText(raw.issue),
    pages: optionalText(raw.pages),
  }
}

function parseFieldEvidenceMap(value: unknown) {
  if (!value) return undefined
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return typeof value === 'object' ? value as TribologyData['field_evidence_json'] : undefined
}

function parseSourceBbox(value: unknown) {
  if (Array.isArray(value)) return value as number[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed as number[] : null
    } catch {
      return null
    }
  }
  return null
}

export function normalizeExtractionPayload(fileId: string, response: ExtractionResponse) {
  const metadata = normalizeMetadata(response.metadata)
  const extractorType = resolveExtractorType(response.extractor_type || response.extraction_summary?.extractor_type)
  const rawRecords = Array.isArray(response.data) ? response.data : []
  const records = rawRecords.map((record: any, index: number) => ({
    ...record,
    id: record.id || `${fileId}-${index}-${Date.now()}`,
    fileId,
    extractor_type: record.extractor_type || extractorType,
    cof_extracted: record.cof_extracted || record.cofExtracted || null,
    load_conditions: record.load_conditions || record.loadConditions || null,
    tribological_system: record.tribological_system || record.tribologicalSystem || null,
    lubricant_components: record.lubricant_components || record.lubricantComponents || [],
    lubricant_alias: record.lubricant_alias || record.lubricantAlias || null,
    ionic_liquid_display: record.ionic_liquid_display || record.ionicLiquidDisplay || null,
    lubricant_tooltip: record.lubricant_tooltip || record.lubricantTooltip || null,
    review_entity_type: record.review_entity_type || record.reviewEntityType || 'candidate',
    field_evidence_json: parseFieldEvidenceMap(record.field_evidence_json),
    source_bbox: parseSourceBbox(record.source_bbox),
    confidence: Number.isFinite(Number(record.confidence ?? record.confidence_details?.score ?? record.confidenceDetails?.score))
      ? Number(record.confidence ?? record.confidence_details?.score ?? record.confidenceDetails?.score)
      : null,
    confidence_details: record.confidence_details || record.confidenceDetails || null,
    confidenceDetails: record.confidenceDetails || record.confidence_details || null,
    validationStatus: record.validationStatus || deriveValidationStatus(record.review_status),
  }))

  return {
    metadata,
    records,
    extractorType,
  }
}

export function isNoDataResponse(response: ExtractionResponse, recordCount: number) {
  const status = String(response.status || '').toLowerCase()
  return status === 'no_data'
    || (status !== 'processing' && !!response.success && recordCount === 0)
}

export function buildInitialFileState(
  response: UploadInitialStateResponse,
  context: {
    defaultExtractorType: ExtractorType
    scopeKey?: string
    t: WorkspaceTranslator
  },
): BatchFile {
  const normalizedStatus = String(response.status || '').toLowerCase()
  const alreadyExtracted = ['completed', 'no_data'].includes(normalizedStatus)
  const alreadyRunning = ['processing', 'running', 'extracting'].includes(normalizedStatus)
  const failed = ['failed', 'error'].includes(normalizedStatus)
  const cancelled = normalizedStatus === 'cancelled'
  return {
    id: response.file_id,
    name: response.filename,
    scopeKey: context.scopeKey,
    extractor_type: resolveExtractorType(response.extractor_type, context.defaultExtractorType),
    status: normalizedStatus === 'no_data'
      ? 'no_data'
      : alreadyExtracted
        ? 'success'
        : alreadyRunning
          ? 'processing'
          : failed
            ? 'error'
            : cancelled
              ? 'cancelled'
              : 'uploaded',
    progress: alreadyExtracted ? 100 : alreadyRunning ? 18 : failed ? 0 : 0,
    progressMessage: normalizedStatus === 'no_data'
      ? 'No extractable records found.'
      : alreadyRunning
        ? context.t('progress.agent_running')
        : failed
          ? context.t('progress.needs_review')
          : (alreadyExtracted ? context.t('progress.already_extracted_ready') : context.t('progress.ready_to_extract')),
    records: [],
    hasWarnings: false,
  }
}

export function resetFileForExtractorChange(file: BatchFile, extractorType: ExtractorType, t: WorkspaceTranslator) {
  const previousExtractorType = file.extractor_type || 'tribology'
  if (previousExtractorType === extractorType) return false

  file.extractor_type = extractorType
  if (!['success', 'no_data', 'error', 'cancelled'].includes(String(file.status || '').toLowerCase())) {
    return false
  }

  file.status = 'uploaded'
  file.progress = 0
  file.progressMessage = t('progress.ready_to_extract')
  file.errorMessage = undefined
  file.records = []
  file.hasWarnings = false
  return true
}
