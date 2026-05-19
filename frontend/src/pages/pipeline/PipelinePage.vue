<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Upload,
} from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'
import type { AgentMessage, AgentWorkflow, BatchFile, ExtractionRunDetail, ExtractorType } from '@/lib/api'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  queueSizeLabel: string
  operatorName: string
  runStateLabel: string
  selectedFileName: string
  selectedFile: BatchFile | null
  selectedFileId: string | null
  explorerDoi: string
  sessionScopeKey?: string | null
  files: BatchFile[]
  activeId: string | null
  bindFileUploadRef: (instance: any) => void
  bindChatPanelRef: (instance: any) => void
  sidebarTab: 'chat' | 'agents'
  isChatting: boolean
  latestAgentWorkflow: AgentWorkflow | null
  activeRun: ExtractionRunDetail | null
  activeFileName: string | null
  defaultExtractorType: ExtractorType
}>()

const emit = defineEmits([
  'change-section',
  'select-file',
  'remove-file',
  'clear-files',
  'upload',
  'batch-upload',
  'extract',
  'batch-extract',
  'cancel-extraction',
  'send-chat',
  'update-sidebar-tab',
  'open-review',
  'clear-doi',
  'set-default-extractor-type',
  'set-file-extractor-type',
])

type PipelineFilter = 'all' | 'processing' | 'error' | 'success'
type QueueItem = {
  id: string
  name: string
  status: string
  badge: string
  badgeClass: string
  meta: string
  sublabel: string
  progress: number
  progressClass: string
  isSelected: boolean
}

type InspectorStep = {
  id: string
  label: string
  state: 'complete' | 'active' | 'waiting' | 'error'
  meta: string
}

type InspectorLog = {
  id: string
  prefix: string
  message: string
  tone: 'info' | 'agent' | 'system'
}

type InspectorDiagnostic = {
  key: string
  label: string
  value: string
}

type ExtractorOption = {
  key: ExtractorType
  label: string
  shortLabel: string
  helper: string
  detail: string
  activeClass: string
  inactiveClass: string
  badgeClass: string
}

const searchQuery = ref('')
const statusFilter = ref<PipelineFilter>('all')
const fileInput = ref<HTMLInputElement | null>(null)
const { isChinese } = useI18n()
const extractorOptions = computed<ExtractorOption[]>(() => [
  {
    key: 'tribology',
    label: isChinese.value ? '摩擦学数据抽取' : 'Tribology Data',
    shortLabel: isChinese.value ? '摩擦学抽取' : 'Tribology',
    helper: isChinese.value ? '用于润滑、摩擦、磨损实验论文' : 'For lubrication, friction, and wear papers',
    detail: isChinese.value ? '抽取 COF、载荷、速度、温度、材料配副、离子液体。' : 'Extracts COF, load, speed, temperature, tribopair, and ionic liquid.',
    activeClass: 'border-blue-300 bg-blue-50 text-blue-950 shadow-sm ring-1 ring-blue-200',
    inactiveClass: 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/40',
    badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  {
    key: 'diffusion',
    label: isChinese.value ? '扩散数据抽取' : 'Diffusion Data',
    shortLabel: isChinese.value ? '扩散抽取' : 'Diffusion',
    helper: isChinese.value ? '用于限域扩散、输运和分子动力学论文' : 'For confined diffusion, transport, and MD papers',
    detail: isChinese.value ? '抽取 D 值、限域尺度、温度、体系组成、离子液体。' : 'Extracts D values, confinement scale, temperature, system composition, and ionic liquid.',
    activeClass: 'border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-200',
    inactiveClass: 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/40',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
])

const pageCopy = computed(() => ({
  eyebrow: isChinese.value ? '核心工作流' : 'Core Workflow',
  title: isChinese.value ? '文献数据抽取' : 'Literature Extraction',
  subtitle: isChinese.value
    ? '上传论文，选择抽取类型，启动代理抽取并进入审阅。'
    : 'Upload papers, choose an extraction type, run agents, then move results into review.',
  upload: isChinese.value ? '上传论文' : 'Upload Document',
  extractSelected: isChinese.value ? '抽取当前论文' : 'Extract Selected',
  batchExtract: isChinese.value ? '抽取队列' : 'Extract Queue',
  selected: isChinese.value ? '当前论文' : 'Selected',
  noSelection: isChinese.value ? '尚未选择论文' : 'No document selected',
  extractionType: isChinese.value ? '抽取类型' : 'Extraction Type',
  extractionTypeHint: isChinese.value ? '先选类型，再上传或抽取；当前论文会沿用这个类型。' : 'Choose the task type before upload or extraction. The selected paper will use it.',
  search: isChinese.value ? '搜索运行...' : 'Search runs...',
  filter: isChinese.value ? '筛选' : 'Filter',
  autoRefresh: isChinese.value ? '自动刷新' : 'Auto-refreshing',
  groupedRuns: isChinese.value ? '批量运行' : 'Batch Runs',
}))

const READY_TO_EXTRACT_STATUSES = new Set(['uploaded', 'queued', 'pending', 'ready', 'staged', 'cancelled', 'no_data', 'error', 'failed', 'success', 'completed'])
const RUNNING_STATUSES = new Set(['processing', 'running', 'extracting'])
const FINISHED_STATUSES = new Set(['success', 'completed'])
const FAILED_STATUSES = new Set(['error', 'failed'])

function normalizedFileStatus(fileOrStatus?: BatchFile | string | null) {
  const rawStatus = typeof fileOrStatus === 'string'
    ? fileOrStatus
    : fileOrStatus?.status
  return String(rawStatus || '').trim().toLowerCase()
}

function hasReadyMessage(file?: BatchFile | null) {
  const message = String(file?.progressMessage || '').trim().toLowerCase()
  if (!message) return false
  return message.includes('ready to extract')
    || message.includes('ready to launch')
    || message.includes('可以开始')
    || message.includes('待抽取')
}

function isFileRunning(file?: BatchFile | null) {
  if (!file) return false
  return RUNNING_STATUSES.has(normalizedFileStatus(file))
}

function isFileReadyToExtract(file?: BatchFile | null) {
  if (!file) return false
  const status = normalizedFileStatus(file)
  if (isFileRunning(file)) return false
  return READY_TO_EXTRACT_STATUSES.has(status) || hasReadyMessage(file)
}

function displayStatusForFile(file: BatchFile) {
  const status = normalizedFileStatus(file)
  if (status === 'uploading' && hasReadyMessage(file)) return 'uploaded'
  if (['queued', 'pending', 'ready', 'staged'].includes(status)) return 'uploaded'
  if (status === 'running' || status === 'extracting') return 'processing'
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  return status || 'uploaded'
}

const extractionMetrics = computed(() => {
  const files = props.files
  return [
    {
      key: 'queued',
      label: isChinese.value ? '待抽取' : 'Ready',
      value: files.filter((file) => isFileReadyToExtract(file)).length,
    },
    {
      key: 'running',
      label: isChinese.value ? '运行中' : 'Running',
      value: files.filter((file) => isFileRunning(file)).length,
    },
    {
      key: 'done',
      label: isChinese.value ? '已抽取' : 'Extracted',
      value: files.filter((file) => FINISHED_STATUSES.has(normalizedFileStatus(file))).length,
    },
    {
      key: 'failed',
      label: isChinese.value ? '待重试' : 'Retry',
      value: files.filter((file) => FAILED_STATUSES.has(normalizedFileStatus(file))).length,
    },
  ]
})

const queueEyebrow = computed(() => {
  if (props.currentSection === 'batch') return isChinese.value ? '批量抽取与重试' : 'BATCH EXTRACTION & RETRIES'
  if (props.currentSection === 'upload') return isChinese.value ? '上传队列' : 'UPLOAD QUEUE & STAGING'
  return isChinese.value ? '抽取运行队列' : 'ACTIVE EXTRACTION QUEUE'
})

const queueTitle = computed(() => {
  if (props.currentSection === 'batch') return isChinese.value ? '管理批量抽取、失败重试和结果同步。' : 'Monitor grouped extraction, retries, and sync work.'
  if (props.currentSection === 'upload') return isChinese.value ? '先把论文放入队列，再启动抽取。' : 'Stage documents before extraction.'
  return isChinese.value ? '跟踪抽取进度和代理日志。' : 'Monitor extraction flow and agent logs.'
})

const filteredFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return [...props.files]
    .filter((file) => {
      if (query && !String(file.name || '').toLowerCase().includes(query)) {
        return false
      }
      if (statusFilter.value === 'processing') {
        return isFileRunning(file)
      }
      if (statusFilter.value === 'error') {
        return FAILED_STATUSES.has(normalizedFileStatus(file))
      }
      if (statusFilter.value === 'success') {
        return FINISHED_STATUSES.has(normalizedFileStatus(file))
      }
      return true
    })
    .sort((left, right) => queueWeight(right) - queueWeight(left))
})

