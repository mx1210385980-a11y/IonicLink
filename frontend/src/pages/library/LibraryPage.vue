<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CloudUpload,
  Crop,
  Database,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  LayoutGrid,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-vue-next'

import {
  cancelExtraction,
  extractData,
  getExtractionRunCandidates,
  getPdfFigurePreviews,
  getPdfPageImage,
  getPdfPlainText,
  getLiteratureDetails,
  getLatestExtractionRun,
  listLiterature,
  resetFigureCropOverride,
  saveFigureCropOverride,
  uploadFile,
  type ExtractionRunDetail,
  type ExtractionSummary,
  type ExtractionProfile,
  type ExtractorType,
  type PdfFigurePreview,
  type PdfPageImageResponse,
  type Literature,
  type LiteratureMetadata,
} from '@/lib/api'
import {
  extractionSaveStatus,
  extractorTypesForTemplate,
  isTerminalExtractionStatus,
  nextActivePollState,
  nextPollFailureState,
  runReviewableCounts,
  summarizeUploadBatch,
  type UploadBatchResult,
} from '@/lib/libraryExtractionWorkflow'
import ChemicalText from '@/components/ChemicalText.vue'
import PdfViewerWithHighlight from '@/components/PdfViewerWithHighlight.vue'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  selectedFileName: string
  selectedFile: any | null
  selectedFileId: string | null
  scopeKey?: string | null
  files: any[]
  canAdjustCrops?: boolean
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-home': []
  'open-review': [payload?: { literatureId?: number | null, recordId?: number | null }]
  'open-database': [payload?: LibraryDatabaseTarget]
  'select-source': [fileId: string | null]
  'clear-source': []
  'reextract': [fileId: string]
}>()

type CollectionKey = 'all' | 'deleted' | 'lubrication' | 'diffusion' | 'conductivity'
type ExtractTemplateKey = 'conductivity' | 'diffusion' | 'lubrication'
type LibraryDatabaseTarget = {
  fileId?: string | null
  doi?: string
  dataset?: 'tribology' | 'diffusion' | null
  recordId?: number | null
  entityType?: 'record' | 'candidate' | null
}
type ExtractTemplate = {
  key: ExtractTemplateKey
  label: string
  description: string
  columns: string[]
  availabilityNote?: string
}
type UploadExtractionPreset = 'tribology' | 'diffusion' | 'conductivity'
type CropBox = [number, number, number, number]
type CropDragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const items = ref<Literature[]>([])
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const selectedCollection = ref<CollectionKey>('all')
const selectedPaperIds = ref<number[]>([])
const extractMode = ref(false)
const runningExtraction = ref(false)
const cancellingExtraction = ref(false)
const statusMessage = ref('')
const selectedTemplate = ref<ExtractTemplateKey>('lubrication')
const activeExtractionTemplate = ref<ExtractTemplateKey | null>(null)
const customExtractionColumns = ref<Array<{ id: string, label: string, prompt: string }>>([])
const columnComposerOpen = ref(false)
const newExtractionColumnName = ref('')
const newExtractionColumnPrompt = ref('')
const libraryViewMode = ref<'table' | 'detail'>('detail')
const extractionProgress = ref<Record<number, ExtractionProgressItem>>({})
const extractionActivePaperIds = ref<number[]>([])
const pollFailureCounts = ref<Record<number, number>>({})
const activePollCounts = ref<Record<number, number>>({})
const extractionRunExtractorTypes = ref<ExtractorType[]>(['tribology'])
const extractedCofPreview = ref<Record<number, string>>({})
const uploadModalOpen = ref(false)
const uploadInputRef = ref<HTMLInputElement | null>(null)
const uploadDragging = ref(false)
const uploadUploading = ref(false)
const uploadStatusMessage = ref('')
const queuedUploadFiles = ref<File[]>([])
const uploadModalStep = ref<'upload' | 'select' | 'setup' | 'extracting'>('upload')
const UPLOAD_EXTRACTION_PROFILE: ExtractionProfile = 'auto'
const uploadedPapers = ref<Array<LiteratureMetadata & { id: string }>>([])
const uploadedPaperExtractionPresets = ref<Record<string, UploadExtractionPreset>>({})
const uploadPendingFileNames = ref<string[]>([])
const uploadBatchTotal = ref(0)
const uploadBatchFinished = ref(0)
const uploadCancelRequested = ref(false)
const uploadCancelling = ref(false)
const LIBRARY_CANCEL_TIMEOUT_MS = 8000
const MAX_ACTIVE_EXTRACTION_POLLS = 120
type UploadExtractionStatus = 'queued' | 'extracting' | 'completed' | 'no_data' | 'failed' | 'cancelled'
type UploadExtractionItem = LiteratureMetadata & {
  id: string
  status: UploadExtractionStatus
  message: string
  records: number
}
const uploadExtractionItems = ref<UploadExtractionItem[]>([])
const uploadExtracting = ref(false)
const uploadExtractionProgress = computed(() => {
  if (uploadExtractionItems.value.length === 0) return 0
  const finished = uploadExtractionItems.value.filter((item) => ['completed', 'no_data', 'failed', 'cancelled'].includes(item.status)).length
  return Math.round((finished / uploadExtractionItems.value.length) * 100)
})
const uploadBatchProgressPercent = computed(() => {
  if (uploadBatchTotal.value <= 0) return 0
  return Math.min(100, Math.round((uploadBatchFinished.value / uploadBatchTotal.value) * 100))
})
const shouldShowUploadBatchProgress = computed(() => uploadBatchTotal.value > 1 && (uploadModalStep.value === 'select' || uploadUploading.value))
const uploadHasQueuedFiles = computed(() => queuedUploadFiles.value.length > 0)

const uploadExtractionPresetOptions: Array<{ value: UploadExtractionPreset, label: string, description: string }> = [
  { value: 'tribology', label: 'Tribology', description: 'Friction, COF, wear, surfaces' },
  { value: 'diffusion', label: 'Diffusion', description: 'Diffusion coefficients and confined transport' },
  { value: 'conductivity', label: 'Conductivity', description: 'Conductivity, EIS, transference number' },
]

function uploadedPaperText(paper: LiteratureMetadata & { id?: string }) {
  return [
    paper.title,
    paper.authors,
    paper.journal,
    paper.doi,
    paper.year,
  ].join(' ').toLowerCase()
}

function inferUploadExtractionPreset(paper: LiteratureMetadata & { id?: string }): UploadExtractionPreset {
  const text = uploadedPaperText(paper)
  if (/\bconductiv|impedance|\beis\b|transference|electrolyte|battery|supercapacitor|capacitance|activation energy|ionogel/.test(text)) {
    return 'conductivity'
  }
  if (/\bdiffus|diffusiv|transport|dynamics|molecular dynamics|confinement|confined|porous|nanochannel|separation|permeation|membrane|co2\/ch4|co2\/n2/.test(text)) {
    return 'diffusion'
  }
  return 'tribology'
}

function presetForUploadedPaper(paper: LiteratureMetadata & { id: string }): UploadExtractionPreset {
  return uploadedPaperExtractionPresets.value[paper.id] || inferUploadExtractionPreset(paper)
}

function extractorForUploadPreset(preset: UploadExtractionPreset): ExtractorType | null {
  if (preset === 'diffusion') return 'diffusion'
  if (preset === 'tribology') return 'tribology'
  return null
}

function setUploadedPaperExtractionPreset(paperId: string, value: Event | UploadExtractionPreset) {
  const preset = typeof value === 'string'
    ? value
    : String((value.target as HTMLSelectElement | null)?.value || 'tribology')
  if (!['tribology', 'diffusion', 'conductivity'].includes(preset)) return
  uploadedPaperExtractionPresets.value = {
    ...uploadedPaperExtractionPresets.value,
    [paperId]: preset as UploadExtractionPreset,
  }
}

function uploadPresetLabel(preset: UploadExtractionPreset) {
  return uploadExtractionPresetOptions.find((option) => option.value === preset)?.label || 'Tribology'
}

function metadataFromUploadFallback(file: File, response: Awaited<ReturnType<typeof uploadFile>>) {
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
  }
}

function uploadErrorMessage(error: any) {
  return String(
    error?.response?.data?.detail
    || error?.response?.data?.message
    || error?.response?.data?.error
    || error?.detail
    || error?.message
    || error?.error
    || 'Upload failed',
  )
}

function upsertUploadedPaperInLibrary(paper: LiteratureMetadata & { id: string }) {
  const paperId = Number(paper.id)
  if (!Number.isFinite(paperId)) return

  const libraryPaper: Literature = {
    id: paperId,
    doi: paper.doi || '',
    title: paper.title || 'No title found',
    authors: paper.authors || '',
    journal: paper.journal || '',
    year: Number(paper.year || 0),
    status: 'pending',
    recordCount: 0,
    candidateCount: 0,
    tribologyRecordCount: 0,
    tribologyCandidateCount: 0,
    diffusionRecordCount: 0,
    diffusionCandidateCount: 0,
    totalCount: 0,
    hasPdf: true,
    volume: paper.volume,
    issue: paper.issue,
    pages: paper.pages,
    filePath: null,
    file_path: '',
    created_at: new Date().toISOString(),
  }

  if (items.value.some((item) => item.id === paperId)) {
    items.value = items.value.map((item) => item.id === paperId ? { ...item, ...libraryPaper } : item)
    return
  }

  items.value = [libraryPaper, ...items.value]
}

const selectedPaper = ref<Literature | null>(null)
const selectedPaperDetails = ref<any | null>(null)
const paperDetailTab = ref<'plain' | 'pdf' | 'figures'>('plain')
const paperDetailLoading = ref(false)
const paperDetailError = ref('')
const paperPlainText = ref('')
const paperFigures = ref<PdfFigurePreview[]>([])
const expandedFigure = ref<PdfFigurePreview | null>(null)
const serverCanAdjustCrops = ref(false)
const cropEditorFigure = ref<PdfFigurePreview | null>(null)
const cropEditorPage = ref<PdfPageImageResponse | null>(null)
const cropEditorBox = ref<CropBox>([0, 0, 0, 0])
const cropEditorLoading = ref(false)
const cropEditorSaving = ref(false)
const cropEditorError = ref('')
const cropEditorFrameRef = ref<HTMLDivElement | null>(null)
const cropEditorDrag = ref<{
  mode: CropDragMode
  startX: number
  startY: number
  startBox: CropBox
} | null>(null)
let extractionPollTimer: number | null = null
const MAX_EXTRACTION_POLL_FAILURES = 3
const UPLOAD_EXTRACTION_STALLED_HEARTBEAT_MS = 10 * 60 * 1000

type ExtractionProgressStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'no_data' | 'failed' | 'cancelled'
type ExtractionProgressItem = {
  paperId: number
  title: string
  status: ExtractionProgressStatus
  runId?: string | null
  stage?: string
  message?: string
  candidateCount?: number
  finalCount?: number
}

const templates: ExtractTemplate[] = [
  {
    key: 'lubrication',
    label: 'Lubrication',
    description: 'Start with COF only. Add load, speed, surface pair, lubricant, wear, or evidence when you need more context.',
    columns: ['COF'],
  },
  {
    key: 'diffusion',
    label: 'Diffusion',
    description: 'Extract diffusion coefficients with system, temperature, method, medium, and evidence.',
    columns: ['Diffusion coefficient', 'System', 'Temperature', 'Method', 'Medium', 'Evidence'],
  },
  {
    key: 'conductivity',
    label: 'Conductivity',
    description: 'Extract ionic conductivity with material, temperature, method, transference number, and evidence.',
    columns: ['Ionic conductivity', 'Material', 'Temperature', 'Method', 'Transference number', 'Evidence'],
    availabilityNote: 'Conductivity extraction is not connected yet. Use this as a table column, or choose Lubrication/Diffusion to run extraction.',
  },
]

const presetExtractionColumns = ['Tribology', 'Diffusion', 'Conductivity'] as const
const extractionTableColumns = computed(() => [
  ...presetExtractionColumns.map((label) => ({
    id: label.toLowerCase(),
    label,
    prompt: `${label} structured extraction`,
    preset: true,
  })),
  ...customExtractionColumns.value.map((column) => ({ ...column, preset: false })),
  { id: 'evidence', label: 'Evidence', prompt: 'Source evidence and PDF location', preset: true },
])
const canAdjustCrops = computed(() => Boolean(props.canAdjustCrops && serverCanAdjustCrops.value))
const cropEditorImageSrc = computed(() => cropEditorPage.value ? `data:image/png;base64,${cropEditorPage.value.image_b64}` : '')
const cropEditorOverlayStyle = computed(() => {
  const page = cropEditorPage.value
  if (!page || page.page_width <= 0 || page.page_height <= 0) return {}
  const [x0, y0, x1, y1] = cropEditorBox.value
  return {
    left: `${(x0 / page.page_width) * 100}%`,
    top: `${(y0 / page.page_height) * 100}%`,
    width: `${((x1 - x0) / page.page_width) * 100}%`,
    height: `${((y1 - y0) / page.page_height) * 100}%`,
  }
})

async function fetchPapers() {
  loading.value = true
  error.value = ''
  try {
    items.value = await listLiterature(0, 1000, { scope: 'group_library' })
  } catch (err: any) {
    error.value = err?.message || 'Failed to fetch literature.'
  } finally {
    loading.value = false
  }
  await openSelectedPaperFromRoute()
}

function selectedLiteratureIdFromRoute() {
  const paperId = Number(props.selectedFileId || 0)
  return Number.isFinite(paperId) && paperId > 0 ? paperId : null
}

async function openSelectedPaperFromRoute() {
  const paperId = selectedLiteratureIdFromRoute()
  if (!paperId || selectedPaper.value?.id === paperId) return

  let paper = items.value.find((item) => item.id === paperId) || null
  if (!paper) {
    const details = await getLiteratureDetails(paperId).catch(() => null)
    if (!details?.id) return
    paper = details as Literature
    items.value = [paper, ...items.value.filter((item) => item.id !== paperId)]
  }

  await openPaperDetail(paper)
}

