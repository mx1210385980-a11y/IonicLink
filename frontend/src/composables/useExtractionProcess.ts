import { computed, getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'

import {
  cancelExtraction,
  extractData,
  getExtractionRun,
  getLatestExtractionRun,
  getRawCandidates,
  type ClaudePdfSummary,
  type ExtractionProfile,
  type ExtractionRunDetail,
  type ExtractionRunSummary,
  type ExtractorType,
  type RawCandidateItem,
  type RawCandidatesResponse,
} from '@/lib/api'
import {
  isActiveRunStatus,
  isTerminalRunStatus,
  mapStageToProgress,
  stageBandIndex,
} from '@/lib/extractionStages'

export type ExtractionPhase = 'idle' | 'queued' | 'running' | 'terminal'

export interface PageGroup {
  page: number | null
  label: string
  items: RawCandidateItem[]
  kept: number
  dropped: number
}

export interface UseExtractionProcessOptions {
  literatureId: Ref<number | null>
  runId?: Ref<string | null>
  extractorType?: Ref<ExtractorType>
  pollIntervalMs?: number
  rawLimit?: number
  /** Begin an initial fetch + polling on creation (default true). */
  autoStart?: boolean
}

const MAX_CONSECUTIVE_FAILURES = 6

function errorMessage(error: any, fallback: string): string {
  return error?.response?.data?.detail || error?.response?.data?.message || error?.message || fallback
}

function groupByPage(items: RawCandidateItem[]): PageGroup[] {
  const groups = new Map<string, PageGroup>()
  for (const item of items) {
    const key = item.page == null ? 'unknown' : String(item.page)
    let group = groups.get(key)
    if (!group) {
      group = {
        page: item.page,
        label: item.page == null ? 'Unknown page' : `Page ${item.page}`,
        items: [],
        kept: 0,
        dropped: 0,
      }
      groups.set(key, group)
    }
    group.items.push(item)
    if (item.drop_reason == null) group.kept += 1
    else group.dropped += 1
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.page == null) return 1
    if (b.page == null) return -1
    return a.page - b.page
  })
}

/**
 * Drives the live + inspectable extraction-process view for one literature (or a
 * pinned historic run). Polls run status while active; fetches the raw model
 * rows + kept/dropped rollup once the run reaches a terminal state (raw
 * candidates are only persisted at run finalize). The same instance serves a
 * live run and an after-the-fact inspection — it just stops polling immediately
 * when the run is already terminal.
 */
