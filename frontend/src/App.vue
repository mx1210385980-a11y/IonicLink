<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Beaker, Github, Moon, Sun } from 'lucide-vue-next'
import FileUpload from '@/components/FileUpload.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import AgentStatusPanel from '@/components/AgentStatusPanel.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import Dashboard from '@/components/Dashboard.vue'
import LiteratureList from '@/components/LiteratureList.vue'
import SourceGroundingView from '@/components/SourceGroundingView.vue'
import Button from '@/components/ui/Button.vue'
import {
  chat,
  extractData,
  getLatestExtractionRun,
  getPdfHighlights,
  syncBatchData,
  uploadFile,
  type AgentWorkflow,
  type BatchFile,
  type ExtractionResponse,
  type ExtractionRunDetail,
  type TribologyData,
} from '@/lib/api'
import type { HighlightRect } from '@/types/pdf-highlight'

const currentView = ref<'dashboard' | 'workspace' | 'literature' | 'grounding'>('workspace')
const sidebarTab = ref<'chat' | 'agents'>('chat')
const isDark = ref(false)

const fileUploadRef = ref<InstanceType<typeof FileUpload>>()
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

const batchFiles = ref<BatchFile[]>([])
const selectedFileId = ref<string | null>(null)
const explorerDoi = ref('')
const latestAgentWorkflow = ref<AgentWorkflow | null>(null)
const activeExtractionFileId = ref<string | null>(null)
const activeExtractionRun = ref<ExtractionRunDetail | null>(null)
const isChatting = ref(false)

const activeExtractionFileName = computed(() => {
  if (!activeExtractionFileId.value) return null
  return batchFiles.value.find((file) => file.id === activeExtractionFileId.value)?.name || null
})

const groundingPdfUrl = computed(() => {
  if (!selectedFileId.value) return ''
  return `/api/pdf/${selectedFileId.value}`
})

const groundingHighlightData = ref<HighlightRect[]>([])
let extractionPollTimer: ReturnType<typeof setInterval> | null = null

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'error', 'cancelled'])
const DARK_MODE_STORAGE_KEY = 'ioniclink-theme'

watch([() => selectedFileId.value, () => currentView.value], async ([fileId, view]) => {
  if (!fileId) {
    explorerDoi.value = ''
    return
  }

  const batchFile = batchFiles.value.find((file) => file.id === fileId)
  if (batchFile?.metadata?.doi) {
    explorerDoi.value = batchFile.metadata.doi
  } else if (batchFile?.status === 'success') {
    explorerDoi.value = `temp-${fileId}`
  }

  if (view !== 'grounding') {
    groundingHighlightData.value = []
    return
  }

  try {
    const highlights = await getPdfHighlights(fileId)
    groundingHighlightData.value = highlights
      .filter((highlight) => highlight.w > 0 && highlight.h > 0)
      .map((highlight) => ({
        id: highlight.id,
        page: highlight.page,
        coords: { x: highlight.x, y: highlight.y, w: highlight.w, h: highlight.h },
      }))
    console.log(`[Grounding] Loaded ${groundingHighlightData.value.length} highlights`)
  } catch (error) {
    console.warn('[Grounding] Failed to fetch highlights:', error)
    groundingHighlightData.value = []
  }
})

function hasWarnings(records: TribologyData[]): boolean {
  return records.some((record) => !record.cof || record.cof === '-' || record.cof === 'null')
}

function toggleDarkMode() {
  isDark.value = !isDark.value
}

onMounted(() => {
  const storedTheme = window.localStorage.getItem(DARK_MODE_STORAGE_KEY)
  if (storedTheme === 'dark') {
    isDark.value = true
    return
  }
  if (storedTheme === 'light') {
    isDark.value = false
    return
  }
  isDark.value = false
})

watch(
  isDark,
  (enabled) => {
    document.documentElement.classList.toggle('dark', enabled)
    window.localStorage.setItem(DARK_MODE_STORAGE_KEY, enabled ? 'dark' : 'light')
  },
  { immediate: true }
)

function findBatchFile(fileId: string) {
  return batchFiles.value.find((file) => file.id === fileId)
}

function clearExtractionPolling() {
  if (extractionPollTimer) {
    clearInterval(extractionPollTimer)
    extractionPollTimer = null
  }
}