const collections = computed(() => [
  { key: 'all' as const, label: 'All', count: items.value.length },
  { key: 'deleted' as const, label: 'Recently deleted', count: null },
  { key: 'lubrication' as const, label: 'Lubrication', count: items.value.filter((item) => matchesCollection(item, 'lubrication')).length },
  { key: 'diffusion' as const, label: 'Diffusion', count: items.value.filter((item) => matchesCollection(item, 'diffusion')).length },
  { key: 'conductivity' as const, label: 'Conductivity', count: items.value.filter((item) => matchesCollection(item, 'conductivity')).length },
])

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return items.value.filter((item) => {
    if (selectedCollection.value === 'deleted') return false
    if (
      selectedCollection.value !== 'all'
      && !matchesCollection(item, selectedCollection.value)
    ) return false

    if (!query) return true
    return [
      item.title,
      item.authors,
      item.journal,
      item.doi,
      item.filePath,
      item.file_path,
    ].some((value) => String(value || '').toLowerCase().includes(query))
  })
})

const selectedPapers = computed(() => items.value.filter((item) => selectedPaperIds.value.includes(item.id)))
const selectedCountLabel = computed(() => `${selectedPaperIds.value.length} paper${selectedPaperIds.value.length === 1 ? '' : 's'} selected`)
const extractionDisplayTemplate = computed(() => activeExtractionTemplate.value || selectedTemplate.value)
const progressScopeIds = computed(() => extractionActivePaperIds.value.length ? extractionActivePaperIds.value : selectedPaperIds.value)
const progressItems = computed(() => progressScopeIds.value.map((id) => extractionProgress.value[id])
  .filter((item): item is ExtractionProgressItem => Boolean(item)))
const finishedProgressCount = computed(() => progressItems.value.filter((item) => isTerminalStatus(item.status)).length)
const extractionProgressPercent = computed(() => {
  if (progressScopeIds.value.length === 0) return 0
  return Math.round((finishedProgressCount.value / progressScopeIds.value.length) * 100)
})
const extractionSave = computed(() => extractionSaveStatus({
  selectedCount: selectedPaperIds.value.length,
  selectedTemplate: selectedTemplate.value,
  runningExtraction: runningExtraction.value,
  progressItems: progressItems.value,
  selectedPapers: selectedPapers.value,
}))

const extractionRows = computed(() => {
  return selectedPapers.value.map((paper) => ({
    id: paper.id,
    doi: paper.doi || '',
    title: paper.title || 'No title found',
    authors: primaryAuthors(paper.authors),
    journal: publicationMetaFor(paper),
    evidenceAvailable: hasExtractedEvidence(paper),
    cells: Object.fromEntries(extractionTableColumns.value.map((column) => [column.label, valueForColumn(paper, column.label)])),
  }))
})

function searchablePaperText(item: Literature) {
  return [
    item.title,
    item.authors,
    item.journal,
    item.doi,
    item.filePath,
    item.file_path,
  ].join(' ').toLowerCase()
}

function matchesLubrication(item: Literature) {
  if (Number(item.tribologyRecordCount || item.tribologyCandidateCount || 0) > 0) return true
  return /\btribolog|friction|lubricat|wear|superlubric|boundary layer|nanotribolog/.test(searchablePaperText(item))
}

function matchesDiffusion(item: Literature) {
  if (Number(item.diffusionRecordCount || item.diffusionCandidateCount || 0) > 0) return true
  return /\bdiffus|diffusiv|transport|dynamics|molecular dynamics|confinement|confined|porous|nanochannel|separation|permeation|membrane|co2\/ch4|co2\/n2/.test(searchablePaperText(item))
}

function matchesConductivity(item: Literature) {
  return /\bconductiv|impedance|eis\b|transference|proton conduct|electrolyte|battery|supercapacitor|capacitance|activation energy|ionogel/.test(searchablePaperText(item))
}

function matchesCollection(item: Literature, collection: CollectionKey) {
  if (collection === 'all') return true
  if (collection === 'deleted') return false
  if (collection === 'lubrication') return matchesLubrication(item)
  if (collection === 'diffusion') return matchesDiffusion(item)
  if (collection === 'conductivity') return matchesConductivity(item)
  return false
}

function inferMaterial(paper: Literature) {
  const title = paper.title || ''
  if (/ionic liquid/i.test(title)) return 'Ionic liquid system'
  if (/cof/i.test(title)) return 'COF / IL'
  if (/titania/i.test(title)) return 'Titania / IL'
  return paper.journal || '-'
}

function inferPrimaryValue(paper: Literature) {
  if (extractionDisplayTemplate.value === 'lubrication') {
    if (extractedCofPreview.value[paper.id]) return extractedCofPreview.value[paper.id]
    const candidateCount = Number(paper.tribologyCandidateCount || paper.candidateCount || 0)
    if (candidateCount > 0) return `${candidateCount} COF candidate${candidateCount === 1 ? '' : 's'}`
    return Number(paper.tribologyRecordCount || 0) > 0 ? `${paper.tribologyRecordCount} records` : 'Not extracted'
  }
  if (extractionDisplayTemplate.value === 'diffusion') {
    const recordCount = Number(paper.diffusionRecordCount || 0)
    const candidateCount = Number(paper.diffusionCandidateCount || paper.candidateCount || 0)
    if (recordCount > 0) return `${recordCount} records`
    if (candidateCount > 0) return `${candidateCount} candidates`
    return 'Not extracted'
  }
  return matchesConductivity(paper) ? 'Pending value' : 'Not found'
}

function evidenceLabel(paper: Literature) {
  return hasExtractedEvidence(paper)
    ? 'View evidence'
    : 'Needs extraction'
}

function hasExtractedEvidence(paper: Literature) {
  return Number(paper.recordCount || paper.candidateCount || paper.tribologyRecordCount || paper.tribologyCandidateCount || paper.diffusionRecordCount || paper.diffusionCandidateCount || 0) > 0
}

function valueForColumn(paper: Literature, column: string) {
  if (column === 'Tribology') {
    if (extractedCofPreview.value[paper.id]) return extractedCofPreview.value[paper.id]
    const records = Number(paper.tribologyRecordCount || 0)
    const candidates = Number(paper.tribologyCandidateCount || paper.candidateCount || 0)
    if (records > 0) return `${records} records`
    if (candidates > 0) return `${candidates} candidates`
    return 'Ready to extract'
  }
  if (column === 'Diffusion') {
    const records = Number(paper.diffusionRecordCount || 0)
    const candidates = Number(paper.diffusionCandidateCount || paper.candidateCount || 0)
    if (records > 0) return `${records} records`
    if (candidates > 0) return `${candidates} candidates`
    return matchesDiffusion(paper) ? 'Ready to extract' : '-'
  }
  if (column === 'Conductivity') return matchesConductivity(paper) ? 'Ready to extract' : '-'
  if (column === 'Evidence') return evidenceLabel(paper)
  if (column === 'COF') return inferPrimaryValue(paper)
  if (column === 'Diffusion coefficient') return inferPrimaryValue(paper)
  if (column === 'Ionic conductivity') return matchesConductivity(paper) ? 'Pending value' : 'Not found'
  if (column === 'Material' || column === 'System') return inferMaterial(paper)
  if (column === 'Temperature') return '-'
  if (column === 'Method') return extractionDisplayTemplate.value === 'conductivity' ? 'EIS / PDF evidence' : 'PDF evidence'
  if (column === 'COF type') return 'Average / steady-state'
  if (column === 'Surface pair') return /steel/i.test(paper.title || '') ? 'Steel contact' : '-'
  if (column === 'Lubricant') return /ionic liquid/i.test(paper.title || '') ? 'Ionic liquid' : '-'
  if (column === 'Load' || column === 'Speed' || column === 'Condition' || column === 'Wear result' || column === 'Medium' || column === 'Transference number') return 'Pending'
  const progress = extractionProgress.value[paper.id]
  if (progress?.status === 'completed') return 'Extracted'
  if (progress && !isTerminalStatus(progress.status)) return 'Extracting'
  return 'Add prompt'
}

async function refreshCofPreviewForPapers(paperIds: number[]) {
  const uniqueIds = Array.from(new Set(paperIds.filter(Boolean)))
  if (uniqueIds.length === 0) return
  const entries = await Promise.allSettled(uniqueIds.map(async (paperId) => {
    const latestRun = await getLatestExtractionRun(paperId, 'tribology').catch(() => null)
    if (latestRun?.run_id) {
      const runCandidates = await getExtractionRunCandidates(latestRun.run_id, 0, 200).catch(() => null)
      const candidateCofs = (runCandidates?.items || [])
        .map((candidate: any) => String(candidate?.normalized?.cof || candidate?.raw?.cof || '').trim())
        .filter(Boolean)
      const uniqueCandidateCofs = Array.from(new Set(candidateCofs))
      if (uniqueCandidateCofs.length > 0) {
        const preview = `${uniqueCandidateCofs.slice(0, 4).join(', ')}${uniqueCandidateCofs.length > 4 ? ` +${uniqueCandidateCofs.length - 4}` : ''}`
        return [paperId, preview] as const
      }
    }

    const details = await getLiteratureDetails(paperId)
    const cofs = (details.tribologyData || [])
      .map((record: any) => String(record.cof || '').trim())
      .filter(Boolean)
    const uniqueCofs = Array.from(new Set(cofs))
    const preview = uniqueCofs.length > 0
      ? `${uniqueCofs.slice(0, 4).join(', ')}${uniqueCofs.length > 4 ? ` +${uniqueCofs.length - 4}` : ''}`
      : ''
    return [paperId, preview] as const
  }))

  const next = { ...extractedCofPreview.value }
  for (const entry of entries) {
    if (entry.status !== 'fulfilled') continue
    const [paperId, preview] = entry.value
    if (preview) next[paperId] = preview
  }
  extractedCofPreview.value = next
}

function publicationMetaFor(paper: Literature) {
  const journal = String(paper.journal || '').trim()
  const year = paper.year ? String(paper.year) : ''
  if (journal && year) return `${journal} (${year})`
  return journal || year || '-'
}

function primaryAuthors(authors?: string | null) {
  const tokens = String(authors || '')
    .split(/;|,(?=\s*(?:[A-Z]\.\s*){1,3}[A-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FFA-Za-z])/)
    .map((author) => author.trim())
    .filter(Boolean)

  if (tokens.length === 0) return '-'
  const visible = tokens.slice(0, 3).join('; ')
  return tokens.length > 3 ? `${visible} ...` : visible
}

function authorList(authors?: string | null) {
  return String(authors || '')
    .split(/;|,(?=\s*(?:[A-Z]\.\s*){1,3}[A-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FFA-Za-z])/)
    .map((author) => author.trim())
    .filter(Boolean)
}

function detailAuthors(authors?: string | null) {
  const tokens = authorList(authors)
  if (tokens.length === 0) return '-'
  const visible = tokens.slice(0, 5).join(', ')
  return tokens.length > 5 ? `${visible}, and ${tokens.length - 5} more` : visible
}

function titleFor(paper: Literature) {
  const title = String(paper.title || '').trim()
  return title && !title.toLowerCase().endsWith('.pdf') ? title : 'No title found'
}

function paperMetaLine(paper: Literature) {
  return [
    paper.journal,
    paper.year,
    paper.doi ? `DOI ${paper.doi}` : '',
  ].filter(Boolean).join(' \u00B7 ')
}

function plainTextParagraphs(text: string) {
  return String(text || '')
    .split(/\n\s*\n+/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 80)
}

async function openPaperDetail(paper: Literature) {
  selectedPaper.value = paper
  selectedPaperDetails.value = null
  paperDetailTab.value = 'plain'
  paperPlainText.value = ''
  paperFigures.value = []
  serverCanAdjustCrops.value = false
  closeCropEditor()
  paperDetailError.value = ''
  await loadPaperDetail()
}

function closePaperDetail() {
  selectedPaper.value = null
  selectedPaperDetails.value = null
  paperPlainText.value = ''
  paperFigures.value = []
  expandedFigure.value = null
  serverCanAdjustCrops.value = false
  closeCropEditor()
  paperDetailError.value = ''
}

async function loadPaperDetail() {
  if (!selectedPaper.value) return
  paperDetailLoading.value = true
  paperDetailError.value = ''
  try {
    const [details, textResponse] = await Promise.all([
      getLiteratureDetails(selectedPaper.value.id).catch(() => null),
      getPdfPlainText(selectedPaper.value.id).catch(() => null),
    ])
    selectedPaperDetails.value = details
    if (textResponse?.text) paperPlainText.value = textResponse.text
  } catch (err: any) {
    paperDetailError.value = err?.message || 'Failed to load paper.'
  } finally {
    paperDetailLoading.value = false
  }
}

async function switchPaperDetailTab(tab: 'plain' | 'pdf' | 'figures') {
  paperDetailTab.value = tab
  if (!selectedPaper.value || tab !== 'figures') return
  await loadPaperFigures()
}

async function loadPaperFigures() {
  if (!selectedPaper.value) return
  paperDetailLoading.value = true
  paperDetailError.value = ''
  paperFigures.value = []
  serverCanAdjustCrops.value = false
  try {
    const response = await getPdfFigurePreviews(selectedPaper.value.id)
    paperFigures.value = response.items || []
    serverCanAdjustCrops.value = Boolean(response.can_adjust_crops)
  } catch (err: any) {
    paperDetailError.value = err?.message || 'Failed to load figures.'
  } finally {
    paperDetailLoading.value = false
  }
}

function figureImageSrc(figure: PdfFigurePreview) {
  return `data:image/png;base64,${figure.image_b64}`
}

function figureLabelParts(figure: PdfFigurePreview) {
  const label = String(figure.label || 'Figure').trim()
  const match = label.match(/^([A-Za-z]+)\s+(.+)$/)
  if (!match) return { kind: label, number: '' }
  return { kind: match[1], number: match[2] }
}

