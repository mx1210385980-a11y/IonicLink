import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  cancelExtraction,
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
  type ExtractionProfile,
  type ExtractorType,
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
import {
  DEFAULT_SECTION_BY_VIEW,
  normalizeSection,
  resolveRoute,
  type AppSection,
  type AppView,
} from '@/lib/platform'
import {
  buildInitialFileState,
  createUploadPlaceholder,
  hasExtractionWarnings,
  isNoDataResponse,
  normalizeExtractionPayload,
  resetFileForExtractorChange,
  setFileCancelled,
  setFileError,
  setFileNoData,
  setFileProcessing,
  setFileSuccess,
  setFileUploadProgress,
  uploadErrorMessage,
} from '@/lib/extractionWorkspace'
import { useI18n } from '@/composables/useI18n'
import type { HighlightRect } from '@/types/pdf-highlight'
type SidebarTab = 'chat' | 'agents'

type FileUploadBridge = {
  setUploading: (value: boolean) => void
}

type ChatPanelBridge = {
  addMessage: (role: 'user' | 'assistant', message: string) => void
}

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'error', 'cancelled', 'no_data'])
const DARK_MODE_STORAGE_KEY = 'ioniclink-theme'
const BATCH_EXTRACTION_CONCURRENCY = 3
const SESSION_RESTORE_TIMEOUT_MS = 9000