export function useExtractionProcess(opts: UseExtractionProcessOptions) {
  const extractorType = opts.extractorType ?? ref<ExtractorType>('tribology')
  const pollIntervalMs = opts.pollIntervalMs ?? 2500
  const rawLimit = opts.rawLimit ?? 2000

  const run = ref<ExtractionRunDetail | null>(null)
  const rawCandidates = ref<RawCandidatesResponse | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const starting = ref(false)
  const rawLoading = ref(false)

  let timer: ReturnType<typeof setInterval> | null = null
  let rawFetched = false
  let consecutiveFailures = 0

  const status = computed(() => String(run.value?.status || '').toLowerCase())
  const phase = computed<ExtractionPhase>(() => {
    if (!run.value) return 'idle'
    if (isTerminalRunStatus(status.value)) return 'terminal'
    if (status.value === 'queued') return 'queued'
    if (isActiveRunStatus(status.value)) return 'running'
    return 'idle'
  })
  const isTerminal = computed(() => phase.value === 'terminal')
  const isActive = computed(() => phase.value === 'queued' || phase.value === 'running')

  const summary = computed<ExtractionRunSummary>(() => (run.value?.summary || {}) as ExtractionRunSummary)
  const pipeline = computed(() => String(summary.value.pipeline || (run.value ? 'legacy' : '')))
  const isClaudePdf = computed(() => pipeline.value === 'claude_pdf')
  const claudePdf = computed<ClaudePdfSummary | null>(() => (summary.value.claude_pdf as ClaudePdfSummary) || null)
  const tokenUsage = computed(() => {
    const usage = claudePdf.value?.usage || {}
    return { input: Number(usage.input_tokens || 0), output: Number(usage.output_tokens || 0) }
  })

  const lastLog = computed(() => {
    const log = run.value?.progress_log || []
    return log.length ? log[log.length - 1] : null
  })
  const currentStage = computed(() => String(summary.value.current_stage || lastLog.value?.stage || ''))
  const currentMessage = computed(() => String(summary.value.current_message || lastLog.value?.message || ''))
  const progressPercent = computed(() => {
    if (isTerminal.value) return 100
    const fromSummary = Number(summary.value.progress_percent)
    if (Number.isFinite(fromSummary) && fromSummary > 0) {
      return Math.min(99, Math.max(1, Math.round(fromSummary)))
    }
    return mapStageToProgress(currentStage.value, status.value)
  })
  const stageIndex = computed(() => stageBandIndex(currentStage.value))

  const rollup = computed(() => rawCandidates.value?.rollup || null)
  const itemsByPage = computed<PageGroup[]>(() => groupByPage(rawCandidates.value?.items || []))
  const keptCount = computed(() => rollup.value?.kept ?? run.value?.final_count ?? 0)
  const droppedByReason = computed(() => rollup.value?.dropped_by_reason ?? run.value?.dropped_by_reason ?? {})

  const elapsedMs = computed(() => {
    const startedRaw = run.value?.created_at
    if (!startedRaw) return 0
    const started = Date.parse(startedRaw)
    if (Number.isNaN(started)) return 0
    const endRaw = isTerminal.value ? run.value?.updated_at : undefined
    const end = endRaw ? Date.parse(endRaw) : Date.now()
    return Math.max(0, (Number.isNaN(end) ? Date.now() : end) - started)
  })

  async function fetchRun(): Promise<void> {
    const pinnedRunId = opts.runId?.value || null
    const litId = opts.literatureId.value
    if (pinnedRunId) {
      run.value = await getExtractionRun(pinnedRunId)
    } else if (litId != null) {
      run.value = await getLatestExtractionRun(litId, extractorType.value)
    } else {
      run.value = null
    }
  }

  async function fetchRaw(): Promise<void> {
    const litId = opts.literatureId.value
    if (litId == null) return
    rawLoading.value = true
    try {
      rawCandidates.value = await getRawCandidates(litId, {
        status: 'all',
        limit: rawLimit,
        extractorType: extractorType.value,
      })
      rawFetched = true
    } finally {
      rawLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      await fetchRun()
      error.value = null
      consecutiveFailures = 0
      if (isTerminal.value) {
        if (!rawFetched) await fetchRaw()
        stopPolling()
      }
    } catch (err: any) {
      const code = Number(err?.response?.status || 0)
      if (code === 404) {
        // No run yet — stay idle, not an error.
        run.value = null
        error.value = null
      } else {
        consecutiveFailures += 1
        error.value = errorMessage(err, 'Failed to load extraction run')
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) stopPolling()
      }
    } finally {
      loading.value = false
    }
  }

  function startPolling(): void {
    if (timer) return
    timer = setInterval(() => {
      void refresh()
    }, pollIntervalMs)
  }

  function stopPolling(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function stop(): void {
    stopPolling()
  }

  async function start(force = false, profile: ExtractionProfile = 'auto'): Promise<void> {
    const litId = opts.literatureId.value
    if (litId == null) return
    starting.value = true
    rawFetched = false
    rawCandidates.value = null
    try {
      await extractData(String(litId), force, profile, undefined, extractorType.value)
      await refresh()
      if (!isTerminal.value) startPolling()
    } catch (err: any) {
      error.value = errorMessage(err, 'Failed to start extraction')
    } finally {
      starting.value = false
    }
  }

  async function cancel(): Promise<void> {
    const litId = opts.literatureId.value
    if (litId == null) return
    try {
      await cancelExtraction(String(litId), extractorType.value)
      await refresh()
    } catch (err: any) {
      error.value = errorMessage(err, 'Failed to cancel extraction')
    }
  }

  if (opts.autoStart !== false) {
    void refresh().then(() => {
      if (run.value && !isTerminal.value) startPolling()
    })
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    // state
    run,
    rawCandidates,
    error,
    loading,
    starting,
    rawLoading,
    // derived
    status,
    phase,
    isTerminal,
    isActive,
    summary,
    pipeline,
    isClaudePdf,
    claudePdf,
    tokenUsage,
    currentStage,
    currentMessage,
    progressPercent,
    stageIndex,
    rollup,
    itemsByPage,
    keptCount,
    droppedByReason,
    elapsedMs,
    // actions
    refresh,
    start,
    cancel,
    stop,
    startPolling,
    stopPolling,
  }
}

export type ExtractionProcess = ReturnType<typeof useExtractionProcess>