function figureDownloadName(figure: PdfFigurePreview) {
  const label = String(figure.label || 'figure')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `${label || 'figure'}-page-${figure.page || 'unknown'}.png`
}

function downloadFigure(figure: PdfFigurePreview) {
  const link = document.createElement('a')
  link.href = figureImageSrc(figure)
  link.download = figureDownloadName(figure)
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function openFigurePreview(figure: PdfFigurePreview) {
  expandedFigure.value = figure
}

function closeFigurePreview() {
  expandedFigure.value = null
}

function asCropBox(value?: number[] | null): CropBox {
  const fallback: CropBox = [0, 0, 240, 180]
  if (!value || value.length !== 4) return fallback
  const box = value.map((item) => Number(item)) as CropBox
  return box.every((item) => Number.isFinite(item)) ? box : fallback
}

function cropPageDimensions() {
  return {
    width: Number(cropEditorPage.value?.page_width || cropEditorFigure.value?.page_width || 612),
    height: Number(cropEditorPage.value?.page_height || cropEditorFigure.value?.page_height || 792),
  }
}

function clampCropBox(box: CropBox): CropBox {
  const { width, height } = cropPageDimensions()
  const minSize = 12
  let [x0, y0, x1, y1] = box
  x0 = Math.max(0, Math.min(width - minSize, x0))
  y0 = Math.max(0, Math.min(height - minSize, y0))
  x1 = Math.max(minSize, Math.min(width, x1))
  y1 = Math.max(minSize, Math.min(height, y1))
  if (x1 - x0 < minSize) x1 = Math.min(width, x0 + minSize)
  if (y1 - y0 < minSize) y1 = Math.min(height, y0 + minSize)
  return [roundCropValue(x0), roundCropValue(y0), roundCropValue(x1), roundCropValue(y1)]
}

function roundCropValue(value: number) {
  return Math.round(value * 10) / 10
}

function setCropCoord(index: number, value: string | number) {
  const next = [...cropEditorBox.value] as CropBox
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return
  next[index] = parsed
  cropEditorBox.value = clampCropBox(next)
}

function setCropCoordFromEvent(index: number, event: Event) {
  setCropCoord(index, (event.target as HTMLInputElement).value)
}

function nudgeCropEdge(edge: 'top' | 'right' | 'bottom' | 'left', delta: number) {
  const next = [...cropEditorBox.value] as CropBox
  if (edge === 'left') next[0] += delta
  if (edge === 'top') next[1] += delta
  if (edge === 'right') next[2] += delta
  if (edge === 'bottom') next[3] += delta
  cropEditorBox.value = clampCropBox(next)
}

async function openCropEditor(figure: PdfFigurePreview) {
  if (!selectedPaper.value || !canAdjustCrops.value) return
  cropEditorFigure.value = figure
  cropEditorPage.value = null
  cropEditorError.value = ''
  cropEditorLoading.value = true
  cropEditorBox.value = clampCropBox(asCropBox(figure.clip_bbox || figure.algorithm_bbox))
  try {
    const pageImage = await getPdfPageImage(selectedPaper.value.id, figure.page)
    cropEditorPage.value = pageImage
    cropEditorBox.value = clampCropBox(asCropBox(figure.clip_bbox || figure.algorithm_bbox))
  } catch (err: any) {
    cropEditorError.value = err?.response?.data?.detail || err?.message || 'Failed to load original PDF page.'
  } finally {
    cropEditorLoading.value = false
  }
}

function closeCropEditor() {
  endCropDrag()
  cropEditorFigure.value = null
  cropEditorPage.value = null
  cropEditorError.value = ''
  cropEditorLoading.value = false
  cropEditorSaving.value = false
}

function pointerToPagePoint(event: PointerEvent) {
  const frame = cropEditorFrameRef.value
  const page = cropEditorPage.value
  if (!frame || !page) return null
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: Math.max(0, Math.min(page.page_width, ((event.clientX - rect.left) / rect.width) * page.page_width)),
    y: Math.max(0, Math.min(page.page_height, ((event.clientY - rect.top) / rect.height) * page.page_height)),
  }
}

function beginCropDrag(mode: CropDragMode, event: Event) {
  const pointerEvent = event as PointerEvent
  const point = pointerToPagePoint(pointerEvent)
  if (!point) return
  pointerEvent.preventDefault()
  cropEditorDrag.value = {
    mode,
    startX: point.x,
    startY: point.y,
    startBox: [...cropEditorBox.value] as CropBox,
  }
  window.addEventListener('pointermove', handleCropDrag)
  window.addEventListener('pointerup', endCropDrag)
}

function handleCropDrag(event: PointerEvent) {
  const drag = cropEditorDrag.value
  const point = pointerToPagePoint(event)
  if (!drag || !point) return
  const dx = point.x - drag.startX
  const dy = point.y - drag.startY
  const next = [...drag.startBox] as CropBox
  const mode = drag.mode
  if (mode === 'move') {
    const width = drag.startBox[2] - drag.startBox[0]
    const height = drag.startBox[3] - drag.startBox[1]
    next[0] = drag.startBox[0] + dx
    next[1] = drag.startBox[1] + dy
    next[2] = next[0] + width
    next[3] = next[1] + height
  } else {
    if (mode.includes('w')) next[0] = drag.startBox[0] + dx
    if (mode.includes('e')) next[2] = drag.startBox[2] + dx
    if (mode.includes('n')) next[1] = drag.startBox[1] + dy
    if (mode.includes('s')) next[3] = drag.startBox[3] + dy
  }
  cropEditorBox.value = clampCropBox(next)
}

function endCropDrag() {
  if (!cropEditorDrag.value) return
  cropEditorDrag.value = null
  window.removeEventListener('pointermove', handleCropDrag)
  window.removeEventListener('pointerup', endCropDrag)
}

function replaceFigurePreview(nextFigure: PdfFigurePreview) {
  paperFigures.value = paperFigures.value.map((item) => item.id === nextFigure.id ? nextFigure : item)
  if (expandedFigure.value?.id === nextFigure.id) expandedFigure.value = nextFigure
  if (cropEditorFigure.value?.id === nextFigure.id) cropEditorFigure.value = nextFigure
}

async function saveCropEditor() {
  if (!selectedPaper.value || !cropEditorFigure.value) return
  cropEditorSaving.value = true
  cropEditorError.value = ''
  try {
    const figure = cropEditorFigure.value
    const response = await saveFigureCropOverride(selectedPaper.value.id, {
      label: figure.label,
      page: figure.page,
      bbox: cropEditorBox.value,
      caption: figure.caption,
      algorithmBbox: figure.algorithm_bbox || figure.clip_bbox || null,
      algorithmVersion: figure.algorithm_version || null,
    })
    replaceFigurePreview({
      ...figure,
      image_b64: response.image_b64,
      caption: response.override.caption || figure.caption,
      clip_bbox: response.override.bbox,
      algorithm_bbox: figure.algorithm_bbox || figure.clip_bbox || null,
      algorithm_version: response.override.algorithm_version || figure.algorithm_version,
      has_override: true,
      override_id: response.override.id,
    })
  } catch (err: any) {
    cropEditorError.value = err?.response?.data?.detail || err?.message || 'Failed to save crop correction.'
  } finally {
    cropEditorSaving.value = false
  }
}

async function resetCropEditor() {
  if (!selectedPaper.value || !cropEditorFigure.value?.override_id) return
  cropEditorSaving.value = true
  cropEditorError.value = ''
  try {
    await resetFigureCropOverride(selectedPaper.value.id, cropEditorFigure.value.override_id)
    closeCropEditor()
    await loadPaperFigures()
  } catch (err: any) {
    cropEditorError.value = err?.response?.data?.detail || err?.message || 'Failed to reset crop correction.'
  } finally {
    cropEditorSaving.value = false
  }
}

function togglePaper(id: number) {
  if (runningExtraction.value || cancellingExtraction.value) return
  selectedPaperIds.value = selectedPaperIds.value.includes(id)
    ? selectedPaperIds.value.filter((paperId) => paperId !== id)
    : [...selectedPaperIds.value, id]
}

function toggleAllVisible() {
  if (runningExtraction.value || cancellingExtraction.value) return
  const visibleIds = filteredItems.value.map((item) => item.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedPaperIds.value.includes(id))
  selectedPaperIds.value = allSelected
    ? selectedPaperIds.value.filter((id) => !visibleIds.includes(id))
    : Array.from(new Set([...selectedPaperIds.value, ...visibleIds]))
}

function openExtractData() {
  extractMode.value = true
  statusMessage.value = selectedPaperIds.value.length > 0
    ? 'Choose columns, then run extraction to populate a new Database table.'
    : 'Select papers in Library, then add columns and run extraction.'
}

function addExtractionColumn() {
  const label = newExtractionColumnName.value.trim()
  if (!label) return
  const prompt = newExtractionColumnPrompt.value.trim() || `Extract ${label} from each selected paper.`
  const id = `${Date.now()}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  customExtractionColumns.value = [
    ...customExtractionColumns.value,
    { id, label, prompt },
  ]
  newExtractionColumnName.value = ''
  newExtractionColumnPrompt.value = ''
  columnComposerOpen.value = false
}

function removeExtractionColumn(columnId: string) {
  customExtractionColumns.value = customExtractionColumns.value.filter((column) => column.id !== columnId)
}

function extractionExtractorTypes() {
  return extractorTypesForTemplate(selectedTemplate.value)
}

function setExtractionTemplate(template: ExtractTemplateKey) {
  if (runningExtraction.value || cancellingExtraction.value) return
  selectedTemplate.value = template
}

const extractionTemplateBlocker = computed(() => {
  if (selectedTemplate.value === 'conductivity') {
    return templates.find((template) => template.key === 'conductivity')?.availabilityNote || 'Conductivity extraction is not connected yet.'
  }
  return ''
})

function saveExtractionTable() {
  if (!extractionSave.value.canSave) {
    statusMessage.value = extractionSave.value.message
    return
  }
  statusMessage.value = extractionSave.value.message
  emit('open-database', libraryExtractionDatabaseTarget())
}

function libraryExtractionDatabaseTarget(): LibraryDatabaseTarget | undefined {
  if (selectedPapers.value.length !== 1) return undefined
  const paper = selectedPapers.value[0]
  if (!paper) return undefined
  return {
    fileId: String(paper.id),
    doi: paper.doi || '',
    dataset: extractionDisplayTemplate.value === 'diffusion' ? 'diffusion' : 'tribology',
  }
}

function libraryExtractionEvidenceDatabaseTarget(row: { id: number, doi?: string }): LibraryDatabaseTarget {
  return {
    fileId: String(row.id),
    doi: row.doi || '',
    dataset: extractionDisplayTemplate.value === 'diffusion' ? 'diffusion' : 'tribology',
  }
}

function uploadExtractionDatabaseTarget(items: UploadExtractionItem[] = uploadExtractionItems.value): LibraryDatabaseTarget | undefined {
  const target = items.find((item) => item.status === 'completed' && item.records > 0)
  if (!target) return undefined
  return {
    fileId: String(target.id),
    doi: target.doi || '',
    dataset: presetForUploadedPaper(target) === 'diffusion' ? 'diffusion' : 'tribology',
  }
}

function openUploadModal() {
  uploadStatusMessage.value = ''
  uploadDragging.value = false
  uploadModalStep.value = 'upload'
  uploadedPapers.value = []
  uploadedPaperExtractionPresets.value = {}
  uploadModalOpen.value = true
}

function closeUploadModal() {
  if (uploadUploading.value || uploadExtracting.value) return
  uploadModalOpen.value = false
  uploadDragging.value = false
  uploadStatusMessage.value = ''
  queuedUploadFiles.value = []
  uploadModalStep.value = 'upload'
  uploadedPapers.value = []
  uploadedPaperExtractionPresets.value = {}
  uploadExtractionItems.value = []
  uploadPendingFileNames.value = []
  uploadBatchTotal.value = 0
  uploadBatchFinished.value = 0
}

function chooseUploadFiles() {
  uploadInputRef.value?.click()
}

function continueFromUploadModal() {
  if (uploadUploading.value || uploadExtracting.value) return
  if (uploadHasQueuedFiles.value) {
    uploadStatusMessage.value = 'Upload queued PDFs before continuing, or remove them.'
    return
  }
  uploadModalOpen.value = false
  uploadDragging.value = false
  uploadStatusMessage.value = ''
  queuedUploadFiles.value = []
  uploadModalStep.value = 'upload'
  uploadedPapers.value = []
  uploadedPaperExtractionPresets.value = {}
  uploadPendingFileNames.value = []
  uploadBatchTotal.value = 0
  uploadBatchFinished.value = 0
  statusMessage.value = ''
  extractMode.value = true
}

function queueUploadFiles(fileList: FileList | File[] | null | undefined) {
  const files = Array.from(fileList || []).filter((file) => file && file.name)
  if (files.length === 0 || uploadUploading.value) return
  const existing = new Set(queuedUploadFiles.value.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
  queuedUploadFiles.value = [
    ...queuedUploadFiles.value,
    ...files.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`)),
  ]
  uploadStatusMessage.value = ''
}

function removeQueuedUploadFile(index: number) {
  if (uploadUploading.value) return
  queuedUploadFiles.value = queuedUploadFiles.value.filter((_, fileIndex) => fileIndex !== index)
}

function compactAuthorLine(authors?: string | null) {
  const tokens = authorList(authors)
  if (tokens.length === 0) return 'Unknown author'
  return tokens.length > 1 ? `${tokens[0]} +${tokens.length - 1}` : tokens[0]
}