export function useAppShell(
  fileUploadRef: Ref<FileUploadBridge | undefined>,
  chatPanelRef: Ref<ChatPanelBridge | undefined>,
) {
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const currentView = ref<AppView>('home')
  const currentSection = ref<AppSection>(DEFAULT_SECTION_BY_VIEW.home)
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
  const defaultExtractorType = ref<ExtractorType>('tribology')
  const hydratingFileIds = new Set<string>()
  const reviewEvidenceHydratedFileIds = new Set<string>()

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
    const batchFile = batchFiles.value.find((file) => file.id === selectedFileId.value)
    if (batchFile?.disablePdfPreview) return ''
    return `/api/pdf/${selectedFileId.value}`
  })

  function syncStateFromRoute() {
    const resolved = resolveRoute(
      typeof route.name === 'string' ? route.name : undefined,
      typeof route.params.section === 'string' ? route.params.section : undefined,
    )
    currentView.value = resolved.view
    currentSection.value = resolved.section
  }

  function navigateTo(view: AppView, section?: AppSection) {
    const normalizedSection = normalizeSection(view, section)
    const target = {
      name: view,
      params: normalizedSection === DEFAULT_SECTION_BY_VIEW[view]
        ? {}
        : { section: normalizedSection },
      query: view === 'blog' ? route.query : {},
    }
    void router.push(target)
  }

  let extractionPollTimer: ReturnType<typeof setInterval> | null = null

  function hasUsableFieldLocation(entry: any) {
    const evidence = entry?.evidence
    return Boolean(evidence?.page && Array.isArray(evidence.bbox) && evidence.bbox.length >= 4)
  }

  function recordNeedsReviewEvidenceHydration(record: TribologyData) {
    const fieldMap = (record.field_evidence_json || {}) as Record<string, any>
    const keys = ['material', 'ionic_liquid']
    if (String(record.cof || '').trim()) keys.push('cof')
    if (String(record.potential || '').trim()) keys.push('potential')

    return keys.some((key) => {
      const entry = fieldMap[key]
      const fallbackValue = key === 'material'
        ? record.material_name
        : key === 'ionic_liquid'
          ? record.ionic_liquid
          : key === 'cof'
            ? record.cof
            : record.potential
      const value = String(entry?.value ?? fallbackValue ?? '').trim()
      if (!value) return false
      if (String(entry?.grounding_mode || '').trim().toLowerCase() === 'inferred') return false
      return !hasUsableFieldLocation(entry)
    })
  }

  function fileNeedsReviewEvidenceHydration(batchFile: BatchFile) {
    return batchFile.records.some((record) => recordNeedsReviewEvidenceHydration(record))
  }

  watch([() => selectedFileId.value, () => currentView.value, () => currentSection.value], async ([fileId, view, section]) => {
    if (!fileId) {
      explorerDoi.value = ''
      return
    }

    const batchFile = batchFiles.value.find((file) => file.id === fileId)
    const shouldHydrateCachedRecords = (
      batchFile
      && ['success', 'no_data'].includes(String(batchFile.status || '').toLowerCase())
      && batchFile.records.length === 0
      && !hydratingFileIds.has(fileId)
    )
    const shouldHydrateStaleReviewRecords = (
      batchFile
      && view === 'review'
      && ['success', 'no_data'].includes(String(batchFile.status || '').toLowerCase())
      && batchFile.records.length > 0
      && !reviewEvidenceHydratedFileIds.has(fileId)
      && !hydratingFileIds.has(fileId)
      && fileNeedsReviewEvidenceHydration(batchFile)
    )

    if (shouldHydrateCachedRecords && batchFile) {
      hydratingFileIds.add(fileId)
      try {
        await hydrateCompletedUpload(batchFile)
      } catch (error) {
        console.warn(`[Workspace] Failed to hydrate cached records for ${fileId}:`, error)
      } finally {
        hydratingFileIds.delete(fileId)
      }
    }

    if (shouldHydrateStaleReviewRecords && batchFile) {
      hydratingFileIds.add(fileId)
      reviewEvidenceHydratedFileIds.add(fileId)
      try {
        await hydrateCompletedUpload(batchFile)
      } catch (error) {
        console.warn(`[Review] Failed to refresh field evidence for ${fileId}:`, error)
      } finally {
        hydratingFileIds.delete(fileId)
      }
    }

    if (batchFile?.metadata?.doi) {
      explorerDoi.value = batchFile.metadata.doi
    } else if (batchFile?.status === 'success' && batchFile.records.length > 0) {
      explorerDoi.value = `temp-${fileId}`
    } else {
      explorerDoi.value = ''
    }

    if (view !== 'review') {
      groundingHighlightData.value = []
      return
    }
    void section
    if (batchFile?.disablePdfPreview) {
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
  }, { immediate: true })

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
    navigateTo('modeling', 'training')
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

  function replaceUploadPlaceholder(placeholder: BatchFile, nextFile: BatchFile) {
    const index = batchFiles.value.findIndex((file) => file === placeholder || file.id === placeholder.id)
    if (index === -1) {
      batchFiles.value.push(nextFile)
      return
    }
    batchFiles.value.splice(index, 1, nextFile)
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
    if (String(status || '').toLowerCase() === 'no_data') return 100

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
    const diffusionReviewableCount = run?.extractor_type === 'diffusion'
      ? Number((summary.diffusion_artifacts as any)?.reviewable_count ?? 0)
      : 0
    const message = String(
      summary.current_message
      || lastEntry?.message
      || (diffusionReviewableCount > 0
        ? `扩散抽取已生成 ${diffusionReviewableCount} 条候选记录，请进入审阅确认。`
        : ''),
    )
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

  function isNoDataRun(run: ExtractionRunDetail) {
    const status = String(run.status || '').toLowerCase()
    if (status === 'cancelled') return false
    if (status === 'no_data') return true
    if (['failed', 'error'].includes(status)) return false
    if (!['completed', 'success'].includes(status)) return false
    if (run.extractor_type === 'diffusion' && Number(run.candidate_count || 0) > 0) return false
    return Number(run.final_count || 0) === 0
  }

  function syncActiveRunFromResponse(
    fileId: string,
    response: ExtractionResponse,
    finalRecordCount: number,
    forcedStatus?: 'running' | 'completed' | 'failed' | 'no_data' | 'cancelled',
  ) {
    const summary: any = response.extraction_summary || {}
    const existing = activeExtractionRun.value
    const inferredStatus =
      forcedStatus ||
      (response.status === 'cancelled'
        ? 'cancelled'
        : response.status === 'processing'
        ? 'running'
        : isNoDataResponse(response, finalRecordCount)
          ? 'no_data'
        : response.success
          ? 'completed'
          : 'failed')

    const progressLog = [...((summary.progress_log as ExtractionRunDetail['progress_log']) || existing?.progress_log || [])]
    const noDataMessage = String(
      summary.no_data_reason
      || summary.current_message
      || response.message
      || existing?.error_message
      || 'No extractable records found.',
    )
    if (inferredStatus === 'completed' || inferredStatus === 'no_data') {
      const finalMessage = inferredStatus === 'no_data'
        ? noDataMessage
        : finalRecordCount
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
          inferredStatus === 'completed' || inferredStatus === 'no_data'
            ? 'stage_e.finalize'
            : summary.current_stage || existing?.summary?.current_stage,
        current_message:
          inferredStatus === 'completed' || inferredStatus === 'no_data'
            ? (inferredStatus === 'no_data'
              ? noDataMessage
              : (finalRecordCount ? t('progress.saved_records', { count: finalRecordCount }) : t('progress.finished_without_records')))
            : summary.current_message || existing?.summary?.current_message,
      },
      error_message: inferredStatus === 'failed' || inferredStatus === 'no_data' || inferredStatus === 'cancelled'
        ? (inferredStatus === 'no_data' ? noDataMessage : response.message || existing?.error_message || null)
        : null,
      created_at: existing?.created_at,
      updated_at: new Date().toISOString(),
    }
  }

  async function fetchLatestRun(fileId: string, silentNotFound: boolean = true) {
    const literatureId = Number(fileId)
    if (!Number.isFinite(literatureId)) return null
    const extractorType = findBatchFile(fileId)?.extractor_type || 'tribology'

    try {
      return await getLatestExtractionRun(literatureId, extractorType)
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
    const reviewableCount = run.extractor_type === 'diffusion'
      ? Number(run.candidate_count || 0) + Number(run.final_count || 0)
      : Number(run.final_count || 0)

    const status = String(run.status || '').toLowerCase()
    if (status === 'running' || status === 'processing' || status === 'queued' || status === 'extracting') {
      setFileProcessing(batchFile, snapshot.progress, snapshot.message)
    } else if (status === 'cancelled') {
      setFileCancelled(batchFile, run.error_message || snapshot.message || 'Extraction stopped.')
    } else if (['failed', 'error'].includes(status)) {
      setFileError(batchFile, run.error_message || snapshot.message || t('progress.background_failed'), t)
    } else if (isNoDataRun(run)) {
      setFileNoData(batchFile, snapshot.message || 'No extractable records found.')
    } else if (['completed', 'success'].includes(status)) {
      setFileSuccess(
        batchFile,
        run.extractor_type === 'diffusion' && reviewableCount > 0
          ? `扩散抽取已生成 ${reviewableCount} 条候选记录，请进入审阅确认。`
          : snapshot.message || t('progress.completed'),
      )
    }

    if (activeExtractionFileId.value === fileId) {
      activeExtractionRun.value = isNoDataRun(run) ? { ...run, status: 'no_data' } : run
      if (isTerminalRunStatus(run.status)) {
        clearExtractionPolling()
      }
    }
  }

  async function refreshLatestRun(fileId: string, silentNotFound: boolean = true) {
    const run = await fetchLatestRun(fileId, silentNotFound)
    if (run) {
      applyRunProgress(fileId, run)
      const batchFile = findBatchFile(fileId)
      const status = String(run.status || '').toLowerCase()
      const canHydrateTerminalRun = batchFile
        && ['completed', 'success', 'no_data'].includes(status)
        && !hydratingFileIds.has(fileId)
        && (batchFile.records.length === 0 || batchFile.status === 'processing')
      if (canHydrateTerminalRun && batchFile) {
        hydratingFileIds.add(fileId)
        try {
          await hydrateCompletedUpload(batchFile, { preserveRunState: true })
        } catch (error) {
          console.warn(`[Progress] Failed to load completed extraction ${fileId}:`, error)
        } finally {
          hydratingFileIds.delete(fileId)
        }
      }
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

      navigateTo('knowledge', 'explorer')
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
    options: { trackActiveRun?: boolean; profile?: ExtractionProfile } = {},
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
      const extractorType = batchFile.extractor_type || 'tribology'
      const extractionProfile = options.profile || 'high_accuracy'
      latestAgentWorkflow.value = null
      if (trackActiveRun) {
        startExtractionTracking(fileId)
      }
      setFileProcessing(
        batchFile,
        8,
        force ? t('progress.reanalyzing_document') : t('progress.dispatching_workflow'),
      )

      let response = await extractData(fileId, force, extractionProfile, undefined, extractorType)
      latestAgentWorkflow.value = response.agent_workflow || null
      if (trackActiveRun) {
        syncActiveRunFromResponse(fileId, response, 0, response.status === 'processing' ? 'running' : undefined)
      }

      if (response.status === 'cancelled') {
        const message = response.message || 'Extraction stopped.'
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, response, 0, 'cancelled')
        }
        setFileCancelled(batchFile, message)
        return {
          success: false,
          message,
          recordCount: 0,
          cancelled: true,
        }
      }

      if (response.status === 'processing') {
        setFileProcessing(batchFile, 16, response.message || t('progress.agent_running'))
        if (trackActiveRun) {
          return {
            success: true,
            message: response.message || t('progress.agent_running'),
            recordCount: 0,
            running: true,
          }
        }
        const terminalRun = await waitForExtractionCompletion(fileId, 180000, (run) => {
          const snapshot = getRunSnapshot(run)
          setFileProcessing(batchFile, snapshot.progress, snapshot.message)
        })

        if (!terminalRun) {
          throw new Error(t('progress.extraction_still_running'))
        }
        if (String(terminalRun.status || '').toLowerCase() === 'cancelled') {
          const message = terminalRun.error_message || 'Extraction stopped.'
          setFileCancelled(batchFile, message)
          if (trackActiveRun) {
            activeExtractionRun.value = terminalRun
          }
          return {
            success: false,
            message,
            recordCount: 0,
            cancelled: true,
          }
        }
        if (!['completed', 'no_data'].includes(String(terminalRun.status || '').toLowerCase())) {
          throw new Error(terminalRun.error_message || t('progress.background_failed'))
        }

        response = await extractData(fileId, false, extractionProfile, undefined, extractorType)
        latestAgentWorkflow.value = response.agent_workflow || latestAgentWorkflow.value
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, response, 0)
        }
      }

      if (trackActiveRun) {
        await refreshLatestRun(fileId, true)
      }

      const { metadata, records, extractorType: resolvedExtractorType } = normalizeExtractionPayload(fileId, response)
      if (trackActiveRun) {
        syncActiveRunFromResponse(fileId, response, records.length)
      }
      batchFile.metadata = metadata
      batchFile.extractor_type = resolvedExtractorType
      batchFile.records = records
      batchFile.hasWarnings = hasExtractionWarnings(records, resolvedExtractorType)

      if (isNoDataResponse(response, records.length)) {
        const message = response.message || 'No extractable records found.'
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, { ...response, success: true, message }, records.length, 'no_data')
        }
        setFileNoData(batchFile, message)
        return {
          success: true,
          message,
          recordCount: 0,
        }
      }

      if (!response.success || records.length === 0) {
        const message = response.message || t('progress.no_tribology_data')
        if (trackActiveRun) {
          syncActiveRunFromResponse(fileId, { ...response, success: false, message }, records.length, 'failed')
        }
        setFileError(batchFile, message, t)
        return {
          success: false,
          message,
          recordCount: 0,
        }
      }

      if (resolvedExtractorType !== 'diffusion') {
        await syncExtractedRecords(batchFile, fileId, metadata, records, force ? 'Sync Reprocess' : 'Sync')
      }
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

  async function hydrateCompletedUpload(batchFile: BatchFile, options: { preserveRunState?: boolean } = {}) {
    batchFile.status = batchFile.status === 'no_data' ? 'no_data' : 'success'
    batchFile.progress = 100
    batchFile.progressMessage = t('progress.loading_cached_results')
    batchFile.errorMessage = undefined
    if (!options.preserveRunState) {
      resetExtractionState(batchFile.id)
    }
    const response = await extractData(batchFile.id, false, 'high_accuracy', undefined, batchFile.extractor_type || 'tribology')
    const { metadata, records, extractorType } = normalizeExtractionPayload(batchFile.id, response)
    if (String(response.status || '').toLowerCase() === 'processing') {
      batchFile.extractor_type = extractorType
      setFileProcessing(batchFile, 16, response.message || t('progress.agent_running'))
      if (!options.preserveRunState) {
        startExtractionTracking(batchFile.id)
      }
      return
    }
    batchFile.metadata = metadata
    batchFile.extractor_type = extractorType
    batchFile.records = records
    batchFile.hasWarnings = hasExtractionWarnings(records, extractorType)
    if (isNoDataResponse(response, records.length)) {
      setFileNoData(batchFile, response.message || 'No extractable records found.')
      return
    }
    setFileSuccess(
      batchFile,
      records.length ? t('progress.loaded_cached_records', { count: records.length }) : t('progress.cached_extraction_loaded'),
    )
  }

  async function prepareFileForReview(fileId: string | null | undefined) {
    if (!fileId) return false
    const batchFile = findBatchFile(fileId)
    if (!batchFile) return false

    selectedFileId.value = batchFile.id
    const status = String(batchFile.status || '').toLowerCase()
    const canHydrateCachedResult = ['success', 'no_data'].includes(status)
      && batchFile.records.length === 0
      && !hydratingFileIds.has(batchFile.id)

    if (canHydrateCachedResult) {
      hydratingFileIds.add(batchFile.id)
      try {
        await hydrateCompletedUpload(batchFile)
      } catch (error) {
        console.warn(`[Review] Failed to prepare ${batchFile.id} before opening review:`, error)
      } finally {
        hydratingFileIds.delete(batchFile.id)
      }
    }

    return batchFile.records.length > 0
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
    const placeholder = createUploadPlaceholder(file, {
      scopeKey: activeScope.value?.key,
      extractorType: defaultExtractorType.value,
      t,
    })
    batchFiles.value.push(placeholder)
    selectedFileId.value = placeholder.id

    try {
      fileUploadRef.value?.setUploading(true)
      const response = await uploadFile(file, placeholder.extractor_type || defaultExtractorType.value, (progress) => {
        setFileUploadProgress(placeholder, progress.percent, t)
      })

      if (response.success) {
        const previousId = placeholder.id
        if (selectedFileId.value === previousId || !selectedFileId.value) {
          selectedFileId.value = response.file_id
        }
        const batchFile = buildInitialFileState(response, {
          scopeKey: activeScope.value?.key,
          defaultExtractorType: defaultExtractorType.value,
          t,
        })
        replaceUploadPlaceholder(placeholder, batchFile)
        selectedFileId.value = response.file_id

        if (String(response.status || '').toLowerCase() === 'processing') {
          startExtractionTracking(response.file_id)
        }

        if (['completed', 'no_data'].includes(String(response.status || '').toLowerCase())) {
          await hydrateCompletedUpload(batchFile)
        }

        chatPanelRef.value?.addMessage(
          'assistant',
          String(response.status || '').toLowerCase() === 'no_data'
            ? `${response.filename}: No extractable records found.`
            : ['completed', 'no_data'].includes(String(response.status || '').toLowerCase())
              ? t('progress.file_already_indexed', { name: response.filename })
            : t('progress.file_uploaded', { name: response.filename }),
        )
      } else {
        setFileError(placeholder, response.message || t('progress.upload_failed', { message: 'Unknown error' }), t)
      }
    } catch (error: any) {
      const message = uploadErrorMessage(error, t)
      setFileError(placeholder, message, t)
      chatPanelRef.value?.addMessage('assistant', message)
    } finally {
      fileUploadRef.value?.setUploading(false)
    }
  }

  async function handleBatchUpload(files: File[]) {
    fileUploadRef.value?.setUploading(true)

    let successCount = 0
    let failCount = 0
    const placeholders = files.map((file) => createUploadPlaceholder(file, {
      scopeKey: activeScope.value?.key,
      extractorType: defaultExtractorType.value,
      t,
    }))
    batchFiles.value.push(...placeholders)
    if (!selectedFileId.value && placeholders[0]) {
      selectedFileId.value = placeholders[0].id
    }

    for (const [index, file] of files.entries()) {
      const placeholder = placeholders[index]!
      try {
        const response = await uploadFile(file, placeholder.extractor_type || defaultExtractorType.value, (progress) => {
          setFileUploadProgress(placeholder, progress.percent, t)
        })

        if (response.success) {
          const batchFile = buildInitialFileState(response, {
            scopeKey: activeScope.value?.key,
            defaultExtractorType: defaultExtractorType.value,
            t,
          })
          const previousId = placeholder.id
          if (selectedFileId.value === previousId || !selectedFileId.value) {
            selectedFileId.value = response.file_id
          }
          replaceUploadPlaceholder(placeholder, batchFile)

          if (String(response.status || '').toLowerCase() === 'processing') {
            startExtractionTracking(response.file_id)
          }

          if (['completed', 'no_data'].includes(String(response.status || '').toLowerCase())) {
            await hydrateCompletedUpload(batchFile)
          }

          successCount++
        } else {
          setFileError(placeholder, response.message || t('progress.upload_failed', { message: 'Unknown error' }), t)
          failCount++
        }
      } catch (error: any) {
        setFileError(placeholder, uploadErrorMessage(error, t), t)
        failCount++
      }
    }

    fileUploadRef.value?.setUploading(false)
    chatPanelRef.value?.addMessage('assistant', t('chat.upload_batch_complete', { success: successCount, fail: failCount }))
  }

  async function handleExtract(fileId: string, force: boolean = false, options: { profile?: ExtractionProfile } = {}) {
    const batchFile = findBatchFile(fileId)
    if (!batchFile) return
    let keepPolling = false

    try {
      chatPanelRef.value?.addMessage(
        'assistant',
        force ? t('chat.reanalyzing_literature') : t('chat.analyzing_literature'),
      )

      const result = await executeExtraction(fileId, force, options)
      keepPolling = Boolean((result as any).running)

      if ((result as any).cancelled) {
        chatPanelRef.value?.addMessage('assistant', result.message || 'Extraction stopped.')
      } else if ((result as any).running) {
        chatPanelRef.value?.addMessage('assistant', result.message || t('progress.agent_running'))
      } else if (result.success && result.recordCount > 0) {
        chatPanelRef.value?.addMessage(
          'assistant',
          t('chat.extraction_results_panel', { message: result.message }),
        )
      } else if (result.success) {
        chatPanelRef.value?.addMessage(
          'assistant',
          result.message || 'No extractable records found.',
        )
      } else {
        chatPanelRef.value?.addMessage(
          'assistant',
          t('chat.no_usable_records', { message: result.message }),
        )
      }
    } catch (error: any) {
      setFileError(batchFile, error.message || 'Unknown error', t)
      chatPanelRef.value?.addMessage('assistant', t('chat.extraction_failed', { message: error.message || 'Unknown error' }))
    } finally {
      if (!keepPolling) {
        clearExtractionPolling()
      }
    }
  }

  async function handleCancelExtraction(fileId: string) {
    const batchFile = findBatchFile(fileId)
    if (!batchFile) return

    const message = 'Extraction stopped.'
    try {
      batchFile.progressMessage = 'Stopping extraction...'
      const extractorType = batchFile.extractor_type || 'tribology'
      const response = await cancelExtraction(fileId, extractorType)
      const resolvedMessage = response.message || message
      setFileCancelled(batchFile, resolvedMessage)
      syncActiveRunFromResponse(
        fileId,
        {
          ...response,
          success: false,
          status: 'cancelled',
          data: [],
          extraction_summary: {
            ...(response.extraction_summary || {}),
            run_id: response.extraction_summary?.run_id || activeExtractionRun.value?.run_id || null,
            candidate_count: response.extraction_summary?.candidate_count || 0,
            final_count: 0,
            dropped_by_reason: {
              ...(response.extraction_summary?.dropped_by_reason || {}),
              cancelled: 1,
            },
            page_coverage: response.extraction_summary?.page_coverage || {},
            current_stage: 'cancelled',
            current_message: resolvedMessage,
            progress_log: [
              ...((response.extraction_summary?.progress_log as any[]) || activeExtractionRun.value?.progress_log || []),
              { stage: 'cancelled', message: resolvedMessage },
            ],
          },
        },
        0,
        'cancelled',
      )
      clearExtractionPolling()
      chatPanelRef.value?.addMessage('assistant', resolvedMessage)
    } catch (error: any) {
      const failureMessage = error?.response?.data?.detail || error?.message || 'Failed to stop extraction.'
      batchFile.progressMessage = failureMessage
      chatPanelRef.value?.addMessage('assistant', failureMessage)
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
          setFileError(batchFile, error.message || 'Unknown error', t)
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

    navigateTo('knowledge', 'explorer')
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
    navigateTo('review', 'inbox')
  }

  function setDefaultExtractorType(extractorType: ExtractorType) {
    defaultExtractorType.value = extractorType
    const selected = selectedFileId.value ? findBatchFile(selectedFileId.value) : null
    if (selected && ['uploaded', 'error', 'no_data', 'success', 'cancelled'].includes(String(selected.status || '').toLowerCase())) {
      if (resetFileForExtractorChange(selected, extractorType, t)) {
        resetExtractionState(selected.id)
      }
    }
  }

  function setFileExtractorType(fileId: string, extractorType: ExtractorType) {
    const file = findBatchFile(fileId)
    if (!file) return
    if (resetFileForExtractorChange(file, extractorType, t)) {
      resetExtractionState(file.id)
    }
    if (selectedFileId.value === fileId) {
      defaultExtractorType.value = extractorType
    }
  }

  onMounted(() => {
    syncStateFromRoute()
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

  watch(
    () => [route.name, route.params.section] as const,
    () => {
      syncStateFromRoute()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clearExtractionPolling()
  })

  function handleExploreData(_queryParams: Record<string, string>) {
    navigateTo('knowledge', 'explorer')
    selectedFileId.value = null
  }

  return {
    authError,
    availableScopes,
    batchFiles,
    currentSection,
    currentView,
    defaultExtractorType,
    explorerDoi,
    groundingHighlightData,
    groundingPdfUrl,
    handleBatchExtract,
    handleBatchUpload,
    handleChat,
    handleClearFiles,
    handleCancelExtraction,
    handleExploreData,
    handleExtract,
    handleLiteratureView,
    handleLogin,
    handleLogout,
    handleRemoveFile,
    handleUpload,
    prepareFileForReview,
    isAuthenticating,
    isChatting,
    isDark,
    latestAgentWorkflow,
    navigateTo,
    openTrainingWorkbench,
    preferredTrainingDatasetId,
    selectedFileId,
    selectedScopeKey,
    sessionState,
    sidebarTab,
    activeExtractionFileName,
    activeExtractionRun,
    setDefaultExtractorType,
    setFileExtractorType,
    toggleDarkMode,
  }
}
