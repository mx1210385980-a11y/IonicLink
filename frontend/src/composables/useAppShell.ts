import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import {
  chat,
  extractData,
  getLatestExtractionRun,
  getCurrentUser,
  getPdfHighlights,
  login,
  syncBatchData,
  uploadFile,
  type AgentWorkflow,
  type BatchFile,
  type ExtractionResponse,
  type ExtractionRunDetail,
  type TribologyData,
} from '@/lib/api'
import {
  clearSession,
  getActiveScope,
  markSessionReady,
  sessionState,
  setActiveScope,
  setCurrentUser,
  setSession,
} from '@/lib/session'
import { useI18n } from '@/composables/useI18n'
import type { HighlightRect } from '@/types/pdf-highlight'

type AppView = 'dashboard' | 'workspace' | 'cleaning' | 'predict' | 'monitor' | 'literature' | 'grounding' | 'guide' | 'mentor' | 'blog'
type SidebarTab = 'chat' | 'agents'

type FileUploadBridge = {
  setUploading: (value: boolean) => void
}

type ChatPanelBridge = {
  addMessage: (role: 'user' | 'assistant', message: string) => void
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'error', 'cancelled'])
const DARK_MODE_STORAGE_KEY = 'ioniclink-theme'
const BATCH_EXTRACTION_CONCURRENCY = 3
const SESSION_RESTORE_TIMEOUT_MS = 9000

