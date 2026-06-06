<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CloudUpload,
  Clock3,
  Database,
  FileText,
  Github,
  HelpCircle,
  Loader2,
  PanelTop,
  Sparkles,
  Upload,
  X,
} from 'lucide-vue-next'

import AppSidebar from '@/components/AppSidebar.vue'
import type { HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useAppShell } from '@/composables/useAppShell'
import { useI18n } from '@/composables/useI18n'
import {
  cancelExtraction,
  extractData,
  getData,
  getExtractionRunCandidates,
  getLatestExtractionRun,
  getLiteratureDetails,
  getPdfHighlights,
  uploadFile,
  type BatchFile,
  type ExtractionProfile,
  type ExtractionRunDetail,
  type ExtractionSummary,
  type ExtractorType,
  type LiteratureMetadata,
  type TribologyData,
  type UploadProgressSnapshot,
  type ValidationStatus,
} from '@/lib/api'
import { resolveCandidatePublishTarget } from '@/lib/extractionPublish'
import { buildPdfUploadExtractionItems } from '@/lib/extractionWorkspace'
import { lazyComponent } from '@/lib/lazyComponent'
import type { AppSection, AppView } from '@/lib/platform'
import type { HighlightRect } from '@/types/pdf-highlight'

type FileUploadBridge = {
  setUploading: (value: boolean) => void
}
type ChatPanelBridge = {
  addMessage: (role: 'user' | 'assistant', message: string) => void
}
type UploadExtractionPreset = 'tribology' | 'diffusion' | 'conductivity'
type UploadedPdfPaper = LiteratureMetadata & {
  id: string
  uploadStatus?: string
  recordCount?: number
  candidateCount?: number
  cachedRecordCount?: number
  cacheHit?: boolean
  cachedExtractorType?: ExtractorType | string | null
}

const AdminPage = lazyComponent(() => import('@/pages/admin/AdminPage.vue'))
const BlogView = lazyComponent(() => import('@/components/BlogView.vue'))
const DatabaseToolModal = lazyComponent(() => import('@/components/DatabaseToolModal.vue'))
const HomePage = lazyComponent(() => import('@/pages/home/HomePage.vue'))
const KnowledgePage = lazyComponent(() => import('@/pages/knowledge/KnowledgePage.vue'))
const LibraryPage = lazyComponent(() => import('@/pages/library/LibraryPage.vue'))
const ModelingPage = lazyComponent(() => import('@/pages/modeling/ModelingPage.vue'))
const QualityMetricsPage = lazyComponent(() => import('@/pages/quality/QualityMetricsPage.vue'))
const SourceGroundingView = lazyComponent(() => import('@/components/SourceGroundingView.vue'))

const ADMIN_ROLES = new Set(['principal_investigator', 'group_admin'])

const statusLabelKeys = {
  cancelled: 'status.cancelled',
  completed: 'status.completed',
  error: 'status.error',
  failed: 'status.failed',
  idle: 'status.idle',
  no_data: 'status.no_data',
  processing: 'status.processing',
  running: 'status.running',
} as const


const fileUploadRef = ref<FileUploadBridge>()
const chatPanelRef = ref<ChatPanelBridge>()

const focusedRecordId = ref<number | null>(null)
const { isChinese, t } = useI18n()

type EvidenceTarget = {
  literatureId?: number | null
  recordId?: number | null
  mode?: 'training-blockers' | 'grounding' | null
}

const {
  activeExtractionFileName,
  activeExtractionRun,
  availableScopes,
  batchFiles,
  currentSection,
  currentView,
  explorerDoi,
  handleExtract,
  isDark,
  latestAgentWorkflow,
  navigateTo,
  openTrainingWorkbench,
  preferredTrainingDatasetId,
  selectedFileId,
  selectedScopeKey,
  sessionState,
  toggleDarkMode,
} = useAppShell(fileUploadRef, chatPanelRef)

const canAccessAdmin = computed(() => ADMIN_ROLES.has(String(sessionState.user?.role || '')))
const isBlogView = computed(() => currentView.value === 'blog')
const elicitShellViews = ['home', 'library']
const chromeHiddenViews = ['home', 'library']
type ElicitTopNavItem = {
  label: string
  icon: Component
  view?: AppView
  section?: AppSection
  modal?: 'upload' | 'database'
}

const elicitTopNavItems: ElicitTopNavItem[] = [
  { label: 'Home', icon: Clock3, view: 'home', section: 'today' },
  { label: 'Extract', icon: Upload, modal: 'upload' },
  { label: 'Database', icon: Database, modal: 'database' },
  { label: 'Library', icon: BookOpen, view: 'library', section: 'explorer' },
]

const viewTitle = computed(() => {
  if (isChinese.value) {
    const labels: Record<AppView, string> = {
      admin: '管理',
      blog: '内容',
      home: '检索与工作台',
      knowledge: '知识库',
      library: '文献库',
      modeling: '建模',
      pipeline: '抽取',
      quality: '质量',
    }
    return labels[currentView.value] || currentView.value
  }

  const labels: Record<AppView, string> = {
    admin: 'Admin',
    blog: 'Content',
    home: 'Search & Home',
    knowledge: 'Knowledge',
    library: 'Library',
    modeling: 'Modeling',
    pipeline: 'Extract',
    quality: 'Quality',
  }
  return labels[currentView.value] || formatLabel(currentView.value)
})

const viewSubtitle = computed(() => {
  if (isChinese.value) {
    const labels: Record<AppView, string> = {
      admin: '权限、运行和系统配置',
      blog: '内容与文档中心',
      home: '智能文献检索、抽取与分析助手',
      knowledge: '分类数据资产与来源追踪',
      library: '课题组已录入文献、提取状态及数据特征总览',
      modeling: '特征工程与建模准备',
      pipeline: '上传、抽取、结果表和异常处理',
      quality: '数据质量、缺失和异常监控',
    }
    return labels[currentView.value] || '科研数据工作台'
  }

  const labels: Record<AppView, string> = {
    admin: 'Permissions, runtime, and system setup',
    blog: 'Content and documentation center',
    home: 'AI-powered literature search, extraction, and synthesis',
    knowledge: 'Structured data assets and source traceability',
    library: 'Literature repository, extraction status, and key parameters',
    modeling: 'Feature engineering and modeling preparation',
    pipeline: 'Upload, extract, inspect tables, and resolve issues',
    quality: 'Data quality, missing fields, and anomaly monitoring',
  }
  return labels[currentView.value] || 'Research data workspace'
})

const operatorName = computed(() => sessionState.user?.displayName || t('common.operator_default'))
const databaseToolOpen = ref(false)
type DatabaseToolFocus = {
  fileId: string
  doi: string
  dataset: 'tribology' | 'diffusion'
  recordId: number | null
  entityType: 'record' | 'candidate' | null
}
type DatabaseOpenTarget = {
  fileId?: string | number | null
  doi?: string | null
  dataset?: 'tribology' | 'diffusion' | null
  recordId?: number | null
  entityType?: 'record' | 'candidate' | null
}
const databaseToolFocus = ref<DatabaseToolFocus | null>(null)
const sourceGroundingOpen = ref(false)
const sourceGroundingFileId = ref<string | null>(null)
const sourceGroundingHighlights = ref<HighlightRect[]>([])
const sourceGroundingLoading = ref(false)
const sourceGroundingError = ref('')
const sourceGroundingPdfUrl = computed(() => sourceGroundingFileId.value ? `/api/pdf/${sourceGroundingFileId.value}` : '')
const pdfUploadModalOpen = ref(false)
const pdfUploadInputRef = ref<HTMLInputElement | null>(null)
const pdfUploadDragging = ref(false)
const pdfUploadUploading = ref(false)
const pdfUploadStatusMessage = ref('')
const queuedPdfUploadFiles = ref<File[]>([])
const pdfUploadUploadProgress = ref<Record<string, UploadProgressSnapshot>>({})
const pdfUploadUploadErrors = ref<Record<string, string>>({})
const pdfUploadModalStep = ref<'upload' | 'select' | 'setup' | 'extracting'>('upload')
const PDF_UPLOAD_EXTRACTION_PROFILE: ExtractionProfile = 'auto'
const selectedPdfUploadFileIds = ref<string[]>([])
const uploadedPdfPapers = ref<UploadedPdfPaper[]>([])
const uploadedPdfPaperExtractionPresets = ref<Record<string, UploadExtractionPreset>>({})
const pdfUploadPendingFileNames = ref<string[]>([])
const pdfUploadBatchTotal = ref(0)
const pdfUploadBatchFinished = ref(0)
type PdfUploadExtractionStatus = 'queued' | 'extracting' | 'completed' | 'no_data' | 'failed' | 'cancelled'
type PdfUploadExtractionItem = LiteratureMetadata & {
  id: string
  status: PdfUploadExtractionStatus
  message: string
  records: number
  extractedRows: TribologyData[]
  resultLoading?: boolean
  resultError?: string
  progress: number
}
const pdfUploadExtractionItems = ref<PdfUploadExtractionItem[]>([])
const pdfUploadExtracting = ref(false)
const pdfUploadExtractionAbortRequested = ref(false)
const pdfUploadExtractionCancelling = ref(false)
const pdfUploadExtractionRunToken = ref(0)
const PDF_UPLOAD_CANCEL_TIMEOUT_MS = 8000
const PDF_UPLOAD_STALLED_HEARTBEAT_MS = 10 * 60 * 1000
const selectedPdfUploadResultPaperId = ref<string | null>(null)
const pdfUploadCompletedExtractionItems = computed(() =>
  pdfUploadExtractionItems.value.filter((item) => item.status === 'completed' && item.records > 0),
)
const pdfUploadRecoverableExtractionItems = computed(() =>
  pdfUploadExtractionItems.value.filter((item) => ['no_data', 'failed', 'cancelled'].includes(item.status)),
)
const pdfUploadRecoverableSummaryLabel = computed(() => {
  const count = pdfUploadRecoverableExtractionItems.value.length
  if (count <= 0) return ''
  return `${count} paper${count === 1 ? '' : 's'} need retry or a new upload.`
})
const selectedPdfUploadResultItem = computed(() => {
  return pdfUploadCompletedExtractionItems.value.find((item) => item.id === selectedPdfUploadResultPaperId.value)
    || pdfUploadCompletedExtractionItems.value[0]
    || null
})
const pdfUploadExtractionProgress = computed(() => {
  if (pdfUploadExtractionItems.value.length === 0) return 0
  const totalProgress = pdfUploadExtractionItems.value.reduce((sum, item) => sum + pdfUploadItemProgress(item), 0)
  return Math.round(totalProgress / pdfUploadExtractionItems.value.length)
})
const pdfUploadBatchProgressPercent = computed(() => {
  if (pdfUploadBatchTotal.value <= 0) return 0
  return Math.min(100, Math.round((pdfUploadBatchFinished.value / pdfUploadBatchTotal.value) * 100))
})
const shouldShowPdfUploadBatchProgress = computed(() => pdfUploadBatchTotal.value > 1 && (pdfUploadModalStep.value === 'select' || pdfUploadUploading.value))
const pdfUploadFailedUploadEntries = computed(() =>
  queuedPdfUploadFiles.value
    .map((file) => ({ key: pdfUploadFileKey(file), name: file.name, error: pdfUploadUploadErrors.value[pdfUploadFileKey(file)] }))
    .filter((entry) => Boolean(entry.error)),
)
const pdfUploadHasQueuedFiles = computed(() => queuedPdfUploadFiles.value.length > 0)
const pdfUploadCanContinueFromUpload = computed(() =>
  uploadedPdfPapers.value.length > 0 && !pdfUploadHasQueuedFiles.value,
)

function clampPdfUploadProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function pdfUploadFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function friendlyPdfUploadExtractionMessage(message?: string | null, stage?: string | null) {
  const rawMessage = String(message || '').trim()
  const normalizedStage = String(stage || '').trim().toLowerCase()
  const normalizedMessage = rawMessage.toLowerCase()
  const rowMatch = rawMessage.match(/(?:prepared|extracted)\s+(\d+)\s+(?:candidate\s+)?(?:table\s+)?row/i)
  const rowCount = rowMatch ? Number(rowMatch[1]) : null

  if (normalizedStage.startsWith('stage_a')) return 'Starting the extraction job.'
  if (normalizedStage.startsWith('stage_b.fast_table_prepare')) return 'Reading the paper text and figure captions.'
  if (normalizedStage.startsWith('stage_b.fast_table_figures')) return 'Checking figure pages that may contain chart values.'
  if (normalizedStage.startsWith('stage_c.fast_table_submit')) return 'Building the extraction table from the paper.'
  if (normalizedStage.startsWith('stage_c.fast_table_wait')) return 'Still building the data table. Larger PDFs can take a little longer.'
  if (normalizedStage.startsWith('stage_c.fast_table_parse')) return 'Reading the extracted table rows.'
  if (normalizedStage.startsWith('stage_d.fast_table_clean')) return 'Cleaning units and separating probe, coating, and substrate.'
  if (normalizedStage.startsWith('stage_e.fast_table_ready')) {
    return rowCount == null ? 'Candidate rows are ready for Database review.' : `${rowCount} candidate row${rowCount === 1 ? '' : 's'} ready for Database review.`
  }
  if (normalizedStage.startsWith('stage_e')) return rawMessage || 'Saving cleaned records for Database review.'

  if (/sending\s+document\s+to|claude|gpt|gemini|model/i.test(rawMessage)) {
    return rowCount == null ? 'Building the extraction table from the paper.' : `${rowCount} candidate row${rowCount === 1 ? '' : 's'} ready for Database review.`
  }
  if (/^(rows|chunk)=/i.test(rawMessage) || normalizedMessage.includes('raw_candidates=')) {
    return 'Extracting and checking table rows.'
  }
  return rawMessage
    .replace(/\s*progress_step=\d+\s*/gi, '')
    .trim()
}

function updatePdfUploadUploadProgress(file: File, progress: UploadProgressSnapshot) {
  const percent = progress.percent == null ? null : clampPdfUploadProgress(progress.percent)
  pdfUploadUploadProgress.value = {
    ...pdfUploadUploadProgress.value,
    [pdfUploadFileKey(file)]: { ...progress, percent },
  }
}