const selectedQueueFile = computed<BatchFile | null>(() => {
  const activeId = props.activeId || props.selectedFileId
  const activeFile = activeId ? props.files.find((file) => file.id === activeId) : null
  const selectedFile = props.selectedFile?.id
    ? props.files.find((file) => file.id === props.selectedFile?.id)
    : null
  return activeFile
    || selectedFile
    || filteredFiles.value[0]
    || props.files[0]
    || props.selectedFile
    || null
})

const activeExtractorType = computed<ExtractorType>(() => selectedQueueFile.value?.extractor_type || props.defaultExtractorType || 'tribology')

const activeExtractorOption = computed(() => extractorOptions.value.find((option) => option.key === activeExtractorType.value) || extractorOptions.value[0]!)

const extractableFiles = computed(() => {
  return props.files.filter((file) => isFileReadyToExtract(file))
})

const canExtractSelected = computed(() => {
  return isFileReadyToExtract(selectedQueueFile.value)
})

const canCancelSelected = computed(() => {
  const file = selectedQueueFile.value
  const run = activeInspectorRun.value
  const fileStatus = normalizedFileStatus(file)
  const runStatus = String(run?.status || '').toLowerCase()
  return RUNNING_STATUSES.has(fileStatus) || ['running', 'processing'].includes(runStatus)
})

const canOpenSelectedReview = computed(() => {
  const file = selectedQueueFile.value
  if (!file) return false
  const status = normalizedFileStatus(file)
  const run = activeInspectorRun.value
  const diffusionReviewableCount = activeExtractorType.value === 'diffusion' && run
    ? diffusionArtifactCounts(run).reviewable
    : 0
  return file.records.length > 0 || status === 'success' || diffusionReviewableCount > 0
})

const selectedExtractLabel = computed(() => {
  const status = normalizedFileStatus(selectedQueueFile.value)
  if (isChinese.value) {
    if (status === 'error') return '重试抽取'
    if (status === 'no_data') return '重新抽取'
    if (status === 'success') return '重新抽取'
    if (status === 'cancelled') return '恢复抽取'
    return '开始抽取'
  }
  if (status === 'error') return 'Retry Extract'
  if (status === 'no_data') return 'Re-run Extract'
  if (status === 'success') return 'Re-run Extract'
  if (status === 'cancelled') return 'Restart Extract'
  return 'Start Extract'
})