function resetExtractionState(fileId?: string | null) {
  if (!fileId || activeExtractionFileId.value === fileId) {
    clearExtractionPolling()
    activeExtractionFileId.value = null
    activeExtractionRun.value = null
  }
}

function isTerminalRunStatus(status?: string | null): boolean {
  return TERMINAL_RUN_STATUSES.has(String(status || '').toLowerCase())
}

function formatStageLabel(stage?: string | null): string {
  const normalized = String(stage || '').trim().toLowerCase()
  if (!normalized) return 'Queued'
  if (normalized.startsWith('stage_a')) return 'Profiling document'
  if (normalized.startsWith('stage_b')) return 'Resolving abbreviations'
  if (normalized.startsWith('stage_c.figure_retry')) return 'Retrying figure extraction'
  if (normalized.startsWith('stage_c.figure')) return 'Reading figures and tables'
  if (normalized.startsWith('stage_c.text')) return 'Mining text candidates'
  if (normalized.startsWith('fallback_table')) return 'Recovering table data'
  if (normalized.startsWith('stage_d')) return 'Validating candidates'
  if (normalized.startsWith('stage_e')) return 'Finalizing records'
  return String(stage || '').replace(/[_\.]+/g, ' ')
}

function mapStageToProgress(stage?: string | null, status?: string | null): number {
  if (String(status || '').toLowerCase() === 'completed') return 100

  const normalized = String(stage || '').trim().toLowerCase()
  if (!normalized) return 8
  if (normalized.startsWith('stage_a')) return 14
  if (normalized.startsWith('stage_b')) return 24
  if (normalized.startsWith('stage_c.figure_retry')) return 50
  if (normalized.startsWith('stage_c.figure')) return 44
  if (normalized.startsWith('stage_c.text')) return 62
  if (normalized.startsWith('fallback_table')) return 74
  if (normalized.startsWith('stage_d')) return 82
  if (normalized.startsWith('stage_e')) return 94
  return 18
}

function getRunSnapshot(run?: ExtractionRunDetail | null) {
  const progressLog = run?.progress_log || []
  const lastEntry = progressLog[progressLog.length - 1]
  const summary = run?.summary || {}
  const stage = String(summary.current_stage || lastEntry?.stage || '')
  const message = String(summary.current_message || lastEntry?.message || '')
  let progress = mapStageToProgress(stage, run?.status)

  if (run?.candidate_count && progress < 48) {
    progress = 48
  }
  if (run?.final_count && progress < 94 && !isTerminalRunStatus(run?.status)) {
    progress = 94
  }

  return {
    stage,
    message: message || formatStageLabel(stage),
    progress,
  }
}

function setFileProcessing(batchFile: BatchFile | undefined, progress: number, message: string) {
  if (!batchFile) return
  batchFile.status = 'processing'
  batchFile.progress = Math.min(96, Math.max(batchFile.progress || 0, progress))
  batchFile.progressMessage = message
  batchFile.errorMessage = undefined
}

function setFileError(batchFile: BatchFile | undefined, message: string) {
  if (!batchFile) return
  batchFile.status = 'error'
  batchFile.progress = 0
  batchFile.progressMessage = 'Needs review'
  batchFile.errorMessage = message
}

function setFileSuccess(batchFile: BatchFile | undefined, message: string) {
  if (!batchFile) return
  batchFile.status = 'success'
  batchFile.progress = 100
  batchFile.progressMessage = message
  batchFile.errorMessage = undefined
}

function normalizeExtractionPayload(fileId: string, response: ExtractionResponse) {
  const metadata = (response.metadata || undefined) as BatchFile['metadata']
  const rawRecords = Array.isArray(response.data) ? response.data : []
  const records = rawRecords.map((record: any, index: number) => ({
    ...record,
    id: record.id || `${fileId}-${index}-${Date.now()}`,
    fileId,
  }))

  return {
    metadata,
    records,
  }
}

