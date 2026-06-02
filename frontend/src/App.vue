<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CloudUpload,
  Clock3,
  Database,
  FileText,
  Github,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  PanelTop,
  Search,
  Sparkles,
  UserCog,
  Upload,
  X,
} from 'lucide-vue-next'

import AppSidebar from '@/components/AppSidebar.vue'
import ChemicalText from '@/components/ChemicalText.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import type { HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useAppShell } from '@/composables/useAppShell'
import { useI18n } from '@/composables/useI18n'
import {
  approveDiffusionReviewCandidate,
  approveDiffusionReviewRecord,
  approveReviewCandidate,
  approveReviewRecord,
  cancelExtraction,
  confirmCandidateFieldEvidence,
  confirmDiffusionCandidateFieldEvidence,
  confirmDiffusionRecordFieldEvidence,
  confirmRecordFieldEvidence,
  extractData,
  flagCandidateFieldEvidence,
  flagDiffusionCandidateFieldEvidence,
  flagDiffusionRecordFieldEvidence,
  flagRecordFieldEvidence,
  getData,
  getExtractionRunCandidates,
  getLatestExtractionRun,
  getLiteratureDetails,
  getPdfBboxPreview,
  getPdfHighlights,
  publishLiteratureToGroupLibrary,
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
import { resolveCandidatePublishTarget, reviewPublishTargetKey } from '@/lib/extractionPublish'
import { buildPdfUploadExtractionItems } from '@/lib/extractionWorkspace'
import { lazyComponent } from '@/lib/lazyComponent'
import {
  confidenceTierLabel,
  confidenceTierOf,
  extractionReviewStatusClass,
  extractionReviewStatusForRow,
  extractionReviewStatusLabel,
  extractionReviewSummary,
  firstAvailablePdfUploadReviewFieldKey,
  missingFieldLabels,
  missingFieldsOf,
  type ExtractionReviewStatus,
} from '@/lib/extractionReview'
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
const HelpPage = lazyComponent(() => import('@/pages/help/HelpPage.vue'))
const HomePage = lazyComponent(() => import('@/pages/home/HomePage.vue'))
const KnowledgePage = lazyComponent(() => import('@/pages/knowledge/KnowledgePage.vue'))
const LibraryPage = lazyComponent(() => import('@/pages/library/LibraryPage.vue'))
const ModelingPage = lazyComponent(() => import('@/pages/modeling/ModelingPage.vue'))
const QualityMetricsPage = lazyComponent(() => import('@/pages/quality/QualityMetricsPage.vue'))
const SourceGroundingView = lazyComponent(() => import('@/components/SourceGroundingView.vue'))

const ADMIN_ROLES = new Set(['principal_investigator', 'group_admin'])

const roleLabelKeys = {
  admin: 'role.admin',
  group_admin: 'role.group_admin',
  member: 'role.member',
  principal_investigator: 'role.principal_investigator',
  researcher: 'role.researcher',
  viewer: 'role.viewer',
  workspace_researcher: 'role.workspace_researcher',
} as const

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
  authError,
  availableScopes,
  batchFiles,
  currentSection,
  currentView,
  explorerDoi,
  handleExtract,
  handleLogin,
  handleLogout,
  isAuthenticating,
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
const elicitShellViews = ['home', 'library', 'admin']
const chromeHiddenViews = ['home', 'library', 'admin']
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
  { label: 'Monitor', icon: Activity, view: 'admin', section: 'runtime' },
]
const elicitWorkflowItems = [
  { label: 'Extraction workflow', icon: BookOpen, active: true, locked: false },
  { label: 'Research agent', icon: LayoutGrid, active: false, locked: false },
  { label: 'Report', icon: FileText, active: false, locked: false },
  { label: 'Systematic review', icon: LayoutGrid, active: false, locked: true },
]
type ElicitToolItem = {
  label: string
  icon: Component
  view?: AppView
  section?: AppSection
  modal?: 'upload' | 'database'
  locked: boolean
}

const elicitToolItems: ElicitToolItem[] = [
  { label: 'Extract data', icon: Upload, modal: 'upload', locked: false },
  { label: 'Database', icon: Database, modal: 'database', locked: false },
  { label: 'Find papers', icon: Search, view: 'library', section: 'explorer', locked: false },
  { label: 'Chat with papers', icon: MessageCircle, view: 'library', section: 'explorer', locked: false },
]

function isElicitItemLocked(item: { locked: boolean }) {
  return item.locked && !canAccessAdmin.value
}