function pdfUploadUploadErrorMessage(error: unknown) {
  const err = error as any
  const detail = err?.response?.data?.detail
    || err?.response?.data?.error
    || err?.response?.data?.message
    || err?.message
  return String(detail || 'Upload failed before metadata could be parsed.')
}

function pdfUploadItemProgress(item: Pick<PdfUploadExtractionItem, 'status' | 'progress'>) {
  if (['completed', 'no_data', 'failed', 'cancelled'].includes(item.status)) return 100
  if (item.status === 'queued') return Math.max(4, clampPdfUploadProgress(item.progress || 0))
  if (item.status === 'extracting') return Math.max(12, clampPdfUploadProgress(item.progress || 0))
  return clampPdfUploadProgress(item.progress || 0)
}

function nextPdfUploadExtractionRunToken() {
  pdfUploadExtractionRunToken.value += 1
  return pdfUploadExtractionRunToken.value
}

function isCurrentPdfUploadExtractionRun(runToken: number) {
  return pdfUploadExtractionRunToken.value === runToken
}

const pdfUploadExtractionPresetOptions: Array<{ value: UploadExtractionPreset, label: string, description: string, disabled?: boolean }> = [
  { value: 'tribology', label: 'Lubrication', description: 'Friction, COF, wear, surfaces' },
  { value: 'diffusion', label: 'Diffusion', description: 'Diffusion coefficients and confined transport' },
  { value: 'conductivity', label: 'Conductivity', description: 'Conductivity, EIS, transference number (coming soon)', disabled: true },
]

const pdfUploadVisibleExtractionPresetOptions = computed(() =>
  pdfUploadExtractionPresetOptions.filter((option) => option.value !== 'conductivity'),
)

const pdfUploadStepLabels = ['Add papers', 'Choose mode', 'Extracting']

// Single source of truth for which modal step(s) each progress label represents,
// so the indicator's active state isn't duplicated across two template bindings.
const pdfUploadStepLabelStates: Record<string, readonly string[]> = {
  'Add papers': ['upload'],
  'Choose mode': ['select', 'setup'],
  Extracting: ['extracting'],
}

function isPdfUploadStepActive(label: string): boolean {
  return (pdfUploadStepLabelStates[label] ?? []).includes(pdfUploadModalStep.value)
}

const pdfUploadModalTitle = computed(() => 'Extract papers')

const pdfUploadModalSubtitle = computed(() => {
  if (pdfUploadModalStep.value === 'upload') return 'Add PDFs to start an extraction run.'
  if (pdfUploadModalStep.value === 'select' || pdfUploadModalStep.value === 'setup') return 'Choose what to extract from each paper.'
  if (pdfUploadModalStep.value === 'extracting') return 'Reading papers, preparing rows for review.'
  return 'Open the extracted rows in Database.'
})

function uploadedPdfPaperText(paper: LiteratureMetadata & { id?: string }) {
  return [
    paper.title,
    paper.authors,
    paper.journal,
    paper.doi,
    paper.year,
  ].join(' ').toLowerCase()
}

function inferPdfUploadExtractionPreset(paper: LiteratureMetadata & { id?: string }): UploadExtractionPreset {
  const text = uploadedPdfPaperText(paper)
  if (/\bdiffus|diffusiv|transport|dynamics|molecular dynamics|confinement|confined|porous|nanochannel|separation|permeation|membrane|co2\/ch4|co2\/n2/.test(text)) {
    return 'diffusion'
  }
  return 'tribology'
}

function presetForPdfUploadedPaper(paper: LiteratureMetadata & { id: string }): UploadExtractionPreset {
  return uploadedPdfPaperExtractionPresets.value[paper.id] || inferPdfUploadExtractionPreset(paper)
}

function isCachedPdfUploadPaper(paper: UploadedPdfPaper) {
  const selectedExtractor = extractorForPdfUploadPreset(presetForPdfUploadedPaper(paper))
  const cachedExtractor = String(paper.cachedExtractorType || '').trim().toLowerCase()
  return String(paper.uploadStatus || '').toLowerCase() === 'completed'
    && Boolean(selectedExtractor)
    && cachedExtractor === selectedExtractor
    && (Boolean(paper.cacheHit) || Number(paper.cachedRecordCount || 0) > 0)
}

function extractorForPdfUploadPreset(preset: UploadExtractionPreset): ExtractorType | null {
  if (preset === 'diffusion') return 'diffusion'
  if (preset === 'tribology') return 'tribology'
  return null
}

const pdfUploadSelectionHasUnsupportedPreset = computed(() =>
  papersSelectedForPdfUploadExtraction().some((paper) => !extractorForPdfUploadPreset(presetForPdfUploadedPaper(paper))),
)

function setPdfUploadedPaperExtractionPreset(paperId: string, event: Event | UploadExtractionPreset) {
  const preset = typeof event === 'string'
    ? event
    : String((event.target as HTMLSelectElement | null)?.value || 'tribology')
  if (!['tribology', 'diffusion', 'conductivity'].includes(preset)) return
  const option = pdfUploadExtractionPresetOptions.find((item) => item.value === preset)
  if (option?.disabled) return
  uploadedPdfPaperExtractionPresets.value = {
    ...uploadedPdfPaperExtractionPresets.value,
    [paperId]: preset as UploadExtractionPreset,
  }
}

function pdfUploadPresetLabel(preset: UploadExtractionPreset) {
  return pdfUploadExtractionPresetOptions.find((option) => option.value === preset)?.label || 'Lubrication'
}

function metadataFromUploadFallback(file: File, response: Awaited<ReturnType<typeof uploadFile>>): UploadedPdfPaper {
  const baseName = file.name.replace(/\.pdf$/i, '')
  const match = baseName.match(/^(\d{4})-([^-]+)-(.+)$/)
  const parsedTitle = match?.[3]?.trim() || baseName
  const responseTitle = String(response.metadata?.title || response.filename || '').trim()
  const title = responseTitle && !responseTitle.toLowerCase().endsWith('.pdf') ? responseTitle : parsedTitle
  const authors = response.metadata?.authors || (match?.[2]?.trim() || '')
  return {
    id: String(response.metadata?.id || response.file_id || `${file.name}-${file.lastModified}`),
    title,
    authors,
    doi: response.metadata?.doi || '',
    journal: response.metadata?.journal || '',
    year: Number(response.metadata?.year || match?.[1] || 0),
    volume: response.metadata?.volume,
    issue: response.metadata?.issue,
    pages: response.metadata?.pages,
    issn: response.metadata?.issn,
    uploadStatus: response.status,
    recordCount: Number(response.record_count || 0),
    candidateCount: Number(response.candidate_count || 0),
    cachedRecordCount: Number(response.cached_record_count || 0),
    cacheHit: Boolean(response.cache_hit),
    cachedExtractorType: response.extractor_type || response.metadata?.extractor_type || 'tribology',
  }
}
const activeScopeLabel = computed(() => {
  return availableScopes.value.find((scope) => scope.key === selectedScopeKey.value)?.label || t('common.no_active_scope')
})
const selectedFile = computed(() => batchFiles.value.find((file) => file.id === selectedFileId.value) || null)
const selectedFileName = computed(() => selectedFile.value?.name || t('common.no_file_selected'))
const runStateLabel = computed(() => {
  if (String(activeExtractionRun.value?.status || '').toLowerCase() === 'no_data') {
    return 'NO DATA / No extractable records found'
  }
  return formatMappedLabel(String(activeExtractionRun.value?.status || 'idle'), statusLabelKeys)
})
const latestFailedFile = computed(() => [...batchFiles.value].reverse().find((file) => file.status === 'error') || null)
const latestReviewFile = computed(() => {
  return [...batchFiles.value].reverse().find((file) => file.status === 'success' && file.hasWarnings)
    || [...batchFiles.value].reverse().find((file) => file.status === 'success')
    || null
})

function formatLabel(value: string) {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function formatMappedLabel(value: string, map: Record<string, Parameters<typeof t>[0]>) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized && map[normalized] ? t(map[normalized]) : formatLabel(value)
}

function handleSectionChange(section: string) {
  navigateTo(currentView.value, section as AppSection)
}

function setSelectedFile(fileId: string | null) {
  selectedFileId.value = fileId
}

function clearExplorerDoi() {
  explorerDoi.value = ''
}

function parseRecordBbox(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const coords = value.map((item) => Number(item))
    return coords.length >= 4 && coords.every((item) => Number.isFinite(item)) ? coords : null
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseRecordBbox(JSON.parse(value))
    } catch {
      return null
    }
  }
  return null
}