function syncActiveRunFromResponse(
  fileId: string,
  response: ExtractionResponse,
  finalRecordCount: number,
  forcedStatus?: 'running' | 'completed' | 'failed',
) {
  const summary: any = response.extraction_summary || {}
  const existing = activeExtractionRun.value
  const inferredStatus =
    forcedStatus ||
    (response.status === 'processing'
      ? 'running'
      : response.success
        ? 'completed'
        : 'failed')

  const progressLog = [...((summary.progress_log as ExtractionRunDetail['progress_log']) || existing?.progress_log || [])]
  if (inferredStatus === 'completed') {
    const finalMessage = finalRecordCount
      ? `Saved ${finalRecordCount} extracted records`
      : 'Extraction finished without usable records'
    const lastEntry = progressLog[progressLog.length - 1]
    if (!lastEntry || lastEntry.stage !== 'stage_e.finalize' || lastEntry.message !== finalMessage) {
      progressLog.push({ stage: 'stage_e.finalize', message: finalMessage })
    }
  }

  activeExtractionRun.value = {
    run_id: String(summary.run_id || existing?.run_id || `${fileId}-local`),
    literature_id: Number(fileId) || existing?.literature_id || 0,
    profile: existing?.profile || 'high_accuracy',
    status: inferredStatus,
    candidate_count: Number(summary.candidate_count ?? existing?.candidate_count ?? finalRecordCount ?? 0),
    final_count: Number(summary.final_count ?? (inferredStatus === 'completed' ? finalRecordCount : existing?.final_count ?? 0)),
    dropped_by_reason: summary.dropped_by_reason || existing?.dropped_by_reason || {},
    page_coverage: summary.page_coverage || existing?.page_coverage || {},
    page_candidate_counts: summary.page_candidate_counts || existing?.page_candidate_counts || {},
    progress_log: progressLog,
    summary: {
      ...(existing?.summary || {}),
      ...(summary || {}),
      current_stage:
        inferredStatus === 'completed'
          ? 'stage_e.finalize'
          : summary.current_stage || existing?.summary?.current_stage,
      current_message:
        inferredStatus === 'completed'
          ? (finalRecordCount ? `Saved ${finalRecordCount} extracted records` : 'Extraction finished without usable records')
          : summary.current_message || existing?.summary?.current_message,
    },
    error_message: inferredStatus === 'failed' ? response.message || existing?.error_message || null : null,
    created_at: existing?.created_at,
    updated_at: new Date().toISOString(),
  }
}

async function refreshLatestRun(fileId: string, silentNotFound: boolean = true) {
  const literatureId = Number(fileId)
  if (!Number.isFinite(literatureId)) return null

  try {
    const run = await getLatestExtractionRun(literatureId)
    activeExtractionRun.value = run
    const batchFile = findBatchFile(fileId)
    const snapshot = getRunSnapshot(run)

    if (run.status === 'running' || run.status === 'processing') {
      setFileProcessing(batchFile, snapshot.progress, snapshot.message)
    }

    if (isTerminalRunStatus(run.status)) {
      clearExtractionPolling()
    }

    return run
  } catch (error: any) {
    if (silentNotFound && error?.response?.status === 404) {
      return null
    }
    throw error
  }
}

function startExtractionTracking(fileId: string) {
  clearExtractionPolling()
  activeExtractionFileId.value = fileId
  activeExtractionRun.value = null
  sidebarTab.value = 'agents'
  void refreshLatestRun(fileId, true)
  extractionPollTimer = setInterval(() => {
    if (!activeExtractionFileId.value) return
    void refreshLatestRun(activeExtractionFileId.value, true)
  }, 2500)
}

async function waitForExtractionCompletion(fileId: string, timeoutMs: number = 180000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const run = await refreshLatestRun(fileId, true)
    if (run && isTerminalRunStatus(run.status)) {
      return run
    }
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }

  return null
}

function buildMetadataToSync(fileId: string, metadata: any) {
  const hasValidMetadata = metadata?.title || metadata?.doi
  if (hasValidMetadata) {
    return {
      doi: metadata.doi || '',
      title: metadata.title || '',
      authors: metadata.authors || '',
      journal: metadata.journal || '',
      year: metadata.year || new Date().getFullYear(),
      issn: metadata.issn || null,
      volume: metadata.volume || null,
      issue: metadata.issue || null,
      pages: metadata.pages || null,
      file_hash: metadata.file_hash || metadata.fileHash || null,
    }
  }

  return {
    doi: `temp-${fileId}`,
    title: 'Untitled',
    authors: '',
    journal: '',
    year: new Date().getFullYear(),
    file_hash: metadata?.file_hash || metadata?.fileHash || null,
  }
}