const viewTitle = computed(() => {
  if (isChinese.value) {
    const labels: Record<AppView, string> = {
      admin: '管理',
      blog: '内容',
      help: '帮助',
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
    help: 'Help',
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
      help: '上手指南与协作说明',
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
    help: 'Guides for onboarding and collaboration',
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
const operatorInitial = computed(() => operatorName.value.trim().charAt(0).toUpperCase() || 'U')
const operatorAccountLine = computed(() => sessionState.user?.username || operatorRole.value)
const accountMenuOpen = ref(false)
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
const pdfUploadModalStep = ref<'upload' | 'select' | 'setup' | 'extracting' | 'results'>('upload')
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
type PdfUploadEvidenceQuote = {
  text: string
  highlights?: string[]
  highlightGroups?: string[][]
}
type PdfUploadEvidenceSlide = {
  fieldKey: string
  fieldKeys: string[]
  actionFieldKey: string
  label: string
  value: string
  quotes: PdfUploadEvidenceQuote[]
  sourceType?: string
  groundingMode?: string
  hasReliableLocator?: boolean
  page?: number | null
  bbox?: number[] | null
}
type PdfUploadEvidencePopover = {
  row: TribologyData
  rowIndex: number
  fieldLabel: string
  fieldKeys: string[]
  actionFieldKey: string
  value: string
  quotes: PdfUploadEvidenceQuote[]
  slides: PdfUploadEvidenceSlide[]
  page?: number | null
  bbox?: number[] | null
}
const pdfUploadExtractionItems = ref<PdfUploadExtractionItem[]>([])
const pdfUploadExtracting = ref(false)
const pdfUploadExtractionAbortRequested = ref(false)
const pdfUploadExtractionCancelling = ref(false)
const pdfUploadExtractionRunToken = ref(0)
const PDF_UPLOAD_CANCEL_TIMEOUT_MS = 8000
const PDF_UPLOAD_STALLED_HEARTBEAT_MS = 10 * 60 * 1000
const selectedPdfUploadResultPaperId = ref<string | null>(null)
const activePdfUploadEvidence = ref<PdfUploadEvidencePopover | null>(null)
const pdfUploadEvidencePosition = ref({ top: 0, left: 0 })
const pdfUploadEvidenceSlideIndex = ref(0)
const pdfUploadEvidencePreviewImages = ref<Record<string, string | null>>({})
const pdfUploadEvidencePreviewLoading = ref<Record<string, boolean>>({})
const pdfUploadEvidencePreviewError = ref<Record<string, string | null>>({})
const pdfUploadReviewActionPending = ref('')
const pdfUploadReviewActionError = ref('')
const pdfUploadPublishedReviewTargetKeys = ref<Set<string>>(new Set())
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
const pdfUploadResultRows = computed(() => selectedPdfUploadResultItem.value?.extractedRows || [])
const pdfUploadReviewStatuses = computed<ExtractionReviewStatus[]>(() =>
  pdfUploadResultRows.value.map((row) => pdfUploadReviewStatus(row)),
)
const pdfUploadReviewSummary = computed(() => extractionReviewSummary(pdfUploadReviewStatuses.value))
const pdfUploadReadyRows = computed(() =>
  pdfUploadResultRows.value.filter((row) => pdfUploadReviewStatus(row) === 'ready'),
)
const pdfUploadNeedsReviewCount = computed(() => pdfUploadReviewSummary.value.needsReview)
const selectedPdfUploadResultPreset = computed(() => {
  const item = selectedPdfUploadResultItem.value
  return item ? uploadedPdfPaperExtractionPresets.value[item.id] || inferPdfUploadExtractionPreset(item) : 'tribology'
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
  { value: 'tribology', label: 'Tribology', description: 'Friction, COF, wear, surfaces' },
  { value: 'diffusion', label: 'Diffusion', description: 'Diffusion coefficients and confined transport' },
  { value: 'conductivity', label: 'Conductivity', description: 'Conductivity, EIS, transference number (coming soon)', disabled: true },
]

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
  return pdfUploadExtractionPresetOptions.find((option) => option.value === preset)?.label || 'Tribology'
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
const operatorRole = computed(() => formatMappedLabel(String(sessionState.user?.role || 'member'), roleLabelKeys))
function openAccountSettings() {
  accountMenuOpen.value = false
  navigateTo(canAccessAdmin.value ? 'admin' : 'help', canAccessAdmin.value ? 'users' : 'quick-start')
}

function logoutFromAccountMenu() {
  accountMenuOpen.value = false
  handleLogout()
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
  navigateTo('library', 'explorer')
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
  if (pdfUploadExtracting.value || pdfUploadExtractionItems.value.length > 0) {
    if (!pdfUploadExtracting.value && pdfUploadCompletedExtractionItems.value.length > 0) {
      void openCompletedPdfUploadItemsInDatabase(pdfUploadCompletedExtractionItems.value)
      return
    }
    pdfUploadDragging.value = false
    pdfUploadModalStep.value = 'extracting'
    pdfUploadModalOpen.value = true
    return
  }
  pdfUploadStatusMessage.value = ''
  pdfUploadDragging.value = false
  pdfUploadModalStep.value = 'upload'
  pdfUploadExtractionAbortRequested.value = false
  pdfUploadExtractionCancelling.value = false
  uploadedPdfPapers.value = []
  uploadedPdfPaperExtractionPresets.value = {}
  activePdfUploadEvidence.value = null
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
  activePdfUploadEvidence.value = null
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
    activePdfUploadEvidence.value = null
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

async function openPdfUploadExtractionResults(item?: PdfUploadExtractionItem) {
  if (pdfUploadExtracting.value) return
  const target = item || pdfUploadCompletedExtractionItems.value[0]
  if (!target || target.status !== 'completed' || target.records <= 0) return
  selectedPdfUploadResultPaperId.value = target.id
  activePdfUploadEvidence.value = null
  pdfUploadModalStep.value = 'results'
  await hydratePdfUploadExtractionRows([target])
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
  if (status === 'completed') return 'Completed'
  if (status === 'no_data') return 'No data'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
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

function compactIonPartText(value: unknown) {
  return pdfUploadResultValue(value)
    .replace(/\b([PN])([0-9]+(?:,[0-9]+)+)\b/gi, (_match, head, digits) => `${String(head).toUpperCase()}${String(digits).replace(/,/g, '')}`)
}

function pdfUploadIonPartLine(row: TribologyData) {
  return [compactIonPartText(row.cation), compactIonPartText(row.anion)].filter(Boolean).join(' · ')
}

function isSpecificBmbSample(value: string) {
  return /\[[^\]]+\]\s*\[A\d+BMB\]/i.test(value)
}

function withSpecificBmbSample(row: TribologyData, fallback: string) {
  const raw = pdfUploadResultValue(row.ionic_liquid)
  if (isSpecificBmbSample(raw)) return raw

  const alias = pdfUploadResultValue(row.lubricant_alias) || pdfUploadResultValue(row.system_name)
  const aliasMatch = alias.match(/\b(A\d+BMB)\b/i)
  if (!aliasMatch) return fallback

  const source = raw || fallback
  const pairMatch = source.match(/\[([^\]]+)\]\s*\[(?:A\d+)?BMB\]/i)
  const cation = pairMatch?.[1] || compactIonPartText(row.cation)
  return cation ? `[${cation}][${aliasMatch[1]?.toUpperCase()}]` : fallback
}

function pdfUploadResultId(row: TribologyData, index: number) {
  return pdfUploadResultValue(row.id) || String(index + 1)
}

function pdfUploadReviewTargetId(row: TribologyData) {
  const id = Number(row.entity_id ?? row.entityId ?? row.id ?? 0)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function pdfUploadCandidateId(row: TribologyData) {
  return pdfUploadReviewTargetId(row)
}

function pdfUploadReviewStatus(row: TribologyData): ExtractionReviewStatus {
  const target = resolveCandidatePublishTarget(row, selectedPdfUploadResultPreset.value as ExtractorType)
  if (target && pdfUploadPublishedReviewTargetKeys.value.has(reviewPublishTargetKey(target))) return 'published'
  return extractionReviewStatusForRow(row)
}

function pdfUploadRowConfidenceLabel(row: TribologyData) {
  const tier = row.confidence_tier ?? row.confidenceTier
  if (!tier && (row.confidence === null || row.confidence === undefined)) return ''
  return confidenceTierLabel(tier ?? confidenceTierOf(row))
}

function pdfUploadRowMissingLabels(row: TribologyData) {
  return missingFieldLabels(missingFieldsOf(row))
}

function pdfUploadHasWeakCandidates(rows: TribologyData[]) {
  return rows.some((row) => String(row.record_origin || '').trim().toLowerCase() === 'weak_candidate')
}

function markPdfUploadReviewTargetPublished(target: NonNullable<ReturnType<typeof resolveCandidatePublishTarget>>) {
  const next = new Set(pdfUploadPublishedReviewTargetKeys.value)
  next.add(reviewPublishTargetKey(target))
  pdfUploadPublishedReviewTargetKeys.value = next
}

function applyPdfUploadReviewResponse(
  row: TribologyData,
  response: Awaited<ReturnType<typeof approveReviewCandidate>>,
) {
  const responseRecord = response as Partial<TribologyData>
  row.field_evidence_json = responseRecord.field_evidence_json || row.field_evidence_json
  row.review_status = response.review_status || row.review_status
  row.promoted_record_id = response.promoted_record_id ?? response.promotedRecordId ?? row.promoted_record_id
  row.promotedRecordId = response.promotedRecordId ?? response.promoted_record_id ?? row.promotedRecordId
  row.review_entity_type = responseRecord.review_entity_type || responseRecord.reviewEntityType || row.review_entity_type
  row.reviewEntityType = responseRecord.reviewEntityType || responseRecord.review_entity_type || row.reviewEntityType
}

function pdfUploadReviewActionKey(action: string, candidateId: number, fieldKey = '') {
  return `${action}:${candidateId}:${fieldKey}`
}

function pdfUploadReviewActionErrorMessage(error: unknown) {
  const data = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data
  const detail = data?.detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'msg' in item) {
        return String((item as { msg?: unknown }).msg)
      }
      return JSON.stringify(item)
    }).join('; ')
  }
  return error instanceof Error ? error.message : 'Candidate cannot be approved: unknown validation error'
}

async function syncPublishedPdfUploadRecordsToDatabase() {
  const item = selectedPdfUploadResultItem.value
  const literatureId = Number(item?.id || 0)
  if (!Number.isFinite(literatureId) || literatureId <= 0) return
  await publishLiteratureToGroupLibrary(literatureId, 'Published from extraction review')
}

function pdfUploadFieldEvidenceEntityType(row: TribologyData) {
  return String(row.review_entity_type ?? row.reviewEntityType ?? 'candidate').trim().toLowerCase() === 'record'
    ? 'record'
    : 'candidate'
}

function pdfUploadFieldEvidenceExtractorType(row: TribologyData): ExtractorType {
  return String(row.extractor_type || '').trim().toLowerCase() === 'diffusion' || selectedPdfUploadResultPreset.value === 'diffusion'
    ? 'diffusion'
    : 'tribology'
}

async function confirmPdfUploadEvidenceTarget(row: TribologyData, targetId: number, fieldKey: string) {
  const entityType = pdfUploadFieldEvidenceEntityType(row)
  if (pdfUploadFieldEvidenceExtractorType(row) === 'diffusion') {
    return entityType === 'record'
      ? confirmDiffusionRecordFieldEvidence(targetId, fieldKey)
      : confirmDiffusionCandidateFieldEvidence(targetId, fieldKey)
  }
  return entityType === 'record'
    ? confirmRecordFieldEvidence(targetId, fieldKey)
    : confirmCandidateFieldEvidence(targetId, fieldKey)
}

async function flagPdfUploadEvidenceTarget(row: TribologyData, targetId: number, fieldKey: string) {
  const entityType = pdfUploadFieldEvidenceEntityType(row)
  if (pdfUploadFieldEvidenceExtractorType(row) === 'diffusion') {
    return entityType === 'record'
      ? flagDiffusionRecordFieldEvidence(targetId, fieldKey)
      : flagDiffusionCandidateFieldEvidence(targetId, fieldKey)
  }
  return entityType === 'record'
    ? flagRecordFieldEvidence(targetId, fieldKey)
    : flagCandidateFieldEvidence(targetId, fieldKey)
}

async function publishReadyPdfUploadRecords() {
  if (pdfUploadReviewActionPending.value) return
  const readyRows = [...pdfUploadReadyRows.value]
  if (readyRows.length === 0) return
  pdfUploadReviewActionError.value = ''
  pdfUploadReviewActionPending.value = 'publish'
  const failures: string[] = []
  const skipped: string[] = []
  let publishedCount = 0

  await Promise.all(readyRows.map(async (row, index) => {
    const target = resolveCandidatePublishTarget(row, selectedPdfUploadResultPreset.value as ExtractorType)
    if (!target) {
      skipped.push(`${pdfUploadResultId(row, index)}: missing review target id`)
      return
    }

    try {
      const response = target.entityType === 'record'
        ? target.extractorType === 'diffusion'
          ? await approveDiffusionReviewRecord(target.entityId)
          : await approveReviewRecord(target.entityId)
        : target.extractorType === 'diffusion'
          ? await approveDiffusionReviewCandidate(target.entityId)
          : await approveReviewCandidate(target.entityId)
      applyPdfUploadReviewResponse(row, response)
      markPdfUploadReviewTargetPublished(target)
      publishedCount += 1
    } catch (error) {
      failures.push(`${target.entityType} ${target.entityId}: ${pdfUploadReviewActionErrorMessage(error)}`)
    }
  }))

  const publishIssueMessage = [...failures, ...skipped].join('; ')
  if (publishedCount > 0) {
    try {
      await syncPublishedPdfUploadRecordsToDatabase()
    } catch (error) {
      const details = publishIssueMessage ? ` Remaining issues: ${publishIssueMessage}` : ''
      pdfUploadReviewActionError.value = `Published ${publishedCount} of ${readyRows.length} approved records, but database sync failed: ${pdfUploadReviewActionErrorMessage(error)}${details}`
    }
  }
  if (!pdfUploadReviewActionError.value && publishIssueMessage) {
    pdfUploadReviewActionError.value = publishedCount > 0
      ? `Published ${publishedCount} of ${readyRows.length} ready records and synced the database. ${publishIssueMessage}`
      : `Published ${publishedCount} of ${readyRows.length} ready records. ${publishIssueMessage}`
  }
  pdfUploadReviewActionPending.value = ''
}

async function confirmPdfUploadEvidenceField() {
  if (pdfUploadReviewActionPending.value) return
  const evidence = activePdfUploadEvidence.value
  if (!evidence) return
  const candidateId = pdfUploadCandidateId(evidence.row)
  const fieldKey = activePdfUploadEvidenceActionFieldKey()
  if (!candidateId || !fieldKey) {
    pdfUploadReviewActionError.value = 'This field cannot be confirmed from the upload preview.'
    return
  }

  const actionKey = pdfUploadReviewActionKey('confirm', candidateId, fieldKey)
  pdfUploadReviewActionError.value = ''
  pdfUploadReviewActionPending.value = actionKey
  try {
    const response = await confirmPdfUploadEvidenceTarget(evidence.row, candidateId, fieldKey)
    applyPdfUploadReviewResponse(evidence.row, response)
  } catch (error) {
    pdfUploadReviewActionError.value = pdfUploadReviewActionErrorMessage(error) || 'Unable to confirm field evidence'
  } finally {
    pdfUploadReviewActionPending.value = ''
  }
}

async function flagPdfUploadEvidenceField() {
  if (pdfUploadReviewActionPending.value) return
  const evidence = activePdfUploadEvidence.value
  if (!evidence) return
  const candidateId = pdfUploadCandidateId(evidence.row)
  const fieldKey = activePdfUploadEvidenceActionFieldKey()
  if (!candidateId || !fieldKey) {
    pdfUploadReviewActionError.value = 'This field cannot be flagged from the upload preview.'
    return
  }

  const actionKey = pdfUploadReviewActionKey('flag', candidateId, fieldKey)
  pdfUploadReviewActionError.value = ''
  pdfUploadReviewActionPending.value = actionKey
  try {
    const response = await flagPdfUploadEvidenceTarget(evidence.row, candidateId, fieldKey)
    applyPdfUploadReviewResponse(evidence.row, response)
  } catch (error) {
    pdfUploadReviewActionError.value = pdfUploadReviewActionErrorMessage(error) || 'Unable to flag field evidence'
  } finally {
    pdfUploadReviewActionPending.value = ''
  }
}

function openPdfUploadReviewIssues() {
  const item = selectedPdfUploadResultItem.value
  const row = pdfUploadResultRows.value.find((candidate) => {
    const status = pdfUploadReviewStatus(candidate)
    return status === 'needs_review' || status === 'flagged'
  })
  if (!item) return
  pdfUploadModalOpen.value = false
  activePdfUploadEvidence.value = null
  void openSourceGroundingTarget({
    literatureId: Number(item.id),
    recordId: row ? pdfUploadCandidateId(row) || null : null,
  })
}

function pdfUploadResultIonicLiquid(row: TribologyData) {
  const display = pdfUploadResultValue(row.ionic_liquid_display)
    || pdfUploadResultValue(row.ionic_liquid)
    || pdfUploadResultValue(row.lubricant_alias)
    || pdfUploadResultValue(row.system_name)
    || '--'
  return withSpecificBmbSample(row, display)
}

function pdfUploadResultTribopair(row: TribologyData) {
  const probe = pdfUploadResultValue(row.probe_material) || 'Probe N/A'
  const substrate = pdfUploadResultValue(row.substrate_material) || pdfUploadResultValue(row.material_name) || 'Substrate N/A'
  return `${probe} / ${substrate}`
}

function pdfUploadResultConditions(row: TribologyData) {
  const entries = [
    pdfUploadResultValue(row.temperature),
    pdfUploadResultValue(row.load) || pdfUploadResultValue(row.normal_load),
    pdfUploadResultValue(row.speed),
    pdfUploadResultValue(row.potential),
    pdfUploadResultValue(row.water_content),
  ].filter(Boolean)
  return entries.length ? entries.join(' · ') : '--'
}

function pdfUploadResultMetric(row: TribologyData) {
  const preset = selectedPdfUploadResultPreset.value
  if (preset === 'diffusion') {
    const value = row.D_total ?? row.D_cation ?? row.D_anion
    return value !== null && value !== undefined ? `${value}${row.D_unit ? ` ${row.D_unit}` : ''}` : '--'
  }
  const structuredCof = row.cof_extracted?.cof_average ?? row.cof_extracted?.cof_min ?? row.cof_extracted?.cof_max
  return pdfUploadResultValue(row.cof) || pdfUploadResultValue(structuredCof) || '--'
}

function normalizePdfUploadEvidenceText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function quoteContainsPdfUploadHighlight(quote: string, highlight: string) {
  const normalizedQuote = normalizePdfUploadEvidenceText(quote)
  const normalizedHighlight = normalizePdfUploadEvidenceText(highlight)
  return Boolean(normalizedHighlight) && normalizedQuote.includes(normalizedHighlight)
}

function equivalentPdfUploadHighlightTerms(term: string) {
  const trimmed = pdfUploadResultValue(term)
  if (!trimmed) return []
  const variants = new Set([trimmed])
  const bracketTokens = trimmed.match(/\[[^\]]+\]/g) || []
  for (const token of bracketTokens) {
    variants.add(token)
    const bareToken = token.replace(/^\[|\]$/g, '')
    if (bareToken) variants.add(bareToken)
  }
  const compactIonChains = trimmed.replace(/\b([PN])([0-9]+(?:,[0-9]+)+)\b/gi, (_match, head, digits) => `${String(head).toUpperCase()}${String(digits).replace(/,/g, '')}`)
  variants.add(compactIonChains)
  const compactBracketTokens = compactIonChains.match(/\[[^\]]+\]/g) || []
  for (const token of compactBracketTokens) {
    variants.add(token)
    const bareToken = token.replace(/^\[|\]$/g, '')
    if (bareToken) variants.add(bareToken)
  }
  const withoutBrackets = compactIonChains.replace(/^\[|\]$/g, '')
  if (withoutBrackets && withoutBrackets !== compactIonChains) variants.add(withoutBrackets)
  if (/^[A-Za-z][A-Za-z0-9(),]+$/.test(withoutBrackets)) variants.add(`[${withoutBrackets}]`)
  return Array.from(variants).filter(Boolean)
}