function parseFieldEvidence(value: unknown): TribologyData['field_evidence_json'] {
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

function validationStatusFromReviewStatus(reviewStatus: unknown): ValidationStatus {
  const normalized = String(reviewStatus || '').trim().toLowerCase()
  if (normalized === 'approved') return 'verified'
  if (normalized === 'flagged' || normalized === 'needs_evidence') return 'warning'
  return 'unverified'
}

function normalizeReviewRecord(record: any): TribologyData {
  const cofValue = record.cof ?? record.cofRaw ?? record.cof_raw ?? record.cofValue
  const confidence = Number(record.confidence ?? record.confidence_details?.score ?? record.confidenceDetails?.score)
  return {
    id: String(record.id || ''),
    extractor_type: record.extractor_type || 'tribology',
    material_name: record.material_name ?? record.materialName ?? '',
    ionic_liquid: record.ionic_liquid ?? record.lubricant ?? '',
    lubricant_components: record.lubricant_components ?? record.lubricantComponents ?? [],
    lubricant_alias: record.lubricant_alias ?? record.lubricantAlias ?? null,
    ionic_liquid_display: record.ionic_liquid_display ?? record.ionicLiquidDisplay ?? null,
    lubricant_tooltip: record.lubricant_tooltip ?? record.lubricantTooltip ?? null,
    load: record.load ?? record.loadRaw ?? record.load_raw ?? record.loadValue ?? '',
    load_conditions: record.load_conditions ?? record.loadConditions ?? null,
    speed: record.speed ?? record.speedValue ?? record.speed_value ?? '',
    speed_conditions: record.speed_conditions ?? record.speedConditions ?? null,
    shear_rate: record.shear_rate ?? record.shearRate ?? '',
    temperature: record.temperature ?? '',
    potential: record.potential ?? '',
    water_content: record.water_content ?? record.waterContent ?? '',
    cof: cofValue == null ? '' : String(cofValue),
    cof_extracted: record.cof_extracted ?? record.cofExtracted ?? null,
    probe_material: record.probe_material ?? record.probeMaterial ?? '',
    probe_geometry: record.probe_geometry ?? record.probeGeometry ?? '',
    probe_radius: record.probe_radius ?? record.probeRadius ?? '',
    probe_roughness: record.probe_roughness ?? record.probeRoughness ?? '',
    substrate_material: record.substrate_material ?? record.substrateMaterial ?? record.materialName ?? '',
    substrate_coating: record.substrate_coating ?? record.substrateCoating ?? '',
    substrate_roughness: record.substrate_roughness ?? record.substrateRoughness ?? '',
    surface_roughness: record.surface_roughness ?? record.surfaceRoughness ?? '',
    residual_film_thickness_d: record.residual_film_thickness_d ?? record.residualFilmThicknessD ?? '',
    layer_spacing_delta: record.layer_spacing_delta ?? record.layerSpacingDelta ?? '',
    film_thickness: record.film_thickness ?? record.filmThickness ?? '',
    regime: record.regime ?? '',
    tribological_system: record.tribological_system ?? record.tribologicalSystem ?? null,
    mol_ratio: record.mol_ratio ?? record.molRatio ?? '',
    cation: record.cation ?? '',
    anion: record.anion ?? '',
    cation_smiles: record.cation_smiles ?? record.cationSmiles ?? '',
    anion_smiles: record.anion_smiles ?? record.anionSmiles ?? '',
    il_smiles: record.il_smiles ?? record.ilSmiles ?? '',
    il_inchikey: record.il_inchikey ?? record.ilInchikey ?? '',
    alkyl_chain_length: record.alkyl_chain_length ?? record.alkylChainLength ?? undefined,
    source: record.source ?? '',
    source_page: record.source_page ?? record.sourcePage ?? record.evidencePage ?? undefined,
    source_bbox: parseRecordBbox(record.source_bbox ?? record.sourceBbox ?? record.evidenceBbox),
    source_figure: record.source_figure ?? record.sourceFigure ?? '',
    evidence: record.evidence ?? '',
    sample_id: record.sample_id ?? record.sampleId ?? '',
    series_id: record.series_id ?? record.seriesId ?? '',
    field_evidence_json: parseFieldEvidence(record.field_evidence_json ?? record.fieldEvidenceJson),
    review_status: record.review_status ?? record.reviewStatus ?? '',
    record_origin: record.record_origin ?? record.recordOrigin ?? 'knowledge_record',
    review_entity_type: record.review_entity_type ?? record.reviewEntityType ?? 'record',
    entity_type: record.entity_type ?? record.entityType ?? record.review_entity_type ?? record.reviewEntityType ?? 'record',
    entityType: record.entityType ?? record.entity_type ?? record.reviewEntityType ?? record.review_entity_type ?? 'record',
    entity_id: record.entity_id ?? record.entityId ?? record.id ?? null,
    entityId: record.entityId ?? record.entity_id ?? record.id ?? null,
    assembly_notes: record.assembly_notes ?? record.assemblyNotes ?? '',
    confidence: Number.isFinite(confidence) ? confidence : null,
    confidence_details: record.confidence_details ?? record.confidenceDetails ?? null,
    confidenceDetails: record.confidenceDetails ?? record.confidence_details ?? null,
    system_name: record.system_name ?? record.systemName ?? '',
    confinement_material_class: record.confinement_material_class ?? record.confinementMaterialClass ?? '',
    confinement_geometry_class: record.confinement_geometry_class ?? record.confinementGeometryClass ?? '',
    surface_functional_groups: record.surface_functional_groups ?? record.surfaceFunctionalGroups ?? '',
    confinement_dimensionality: record.confinement_dimensionality ?? record.confinementDimensionality ?? '',
    D_total: record.D_total ?? record.d_total ?? record.dTotal ?? null,
    D_cation: record.D_cation ?? record.d_cation ?? record.dCation ?? null,
    D_anion: record.D_anion ?? record.d_anion ?? record.dAnion ?? null,
    D_unit: record.D_unit ?? record.d_unit ?? record.dUnit ?? '',
    temperature_value: record.temperature_value ?? record.temperatureValue ?? null,
    confinement_scale_value: record.confinement_scale_value ?? record.confinementScaleValue ?? null,
    confinement_scale_unit: record.confinement_scale_unit ?? record.confinementScaleUnit ?? '',
    diffusion_standard_fields: record.diffusion_standard_fields ?? record.diffusionStandardFields ?? {},
    diffusionStandardFields: record.diffusionStandardFields ?? record.diffusion_standard_fields ?? {},
    diffusion_normalization: record.diffusion_normalization ?? record.diffusionNormalization ?? {},
    diffusionNormalization: record.diffusionNormalization ?? record.diffusion_normalization ?? {},
    smiles: record.smiles ?? '',
    novel_features_json: record.novel_features_json ?? record.novelFeaturesJson ?? {},
    rdkit_features_json: record.rdkit_features_json ?? record.rdkitFeaturesJson ?? {},
    validationStatus: validationStatusFromReviewStatus(record.review_status ?? record.reviewStatus),
  }
}

const REVIEW_ROUTE_TERMINAL_STATUSES = new Set(['no_data', 'failed', 'error', 'cancelled'])

function runMessage(run: ExtractionRunDetail | null | undefined) {
  const summary = (run?.summary || {}) as Record<string, any>
  return String(
    summary.no_data_reason
      || summary.current_message
      || run?.error_message
      || '',
  ).trim()
}

function fileStatusFromTerminalRun(status: string): BatchFile['status'] | null {
  if (status === 'no_data' || status === 'cancelled') return status
  if (status === 'failed' || status === 'error') return 'error'
  return null
}

async function fetchLatestRunForReview(literatureId: number, extractorType: ExtractorType) {
  try {
    return await getLatestExtractionRun(literatureId, extractorType)
  } catch {
    return null
  }
}

async function ensureEvidenceFileForTarget(target: EvidenceTarget) {
  const literatureId = Number(target.literatureId || 0)
  if (!Number.isFinite(literatureId) || literatureId <= 0) return
  const existingIndex = batchFiles.value.findIndex((file) => String(file.id) === String(literatureId))
  const targetRecordId = target.recordId ? String(target.recordId) : ''
  if (existingIndex >= 0 && targetRecordId) {
    const existingFile = batchFiles.value[existingIndex]
    const hasTargetFinalRecord = existingFile?.records.some((record) => {
      const entityType = String(record.review_entity_type || '').trim().toLowerCase()
      return String(record.id || '') === targetRecordId && entityType === 'record'
    })
    if (hasTargetFinalRecord) return
  } else if (existingIndex >= 0) {
    const existingFile = batchFiles.value[existingIndex]
    if (existingFile && existingFile.records.length > 0) return
  }

  try {
    const details = await getLiteratureDetails(literatureId)
    const diffusionRows = Array.isArray((details as any).diffusionData) ? (details as any).diffusionData : []
    const tribologyRows = Array.isArray(details.tribologyData) ? details.tribologyData : []
    const rows = diffusionRows.length ? diffusionRows : tribologyRows
    const records: TribologyData[] = rows.map(normalizeReviewRecord)
    const latestDiffusionRun = diffusionRows.length || tribologyRows.length
      ? null
      : await fetchLatestRunForReview(literatureId, 'diffusion')
    const latestRunStatus = String(latestDiffusionRun?.status || '').trim().toLowerCase()
    const hasDiffusionHistory = diffusionRows.length > 0
      || Number(details.diffusionRecordCount || 0) > 0
      || Number(details.diffusionCandidateCount || 0) > 0
      || Boolean(latestDiffusionRun && latestRunStatus !== 'not_started')
    const extractorType = (hasDiffusionHistory ? 'diffusion' : (records[0]?.extractor_type || 'tribology')) as 'tribology' | 'diffusion'
    const latestTerminalStatus = REVIEW_ROUTE_TERMINAL_STATUSES.has(latestRunStatus)
      ? fileStatusFromTerminalRun(latestRunStatus)
      : null
    const emptyStatus = records.length
      ? 'success'
      : (latestTerminalStatus || (String(details.status || '').trim().toLowerCase() === 'no_data' ? 'no_data' : 'success'))
    const noDataMessage = extractorType === 'diffusion'
      ? runMessage(latestDiffusionRun) || details.errorMessage || '未找到带有明确数值和单位、可直接入库的扩散系数记录。'
      : details.errorMessage || '未找到可直接入库的提取记录。'
    const batchFile: BatchFile = {
      id: String(literatureId),
      name: details.title || details.doi || `Literature ${literatureId}`,
      status: emptyStatus as BatchFile['status'],
      progress: 100,
      progressMessage: emptyStatus === 'no_data' ? noDataMessage : 'Loaded from literature library',
      extractor_type: extractorType,
      metadata: {
        title: details.title || '',
        authors: details.authors || '',
        doi: details.doi || '',
        journal: details.journal || '',
        year: details.year || new Date().getFullYear(),
        volume: details.volume || null,
        issue: details.issue || null,
        pages: details.pages || null,
      },
      submissionStatus: details.submissionStatus || 'draft',
      submissionNote: details.submissionNote || null,
      submittedAt: details.submittedAt || null,
      reviewNote: details.reviewNote || null,
      reviewedAt: details.reviewedAt || null,
      promotedLiteratureId: details.promotedLiteratureId || null,
      records,
      errorMessage: emptyStatus === 'no_data' ? noDataMessage : undefined,
      hasWarnings: records.some((record) => record.validationStatus !== 'verified'),
      disablePdfPreview: details.hasPdf === false,
    }
    if (existingIndex >= 0) {
      batchFiles.value.splice(existingIndex, 1, batchFile)
    } else {
      batchFiles.value.push(batchFile)
    }
  } catch (error) {
    console.warn('[Review] Failed to hydrate literature for review target:', error)
  }
}

async function loadSourceGroundingHighlights(fileId: string) {
  sourceGroundingLoading.value = true
  sourceGroundingError.value = ''
  sourceGroundingHighlights.value = []
  try {
    const highlights = await getPdfHighlights(fileId)
    sourceGroundingHighlights.value = highlights
      .filter((highlight) => highlight.w > 0 && highlight.h > 0)
      .map((highlight) => ({
	        id: highlight.id,
	        page: highlight.page,
	        matchedText: highlight.matched_text,
	        coords: { x: highlight.x, y: highlight.y, w: highlight.w, h: highlight.h },
	      }))
  } catch (error: any) {
    sourceGroundingError.value = String(error?.response?.data?.detail || error?.message || 'Unable to load source grounding highlights')
  } finally {
    sourceGroundingLoading.value = false
  }
}

async function openSourceGroundingTarget(target?: EvidenceTarget) {
  const literatureId = Number(target?.literatureId || selectedFileId.value || 0)
  if (!Number.isFinite(literatureId) || literatureId <= 0) return
  await ensureEvidenceFileForTarget({ literatureId, recordId: target?.recordId ?? null })
  selectedFileId.value = String(literatureId)
  sourceGroundingFileId.value = String(literatureId)
  sourceGroundingOpen.value = true
  void loadSourceGroundingHighlights(String(literatureId))
}

function closeSourceGrounding() {
  sourceGroundingOpen.value = false
}

async function retryLatestFailedRun() {
  const failedFile = latestFailedFile.value
  if (!failedFile) {
    navigateTo('library', 'explorer')
    return
  }

  selectedFileId.value = failedFile.id
  navigateTo('library', 'explorer')
  await handleExtract(failedFile.id, true)
}

function openReviewQueue() {
  databaseToolFocus.value = {
    fileId: '',
    doi: '',
    dataset: 'tribology',
    recordId: null,
    entityType: 'candidate',
  }
  databaseToolOpen.value = true
}

function openDatasetBuilder() {
  navigateTo('knowledge', 'datasets')
}

function openDatabaseTool() {
  databaseToolFocus.value = null
  databaseToolOpen.value = true
}

function clearDatabaseToolFocusedRecord() {
  if (!databaseToolFocus.value) return
  databaseToolFocus.value = {
    ...databaseToolFocus.value,
    recordId: null,
    entityType: null,
  }
}

function openLibraryExtractionDatabase(payload?: DatabaseOpenTarget) {
  const fileId = payload?.fileId ? String(payload.fileId) : ''
  if (!fileId) {
    openDatabaseTool()
    return
  }
  selectedFileId.value = fileId
  explorerDoi.value = payload?.doi || ''
  databaseToolFocus.value = {
    fileId,
    doi: payload?.doi || '',
    dataset: payload?.dataset === 'diffusion' ? 'diffusion' : 'tribology',
    recordId: payload?.recordId ?? null,
    entityType: payload?.entityType ?? null,
  }
  databaseToolOpen.value = true
}

function openPdfUploadModal() {
  if (pdfUploadExtracting.value || activePdfUploadExtractionItems().length > 0) {
    pdfUploadDragging.value = false
    pdfUploadModalStep.value = 'extracting'
    pdfUploadModalOpen.value = true
    return
  }
  resetPdfUploadForFreshUpload()
  pdfUploadModalOpen.value = true
}

function resetPdfUploadForFreshUpload() {
  nextPdfUploadExtractionRunToken()
  pdfUploadDragging.value = false
  pdfUploadStatusMessage.value = ''
  queuedPdfUploadFiles.value = []
  pdfUploadModalStep.value = 'upload'
  uploadedPdfPapers.value = []
  uploadedPdfPaperExtractionPresets.value = {}
  selectedPdfUploadFileIds.value = []
  pdfUploadExtractionItems.value = []
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  selectedPdfUploadResultPaperId.value = null
  pdfUploadPendingFileNames.value = []
  pdfUploadBatchTotal.value = 0
  pdfUploadBatchFinished.value = 0
  pdfUploadUploadProgress.value = {}
  pdfUploadUploadErrors.value = {}
}

function closePdfUploadModal() {
  if (pdfUploadUploading.value) return
  if (pdfUploadExtracting.value) {
    pdfUploadModalOpen.value = false
    pdfUploadDragging.value = false
    return
  }
  pdfUploadModalOpen.value = false
  resetPdfUploadForFreshUpload()
}

function choosePdfUploadFiles() {
  pdfUploadInputRef.value?.click()
}

function continueFromPdfUploadModal() {
  if (pdfUploadUploading.value || pdfUploadExtracting.value) return
  if (pdfUploadHasQueuedFiles.value) {
    pdfUploadStatusMessage.value = 'Upload queued PDFs before continuing, or remove them.'
    return
  }
  if (!pdfUploadCanContinueFromUpload.value) {
    pdfUploadStatusMessage.value = 'Add PDFs before continuing.'
    return
  }
  pdfUploadModalOpen.value = false
  pdfUploadDragging.value = false
  pdfUploadStatusMessage.value = ''
  queuedPdfUploadFiles.value = []
  pdfUploadUploadProgress.value = {}
  pdfUploadUploadErrors.value = {}
  pdfUploadModalStep.value = 'upload'
  uploadedPdfPaperExtractionPresets.value = {}
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  pdfUploadBatchTotal.value = 0
  pdfUploadBatchFinished.value = 0
  navigateTo('library', 'explorer')
}

async function hydratePdfUploadDiffusionRows(paper: LiteratureMetadata & { id: string }) {
  const details = await getLiteratureDetails(Number(paper.id))
  const detailRows = (Array.isArray(details.diffusionData) ? details.diffusionData : [])
    .map((row) => normalizeReviewRecord(row))
  if (detailRows.length > 0) return detailRows

  const latestRun = await getLatestExtractionRun(Number(paper.id), 'diffusion').catch(() => null)
  if (!latestRun?.run_id) return detailRows
  const candidates = await getExtractionRunCandidates(latestRun.run_id, 0, 500).catch(() => null)
  return (Array.isArray(candidates?.items) ? candidates.items : [])
    .map((item) => normalizeExtractionRunCandidate(item, 'diffusion'))
}

function normalizeExtractionRunCandidate(item: Awaited<ReturnType<typeof getExtractionRunCandidates>>['items'][number], extractorType: ExtractorType): TribologyData {
  return normalizeReviewRecord({
    ...(item.raw || {}),
    ...(item.normalized || {}),
    id: item.id,
    extractor_type: extractorType,
    review_entity_type: 'candidate',
    source_page: item.page,
    source_figure: item.source_figure,
  })
}

function openPdfUploadResultsInDatabase(item?: PdfUploadExtractionItem) {
  const target = item || selectedPdfUploadResultItem.value || pdfUploadCompletedExtractionItems.value[0]
  if (!target || target.status !== 'completed' || target.records <= 0) return
  selectedPdfUploadResultPaperId.value = target.id
  selectedFileId.value = target.id
  explorerDoi.value = target.doi || ''
  const focusTarget = pdfUploadDatabaseFocusTarget(target)
  databaseToolFocus.value = {
    fileId: target.id,
    doi: target.doi || '',
    dataset: pdfUploadDatabaseFocusDataset(target),
    recordId: focusTarget.recordId,
    entityType: focusTarget.entityType,
  }
  pdfUploadModalOpen.value = false
  pdfUploadDragging.value = false
  databaseToolOpen.value = true
}

async function openCompletedPdfUploadItemsInDatabase(completedItems: PdfUploadExtractionItem[]) {
  if (completedItems.length === 0) return
  selectedPdfUploadResultPaperId.value = completedItems[0]?.id || null
  await hydratePdfUploadExtractionRows(completedItems)
  const refreshedItems = completedItems
    .map((item) => pdfUploadExtractionItems.value.find((current) => current.id === item.id) || item)
    .filter((item) => item.status === 'completed' && item.records > 0)
  const target = refreshedItems.find((item) => pdfUploadDatabaseFocusTarget(item).entityType === 'candidate')
    || refreshedItems[0]
  if (target) openPdfUploadResultsInDatabase(target)
}

function pdfUploadDatabaseFocusTarget(item: PdfUploadExtractionItem): { recordId: number | null; entityType: 'record' | 'candidate' | null } {
  const extractorType = pdfUploadDatabaseFocusDataset(item)
  for (const row of item.extractedRows || []) {
    const target = resolveCandidatePublishTarget(row, extractorType)
    if (target?.entityType === 'candidate') return { recordId: target.entityId, entityType: 'candidate' }
  }
  for (const row of item.extractedRows || []) {
    const promotedRecordId = Number(row.promoted_record_id ?? row.promotedRecordId ?? 0)
    if (Number.isFinite(promotedRecordId) && promotedRecordId > 0) {
      return { recordId: promotedRecordId, entityType: 'record' }
    }
    const target = resolveCandidatePublishTarget(row, extractorType)
    if (target) return { recordId: target.entityId, entityType: target.entityType }
  }
  return { recordId: null, entityType: null }
}

function pdfUploadDatabaseFocusDataset(item: PdfUploadExtractionItem): 'tribology' | 'diffusion' {
  return presetForPdfUploadedPaper(item) === 'diffusion' ? 'diffusion' : 'tribology'
}

async function hydratePdfUploadExtractionRows(selected: Array<LiteratureMetadata & { id: string }>) {
  const completedIds = new Set(
    pdfUploadExtractionItems.value
      .filter((item) => item.status === 'completed' && item.records > 0)
      .map((item) => item.id),
  )
  await Promise.allSettled(selected.map(async (paper) => {
    if (!completedIds.has(paper.id)) return
    const existing = pdfUploadExtractionItems.value.find((item) => item.id === paper.id)
    if (existing?.extractedRows?.length) return
    updatePdfUploadExtractionItem(paper.id, {
      resultLoading: true,
      resultError: '',
    })
	    try {
	      const rows = presetForPdfUploadedPaper(paper) === 'diffusion'
	        ? await hydratePdfUploadDiffusionRows(paper)
	        : await getData(String(paper.id)) as TribologyData[]
	      updatePdfUploadExtractionItem(paper.id, {
	        extractedRows: Array.isArray(rows) ? rows : [],
        resultLoading: false,
        resultError: '',
      })
    } catch (error: any) {
      updatePdfUploadExtractionItem(paper.id, {
        resultLoading: false,
        resultError: error?.response?.data?.detail || error?.message || 'Result preview could not be loaded.',
      })
    }
  }))
}

function togglePdfUploadLibraryFile(id: string) {
  if (pdfUploadExtracting.value) return
  selectedPdfUploadFileIds.value = selectedPdfUploadFileIds.value.includes(id)
    ? selectedPdfUploadFileIds.value.filter((fileId) => fileId !== id)
    : [...selectedPdfUploadFileIds.value, id]
}

function updatePdfUploadExtractionItem(id: string, patch: Partial<PdfUploadExtractionItem>) {
  pdfUploadExtractionItems.value = pdfUploadExtractionItems.value.map((item) => (
    item.id === id ? { ...item, ...patch } : item
  ))
}

function activePdfUploadExtractionItems(selected?: UploadedPdfPaper[]) {
  const selectedIds = selected ? new Set(selected.map((paper) => paper.id)) : null
  return pdfUploadExtractionItems.value.filter((item) => (
    (!selectedIds || selectedIds.has(item.id)) && ['queued', 'extracting'].includes(item.status)
  ))
}

function markStalledPdfUploadExtractionItems(selected: UploadedPdfPaper[]) {
  activePdfUploadExtractionItems(selected).forEach((item) => updatePdfUploadExtractionItem(item.id, {
    status: 'failed',
    progress: Math.max(12, item.progress || 0),
    message: 'Background worker stopped sending progress updates. Retry or start a fresh run.',
  }))
}

function extractionRunActivitySignature(run: ExtractionRunDetail) {
  const summary = (run.summary || {}) as ExtractionSummary
  const progressLog = Array.isArray(run.progress_log) ? run.progress_log : []
  const latestProgress = progressLog.length ? progressLog[progressLog.length - 1] : null
  return [
    run.updated_at || run.created_at || '',
    run.status || '',
    run.candidate_count || 0,
    run.final_count || 0,
    summary.current_stage || latestProgress?.stage || '',
    summary.current_message || latestProgress?.message || '',
    progressLog.length,
  ].join('|')
}

async function cancelStalledPdfUploadExtractionItems(selected: UploadedPdfPaper[]) {
  const active = activePdfUploadExtractionItems(selected)
  if (!active.length) return
  await Promise.allSettled(active.map(async (item) => {
    const paper = selected.find((candidate) => candidate.id === item.id)
    const preset = paper ? presetForPdfUploadedPaper(paper) : inferPdfUploadExtractionPreset(item)
    const extractorType = extractorForPdfUploadPreset(preset)
    if (!extractorType) return
    await Promise.race([
      cancelExtraction(String(item.id), extractorType),
      new Promise((resolve) => {
        window.setTimeout(resolve, PDF_UPLOAD_CANCEL_TIMEOUT_MS)
      }),
    ])
  }))
}

function pdfUploadExtractionStatusLabel(status: PdfUploadExtractionStatus) {
  if (status === 'extracting') return 'Extracting'
  if (status === 'completed') return 'Ready for review'
  if (status === 'no_data') return 'No reviewable data found'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Stopped'
  return 'Queued'
}

const pdfUploadCancelTerminalReleaseStatuses = ['completed', 'no_data', 'failed', 'error', 'cancelled']

function pdfUploadCancelResultStatus(result: PromiseSettledResult<{ status?: string, success?: boolean }>) {
  if (result.status === 'rejected') return 'failed'
  if (result.value?.status) return result.value.status
  return result.value?.success === false ? 'failed' : 'cancelled'
}

function pdfUploadCancelResultSucceeded(result: PromiseSettledResult<{ status?: string, success?: boolean }>) {
  const status = pdfUploadCancelResultStatus(result)
  return status === 'timeout' || status === 'skipped' || pdfUploadCancelTerminalReleaseStatuses.includes(status)
}

function pdfUploadResultValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value).trim()
  return text && text.toLowerCase() !== 'not specified' && text.toLowerCase() !== 'n/a' ? text : ''
}