const canBatchExtract = computed(() => extractableFiles.value.length > 0)

const activeInspectorRun = computed<ExtractionRunDetail | null>(() => {
  const selectedFile = selectedQueueFile.value
  const activeRun = props.activeRun
  if (!selectedFile || !activeRun) return null
  return String(activeRun.literature_id) === String(selectedFile.id) ? activeRun : null
})

const queueItems = computed<QueueItem[]>(() => filteredFiles.value.map((file) => ({
  id: file.id,
  name: file.name,
  status: displayStatusForFile(file),
  badge: statusBadge(file),
  badgeClass: statusBadgeClass(file),
  meta: [
    `doc-${String(file.id || '').slice(0, 6)}`,
    file.scopeKey || props.operatorName || props.activeScopeLabel,
    isFileRunning(file) ? `${Math.max(1, Math.round(file.progress || 0))}% complete` : detailLabel(file),
  ].join('  •  '),
  sublabel: file.errorMessage || file.progressMessage || stageLabelFromFile(file),
  progress: progressForFile(file),
  progressClass: progressTone(file.status),
  isSelected: file.id === props.activeId || file.id === props.selectedFileId || file.id === selectedQueueFile.value?.id,
})))

const inspectorFileName = computed(() => props.activeFileName || selectedQueueFile.value?.name || 'No document selected')

const inspectorStatus = computed(() => {
  if (activeInspectorRun.value) return formatRunStatus(activeInspectorRun.value.status)
  if (selectedQueueFile.value) return statusBadge(selectedQueueFile.value)
  return 'IDLE'
})

const inspectorSteps = computed<InspectorStep[]>(() => {
  const activeRun = activeInspectorRun.value
  const selectedFile = selectedQueueFile.value
  const failed = isFailedRun(activeRun?.status) || FAILED_STATUSES.has(normalizedFileStatus(selectedFile))
  const completed = isCompletedRun(activeRun?.status) || FINISHED_STATUSES.has(normalizedFileStatus(selectedFile))
  const activeIndex = inferActiveStage(activeRun, selectedFile)

  const definitions = activeExtractorType.value === 'diffusion'
    ? [
        { id: 'register', label: isChinese.value ? '论文登记' : 'Document Registration' },
        { id: 'layout', label: isChinese.value ? 'PDF 解析与分块' : 'PDF Parsing & Chunking' },
        { id: 'extract', label: isChinese.value ? '扩散候选抽取' : 'Diffusion Candidate Extraction' },
        { id: 'standardize', label: isChinese.value ? '字段标准化' : 'Field Standardization' },
        { id: 'review', label: isChinese.value ? '进入审阅队列' : 'Review Queue Handoff' },
      ]
    : [
        { id: 'register', label: isChinese.value ? '论文登记' : 'Document Registration' },
        { id: 'layout', label: isChinese.value ? '版面解析与分块' : 'Layout Analysis & Chunking' },
        { id: 'extract', label: isChinese.value ? '代理抽取' : 'LLM Agent Extraction' },
        { id: 'validate', label: isChinese.value ? '结果校验' : 'Result Validation' },
      ]

  return definitions.map((definition, index) => {
    let state: InspectorStep['state'] = 'waiting'
    if (completed || index < activeIndex) {
      state = 'complete'
    } else if (failed && index === activeIndex) {
      state = 'error'
    } else if (!completed && index === activeIndex) {
      state = 'active'
    }

    return {
      id: definition.id,
      label: definition.label,
      state,
      meta: stepMeta(definition.id, state, activeRun, selectedFile),
    }
  })
})

const inspectorLogs = computed<InspectorLog[]>(() => {
  if (activeInspectorRun.value?.progress_log?.length) {
    return activeInspectorRun.value.progress_log.slice(-8).map((item, index) => ({
      id: `${item.stage}-${index}`,
      prefix: stagePrefix(item.stage),
      message: item.message || formatStageLabel(item.stage),
      tone: item.stage.toLowerCase().includes('stage_e') ? 'agent' : item.stage.toLowerCase().includes('stage_d') ? 'system' : 'info',
    }))
  }

  if (props.latestAgentWorkflow?.messages?.length) {
    return props.latestAgentWorkflow.messages.slice(-8).map((message, index) => ({
      id: `${message.task_id}-${index}`,
      prefix: formatAgentPrefix(message),
      message: formatAgentMessage(message),
      tone: message.sender.toLowerCase().includes('agent') ? 'agent' : 'info',
    }))
  }

  if (selectedQueueFile.value?.errorMessage || selectedQueueFile.value?.progressMessage) {
    const selectedStatus = normalizedFileStatus(selectedQueueFile.value)
    return [
      {
        id: 'file-message',
        prefix: FAILED_STATUSES.has(selectedStatus) ? 'ISSUE' : selectedStatus === 'no_data' ? 'NO DATA' : 'INFO',
        message: selectedQueueFile.value.errorMessage || selectedQueueFile.value.progressMessage || 'Waiting for live logs.',
        tone: FAILED_STATUSES.has(selectedStatus) || selectedStatus === 'no_data' ? 'system' : 'info',
      },
    ]
  }

  return [
    {
      id: 'empty',
      prefix: 'IDLE',
      message: 'Live agent logs will appear once a run starts processing.',
      tone: 'info',
    },
  ]
})