async function syncExtractedRecords(
  batchFile: BatchFile,
  originalFileId: string,
  metadata: any,
  records: TribologyData[],
  logPrefix: string,
) {
  const metadataToSync: any = buildMetadataToSync(originalFileId, metadata)
  setFileProcessing(batchFile, 96, `Syncing ${records.length} extracted records`)

  try {
    const syncResult = await syncBatchData(metadataToSync, records)
    const canonicalLitId = syncResult?.literatureId ?? syncResult?.literature_id

    if (canonicalLitId) {
      const canonicalId = String(canonicalLitId)
      if (batchFile.id !== canonicalId) {
        console.log(`[${logPrefix}] Updating file_id: ${batchFile.id} -> ${canonicalId}`)
        batchFile.id = canonicalId
      }
      if (selectedFileId.value === originalFileId) {
        selectedFileId.value = canonicalId
      }
      if (activeExtractionFileId.value === originalFileId) {
        activeExtractionFileId.value = canonicalId
      }
    }

    currentView.value = 'workspace'
    if (metadataToSync.doi) {
      explorerDoi.value = metadataToSync.doi
    }
  } catch (error: any) {
    console.error(`${logPrefix} failed:`, error)
    batchFile.errorMessage = `Auto-sync failed: ${error?.message || 'Unknown error'}`
  }
}

async function executeExtraction(fileId: string, force: boolean = false) {
  const batchFile = findBatchFile(fileId)
  if (!batchFile) {
    throw new Error(`File ${fileId} not found`)
  }

  latestAgentWorkflow.value = null
  startExtractionTracking(fileId)
  setFileProcessing(
    batchFile,
    8,
    force ? 'Re-analyzing document with the agent runtime' : 'Dispatching extraction workflow',
  )

  let response = await extractData(fileId, force)
  latestAgentWorkflow.value = response.agent_workflow || null
  syncActiveRunFromResponse(fileId, response, 0, response.status === 'processing' ? 'running' : undefined)

  if (response.status === 'processing') {
    setFileProcessing(batchFile, 16, response.message || 'Agent workflow is still running')
    const terminalRun = await waitForExtractionCompletion(fileId)

    if (!terminalRun) {
      throw new Error('Extraction is still running. Wait a moment and retry.')
    }
    if (terminalRun.status !== 'completed') {
      throw new Error(terminalRun.error_message || 'Extraction failed while running in the background.')
    }

    response = await extractData(fileId, false)
    latestAgentWorkflow.value = response.agent_workflow || latestAgentWorkflow.value
    syncActiveRunFromResponse(fileId, response, 0)
  }

  await refreshLatestRun(fileId, true)

  const { metadata, records } = normalizeExtractionPayload(fileId, response)
  syncActiveRunFromResponse(fileId, response, records.length)
  batchFile.metadata = metadata
  batchFile.records = records
  batchFile.hasWarnings = hasWarnings(records)

  if (!response.success || records.length === 0) {
    const message = response.message || 'No tribology data found.'
    syncActiveRunFromResponse(fileId, { ...response, success: false, message }, records.length, 'failed')
    setFileError(batchFile, message)
    return {
      success: false,
      message,
      recordCount: 0,
    }
  }

  await syncExtractedRecords(batchFile, fileId, metadata, records, force ? 'Sync Reprocess' : 'Sync')
  setFileSuccess(batchFile, `Extracted ${records.length} records`)

  return {
    success: true,
    message: response.message || `Successfully extracted ${records.length} records.`,
    recordCount: records.length,
  }
}

function handleClearFiles() {
  if (confirm('Are you sure you want to clear all files?')) {
    batchFiles.value = []
    selectedFileId.value = null
    latestAgentWorkflow.value = null
    resetExtractionState()
  }
}

function handleRemoveFile(fileId: string) {
  const index = batchFiles.value.findIndex((file) => file.id === fileId)
  if (index !== -1) {
    batchFiles.value.splice(index, 1)
  }
  if (selectedFileId.value === fileId) {
    selectedFileId.value = null
  }
  resetExtractionState(fileId)
}