function pdfUploadHighlightGroups(highlight?: string | string[]) {
  const terms = Array.isArray(highlight) ? highlight : [highlight]
  const groups: string[][] = []
  for (const term of terms) {
    const cleanTerm = pdfUploadResultValue(term)
    if (!cleanTerm) continue
    const bracketTokens = cleanTerm.match(/\[[^\]]+\]/g) || []
    if (bracketTokens.length >= 2) {
      const group = bracketTokens.flatMap((token) => equivalentPdfUploadHighlightTerms(token))
      if (group.length) groups.push(group)
    }
  }
  return groups
}

function pdfUploadHighlightTerms(highlight?: string | string[]) {
  const terms = Array.isArray(highlight) ? highlight : [highlight]
  const seen = new Set<string>()
  return terms
    .map((term) => pdfUploadResultValue(term))
    .flatMap((term) => equivalentPdfUploadHighlightTerms(term))
    .filter((term) => {
      const key = normalizePdfUploadEvidenceText(term)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function pdfUploadEvidenceQuoteFromText(text: string, highlight?: string | string[]): PdfUploadEvidenceQuote | null {
  const cleanText = pdfUploadResultValue(text)
  if (!cleanText) return null
  const highlightGroups = pdfUploadHighlightGroups(highlight).filter((group) => (
    group.every((term) => quoteContainsPdfUploadHighlight(cleanText, term))
  ))
  const highlights = pdfUploadHighlightTerms(highlight)
    .filter((term) => quoteContainsPdfUploadHighlight(cleanText, term))
  return {
    text: cleanText,
    highlights: highlights.length ? highlights : undefined,
    highlightGroups: highlightGroups.length ? highlightGroups : undefined,
  }
}

function groupPdfUploadHighlightRanges(source: string, groups: string[][]) {
  const normalizedSource = source.toLowerCase()
  const ranges: Array<{ start: number; end: number }> = []
  for (const group of groups) {
    const tokenRanges = group
      .map((term) => {
        const normalizedTerm = term.toLowerCase()
        const start = normalizedTerm ? normalizedSource.indexOf(normalizedTerm) : -1
        return start >= 0 ? { start, end: start + term.length } : null
      })
      .filter((range): range is { start: number; end: number } => Boolean(range))
      .sort((a, b) => a.start - b.start)
    if (tokenRanges.length !== group.length) continue
    const groupStart = tokenRanges[0]?.start ?? -1
    const groupEnd = tokenRanges[tokenRanges.length - 1]?.end ?? -1
    const span = source.slice(groupStart, groupEnd)
    if (!/^\s*\[[^\]]+\]\s*\[[^\]]+\]/.test(span)) continue
    ranges.push(...tokenRanges)
  }
  return ranges
}

function splitPdfUploadEvidenceQuote(quote: PdfUploadEvidenceQuote) {
  const groupedRanges = groupPdfUploadHighlightRanges(quote.text, quote.highlightGroups || [])
  const highlights = pdfUploadHighlightTerms(quote.highlights)
    .sort((a, b) => b.length - a.length)
  if (!highlights.length && !groupedRanges.length) return [{ text: quote.text, active: false }]
  const source = quote.text
  const normalizedSource = source.toLowerCase()
  const ranges: Array<{ start: number; end: number }> = [...groupedRanges]
  for (const highlight of highlights) {
    const normalizedHighlight = highlight.toLowerCase()
    let cursor = 0
    while (normalizedHighlight && cursor < normalizedSource.length) {
      const index = normalizedSource.indexOf(normalizedHighlight, cursor)
      if (index < 0) break
      const end = index + highlight.length
      const overlaps = ranges.some((range) => index < range.end && end > range.start)
      if (!overlaps) ranges.push({ start: index, end })
      cursor = end
    }
  }
  if (!ranges.length) return [{ text: source, active: false }]
  ranges.sort((a, b) => a.start - b.start)
  const parts: Array<{ text: string; active: boolean }> = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) parts.push({ text: source.slice(cursor, range.start), active: false })
    parts.push({ text: source.slice(range.start, range.end), active: true })
    cursor = range.end
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), active: false })
  return parts.filter((part) => part.text)
}

function pdfUploadEvidenceTextFromEntry(
  entry: NonNullable<TribologyData['field_evidence_json']>[string] | undefined,
  options: { includeQuote?: boolean; allowMatchedOnly?: boolean; fieldKey?: string } = {},
) {
  const evidence = entry?.evidence
  const matchedText = pdfUploadResultValue(evidence?.matched_text)
    || pdfUploadResultValue(evidence?.matchedText)
    || pdfUploadResultValue(entry?.value)
  const quote = pdfUploadResultValue(evidence?.quote)
  const groundingMode = pdfUploadResultValue(entry?.grounding_mode).toLowerCase()
  const quotes: PdfUploadEvidenceQuote[] = []
  const suppressBareEvidence = pdfUploadEvidenceShouldSuppressBareEvidence(options.fieldKey, quote, matchedText, groundingMode)
  const contextualQuote = !suppressBareEvidence && quote && matchedText && quoteContainsPdfUploadHighlight(quote, matchedText)
    ? pdfUploadEvidenceQuoteFromText(quote, matchedText)
    : null
  const contextHighlights = pdfUploadEvidenceContextualHighlights(quote || matchedText, matchedText, groundingMode)
  if (contextualQuote) {
    quotes.push(contextHighlights.length ? { ...contextualQuote, highlights: contextHighlights } : contextualQuote)
  } else if (!suppressBareEvidence && options.includeQuote && quote) {
    const metricQuote = pdfUploadEvidenceQuoteFromText(quote, contextHighlights.length ? contextHighlights : matchedText)
    if (metricQuote) quotes.push(metricQuote)
  } else if (!suppressBareEvidence && options.allowMatchedOnly && matchedText) {
    const matchedOnly = pdfUploadEvidenceQuoteFromText(matchedText, [matchedText])
    if (matchedOnly) quotes.push(matchedOnly)
  }
  const note = pdfUploadEvidenceQuoteFromText(pdfUploadResultValue(entry?.grounding_note))
  if (note) quotes.push(note)
  return quotes
}