const inspectorDiagnostics = computed(() => {
  const file = selectedQueueFile.value
  const run = activeInspectorRun.value
  const isDiffusion = activeExtractorType.value === 'diffusion'
  const artifacts = diffusionArtifactCounts(run)
  const status = String(run?.status || normalizedFileStatus(file) || '').toLowerCase()
  const currentMessage = String(
    run?.summary?.current_message
    || run?.progress_log?.slice(-1)[0]?.message
    || file?.progressMessage
    || '',
  ).trim()
  const issue = String(
    run?.summary?.no_data_reason
    || run?.error_message
    || file?.errorMessage
    || '',
  ).trim()
  const reviewable = isDiffusion ? artifacts.reviewable : Number(run?.final_count || file?.records.length || 0)
  const chips: InspectorDiagnostic[] = isDiffusion
    ? [
        { key: 'candidate', label: isChinese.value ? '候选' : 'Candidates', value: String(artifacts.candidates) },
        { key: 'final', label: isChinese.value ? '已入库' : 'Approved', value: String(artifacts.final) },
        { key: 'dropped', label: isChinese.value ? '丢弃' : 'Dropped', value: String(droppedTotal(run)) },
      ]
    : [
        { key: 'final', label: isChinese.value ? '记录' : 'Records', value: String(run?.final_count || file?.records.length || 0) },
        { key: 'candidate', label: isChinese.value ? '候选' : 'Candidates', value: String(run?.candidate_count || 0) },
        { key: 'dropped', label: isChinese.value ? '丢弃' : 'Dropped', value: String(droppedTotal(run)) },
      ]
  const readyForReview = reviewable > 0 || Boolean(file?.records.length)
  const noData = status === 'no_data' || (!readyForReview && ['success', 'completed'].includes(status))
  const waitingForRunLog = status === 'processing' && (!run?.run_id || run?.summary?.next_action === 'wait_for_run_log')

  return {
    show: Boolean(file),
    title: isDiffusion
      ? (isChinese.value ? '扩散抽取诊断' : 'Diffusion Extraction Diagnostics')
      : (isChinese.value ? '抽取诊断' : 'Extraction Diagnostics'),
    message: readyForReview
      ? (isDiffusion
        ? (isChinese.value
          ? `已生成 ${reviewable} 条可审阅扩散记录，下一步进入 Review 确认。`
          : `${reviewable} diffusion rows are ready for review.`)
        : (currentMessage || (isChinese.value ? '结果已准备好，可以进入审阅。' : 'Records are ready for review.')))
      : waitingForRunLog
        ? (isChinese.value ? '抽取已进入服务器队列，正在等待 worker 创建新的运行日志。' : 'Extraction is queued on the server while the worker creates a fresh run log.')
        : issue || currentMessage || (isChinese.value ? '等待运行日志返回。' : 'Waiting for run logs.'),
    tone: readyForReview ? 'ready' : noData ? 'warning' : FAILED_STATUSES.has(status) ? 'error' : 'neutral',
    chips,
    nextAction: readyForReview
      ? (isChinese.value ? '打开审阅，确认候选记录后再入库。' : 'Open Review and confirm candidates before promotion.')
      : noData
        ? (isChinese.value ? '建议重抽，或检查论文是否真的包含扩散系数表述。' : 'Re-run extraction or check whether the paper contains diffusion coefficients.')
        : waitingForRunLog
          ? (isChinese.value ? '保持本页打开即可；日志出现后进度会自动切到 PDF 解析、候选抽取和标准化阶段。' : 'Keep this page open; progress will switch to parsing, extraction, and standardization as soon as logs appear.')
        : (isChinese.value ? '保持本页打开，系统会继续刷新运行状态。' : 'Keep this page open while the run refreshes.'),
  }
})

const inspectorSummary = computed(() => ({
  queue: props.queueSizeLabel,
  state: props.runStateLabel,
  scope: props.activeScopeLabel,
}))

function triggerUpload() {
  fileInput.value?.click()
}

function triggerSelectedExtract() {
  const file = selectedQueueFile.value
  if (!file || !canExtractSelected.value) return
  const status = normalizedFileStatus(file)
  const force = ['error', 'failed', 'success', 'completed', 'cancelled', 'no_data'].includes(status)
  emit('extract', file.id, force)
}

function triggerCancelSelected() {
  const file = selectedQueueFile.value
  if (!file || !canCancelSelected.value) return
  emit('cancel-extraction', file.id)
}

function setActiveExtractor(extractorType: ExtractorType) {
  emit('set-default-extractor-type', extractorType)
  const selected = selectedQueueFile.value
  if (selected) {
    emit('set-file-extractor-type', selected.id, extractorType)
  }
}

function triggerBatchExtract() {
  const fileIds = extractableFiles.value.map((file) => file.id)
  if (!fileIds.length) return
  emit('batch-extract', fileIds)
}

function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || []).filter((file) => /\.(pdf|txt|md)$/i.test(file.name))
  if (files.length === 1) {
    emit('upload', files[0])
  } else if (files.length > 1) {
    emit('batch-upload', files)
  }
  target.value = ''
}

function cycleFilter() {
  const filters: PipelineFilter[] = ['all', 'processing', 'error', 'success']
  const nextIndex = (filters.indexOf(statusFilter.value) + 1) % filters.length
  statusFilter.value = filters[nextIndex]!
}

