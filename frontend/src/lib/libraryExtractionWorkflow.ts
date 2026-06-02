import type { ExtractorType } from './api'

export type ExtractTemplateKey = 'conductivity' | 'diffusion' | 'lubrication'
export type ExtractionProgressStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'no_data' | 'failed' | 'cancelled'

export type ExtractionProgressLike = {
  paperId: number
  status?: ExtractionProgressStatus | string | null
  candidateCount?: number | null
  finalCount?: number | null
}

export type LibraryExtractionPaperLike = {
  id: number
  recordCount?: number | null
  candidateCount?: number | null
  tribologyRecordCount?: number | null
  tribologyCandidateCount?: number | null
  diffusionRecordCount?: number | null
  diffusionCandidateCount?: number | null
}

export type ExtractionRunCountLike = {
  final_count?: number | null
  candidate_count?: number | null
  summary?: {
    final_count?: number | null
    candidate_count?: number | null
    weak_candidate_count?: number | null
  } | null
}

export function extractorTypesForTemplate(template: ExtractTemplateKey): ExtractorType[] {
  if (template === 'lubrication') return ['tribology']
  if (template === 'diffusion') return ['diffusion']
  return []
}

export function isTerminalExtractionStatus(status?: string | null) {
  return ['completed', 'no_data', 'failed', 'cancelled'].includes(String(status || '').toLowerCase())
}

export function runReviewableCounts(run: ExtractionRunCountLike) {
  const finalCount = Math.max(
    Number(run.final_count || 0),
    Number(run.summary?.final_count || 0),
  )
  const candidateCount = Math.max(
    Number(run.candidate_count || 0),
    Number(run.summary?.candidate_count || 0),
    Number(run.summary?.weak_candidate_count || 0),
  )
  return {
    finalCount,
    candidateCount,
    reviewableCount: finalCount + candidateCount,
  }
}

function recordsForTemplate(paper: LibraryExtractionPaperLike, template: ExtractTemplateKey) {
  if (template === 'lubrication') {
    return Number(paper.tribologyRecordCount ?? paper.recordCount ?? 0)
      + Number(paper.tribologyCandidateCount ?? paper.candidateCount ?? 0)
  }
  if (template === 'diffusion') {
    return Number(paper.diffusionRecordCount ?? 0)
      + Number(paper.diffusionCandidateCount ?? 0)
  }
  return 0
}

export function extractionSaveStatus({
  selectedCount,
  selectedTemplate,
  runningExtraction,
  progressItems,
  selectedPapers,
}: {
  selectedCount: number
  selectedTemplate: ExtractTemplateKey
  runningExtraction: boolean
  progressItems: ExtractionProgressLike[]
  selectedPapers: LibraryExtractionPaperLike[]
}) {
  if (selectedCount <= 0) {
    return { canSave: false, message: 'Select at least one paper before saving an extraction table.' }
  }
  if (selectedTemplate === 'conductivity') {
    return { canSave: false, message: 'Conductivity extraction is not connected yet. Choose Lubrication or Diffusion.' }
  }
  if (runningExtraction || progressItems.some((item) => !isTerminalExtractionStatus(item.status))) {
    return { canSave: false, message: 'Extraction is still running. Wait for it to finish before opening Database.' }
  }
  if (progressItems.some((item) => (
    String(item.status || '').toLowerCase() === 'completed'
    && (Number(item.finalCount || 0) > 0 || Number(item.candidateCount || 0) > 0)
  ))) {
    return { canSave: true, message: 'Extraction table saved. Opening Database.' }
  }
  if (selectedPapers.some((paper) => recordsForTemplate(paper, selectedTemplate) > 0)) {
    return { canSave: true, message: 'Extraction table saved. Opening Database.' }
  }
  if (progressItems.length > 0 && progressItems.every((item) => isTerminalExtractionStatus(item.status))) {
    if (progressItems.every((item) => String(item.status || '').toLowerCase() === 'failed')) {
      return { canSave: false, message: 'Extraction failed before records were created. Retry extraction before opening Database.' }
    }
    return { canSave: false, message: 'Extraction finished with no records. Adjust the template or review the paper evidence before saving.' }
  }
  return { canSave: false, message: 'Run extraction and wait for records before opening Database.' }
}

export function nextPollFailureState(
  currentFailureCount: number,
  expectedExtractors: ExtractorType[],
  maxFailures: number,
) {
  const failureCount = Math.max(0, Number(currentFailureCount || 0)) + 1
  const label = expectedExtractors.length > 1 ? 'extraction status checks' : 'extraction status check'
  if (failureCount >= maxFailures) {
    return {
      failureCount,
      shouldFail: true,
      message: `${label.charAt(0).toUpperCase()}${label.slice(1)} failed repeatedly. The run was released so you can retry.`,
    }
  }
  return {
    failureCount,
    shouldFail: false,
    message: `${label.charAt(0).toUpperCase()}${label.slice(1)} failed, retrying...`,
  }
}

export function nextActivePollState(
  currentActiveCount: number,
  maxActivePolls: number,
) {
  const activeCount = Math.max(0, Number(currentActiveCount || 0)) + 1
  return {
    activeCount,
    shouldRelease: activeCount >= maxActivePolls,
    message: 'Background worker did not finish in time. The run was released so you can retry.',
  }
}

export type UploadQueueFileLike = {
  name: string
  size?: number
  lastModified?: number
}

export type UploadBatchResult = {
  fileName: string
  success: boolean
  error?: string | null
}

function uploadFileKey(file: UploadQueueFileLike | string) {
  return typeof file === 'string' ? file : `${file.name}:${file.size ?? ''}:${file.lastModified ?? ''}`
}

function uploadFailureMessage(result: UploadBatchResult) {
  const reason = String(result.error || 'Upload failed').trim()
  return `${result.fileName} - ${reason}`
}

export function summarizeUploadBatch<T extends UploadQueueFileLike>(
  queuedFiles: T[],
  results: UploadBatchResult[],
) {
  const resultByName = new Map(results.map((result) => [result.fileName, result]))
  const successfulNames = new Set(results.filter((result) => result.success).map((result) => result.fileName))
  const successfulKeys = new Set(
    queuedFiles
      .filter((file) => successfulNames.has(file.name))
      .map((file) => uploadFileKey(file)),
  )
  const retryFiles = queuedFiles.filter((file) => !successfulKeys.has(uploadFileKey(file)))
  const failures = queuedFiles
    .map((file) => resultByName.get(file.name))
    .filter((result): result is UploadBatchResult => Boolean(result && !result.success))

  const successCount = results.filter((result) => result.success).length
  const failCount = failures.length
  const failureDetails = failures.map(uploadFailureMessage)
  const message = failCount > 0
    ? `${successCount} uploaded, ${failCount} failed: ${failureDetails.join('; ')}`
    : `${successCount} uploaded.`

  return {
    successCount,
    failCount,
    retryFiles,
    failures,
    message,
  }
}