function pdfUploadHasWeakCandidates(rows: TribologyData[]) {
  return rows.some((row) => String(row.record_origin || '').trim().toLowerCase() === 'weak_candidate')
}

function isPdfUploadRunActiveStatus(status: string) {
  return ['queued', 'running', 'processing', 'extracting'].includes(status.toLowerCase())
}

function pdfUploadRunFinalCount(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary | undefined
  const finalCount = Number(run?.final_count || summary?.final_count || 0)
  const weakCandidateCount = Number(summary?.weak_candidate_count || 0)
  const candidateCount = Number(run?.candidate_count || summary?.candidate_count || 0)
  return finalCount + Math.max(weakCandidateCount, candidateCount)
}

function pdfUploadRunReviewableCount(run: ExtractionRunDetail | null | undefined, preset: UploadExtractionPreset) {
  const summary = run?.summary as ExtractionSummary & { diffusion_artifacts?: { reviewable_count?: number, candidate_count?: number, final_count?: number } } | undefined
  if (preset === 'diffusion') {
    const artifactCount = Number(summary?.diffusion_artifacts?.reviewable_count || 0)
    if (artifactCount > 0) return artifactCount
    return Number(run?.candidate_count || summary?.candidate_count || summary?.diffusion_artifacts?.candidate_count || 0)
      + Number(run?.final_count || summary?.final_count || summary?.diffusion_artifacts?.final_count || 0)
  }
  return pdfUploadRunFinalCount(run)
}

function pdfUploadInitialReviewableCount(
  initialResponse: Awaited<ReturnType<typeof extractData>>,
  preset: UploadExtractionPreset,
) {
  const rows = Array.isArray(initialResponse.data) ? initialResponse.data : []
  if (rows.length > 0) return rows.length
  const summary = initialResponse.extraction_summary as ExtractionSummary & { diffusion_artifacts?: { reviewable_count?: number, candidate_count?: number, final_count?: number } } | undefined
  if (preset === 'diffusion') {
    const artifactCount = Number(summary?.diffusion_artifacts?.reviewable_count || 0)
    if (artifactCount > 0) return artifactCount
    return Number(summary?.candidate_count || summary?.diffusion_artifacts?.candidate_count || 0)
      + Number(summary?.final_count || summary?.diffusion_artifacts?.final_count || 0)
  }
  return Number(summary?.final_count || 0) + Math.max(Number(summary?.weak_candidate_count || 0), Number(summary?.candidate_count || 0))
}

function pdfUploadRunHasReviewableData(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary & { diffusion_artifacts?: { reviewable_count?: number, candidate_count?: number, final_count?: number } } | undefined
  return Number(run?.candidate_count || summary?.candidate_count || summary?.diffusion_artifacts?.candidate_count || 0) > 0
    || Number(run?.final_count || summary?.final_count || summary?.diffusion_artifacts?.final_count || 0) > 0
    || Number(summary?.weak_candidate_count || 0) > 0
    || Number(summary?.diffusion_artifacts?.reviewable_count || 0) > 0
}

function pdfUploadRunMessage(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary | undefined
  const latestProgress = Array.isArray(run?.progress_log) && run.progress_log.length > 0
    ? run.progress_log[run.progress_log.length - 1]?.message
    : ''
  const latestStage = Array.isArray(run?.progress_log) && run.progress_log.length > 0
    ? run.progress_log[run.progress_log.length - 1]?.stage
    : ''
  const stage = String(summary?.current_stage || latestStage || '')
  const normalizedStatus = String(run?.status || '').toLowerCase()
  if (['no_data', 'completed'].includes(normalizedStatus) && !pdfUploadRunHasReviewableData(run)) {
    return friendlyPdfUploadExtractionMessage(String(
      summary?.no_data_reason
      || run?.error_message
      || latestProgress
      || summary?.current_message
      || '',
    ), stage)
  }
  return friendlyPdfUploadExtractionMessage(String(
    summary?.current_message
    || run?.error_message
    || latestProgress
    || summary?.no_data_reason
    || '',
  ), stage)
}

function pdfUploadStageProgress(stage?: string | null, status?: string | null, message?: string | null) {
  const normalizedStatus = String(status || '').toLowerCase()
  if (['completed', 'no_data', 'failed', 'error', 'cancelled'].includes(normalizedStatus)) return 100

  const normalizedStage = String(stage || '').trim().toLowerCase()
  const normalizedMessage = String(message || '')
  const chunkMatch = normalizedMessage.match(/chunk=(\d+)\/(\d+)/i)
  const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : 0
  const chunkTotal = chunkMatch ? Number(chunkMatch[2]) : 0

  if (!normalizedStage) return 8
  if (normalizedStage.startsWith('stage_a')) return 14
  if (normalizedStage.startsWith('stage_b.chunk') && chunkIndex > 0 && chunkTotal > 0) {
    return 28 + (chunkIndex / Math.max(1, chunkTotal)) * 34
  }
  if (normalizedStage.startsWith('stage_b.fast_table_prepare')) return 22
  if (normalizedStage.startsWith('stage_b.fast_table_figures')) return 34
  if (normalizedStage.startsWith('stage_b.fast_text')) return 24
  if (normalizedStage.startsWith('stage_b')) return 24
  if (normalizedStage.startsWith('stage_c.fast_text_start') && chunkIndex > 0 && chunkTotal > 0) {
    return 32 + ((chunkIndex - 1) / Math.max(1, chunkTotal)) * 42
  }
  if (normalizedStage.startsWith('stage_c.fast_text_done') && chunkIndex > 0 && chunkTotal > 0) {
    return 36 + (chunkIndex / Math.max(1, chunkTotal)) * 42
  }
  if (normalizedStage.startsWith('stage_c.fast_text_start')) return 36
  if (normalizedStage.startsWith('stage_c.fast_text_done')) return 78
  if (normalizedStage.startsWith('stage_c.fast_text')) return 52
  if (normalizedStage.startsWith('stage_c.fast_table_submit')) return 54
  if (normalizedStage.startsWith('stage_c.fast_table_wait')) {
    const waitMatch = normalizedMessage.match(/progress_step=(\d+)/i)
    const waitStep = waitMatch ? Number(waitMatch[1]) : 0
    return Math.min(72, 58 + waitStep * 4)
  }
  if (normalizedStage.startsWith('stage_c.fast_table_parse')) return 76
  if (normalizedStage.startsWith('stage_d.fast_table_clean')) return 86
  if (normalizedStage.startsWith('stage_e.fast_table_ready')) return 94
  if (normalizedStage.startsWith('stage_c.figure_retry')) return 50
  if (normalizedStage.startsWith('stage_c.figure')) return 44
  if (normalizedStage.startsWith('stage_c.text')) return 62
  if (normalizedStage.startsWith('fallback_table')) return 74
  if (normalizedStage.startsWith('stage_d')) return 84
  if (normalizedStage.startsWith('stage_e')) return 96
  return 18
}

function pdfUploadRunProgress(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary | undefined
  const progressLog = Array.isArray(run?.progress_log) ? run.progress_log : []
  const latestProgress = progressLog.length > 0 ? progressLog[progressLog.length - 1] : null
  const stage = String(summary?.current_stage || latestProgress?.stage || '')
  const message = String(summary?.current_message || latestProgress?.message || '')
  let progress = pdfUploadStageProgress(stage, run?.status, message)
  if ((run?.candidate_count || summary?.candidate_count || 0) > 0 && progress < 52) progress = 52
  if ((run?.final_count || summary?.final_count || 0) > 0 && progress < 94 && !['completed', 'no_data'].includes(String(run?.status || '').toLowerCase())) {
    progress = 94
  }
  return clampPdfUploadProgress(progress)
}

function pdfUploadInitialResponseProgress(initialResponse: Awaited<ReturnType<typeof extractData>>) {
  const summary = initialResponse.extraction_summary as ExtractionSummary | undefined
  const progressLog = Array.isArray(summary?.progress_log) ? summary.progress_log : []
  const latestProgress = progressLog.length > 0 ? progressLog[progressLog.length - 1] : null
  const status = String(initialResponse.status || '')
  return pdfUploadStageProgress(
    String(summary?.current_stage || latestProgress?.stage || ''),
    status,
    String(summary?.current_message || latestProgress?.message || initialResponse.message || ''),
  )
}