function pdfUploadEvidenceHasDerivedScanContext(text: string) {
  const normalized = pdfUploadResultValue(text).toLowerCase()
  if (!normalized || !normalized.includes('scan')) return false
  const hasScanLength = /scan\s*(?:size|length|range)|\b\d+(?:\.\d+)?\s*(?:nm|μm|um)\b/i.test(normalized)
  const hasScanRate = /scan\s*(?:rate|frequency)|\b\d+(?:\.\d+)?\s*hz\b/i.test(normalized)
  return hasScanLength && hasScanRate
}

function pdfUploadEvidenceShouldSuppressBareEvidence(fieldKey = '', quote = '', matchedText = '', groundingMode = '') {
  const combined = `${pdfUploadResultValue(quote)} ${pdfUploadResultValue(matchedText)}`.trim()
  const matched = pdfUploadResultValue(matchedText)
  const quoteText = pdfUploadResultValue(quote)
  const isBareMatchedNumber = /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(matched)
  const isBareQuoteNumber = /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(quoteText)
  if (groundingMode === 'derived' && !pdfUploadEvidenceHasDerivedScanContext(combined)) return true
  if (isBareMatchedNumber && (!quoteText || isBareQuoteNumber)) return true
  if (fieldKey?.includes('roughness')) {
    const hasContext = /\b(?:nm|μm|um|rms|roughness|root[- ]mean[- ]square)\b/i.test(combined)
    const isBareNumber = isBareMatchedNumber || isBareQuoteNumber
    if (isBareNumber && !hasContext) return true
  }
  return false
}

function pdfUploadEvidenceHasReliableLocator(
  fieldKey = '',
  entry: NonNullable<TribologyData['field_evidence_json']>[string] | undefined,
) {
  const evidence = entry?.evidence
  const location = pdfUploadEvidenceLocationFromEntry(entry)
  if (!location.page || !location.bbox?.length) return false
  const quote = pdfUploadResultValue(evidence?.quote)
  const matchedText = pdfUploadResultValue(evidence?.matched_text)
    || pdfUploadResultValue(evidence?.matchedText)
    || pdfUploadResultValue(entry?.value)
  const groundingMode = pdfUploadResultValue(entry?.grounding_mode).toLowerCase()
  if (pdfUploadEvidenceShouldSuppressBareEvidence(fieldKey, quote, matchedText, groundingMode)) return false
  return true
}

function pdfUploadEvidenceContextualHighlights(text: string, matchedText: string, groundingMode: string) {
  const source = pdfUploadResultValue(text)
  const matched = pdfUploadResultValue(matchedText)
  if (!source || !matched) return []
  if (groundingMode === 'derived') {
    const derived = Array.from(source.matchAll(/\b(?:scan\s+(?:size|length|range|rate|frequency)\s+(?:was\s+)?)?\d+(?:\.\d+)?\s*(?:nm|μm|um|mm|hz)\b/gi))
      .map((match) => normalizePdfUploadEvidenceText(match[0]))
      .filter(Boolean)
    return derived.length ? derived : [source]
  }
  if (!/^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(matched)) return []
  const escaped = matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.]')
  const contextual = new RegExp(`(?:RMS\\s+|roughness\\s+|scan\\s+(?:size|rate)\\s+(?:was\\s+)?|velocity\\s+(?:of\\s+)?)?${escaped}\\s*(?:nm|μm|um|mm|cm|m|hz|n|mn|nn|v|mv|k|°c|c)\\b`, 'i').exec(source)
  return contextual?.[0] ? [normalizePdfUploadEvidenceText(contextual[0])] : []
}

function pdfUploadEvidenceLocationFromEntry(entry: NonNullable<TribologyData['field_evidence_json']>[string] | undefined) {
  return {
    page: entry?.evidence?.page ?? null,
    bbox: parseRecordBbox(entry?.evidence?.bbox),
  }
}

function pdfUploadEvidencePreviewKey(literatureId: string, slide: PdfUploadEvidenceSlide) {
  if (!slide.page || !slide.bbox?.length) return ''
  return [
    literatureId,
    slide.page,
    slide.fieldKey,
    ...slide.bbox.map((value) => Number(value).toFixed(1)),
  ].join(':')
}

function pdfUploadEvidenceShouldRenderPdfPreview(slide: PdfUploadEvidenceSlide) {
  if (!pdfUploadEvidenceSlideHasReliableLocator(slide)) return false
  if (String(slide.groundingMode || '').toLowerCase() === 'derived') return false
  const sourceType = String(slide.sourceType || '').toLowerCase()
  if (sourceType === 'text' && slide.quotes.length > 0) return false
  return ['table', 'figure', 'visual', 'image'].includes(sourceType) || slide.quotes.length === 0
}

async function fetchPdfUploadEvidencePreview(literatureId: string, slide: PdfUploadEvidenceSlide) {
  if (!pdfUploadEvidenceShouldRenderPdfPreview(slide)) return
  const numericLiteratureId = Number(literatureId)
  if (!Number.isFinite(numericLiteratureId) || !slide.page || !slide.bbox?.length) return
  const key = pdfUploadEvidencePreviewKey(literatureId, slide)
  if (!key || pdfUploadEvidencePreviewImages.value[key] || pdfUploadEvidencePreviewLoading.value[key]) return
  pdfUploadEvidencePreviewLoading.value[key] = true
  pdfUploadEvidencePreviewError.value[key] = null
  try {
    const response = await getPdfBboxPreview(numericLiteratureId, slide.page, slide.bbox, 'region', 'wide')
    pdfUploadEvidencePreviewImages.value[key] = `data:image/png;base64,${response.image_b64}`
  } catch (error: any) {
    pdfUploadEvidencePreviewImages.value[key] = null
    pdfUploadEvidencePreviewError.value[key] = error?.message || 'Unable to render PDF evidence preview'
  } finally {
    pdfUploadEvidencePreviewLoading.value[key] = false
  }
}

async function hydratePdfUploadEvidencePreviews(slides: PdfUploadEvidenceSlide[]) {
  const literatureId = selectedPdfUploadResultItem.value?.id
  if (!literatureId) return
  await Promise.allSettled(slides.map((slide) => fetchPdfUploadEvidencePreview(literatureId, slide)))
}

function enrichPdfUploadQuoteHighlights(quotes: PdfUploadEvidenceQuote[], value: string) {
  const valueGroups = pdfUploadHighlightGroups(value)
  const valueTerms = valueGroups.length ? [] : pdfUploadHighlightTerms(value)
  if (!valueTerms.length && !valueGroups.length) return quotes
  return quotes.map((quote) => {
    const matchingTerms = valueTerms.filter((term) => quoteContainsPdfUploadHighlight(quote.text, term))
    const matchingGroups = valueGroups.filter((group) => group.every((term) => quoteContainsPdfUploadHighlight(quote.text, term)))
    if (!matchingTerms.length && !matchingGroups.length) return quote
    return {
      ...quote,
      highlights: valueGroups.length ? undefined : pdfUploadHighlightTerms([...(quote.highlights || []), ...matchingTerms]),
      highlightGroups: [...(quote.highlightGroups || []), ...matchingGroups],
    }
  })
}

function pdfUploadQuotesForField(row: TribologyData, fieldKeys: string[], value = '') {
  const fieldEvidence = row.field_evidence_json || {}
  const isMetricField = fieldKeys.some((key) => ['cof', 'cof_extracted', 'D_total', 'D_cation', 'D_anion'].includes(key))
  const quotes = fieldKeys.flatMap((key) => pdfUploadEvidenceTextFromEntry(fieldEvidence[key], {
    includeQuote: isMetricField,
    allowMatchedOnly: isMetricField,
    fieldKey: key,
  }))
  const fallbackHighlight = isMetricField ? pdfUploadResultMetric(row) : value
  const fallback = [
    pdfUploadEvidenceQuoteFromText(pdfUploadResultValue(row.evidence), fallbackHighlight),
    pdfUploadEvidenceQuoteFromText(pdfUploadResultValue(row.notes), fallbackHighlight),
  ].filter((quote): quote is PdfUploadEvidenceQuote => Boolean(quote))
  const merged = new Map<string, PdfUploadEvidenceQuote>()
  for (const quote of enrichPdfUploadQuoteHighlights([...quotes, ...fallback], value)) {
    const key = normalizePdfUploadEvidenceText(quote.text)
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, quote)
      continue
    }
    existing.highlights = pdfUploadHighlightTerms([...(existing.highlights || []), ...(quote.highlights || [])])
    existing.highlightGroups = [...(existing.highlightGroups || []), ...(quote.highlightGroups || [])]
  }
  return Array.from(merged.values()).slice(0, 4)
}

function pdfUploadEvidenceLocationForField(row: TribologyData, fieldKeys: string[]) {
  const fieldEvidence = row.field_evidence_json || {}
  for (const key of fieldKeys) {
    const location = pdfUploadEvidenceLocationFromEntry(fieldEvidence[key])
    if (location.page || location.bbox) return location
  }
  return {
    page: row.source_page ?? null,
    bbox: parseRecordBbox(row.source_bbox),
  }
}