export function useAppShell(
  fileUploadRef: Ref<FileUploadBridge | undefined>,
  chatPanelRef: Ref<ChatPanelBridge | undefined>,
) {
  const { t } = useI18n()
  const currentView = ref<AppView>('guide')
  const sidebarTab = ref<SidebarTab>('chat')
  const isDark = ref(false)

  const batchFiles = ref<BatchFile[]>([])
  const selectedFileId = ref<string | null>(null)
  const explorerDoi = ref('')
  const latestAgentWorkflow = ref<AgentWorkflow | null>(null)
  const activeExtractionFileId = ref<string | null>(null)
  const activeExtractionRun = ref<ExtractionRunDetail | null>(null)
  const preferredTrainingDatasetId = ref<number | null>(null)
  const isChatting = ref(false)
  const isAuthenticating = ref(false)
  const authError = ref('')
  const groundingHighlightData = ref<HighlightRect[]>([])

  const activeScope = computed(() => getActiveScope())
  const availableScopes = computed(() => sessionState.user?.availableScopes || [])
  const selectedScopeKey = computed({
    get: () => activeScope.value?.key || '',
    set: (scopeKey: string) => {
      const scope = availableScopes.value.find((item) => item.key === scopeKey) || null
      setActiveScope(scope)
    },
  })

  const activeExtractionFileName = computed(() => {
    if (!activeExtractionFileId.value) return null
    return batchFiles.value.find((file) => file.id === activeExtractionFileId.value)?.name || null
  })

  const groundingPdfUrl = computed(() => {
    if (!selectedFileId.value) return ''
    return `/api/pdf/${selectedFileId.value}`
  })

  function resolveViewFromUrl(): AppView | null {
    const params = new URLSearchParams(window.location.search)
    if (params.get('article')) {
      return 'blog'
    }
    const view = params.get('view')
    if (
      view === 'dashboard'
      || view === 'workspace'
      || view === 'cleaning'
      || view === 'predict'
      || view === 'monitor'
      || view === 'mentor'
      || view === 'literature'
      || view === 'grounding'
      || view === 'guide'
      || view === 'blog'
    ) {
      return view
    }
    return null
  }

  function restoreViewFromUrl() {
    const resolvedView = resolveViewFromUrl()
    if (resolvedView) {
      currentView.value = resolvedView
    }
  }

  function syncViewToUrl(view: AppView) {
    if (typeof window === 'undefined') {
      return
    }

    const nextUrl = new URL(window.location.href)
    if (view === 'guide') {
      nextUrl.searchParams.delete('view')
    } else {
      nextUrl.searchParams.set('view', view)
    }

    if (view !== 'blog') {
      nextUrl.searchParams.delete('article')
    }

    if (nextUrl.toString() !== window.location.href) {
      window.history.replaceState({ view }, '', nextUrl)
    }
  }

  let extractionPollTimer: ReturnType<typeof setInterval> | null = null

  watch([() => selectedFileId.value, () => currentView.value], async ([fileId, view]) => {
    if (!fileId) {
      explorerDoi.value = ''
      return
    }

    const batchFile = batchFiles.value.find((file) => file.id === fileId)
    if (batchFile?.metadata?.doi) {
      explorerDoi.value = batchFile.metadata.doi
    } else if (batchFile?.status === 'success' && batchFile.records.length > 0) {
      explorerDoi.value = `temp-${fileId}`
    } else {
      explorerDoi.value = ''
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

  function resetWorkspaceSessionState() {
    batchFiles.value = []
    selectedFileId.value = null
    explorerDoi.value = ''
    latestAgentWorkflow.value = null
    preferredTrainingDatasetId.value = null
    resetExtractionState()
  }

  function openTrainingWorkbench(datasetId: number | null = null) {
    preferredTrainingDatasetId.value = datasetId
    currentView.value = 'predict'
  }

  async function initializeSession() {
    if (!sessionState.token) {
      markSessionReady()
      return
    }

    try {
      const user = await Promise.race([
        getCurrentUser(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Session restore timed out')), SESSION_RESTORE_TIMEOUT_MS)
        }),
      ])
      setCurrentUser(user)
    } catch (error) {
      console.warn('[Auth] Session restore failed:', error)
      clearSession()
      authError.value = t('auth.session_expired')
    } finally {
      markSessionReady()
    }
  }

  async function handleLogin(credentials: { username: string; password: string }) {
    try {
      isAuthenticating.value = true
      authError.value = ''
      const response = await login(credentials.username, credentials.password)
      setSession(response.accessToken, response.user)
      resetWorkspaceSessionState()
      currentView.value = resolveViewFromUrl() || 'guide'
    } catch (error: any) {
      authError.value = error?.response?.data?.detail || error?.message || t('auth.sign_in_failed')
    } finally {
      isAuthenticating.value = false
    }
  }

  function handleLogout() {
    clearSession()
    authError.value = ''
    resetWorkspaceSessionState()
  }

  function findBatchFile(fileId: string) {
    return batchFiles.value.find((file) => file.id === fileId)
  }

  function isTerminalRunStatus(status?: string | null): boolean {
    return TERMINAL_RUN_STATUSES.has(String(status || '').toLowerCase())
  }

  function formatStageLabel(stage?: string | null): string {
    const normalized = String(stage || '').trim().toLowerCase()
    if (!normalized) return t('stage.queued')
    if (normalized.startsWith('stage_a')) return t('stage.profiling_document')
    if (normalized.startsWith('stage_b')) return t('stage.resolving_abbreviations')
    if (normalized.startsWith('stage_c.figure_retry')) return t('stage.retrying_figure_extraction')
    if (normalized.startsWith('stage_c.figure')) return t('stage.reading_figures_tables')
    if (normalized.startsWith('stage_c.text')) return t('stage.mining_text_candidates')
    if (normalized.startsWith('fallback_table')) return t('stage.recovering_table_data')
    if (normalized.startsWith('stage_d')) return t('stage.validating_candidates')
    if (normalized.startsWith('stage_e')) return t('stage.finalizing_records')
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
    batchFile.progressMessage = t('progress.needs_review')
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
        ? t('progress.saved_records', { count: finalRecordCount })
        : t('progress.finished_without_records')
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
            ? (finalRecordCount ? t('progress.saved_records', { count: finalRecordCount }) : t('progress.finished_without_records'))
            : summary.current_message || existing?.summary?.current_message,
      },
      error_message: inferredStatus === 'failed' ? response.message || existing?.error_message || null : null,
      created_at: existing?.created_at,
      updated_at: new Date().toISOString(),
    }
  }

  async function fetchLatestRun(fileId: string, silentNotFound: boolean = true) {
    const literatureId = Number(fileId)
    if (!Number.isFinite(literatureId)) return null

    try {
      return await getLatestExtractionRun(literatureId)
    } catch (error: any) {
      if (silentNotFound && error?.response?.status === 404) {
        return null
      }
      throw error
    }
  }

  function applyRunProgress(fileId: string, run: ExtractionRunDetail) {
    const batchFile = findBatchFile(fileId)
    const snapshot = getRunSnapshot(run)

    if (run.status === 'running' || run.status === 'processing') {
      setFileProcessing(batchFile, snapshot.progress, snapshot.message)
    }

    if (activeExtractionFileId.value === fileId) {
      activeExtractionRun.value = run
      if (isTerminalRunStatus(run.status)) {
        clearExtractionPolling()
      }
    }
  }

  async function refreshLatestRun(fileId: string, silentNotFound: boolean = true) {
    const run = await fetchLatestRun(fileId, silentNotFound)
    if (run) {
      applyRunProgress(fileId, run)
    }
    return run
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

  function startPassiveFileTracking(
    fileId: string,
    onProgress: (run: ExtractionRunDetail) => void,
  ) {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (stopped) return
      try {
        const run = await fetchLatestRun(fileId, true)
        if (run) {
          applyRunProgress(fileId, run)
          onProgress(run)
          if (isTerminalRunStatus(run.status)) {
            return
          }
        }
      } catch (error) {
        console.warn(`[Progress] Failed to refresh run ${fileId}:`, error)
      }

      if (!stopped) {
        timer = setTimeout(tick, 2500)
      }
    }

    void tick()

    return () => {
      stopped = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  async function waitForExtractionCompletion(
    fileId: string,
    timeoutMs: number = 180000,
    onProgress?: (run: ExtractionRunDetail) => void,
  ) {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const run = await fetchLatestRun(fileId, true)
      if (run) {
        applyRunProgress(fileId, run)
        onProgress?.(run)
      }
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
      title: t('progress.untitled'),
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
    setFileProcessing(batchFile, 96, t('progress.syncing_records', { count: records.length }))

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
      batchFile.errorMessage = t('progress.auto_sync_failed', { message: error?.message || 'Unknown error' })
    }
  }

  async function executeExtraction(
    fileId: string,
    force: boolean = false,
    options: { trackActiveRun?: boolean } = {},
  ) {
    const batchFile = findBatchFile(fileId)
    if (!batchFile) {
      throw new Error(`File ${fileId} not found`)
    }

    const trackActiveRun = options.trackActiveRun !== false
    const stopPassiveTracking = trackActiveRun
      ? null
      : startPassiveFileTracking(fileId, (run) => {
          const snapshot = getRunSnapshot(run)
          setFileProcessing(batchFile, snapshot.progress, snapshot.message)
        })

    try {
      latestAgentWorkflow.value = null
      if (trackActiveRun) {
        startExtractionTracking(fileId)
      }
      setFileProcessing(
        batchFile,
        8,
        force ? t('progress.reanalyzing_document') : t('progress.dispatching_workflow'),
      )

      let response = await extractData(fileId, force)
      latestAgentWorkflow.value = response.agent_workflow || null
      if (trackActiveRun) {
        syncActiveRunFromResponse(fileId, response, 0, response.status === 'processing' ? 'running' : undefined)
      }

      if (response.status === 'processing') {
        setFileProcessing(batchFile, 16, response.message || t('progress.agent_running'))
        const terminalRun = await waitForExtractionCompletion(fileId, 180000, (run) => {
          const snapshot = getRunSnapshot(run)
          setFileProcessing(batchFile, snapshot.progress, snapshot.message)
        })

        if (!terminalRun) {
          throw new Error(t('progress.extraction_still_running'))
        }
        if (terminalRun.status !== 'completed') {
          throw new Error(terminalRun.error_message || t('progress.background_failed'))
        }

        response = await extractData(fileId, false)
        latestAgentWorkflow.value = response.agent_workflow || latestAgentWorkflow.value
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, response, 0)
        }
      }

      if (trackActiveRun) {
        await refreshLatestRun(fileId, true)
      }

      const { metadata, records } = normalizeExtractionPayload(fileId, response)
      if (trackActiveRun) {
        syncActiveRunFromResponse(fileId, response, records.length)
      }
      batchFile.metadata = metadata
      batchFile.records = records
      batchFile.hasWarnings = hasWarnings(records)

      if (!response.success || records.length === 0) {
        const message = response.message || t('progress.no_tribology_data')
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, { ...response, success: false, message }, records.length, 'failed')
        }
        setFileError(batchFile, message)
        return {
          success: false,
          message,
          recordCount: 0,
        }
      }

      await syncExtractedRecords(batchFile, fileId, metadata, records, force ? 'Sync Reprocess' : 'Sync')
      setFileSuccess(batchFile, t('progress.extracted_records', { count: records.length }))

      return {
        success: true,
        message: response.message || t('progress.saved_records', { count: records.length }),
        recordCount: records.length,
      }
    } finally {
      stopPassiveTracking?.()
    }
  }

  function buildInitialFileState(response: { file_id: string; filename: string; status?: string | null }): BatchFile {
    const alreadyExtracted = String(response.status || '').toLowerCase() === 'completed'
    return {
      id: response.file_id,
      name: response.filename,
      scopeKey: activeScope.value?.key,
      status: alreadyExtracted ? 'success' : 'uploaded',
      progress: alreadyExtracted ? 100 : 0,
      progressMessage: alreadyExtracted ? t('progress.already_extracted_ready') : t('progress.ready_to_extract'),
      records: [],
      hasWarnings: false,
    }
  }

  async function hydrateCompletedUpload(batchFile: BatchFile) {
    setFileProcessing(batchFile, 20, t('progress.loading_cached_results'))
    const response = await extractData(batchFile.id, false)
    const { metadata, records } = normalizeExtractionPayload(batchFile.id, response)
    batchFile.metadata = metadata
    batchFile.records = records
    batchFile.hasWarnings = hasWarnings(records)
    setFileSuccess(
      batchFile,
      records.length ? t('progress.loaded_cached_records', { count: records.length }) : t('progress.cached_extraction_loaded'),
    )
  }

  function handleClearFiles() {
    if (confirm(t('confirm.clear_all_files'))) {
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
        const batchFile = buildInitialFileState(response)
        batchFiles.value.push(batchFile)

        if (!selectedFileId.value) {
          selectedFileId.value = response.file_id
        }

        if (String(response.status || '').toLowerCase() === 'completed') {
          await hydrateCompletedUpload(batchFile)
        }

        chatPanelRef.value?.addMessage(
          'assistant',
          String(response.status || '').toLowerCase() === 'completed'
            ? t('progress.file_already_indexed', { name: response.filename })
            : t('progress.file_uploaded', { name: response.filename }),
        )
      }
    } catch (error: any) {
      chatPanelRef.value?.addMessage('assistant', t('chat.upload_failed', { message: error.message || 'Unknown error' }))
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
          const batchFile = buildInitialFileState(response)
          batchFiles.value.push(batchFile)

          if (String(response.status || '').toLowerCase() === 'completed') {
            await hydrateCompletedUpload(batchFile)
          }

          successCount++
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    fileUploadRef.value?.setUploading(false)
    chatPanelRef.value?.addMessage('assistant', t('chat.upload_batch_complete', { success: successCount, fail: failCount }))
  }

  async function handleExtract(fileId: string, force: boolean = false) {
    const batchFile = findBatchFile(fileId)
    if (!batchFile) return

    try {
      chatPanelRef.value?.addMessage(
        'assistant',
        force ? t('chat.reanalyzing_literature') : t('chat.analyzing_literature'),
      )

      const result = await executeExtraction(fileId, force)

      if (result.success) {
        chatPanelRef.value?.addMessage(
          'assistant',
          t('chat.extraction_results_panel', { message: result.message }),
        )
      } else {
        chatPanelRef.value?.addMessage(
          'assistant',
          t('chat.no_usable_records', { message: result.message }),
        )
      }
    } catch (error: any) {
      setFileError(batchFile, error.message || 'Unknown error')
      chatPanelRef.value?.addMessage('assistant', t('chat.extraction_failed', { message: error.message || 'Unknown error' }))
    } finally {
      clearExtractionPolling()
    }
  }

  async function handleBatchExtract(fileIds: string[]) {
    const pendingFileIds = Array.from(new Set(fileIds)).filter((fileId) => Boolean(findBatchFile(fileId)))
    if (pendingFileIds.length === 0) {
      return
    }

    const concurrency = Math.min(BATCH_EXTRACTION_CONCURRENCY, pendingFileIds.length)
    chatPanelRef.value?.addMessage(
      'assistant',
      t('chat.batch_start', { count: pendingFileIds.length, concurrency }),
    )

    let successCount = 0
    let failCount = 0
    let totalRecords = 0
    let completedCount = 0
    let nextIndex = 0

    const worker = async () => {
      while (nextIndex < pendingFileIds.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        const fileId = pendingFileIds[currentIndex]
        if (!fileId) {
          break
        }
        const batchFile = findBatchFile(fileId)
        if (!batchFile) {
          failCount++
          completedCount++
          continue
        }

        try {
          const result = await executeExtraction(fileId, false, { trackActiveRun: false })
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
          completedCount++
          chatPanelRef.value?.addMessage(
            'assistant',
            t('chat.batch_progress', {
              current: completedCount,
              total: pendingFileIds.length,
              name: batchFile.name,
              status: batchFile.status === 'success' ? t('status.completed') : t('status.failed'),
            }),
          )
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))

    currentView.value = 'workspace'
    chatPanelRef.value?.addMessage(
      'assistant',
      t('chat.batch_complete', { success: successCount, fail: failCount, total: totalRecords }),
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
        t('chat.request_failed', { message: error.message || t('chat.backend_running_hint') }),
      )
    } finally {
      isChatting.value = false
    }
  }

  function handleLiteratureView() {
    console.log('[App] Switching to literature view')
    currentView.value = 'literature'
  }

  onMounted(() => {
    restoreViewFromUrl()
    const storedTheme = window.localStorage.getItem(DARK_MODE_STORAGE_KEY)
    if (storedTheme === 'dark') {
      isDark.value = true
    } else if (storedTheme === 'light') {
      isDark.value = false
    } else {
      isDark.value = false
    }
    void initializeSession()
  })

  watch(
    isDark,
    (enabled) => {
      document.documentElement.classList.toggle('dark', enabled)
      window.localStorage.setItem(DARK_MODE_STORAGE_KEY, enabled ? 'dark' : 'light')
    },
    { immediate: true },
  )

  watch(
    () => sessionState.activeScopeKey,
    (nextScopeKey, previousScopeKey) => {
      if (!nextScopeKey || nextScopeKey === previousScopeKey) return
      resetWorkspaceSessionState()
    },
  )

  watch(currentView, (view) => {
    syncViewToUrl(view)
  })

  onBeforeUnmount(() => {
    clearExtractionPolling()
  })

  // Navigate to workspace with dashboard filters applied
  function handleExploreData(_queryParams: Record<string, string>) {
    // Store query params for the workspace to pick up
    // The filters are managed by useDashboardFilters composable (shared state)
    // We just need to switch the view
    currentView.value = 'workspace'
    // Clear file selection to show all data
    selectedFileId.value = null
  }

  return {
    authError,
    availableScopes,
    batchFiles,
    currentView,
    explorerDoi,
    groundingHighlightData,
    groundingPdfUrl,
    handleBatchExtract,
    handleBatchUpload,
    handleChat,
    handleClearFiles,
    handleExploreData,
    handleExtract,
    handleLiteratureView,
    handleLogin,
    handleLogout,
    handleRemoveFile,
    handleUpload,
    isAuthenticating,
    isChatting,
    isDark,
    latestAgentWorkflow,
    openTrainingWorkbench,
    preferredTrainingDatasetId,
    selectedFileId,
    selectedScopeKey,
    sessionState,
    sidebarTab,
    activeExtractionFileName,
    activeExtractionRun,
    toggleDarkMode,
  }
}