function isRetryablePdfUploadRunMessage(message?: string | null) {
  return String(message || '').includes('Previous extraction run stalled')
}

function waitForPdfUploadPollDelay(ms = 1400) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function refreshActivePdfUploadServerRuns(selected: UploadedPdfPaper[]) {
  let activeCount = 0
  await Promise.allSettled(selected.map(async (paper) => {
    const preset = presetForPdfUploadedPaper(paper)
    const extractorType = extractorForPdfUploadPreset(preset)
    if (!extractorType) return
    const run = await getLatestExtractionRun(Number(paper.id), extractorType)
    const runStatus = String(run.status || '').toLowerCase()
    if (!isPdfUploadRunActiveStatus(runStatus)) return
    activeCount += 1
    applyPdfUploadRun(paper.id, run, preset)
  }))
  return activeCount
}

function applyPdfUploadExtractionResponse(
  paperId: string,
  initialResponse: Awaited<ReturnType<typeof extractData>>,
  preset: UploadExtractionPreset,
) {
  const label = pdfUploadPresetLabel(preset)
  const initialStatus = String(initialResponse.status || '').toLowerCase()
  const initialRows = Array.isArray(initialResponse.data) ? initialResponse.data : []
  const initialRecords = pdfUploadInitialReviewableCount(initialResponse, preset)
  const summary = initialResponse.extraction_summary as ExtractionSummary | undefined
  const initialStage = String(summary?.current_stage || ((Array.isArray(summary?.progress_log) && summary.progress_log.length) ? summary.progress_log[summary.progress_log.length - 1]?.stage : '') || '')
  const initialMessage = friendlyPdfUploadExtractionMessage(initialResponse.message || String(summary?.current_message || ''), initialStage)
  if ((initialStatus === 'failed' || initialStatus === 'error') && isRetryablePdfUploadRunMessage(initialMessage)) {
    updatePdfUploadExtractionItem(paperId, {
      status: 'extracting',
      records: initialRecords,
      extractedRows: initialRows,
      progress: Math.max(10, pdfUploadInitialResponseProgress(initialResponse)),
      message: 'Fresh extraction run is being queued. Status check will continue...',
    })
    return
  }

  if (initialStatus === 'failed' || initialStatus === 'error') {
    updatePdfUploadExtractionItem(paperId, {
      status: 'failed',
      records: initialRecords,
      extractedRows: initialRows,
      progress: 100,
      message: initialMessage || `Extraction ended with status: ${initialStatus}.`,
    })
    return
  }

  if (isPdfUploadRunActiveStatus(initialStatus)) {
    updatePdfUploadExtractionItem(paperId, {
      status: 'extracting',
      records: initialRecords,
      extractedRows: initialRows,
      progress: pdfUploadInitialResponseProgress(initialResponse),
      message: initialMessage || `${label} extraction queued. Waiting for the background worker.`,
    })
    return
  }

  const initialHasNoReviewableData = initialRecords === 0 && (initialStatus === 'no_data' || initialStatus === 'completed')
  updatePdfUploadExtractionItem(paperId, {
    status: initialHasNoReviewableData ? 'no_data' : 'completed',
    records: initialRecords,
    extractedRows: initialRows,
    progress: 100,
	    message: initialRecords > 0
	      ? (preset === 'diffusion' || pdfUploadHasWeakCandidates(initialRows) ? `${initialRecords} candidates need review.` : `${initialRecords} ${label} records extracted.`)
	      : (friendlyPdfUploadExtractionMessage(summary?.no_data_reason || initialResponse.message, initialStage) || `No extractable ${label.toLowerCase()} records found.`),
	  })
}

function applyPdfUploadRun(paperId: string, run: ExtractionRunDetail, preset: UploadExtractionPreset) {
  const label = pdfUploadPresetLabel(preset)
  const runStatus = String(run.status || '').toLowerCase()
  const records = pdfUploadRunReviewableCount(run, preset)
  const message = pdfUploadRunMessage(run)

  if (isPdfUploadRunActiveStatus(runStatus)) {
    updatePdfUploadExtractionItem(paperId, {
      status: 'extracting',
      records,
      progress: pdfUploadRunProgress(run),
      message: message || `${label} extraction is running...`,
    })
    return
  }

  if (runStatus === 'completed') {
    const needsReview = preset === 'diffusion' || String((run.summary as ExtractionSummary | undefined)?.review_status || '').toLowerCase() === 'needs_review'
    updatePdfUploadExtractionItem(paperId, {
      status: records > 0 ? 'completed' : 'no_data',
      records,
      progress: 100,
      message: records > 0
        ? (needsReview ? `${records} candidates need review.` : `${records} ${label} records extracted.`)
        : (message || `No extractable ${label.toLowerCase()} records found.`),
    })
    return
  }

  if (runStatus === 'no_data') {
    updatePdfUploadExtractionItem(paperId, {
      status: records > 0 ? 'completed' : 'no_data',
      records,
      progress: 100,
      message: records > 0
        ? `${records} candidates need review.`
        : (message || `No extractable ${label.toLowerCase()} records found.`),
    })
    return
  }

  if ((runStatus === 'failed' || runStatus === 'error') && isRetryablePdfUploadRunMessage(message)) {
    updatePdfUploadExtractionItem(paperId, {
      status: 'extracting',
      records,
      progress: Math.max(16, pdfUploadRunProgress(run)),
      message: 'Fresh extraction run is being queued. Status check will continue...',
    })
    return
  }

  updatePdfUploadExtractionItem(paperId, {
    status: 'failed',
    records,
    progress: 100,
    message: message || `Extraction ended with status: ${run.status || 'failed'}.`,
  })
}

function papersSelectedForPdfUploadExtraction() {
  return selectedPdfUploadFileIds.value.length
    ? uploadedPdfPapers.value.filter((paper) => selectedPdfUploadFileIds.value.includes(paper.id))
    : [...uploadedPdfPapers.value]
}

function openPdfUploadExtractionSetup() {
  if (uploadedPdfPapers.value.length === 0) return
  const selected = papersSelectedForPdfUploadExtraction()
  selectedPdfUploadFileIds.value = selected.map((paper) => paper.id)
  pdfUploadModalStep.value = 'setup'
}

function changePdfUploadExtractionType() {
  if (pdfUploadExtracting.value) return
  const recoverableIds = pdfUploadRecoverableExtractionItems.value.map((item) => item.id)
  if (recoverableIds.length > 0) selectedPdfUploadFileIds.value = recoverableIds
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  pdfUploadStatusMessage.value = 'Review the target table and start a fresh run.'
  pdfUploadModalStep.value = 'setup'
}

async function retryPdfUploadRecoverableExtraction() {
  if (pdfUploadExtracting.value) return
  const recoverableIds = pdfUploadRecoverableExtractionItems.value.map((item) => item.id)
  if (recoverableIds.length > 0) selectedPdfUploadFileIds.value = recoverableIds
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  pdfUploadStatusMessage.value = 'Retrying a fresh extraction run...'
  await startPdfUploadExtraction()
}

function uploadAnotherPdfAfterExtraction() {
  if (pdfUploadExtracting.value) return
  resetPdfUploadForFreshUpload()
  pdfUploadModalOpen.value = true
  pdfUploadStatusMessage.value = 'Add PDFs for a fresh extraction run.'
}

function pdfUploadFinishedCountFor(selected: Array<LiteratureMetadata & { id: string }>) {
  const selectedIds = new Set(selected.map((paper) => paper.id))
  return pdfUploadExtractionItems.value.filter((item) => (
    selectedIds.has(item.id) && ['completed', 'no_data', 'failed', 'cancelled'].includes(item.status)
  )).length
}

function pdfUploadExtractionLatestMessage(active: PdfUploadExtractionItem[]) {
  return active
    .map((item) => pdfUploadResultValue(item.message))
    .find((message) => (
      message
      && !/^queued\b/i.test(message)
      && !/^submitting\b/i.test(message)
      && !/^status check delayed/i.test(message)
    )) || ''
}

async function submitPdfUploadExtractionJobs(
  selected: UploadedPdfPaper[],
  runToken: number,
) {
  const results = await Promise.allSettled(selected.map(async (paper) => {
    if (!isCurrentPdfUploadExtractionRun(runToken)) return
    if (pdfUploadExtractionAbortRequested.value) {
      updatePdfUploadExtractionItem(paper.id, {
        status: 'cancelled',
        progress: 100,
        message: 'Extraction was stopped before this paper started.',
      })
      return
    }
    if (!isCurrentPdfUploadExtractionRun(runToken)) return
    updatePdfUploadExtractionItem(paper.id, { status: 'extracting',
      progress: 10,
      message: 'Submitting Smart extraction...',
    })
    const preset = presetForPdfUploadedPaper(paper)
    const extractorType = extractorForPdfUploadPreset(preset)
    if (!extractorType) {
      updatePdfUploadExtractionItem(paper.id, {
        status: 'failed',
        progress: 100,
        message: 'Conductivity extraction is not available yet. Choose Lubrication or Diffusion.',
      })
      return
    }

    try {
      const response = await extractData(String(paper.id), true, PDF_UPLOAD_EXTRACTION_PROFILE, undefined, extractorType)
      if (!isCurrentPdfUploadExtractionRun(runToken)) return
      if (pdfUploadExtractionAbortRequested.value) {
        updatePdfUploadExtractionItem(paper.id, {
          status: 'cancelled',
          progress: 100,
          message: 'Extraction was stopped by the user.',
        })
        return
      }
      applyPdfUploadExtractionResponse(paper.id, response, preset)
    } catch (error: any) {
      if (!isCurrentPdfUploadExtractionRun(runToken)) return
      if (pdfUploadExtractionAbortRequested.value) {
        updatePdfUploadExtractionItem(paper.id, {
          status: 'cancelled',
          progress: 100,
          message: 'Extraction was stopped by the user.',
        })
        return
      }
      const status = Number(error?.response?.status || 0)
      if (status === 502 || status === 503 || status === 504) {
        updatePdfUploadExtractionItem(paper.id, {
          status: 'extracting',
          progress: 12,
          message: 'Submission status unclear. Status check delayed, retrying...',
        })
        return
      }
      updatePdfUploadExtractionItem(paper.id, {
        status: 'failed',
        progress: 100,
        message: error?.response?.data?.detail || error?.message || 'Extraction failed to start.',
      })
      throw error
    }
  }))
  return results.filter((result) => result.status === 'rejected').length
}

async function trackPdfUploadExtractionRuns(selected: UploadedPdfPaper[], runToken: number) {
  const activityByPaper = new Map<string, { signature: string, lastActiveAt: number }>()
  while (true) {
    if (!isCurrentPdfUploadExtractionRun(runToken)) return
    if (pdfUploadExtractionAbortRequested.value) return
    const active = activePdfUploadExtractionItems(selected)
    const now = Date.now()
    active.forEach((item) => {
      if (!activityByPaper.has(item.id)) {
        activityByPaper.set(item.id, {
          signature: `${item.status}|${item.message}|${item.records}|${item.progress}`,
          lastActiveAt: now,
        })
      }
    })
    const finished = pdfUploadFinishedCountFor(selected)
    const latestMessage = pdfUploadExtractionLatestMessage(active)
    pdfUploadStatusMessage.value = active.length > 0
      ? `Smart extraction ${finished}/${selected.length} finished. ${active.length} still running...${latestMessage ? ` Latest: ${latestMessage}` : ''}`
      : `Extraction finished. ${finished}/${selected.length} papers processed.`

    if (active.length === 0) return
    await waitForPdfUploadPollDelay(1800)
    if (!isCurrentPdfUploadExtractionRun(runToken)) return
    if (pdfUploadExtractionAbortRequested.value) return

    await Promise.allSettled(active.map(async (item) => {
      if (!isCurrentPdfUploadExtractionRun(runToken)) return
      if (pdfUploadExtractionAbortRequested.value) return
      const paper = selected.find((candidate) => candidate.id === item.id)
      if (!paper) return
      const preset = presetForPdfUploadedPaper(paper)
      const extractorType = extractorForPdfUploadPreset(preset)
      if (!extractorType) return
      try {
        const run = await getLatestExtractionRun(Number(paper.id), extractorType)
        if (!isCurrentPdfUploadExtractionRun(runToken)) return
        const signature = extractionRunActivitySignature(run)
        const currentActivity = activityByPaper.get(paper.id)
        if (!currentActivity || currentActivity.signature !== signature) {
          activityByPaper.set(paper.id, { signature, lastActiveAt: Date.now() })
        }
        applyPdfUploadRun(paper.id, run, preset)
      } catch {
        if (!isCurrentPdfUploadExtractionRun(runToken)) return
        updatePdfUploadExtractionItem(paper.id, {
          status: 'extracting',
          progress: Math.max(12, item.progress || 0),
          message: 'Status check delayed, retrying...',
        })
      }
    }))

    const stalledIds = activePdfUploadExtractionItems(selected)
      .filter((item) => {
        const activity = activityByPaper.get(item.id)
        return Boolean(activity && Date.now() - activity.lastActiveAt > PDF_UPLOAD_STALLED_HEARTBEAT_MS)
      })
      .map((item) => item.id)
    if (stalledIds.length > 0) {
      const stalledSelected = selected.filter((paper) => stalledIds.includes(paper.id))
      pdfUploadStatusMessage.value = 'Some extraction runs stopped sending progress updates. Releasing those background jobs...'
      await cancelStalledPdfUploadExtractionItems(stalledSelected)
      markStalledPdfUploadExtractionItems(stalledSelected)
      pdfUploadStatusMessage.value = 'Only runs without recent progress updates were released. Active text-only runs with fresh heartbeats will keep polling.'
    }
  }
}