function normalizePdfUploadEvidenceFieldKey(fieldKey: string) {
  return String(fieldKey || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function pdfUploadEvidenceSemanticKey(fieldKey: string) {
  const normalized = normalizePdfUploadEvidenceFieldKey(fieldKey)
  const aliases: Record<string, string> = {
    ionic_liquid_display: 'ionic_liquid',
    lubricant_alias: 'ionic_liquid',
    lubricant: 'ionic_liquid',
    material_name: 'substrate_material',
    normal_load: 'load',
    cof_extracted: 'cof',
  }
  return aliases[normalized] || normalized
}

function pdfUploadEvidenceFieldLabel(fieldKey: string, fallbackLabel = '') {
  const normalized = normalizePdfUploadEvidenceFieldKey(fieldKey)
  const labels: Record<string, string> = {
    ionic_liquid: 'Ionic liquid',
    ionic_liquid_display: 'Ionic liquid',
    lubricant_alias: 'Ionic liquid',
    cation: 'Cation',
    anion: 'Anion',
    probe_material: 'Probe',
    substrate_material: 'Substrate',
    material_name: 'Substrate',
    tribological_system: 'Tribopair',
    temperature: 'Temperature',
    load: 'Load',
    normal_load: 'Load',
    speed: 'Sliding speed',
    potential: 'Potential',
    water_content: 'Water content',
    cof: 'COF',
    cof_extracted: 'COF',
    d_total: 'D total',
    d_cation: 'D cation',
    d_anion: 'D anion',
    diffusion_standard_fields: 'Diffusion',
  }
  return labels[normalized] || fallbackLabel || fieldKey
}

function pdfUploadEvidenceFieldValue(row: TribologyData, fieldKey: string, fallbackValue = '') {
  const normalized = normalizePdfUploadEvidenceFieldKey(fieldKey)
  const fieldEvidence = row.field_evidence_json || {}
  const evidenceValue = pdfUploadResultValue(fieldEvidence[fieldKey]?.value)
  if (evidenceValue) return evidenceValue

  if (normalized === 'ionic_liquid' || normalized === 'ionic_liquid_display' || normalized === 'lubricant_alias') return pdfUploadResultIonicLiquid(row)
  if (normalized === 'cation') return compactIonPartText(row.cation)
  if (normalized === 'anion') return compactIonPartText(row.anion)
  if (normalized === 'probe_material') return pdfUploadResultValue(row.probe_material)
  if (normalized === 'substrate_material') return pdfUploadResultValue(row.substrate_material) || pdfUploadResultValue(row.material_name)
  if (normalized === 'material_name') return pdfUploadResultValue(row.material_name) || pdfUploadResultValue(row.substrate_material)
  if (normalized === 'tribological_system') return pdfUploadResultValue(row.tribological_system) || pdfUploadResultValue(row.system_name)
  if (normalized === 'temperature') return pdfUploadResultValue(row.temperature)
  if (normalized === 'load' || normalized === 'normal_load') return pdfUploadResultValue(row.load) || pdfUploadResultValue(row.normal_load)
  if (normalized === 'speed') return pdfUploadResultValue(row.speed)
  if (normalized === 'potential') return pdfUploadResultValue(row.potential)
  if (normalized === 'water_content') return pdfUploadResultValue(row.water_content)
  if (normalized === 'cof' || normalized === 'cof_extracted') return pdfUploadResultMetric(row)
  if (normalized === 'd_total') return row.D_total !== null && row.D_total !== undefined ? `${row.D_total}${row.D_unit ? ` ${row.D_unit}` : ''}` : ''
  if (normalized === 'd_cation') return row.D_cation !== null && row.D_cation !== undefined ? `${row.D_cation}${row.D_unit ? ` ${row.D_unit}` : ''}` : ''
  if (normalized === 'd_anion') return row.D_anion !== null && row.D_anion !== undefined ? `${row.D_anion}${row.D_unit ? ` ${row.D_unit}` : ''}` : ''
  if (normalized === 'diffusion_standard_fields') return fallbackValue
  return fallbackValue === '--' ? '' : pdfUploadResultValue(fallbackValue)
}

function pdfUploadEvidenceSlideHasContent(slide: PdfUploadEvidenceSlide) {
  return Boolean(slide.quotes.length || pdfUploadEvidenceSlideHasReliableLocator(slide))
}

function pdfUploadEvidenceSlideHasReliableLocator(slide: PdfUploadEvidenceSlide) {
  return Boolean(slide.hasReliableLocator && slide.page && slide.bbox?.length)
}

function pdfUploadEvidenceSlideQualityScore(slide: PdfUploadEvidenceSlide) {
  let score = 0
  if (pdfUploadResultValue(slide.value)) score += 3
  if (slide.quotes.length) score += 4 + slide.quotes.length
  if (slide.page) score += 1
  if (slide.bbox?.length) score += 1
  if (slide.actionFieldKey) score += 1
  return score
}

function pdfUploadBestEvidenceSlidesBySemanticKey(slides: PdfUploadEvidenceSlide[]) {
  const bySemantic = new Map<string, PdfUploadEvidenceSlide>()
  for (const slide of slides) {
    const semanticKey = pdfUploadEvidenceSemanticKey(slide.fieldKey)
    const existing = bySemantic.get(semanticKey)
    if (!existing || pdfUploadEvidenceSlideQualityScore(slide) > pdfUploadEvidenceSlideQualityScore(existing)) {
      bySemantic.set(semanticKey, slide)
    }
  }
  return Array.from(bySemantic.values())
}

function pdfUploadEvidenceSlidesForField(row: TribologyData, fieldLabel: string, fieldKeys: string[], fallbackValue = '') {
  const candidateSlides: PdfUploadEvidenceSlide[] = []
  for (const fieldKey of fieldKeys) {
    const evidenceEntry = row.field_evidence_json?.[fieldKey]
    const value = pdfUploadEvidenceFieldValue(row, fieldKey, fallbackValue)
    const quotes = pdfUploadQuotesForField(row, [fieldKey], value)
    const location = pdfUploadEvidenceLocationForField(row, [fieldKey])
    const slide: PdfUploadEvidenceSlide = {
      fieldKey,
      fieldKeys: [fieldKey],
      actionFieldKey: firstAvailablePdfUploadReviewFieldKey(fieldLabel, [fieldKey], row.field_evidence_json),
      label: pdfUploadEvidenceFieldLabel(fieldKey, fieldLabel),
      value,
      quotes,
      sourceType: pdfUploadResultValue(evidenceEntry?.evidence?.source_type),
      groundingMode: pdfUploadResultValue(evidenceEntry?.grounding_mode),
      hasReliableLocator: pdfUploadEvidenceHasReliableLocator(fieldKey, evidenceEntry),
      ...location,
    }
    if (!pdfUploadEvidenceSlideHasContent(slide)) continue
    candidateSlides.push(slide)
  }

  const seenSemanticKeys = new Set<string>()
  const slides: PdfUploadEvidenceSlide[] = []
  for (const slide of pdfUploadBestEvidenceSlidesBySemanticKey(candidateSlides)) {
    const semanticKey = pdfUploadEvidenceSemanticKey(slide.fieldKey)
    if (seenSemanticKeys.has(semanticKey)) continue
    seenSemanticKeys.add(semanticKey)
    slides.push(slide)
  }
  return slides
}

function activePdfUploadEvidenceSlide() {
  const evidence = activePdfUploadEvidence.value
  if (!evidence?.slides.length) return null
  const boundedIndex = Math.min(Math.max(0, pdfUploadEvidenceSlideIndex.value), evidence.slides.length - 1)
  if (boundedIndex !== pdfUploadEvidenceSlideIndex.value) pdfUploadEvidenceSlideIndex.value = boundedIndex
  return evidence.slides[boundedIndex] || null
}

function activePdfUploadEvidenceSlideCount() {
  return activePdfUploadEvidence.value?.slides.length || 0
}

function activePdfUploadEvidenceSlideIndexLabel() {
  const count = activePdfUploadEvidenceSlideCount()
  if (count <= 0) return ''
  return `${Math.min(pdfUploadEvidenceSlideIndex.value + 1, count)}/${count}`
}

function activePdfUploadEvidenceValue() {
  return activePdfUploadEvidenceSlide()?.value || activePdfUploadEvidence.value?.value || '--'
}

function activePdfUploadEvidencePageLabel() {
  const page = activePdfUploadEvidenceSlide()?.page ?? activePdfUploadEvidence.value?.page
  return page ? `Page ${page}` : 'Source'
}

function activePdfUploadEvidenceQuotes() {
  return activePdfUploadEvidenceSlide()?.quotes || activePdfUploadEvidence.value?.quotes || []
}

function activePdfUploadEvidencePreviewKey() {
  const literatureId = selectedPdfUploadResultItem.value?.id
  const slide = activePdfUploadEvidenceSlide()
  return literatureId && slide ? pdfUploadEvidencePreviewKey(literatureId, slide) : ''
}

function activePdfUploadEvidenceImageSrc() {
  const key = activePdfUploadEvidencePreviewKey()
  return key ? pdfUploadEvidencePreviewImages.value[key] || null : null
}

function activePdfUploadEvidenceImageLoading() {
  const key = activePdfUploadEvidencePreviewKey()
  return key ? Boolean(pdfUploadEvidencePreviewLoading.value[key]) : false
}

function activePdfUploadEvidenceImageError() {
  const key = activePdfUploadEvidencePreviewKey()
  return key ? pdfUploadEvidencePreviewError.value[key] || '' : ''
}

function activePdfUploadEvidenceActionFieldKey() {
  return activePdfUploadEvidenceSlide()?.actionFieldKey || activePdfUploadEvidence.value?.actionFieldKey || ''
}

function movePdfUploadEvidenceSlide(direction: -1 | 1) {
  const count = activePdfUploadEvidenceSlideCount()
  if (count <= 1) return
  pdfUploadEvidenceSlideIndex.value = (pdfUploadEvidenceSlideIndex.value + direction + count) % count
}

function openPdfUploadCellEvidence(
  row: TribologyData,
  rowIndex: number,
  fieldLabel: string,
  value: string,
  fieldKeys: string[],
  event: MouseEvent,
) {
  const target = event.currentTarget as HTMLElement | null
  const rect = target?.getBoundingClientRect()
  const width = 430
  pdfUploadEvidencePosition.value = rect
    ? {
        top: Math.min(window.innerHeight - 300, rect.bottom + 10),
        left: Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2)),
      }
    : { top: 160, left: 160 }
  const slides = pdfUploadEvidenceSlidesForField(row, fieldLabel, fieldKeys, value)
  pdfUploadEvidenceSlideIndex.value = 0
  activePdfUploadEvidence.value = {
    row,
    rowIndex,
    fieldLabel,
    fieldKeys,
    actionFieldKey: slides[0]?.actionFieldKey || firstAvailablePdfUploadReviewFieldKey(fieldLabel, fieldKeys, row.field_evidence_json),
    value,
    quotes: pdfUploadQuotesForField(row, fieldKeys, value),
    slides,
    ...pdfUploadEvidenceLocationForField(row, fieldKeys),
  }
  void hydratePdfUploadEvidencePreviews(slides)
}