async function uploadQueuedFiles() {
  const files = queuedUploadFiles.value
  if (files.length === 0 || uploadUploading.value) {
    uploadStatusMessage.value = files.length === 0 ? 'Add PDFs before uploading.' : uploadStatusMessage.value
    return
  }

  uploadUploading.value = true
  uploadModalStep.value = 'select'
  uploadedPapers.value = []
  uploadedPaperExtractionPresets.value = {}
  uploadPendingFileNames.value = files.map((file) => file.name)
  uploadBatchTotal.value = files.length
  uploadBatchFinished.value = 0
  uploadStatusMessage.value = `Parsing metadata for ${files.length} file${files.length === 1 ? '' : 's'}...`
  const uploadResults: UploadBatchResult[] = []

  for (const [index, file] of files.entries()) {
    uploadStatusMessage.value = `Parsing metadata ${index + 1} of ${files.length}...`
    try {
      const response = await uploadFile(file, 'tribology')
      if (response?.success) {
        uploadResults.push({ fileName: file.name, success: true })
        const paper = metadataFromUploadFallback(file, response)
        uploadedPapers.value = [...uploadedPapers.value, paper]
        uploadedPaperExtractionPresets.value = {
          ...uploadedPaperExtractionPresets.value,
          [paper.id]: inferUploadExtractionPreset(paper),
        }
        upsertUploadedPaperInLibrary(paper)
        const paperId = Number(paper.id)
        if (Number.isFinite(paperId)) {
          selectedPaperIds.value = Array.from(new Set([...selectedPaperIds.value, paperId]))
        }
      } else {
        uploadResults.push({ fileName: file.name, success: false, error: uploadErrorMessage(response) })
      }
    } catch (error: any) {
      uploadResults.push({ fileName: file.name, success: false, error: uploadErrorMessage(error) })
    } finally {
      uploadPendingFileNames.value = uploadPendingFileNames.value.filter((name) => name !== file.name)
      uploadBatchFinished.value = Math.min(uploadBatchTotal.value, uploadBatchFinished.value + 1)
    }
  }

  uploadUploading.value = false
  const uploadSummary = summarizeUploadBatch(files, uploadResults)
  uploadStatusMessage.value = uploadSummary.message
  queuedUploadFiles.value = uploadSummary.retryFiles
  await fetchPapers()
}

function handleUploadInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  queueUploadFiles(input.files)
  input.value = ''
}

function handleUploadDrop(event: DragEvent) {
  uploadDragging.value = false
  queueUploadFiles(event.dataTransfer?.files)
}

function backToLibrary() {
  if (runningExtraction.value || cancellingExtraction.value) {
    statusMessage.value = 'Extraction is still running. Cancel it or wait for it to finish before closing this workspace.'
    return
  }
  extractMode.value = false
  statusMessage.value = ''
}

function updateUploadExtractionItem(id: string, patch: Partial<UploadExtractionItem>) {
  uploadExtractionItems.value = uploadExtractionItems.value.map((item) => (
    item.id === id ? { ...item, ...patch } : item
  ))
}

function uploadExtractionStatusLabel(status: UploadExtractionStatus) {
  if (status === 'extracting') return 'Extracting'
  if (status === 'completed') return 'Completed'
  if (status === 'no_data') return 'No data'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  return 'Queued'
}

function isUploadRunActiveStatus(status: string) {
  return ['queued', 'running', 'processing', 'extracting'].includes(status.toLowerCase())
}

function uploadRunFinalCount(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary | undefined
  const finalCount = Number(run?.final_count || summary?.final_count || 0)
  const weakCandidateCount = Number(summary?.weak_candidate_count || 0)
  const candidateCount = Number(run?.candidate_count || summary?.candidate_count || 0)
  return finalCount + Math.max(weakCandidateCount, candidateCount)
}

function uploadRunMessage(run: ExtractionRunDetail | null | undefined) {
  const summary = run?.summary as ExtractionSummary | undefined
  const latestProgress = Array.isArray(run?.progress_log) && run.progress_log.length > 0
    ? run.progress_log[run.progress_log.length - 1]?.message
    : ''
  return String(
    summary?.current_message
    || run?.error_message
    || latestProgress
    || summary?.no_data_reason
    || '',
  )
}

function isRetryableExtractionRunMessage(message?: string | null) {
  return String(message || '').includes('Previous extraction run stalled')
}

function isRetryableExtractionRun(run: ExtractionRunDetail | null | undefined) {
  if (!run) return false
  const status = normalizeExtractionStatus(run.status)
  return status === 'failed' && isRetryableExtractionRunMessage(uploadRunMessage(run))
}