async function cancelPdfUploadExtraction() {
  if (!pdfUploadExtracting.value || pdfUploadExtractionCancelling.value) return
  pdfUploadExtractionAbortRequested.value = true
  pdfUploadExtractionCancelling.value = true
  pdfUploadStatusMessage.value = 'Stopping extraction and cancelling active background jobs...'
  const active = activePdfUploadExtractionItems()

  active.forEach((item) => updatePdfUploadExtractionItem(item.id, {
    status: 'extracting',
    progress: Math.max(12, item.progress || 0),
    message: 'Cancelling this extraction run...',
  }))

  const cancelResults = await Promise.allSettled(active.map(async (item) => {
    const paper = uploadedPdfPapers.value.find((candidate) => candidate.id === item.id)
    const preset = paper ? presetForPdfUploadedPaper(paper) : uploadedPdfPaperExtractionPresets.value[item.id] || inferPdfUploadExtractionPreset(item)
    const extractorType = extractorForPdfUploadPreset(preset)
    if (!extractorType) return { status: 'skipped' as const }
    return Promise.race([
      cancelExtraction(String(item.id), extractorType).then((response) => ({
        status: response?.success === false ? 'failed' as const : 'cancelled' as const,
        success: response?.success !== false,
      })),
      new Promise<{ status: 'timeout' }>((resolve) => {
        window.setTimeout(() => resolve({ status: 'timeout' }), PDF_UPLOAD_CANCEL_TIMEOUT_MS)
      }),
    ])
  }))

  const cancelTimedOut = cancelResults.some((result) => pdfUploadCancelResultStatus(result) === 'timeout')
  const cancelFailedCount = cancelResults.filter((result) => !pdfUploadCancelResultSucceeded(result)).length
  active.forEach((item, index) => {
    const result = cancelResults[index]
    const cancelSucceeded = result ? pdfUploadCancelResultSucceeded(result) : false
    const timedOut = result ? pdfUploadCancelResultStatus(result) === 'timeout' : false
    updatePdfUploadExtractionItem(item.id, {
      status: cancelSucceeded ? 'cancelled' : 'failed',
      progress: 100,
      message: !cancelSucceeded
        ? 'Stop request failed on the server. The worker may still be finishing; a fresh run will check the server first.'
        : timedOut
          ? 'Stop request timed out locally. A fresh run will first confirm the old worker is no longer active.'
          : 'Extraction was stopped by the user. Retry when ready.',
    })
  })
  pdfUploadExtracting.value = false
  pdfUploadExtractionCancelling.value = false
  pdfUploadStatusMessage.value = cancelFailedCount > 0
    ? `Stop request failed on ${cancelFailedCount} paper${cancelFailedCount === 1 ? '' : 's'}. A fresh run will check for active workers first.`
    : cancelTimedOut
    ? 'Stopping took too long locally. Before a fresh run starts, the server state will be checked again.'
    : 'Extraction stopped. You can retry or start a new upload.'
}

async function startPdfUploadExtraction() {
  if (pdfUploadExtracting.value || uploadedPdfPapers.value.length === 0) return
  const selected = papersSelectedForPdfUploadExtraction()
  if (selected.length === 0) return
  const activeServerCount = await refreshActivePdfUploadServerRuns(selected)
  if (activeServerCount > 0) {
    pdfUploadModalStep.value = 'extracting'
    pdfUploadExtracting.value = true
    pdfUploadExtractionAbortRequested.value = false
    pdfUploadExtractionCancelling.value = false
    const runToken = nextPdfUploadExtractionRunToken()
    pdfUploadStatusMessage.value = `${activeServerCount} previous extraction run${activeServerCount === 1 ? '' : 's'} still active on the server. Waiting for that worker before starting a fresh run.`
    await trackPdfUploadExtractionRuns(selected, runToken)
    if (isCurrentPdfUploadExtractionRun(runToken)) {
      pdfUploadExtracting.value = false
      pdfUploadExtractionCancelling.value = false
      pdfUploadStatusMessage.value = 'Previous extraction run finished. Start the fresh run when ready.'
    }
    return
  }
  const runToken = nextPdfUploadExtractionRunToken()

  selectedPdfUploadFileIds.value = selected.map((paper) => paper.id)
  pdfUploadModalStep.value = 'extracting'
  pdfUploadExtracting.value = true
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  pdfUploadStatusMessage.value = `Smart extraction 1 of ${selected.length} papers...`
  const cachedSelections = selected.filter(isCachedPdfUploadPaper)
  const uncachedSelections = selected.filter((paper) => !isCachedPdfUploadPaper(paper))
  pdfUploadExtractionItems.value = buildPdfUploadExtractionItems(selected, pdfUploadExtractionItems.value, {
    isCachedPaper: isCachedPdfUploadPaper,
  }) as PdfUploadExtractionItem[]
  if (cachedSelections.length > 0) {
    await hydratePdfUploadExtractionRows(cachedSelections)
  }

  let completed = 0
  let failed = 0
  if (uncachedSelections.length > 0) {
    failed = await submitPdfUploadExtractionJobs(uncachedSelections, runToken)
    await trackPdfUploadExtractionRuns(uncachedSelections, runToken)
  }
  if (!isCurrentPdfUploadExtractionRun(runToken)) return
  if (pdfUploadExtractionAbortRequested.value) {
    pdfUploadExtracting.value = false
    pdfUploadExtractionCancelling.value = false
    pdfUploadStatusMessage.value = 'Extraction stopped. You can retry or start a new upload.'
    return
  }
  completed = pdfUploadExtractionItems.value.filter((item) => selected.some((paper) => paper.id === item.id) && item.status === 'completed').length
  failed = pdfUploadExtractionItems.value.filter((item) => selected.some((paper) => paper.id === item.id) && item.status === 'failed').length
  const noData = pdfUploadExtractionItems.value.filter((item) => selected.some((paper) => paper.id === item.id) && item.status === 'no_data').length

  pdfUploadExtracting.value = false
  pdfUploadStatusMessage.value = `Extraction finished. ${completed} completed, ${noData} no data, ${failed} failed.`
  const selectedCompletedItems = pdfUploadExtractionItems.value.filter((item) => (
    selected.some((paper) => paper.id === item.id) && item.status === 'completed' && item.records > 0
  ))
  const completedItems = selectedCompletedItems.length > 0
    ? selectedCompletedItems
    : pdfUploadCompletedExtractionItems.value
  if (completedItems.length > 0) {
    await openCompletedPdfUploadItemsInDatabase(completedItems)
  }
}

function compactAuthorLine(authors?: string | null) {
  const tokens = String(authors || '')
    .split(/;|,(?=\s*(?:[A-Z]\.\s*){1,3}[A-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FFA-Za-z])/)
    .map((author) => author.trim())
    .filter(Boolean)
  if (tokens.length === 0) return 'Unknown author'
  return tokens.length > 1 ? `${tokens[0]} +${tokens.length - 1}` : tokens[0]
}

function queuePdfUploadFiles(fileList: FileList | File[] | null | undefined) {
  const files = Array.from(fileList || []).filter((file) => file && file.name)
  if (files.length === 0 || pdfUploadUploading.value) return
  const existing = new Set(queuedPdfUploadFiles.value.map((file) => pdfUploadFileKey(file)))
  queuedPdfUploadFiles.value = [
    ...queuedPdfUploadFiles.value,
    ...files.filter((file) => !existing.has(pdfUploadFileKey(file))),
  ]
  pdfUploadStatusMessage.value = ''
}

function removeQueuedPdfUploadFile(index: number) {
  if (pdfUploadUploading.value) return
  const removed = queuedPdfUploadFiles.value[index]
  queuedPdfUploadFiles.value = queuedPdfUploadFiles.value.filter((_, fileIndex) => fileIndex !== index)
  if (removed) {
    const fileKey = pdfUploadFileKey(removed)
    const { [fileKey]: _removedProgress, ...remainingProgress } = pdfUploadUploadProgress.value
    const { [fileKey]: _removedError, ...remainingErrors } = pdfUploadUploadErrors.value
    pdfUploadUploadProgress.value = remainingProgress
    pdfUploadUploadErrors.value = remainingErrors
  }
}

async function uploadQueuedPdfFiles() {
  const files = queuedPdfUploadFiles.value
  if (files.length === 0 || pdfUploadUploading.value) {
    pdfUploadStatusMessage.value = files.length === 0 ? 'Add PDFs before uploading.' : pdfUploadStatusMessage.value
    return
  }

  pdfUploadUploading.value = true
  pdfUploadModalStep.value = 'select'
  uploadedPdfPapers.value = []
  uploadedPdfPaperExtractionPresets.value = {}
  selectedPdfUploadFileIds.value = []
  pdfUploadPendingFileNames.value = files.map((file) => file.name)
  pdfUploadBatchTotal.value = files.length
  pdfUploadBatchFinished.value = 0
  pdfUploadUploadProgress.value = {}
  pdfUploadUploadErrors.value = {}
  pdfUploadStatusMessage.value = `Parsing metadata for ${files.length} file${files.length === 1 ? '' : 's'}...`
  let successCount = 0
  let failCount = 0
  const failedFileKeys = new Set<string>()

  for (const [index, file] of files.entries()) {
    const fileKey = pdfUploadFileKey(file)
    pdfUploadStatusMessage.value = `Parsing metadata ${index + 1} of ${files.length}...`
    try {
      const response = await uploadFile(file, 'tribology', (progress) => updatePdfUploadUploadProgress(file, progress))
      if (response?.success) {
        successCount += 1
        updatePdfUploadUploadProgress(file, { loaded: file.size, total: file.size || null, percent: 100 })
        const paper = metadataFromUploadFallback(file, response)
        uploadedPdfPapers.value = [...uploadedPdfPapers.value, paper]
        uploadedPdfPaperExtractionPresets.value = {
          ...uploadedPdfPaperExtractionPresets.value,
          [paper.id]: inferPdfUploadExtractionPreset(paper),
        }
        selectedPdfUploadFileIds.value = [...selectedPdfUploadFileIds.value, paper.id]
      } else {
        failCount += 1
        failedFileKeys.add(fileKey)
        pdfUploadUploadErrors.value = {
          ...pdfUploadUploadErrors.value,
          [fileKey]: pdfUploadUploadErrorMessage(response),
        }
      }
    } catch (error) {
      failCount += 1
      failedFileKeys.add(fileKey)
      pdfUploadUploadErrors.value = {
        ...pdfUploadUploadErrors.value,
        [fileKey]: pdfUploadUploadErrorMessage(error),
      }
    } finally {
      pdfUploadPendingFileNames.value = pdfUploadPendingFileNames.value.filter((name) => name !== file.name)
      pdfUploadBatchFinished.value = Math.min(pdfUploadBatchTotal.value, pdfUploadBatchFinished.value + 1)
    }
  }

  pdfUploadUploading.value = false
  pdfUploadStatusMessage.value = failCount > 0
    ? `${successCount} uploaded, ${failCount} failed.`
    : `${successCount} uploaded.`
  queuedPdfUploadFiles.value = queuedPdfUploadFiles.value.filter((file) => failedFileKeys.has(pdfUploadFileKey(file)))
}

function handlePdfUploadInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  queuePdfUploadFiles(input.files)
  input.value = ''
}

function handlePdfUploadDrop(event: DragEvent) {
  pdfUploadDragging.value = false
  queuePdfUploadFiles(event.dataTransfer?.files)
}

function openElicitTopNavItem(item: ElicitTopNavItem) {
  if (item.modal === 'upload') {
    openPdfUploadModal()
    return
  }
  if (item.modal === 'database') {
    openDatabaseTool()
    return
  }
  if (item.view) {
    navigateTo(item.view, item.section)
  }
}

function locateDatabaseLiterature(payload?: EvidenceTarget) {
  const literatureId = Number(payload?.literatureId || 0)
  if (payload?.mode === 'grounding') {
    databaseToolOpen.value = false
    void openSourceGroundingTarget({
      literatureId: Number.isFinite(literatureId) && literatureId > 0 ? literatureId : null,
      recordId: payload.recordId ?? null,
      mode: 'grounding',
    })
    return
  }
  if (Number.isFinite(literatureId) && literatureId > 0) {
    selectedFileId.value = String(literatureId)
  }
  databaseToolOpen.value = false
  navigateTo('library', 'explorer')
}

function handleHomeAction(action: HomeSuggestedAction) {
  switch (action.id) {
    case 'continue-review':
      void openSourceGroundingTarget({ literatureId: Number(latestReviewFile.value?.id || selectedFileId.value || 0) || null })
      return
    case 'retry-failed-run':
      void retryLatestFailedRun()
      return
    case 'open-review-queue':
      openReviewQueue()
      return
    case 'open-dataset-builder':
      openDatasetBuilder()
      return
    default: {
      if (action.actionType === 'route') {
        if (action.target === 'upload-pdfs') {
          openPdfUploadModal()
          return
        }
        if (action.target === 'database') {
          openDatabaseTool()
          return
        }
        if (action.target === 'review-evidence') {
          openReviewQueue()
          return
        }
        const [viewPart, sectionPart] = String(action.target || '').split('/', 2)
        const view = viewPart as AppView
        if (view) {
          navigateTo(view, sectionPart as AppSection | undefined)
        }
      }
    }
  }
}
</script>