async function handleUpload(file: File) {
  try {
    fileUploadRef.value?.setUploading(true)
    const response = await uploadFile(file)

    if (response.success) {
      batchFiles.value.push({
        id: response.file_id,
        name: response.filename,
        status: 'uploaded',
        progress: 0,
        progressMessage: 'Ready to extract',
        records: [],
        hasWarnings: false,
      })

      if (!selectedFileId.value) {
        selectedFileId.value = response.file_id
      }

      chatPanelRef.value?.addMessage('assistant', `File "${response.filename}" uploaded successfully.`)
    }
  } catch (error: any) {
    chatPanelRef.value?.addMessage('assistant', `Upload failed: ${error.message || 'Unknown error'}`)
  } finally {
    fileUploadRef.value?.setUploading(false)
  }
}

async function handleBatchUpload(files: File[]) {
  fileUploadRef.value?.setUploading(true)

  let successCount = 0
  let failCount = 0

  for (const file of files) {
    try {
      const response = await uploadFile(file)

      if (response.success) {
        batchFiles.value.push({
          id: response.file_id,
          name: response.filename,
          status: 'uploaded',
          progress: 0,
          progressMessage: 'Ready to extract',
          records: [],
          hasWarnings: false,
        })

        successCount++
      } else {
        failCount++
      }
    } catch {
      failCount++
    }
  }

  fileUploadRef.value?.setUploading(false)
  chatPanelRef.value?.addMessage('assistant', `Batch upload complete. Success: ${successCount}, Fail: ${failCount}.`)
}

async function handleExtract(fileId: string, force: boolean = false) {
  const batchFile = findBatchFile(fileId)
  if (!batchFile) return

  try {
    chatPanelRef.value?.addMessage(
      'assistant',
      force ? 'Forcing re-analysis of literature...' : 'Analyzing literature and extracting data...',
    )

    const result = await executeExtraction(fileId, force)

    if (result.success) {
      chatPanelRef.value?.addMessage(
        'assistant',
        `${result.message}\n\nExtracted data is now shown in the results panel.`,
      )
    } else {
      chatPanelRef.value?.addMessage(
        'assistant',
        `Extraction complete, but no usable tribology records were produced: ${result.message}`,
      )
    }
  } catch (error: any) {
    setFileError(batchFile, error.message || 'Unknown error')
    chatPanelRef.value?.addMessage('assistant', `Extraction failed: ${error.message || 'Unknown error'}`)
  } finally {
    clearExtractionPolling()
  }
}

async function handleBatchExtract(fileIds: string[]) {
  chatPanelRef.value?.addMessage('assistant', `Starting batch extraction of ${fileIds.length} files...`)

  let successCount = 0
  let failCount = 0
  let totalRecords = 0

  for (const fileId of fileIds) {
    const batchFile = findBatchFile(fileId)
    if (!batchFile) {
      failCount++
      continue
    }

    try {
      const result = await executeExtraction(fileId, false)
      if (result.success) {
        totalRecords += result.recordCount
        successCount++
      } else {
        failCount++
      }
    } catch (error: any) {
      setFileError(batchFile, error.message || 'Unknown error')
      failCount++
    } finally {
      clearExtractionPolling()
    }
  }

  currentView.value = 'workspace'
  chatPanelRef.value?.addMessage(
    'assistant',
    `Batch extraction complete. Success: ${successCount}, Fail: ${failCount}.\n\nTotal records extracted: ${totalRecords}`,
  )
}

async function handleChat(message: string) {
  chatPanelRef.value?.addMessage('user', message)

  try {
    isChatting.value = true
    const response = await chat(message)

    if (response.success) {
      chatPanelRef.value?.addMessage('assistant', response.response)
    }
  } catch (error: any) {
    chatPanelRef.value?.addMessage(
      'assistant',
      `Request failed: ${error.message || 'Please check if backend is running'}`,
    )
  } finally {
    isChatting.value = false
  }
}

function handleLiteratureView() {
  console.log('[App] Switching to literature view')
  currentView.value = 'literature'
}