function waitForUploadPollDelay(ms = 1400) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function uploadExtractionRunActivitySignature(run: ExtractionRunDetail) {
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

async function waitForUploadExtractionRun(
  paperId: string,
  extractorType: ExtractorType,
  initialResponse: Awaited<ReturnType<typeof extractData>>,
  preset: UploadExtractionPreset,
): Promise<Pick<UploadExtractionItem, 'status' | 'records' | 'message'>> {
  const label = uploadPresetLabel(preset)
  const initialStatus = String(initialResponse.status || '').toLowerCase()
  const summary = initialResponse.extraction_summary as ExtractionSummary | undefined
  const initialRows = Array.isArray(initialResponse.data) ? initialResponse.data : []
  const initialRecords = initialRows.length
    || Number(summary?.final_count || 0) + Math.max(Number(summary?.weak_candidate_count || 0), Number(summary?.candidate_count || 0))
  const initialMessage = initialResponse.message || ''
  if ((initialStatus === 'failed' || initialStatus === 'error') && isRetryableExtractionRunMessage(initialMessage)) {
    updateUploadExtractionItem(paperId, {
      status: 'extracting',
      records: initialRecords,
      message: 'Fresh extraction run is being queued. Status check will continue...',
    })
  } else if (!isUploadRunActiveStatus(initialStatus)) {
    const initialHasNoReviewableData = initialRecords === 0 && (initialStatus === 'no_data' || initialStatus === 'completed')
    return {
      status: initialHasNoReviewableData ? 'no_data' : 'completed',
      records: initialRecords,
      message: initialRecords > 0
        ? `${initialRecords} ${label} records extracted.`
        : (initialMessage || `No extractable ${label.toLowerCase()} records found.`),
    }
  }

  let uploadPollFailureCount = 0
  let lastActivitySignature = ''
  let lastActivityAt = Date.now()
  while (true) {
    if (uploadCancelRequested.value) {
      return {
        status: 'cancelled',
        records: initialRecords,
        message: 'Extraction cancelled by user.',
      }
    }
    await waitForUploadPollDelay()
    if (uploadCancelRequested.value) {
      return {
        status: 'cancelled',
        records: initialRecords,
        message: 'Extraction cancelled by user.',
      }
    }
    let run: ExtractionRunDetail
    try {
      run = await getLatestExtractionRun(Number(paperId), extractorType)
      uploadPollFailureCount = 0
    } catch (error: any) {
      uploadPollFailureCount += 1
      if (uploadPollFailureCount >= MAX_EXTRACTION_POLL_FAILURES) {
        throw new Error(error?.message || 'Extraction status check failed repeatedly.')
      }
      updateUploadExtractionItem(paperId, {
        message: 'Temporary status check failed, retrying...',
      })
      continue
    }

    const runStatus = String(run.status || '').toLowerCase()
    const records = uploadRunFinalCount(run)
    const runningMessage = uploadRunMessage(run) || `${label} extraction is running...`
    const activitySignature = uploadExtractionRunActivitySignature(run)
    if (activitySignature !== lastActivitySignature) {
      lastActivitySignature = activitySignature
      lastActivityAt = Date.now()
    }

    updateUploadExtractionItem(paperId, { records, message: runningMessage })

    if (isUploadRunActiveStatus(runStatus)) {
      if (Date.now() - lastActivityAt > UPLOAD_EXTRACTION_STALLED_HEARTBEAT_MS) {
        throw new Error('Extraction stopped sending progress updates. Retry or change the extraction preset.')
      }
      continue
    }
    if (runStatus === 'completed') {
      return {
        status: records > 0 ? 'completed' : 'no_data',
        records,
        message: records > 0
          ? `${records} ${label} records extracted.`
          : (uploadRunMessage(run) || `No extractable ${label.toLowerCase()} records found.`),
      }
    }
    if (runStatus === 'no_data') {
      return {
        status: records > 0 ? 'completed' : 'no_data',
        records,
        message: records > 0
          ? `${records} candidates need review.`
          : (uploadRunMessage(run) || `No extractable ${label.toLowerCase()} records found.`),
      }
    }
    if (runStatus === 'cancelled' || runStatus === 'canceled') {
      return {
        status: 'cancelled',
        records,
        message: uploadRunMessage(run) || 'Extraction cancelled by user.',
      }
    }
    if ((runStatus === 'failed' || runStatus === 'error') && isRetryableExtractionRun(run)) {
      updateUploadExtractionItem(paperId, {
        status: 'extracting',
        records,
        message: 'Fresh extraction run is being queued. Status check will continue...',
      })
      continue
    }
    throw new Error(uploadRunMessage(run) || `Extraction ended with status: ${run.status || 'failed'}.`)
  }

}

function papersSelectedForUploadExtraction() {
  const selectedUploadedIds = new Set(selectedPaperIds.value.map(String))
  const selected = uploadedPapers.value.filter((paper) => selectedUploadedIds.has(paper.id))
  return selected.length > 0 ? selected : [...uploadedPapers.value]
}

const uploadExtractionSetupBlocker = computed(() => {
  const blockedPaper = papersSelectedForUploadExtraction().find((paper) => (
    !extractorForUploadPreset(presetForUploadedPaper(paper))
  ))
  if (!blockedPaper) return ''
  return 'Conductivity extraction is not connected yet. Choose Tribology or Diffusion before starting.'
})

function openUploadExtractionSetup() {
  if (uploadedPapers.value.length === 0) return
  const papersToExtract = papersSelectedForUploadExtraction()
  selectedPaperIds.value = Array.from(new Set([
    ...selectedPaperIds.value,
    ...papersToExtract.map((paper) => Number(paper.id)).filter((id) => Number.isFinite(id)),
  ]))
  uploadModalStep.value = 'setup'
}

async function startUploadedPaperExtraction() {
  if (uploadExtracting.value || uploadedPapers.value.length === 0) return
  const papersToExtract = papersSelectedForUploadExtraction()
  if (papersToExtract.length === 0) return
  if (uploadExtractionSetupBlocker.value) {
    uploadModalStep.value = 'setup'
    uploadStatusMessage.value = uploadExtractionSetupBlocker.value
    return
  }
  selectedPaperIds.value = Array.from(new Set([
    ...selectedPaperIds.value,
    ...papersToExtract.map((paper) => Number(paper.id)).filter((id) => Number.isFinite(id)),
  ]))
  uploadModalStep.value = 'extracting'
  uploadExtracting.value = true
  uploadCancelRequested.value = false
  uploadCancelling.value = false
  uploadStatusMessage.value = `Smart extraction 1 of ${papersToExtract.length} papers...`
  uploadExtractionItems.value = papersToExtract.map((paper) => ({
    ...paper,
    status: 'queued',
    message: 'Queued for Smart extraction.',
    records: 0,
  }))

  let completed = 0
  let failed = 0
  let cancelled = 0
  for (const paper of papersToExtract) {
    if (uploadCancelRequested.value) break
    updateUploadExtractionItem(paper.id, {
      status: 'extracting',
      message: 'Running Smart extraction...',
    })
    try {
      const preset = presetForUploadedPaper(paper)
      const extractorType = extractorForUploadPreset(preset)
      if (!extractorType) {
        throw new Error('Conductivity preset is selected, but the unified conductivity extractor is not connected yet.')
      }
      const response = await extractData(String(paper.id), true, UPLOAD_EXTRACTION_PROFILE, undefined, extractorType)
      const result = await waitForUploadExtractionRun(paper.id, extractorType, response, preset)
      if (result.status === 'completed') completed += 1
      if (result.status === 'cancelled') cancelled += 1
      updateUploadExtractionItem(paper.id, {
        status: result.status,
        records: result.records,
        message: result.message,
      })
    } catch (err: any) {
      if (uploadCancelRequested.value) {
        cancelled += 1
        updateUploadExtractionItem(paper.id, {
          status: 'cancelled',
          message: 'Extraction cancelled by user.',
        })
      } else {
        failed += 1
        updateUploadExtractionItem(paper.id, {
          status: 'failed',
          message: err?.response?.data?.detail || err?.message || 'Extraction failed.',
        })
      }
    }
    const finished = completed + failed + cancelled + uploadExtractionItems.value.filter((item) => item.status === 'no_data').length
    if (finished < papersToExtract.length) {
      uploadStatusMessage.value = `Smart extraction ${finished + 1} of ${papersToExtract.length} papers...`
    }
  }

  uploadExtracting.value = false
  uploadCancelling.value = false
  if (uploadCancelRequested.value) {
    uploadExtractionItems.value = uploadExtractionItems.value.map((item) => (
      ['queued', 'extracting'].includes(item.status)
        ? { ...item, status: 'cancelled', message: 'Extraction cancelled by user.' }
        : item
    ))
    uploadStatusMessage.value = `Extraction cancelled. ${completed} completed, ${cancelled || 1} cancelled, ${failed} failed.`
  } else {
    uploadStatusMessage.value = `Extraction finished. ${completed} completed, ${failed} failed.`
  }
  await fetchPapers()
  const completedUploadItems = uploadExtractionItems.value.filter((item) => item.status === 'completed' && item.records > 0)
  if (completedUploadItems.length > 0) {
    uploadModalOpen.value = false
    emit('open-database', uploadExtractionDatabaseTarget(completedUploadItems))
  }
}

async function cancelUploadedPaperExtraction() {
  if (!uploadExtracting.value || uploadCancelling.value) return
  uploadCancelRequested.value = true
  uploadCancelling.value = true
  uploadStatusMessage.value = 'Cancelling extraction...'

  const activeItems = uploadExtractionItems.value.filter((item) => item.status === 'extracting')
  try {
    const results = await Promise.allSettled(activeItems.map((item) => {
      const paper = uploadedPapers.value.find((uploaded) => uploaded.id === item.id)
      const preset = paper ? presetForUploadedPaper(paper) : 'tribology'
      const extractorType = extractorForUploadPreset(preset)
      return extractorType ? cancelExtractionWithLocalTimeout(item.id, extractorType) : Promise.resolve(null)
    }))

    const failedCancelCount = results.filter((result) => (
      result.status === 'rejected' || (result.status === 'fulfilled' && result.value?.status === 'timeout')
    )).length
    uploadStatusMessage.value = failedCancelCount > 0
      ? 'Stop request was released locally. You can retry, change preset, or upload again while the worker winds down.'
      : 'Extraction cancelled. You can change the preset and start again.'
  } finally {
    uploadExtractionItems.value = uploadExtractionItems.value.map((item) => (
      ['queued', 'extracting'].includes(item.status)
        ? { ...item, status: 'cancelled', message: 'Extraction cancelled by user.' }
        : item
    ))
    uploadExtracting.value = false
    uploadCancelling.value = false
  }
}

async function runExtraction() {
  if (selectedPaperIds.value.length === 0) return
  const extractorTypes = extractionExtractorTypes()
  if (extractorTypes.length === 0) {
    statusMessage.value = 'Conductivity extraction is not connected yet. Choose Lubrication or Diffusion.'
    return
  }
  extractionRunExtractorTypes.value = extractorTypes
  activeExtractionTemplate.value = selectedTemplate.value
  extractionActivePaperIds.value = [...selectedPaperIds.value]
  runningExtraction.value = true
  cancellingExtraction.value = false
  statusMessage.value = `Extraction submitted for ${extractorTypes.map((type) => type === 'diffusion' ? 'Diffusion' : 'Tribology').join(' + ')} columns.`
  clearExtractionPollTimer()
  seedExtractionProgress()
  try {
    const results = await Promise.allSettled(
      extractionActivePaperIds.value.flatMap((id) => extractorTypes.map(async (extractorType) => {
        try {
          const response = await extractData(String(id), true, UPLOAD_EXTRACTION_PROFILE, undefined, extractorType)
          applyExtractionSummary(id, response.status || 'processing', response.extraction_summary, response.message)
        } catch (err: any) {
          markExtractionFailed(id, err?.message || 'Failed to start extraction.')
          throw err
        }
      })),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    if (failedCount > 0) {
      statusMessage.value = `${failedCount} extraction task${failedCount === 1 ? '' : 's'} failed to start. The rest will keep running.`
    }
    await pollExtractionRuns()
    if (runningExtraction.value) startExtractionPoll()
  } catch (err: any) {
    statusMessage.value = err?.message || 'Failed to start extraction.'
    runningExtraction.value = false
  }
}

async function cancelLibraryExtraction() {
  if (!runningExtraction.value || cancellingExtraction.value) return
  cancellingExtraction.value = true
  statusMessage.value = 'Cancelling extraction...'
  clearExtractionPollTimer()

  const activeItems = progressItems.value.filter((item) => !isTerminalStatus(item.status))
  try {
    const results = await Promise.allSettled(activeItems.flatMap((item) => (
      extractionRunExtractorTypes.value.map((extractorType) => cancelExtractionWithLocalTimeout(item.paperId, extractorType))
    )))
    const failedCancelCount = results.filter((result) => (
      result.status === 'rejected' || (result.status === 'fulfilled' && result.value?.status === 'timeout')
    )).length
    statusMessage.value = failedCancelCount > 0
      ? 'Stop request was released locally. You can retry or start a fresh extraction while the worker winds down.'
      : 'Extraction cancelled. You can adjust the template and run again.'
  } finally {
    extractionProgress.value = {
      ...extractionProgress.value,
      ...Object.fromEntries(activeItems.map((item) => [
        item.paperId,
        {
          ...item,
          status: 'cancelled',
          stage: 'Cancelled',
          message: 'Extraction cancelled by user.',
        },
      ])),
    }
    runningExtraction.value = false
    cancellingExtraction.value = false
    activeExtractionTemplate.value = null
  }
}

function markExtractionFailed(paperId: number, message: string) {
  const current = extractionProgress.value[paperId]
  if (!current) return
  extractionProgress.value = {
    ...extractionProgress.value,
    [paperId]: {
      ...current,
      status: 'failed',
      message,
    },
  }
}

function seedExtractionProgress() {
  pollFailureCounts.value = {}
  activePollCounts.value = {}
  const next: Record<number, ExtractionProgressItem> = {}
  const activeIds = new Set(extractionActivePaperIds.value)
  for (const paper of items.value.filter((item) => activeIds.has(item.id))) {
    next[paper.id] = {
      paperId: paper.id,
      title: titleFor(paper),
      status: 'queued',
      stage: 'Queued',
      message: 'Waiting for the extraction worker.',
      candidateCount: 0,
      finalCount: 0,
    }
  }
  extractionProgress.value = next
}

function normalizeExtractionStatus(status?: string | null): ExtractionProgressStatus {
  const value = String(status || '').toLowerCase()
  if (value === 'completed' || value === 'success') return 'completed'
  if (value === 'no_data') return 'no_data'
  if (value === 'failed' || value === 'error') return 'failed'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  if (value === 'queued') return 'queued'
  if (value === 'running' || value === 'processing' || value === 'extracting') return 'processing'
  return 'processing'
}

function isTerminalStatus(status?: string | null) {
  return isTerminalExtractionStatus(status)
}

async function cancelExtractionWithLocalTimeout(paperId: string | number, extractorType: ExtractorType) {
  return Promise.race([
    cancelExtraction(String(paperId), extractorType),
    new Promise<{ status: 'timeout' }>((resolve) => {
      window.setTimeout(() => resolve({ status: 'timeout' }), LIBRARY_CANCEL_TIMEOUT_MS)
    }),
  ])
}

function extractionStatusLabel(status: ExtractionProgressStatus) {
  if (status === 'completed') return 'Done'
  if (status === 'no_data') return 'No data'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'queued') return 'Queued'
  return 'Running'
}

function applyExtractionSummary(
  paperId: number,
  status: string,
  summary?: ExtractionSummary | null,
  fallbackMessage?: string,
) {
  const current = extractionProgress.value[paperId]
  if (!current) return
  extractionProgress.value = {
    ...extractionProgress.value,
    [paperId]: {
      ...current,
      status: normalizeExtractionStatus(status),
      runId: summary?.run_id ?? current.runId,
      stage: summary?.current_stage || current.stage,
      message: summary?.current_message || fallbackMessage || current.message,
      candidateCount: Number(summary?.candidate_count ?? current.candidateCount ?? 0),
      finalCount: Number(summary?.final_count ?? current.finalCount ?? 0),
    },
  }
}

function applyCombinedExtractionRuns(paperId: number, runs: ExtractionRunDetail[]) {
  const current = extractionProgress.value[paperId]
  if (!current || runs.length === 0) return
  resetPollFailures(paperId)

  const activeRun = runs.find((run) => !isTerminalStatus(normalizeExtractionStatus(run.status)))
  const retryableRun = runs.find((run) => isRetryableExtractionRun(run))
  const failedRun = runs.find((run) => (
    normalizeExtractionStatus(run.status) === 'failed' && !isRetryableExtractionRun(run)
  ))
  const totalFinal = runs.reduce((sum, run) => {
    const counts = runReviewableCounts(run)
    return sum + counts.finalCount
  }, 0)
  const totalCandidates = runs.reduce((sum, run) => {
    const counts = runReviewableCounts(run)
    return sum + counts.candidateCount
  }, 0)
  const allTerminal = runs.every((run) => (
    isTerminalStatus(normalizeExtractionStatus(run.status)) && !isRetryableExtractionRun(run)
  ))
  const status: ExtractionProgressStatus = failedRun
    ? 'failed'
    : allTerminal
      ? (totalFinal > 0 || totalCandidates > 0 ? 'completed' : 'no_data')
      : 'processing'
  const messageSource = failedRun || activeRun || retryableRun || runs.find((run) => runReviewableCounts(run).reviewableCount > 0) || runs[0]
  const summary = messageSource?.summary || {}
  const extractorLabel = runs
    .map((run) => run.extractor_type === 'diffusion' ? 'Diffusion' : 'Tribology')
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .join(' + ')

  extractionProgress.value = {
    ...extractionProgress.value,
    [paperId]: {
      ...current,
      status,
      runId: messageSource?.run_id || current.runId,
      stage: String(summary.current_stage || current.stage || ''),
      message: retryableRun && !failedRun
        ? 'Fresh extraction run is being queued. Status check will continue...'
        : messageSource?.error_message
        || String(summary.current_message || '')
        || (allTerminal ? `${extractorLabel} table columns are ready.` : `${extractorLabel} extraction is running.`),
      candidateCount: totalCandidates,
      finalCount: totalFinal,
    },
  }
}

async function pollExtractionRuns() {
  const activeItems = progressItems.value.filter((item) => !isTerminalStatus(item.status))
  if (activeItems.length === 0) {
    finishExtractionPolling()
    return
  }

  await Promise.allSettled(activeItems.map(async (item) => {
    const runs = await Promise.allSettled(
      extractionRunExtractorTypes.value.map((extractorType) => getLatestExtractionRun(item.paperId, extractorType)),
    )
    const fulfilledRuns = runs
      .filter((result): result is PromiseFulfilledResult<ExtractionRunDetail> => result.status === 'fulfilled')
      .map((result) => result.value)
    if (fulfilledRuns.length < extractionRunExtractorTypes.value.length) {
      const failure = nextPollFailureState(
        pollFailureCounts.value[item.paperId] || 0,
        extractionRunExtractorTypes.value,
        MAX_EXTRACTION_POLL_FAILURES,
      )
      pollFailureCounts.value = {
        ...pollFailureCounts.value,
        [item.paperId]: failure.failureCount,
      }
      if (failure.shouldFail) {
        markExtractionFailed(item.paperId, failure.message)
      } else {
        updateExtractionMessage(item.paperId, failure.message)
      }
      return
    }
    resetPollFailures(item.paperId)
    applyCombinedExtractionRuns(item.paperId, fulfilledRuns)
    const updated = extractionProgress.value[item.paperId]
    if (updated && !isTerminalStatus(updated.status)) {
      const activeState = nextActivePollState(
        activePollCounts.value[item.paperId] || 0,
        MAX_ACTIVE_EXTRACTION_POLLS,
      )
      activePollCounts.value = {
        ...activePollCounts.value,
        [item.paperId]: activeState.activeCount,
      }
      if (activeState.shouldRelease) {
        markExtractionStalled(item.paperId, activeState.message)
      }
    } else {
      resetActivePolls(item.paperId)
    }
  }))

  const remaining = progressItems.value.filter((item) => !isTerminalStatus(item.status)).length
  const done = progressScopeIds.value.length - remaining
  statusMessage.value = remaining > 0
    ? `${done}/${progressScopeIds.value.length} finished. ${remaining} still running.`
    : progressItems.value.some((item) => item.status === 'failed' && String(item.message || '').includes('Background worker did not finish in time'))
      ? 'Some extraction runs stalled and were released so you can retry.'
      : `${progressScopeIds.value.length}/${progressScopeIds.value.length} finished. Results are ready to review.`

  if (remaining === 0) finishExtractionPolling()
}

function updateExtractionMessage(paperId: number, message: string) {
  const current = extractionProgress.value[paperId]
  if (!current) return
  extractionProgress.value = {
    ...extractionProgress.value,
    [paperId]: {
      ...current,
      message,
    },
  }
}

function resetPollFailures(paperId: number) {
  if (!pollFailureCounts.value[paperId]) return
  const next = { ...pollFailureCounts.value }
  delete next[paperId]
  pollFailureCounts.value = next
}

function resetActivePolls(paperId: number) {
  if (!activePollCounts.value[paperId]) return
  const next = { ...activePollCounts.value }
  delete next[paperId]
  activePollCounts.value = next
}

function markExtractionStalled(paperId: number, message: string) {
  const current = extractionProgress.value[paperId]
  if (!current) return
  extractionProgress.value = {
    ...extractionProgress.value,
    [paperId]: {
      ...current,
      status: 'failed',
      stage: 'Stalled',
      message,
    },
  }
  resetActivePolls(paperId)
}

function startExtractionPoll() {
  clearExtractionPollTimer()
  extractionPollTimer = window.setTimeout(async () => {
    await pollExtractionRuns()
    if (runningExtraction.value) startExtractionPoll()
  }, 2500)
}

async function finishExtractionPolling() {
  clearExtractionPollTimer()
  runningExtraction.value = false
  await refreshCofPreviewForPapers(progressScopeIds.value)
  await fetchPapers()
  activeExtractionTemplate.value = null
}

function clearExtractionPollTimer() {
  if (extractionPollTimer !== null) {
    window.clearTimeout(extractionPollTimer)
    extractionPollTimer = null
  }
}

function openEvidence(row: { id: number, doi?: string, evidenceAvailable?: boolean }) {
  if (!row.evidenceAvailable) {
    statusMessage.value = 'Run extraction before opening evidence for this paper.'
    return
  }
  emit('open-database', libraryExtractionEvidenceDatabaseTarget(row))
}

onMounted(() => {
  void (async () => {
    await fetchPapers()
    await refreshCofPreviewForPapers(selectedPaperIds.value)
  })()
})

onUnmounted(() => {
  clearExtractionPollTimer()
  endCropDrag()
})

watch(selectedPaperIds, (ids) => {
  if (!extractMode.value || selectedTemplate.value !== 'lubrication') return
  void refreshCofPreviewForPapers(ids)
})

watch(() => props.scopeKey, () => {
  if (runningExtraction.value || cancellingExtraction.value) {
    statusMessage.value = 'Extraction is still running. Cancel it or wait for it to finish before switching library scope.'
    return
  }
  selectedPaperIds.value = []
  extractionActivePaperIds.value = []
  extractionProgress.value = {}
  extractMode.value = false
  void fetchPapers()
})

watch(() => props.selectedFileId, () => {
  void openSelectedPaperFromRoute()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white text-slate-900">
    <main class="min-h-0 flex-1 overflow-hidden px-7 pb-7 pt-6">
      <section v-if="selectedPaper" class="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div class="border-b border-slate-200 pb-5">
          <button
            type="button"
            class="mb-5 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            @click="closePaperDetail"
          >
            <ArrowLeft class="h-4 w-4" />
            Back
          </button>

          <div class="mx-auto max-w-5xl">
            <h1 class="text-xl font-extrabold leading-snug tracking-tight text-slate-900">
              {{ titleFor(selectedPaper) }}
            </h1>
            <p class="mt-4 max-w-4xl text-sm leading-6 text-slate-500">
              {{ detailAuthors((selectedPaperDetails || selectedPaper).authors) }}
            </p>
            <p v-if="paperMetaLine(selectedPaper)" class="mt-1 text-sm text-slate-500">
              {{ paperMetaLine(selectedPaper) }}
            </p>
            <div class="mt-6 flex items-center">
              <a
                v-if="selectedPaper.doi"
                class="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-teal-700"
                :href="`https://doi.org/${selectedPaper.doi}`"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink class="h-4 w-4" />
                Source
              </a>
              <div class="ml-auto inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  class="h-8 rounded-md px-4 text-sm font-extrabold transition"
                  :class="paperDetailTab === 'plain' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-white/70'"
                  @click="switchPaperDetailTab('plain')"
                >
                  Plain text
                </button>
                <button
                  type="button"
                  class="h-8 rounded-md px-4 text-sm font-extrabold transition"
                  :class="paperDetailTab === 'pdf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-white/70'"
                  @click="switchPaperDetailTab('pdf')"
                >
                  PDF
                </button>
                <button
                  type="button"
                  class="h-8 rounded-md px-4 text-sm font-extrabold transition"
                  :class="paperDetailTab === 'figures' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-white/70'"
                  @click="switchPaperDetailTab('figures')"
                >
                  Figures
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="min-h-0 overflow-auto bg-white">
          <div v-if="paperDetailError" class="mx-auto mt-16 max-w-3xl rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
            {{ paperDetailError }}
          </div>
          <div v-else-if="paperDetailTab === 'plain'" class="mx-auto max-w-4xl py-10">
            <div v-if="paperDetailLoading && !paperPlainText" class="flex h-52 items-center justify-center gap-2 text-slate-500">
              <Loader2 class="h-5 w-5 animate-spin" />
              Loading plain text...
            </div>
            <div v-else-if="plainTextParagraphs(paperPlainText).length > 0" class="space-y-6 text-[17px] leading-8 text-slate-600">
              <p v-for="(paragraph, index) in plainTextParagraphs(paperPlainText)" :key="index">
                <ChemicalText :text="paragraph" />
              </p>
            </div>
            <div v-else class="flex h-52 flex-col items-center justify-center text-slate-400">
              <FileText class="h-10 w-10" />
              <p class="mt-3 text-sm font-semibold">No plain text available.</p>
            </div>
          </div>
          <div
            v-else-if="paperDetailTab === 'pdf'"
            data-testid="paper-detail-pdf-pane"
            class="h-full min-h-[calc(100vh-17rem)] bg-slate-100 py-3"
          >
            <PdfViewerWithHighlight
              v-if="selectedPaper.hasPdf !== false"
              :src="`/api/pdf/${selectedPaper.id}`"
              class="h-full min-h-[calc(100vh-18.5rem)] w-full"
            />
            <div v-else class="flex h-80 flex-col items-center justify-center text-slate-400">
              <FileText class="h-10 w-10" />
              <p class="mt-3 text-sm font-semibold">No PDF preview available.</p>
            </div>
          </div>
          <div v-else class="mx-auto max-w-[62rem] py-10">
            <div v-if="paperDetailLoading && paperFigures.length === 0" class="flex h-52 items-center justify-center gap-2 text-slate-500">
              <Loader2 class="h-5 w-5 animate-spin" />
              Loading figures...
            </div>
            <div v-else-if="paperFigures.length > 0">
              <h2 class="mb-6 text-lg font-extrabold text-slate-900">Tables and figures ({{ paperFigures.length }})</h2>
              <div class="space-y-6">
                <article
                  v-for="figure in paperFigures"
                  :key="figure.id"
                  class="mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_30px_-24px_rgba(15,23,42,0.6)]"
                >
                  <div class="flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-5">
                    <div class="text-base text-slate-900">
                      <strong class="font-extrabold">{{ figureLabelParts(figure).kind }}</strong>
                      <span v-if="figureLabelParts(figure).number" class="ml-1">{{ figureLabelParts(figure).number }}</span>
                      <span class="ml-2 text-slate-600">Page {{ figure.page }}</span>
                      <span v-if="figure.has_override" class="ml-3 rounded-full bg-teal-50 px-2 py-1 text-xs font-black uppercase tracking-[0.12em] text-teal-700">
                        Corrected
                      </span>
                    </div>
                    <div class="flex items-center gap-2 text-slate-500">
                      <button
                        v-if="canAdjustCrops"
                        type="button"
                        class="group relative grid h-9 w-9 place-items-center rounded-md transition hover:bg-slate-100 hover:text-slate-900"
                        aria-label="Adjust crop"
                        @click="openCropEditor(figure)"
                      >
                        <Crop class="h-5 w-5 stroke-[1.8]" />
                        <span class="pointer-events-none absolute right-0 top-11 z-10 hidden whitespace-nowrap rounded-md bg-slate-800 px-3 py-2 text-sm font-bold text-white shadow-lg group-hover:block">
                          Adjust crop
                        </span>
                      </button>
                      <button
                        type="button"
                        class="group relative grid h-9 w-9 place-items-center rounded-md transition hover:bg-slate-100 hover:text-slate-900"
                        :aria-label="`Download ${figure.label}`"
                        @click="downloadFigure(figure)"
                      >
                        <Download class="h-5 w-5 stroke-[1.8]" />
                        <span class="pointer-events-none absolute right-0 top-11 z-10 hidden whitespace-nowrap rounded-md bg-slate-800 px-3 py-2 text-sm font-bold text-white shadow-lg group-hover:block">
                          Download {{ figure.label }}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="group relative grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        :aria-label="`Expand ${figure.label}`"
                        @click="openFigurePreview(figure)"
                      >
                        <Maximize2 class="h-5 w-5 stroke-[1.8]" />
                        <span class="pointer-events-none absolute right-0 top-11 z-10 hidden whitespace-nowrap rounded-md bg-slate-800 px-3 py-2 text-sm font-bold text-white shadow-lg group-hover:block">
                          Expand {{ figure.label }}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div class="bg-white p-4">
                    <div class="mx-auto flex w-fit max-w-full justify-center overflow-hidden border border-slate-200 bg-white px-3 py-3 shadow-sm">
                      <img
                        class="h-auto max-h-[24rem] max-w-[54rem] object-contain"
                        :src="figureImageSrc(figure)"
                        :alt="`${figure.label} page ${figure.page}`"
                      />
                    </div>
                    <p class="mx-auto mt-4 max-w-[54rem] text-[15px] leading-6 text-slate-700">{{ figure.caption }}</p>
                  </div>
                </article>
              </div>
            </div>
            <div v-else class="flex h-52 flex-col items-center justify-center text-slate-400">
              <FileText class="h-10 w-10" />
              <p class="mt-3 text-sm font-semibold">No table or figure captions found.</p>
            </div>
          </div>
        </div>
      </section>

      <template v-else>
      <div class="mb-5 flex items-center">
        <h1 class="text-2xl font-extrabold tracking-tight">
          <span class="text-slate-500">Library</span> / All
        </h1>
        <div class="ml-auto flex items-center gap-2">
          <button type="button" class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold">
            <Database class="h-4 w-4" />
            Connect Zotero
          </button>
          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-bold text-white"
            @click="openUploadModal"
          >
            <Upload class="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      <section class="grid h-[calc(100vh-10rem)] grid-cols-[270px_minmax(680px,1fr)_462px] gap-3">
        <aside class="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div class="border-b border-slate-200 px-4 py-3">
            <p class="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Collections</p>
          </div>
          <div class="space-y-1 p-2">
            <button
              v-for="collection in collections"
              :key="collection.key"
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition"
              :class="selectedCollection === collection.key
                ? 'bg-teal-50 text-teal-800'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'"
              @click="selectedCollection = collection.key"
            >
              <span class="truncate">{{ collection.label }}</span>
              <span v-if="collection.count !== null" class="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{{ collection.count }}</span>
            </button>
          </div>
        </aside>

        <section class="min-w-0 overflow-hidden">
          <div class="mb-2 flex min-h-12 items-center gap-2">
            <div class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model="searchQuery"
                class="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                placeholder="Search papers"
              />
            </div>
            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-teal-300 hover:text-teal-700"
              @click="fetchPapers"
            >
              <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
              Refresh
            </button>
            <div class="inline-flex h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-bold transition"
                :class="libraryViewMode === 'detail' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'"
                @click="libraryViewMode = 'detail'"
              >
                <LayoutGrid class="h-4 w-4" />
                Detail
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-bold transition"
                :class="libraryViewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'"
                @click="libraryViewMode = 'table'"
              >
                <span class="space-y-1">
                  <span class="block h-0.5 w-4 rounded bg-current"></span>
                  <span class="block h-0.5 w-4 rounded bg-current"></span>
                  <span class="block h-0.5 w-4 rounded bg-current"></span>
                </span>
                Table
              </button>
            </div>
          </div>

          <div class="h-[calc(100%-3.5rem)] overflow-auto rounded-lg border border-slate-200 bg-white">
            <div v-if="loading && items.length === 0" class="flex h-64 items-center justify-center gap-2 text-slate-500">
              <Loader2 class="h-5 w-5 animate-spin" />
              Loading papers...
            </div>
            <div v-else-if="error" class="flex h-64 items-center justify-center text-red-600">{{ error }}</div>
            <div v-else-if="filteredItems.length === 0" class="flex h-64 flex-col items-center justify-center text-slate-400">
              <FileText class="h-10 w-10" />
              <p class="mt-3 text-sm">No matching papers.</p>
            </div>
            <div v-else-if="libraryViewMode === 'detail'" class="min-w-[720px] divide-y divide-slate-200 text-sm">
              <article
                v-for="item in filteredItems"
                :key="item.id"
                class="grid min-h-[7.75rem] grid-cols-[52px_minmax(0,1fr)] gap-0 px-4 py-5 transition hover:bg-slate-50"
                :class="selectedPaperIds.includes(item.id) ? 'bg-teal-50/55 hover:bg-teal-50/70' : 'bg-white'"
              >
                <div class="pt-0.5">
                  <button
                    type="button"
                    class="grid h-6 w-6 place-items-center rounded-md border transition"
                    :class="selectedPaperIds.includes(item.id)
                      ? 'border-teal-700 bg-teal-700 text-white shadow-sm'
                      : 'border-slate-300 bg-white text-transparent hover:border-teal-700'"
                    :aria-label="selectedPaperIds.includes(item.id) ? 'Unselect paper' : 'Select paper'"
                    @click="togglePaper(item.id)"
                  >
                    <Check class="h-4 w-4 stroke-[3]" />
                  </button>
                </div>
                <div class="min-w-0 space-y-3">
                  <h2 class="max-w-4xl text-base font-extrabold leading-snug text-slate-900">
                    <button
                      type="button"
                      class="text-left decoration-slate-500 underline-offset-4 transition hover:text-slate-700 hover:underline focus:underline focus:outline-none"
                      @click="openPaperDetail(item)"
                    >
                    {{ titleFor(item) }}
                    </button>
                  </h2>
                  <p v-if="detailAuthors(item.authors) !== '-'" class="max-w-5xl truncate text-base text-slate-500">
                    {{ detailAuthors(item.authors) }}
                  </p>
                  <div v-if="publicationMetaFor(item) !== '-'" class="flex items-center gap-3 text-base text-slate-500">
                    <BookOpen class="h-[18px] w-[18px] shrink-0" />
                    <span class="truncate">{{ publicationMetaFor(item) }}</span>
                  </div>
                  <div class="flex items-center gap-3 text-base text-slate-500">
                    <FileText class="h-[18px] w-[18px] shrink-0" />
                    <span>{{ item.hasPdf === false ? 'Metadata only' : 'Full text' }}</span>
                  </div>
                </div>
              </article>
            </div>
            <table v-else class="min-w-[1180px] border-collapse text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50">
                  <th class="w-12 p-4">
                    <button
                      type="button"
                      class="grid h-6 w-6 place-items-center rounded-md border transition"
                      :class="filteredItems.length > 0 && filteredItems.every((item) => selectedPaperIds.includes(item.id))
                        ? 'border-teal-700 bg-teal-700 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-transparent hover:border-teal-700'"
                      aria-label="Select all visible papers"
                      @click="toggleAllVisible"
                    >
                      <Check class="h-4 w-4 stroke-[3]" />
                    </button>
                  </th>
                  <th class="w-[38%] border-r border-slate-200 p-4 font-extrabold">
                    <span class="inline-flex items-center gap-4">
                      Title
                      <span class="text-lg font-medium leading-none text-slate-700">&uarr;</span>
                    </span>
                  </th>
                  <th class="w-[22%] border-r border-slate-200 p-4 font-extrabold">Authors</th>
                  <th class="w-[16%] border-r border-slate-200 p-4 font-extrabold">Full text</th>
                  <th class="border-r border-slate-200 p-4 font-extrabold">Publication</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in filteredItems"
                  :key="item.id"
                  class="border-b border-slate-200 hover:bg-slate-50"
                  :class="selectedPaperIds.includes(item.id) ? 'bg-teal-50/45 hover:bg-teal-50/60' : ''"
                >
                  <td class="p-4 align-middle">
                    <button
                      type="button"
                      class="grid h-6 w-6 place-items-center rounded-md border transition"
                      :class="selectedPaperIds.includes(item.id)
                        ? 'border-teal-700 bg-teal-700 text-white shadow-sm'
                        : 'border-slate-300 bg-white text-transparent hover:border-teal-700'"
                      :aria-label="selectedPaperIds.includes(item.id) ? 'Unselect paper' : 'Select paper'"
                      @click="togglePaper(item.id)"
                    >
                      <Check class="h-4 w-4 stroke-[3]" />
                    </button>
                  </td>
                  <td class="border-r border-slate-200 p-4 align-middle font-bold">
                    <button
                      type="button"
                      class="text-left decoration-slate-500 underline-offset-4 transition hover:text-slate-700 hover:underline focus:underline focus:outline-none"
                      @click="openPaperDetail(item)"
                    >
                      {{ titleFor(item) }}
                    </button>
                  </td>
                  <td class="border-r border-slate-200 p-4 align-middle text-slate-500">
                    {{ primaryAuthors(item.authors) }}
                  </td>
                  <td class="border-r border-slate-200 p-4 align-middle text-slate-500">
                    {{ item.hasPdf === false ? 'Metadata only' : 'Full text available' }}
                  </td>
                  <td class="border-r border-slate-200 p-4 align-middle text-slate-500">
                    {{ publicationMetaFor(item) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside class="grid grid-rows-[68px_1fr] rounded-lg border border-slate-200 bg-white">
          <div class="flex items-center border-b border-slate-200 px-5 text-base font-extrabold">
            New from selection
          </div>
          <div class="p-4">
            <p class="mb-4 text-sm font-semibold text-slate-500">{{ selectedCountLabel }}</p>
            <button type="button" class="mb-3 flex min-h-12 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 text-left text-sm font-extrabold text-slate-500">
              <span>Start systematic review</span>
              <span>Open</span>
            </button>
            <button
              type="button"
              class="flex min-h-12 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 text-left text-sm font-extrabold text-slate-500"
              @click="openExtractData"
            >
              <span>Extract data</span>
              <span>Open</span>
            </button>
          </div>
        </aside>
      </section>
      </template>
    </main>

    <div
      v-if="extractMode"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extract-data-modal-title"
      @click.self="backToLibrary"
    >
      <section class="grid h-[min(46rem,calc(100vh-3rem))] w-[min(92rem,calc(100vw-3rem))] grid-rows-[4.75rem_minmax(0,1fr)] overflow-hidden rounded-xl bg-white shadow-[0_28px_90px_-30px_rgba(15,23,42,0.55)]">
        <div class="flex items-center gap-4 border-b border-slate-200 px-6 py-4">
          <div class="min-w-0">
            <p class="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Library selection</p>
            <h2 id="extract-data-modal-title" class="truncate text-2xl font-extrabold tracking-tight">Extract data</h2>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <span class="rounded-full border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500">{{ selectedCountLabel }}</span>
            <button
              type="button"
              class="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold transition hover:border-teal-300 hover:text-teal-700"
              @click="columnComposerOpen = !columnComposerOpen"
            >
              Add column
            </button>
            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-60"
              :disabled="runningExtraction || cancellingExtraction || selectedPaperIds.length === 0 || Boolean(extractionTemplateBlocker)"
              @click="runExtraction"
            >
              <Loader2 v-if="runningExtraction" class="h-4 w-4 animate-spin" />
              {{ runningExtraction ? 'Running' : 'Run extraction' }}
            </button>
            <button
              v-if="runningExtraction"
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="cancellingExtraction"
              @click="cancelLibraryExtraction"
            >
              <Loader2 v-if="cancellingExtraction" class="h-4 w-4 animate-spin" />
              <X v-else class="h-4 w-4" />
              {{ cancellingExtraction ? 'Cancelling...' : 'Cancel extraction' }}
            </button>
            <button
              type="button"
              class="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-2xl font-light leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close Extract data"
              @click="backToLibrary"
            >
              x
            </button>
          </div>
        </div>

        <div class="grid min-h-0 grid-cols-[minmax(760px,1fr)_360px] gap-3 bg-slate-50 p-3">
          <section class="min-w-0 overflow-hidden">
          <div class="mb-2 flex h-12 items-center gap-2">
            <button type="button" class="h-10 rounded-lg bg-teal-700 px-4 text-sm font-extrabold text-white">
              Columns ({{ extractionTableColumns.length }})
            </button>
            <button type="button" class="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold">
              Database table
            </button>
            <button type="button" class="h-10 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-500">
              Evidence required
            </button>
          </div>

          <div class="h-[calc(100%-3.5rem)] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table class="min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50">
                  <th class="w-12 p-4"></th>
                  <th class="w-[32%] border-r border-slate-200 p-4 font-extrabold">Paper</th>
                  <th
                    v-for="column in extractionTableColumns"
                    :key="column.id"
                    class="min-w-40 border-r border-slate-200 p-4 font-extrabold"
                    :class="column.label === 'Evidence' ? 'min-w-48' : ''"
                  >
                    <span class="flex items-center justify-between gap-3">
                      <span>{{ column.label }}</span>
                      <button
                        v-if="!column.preset"
                        type="button"
                        class="rounded text-xs text-slate-400 transition hover:text-red-500"
                        aria-label="Remove custom column"
                        @click="removeExtractionColumn(column.id)"
                      >
                        x
                      </button>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in extractionRows" :key="row.id" class="border-b border-slate-200">
                  <td class="p-4"><span class="block h-5 w-5 rounded border border-teal-700 bg-teal-700"></span></td>
                  <td class="border-r border-slate-200 p-4">
                    <strong class="block text-sm font-extrabold text-slate-900">{{ row.title }}</strong>
                    <span class="mt-1 block text-xs font-semibold text-slate-500">{{ row.authors }}</span>
                    <span class="mt-1 block text-xs text-slate-400">{{ row.journal }}</span>
                  </td>
                  <td
                    v-for="column in extractionTableColumns"
                    :key="column.id"
                    class="border-r border-slate-200 p-4 text-slate-600"
                  >
                    <button
                      v-if="column.label === 'Evidence' && row.evidenceAvailable"
                      type="button"
                      class="font-extrabold text-teal-700"
                      aria-label="Open extracted evidence in Database"
                      @click="openEvidence(row)"
                    >
                      {{ row.cells[column.label] }}
                    </button>
                    <span v-else>{{ row.cells[column.label] }}</span>
                  </td>
                </tr>
                <tr v-if="extractionRows.length === 0">
                  <td :colspan="extractionTableColumns.length + 2" class="p-12 text-center text-slate-400">Select papers in Library before extracting data.</td>
                </tr>
              </tbody>
            </table>
          </div>
          </section>

          <aside class="grid grid-rows-[68px_1fr] rounded-lg border border-slate-200 bg-white">
          <div class="flex items-center border-b border-slate-200 px-5 text-base font-extrabold">
            Extraction setup
          </div>
          <div class="overflow-auto p-4">
            <div v-if="progressItems.length > 0" class="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div class="mb-3 flex items-center justify-between text-sm font-extrabold">
                <span>Extraction progress</span>
                <span class="text-slate-500">{{ finishedProgressCount }}/{{ progressScopeIds.length }}</span>
              </div>
              <div class="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-teal-700 transition-all" :style="{ width: `${extractionProgressPercent}%` }"></div>
              </div>
              <div class="space-y-2">
                <article
                  v-for="item in progressItems"
                  :key="item.paperId"
                  class="rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <div class="flex items-start gap-2">
                    <p class="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{{ item.title }}</p>
                    <span
                      class="shrink-0 rounded-full px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em]"
                      :class="isTerminalStatus(item.status)
                        ? 'bg-teal-100 text-teal-800'
                        : 'bg-cyan-100 text-cyan-800'"
                    >
                      {{ extractionStatusLabel(item.status) }}
                    </span>
                  </div>
                  <p class="mt-2 max-h-10 overflow-hidden text-xs leading-relaxed text-slate-500">
                    {{ item.message || item.stage || 'Waiting for status.' }}
                  </p>
                  <p class="mt-2 text-xs font-bold text-slate-500">
                    {{ item.candidateCount || 0 }} candidates / {{ item.finalCount || 0 }} records
                  </p>
                </article>
              </div>
            </div>
            <button
              v-for="template in templates"
              :key="template.key"
              type="button"
              class="mb-3 block w-full rounded-lg border p-4 text-left"
              :class="extractionDisplayTemplate === template.key ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white'"
              :disabled="runningExtraction || cancellingExtraction"
              @click="setExtractionTemplate(template.key)"
            >
              <span class="flex items-center justify-between gap-3">
                <strong class="block text-sm">{{ template.label }}</strong>
                <span
                  v-if="template.availabilityNote"
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800"
                >
                  Coming soon
                </span>
              </span>
              <small class="mt-1 block leading-relaxed text-slate-500">{{ template.description }}</small>
              <small v-if="template.availabilityNote" class="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 font-bold leading-relaxed text-amber-800">
                {{ template.availabilityNote }}
              </small>
            </button>
            <p
              v-if="extractionTemplateBlocker"
              class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
            >
              {{ extractionTemplateBlocker }}
            </p>
            <button type="button" class="mb-3 block w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
              <strong class="block text-sm">Preset columns</strong>
              <small class="mt-1 block leading-relaxed text-slate-500">Tribology, Diffusion, and Conductivity stay available as table columns.</small>
            </button>
            <div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <button type="button" class="block w-full text-left" @click="columnComposerOpen = !columnComposerOpen">
                <strong class="block text-sm">+ Add custom column</strong>
                <small class="mt-1 block leading-relaxed text-slate-500">Ask a specific question for every selected paper.</small>
              </button>
              <div v-if="columnComposerOpen" class="mt-3 space-y-2">
                <input
                  v-model="newExtractionColumnName"
                  type="text"
                  class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  placeholder="Column name, e.g. Funding source"
                >
                <textarea
                  v-model="newExtractionColumnPrompt"
                  class="min-h-20 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  placeholder="What should AI extract for this column?"
                ></textarea>
                <button
                  type="button"
                  class="h-9 rounded-lg bg-teal-700 px-3 text-sm font-extrabold text-white disabled:opacity-50"
                  :disabled="!newExtractionColumnName.trim()"
                  @click="addExtractionColumn"
                >
                  Add column
                </button>
              </div>
            </div>
            <button
              type="button"
              class="block w-full rounded-lg border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50"
              :disabled="!extractionSave.canSave"
              @click="saveExtractionTable"
            >
              <strong class="block text-sm">Save extraction table</strong>
              <small class="mt-1 block leading-relaxed text-slate-500">{{ extractionSave.message }}</small>
            </button>
            <p v-if="statusMessage" class="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">
              {{ statusMessage }}
            </p>
          </div>
          </aside>
        </div>
      </section>
    </div>

    <div
      v-if="cropEditorFigure"
      class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Adjust figure crop"
      @click.self="closeCropEditor"
    >
      <section class="grid h-[min(52rem,calc(100vh-2.5rem))] w-[min(96rem,calc(100vw-2.5rem))] grid-cols-[minmax(0,1fr)_22rem] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <header class="flex min-h-16 items-center gap-3 border-b border-slate-200 px-5">
            <div class="min-w-0">
              <p class="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Crop data sample</p>
              <h2 class="truncate text-lg font-extrabold text-slate-900">
                {{ cropEditorFigure.label }} &middot; Page {{ cropEditorFigure.page }}
              </h2>
            </div>
            <span
              v-if="cropEditorFigure.has_override"
              class="ml-auto rounded-full bg-teal-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-teal-700"
            >
              Corrected
            </span>
          </header>

          <div class="min-h-0 overflow-auto bg-slate-100 p-5">
            <div v-if="cropEditorLoading" class="flex h-full min-h-96 items-center justify-center gap-2 text-slate-500">
              <Loader2 class="h-5 w-5 animate-spin" />
              Loading original page...
            </div>
            <div v-else-if="cropEditorPage" class="mx-auto w-fit max-w-full">
              <div
                ref="cropEditorFrameRef"
                class="relative max-w-full overflow-hidden bg-white shadow-xl"
              >
                <img
                  class="block h-auto max-h-[calc(100vh-12rem)] max-w-full select-none"
                  :src="cropEditorImageSrc"
                  :alt="`Original page ${cropEditorPage.page}`"
                  draggable="false"
                />
                <div
                  class="absolute border-2 border-teal-600 bg-teal-400/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.30)]"
                  :style="cropEditorOverlayStyle"
                  @pointerdown.stop="beginCropDrag('move', $event)"
                >
                  <span class="absolute left-2 top-2 rounded bg-teal-700 px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white">
                    Drag
                  </span>
                  <button type="button" class="absolute -left-2 -top-2 h-4 w-4 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize northwest" @pointerdown.stop="beginCropDrag('nw', $event)"></button>
                  <button type="button" class="absolute left-1/2 -top-2 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize north" @pointerdown.stop="beginCropDrag('n', $event)"></button>
                  <button type="button" class="absolute -right-2 -top-2 h-4 w-4 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize northeast" @pointerdown.stop="beginCropDrag('ne', $event)"></button>
                  <button type="button" class="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize east" @pointerdown.stop="beginCropDrag('e', $event)"></button>
                  <button type="button" class="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize southeast" @pointerdown.stop="beginCropDrag('se', $event)"></button>
                  <button type="button" class="absolute bottom-[-0.5rem] left-1/2 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize south" @pointerdown.stop="beginCropDrag('s', $event)"></button>
                  <button type="button" class="absolute -bottom-2 -left-2 h-4 w-4 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize southwest" @pointerdown.stop="beginCropDrag('sw', $event)"></button>
                  <button type="button" class="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-teal-700 shadow" aria-label="Resize west" @pointerdown.stop="beginCropDrag('w', $event)"></button>
                </div>
              </div>
            </div>
            <div v-else class="flex h-full min-h-96 items-center justify-center text-sm font-semibold text-slate-500">
              Original page is not available.
            </div>
          </div>
        </div>

        <aside class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-l border-slate-200 bg-white">
          <header class="border-b border-slate-200 p-5">
            <h3 class="text-base font-extrabold text-slate-900">Admin crop correction</h3>
            <p class="mt-2 text-sm leading-6 text-slate-500">
              Saved crops replace the preview for users and become benchmark samples for the segmentation algorithm.
            </p>
          </header>

          <div class="min-h-0 overflow-auto p-5">
            <div v-if="cropEditorError" class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {{ cropEditorError }}
            </div>

            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p class="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Current box</p>
              <p class="mt-2 font-mono text-sm text-slate-700">{{ cropEditorBox.join(', ') }}</p>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3">
              <label class="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                X0
                <input class="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-teal-700" :value="cropEditorBox[0]" @input="setCropCoordFromEvent(0, $event)" />
              </label>
              <label class="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Y0
                <input class="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-teal-700" :value="cropEditorBox[1]" @input="setCropCoordFromEvent(1, $event)" />
              </label>
              <label class="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                X1
                <input class="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-teal-700" :value="cropEditorBox[2]" @input="setCropCoordFromEvent(2, $event)" />
              </label>
              <label class="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Y1
                <input class="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-teal-700" :value="cropEditorBox[3]" @input="setCropCoordFromEvent(3, $event)" />
              </label>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-2">
              <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50" @click="nudgeCropEdge('top', -12)">More top</button>
              <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50" @click="nudgeCropEdge('bottom', 12)">More bottom</button>
              <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50" @click="nudgeCropEdge('left', -12)">More left</button>
              <button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50" @click="nudgeCropEdge('right', 12)">More right</button>
            </div>

            <div class="mt-5 rounded-lg border border-slate-200 p-3">
              <p class="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Algorithm box</p>
              <p class="mt-2 font-mono text-xs leading-5 text-slate-500">
                {{ (cropEditorFigure.algorithm_bbox || cropEditorFigure.clip_bbox || []).join(', ') || 'Not recorded' }}
              </p>
            </div>
          </div>

          <footer class="flex items-center gap-2 border-t border-slate-200 p-4">
            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-bold text-white disabled:opacity-60"
              :disabled="cropEditorSaving || cropEditorLoading || !cropEditorPage"
              @click="saveCropEditor"
            >
              <Loader2 v-if="cropEditorSaving" class="h-4 w-4 animate-spin" />
              <Save v-else class="h-4 w-4" />
              Save
            </button>
            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              :disabled="cropEditorSaving || !cropEditorFigure.override_id"
              @click="resetCropEditor"
            >
              <RotateCcw class="h-4 w-4" />
              Reset
            </button>
            <button
              type="button"
              class="ml-auto grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Close crop editor"
              @click="closeCropEditor"
            >
              <X class="h-5 w-5" />
            </button>
          </footer>
        </aside>
      </section>
    </div>

    <div
      v-if="expandedFigure"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-6"
      role="dialog"
      aria-modal="true"
      :aria-label="`Expanded preview for ${expandedFigure.label}`"
      @click.self="closeFigurePreview"
    >
      <section class="grid max-h-[calc(100vh-3rem)] w-[min(78rem,calc(100vw-3rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-white shadow-2xl">
        <header class="flex min-h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div class="min-w-0">
            <strong class="block truncate text-base font-extrabold text-slate-900">{{ expandedFigure.label }}</strong>
            <span class="text-sm font-semibold text-slate-500">Page {{ expandedFigure.page }}</span>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              class="grid h-10 w-10 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              :aria-label="`Download ${expandedFigure.label}`"
              @click="downloadFigure(expandedFigure)"
            >
              <Download class="h-5 w-5" />
            </button>
            <button
              type="button"
              class="grid h-10 w-10 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close expanded preview"
              @click="closeFigurePreview"
            >
              <X class="h-5 w-5" />
            </button>
          </div>
        </header>
        <div class="overflow-auto bg-slate-100 p-5">
          <img
            class="mx-auto max-w-full bg-white shadow-lg"
            :src="figureImageSrc(expandedFigure)"
            :alt="`${expandedFigure.label} page ${expandedFigure.page}`"
          />
          <p class="mx-auto mt-4 max-w-5xl rounded-lg bg-white p-4 text-base leading-7 text-slate-700 shadow-sm">
            {{ expandedFigure.caption }}
          </p>
        </div>
      </section>
    </div>

    <div
      v-if="uploadModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-5 py-8 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-papers-title"
      @click.self="closeUploadModal"
    >
      <section class="w-full max-w-[56rem] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div class="flex items-center justify-between px-1 pb-3">
          <h2 id="upload-papers-title" class="text-lg font-extrabold tracking-tight text-slate-900">
            {{ uploadModalStep === 'upload' ? 'Upload papers' : 'Explore the scientific literature' }}
          </h2>
          <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            aria-label="Close upload dialog"
            :disabled="uploadUploading || uploadExtracting"
            @click="closeUploadModal"
          >
            <X class="h-5 w-5 stroke-[1.8]" />
          </button>
        </div>

        <div v-if="uploadModalStep === 'upload'">
          <input
            ref="uploadInputRef"
            class="hidden"
            type="file"
            multiple
            accept=".pdf,application/pdf"
            @change="handleUploadInputChange"
          />
          <div
            class="flex min-h-[13rem] cursor-pointer items-center justify-center rounded-lg border border-dashed px-6 text-center transition"
            :class="uploadDragging ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-[#fbfaff] hover:border-teal-300 hover:bg-teal-50/40'"
            role="button"
            tabindex="0"
            @dragover.prevent="uploadDragging = true"
            @dragleave.prevent="uploadDragging = false"
            @drop.prevent="handleUploadDrop"
            @click="chooseUploadFiles"
            @keydown.enter.prevent="chooseUploadFiles"
            @keydown.space.prevent="chooseUploadFiles"
          >
            <div class="flex flex-col items-center">
              <CloudUpload class="h-11 w-11 text-violet-500" />
              <p class="mt-4 text-base font-extrabold text-violet-600">Drag and drop PDFs</p>
              <p class="mt-1 text-sm font-semibold text-violet-500/80">Or click to browse files</p>
              <p v-if="uploadStatusMessage" class="mt-4 text-sm font-semibold text-slate-600">
                {{ uploadStatusMessage }}
              </p>
            </div>
          </div>
          <div
            v-if="queuedUploadFiles.length"
            class="mt-4 max-h-32 space-y-2 overflow-y-auto pr-1"
            aria-label="Selected PDF files"
          >
            <div
              v-for="(file, index) in queuedUploadFiles"
              :key="`${file.name}-${file.size}-${file.lastModified}`"
              class="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-700"
            >
              <FileText class="h-5 w-5 shrink-0 text-violet-500" />
              <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
              <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                :aria-label="`Remove ${file.name}`"
                :disabled="uploadUploading"
                @click.stop="removeQueuedUploadFile(index)"
              >
                <X class="h-5 w-5 stroke-[1.8]" />
              </button>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-end gap-4">
            <button
              type="button"
              class="inline-flex h-10 items-center rounded-md bg-violet-500 px-5 text-sm font-extrabold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-55"
              :disabled="uploadUploading || queuedUploadFiles.length === 0"
              @click="uploadQueuedFiles"
            >
              {{ uploadUploading ? 'Uploading...' : 'Upload PDFs' }}
            </button>
          </div>
          <div class="mt-6 flex justify-end">
            <button
              type="button"
              class="grid h-11 w-11 place-items-center rounded-full bg-violet-400 text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-55"
              aria-label="Continue to extraction setup"
              :disabled="uploadUploading || uploadHasQueuedFiles"
              @click="continueFromUploadModal"
            >
              <ArrowRight class="h-5 w-5 stroke-[2.4]" />
            </button>
          </div>
        </div>

        <div v-else-if="uploadModalStep === 'select'">
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
              Parsed metadata for {{ uploadedPapers.length }} uploaded papers<span v-if="uploadPendingFileNames.length">, {{ uploadPendingFileNames.length }} still parsing</span>. Select papers to extract information or upload additional papers.
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
                  @click="uploadModalStep = 'upload'"
                >
                  + Upload papers
                </button>
              </div>
              <div
                v-if="shouldShowUploadBatchProgress"
                class="ml-auto min-w-[17rem] rounded-lg border border-violet-100 bg-violet-50/60 px-4 py-2 shadow-sm"
                aria-label="Upload parsing progress"
              >
                <div class="flex items-center justify-between gap-3">
                  <span class="text-xs font-black uppercase tracking-[0.14em] text-violet-500">
                    {{ uploadUploading ? 'Parsing' : 'Parsed' }}
                  </span>
                  <strong class="font-mono text-sm font-black text-violet-700">{{ uploadBatchFinished }} / {{ uploadBatchTotal }}</strong>
                </div>
                <div class="mt-2 h-2 overflow-hidden rounded-full bg-white ring-1 ring-violet-100">
                  <div
                    class="h-full rounded-full bg-gradient-to-r from-violet-500 to-teal-400 transition-all duration-500 ease-out"
                    :style="{ width: `${uploadBatchProgressPercent}%` }"
                  ></div>
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
                v-for="paper in uploadedPapers"
                :key="paper.id"
                type="button"
                class="flex w-full items-start gap-4 border-b border-slate-100 px-5 py-4 text-left transition last:border-b-0 hover:bg-violet-50/45"
                @click="togglePaper(Number(paper.id))"
              >
                <span
                  class="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded border"
                  :class="selectedPaperIds.includes(Number(paper.id)) ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-200 bg-white'"
                >
                  <Check v-if="selectedPaperIds.includes(Number(paper.id))" class="h-3.5 w-3.5 stroke-[3]" />
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-base font-extrabold text-violet-700">{{ paper.title }}</span>
                  <span class="mt-1 block truncate text-sm font-semibold text-slate-500">{{ compactAuthorLine(paper.authors) }}</span>
                </span>
              </button>
              <div v-if="uploadedPapers.length === 0 && uploadPendingFileNames.length > 0" key="parsing" class="px-5 py-8 text-center">
                <Loader2 class="mx-auto h-5 w-5 animate-spin text-violet-500" />
                <p class="mt-3 text-sm font-semibold text-slate-500">Parsing metadata in the background</p>
              </div>
              <div v-if="uploadedPapers.length === 0 && uploadPendingFileNames.length === 0" key="empty" class="px-5 py-8 text-center text-sm font-semibold text-slate-400">
                Uploaded papers will appear here after metadata parsing.
              </div>
            </TransitionGroup>
            <div class="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p class="text-sm font-semibold text-slate-500">
                {{ uploadedPapers.filter((paper) => selectedPaperIds.includes(Number(paper.id))).length || uploadedPapers.length }} paper{{ (uploadedPapers.filter((paper) => selectedPaperIds.includes(Number(paper.id))).length || uploadedPapers.length) === 1 ? '' : 's' }} ready.
              </p>
              <button
                type="button"
                class="inline-flex h-11 items-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="uploadedPapers.length === 0"
                @click="openUploadExtractionSetup"
              >
                <Upload class="h-4 w-4" />
                Start extraction
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="uploadModalStep === 'setup'">
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
                {{ papersSelectedForUploadExtraction().length }} papers
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
                v-for="paper in papersSelectedForUploadExtraction()"
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
                    :value="presetForUploadedPaper(paper)"
                    @change="setUploadedPaperExtractionPreset(paper.id, $event)"
                  >
                     <option
                       v-for="option in uploadExtractionPresetOptions"
                       :key="option.value"
                       :value="option.value"
                       :disabled="!extractorForUploadPreset(option.value)"
                     >
                       {{ option.label }}
                     </option>
                   </select>
                 </label>
               </div>
             </div>
             <p
               v-if="uploadExtractionSetupBlocker"
               class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
             >
               {{ uploadExtractionSetupBlocker }}
             </p>

             <div class="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                class="inline-flex h-10 items-center rounded-md border border-slate-200 px-4 text-sm font-extrabold text-slate-600 transition hover:border-violet-300 hover:text-violet-600"
                @click="uploadModalStep = 'select'"
              >
                Back
              </button>
              <button
                 type="button"
                 class="inline-flex h-11 items-center gap-2 rounded-md bg-violet-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-55"
                 :disabled="papersSelectedForUploadExtraction().length === 0 || Boolean(uploadExtractionSetupBlocker)"
                 @click="startUploadedPaperExtraction"
               >
                <Upload class="h-4 w-4" />
                Start extraction
              </button>
            </div>
          </div>
        </div>

        <div v-else>
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
                <p class="mt-2 text-sm font-medium text-slate-500">{{ uploadStatusMessage }}</p>
              </div>
              <div class="text-right">
                <strong class="block text-2xl font-black text-violet-600">{{ uploadExtractionProgress }}%</strong>
                <span class="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Progress</span>
              </div>
              <button
                v-if="uploadExtracting"
                type="button"
                class="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-extrabold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="uploadCancelling"
                @click="cancelUploadedPaperExtraction"
              >
                <Loader2 v-if="uploadCancelling" class="h-4 w-4 animate-spin" />
                <X v-else class="h-4 w-4" />
                {{ uploadCancelling ? 'Cancelling...' : 'Cancel extraction' }}
              </button>
            </div>
            <div class="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-violet-500 transition-all duration-500" :style="{ width: `${uploadExtractionProgress}%` }"></div>
            </div>
            <div class="mt-5 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
              <div
                v-for="item in uploadExtractionItems"
                :key="item.id"
                class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4"
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
                      {{ uploadExtractionStatusLabel(item.status) }}
                    </span>
                  </div>
                  <p class="mt-1 truncate text-sm font-semibold text-slate-500">{{ compactAuthorLine(item.authors) }}</p>
                  <p class="mt-2 text-sm font-medium text-slate-600">{{ item.message }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