function openPdfUploadEvidencePaper() {
  const item = selectedPdfUploadResultItem.value
  const evidence = activePdfUploadEvidence.value
  if (!item || !evidence) return
  pdfUploadModalOpen.value = false
  activePdfUploadEvidence.value = null
  void openSourceGroundingTarget({
    literatureId: Number(item.id),
    recordId: Number(evidence.row.id || 0) || null,
  })
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
  const normalizedStatus = String(run?.status || '').toLowerCase()
  if (['no_data', 'completed'].includes(normalizedStatus) && !pdfUploadRunHasReviewableData(run)) {
    return String(
      summary?.no_data_reason
      || run?.error_message
      || latestProgress
      || summary?.current_message
      || '',
    )
  }
  return String(
    summary?.current_message
    || run?.error_message
    || latestProgress
    || summary?.no_data_reason
    || '',
  )
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
  if (normalizedStage.startsWith('stage_b.fast_text')) return 24
  if (normalizedStage.startsWith('stage_b')) return 24
  if (normalizedStage.startsWith('stage_c.fast_text_start') && chunkIndex > 0 && chunkTotal > 0) {
    return 30 + ((chunkIndex - 1) / Math.max(1, chunkTotal)) * 42
  }
  if (normalizedStage.startsWith('stage_c.fast_text_done') && chunkIndex > 0 && chunkTotal > 0) {
    return 34 + (chunkIndex / Math.max(1, chunkTotal)) * 42
  }
  if (normalizedStage.startsWith('stage_c.fast_text_start')) return 34
  if (normalizedStage.startsWith('stage_c.fast_text_done')) return 76
  if (normalizedStage.startsWith('stage_c.fast_text')) return 52
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
  const initialMessage = initialResponse.message || ''
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

  const summary = initialResponse.extraction_summary as ExtractionSummary | undefined
  const initialHasNoReviewableData = initialRecords === 0 && (initialStatus === 'no_data' || initialStatus === 'completed')
  updatePdfUploadExtractionItem(paperId, {
    status: initialHasNoReviewableData ? 'no_data' : 'completed',
    records: initialRecords,
    extractedRows: initialRows,
    progress: 100,
	    message: initialRecords > 0
	      ? (preset === 'diffusion' || pdfUploadHasWeakCandidates(initialRows) ? `${initialRecords} candidates need review.` : `${initialRecords} ${label} records extracted.`)
	      : (summary?.no_data_reason || initialResponse.message || `No extractable ${label.toLowerCase()} records found.`),
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
        message: 'Conductivity extraction is not available yet. Choose Tribology or Diffusion.',
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

async function stopPdfUploadExtractionAndUploadNew() {
  if (pdfUploadExtractionCancelling.value) return
  if (pdfUploadExtracting.value) {
    await cancelPdfUploadExtraction()
  }
  resetPdfUploadForFreshUpload()
  pdfUploadModalOpen.value = true
  pdfUploadStatusMessage.value = 'Add PDFs for a fresh extraction run.'
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

function openElicitTool(item: ElicitToolItem) {
  if (isElicitItemLocked(item)) return
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

  <LoginScreen
    v-else-if="!sessionState.user"
    :loading="isAuthenticating"
    :error="authError"
    @submit="handleLogin"
  />

  <BlogView
    v-else-if="isBlogView"
    :operator-name="operatorName"
    @exit="navigateTo('help', 'content')"
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
      :operator-role="operatorRole"
      :selected-scope-key="selectedScopeKey"
      :available-scopes="availableScopes"
      :is-dark="isDark"
      :is-chinese="isChinese"
      @navigate="navigateTo"
      @select-file="setSelectedFile"
      @toggle-dark="toggleDarkMode"
      @logout="handleLogout"
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
              <button
                type="button"
                class="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-[#0f7c82] sm:inline-flex"
                @click="navigateTo('help', 'quick-start')"
              >
                Help
                <ChevronDown class="h-4 w-4 text-slate-500" />
              </button>
              <div class="relative">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-[9px] px-1.5 py-1 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 hover:text-[#0f7c82]"
                  :aria-expanded="accountMenuOpen"
                  aria-label="Account menu"
                  @click="accountMenuOpen = !accountMenuOpen"
                >
                  <span class="grid h-8 w-8 place-items-center rounded-full bg-[#0f7c82] text-xs font-black text-white shadow-[0_14px_30px_-20px_rgba(15,124,130,0.95)]">
                    {{ operatorInitial }}
                  </span>
                  <span class="hidden max-w-[9rem] truncate text-left md:block">{{ operatorName }}</span>
                  <ChevronDown
                    class="hidden h-4 w-4 text-slate-400 transition md:block"
                    :class="accountMenuOpen ? 'rotate-180 text-[#0f7c82]' : ''"
                  />
                </button>

                <div
                  v-if="accountMenuOpen"
                  class="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[calc(100vw-2rem)] overflow-hidden rounded-[12px] border border-slate-200 bg-white p-2 text-slate-950 shadow-[0_22px_54px_-36px_rgba(15,23,42,0.75)] sm:w-[20rem]"
                >
                  <div class="flex min-w-0 items-center gap-3 px-2 py-2.5">
                    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0f7c82] text-sm font-black text-white">
                      {{ operatorInitial }}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-baseline gap-2">
                        <p class="truncate text-base font-semibold text-slate-900">{{ operatorName }}</p>
                        <p class="truncate text-sm font-medium text-slate-400">{{ operatorAccountLine }}</p>
                      </div>
                      <p class="mt-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#0f7c82]">{{ operatorRole }}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    class="mt-1 flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50 hover:text-[#0f7c82]"
                    @click="openAccountSettings"
                  >
                    <UserCog class="h-4 w-4 text-slate-500" />
                    Account settings
                  </button>

                  <button
                    type="button"
                    class="mt-1 flex h-10 w-full items-center gap-3 rounded-[9px] bg-slate-100 px-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-rose-50 hover:text-rose-600"
                    @click="logoutFromAccountMenu"
                  >
                    <LogOut class="h-4 w-4 text-slate-500" />
                    Log out
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-[#0f7c82] sm:hidden"
                aria-label="Help"
                @click="navigateTo('help', 'quick-start')"
              >
                <HelpCircle class="h-4 w-4" />
              </button>
            </div>
          </header>

          <div class="flex min-h-0 flex-1 overflow-hidden">
            <Transition name="elicit-sidebar-slide">
              <aside
                v-if="currentView === 'home'"
                class="hidden w-[20rem] shrink-0 border-r border-slate-200 bg-slate-50/70 xl:flex xl:flex-col"
              >
                <div class="flex-1 px-6 py-7">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Workflows</p>
                  <nav class="mt-5 space-y-1">
                    <button
                      v-for="item in elicitWorkflowItems"
                      :key="item.label"
                      type="button"
                      class="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition"
                      :class="item.active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-950'"
                    >
                      <span class="flex items-center gap-3">
                        <component :is="item.icon" class="h-4 w-4 text-slate-500" />
                        {{ item.label }}
                      </span>
                      <Lock v-if="isElicitItemLocked(item)" class="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  </nav>

                  <p class="mt-9 text-xs font-semibold uppercase tracking-wide text-slate-400">Tools</p>
                  <nav class="mt-5 space-y-1">
                    <button
                      v-for="item in elicitToolItems"
                      :key="item.label"
                      type="button"
                      class="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-600 transition hover:bg-white hover:text-slate-950"
                      @click="openElicitTool(item)"
                    >
                      <span class="flex items-center gap-3">
                        <component :is="item.icon" class="h-4 w-4 text-slate-500" />
                        {{ item.label }}
                      </span>
                      <Lock v-if="isElicitItemLocked(item)" class="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  </nav>
                </div>

                <div class="border-t border-slate-200 px-6 py-7">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Recents</p>
                  <p class="mt-4 text-sm text-slate-500">No recent home searches yet.</p>
                </div>
              </aside>
            </Transition>

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
                @open-help="navigateTo('help', 'quick-start')"
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
          <section class="w-full max-w-[72rem] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div class="flex items-center justify-between px-1 pb-3">
              <h2 id="pdf-upload-modal-title" class="text-lg font-extrabold tracking-tight text-slate-900">
                {{ pdfUploadModalStep === 'upload' ? 'Upload papers' : 'Explore the scientific literature' }}
              </h2>
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
                  <CloudUpload class="h-11 w-11 text-violet-500" />
                  <p class="mt-4 text-base font-extrabold text-violet-600">Drag and drop PDFs</p>
                  <p class="mt-1 text-sm font-semibold text-violet-500/80">Or click to browse files</p>
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
	                  <FileText class="h-5 w-5 shrink-0 text-violet-500" />
	                  <span class="min-w-0 flex-1">
	                    <span class="block truncate">{{ file.name }}</span>
	                    <span
	                      v-if="pdfUploadUploadProgress[pdfUploadFileKey(file)]?.percent != null"
	                      class="mt-1 block text-xs font-bold text-violet-500"
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
                  class="inline-flex h-10 items-center rounded-md bg-violet-500 px-5 text-sm font-extrabold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-55"
                  :disabled="pdfUploadUploading || queuedPdfUploadFiles.length === 0"
                  @click="uploadQueuedPdfFiles"
                >
                  {{ pdfUploadUploading ? 'Uploading...' : 'Upload PDFs' }}
                </button>
              </div>
              <div class="mt-6 flex justify-end">
                <button
                  type="button"
                  class="grid h-11 w-11 place-items-center rounded-full bg-violet-400 text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-55"
                  aria-label="Continue to extraction setup"
                  :disabled="pdfUploadUploading || !pdfUploadCanContinueFromUpload"
                  @click="continueFromPdfUploadModal"
                >
                  <ArrowRight class="h-5 w-5 stroke-[2.4]" />
                </button>
              </div>
            </div>

            <div v-else-if="pdfUploadModalStep === 'select'">
              <div class="mb-4 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-sm font-extrabold text-slate-500">
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <Search class="h-4 w-4" />
                  Find papers
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 bg-white px-4 py-3 text-violet-600 shadow-sm">
                  <Upload class="h-4 w-4" />
                  Extract data from PDFs
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <LayoutGrid class="h-4 w-4" />
                  List of concepts
                </button>
              </div>

              <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 class="text-xl font-extrabold text-slate-900">Select or upload papers</h3>
                <p class="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">
                  Parsed metadata for {{ uploadedPdfPapers.length }} uploaded papers<span v-if="pdfUploadPendingFileNames.length">, {{ pdfUploadPendingFileNames.length }} still parsing</span>. Select papers to extract information or upload additional papers.
                </p>
                <div class="mt-5 flex flex-wrap items-center gap-3">
                  <div class="flex items-center gap-3">
                    <button type="button" class="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-400">
                      <Search class="h-5 w-5" />
                    </button>
                    <button type="button" class="h-10 rounded-md border border-slate-200 px-5 text-sm font-extrabold text-slate-500">
                      Sort
                    </button>
                    <button
                      type="button"
                      class="h-10 rounded-md border border-slate-200 px-5 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-600"
                      @click="pdfUploadModalStep = 'upload'"
                    >
                      + Upload papers
                    </button>
                  </div>
                  <div
                    v-if="shouldShowPdfUploadBatchProgress"
                    class="ml-auto min-w-[17rem] rounded-lg border border-violet-100 bg-violet-50/60 px-4 py-2 shadow-sm"
                    aria-label="Upload parsing progress"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-xs font-black uppercase tracking-[0.14em] text-violet-500">
                        {{ pdfUploadUploading ? 'Parsing' : 'Parsed' }}
                      </span>
                      <strong class="font-mono text-sm font-black text-violet-700">{{ pdfUploadBatchFinished }} / {{ pdfUploadBatchTotal }}</strong>
                    </div>
                    <div class="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-violet-100">
                      <div
                        class="h-full rounded-full bg-gradient-to-r from-violet-500 to-teal-400 transition-all duration-500 ease-out"
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
                    class="flex w-full items-start gap-4 border-b border-slate-100 px-5 py-4 text-left transition last:border-b-0 hover:bg-violet-50/45"
                    @click="togglePdfUploadLibraryFile(paper.id)"
                  >
                    <span
                      class="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded border"
                      :class="selectedPdfUploadFileIds.includes(paper.id) ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-200 bg-white'"
                    >
                      <Check v-if="selectedPdfUploadFileIds.includes(paper.id)" class="h-3.5 w-3.5 stroke-[3]" />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-base font-extrabold text-violet-700">
                        {{ paper.title }}
                      </span>
                      <span class="mt-1 block truncate text-sm font-semibold text-slate-500">
                        {{ compactAuthorLine(paper.authors) }}
                      </span>
                    </span>
                  </button>
                  <div v-if="uploadedPdfPapers.length === 0 && pdfUploadPendingFileNames.length > 0" key="parsing" class="px-5 py-8 text-center">
                    <Loader2 class="mx-auto h-5 w-5 animate-spin text-violet-500" />
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
                    class="inline-flex h-11 items-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-55"
                    :disabled="uploadedPdfPapers.length === 0"
                    @click="openPdfUploadExtractionSetup"
                  >
                    <Upload class="h-4 w-4" />
                    Start extraction
                  </button>
                </div>
              </div>
            </div>

            <div v-else-if="pdfUploadModalStep === 'setup'">
              <div class="mb-4 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-sm font-extrabold text-slate-500">
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <Search class="h-4 w-4" />
                  Find papers
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 bg-white px-4 py-3 text-violet-600 shadow-sm">
                  <Upload class="h-4 w-4" />
                  Extract data from PDFs
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <LayoutGrid class="h-4 w-4" />
                  List of concepts
                </button>
              </div>

              <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p class="text-xs font-black uppercase tracking-[0.18em] text-violet-500">Extraction mode</p>
                    <h3 class="mt-1 text-xl font-extrabold text-slate-900">Start extraction</h3>
                    <p class="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                      Choose how these newly added Library papers should be processed before extraction starts.
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
                    <FileText class="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />
                    <span class="min-w-0 flex-1">
                      <strong class="block truncate text-sm font-extrabold text-slate-900">{{ paper.title }}</strong>
                      <span class="mt-1 block truncate text-xs font-semibold text-slate-500">{{ compactAuthorLine(paper.authors) }}</span>
                    </span>
                    <label class="shrink-0">
                      <span class="sr-only">Extraction preset</span>
                      <select
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 shadow-sm transition hover:border-violet-300 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                        :value="presetForPdfUploadedPaper(paper)"
                        @change="setPdfUploadedPaperExtractionPreset(paper.id, $event)"
                      >
                        <option
                          v-for="option in pdfUploadExtractionPresetOptions"
                          :key="option.value"
                          :value="option.value"
                          :disabled="Boolean(option.disabled)"
                        >
                          {{ option.label }}{{ option.disabled ? ' · Coming soon' : '' }}
                        </option>
                      </select>
                    </label>
                  </div>
                </div>

                <div class="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    class="inline-flex h-10 items-center rounded-md border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-600"
                    @click="pdfUploadModalStep = 'select'"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-11 items-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-55"
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
              <div class="mb-4 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-sm font-extrabold text-slate-500">
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <Search class="h-4 w-4" />
                  Find papers
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 bg-white px-4 py-3 text-violet-600 shadow-sm">
                  <Upload class="h-4 w-4" />
                  Extract data from PDFs
                </button>
                <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
                  <LayoutGrid class="h-4 w-4" />
                  List of concepts
                </button>
              </div>

              <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
		                      class="inline-flex h-10 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-extrabold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
		                      :disabled="pdfUploadExtractionCancelling"
		                      @click="stopPdfUploadExtractionAndUploadNew"
		                    >
		                      <Upload class="h-4 w-4" />
		                      Stop and upload new PDF
		                    </button>
		                    <button
		                      v-if="pdfUploadExtracting"
		                      type="button"
		                      class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-700"
		                      @click="closePdfUploadModal"
		                    >
		                      Continue in background
		                    </button>
		                    <div class="text-right">
	                      <strong class="block text-2xl font-black text-violet-600">{{ pdfUploadExtractionProgress }}%</strong>
	                      <span class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Progress</span>
	                    </div>
	                  </div>
	                </div>
                <div class="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100 shadow-inner">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-teal-500 shadow-[0_0_16px_rgba(124,58,237,0.25)] transition-all duration-700 ease-out"
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
	                      :class="item.status === 'extracting' ? 'bg-violet-100 text-violet-600' : item.status === 'failed' || item.status === 'cancelled' ? 'bg-red-50 text-red-500' : item.status === 'no_data' ? 'bg-amber-50 text-amber-700' : item.status === 'queued' ? 'bg-slate-100 text-slate-400' : 'bg-teal-50 text-teal-700'"
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
	                        Open in Database
	                        <ArrowRight class="h-4 w-4" />
	                      </p>
	                      <button
	                        v-else-if="['no_data', 'failed', 'cancelled'].includes(item.status) && !pdfUploadExtracting"
	                        type="button"
	                        class="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-extrabold text-amber-800 transition hover:bg-amber-100"
	                        @click.stop="changePdfUploadExtractionType"
	                      >
	                        Review setup
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
	                      Retry fresh run
	                      <ArrowRight class="h-4 w-4" />
	                    </button>
	                    <button
	                      type="button"
	                      class="inline-flex h-10 items-center gap-2 rounded-md border border-amber-200 bg-white px-4 text-sm font-extrabold text-amber-800 transition hover:bg-amber-50"
	                      @click="changePdfUploadExtractionType"
	                    >
	                      Review setup
	                      <ArrowRight class="h-4 w-4" />
	                    </button>
	                    <button
	                      type="button"
	                      class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-700"
	                      @click="uploadAnotherPdfAfterExtraction"
	                    >
	                      Upload another PDF
	                      <Upload class="h-4 w-4" />
	                    </button>
	                  </div>
	                </div>
	              </div>
	            </div>

            <div v-else-if="pdfUploadModalStep === 'results'">
              <div class="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                  <div>
                    <p class="text-xs font-black uppercase tracking-[0.16em] text-[#0f7c82]">Extraction results</p>
                    <h3 class="mt-1 text-xl font-black tracking-tight text-slate-950">Extracted table</h3>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-[#0f7c82]">
                      {{ selectedPdfUploadResultPreset }} · {{ pdfUploadResultRows.length }} records
                    </span>
                    <span class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                      {{ pdfUploadReviewSummary.label }}
                    </span>
                  </div>
                </div>
                <p v-if="pdfUploadReviewActionError" class="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm font-bold leading-6 text-rose-700">
                  {{ pdfUploadReviewActionError }}
                </p>
                <div
                  v-if="pdfUploadRecoverableExtractionItems.length > 0"
                  class="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3"
                >
                  <p class="text-sm font-semibold text-amber-800">
                    {{ pdfUploadRecoverableSummaryLabel }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="inline-flex h-9 items-center gap-2 rounded-md bg-amber-600 px-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-amber-700"
                      @click="retryPdfUploadRecoverableExtraction"
                    >
                      Retry fresh run
                      <ArrowRight class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-sm font-extrabold text-amber-800 transition hover:bg-amber-50"
                      @click="changePdfUploadExtractionType"
                    >
                      Review setup
                      <ArrowRight class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-700"
                      @click="uploadAnotherPdfAfterExtraction"
                    >
                      Upload another PDF
                      <Upload class="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div
                  v-if="pdfUploadCompletedExtractionItems.length > 1"
                  class="flex gap-2 overflow-x-auto border-b border-slate-100 px-5 py-3"
                >
                  <button
                    v-for="item in pdfUploadCompletedExtractionItems"
                    :key="item.id"
                    type="button"
                    class="max-w-[18rem] shrink-0 rounded-lg border px-3 py-2 text-left transition"
                    :class="selectedPdfUploadResultItem?.id === item.id ? 'border-teal-300 bg-teal-50 text-[#0f7c82]' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-200 hover:bg-teal-50/40'"
                    @click="openPdfUploadExtractionResults(item)"
                  >
                    <strong class="block truncate text-sm font-black">{{ item.title }}</strong>
                    <span class="mt-1 block text-xs font-bold opacity-75">{{ item.records }} records</span>
                  </button>
                </div>

                <div v-if="selectedPdfUploadResultItem?.resultLoading" class="grid min-h-[18rem] place-items-center">
                  <div class="text-center">
                    <Loader2 class="mx-auto h-6 w-6 animate-spin text-violet-500" />
                    <p class="mt-3 text-sm font-bold text-slate-500">Loading extracted rows...</p>
                  </div>
                </div>
                <div v-else-if="pdfUploadResultRows.length === 0" class="grid min-h-[18rem] place-items-center px-6 text-center">
                  <div>
                    <Database class="mx-auto h-8 w-8 text-slate-300" />
                    <p class="mt-3 text-base font-extrabold text-slate-700">No rows loaded in this preview</p>
                    <p class="mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-500">
                      {{ selectedPdfUploadResultItem?.resultError || 'The extraction finished, but the preview endpoint did not return rows for this paper yet.' }}
                    </p>
                    <button
                      v-if="selectedPdfUploadResultItem"
                      type="button"
                      class="mt-4 inline-flex h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                      @click="openPdfUploadExtractionResults(selectedPdfUploadResultItem)"
                    >
                      Reload results
                    </button>
                  </div>
                </div>
                <div v-else class="max-h-[29rem] overflow-auto">
                  <table class="min-w-full border-separate border-spacing-0 text-left">
                    <thead class="sticky top-0 z-10 bg-slate-50">
                      <tr class="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                        <th class="w-20 border-b border-slate-200 px-5 py-4">ID</th>
                        <th class="min-w-[9rem] border-b border-slate-200 px-5 py-4">Review status</th>
                        <th class="min-w-[13rem] border-b border-slate-200 px-5 py-4">Ionic liquid</th>
                        <th class="min-w-[14rem] border-b border-slate-200 px-5 py-4">Tribopair</th>
                        <th class="min-w-[18rem] border-b border-slate-200 px-5 py-4">Conditions</th>
                        <th class="min-w-[9rem] border-b border-slate-200 px-5 py-4 text-[#0f7c82]">
                          {{ selectedPdfUploadResultPreset === 'diffusion' ? 'Diffusion' : 'COF' }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(row, index) in pdfUploadResultRows"
                        :key="`${selectedPdfUploadResultItem?.id || 'paper'}-${pdfUploadResultId(row, index)}-${index}`"
                        class="align-top transition hover:bg-teal-50/35"
                      >
                        <td class="border-b border-slate-100 px-5 py-4 font-mono text-sm font-bold text-slate-500">
                          {{ pdfUploadResultId(row, index) }}
                        </td>
                        <td class="border-b border-slate-100 px-5 py-4">
                          <span
                            class="inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em]"
                            :class="extractionReviewStatusClass(pdfUploadReviewStatus(row))"
                          >
                            {{ extractionReviewStatusLabel(pdfUploadReviewStatus(row)) }}
                          </span>
                          <div class="mt-1 flex flex-wrap gap-1">
                            <span
                              v-if="pdfUploadRowConfidenceLabel(row)"
                              class="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500"
                            >
                              {{ pdfUploadRowConfidenceLabel(row) }}
                            </span>
                            <span
                              v-for="label in pdfUploadRowMissingLabels(row)"
                              :key="`${pdfUploadResultId(row, index)}-${label}`"
                              class="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"
                            >
                              {{ label }}
                            </span>
                          </div>
                        </td>
                        <td class="border-b border-slate-100 px-5 py-4">
                          <button
                            type="button"
                            class="block w-full rounded-md px-2 py-1 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-100"
                            @click.stop="openPdfUploadCellEvidence(row, index, 'Ionic liquid', pdfUploadResultIonicLiquid(row), ['ionic_liquid', 'ionic_liquid_display', 'lubricant_alias', 'cation', 'anion'], $event)"
                          >
                          <strong class="block text-sm font-black text-slate-900">
                            <ChemicalText :text="pdfUploadResultIonicLiquid(row)" />
                          </strong>
                          <span v-if="pdfUploadIonPartLine(row)" class="mt-1 block text-xs font-semibold text-slate-500">
                            {{ pdfUploadIonPartLine(row) }}
                          </span>
                          </button>
                        </td>
                        <td class="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-700">
                          <button
                            type="button"
                            class="block w-full rounded-md px-2 py-1 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-100"
                            @click.stop="openPdfUploadCellEvidence(row, index, 'Tribopair', pdfUploadResultTribopair(row), ['probe_material', 'substrate_material', 'material_name', 'tribological_system'], $event)"
                          >
                            <ChemicalText :text="pdfUploadResultTribopair(row)" />
                          </button>
                        </td>
                        <td class="border-b border-slate-100 px-5 py-4 text-sm font-semibold leading-6 text-slate-600">
                          <button
                            type="button"
                            class="block w-full rounded-md px-2 py-1 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-100"
                            @click.stop="openPdfUploadCellEvidence(row, index, 'Conditions', pdfUploadResultConditions(row), ['temperature', 'load', 'normal_load', 'speed', 'potential', 'water_content'], $event)"
                          >
                            <ChemicalText :text="pdfUploadResultConditions(row)" />
                          </button>
                        </td>
                        <td class="border-b border-slate-100 px-5 py-4 text-base font-black text-blue-600">
                          <button
                            type="button"
                            class="block w-full rounded-md px-2 py-1 text-left transition hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-100"
                            @click.stop="openPdfUploadCellEvidence(row, index, selectedPdfUploadResultPreset === 'diffusion' ? 'Diffusion' : 'COF', pdfUploadResultMetric(row), selectedPdfUploadResultPreset === 'diffusion' ? ['D_total', 'D_cation', 'D_anion', 'diffusion_standard_fields'] : ['cof', 'cof_extracted'], $event)"
                          >
                            <ChemicalText :text="pdfUploadResultMetric(row)" />
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div
                  v-if="activePdfUploadEvidence"
                  class="fixed z-[90] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/15"
                  :style="{ top: `${pdfUploadEvidencePosition.top}px`, left: `${pdfUploadEvidencePosition.left}px` }"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <h4 class="truncate text-sm font-black text-slate-950">
                        {{ activePdfUploadEvidenceSlide()?.label || activePdfUploadEvidence.fieldLabel }}
                      </h4>
                      <p class="mt-0.5 text-xs font-bold text-slate-400">
                        {{ activePdfUploadEvidencePageLabel() }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                      aria-label="Close evidence"
                      @click="activePdfUploadEvidence = null"
                    >
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                  <div class="mt-3 rounded-md bg-teal-50/70 px-3 py-2 text-sm font-extrabold text-[#0f7c82]">
                    <ChemicalText :text="activePdfUploadEvidenceValue()" />
                  </div>
                  <div v-if="activePdfUploadEvidenceSlideCount() > 1" class="mt-2 flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-2 py-1">
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-teal-200 hover:text-[#0f7c82]"
                      aria-label="Previous upload evidence"
                      @click="movePdfUploadEvidenceSlide(-1)"
                    >
                      <ChevronLeft class="h-4 w-4" />
                    </button>
                    <span class="min-w-10 text-center text-[11px] font-black text-slate-400">
                      {{ activePdfUploadEvidenceSlideIndexLabel() }}
                    </span>
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-teal-200 hover:text-[#0f7c82]"
                      aria-label="Next upload evidence"
                      @click="movePdfUploadEvidenceSlide(1)"
                    >
                      <ChevronRight class="h-4 w-4" />
                    </button>
                  </div>
                  <div
                    v-if="activePdfUploadEvidenceImageSrc()"
                    class="mt-3 overflow-hidden rounded-md border border-amber-100 bg-amber-50/60"
                  >
                    <img
                      :src="activePdfUploadEvidenceImageSrc() || ''"
                      alt="Highlighted PDF evidence"
                      class="max-h-52 w-full object-contain"
                    >
                  </div>
                  <div
                    v-else-if="activePdfUploadEvidenceImageLoading()"
                    class="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500"
                  >
                    Rendering highlighted PDF evidence...
                  </div>
                  <div
                    v-else-if="activePdfUploadEvidenceImageError()"
                    class="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-700"
                  >
                    {{ activePdfUploadEvidenceImageError() }}
                  </div>
                  <div class="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                    <p
                      v-for="(quote, quoteIndex) in activePdfUploadEvidenceQuotes()"
                      :key="`${activePdfUploadEvidence.rowIndex}-${quoteIndex}`"
                      class="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium leading-6 text-slate-600"
                    >
                      <template
                        v-for="(part, partIndex) in splitPdfUploadEvidenceQuote(quote)"
                        :key="`${activePdfUploadEvidence.rowIndex}-${quoteIndex}-${partIndex}`"
                      >
                        <mark
                          v-if="part.active"
                          class="rounded bg-violet-100 px-0.5 py-0 text-slate-900"
                        >
                          <ChemicalText :text="part.text" />
                        </mark>
                        <ChemicalText v-else :text="part.text" />
                      </template>
                    </p>
                    <p v-if="activePdfUploadEvidenceQuotes().length === 0" class="rounded-md border border-dashed border-slate-200 px-3 py-3 text-sm font-semibold text-slate-400">
                      No field-level quote was stored for this value.
                    </p>
                  </div>
                  <div class="mt-3 border-t border-slate-100 pt-3">
                    <div class="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        class="inline-flex h-8 items-center justify-center rounded-md border border-emerald-200 px-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                        :disabled="!activePdfUploadEvidenceActionFieldKey() || Boolean(pdfUploadReviewActionPending)"
                        @click="confirmPdfUploadEvidenceField"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-8 items-center justify-center rounded-md border border-rose-200 px-2 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                        :disabled="!activePdfUploadEvidenceActionFieldKey() || Boolean(pdfUploadReviewActionPending)"
                        @click="flagPdfUploadEvidenceField"
                      >
                        Flag
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                        @click="openPdfUploadEvidencePaper"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-3">
                  <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                    {{ pdfUploadReviewSummary.label }}
                  </span>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      v-if="pdfUploadNeedsReviewCount > 0"
                      type="button"
                      class="inline-flex h-9 items-center rounded-md border border-amber-200 px-3 text-sm font-extrabold text-amber-700 transition hover:bg-amber-50"
                      @click="openPdfUploadReviewIssues"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
                      @click="openPdfUploadResultsInDatabase()"
                    >
                      Database
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-9 items-center rounded-md bg-[#0f7c82] px-4 text-sm font-extrabold text-white shadow-sm shadow-teal-100 transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                      :disabled="pdfUploadReadyRows.length === 0 || Boolean(pdfUploadReviewActionPending)"
                      @click="publishReadyPdfUploadRecords"
                    >
                      <Loader2 v-if="pdfUploadReviewActionPending === 'publish'" class="mr-1.5 h-4 w-4 animate-spin" />
                      {{ pdfUploadReadyRows.length > 0 ? 'Publish ready records' : 'Publish to database' }}
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
            @open-help="navigateTo('help', 'quick-start')"
            @open-home="navigateTo('home', 'today')"
          />

          <HelpPage
            v-else
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            @change-section="handleSectionChange"
            @open-pipeline="navigateTo('library', 'explorer')"
            @open-blog="navigateTo('blog', 'articles')"
          />
        </div>
      </main>
      </template>
    </div>
  </div>
</template>

<style>
.elicit-sidebar-slide-enter-active,
.elicit-sidebar-slide-leave-active {
  overflow: hidden;
  transition:
    width 680ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 680ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 680ms ease,
    border-color 680ms ease;
}

.elicit-sidebar-slide-enter-from,
.elicit-sidebar-slide-leave-to {
  width: 0;
  transform: translateX(-100%);
  opacity: 0;
  border-color: transparent;
}
</style>