<template>
  <div v-if="!sessionState.ready" class="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
    <div class="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 px-6 py-6 text-center shadow-sm">
      <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">IonicLink</p>
      <h1 class="mt-3 text-2xl font-semibold text-white">{{ t('loading.restore_title') }}</h1>
      <p class="mt-2 text-sm leading-6 text-slate-300">
        {{ t('loading.restore_description') }}
      </p>
    </div>
  </div>

  <BlogView
    v-else-if="isBlogView"
    :operator-name="operatorName"
    @exit="navigateTo('home', 'today')"
  />

  <div v-else class="app-shell flex h-screen overflow-hidden text-foreground">
    <a
      href="#app-main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950 focus:shadow-lg"
    >
      {{ isChinese ? '跳到主要内容' : 'Skip to main content' }}
    </a>
    <!-- Left sidebar -->
    <AppSidebar
      v-if="!chromeHiddenViews.includes(currentView)"
      :current-view="currentView"
      :batch-files="batchFiles"
      :selected-file-id="selectedFileId"
      :can-access-admin="canAccessAdmin"
      :operator-name="operatorName"
      operator-role="Extraction"
      :selected-scope-key="selectedScopeKey"
      :available-scopes="availableScopes"
      :is-dark="isDark"
      :is-chinese="isChinese"
      @navigate="navigateTo"
      @select-file="setSelectedFile"
      @toggle-dark="toggleDarkMode"
      @update:selected-scope-key="(key) => { selectedScopeKey = key }"
    />

    <!-- Right content column -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <template v-if="elicitShellViews.includes(currentView)">
        <div class="flex h-full min-h-0 flex-col overflow-hidden bg-white text-slate-950">
          <header class="flex h-16 shrink-0 items-center gap-6 border-b border-slate-100 bg-white px-5 sm:px-8">
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-2 rounded-lg text-[#0f7c82] transition hover:text-[#0b6870]"
              aria-label="IonicLink home"
              @click="navigateTo('home', 'today')"
            >
              <img src="/ioniclink.png" alt="" class="h-7 w-7 object-contain" />
              <span class="text-lg font-bold tracking-tight">IonicLink</span>
            </button>

            <nav class="hidden items-center gap-8 sm:flex" aria-label="Home and library navigation">
              <button
                v-for="item in elicitTopNavItems"
                :key="item.label"
                type="button"
                class="inline-flex items-center gap-2 text-sm font-semibold transition hover:text-[#0f7c82]"
                :class="item.view && currentView === item.view ? 'text-[#0f7c82]' : 'text-slate-700'"
                :aria-current="item.view && currentView === item.view ? 'page' : undefined"
                @click="openElicitTopNavItem(item)"
              >
                <component :is="item.icon" class="h-4 w-4 text-slate-500" />
                {{ item.label }}
              </button>
            </nav>

            <div class="ml-auto flex items-center gap-3">
              <span class="hidden max-w-[14rem] items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 lg:inline-flex">
                <Database class="h-4 w-4 text-slate-400" />
                <span class="truncate">{{ activeScopeLabel }}</span>
              </span>
            </div>
          </header>

          <div class="flex min-h-0 flex-1 overflow-hidden">
            <main id="app-main" class="min-h-0 flex-1 overflow-hidden" tabindex="-1">
              <HomePage
                v-if="currentView === 'home'"
                :active-scope-label="activeScopeLabel"
                :operator-name="operatorName"
                :files="batchFiles"
                :active-run="activeExtractionRun"
                :latest-workflow="latestAgentWorkflow"
                :preferred-training-dataset-id="preferredTrainingDatasetId"
                :can-access-admin="canAccessAdmin"
                @action="handleHomeAction"
                @open-source="(source) => openSourceGroundingTarget({ literatureId: source.literature_id })"
              />

              <LibraryPage
                v-else-if="currentView === 'library'"
                :current-section="currentSection"
                :active-scope-label="activeScopeLabel"
                :operator-name="operatorName"
                :selected-file-name="selectedFileName"
                :selected-file="selectedFile"
                :selected-file-id="selectedFileId"
                :scope-key="sessionState.activeScopeKey"
                :files="batchFiles"
                :can-adjust-crops="canAccessAdmin"
                @change-section="handleSectionChange"
                @open-home="navigateTo('home', 'today')"
                @open-review="openSourceGroundingTarget"
                @open-database="openLibraryExtractionDatabase"
                @select-source="setSelectedFile"
                @clear-source="setSelectedFile(null)"
                @reextract="(fileId) => handleExtract(fileId, true)"
              />

              <AdminPage
                v-else
                :current-section="currentSection"
                :active-scope-label="activeScopeLabel"
                :operator-name="operatorName"
                :run-state-label="runStateLabel"
                :can-access-monitor="canAccessAdmin"
                :latest-agent-workflow="latestAgentWorkflow"
                :active-run="activeExtractionRun"
                :active-file-name="activeExtractionFileName"
                @change-section="handleSectionChange"
                @open-home="navigateTo('home', 'today')"
              />
            </main>
          </div>
        </div>

        <DatabaseToolModal
          key="database-tool-global-v2"
          :show="databaseToolOpen"
          :files="batchFiles"
          :selected-file="selectedFile"
          :selected-file-id="selectedFileId"
          :selected-file-name="selectedFileName"
          :explorer-doi="explorerDoi"
          :focus-file-id="databaseToolFocus?.fileId || null"
          :focus-doi="databaseToolFocus?.doi || ''"
          :focus-dataset="databaseToolFocus?.dataset || null"
          :focus-record-id="databaseToolFocus?.recordId || null"
          :focus-entity-type="databaseToolFocus?.entityType || null"
          :entity-type-filter="databaseToolFocus?.entityType === 'candidate' ? 'candidate' : 'record'"
          @close="databaseToolOpen = false"
          @open-literature="locateDatabaseLiterature"
          @clear-doi="clearExplorerDoi"
          @clear-focused-record="clearDatabaseToolFocusedRecord"
        />

        <div
          v-if="sourceGroundingOpen"
          class="fixed inset-0 z-[80] flex flex-col bg-white"
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-grounding-title"
        >
          <header class="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
            <div class="min-w-0">
              <p class="text-[11px] font-black uppercase tracking-[0.18em] text-[#0f7c82]">Source Grounding</p>
              <h2 id="source-grounding-title" class="truncate text-sm font-bold text-slate-900">
                {{ selectedFileName || 'Evidence PDF' }}
              </h2>
            </div>
            <button
              type="button"
              class="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close source grounding"
              @click="closeSourceGrounding"
            >
              <X class="h-5 w-5 stroke-[1.8]" />
            </button>
          </header>
          <div v-if="sourceGroundingLoading" class="grid flex-1 place-items-center text-sm font-bold text-slate-500">
            Loading source grounding...
          </div>
          <div v-else-if="sourceGroundingError" class="grid flex-1 place-items-center px-6 text-center">
            <div class="max-w-md rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
              {{ sourceGroundingError }}
            </div>
          </div>
          <SourceGroundingView
            v-else
            class="min-h-0 flex-1"
            :pdf-url="sourceGroundingPdfUrl"
            :highlight-data="sourceGroundingHighlights"
          />
        </div>

        <div
          v-if="pdfUploadModalOpen"
          class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 px-5 py-8 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-upload-modal-title"
          @click.self="closePdfUploadModal"
        >
          <section class="w-full max-w-[46rem] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <!-- Extract papers -->
            <div class="flex items-center justify-between px-1 pb-3">
              <div class="min-w-0">
                <h2 id="pdf-upload-modal-title" class="truncate text-xl font-black tracking-[-0.03em] text-slate-950">
                  {{ pdfUploadModalTitle }}
                </h2>
                <p class="mt-1 text-sm font-semibold text-slate-500">
                  {{ pdfUploadModalSubtitle }}
                </p>
              </div>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                aria-label="Close upload dialog"
                :disabled="pdfUploadUploading || pdfUploadExtracting"
                @click="closePdfUploadModal"
              >
                <X class="h-5 w-5 stroke-[1.8]" />
              </button>
            </div>

            <div
              class="mb-5 grid grid-cols-4 gap-1 rounded-lg bg-slate-100/70 p-1 text-[11px] font-bold text-slate-500"
              role="list"
              aria-label="Extraction progress"
            >
              <span
                v-for="label in pdfUploadStepLabels"
                :key="label"
                role="listitem"
                class="rounded-xl px-3 py-2 text-center"
                :aria-current="isPdfUploadStepActive(label) ? 'step' : undefined"
                :class="isPdfUploadStepActive(label) ? 'bg-white text-[#0f7c82] shadow-sm' : 'text-slate-400'"
              >
                {{ label }}
              </span>
            </div>

            <div v-if="pdfUploadModalStep === 'upload'">
              <input
                ref="pdfUploadInputRef"
                class="hidden"
                type="file"
                multiple
                accept=".pdf,application/pdf"
                @change="handlePdfUploadInputChange"
              />
              <div
                class="flex min-h-[13rem] cursor-pointer items-center justify-center rounded-lg border border-dashed px-6 text-center transition"
                :class="pdfUploadDragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-[#fbfaff] hover:border-teal-300 hover:bg-teal-50/40'"
                role="button"
                tabindex="0"
                @dragover.prevent="pdfUploadDragging = true"
                @dragleave.prevent="pdfUploadDragging = false"
                @drop.prevent="handlePdfUploadDrop"
                @click="choosePdfUploadFiles"
                @keydown.enter.prevent="choosePdfUploadFiles"
                @keydown.space.prevent="choosePdfUploadFiles"
              >
                <div class="flex flex-col items-center">
                  <CloudUpload class="h-11 w-11 text-[#0f7c82]" />
                  <p class="mt-4 text-base font-extrabold text-slate-900">Add PDF papers</p>
                  <p class="mt-1 text-sm font-semibold text-slate-500">Drop files here or click to browse.</p>
                  <p v-if="pdfUploadStatusMessage" class="mt-4 text-sm font-semibold text-slate-600">
                    {{ pdfUploadStatusMessage }}
                  </p>
                </div>
              </div>
              <div
                v-if="queuedPdfUploadFiles.length"
                class="mt-4 max-h-32 space-y-2 overflow-y-auto pr-1"
                aria-label="Selected PDF files"
              >
                <div
                  v-for="(file, index) in queuedPdfUploadFiles"
                  :key="`${file.name}-${file.size}-${file.lastModified}`"
                  class="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-700"
                >
                  <FileText class="h-5 w-5 shrink-0 text-[#0f7c82]" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate">{{ file.name }}</span>
                    <span
                      v-if="pdfUploadUploadProgress[pdfUploadFileKey(file)]?.percent != null"
                      class="mt-1 block text-xs font-bold text-[#0f7c82]"
                    >
                      Upload progress {{ pdfUploadUploadProgress[pdfUploadFileKey(file)]?.percent }}%
                    </span>
                    <span
                      v-if="pdfUploadUploadErrors[pdfUploadFileKey(file)]"
                      class="mt-1 block text-xs font-bold text-rose-600"
                    >
                      Failed: {{ pdfUploadUploadErrors[pdfUploadFileKey(file)] }}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    :aria-label="`Remove ${file.name}`"
                    :disabled="pdfUploadUploading"
                    @click.stop="removeQueuedPdfUploadFile(index)"
                  >
                    <X class="h-5 w-5 stroke-[1.8]" />
                  </button>
                </div>
              </div>
              <div class="mt-4 flex items-center justify-end gap-4">
                <button
                  type="button"
                  class="inline-flex h-10 items-center rounded-md border border-[#0f7c82]/30 bg-white px-5 text-sm font-extrabold text-[#0f7c82] transition hover:border-[#0f7c82]/60 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-55"
                  :disabled="pdfUploadUploading || queuedPdfUploadFiles.length === 0"
                  @click="uploadQueuedPdfFiles"
                >
                  {{ pdfUploadUploading ? 'Uploading...' : 'Upload selected PDFs' }}
                </button>
              </div>
              <div class="mt-6 flex justify-end">
                <button
                  type="button"
                  class="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0f7c82] px-5 text-sm font-black text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
                  :disabled="pdfUploadUploading || !pdfUploadCanContinueFromUpload"
                  @click="continueFromPdfUploadModal"
                >
                  Continue
                  <ArrowRight class="h-4 w-4 stroke-[2.4]" />
                </button>
              </div>
            </div>

            <div v-else-if="pdfUploadModalStep === 'select'">
              <div>
                <h3 class="text-xl font-extrabold text-slate-900">Choose papers</h3>
                <p class="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">
                  {{ uploadedPdfPapers.length }} paper{{ uploadedPdfPapers.length === 1 ? '' : 's' }} ready<span v-if="pdfUploadPendingFileNames.length">, {{ pdfUploadPendingFileNames.length }} still parsing</span>. Select the papers to extract.
                </p>
                <div class="mt-5 flex flex-wrap items-center gap-3">
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="h-10 rounded-md border border-slate-200 px-5 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                      @click="pdfUploadModalStep = 'upload'"
                    >
                      + Upload papers
                    </button>
                  </div>
                  <div
                    v-if="shouldShowPdfUploadBatchProgress"
                    class="ml-auto min-w-[17rem] rounded-lg border border-teal-100 bg-teal-50/60 px-4 py-2 shadow-sm"
                    aria-label="Upload parsing progress"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-xs font-black uppercase tracking-[0.14em] text-[#0f7c82]">
                        {{ pdfUploadUploading ? 'Parsing' : 'Parsed' }}
                      </span>
                      <strong class="font-mono text-sm font-black text-slate-900">{{ pdfUploadBatchFinished }} / {{ pdfUploadBatchTotal }}</strong>
                    </div>
                    <div class="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-teal-100">
                      <div
                        class="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-400 transition-all duration-500 ease-out"
                        :style="{ width: `${pdfUploadBatchProgressPercent}%` }"
                      ></div>
                    </div>
	                  </div>
	                </div>
	                <div
	                  v-if="pdfUploadFailedUploadEntries.length"
	                  class="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-4 py-3"
	                  aria-label="Failed PDF uploads"
	                >
	                  <p class="text-xs font-black uppercase tracking-[0.14em] text-rose-600">Failed uploads</p>
	                  <div class="mt-2 space-y-2">
	                    <div
	                      v-for="entry in pdfUploadFailedUploadEntries"
	                      :key="entry.key"
	                      class="text-sm font-semibold leading-6 text-rose-700"
	                    >
	                      <span class="font-extrabold">Failed:</span> {{ entry.name }} · {{ entry.error }}
	                    </div>
	                  </div>
	                </div>

	                <TransitionGroup
                  tag="div"
                  class="mt-5 max-h-[23rem] overflow-y-auto rounded-lg border border-slate-200"
                  enter-active-class="transition duration-300 ease-out"
                  enter-from-class="translate-y-2 opacity-0"
                  enter-to-class="translate-y-0 opacity-100"
                  leave-active-class="transition duration-200 ease-in"
                  leave-from-class="opacity-100"
                  leave-to-class="opacity-0"
                >
                  <button
                    v-for="paper in uploadedPdfPapers"
                    :key="paper.id"
                    type="button"
                    class="flex w-full items-start gap-4 border-b border-slate-100 px-5 py-4 text-left transition last:border-b-0 hover:bg-teal-50/45"
                    @click="togglePdfUploadLibraryFile(paper.id)"
                  >
                    <span
                      class="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded border"
                      :class="selectedPdfUploadFileIds.includes(paper.id) ? 'border-[#0f7c82] bg-[#0f7c82] text-white' : 'border-slate-200 bg-white'"
                    >
                      <Check v-if="selectedPdfUploadFileIds.includes(paper.id)" class="h-3.5 w-3.5 stroke-[3]" />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-base font-extrabold text-slate-900">
                        {{ paper.title }}
                      </span>
                      <span class="mt-1 block truncate text-sm font-semibold text-slate-500">
                        {{ compactAuthorLine(paper.authors) }}
                      </span>
                    </span>
                  </button>
                  <div v-if="uploadedPdfPapers.length === 0 && pdfUploadPendingFileNames.length > 0" key="parsing" class="px-5 py-8 text-center">
                    <Loader2 class="mx-auto h-5 w-5 animate-spin text-[#0f7c82]" />
                    <p class="mt-3 text-sm font-semibold text-slate-500">Parsing metadata in the background</p>
                  </div>
                  <div v-if="uploadedPdfPapers.length === 0 && pdfUploadPendingFileNames.length === 0" key="empty" class="px-5 py-8 text-center text-sm font-semibold text-slate-400">
                    Uploaded papers will appear here after metadata parsing.
                  </div>
                </TransitionGroup>
                <div class="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p class="text-sm font-semibold text-slate-500">
                    {{ selectedPdfUploadFileIds.length || uploadedPdfPapers.length }} paper{{ (selectedPdfUploadFileIds.length || uploadedPdfPapers.length) === 1 ? '' : 's' }} ready.
                  </p>
                  <button
                    type="button"
                    class="inline-flex h-11 items-center gap-2 rounded-md bg-[#0f7c82] px-5 text-sm font-extrabold text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
                    :disabled="uploadedPdfPapers.length === 0"
                    @click="openPdfUploadExtractionSetup"
                  >
                    <Upload class="h-4 w-4" />
                    Choose mode
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="pdfUploadModalStep === 'setup'">
              <div>
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p class="text-xs font-black uppercase tracking-[0.18em] text-[#0f7c82]">Choose mode</p>
                    <h3 class="mt-1 text-xl font-extrabold text-slate-900">What should IonicLink extract?</h3>
                    <p class="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                      Lubrication for COF and tribology, or Diffusion for confined transport.
                    </p>
                  </div>
                  <span class="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                    {{ papersSelectedForPdfUploadExtraction().length }} papers
                  </span>
                </div>

                <div class="mt-5 rounded-lg border border-[#0f7c82]/20 bg-[#f3fbfb] p-4">
                  <span class="flex items-center justify-between gap-3">
                    <span class="inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-[#0f7c82]">
                      <Sparkles class="h-4 w-4" />
                      Smart extraction
                    </span>
                    <Check class="h-5 w-5 text-[#0f7c82]" />
                  </span>
                  <p class="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    Text evidence is extracted first; figure and table pages are added automatically when needed.
                  </p>
                </div>

                <div class="mt-5 max-h-[15rem] overflow-y-auto rounded-lg border border-slate-200">
                  <div
                    v-for="paper in papersSelectedForPdfUploadExtraction()"
                    :key="paper.id"
                    class="flex items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <FileText class="mt-0.5 h-5 w-5 shrink-0 text-[#0f7c82]" />
                    <span class="min-w-0 flex-1">
                      <strong class="block truncate text-sm font-extrabold text-slate-900">{{ paper.title }}</strong>
                      <span class="mt-1 block truncate text-xs font-semibold text-slate-500">{{ compactAuthorLine(paper.authors) }}</span>
                    </span>
                    <label class="shrink-0">
                      <span class="sr-only">Extraction preset</span>
                      <select
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-teal-300 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100"
                        :value="presetForPdfUploadedPaper(paper)"
                        @change="setPdfUploadedPaperExtractionPreset(paper.id, $event)"
                      >
                        <option
                          v-for="option in pdfUploadVisibleExtractionPresetOptions"
                          :key="option.value"
                          :value="option.value"
                          :disabled="Boolean(option.disabled)"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                  </div>
                </div>

                <div class="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    class="inline-flex h-10 items-center rounded-md border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                    @click="pdfUploadModalStep = 'select'"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-11 items-center gap-2 rounded-md bg-[#0f7c82] px-5 text-sm font-extrabold text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
                    :disabled="papersSelectedForPdfUploadExtraction().length === 0 || pdfUploadSelectionHasUnsupportedPreset"
                    @click="startPdfUploadExtraction"
                  >
                    <Upload class="h-4 w-4" />
                    Start extraction
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="pdfUploadModalStep === 'extracting'">
              <div>
                <div class="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 class="text-xl font-extrabold text-slate-900">Extracting data</h3>
                    <p class="mt-2 text-sm font-medium text-slate-500">{{ pdfUploadStatusMessage }}</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <button
                      v-if="pdfUploadExtracting"
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-extrabold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="pdfUploadExtractionCancelling"
                      @click="cancelPdfUploadExtraction"
                    >
                      <X class="h-4 w-4" />
                      {{ pdfUploadExtractionCancelling ? 'Stopping...' : 'Stop extraction' }}
                    </button>
                    <button
                      v-if="pdfUploadExtracting"
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                      @click="closePdfUploadModal"
                    >
                      Continue in background
                    </button>
                    <div class="text-right">
                      <strong class="block text-2xl font-black text-[#0f7c82]">{{ pdfUploadExtractionProgress }}%</strong>
                      <span class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Progress</span>
                    </div>
                  </div>
                </div>
                <div class="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100 shadow-inner">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-teal-400 via-teal-500 to-teal-500 shadow-[0_0_16px_rgba(13,148,136,0.25)] transition-all duration-700 ease-out"
                    :style="{ width: `${pdfUploadExtractionProgress}%` }"
                  ></div>
                </div>
                <div class="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
                  <div
                    v-for="item in pdfUploadExtractionItems"
                    :key="item.id"
                    class="group flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4 transition"
                    :class="item.status === 'completed' && item.records > 0 ? 'cursor-pointer hover:border-teal-200 hover:bg-teal-50/35 hover:shadow-sm' : ''"
                    :role="item.status === 'completed' && item.records > 0 ? 'button' : undefined"
                    :tabindex="item.status === 'completed' && item.records > 0 ? 0 : -1"
                    @click="openPdfUploadResultsInDatabase(item)"
                    @keydown.enter.prevent="openPdfUploadResultsInDatabase(item)"
                    @keydown.space.prevent="openPdfUploadResultsInDatabase(item)"
                  >
                    <span
                      class="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full"
                      :class="item.status === 'extracting' ? 'bg-teal-100 text-[#0f7c82]' : item.status === 'failed' || item.status === 'cancelled' ? 'bg-red-50 text-red-500' : item.status === 'no_data' ? 'bg-amber-50 text-amber-700' : item.status === 'queued' ? 'bg-slate-100 text-slate-400' : 'bg-teal-50 text-teal-700'"
                    >
                      <Loader2 v-if="item.status === 'extracting'" class="h-5 w-5 animate-spin" />
                      <X v-else-if="item.status === 'failed' || item.status === 'cancelled'" class="h-5 w-5" />
                      <HelpCircle v-else-if="item.status === 'no_data'" class="h-5 w-5" />
                      <Check v-else-if="item.status === 'completed'" class="h-5 w-5 stroke-[2.6]" />
                      <FileText v-else class="h-5 w-5" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-3">
                        <strong class="block truncate text-base font-extrabold text-slate-900">{{ item.title }}</strong>
                        <span class="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                          {{ pdfUploadExtractionStatusLabel(item.status) }}
                        </span>
                      </div>
                      <p class="mt-1 truncate text-sm font-semibold text-slate-500">{{ compactAuthorLine(item.authors) }}</p>
                      <p class="mt-2 text-sm font-medium text-slate-600">{{ item.message }}</p>
                      <p
                        v-if="item.status === 'completed' && item.records > 0"
                        class="mt-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-[#0f7c82] opacity-90 transition group-hover:translate-x-0.5"
                      >
                        Ready for review
                        <ArrowRight class="h-4 w-4" />
                      </p>
                      <button
                        v-else-if="['no_data', 'failed', 'cancelled'].includes(item.status) && !pdfUploadExtracting"
                        type="button"
                        class="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-extrabold text-amber-800 transition hover:bg-amber-100"
                        @click.stop="changePdfUploadExtractionType"
                      >
                        Change mode
                        <ArrowRight class="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div
                  v-if="pdfUploadCompletedExtractionItems.length > 0 && !pdfUploadExtracting"
                  class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"
                >
                  <p class="text-sm font-semibold text-slate-500">
                    {{ pdfUploadCompletedExtractionItems.length }} paper{{ pdfUploadCompletedExtractionItems.length === 1 ? '' : 's' }} ready.
                  </p>
                  <button
                    type="button"
                    class="inline-flex h-11 items-center gap-2 rounded-lg bg-[#0f7c82] px-5 text-sm font-extrabold text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870]"
                    @click="openPdfUploadResultsInDatabase()"
                  >
                    Open Database
                    <ArrowRight class="h-4 w-4" />
                  </button>
                </div>
                <div
                  v-else-if="pdfUploadRecoverableExtractionItems.length > 0 && !pdfUploadExtracting"
                  class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-amber-100 bg-amber-50/60 px-4 py-3"
                >
                  <p class="text-sm font-semibold text-amber-800">
                    {{ pdfUploadRecoverableSummaryLabel }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-amber-700"
                      @click="retryPdfUploadRecoverableExtraction"
                    >
                      Retry failed
                      <ArrowRight class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md border border-amber-200 bg-white px-4 text-sm font-extrabold text-amber-800 transition hover:bg-amber-50"
                      @click="changePdfUploadExtractionType"
                    >
                      Change mode
                      <ArrowRight class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                      @click="uploadAnotherPdfAfterExtraction"
                    >
                      Upload another PDF
                      <Upload class="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </section>
        </div>
      </template>

      <template v-else>
      <!-- Workspace top bar -->
      <header v-if="!chromeHiddenViews.includes(currentView)" class="app-topbar flex h-14 shrink-0 items-center gap-3 px-4">
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            class="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 sm:flex"
            aria-hidden="true"
          >
            <PanelTop class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
              {{ viewTitle }}
            </h2>
            <p class="hidden truncate text-xs text-slate-500 dark:text-slate-400 md:block">
              {{ viewSubtitle }}
            </p>
          </div>
        </div>

        <div class="ml-auto flex min-w-0 items-center gap-2">
          <span class="topbar-chip hidden max-w-[16rem] lg:inline-flex">
            <Database class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ activeScopeLabel }}</span>
          </span>
          <span v-if="selectedFile" class="topbar-chip hidden max-w-[20rem] xl:inline-flex">
            <FileText class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ selectedFileName }}</span>
          </span>
          <span class="topbar-chip hidden max-w-[14rem] sm:inline-flex">
            <Activity class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ runStateLabel }}</span>
          </span>
          <a
            href="https://github.com/mx1210385980-a11y/IonicLink/tree/main"
            target="_blank"
            rel="noreferrer"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
            title="GitHub"
            aria-label="Open IonicLink on GitHub"
          >
            <Github class="h-4 w-4" />
          </a>
        </div>
      </header>

      <!-- Page workspace -->
      <main id="app-main" class="flex-1 min-h-0 overflow-hidden" tabindex="-1">
        <div
          class="app-workspace flex h-full min-h-0 flex-col"
          :class="chromeHiddenViews.includes(currentView) ? 'gap-0 p-0' : 'gap-3 px-3 py-3 sm:px-4 sm:py-4'"
        >
          <HomePage
            v-if="currentView === 'home'"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :files="batchFiles"
            :active-run="activeExtractionRun"
            :latest-workflow="latestAgentWorkflow"
            :preferred-training-dataset-id="preferredTrainingDatasetId"
            :can-access-admin="canAccessAdmin"
            @action="handleHomeAction"
            @open-source="(source) => openSourceGroundingTarget({ literatureId: source.literature_id })"
          />

          <KnowledgePage
            v-else-if="currentView === 'knowledge'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :selected-file-name="selectedFileName"
            :explorer-doi="explorerDoi"
            :selected-file="selectedFile"
            :selected-file-id="selectedFileId"
            :focus-record-id="focusedRecordId"
            :scope-key="sessionState.activeScopeKey"
            @clear-focused-record="focusedRecordId = null"
            @change-section="handleSectionChange"
            @open-training="openTrainingWorkbench"
            @open-review="openSourceGroundingTarget"
            @select-source="setSelectedFile"
            @clear-doi="clearExplorerDoi"
            @clear-source="setSelectedFile(null)"
          />

          <LibraryPage
            v-else-if="currentView === 'library'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :selected-file-name="selectedFileName"
            :selected-file="selectedFile"
            :selected-file-id="selectedFileId"
            :scope-key="sessionState.activeScopeKey"
            :files="batchFiles"
            :can-adjust-crops="canAccessAdmin"
            @change-section="handleSectionChange"
            @open-home="navigateTo('home', 'today')"
            @open-review="openSourceGroundingTarget"
            @open-database="openLibraryExtractionDatabase"
            @select-source="setSelectedFile"
            @clear-source="setSelectedFile(null)"
            @reextract="(fileId) => handleExtract(fileId, true)"
          />

          <ModelingPage
            v-else-if="currentView === 'modeling'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :preferred-training-dataset-id="preferredTrainingDatasetId"
            :scope-key="sessionState.activeScopeKey"
            @change-section="handleSectionChange"
            @open-knowledge="navigateTo('knowledge', 'cleaning')"
            @inspect-record="(payload: { literatureId: number | string, recordId?: number | null }) => {
              setSelectedFile(String(payload.literatureId))
              focusedRecordId = payload.recordId ?? null
              navigateTo('knowledge', 'explorer')
            }"
          />

          <QualityMetricsPage
            v-else-if="currentView === 'quality'"
            :files="batchFiles"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
          />

          <AdminPage
            v-else-if="currentView === 'admin'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :run-state-label="runStateLabel"
            :can-access-monitor="canAccessAdmin"
            :latest-agent-workflow="latestAgentWorkflow"
            :active-run="activeExtractionRun"
            :active-file-name="activeExtractionFileName"
            @change-section="handleSectionChange"
            @open-home="navigateTo('home', 'today')"
          />
        </div>
      </main>
      </template>
    </div>
  </div>
</template>