function filterLabel() {
  if (statusFilter.value === 'processing') return isChinese.value ? '运行中' : 'Running'
  if (statusFilter.value === 'error') return isChinese.value ? '失败' : 'Failed'
  if (statusFilter.value === 'success') return isChinese.value ? '完成' : 'Completed'
  return isChinese.value ? '全部' : 'All'
}

function extractorLabel(extractorType?: ExtractorType | string | null) {
  const normalized = extractorType === 'diffusion' ? 'diffusion' : 'tribology'
  return extractorOptions.value.find((option) => option.key === normalized)?.shortLabel
    || (normalized === 'diffusion' ? 'Diffusion' : 'Tribology')
}

function extractorBadgeClass(extractorType?: ExtractorType | string | null) {
  const normalized = extractorType === 'diffusion' ? 'diffusion' : 'tribology'
  return extractorOptions.value.find((option) => option.key === normalized)?.badgeClass
    || 'border-slate-200 bg-slate-50 text-slate-600'
}

function queueWeight(file: BatchFile) {
  const status = normalizedFileStatus(file)
  if (file.id === props.activeId || file.id === props.selectedFileId) return 100
  if (status === 'uploading' && !hasReadyMessage(file)) return 90
  if (RUNNING_STATUSES.has(status)) return 80
  if (status === 'no_data') return 70
  if (FAILED_STATUSES.has(status)) return 60
  if (isFileReadyToExtract(file)) return 40
  return 20
}

function progressForFile(file: BatchFile) {
  const status = normalizedFileStatus(file)
  if (FINISHED_STATUSES.has(status)) return 100
  if (status === 'no_data') return 100
  if (status === 'uploading' && !hasReadyMessage(file)) return Math.max(6, Math.round(file.progress || 6))
  if (status === 'cancelled') return Math.max(8, Math.round(file.progress || 18))
  if (FAILED_STATUSES.has(status)) return Math.max(18, Math.round(file.progress || 35))
  if (RUNNING_STATUSES.has(status)) return Math.max(12, Math.round(file.progress || 18))
  return 8
}

function detailLabel(file: BatchFile) {
  const status = normalizedFileStatus(file)
  if (FINISHED_STATUSES.has(status)) return `${file.records?.length || 0} records extracted`
  if (status === 'no_data') return file.errorMessage || 'No extractable records found'
  if (status === 'uploading' && !hasReadyMessage(file)) return isChinese.value ? '正在上传到服务器' : 'Uploading to server'
  if (status === 'cancelled') return 'Stopped by user'
  if (FAILED_STATUSES.has(status)) return 'Needs retry'
  return 'Ready to launch'
}

function stageLabelFromFile(file: BatchFile) {
  const status = normalizedFileStatus(file)
  if (file.errorMessage) return file.errorMessage
  if (file.progressMessage) return file.progressMessage
  if (status === 'uploading' && !hasReadyMessage(file)) return isChinese.value ? '正在上传并登记论文' : 'Uploading and registering document'
  if (RUNNING_STATUSES.has(status)) return 'Agent extraction in progress'
  if (FINISHED_STATUSES.has(status)) return 'Completed'
  if (status === 'no_data') return 'No extractable records found'
  if (status === 'cancelled') return 'Extraction stopped'
  if (FAILED_STATUSES.has(status)) return 'Execution failed'
  return 'Queued for extraction'
}

function statusBadge(fileOrStatus: BatchFile | string) {
  const status = typeof fileOrStatus === 'string'
    ? normalizedFileStatus(fileOrStatus)
    : displayStatusForFile(fileOrStatus)
  if (status === 'uploading') return isChinese.value ? '上传中' : 'UPLOADING'
  if (status === 'processing') return 'RUNNING'
  if (status === 'success') return 'SUCCESS'
  if (status === 'no_data') return 'NO DATA'
  if (status === 'cancelled') return 'STOPPED'
  if (status === 'error') return 'FAILED'
  return 'QUEUED'
}

function statusBadgeClass(fileOrStatus: BatchFile | string) {
  const status = typeof fileOrStatus === 'string'
    ? normalizedFileStatus(fileOrStatus)
    : displayStatusForFile(fileOrStatus)
  if (status === 'uploading') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (status === 'processing') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'no_data') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'cancelled') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status === 'error') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-50 text-slate-500'
}

function progressTone(status: string) {
  status = normalizedFileStatus(status)
  if (status === 'uploading') return 'bg-sky-500'
  if (status === 'processing') return 'bg-blue-600'
  if (status === 'success') return 'bg-emerald-500'
  if (status === 'no_data') return 'bg-amber-500'
  if (status === 'cancelled') return 'bg-amber-500'
  if (status === 'error') return 'bg-rose-500'
  return 'bg-slate-200'
}

function inferActiveStage(activeRun: ExtractionRunDetail | null, file: BatchFile | null) {
  const fileStatus = normalizedFileStatus(file)
  if (isCompletedRun(activeRun?.status) || ['success', 'completed', 'no_data'].includes(fileStatus)) return 4
  if (isFailedRun(activeRun?.status) || FAILED_STATUSES.has(fileStatus)) {
    const stage = String(activeRun?.summary?.current_stage || activeRun?.progress_log?.slice(-1)[0]?.stage || '').toLowerCase()
    if (stage.includes('stage_e') || stage.includes('validation')) return 3
    if (stage.includes('stage_c') || stage.includes('stage_d') || stage.includes('extract')) return 2
    if (stage.includes('stage_a') || stage.includes('stage_b') || stage.includes('layout')) return 1
    return 2
  }
  const progress = Math.max(activeRun ? mapRunProgress(activeRun) : 0, file ? progressForFile(file) : 0)
  if (progress >= 88) return 3
  if (progress >= 42) return 2
  if (progress >= 16) return 1
  return 0
}