onBeforeUnmount(() => {
  clearExtractionPolling()
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background text-foreground">
    <header class="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70 dark:border-slate-800/80 dark:bg-slate-950/85">
      <div class="flex h-14 items-center px-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <Beaker class="w-5 h-5 text-white" />
          </div>
          <label class="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">IonicLink</label>
        </div>

        <nav class="hidden md:flex items-center gap-6 ml-6">
          <button
            @click="currentView = 'workspace'"
            class="text-sm font-medium transition-colors hover:text-primary"
            :class="currentView === 'workspace' ? 'text-primary' : 'text-muted-foreground'"
          >
            Workspace
          </button>
          <button
            @click="currentView = 'dashboard'"
            class="text-sm font-medium transition-colors hover:text-primary"
            :class="currentView === 'dashboard' ? 'text-primary' : 'text-muted-foreground'"
          >
            Overview
          </button>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" @click="toggleDarkMode">
            <Sun v-if="isDark" class="h-5 w-5" />
            <Moon v-else class="h-5 w-5" />
          </Button>

          <Button variant="ghost" size="icon" as="a" href="https://github.com" target="_blank">
            <Github class="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>

    <main class="flex-1 overflow-hidden">
      <div v-if="currentView === 'dashboard'" class="h-[calc(100vh-56px)]">
        <Dashboard @open-library="currentView = 'literature'" />
      </div>

      <div v-if="currentView === 'workspace'" class="flex h-[calc(100vh-56px)] bg-slate-100/70 dark:bg-[#06101c]">
        <aside class="flex w-80 flex-shrink-0 flex-col overflow-hidden border-r border-slate-200/80 bg-white/95 dark:border-slate-800/80 dark:bg-slate-950/85">
          <FileUpload
            ref="fileUploadRef"
            :files="batchFiles"
            :active-id="selectedFileId"
            @select="(id) => selectedFileId = id"
            @remove="handleRemoveFile"
            @clear="handleClearFiles"
            @upload="handleUpload"
            @batch-upload="handleBatchUpload"
            @extract="handleExtract"
            @batch-extract="handleBatchExtract"
          />
        </aside>

        <main class="flex-1 overflow-hidden">
          <IntegratedExplorer
            :initial-doi="explorerDoi"
            :selected-file-id="selectedFileId"
            :source-name="batchFiles.find((file) => file.id === selectedFileId)?.name"
            :literature-metadata="batchFiles.find((file) => file.id === selectedFileId)?.metadata"
            @view-literature="handleLiteratureView"
            @clear-doi="explorerDoi = ''"
          />
        </main>

        <aside class="flex w-[400px] flex-shrink-0 flex-col overflow-hidden border-l border-slate-200/80 bg-slate-50/90 dark:border-slate-800/80 dark:bg-[#081523]">
          <div class="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white/95 p-2 dark:border-slate-800 dark:bg-slate-950/80">
            <button
              @click="sidebarTab = 'chat'"
              class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center justify-center gap-2"
              :class="sidebarTab === 'chat'
                ? 'bg-slate-100 text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/80 dark:hover:text-slate-200'"
            >
              AI Assistant
            </button>
            <button
              @click="sidebarTab = 'agents'"
              class="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center justify-center gap-2"
              :class="sidebarTab === 'agents'
                ? 'bg-slate-100 text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900/80 dark:hover:text-slate-200'"
            >
              Coordination Panel
            </button>
          </div>

          <div class="relative min-h-0 flex-1 bg-white dark:bg-slate-950">
            <ChatPanel
              v-show="sidebarTab === 'chat'"
              class="absolute inset-0"
              ref="chatPanelRef"
              :loading="isChatting"
              @send="handleChat"
            />
            <AgentStatusPanel
              v-show="sidebarTab === 'agents'"
              class="absolute inset-0"
              :workflow="latestAgentWorkflow"
              :active-run="activeExtractionRun"
              :active-file-name="activeExtractionFileName"
            />
          </div>
        </aside>
      </div>

      <div v-else-if="currentView === 'literature'" class="h-[calc(100vh-88px)]">
        <LiteratureList />
      </div>

      <div v-else-if="currentView === 'grounding'" class="h-[calc(100vh-56px)]">
        <SourceGroundingView :pdf-url="groundingPdfUrl" :highlight-data="groundingHighlightData" />
      </div>
    </main>
  </div>
</template>