function stepMeta(id: string, state: InspectorStep['state'], activeRun: ExtractionRunDetail | null, file: BatchFile | null) {
  if (state === 'complete') return 'done'
  if (state === 'error') return 'issue'
  if (state === 'waiting') return 'pending'

  if (id === 'extract' && activeRun) {
    return `${activeRun.candidate_count || 0} candidates`
  }
  if (id === 'standardize' && activeRun) {
    return `${diffusionArtifactCounts(activeRun).reviewable} ready`
  }
  if (id === 'review' && activeRun) {
    return diffusionArtifactCounts(activeRun).reviewable > 0 ? 'review' : 'pending'
  }
  if (id === 'validate' && activeRun) {
    if (String(activeRun.status || '').toLowerCase() === 'no_data') return 'no data'
    return `${activeRun.final_count || 0} records`
  }
  if (id === 'layout') {
    return file && isFileRunning(file) ? `${Math.max(1, Math.round(file.progress || 0))}%` : 'active'
  }
  return 'active'
}

function mapRunProgress(run: ExtractionRunDetail) {
  const stage = String(run.summary?.current_stage || run.progress_log?.slice(-1)[0]?.stage || '').toLowerCase()
  if (isCompletedRun(run.status)) return 100
  if (stage.includes('stage_e')) return 92
  if (stage.includes('stage_d') || stage.includes('extract')) return 70
  if (stage.includes('stage_c') || stage.includes('layout') || stage.includes('fallback_table')) return 38
  if (stage.includes('stage_a') || stage.includes('stage_b')) return 16
  return 10
}

function isCompletedRun(status?: string | null) {
  return ['completed', 'success', 'no_data'].includes(String(status || '').toLowerCase())
}

function isFailedRun(status?: string | null) {
  return ['failed', 'error', 'cancelled'].includes(String(status || '').toLowerCase())
}

function diffusionArtifactCounts(run: ExtractionRunDetail | null) {
  const artifacts = (run?.summary?.diffusion_artifacts || {}) as Record<string, unknown>
  const candidates = Number(artifacts.candidate_count ?? run?.candidate_count ?? 0)
  const final = Number(artifacts.final_count ?? run?.final_count ?? 0)
  const reviewable = Number(artifacts.reviewable_count ?? (candidates + final))
  return {
    candidates: Number.isFinite(candidates) ? Math.max(0, candidates) : 0,
    final: Number.isFinite(final) ? Math.max(0, final) : 0,
    reviewable: Number.isFinite(reviewable) ? Math.max(0, reviewable) : 0,
  }
}

function droppedTotal(run: ExtractionRunDetail | null) {
  const dropped = run?.dropped_by_reason || {}
  return Object.values(dropped).reduce((sum, value) => {
    const numeric = Number(value)
    return sum + (Number.isFinite(numeric) ? numeric : 0)
  }, 0)
}

function diagnosticToneClass(tone: string) {
  if (tone === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function formatRunStatus(status?: string | null) {
  const normalized = String(status || '').toLowerCase()
  if (!normalized) return 'IDLE'
  if (normalized === 'no_data') return 'NO DATA'
  if (normalized === 'completed') return 'SUCCESS'
  if (normalized === 'processing') return 'RUNNING'
  if (normalized === 'cancelled') return 'STOPPED'
  return normalized.toUpperCase()
}

function formatStageLabel(stage?: string | null) {
  const normalized = String(stage || '').trim().toLowerCase()
  if (!normalized) return 'Queued'
  if (normalized.includes('stage_a')) return 'Document registration'
  if (normalized.includes('stage_b')) return 'Layout analysis'
  if (normalized.includes('stage_c')) return 'Chunking and extraction'
  if (normalized.includes('stage_d')) return 'Candidate validation'
  if (normalized.includes('stage_e')) return isChinese.value ? '结果校验' : 'Result validation'
  return String(stage || '').replace(/[_\.]+/g, ' ')
}

function stagePrefix(stage?: string | null) {
  const normalized = String(stage || '').trim().toLowerCase()
  if (normalized.includes('stage_e')) return 'VALIDATOR'
  if (normalized.includes('stage_d')) return 'QUERY'
  if (normalized.includes('stage_c')) return 'AGENT'
  if (normalized.includes('stage_a') || normalized.includes('stage_b')) return 'SYSTEM'
  return 'INFO'
}

function formatAgentPrefix(message: AgentMessage) {
  return `${message.sender.toUpperCase()}`
}

function formatAgentMessage(message: AgentMessage) {
  const payloadText = typeof message.payload?.message === 'string'
    ? message.payload.message
    : typeof message.payload?.detail === 'string'
      ? message.payload.detail
      : `${message.sender} -> ${message.receiver}`

  return payloadText
}

function logToneClass(tone: InspectorLog['tone']) {
  if (tone === 'agent') return 'text-emerald-400'
  if (tone === 'system') return 'text-blue-400'
  return 'text-slate-300'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      accept=".pdf,.txt,.md"
      multiple
      @change="handleFileInput"
    >

    <section class="shell-surface px-4 py-4 sm:px-5">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem] xl:items-center">
        <div class="min-w-0">
          <div class="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            {{ pageCopy.eyebrow }}
          </div>
          <div class="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div class="min-w-0">
              <h1 class="text-2xl font-semibold leading-8 text-slate-950 sm:text-3xl">
                {{ pageCopy.title }}
              </h1>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {{ pageCopy.subtitle }}
              </p>
            </div>

            <div class="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[28rem]">
              <article
                v-for="metric in extractionMetrics"
                :key="metric.key"
                class="rounded-md border border-slate-200 bg-white px-3 py-2.5"
              >
                <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{{ metric.label }}</p>
                <p class="mt-1 text-2xl font-semibold leading-none text-slate-950">{{ metric.value }}</p>
              </article>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              @click="triggerUpload"
            >
              <Upload class="h-4 w-4" />
              {{ pageCopy.upload }}
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition"
              :class="canExtractSelected
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'"
              :disabled="!canExtractSelected"
              @click="triggerSelectedExtract"
            >
              <Bot class="h-4 w-4" />
              {{ selectedExtractLabel }}
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition"
              :class="canBatchExtract
                ? 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                : 'cursor-not-allowed bg-slate-50 text-slate-400'"
              :disabled="!canBatchExtract"
              @click="triggerBatchExtract"
            >
              <CheckCircle2 class="h-4 w-4" />
              {{ pageCopy.batchExtract }}
            </button>

            <span class="min-w-0 truncate text-sm text-slate-500">
              {{ pageCopy.selected }}:
              <span class="font-semibold text-slate-800">{{ selectedQueueFile?.name || pageCopy.noSelection }}</span>
            </span>
          </div>
        </div>

        <div class="grid gap-3">
          <div>
            <div class="mb-2 flex items-end justify-between gap-3">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{{ pageCopy.extractionType }}</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">{{ pageCopy.extractionTypeHint }}</p>
              </div>
              <span class="shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold" :class="activeExtractorOption.badgeClass">
                {{ activeExtractorOption.shortLabel }}
              </span>
            </div>
            <div class="grid gap-2">
              <button
                v-for="option in extractorOptions"
                :key="option.key"
                type="button"
                class="rounded-md border px-3.5 py-3 text-left transition"
                :class="activeExtractorType === option.key ? option.activeClass : option.inactiveClass"
                @click="setActiveExtractor(option.key)"
              >
                <span class="flex items-start justify-between gap-3">
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">{{ option.label }}</span>
                    <span class="mt-1 block text-xs leading-5 opacity-75">{{ option.helper }}</span>
                  </span>
                  <span
                    class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                    :class="activeExtractorType === option.key ? 'border-current bg-white/60' : 'border-slate-300'"
                  >
                    <span v-if="activeExtractorType === option.key" class="h-2 w-2 rounded-full bg-current" />
                  </span>
                </span>
                <span class="mt-2 block text-xs leading-5 opacity-80">{{ option.detail }}</span>
              </button>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-[16rem] flex-1">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model="searchQuery"
                type="text"
                class="h-10 w-full rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
                :placeholder="pageCopy.search"
              >
            </div>

            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              :title="`${pageCopy.filter}: ${filterLabel()}`"
              @click="cycleFilter"
            >
              <Filter class="h-4 w-4" />
              <span class="hidden sm:inline">{{ filterLabel() }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section class="shell-surface flex min-h-0 flex-col overflow-hidden">
        <div class="flex items-start justify-between gap-3 border-b border-black/8 px-5 py-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{{ queueEyebrow }}</p>
            <h2 class="mt-1 text-base font-semibold text-slate-900">
              {{ queueTitle }}
            </h2>
            <p class="mt-2 text-sm text-slate-500">
              {{ pageCopy.extractionType }}:
              <span class="ml-1 inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold" :class="activeExtractorOption.badgeClass">
                {{ activeExtractorOption.shortLabel }}
              </span>
            </p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition"
              :class="currentSection === 'batch'
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50'"
              @click="emit('change-section', currentSection === 'batch' ? 'runs' : 'batch')"
            >
              <Bot class="h-4 w-4" />
              {{ pageCopy.groupedRuns }}
            </button>
            <div class="inline-flex items-center gap-2 text-sm text-slate-500">
              <Clock3 class="h-4 w-4" />
              {{ pageCopy.autoRefresh }}
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div v-if="queueItems.length" class="space-y-3">
            <button
              v-for="item in queueItems"
              :key="item.id"
              type="button"
              class="w-full rounded-md border px-4 py-4 text-left transition"
              :class="item.isSelected
                ? 'border-slate-300 bg-slate-50'
                : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/50'"
              @click="emit('select-file', item.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                    <FileText class="h-5 w-5" />
                  </div>

                  <div class="min-w-0">
                    <p class="truncate text-[0.98rem] font-semibold tracking-normal text-slate-950">
                      {{ item.name }}
                    </p>
                    <p class="mt-1 truncate text-sm text-slate-500">{{ item.meta }}</p>
                    <span
                      class="mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold"
                      :class="extractorBadgeClass(files.find((file) => file.id === item.id)?.extractor_type || defaultExtractorType)"
                    >
                      {{ extractorLabel(files.find((file) => file.id === item.id)?.extractor_type || defaultExtractorType) }}
                    </span>
                  </div>
                </div>

                <div class="inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-sm font-semibold" :class="item.badgeClass">
                  {{ item.badge }}
                </div>
              </div>

              <div class="mt-4">
                <div class="h-1.5 overflow-hidden rounded-full bg-[#e8edf5]">
                  <div class="h-full rounded-full transition-all duration-300" :class="item.progressClass" :style="{ width: `${item.progress}%` }" />
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between gap-3 text-sm">
                <p class="min-w-0 truncate text-slate-500">{{ item.sublabel }}</p>
                <div class="inline-flex shrink-0 items-center gap-1 text-slate-500">
                  <span>{{ item.status === 'uploading' ? (isChinese ? '上传中' : 'Uploading') : item.status === 'processing' ? (isChinese ? '代理抽取中' : 'Agent: Extraction') : item.status === 'error' ? (isChinese ? '需要重试' : 'Needs retry') : item.status === 'cancelled' ? (isChinese ? '已停止' : 'Stopped') : item.status === 'no_data' ? (isChinese ? '无相关数据' : 'No related data') : item.status === 'success' ? (isChinese ? '完成' : 'Completed') : (isChinese ? '待抽取' : 'Queued') }}</span>
                  <ChevronRight class="h-4 w-4" />
                </div>
              </div>
            </button>
          </div>

          <div
            v-else
            class="flex h-full min-h-[18rem] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500"
          >
            No pipeline runs match the current search and filter.
          </div>
        </div>
      </section>

      <aside class="shell-surface flex min-h-0 flex-col overflow-hidden">
        <div class="border-b border-black/8 px-5 py-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">RUN INSPECTOR</p>
              <h2 class="mt-1 truncate text-base font-semibold text-slate-900">
                {{ inspectorFileName }}
              </h2>
            </div>
            <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
              <MoreHorizontal class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Execution Stages</p>
            <div class="mt-4 space-y-4">
              <div
                v-for="step in inspectorSteps"
                :key="step.id"
                class="flex items-center justify-between gap-3"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <div
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                    :class="step.state === 'complete'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                      : step.state === 'active'
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : step.state === 'error'
                          ? 'border-rose-200 bg-rose-50 text-rose-600'
                          : 'border-slate-200 bg-slate-50 text-slate-400'"
                  >
                    <CheckCircle2 v-if="step.state === 'complete'" class="h-3.5 w-3.5" />
                    <LoaderCircle v-else-if="step.state === 'active'" class="h-3.5 w-3.5 animate-spin" />
                    <CircleAlert v-else-if="step.state === 'error'" class="h-3.5 w-3.5" />
                  </div>
                  <span
                    class="truncate text-[0.98rem]"
                    :class="step.state === 'waiting' ? 'text-[#a7b3c6]' : 'text-slate-900'"
                  >
                    {{ step.label }}
                  </span>
                </div>
                <span class="shrink-0 text-sm text-slate-400">{{ step.meta }}</span>
              </div>
            </div>
          </div>

          <div
            v-if="inspectorDiagnostics.show"
            class="mt-6 rounded-md border px-4 py-4"
            :class="diagnosticToneClass(inspectorDiagnostics.tone)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[11px] font-semibold uppercase tracking-widest opacity-70">{{ inspectorDiagnostics.title }}</p>
                <p class="mt-2 text-sm leading-6">{{ inspectorDiagnostics.message }}</p>
              </div>
              <CircleAlert v-if="inspectorDiagnostics.tone !== 'ready'" class="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
              <CheckCircle2 v-else class="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            </div>

            <div class="mt-3 grid grid-cols-3 gap-2">
              <div
                v-for="chip in inspectorDiagnostics.chips"
                :key="chip.key"
                class="rounded border border-current/10 bg-white/55 px-2.5 py-2"
              >
                <p class="text-[10px] font-semibold uppercase tracking-widest opacity-60">{{ chip.label }}</p>
                <p class="mt-1 text-lg font-semibold leading-none">{{ chip.value }}</p>
              </div>
            </div>

            <p class="mt-3 text-xs leading-5 opacity-75">{{ inspectorDiagnostics.nextAction }}</p>
          </div>

          <div class="mt-8">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Live Agent Logs</p>
            <div class="mt-3 rounded-md bg-slate-900 px-4 py-4 text-xs leading-relaxed">
              <div v-for="entry in inspectorLogs" :key="entry.id" class="flex items-start gap-3">
                <span class="text-slate-600">&gt;</span>
                <p class="font-mono" :class="logToneClass(entry.tone)">
                  <span class="mr-2 text-slate-500">[{{ entry.prefix }}]</span>{{ entry.message }}
                </p>
              </div>
            </div>
          </div>

          <div class="mt-8 grid gap-2">
            <div class="rounded-md border border-slate-100 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Queue</span>
              {{ inspectorSummary.queue }}
            </div>
            <div
              class="rounded-md border px-3.5 py-3 text-sm"
              :class="inspectorStatus === 'NO DATA'
                ? 'border-amber-100 bg-amber-50/50 text-amber-700'
                : 'border-slate-100 bg-slate-50/50 text-slate-600'"
            >
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Run State</span>
              {{ inspectorStatus }} / {{ inspectorSummary.state }}
            </div>
            <div class="rounded-md border border-slate-100 bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Scope</span>
              {{ inspectorSummary.scope }}
            </div>
          </div>

          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition"
              :class="canExtractSelected
                ? 'bg-slate-900 text-white shadow-sm hover:bg-slate-800'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'"
              :disabled="!canExtractSelected"
              @click="triggerSelectedExtract"
            >
              {{ selectedExtractLabel }}
            </button>
            <button
              v-if="canCancelSelected"
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
              @click="triggerCancelSelected"
            >
              停止提取
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md border px-4 py-2.5 text-sm font-medium transition"
              :class="canOpenSelectedReview
                ? 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'"
              :disabled="!canOpenSelectedReview"
              :title="canOpenSelectedReview ? 'Open review workspace' : 'Review opens after extraction records are ready'"
              @click="emit('open-review', selectedQueueFile?.id || selectedFileId)"
            >
              Open Review
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
