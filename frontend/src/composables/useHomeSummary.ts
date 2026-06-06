import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue'

import { useI18n } from '@/composables/useI18n'
import {
  getDashboardStats,
  getLatestExtractionRun,
  getMentorProgress,
  listCleanedDatasets,
  listLiterature,
  searchRecords,
  type AgentWorkflow,
  type BatchFile,
  type ExtractionRunDetail,
  type MentorProgressResponse,
} from '@/lib/api'
import { sessionState } from '@/lib/session'

type DashboardStatsSnapshot = Awaited<ReturnType<typeof getDashboardStats>>
type DatasetListSnapshot = Awaited<ReturnType<typeof listCleanedDatasets>>

const RUNNING_STATUSES = new Set(['queued', 'processing', 'running'])
const FAILED_STATUSES = new Set(['cancelled', 'error', 'failed'])
const SUCCESS_STATUSES = new Set(['completed', 'success'])
const RECENT_RUN_LOOKUP_LIMIT = 12
const HOME_REFRESH_INTERVAL_MS = 60_000
const REVIEW_DATA_CHANGED_EVENT = 'ioniclink:review-data-changed'

export type HomeActionType = 'route' | 'retry_run' | 'open_record'
export type HomeActionPriority = 'high' | 'medium' | 'low'

export interface HomeSuggestedAction {
  id: string
  label: string
  description: string
  actionType: HomeActionType
  target: string
  priority: HomeActionPriority
}

export interface HomeRecentRun {
  runId: string
  literatureId: number
  literatureTitle: string
  status: string
  updatedAt: string
}

export interface HomeSummary {
  today: {
    runningRuns: number
    failedRuns: number
    reviewPending: number
    reviewedToday: number
  }
  suggestedActions: HomeSuggestedAction[]
  recentRuns: HomeRecentRun[]
  health: {
    extractionSuccessRate: number | null
    evidenceCoverageRate: number | null
    reviewCompletionRate: number | null
    datasetReadyRecords: number
    officialDatabaseRecords: number
  }
}

type HomeRemoteSnapshot = {
  stats: DashboardStatsSnapshot | null
  mentor: MentorProgressResponse | null
  datasets: DatasetListSnapshot['items']
  recentRuns: HomeRecentRun[]
  literatureReviewableRows: number
  literatureRecordRows: number
  literatureCandidateRows: number
  searchRecordRows: number | null
  searchCandidateRows: number | null
  runningRuns: number
  failedRuns: number
  successRuns: number
}

type UseHomeSummaryOptions = {
  files: Ref<BatchFile[]> | ComputedRef<BatchFile[]>
  activeRun: Ref<ExtractionRunDetail | null> | ComputedRef<ExtractionRunDetail | null>
  latestWorkflow: Ref<AgentWorkflow | null> | ComputedRef<AgentWorkflow | null>
  preferredTrainingDatasetId: Ref<number | null> | ComputedRef<number | null>
}

const EMPTY_REMOTE_SNAPSHOT: HomeRemoteSnapshot = {
  stats: null,
  mentor: null,
  datasets: [],
  recentRuns: [],
  literatureReviewableRows: 0,
  literatureRecordRows: 0,
  literatureCandidateRows: 0,
  searchRecordRows: null,
  searchCandidateRows: null,
  runningRuns: 0,
  failedRuns: 0,
  successRuns: 0,
}

export function useHomeSummary(options: UseHomeSummaryOptions) {
  const { isChinese } = useI18n()
  const loading = ref(true)
  const error = ref('')
  const remoteSnapshot = ref<HomeRemoteSnapshot>(EMPTY_REMOTE_SNAPSHOT)

  let refreshTimer: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    loading.value = true
    error.value = ''

    const homeScope = homeRecordScope()
    const [statsResult, literatureResult, mentorResult, datasetsResult, officialRecordsResult, reviewCandidatesResult] = await Promise.allSettled([
      getDashboardStats(),
      listLiterature(0, RECENT_RUN_LOOKUP_LIMIT),
      getMentorProgress(),
      listCleanedDatasets(),
      searchRecords({ entityType: 'record' }, 0, 1, { scope: homeScope }),
      searchRecords({ entityType: 'candidate' }, 0, 1, { scope: homeScope }),
    ])

    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null
    const literature = literatureResult.status === 'fulfilled' ? literatureResult.value : []
    const mentor = mentorResult.status === 'fulfilled' ? mentorResult.value : null
    const datasets = datasetsResult.status === 'fulfilled' ? datasetsResult.value.items : []
    const searchRecordRows = officialRecordsResult.status === 'fulfilled' ? Number(officialRecordsResult.value.total || 0) : null
    const searchCandidateRows = reviewCandidatesResult.status === 'fulfilled' ? Number(reviewCandidatesResult.value.total || 0) : null

    const runResults = await Promise.allSettled(
      [...literature]
        .sort((left, right) => toTimestamp(right.created_at) - toTimestamp(left.created_at))
        .map(async (item) => {
          try {
            const run = await getLatestExtractionRun(item.id)
            return {
              runId: run.run_id || `literature-${item.id}`,
              literatureId: item.id,
              literatureTitle: item.title || item.doi || `Literature ${item.id}`,
              status: run.status,
              updatedAt: run.updated_at || run.created_at || item.created_at || '',
            } satisfies HomeRecentRun
          } catch (fetchError: any) {
            if (fetchError?.response?.status === 404) {
              return null
            }
            throw fetchError
          }
        }),
    )

    const recentRuns = runResults
      .filter((result): result is PromiseFulfilledResult<HomeRecentRun | null> => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((item): item is HomeRecentRun => Boolean(item))
      .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt))

    const runningRuns = recentRuns.filter((item) => isRunningStatus(item.status)).length
    const failedRuns = recentRuns.filter((item) => isFailedStatus(item.status)).length
    const successRuns = recentRuns.filter((item) => isSuccessStatus(item.status)).length
    const literatureReviewableRows = literature.reduce((sum, item) => sum + literatureReviewableCount(item), 0)
    const literatureRecordRows = literature.reduce((sum, item) => sum + literatureOfficialRecordCount(item), 0)
    const literatureCandidateRows = literature.reduce((sum, item) => sum + literatureCandidateCount(item), 0)

    remoteSnapshot.value = {
      stats,
      mentor,
      datasets,
      recentRuns: recentRuns.slice(0, 5),
      literatureReviewableRows,
      literatureRecordRows,
      literatureCandidateRows,
      searchRecordRows,
      searchCandidateRows,
      runningRuns,
      failedRuns,
      successRuns,
    }

    if (!stats && !literature.length && !mentor && !datasets.length) {
      error.value = isChinese.value ? 'Home 暂时无法从现有接口拉取摘要。' : 'Home could not load summary data from the current APIs.'
    } else if (
      statsResult.status === 'rejected'
      || literatureResult.status === 'rejected'
      || mentorResult.status === 'rejected'
      || datasetsResult.status === 'rejected'
      || officialRecordsResult.status === 'rejected'
      || reviewCandidatesResult.status === 'rejected'
      || runResults.some((result) => result.status === 'rejected')
    ) {
      error.value = isChinese.value ? 'Home 使用了部分回退数据。' : 'Home is showing partial fallback data.'
    }

    loading.value = false
  }

  const summary = computed<HomeSummary>(() => {
    const files = options.files.value || []
    const activeRun = options.activeRun.value
    const latestWorkflow = options.latestWorkflow.value
    const preferredTrainingDatasetId = options.preferredTrainingDatasetId.value

    const localRunningRuns = files.filter((file) => file.status === 'processing').length
    const localFailedRuns = files.filter((file) => file.status === 'error').length
    const localReviewPending = countLocalReviewPending(files, latestWorkflow)
    const localReviewedToday = countLocalReviewedToday(files)
    const localTerminalRuns = files.filter((file) => file.status === 'success' || file.status === 'error')
    const localSuccessRuns = localTerminalRuns.filter((file) => file.status === 'success').length

    const remoteStats = remoteSnapshot.value.stats
    const mentor = remoteSnapshot.value.mentor
    const inferredCount = Number(remoteStats?.confidence_stats?.breakdown?.inferred?.count || 0)
    const groundedCount =
      Number(remoteStats?.confidence_stats?.breakdown?.text_grounded?.count || 0)
      + Number(remoteStats?.confidence_stats?.breakdown?.figure_grounded?.count || 0)

    const totalRecords = Number(remoteStats?.total_records || 0)
    const reviewPending = remoteSnapshot.value.searchCandidateRows !== null
      ? remoteSnapshot.value.searchCandidateRows
      : Math.max(
          inferredCount,
          localReviewPending,
          remoteSnapshot.value.literatureCandidateRows,
        )
    const reviewedToday = Math.max(countRemoteReviewedToday(mentor), localReviewedToday)

    const remoteDatasetReadyRecords =
      Number(mentor?.latest_ready_dataset?.usable_records || 0)
      || Math.max(0, ...remoteSnapshot.value.datasets.map((item) => Number(item.row_count || 0)))
    const localModelReadyRecords = Math.max(0, files.reduce((sum, file) => sum + (file.records?.length || 0), 0) - localReviewPending)
    const datasetReadyRecords = Math.max(
      remoteDatasetReadyRecords,
      localModelReadyRecords,
      remoteSnapshot.value.literatureReviewableRows,
    )
    const officialDatabaseRecords = remoteSnapshot.value.searchRecordRows !== null
      ? remoteSnapshot.value.searchRecordRows
      : Math.max(
          totalRecords,
          remoteSnapshot.value.literatureRecordRows,
        )

    const remoteTerminalRuns = remoteSnapshot.value.successRuns + remoteSnapshot.value.failedRuns
    const extractionSuccessRate =
      remoteTerminalRuns > 0
        ? remoteSnapshot.value.successRuns / remoteTerminalRuns
        : localTerminalRuns.length > 0
          ? localSuccessRuns / localTerminalRuns.length
          : null

    const evidenceCoverageRate =
      totalRecords > 0
        ? groundedCount / totalRecords
        : getLocalEvidenceCoverageRate(files, latestWorkflow)

    const reviewCompletionRate =
      totalRecords > 0
        ? clampRate(1 - reviewPending / totalRecords)
        : getLocalReviewCompletionRate(files, latestWorkflow)

    const runningRuns = Math.max(remoteSnapshot.value.runningRuns, localRunningRuns, isRunningStatus(activeRun?.status) ? 1 : 0)
    const failedRuns = Math.max(remoteSnapshot.value.failedRuns, localFailedRuns)

    return {
      today: {
        runningRuns,
        failedRuns,
        reviewPending,
        reviewedToday,
      },
      suggestedActions: buildSuggestedActions({
        isChinese: isChinese.value,
        failedRuns,
        runningRuns,
        reviewPending,
        datasetReadyRecords,
        recentRuns: remoteSnapshot.value.recentRuns,
        mentor,
        preferredTrainingDatasetId,
      }),
      recentRuns: remoteSnapshot.value.recentRuns,
      health: {
        extractionSuccessRate: extractionSuccessRate === null ? null : clampRate(extractionSuccessRate),
        evidenceCoverageRate: evidenceCoverageRate === null ? null : clampRate(evidenceCoverageRate),
        reviewCompletionRate: reviewCompletionRate === null ? null : clampRate(reviewCompletionRate),
        datasetReadyRecords,
        officialDatabaseRecords,
      },
    }
  })

  function handleReviewDataChanged() {
    void refresh()
  }

  onMounted(() => {
    void refresh()
    window.addEventListener(REVIEW_DATA_CHANGED_EVENT, handleReviewDataChanged)
    refreshTimer = setInterval(() => {
      void refresh()
    }, HOME_REFRESH_INTERVAL_MS)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(REVIEW_DATA_CHANGED_EVENT, handleReviewDataChanged)
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  })

  return {
    summary,
    loading,
    error,
    refresh,
    hasData: computed(() => {
      const value = summary.value
      return value.recentRuns.length > 0
        || value.today.runningRuns > 0
        || value.today.failedRuns > 0
        || value.today.reviewPending > 0
        || value.today.reviewedToday > 0
        || value.health.officialDatabaseRecords > 0
        || value.health.datasetReadyRecords > 0
    }),
  }
}

function buildSuggestedActions(input: {
  isChinese: boolean
  failedRuns: number
  runningRuns: number
  reviewPending: number
  datasetReadyRecords: number
  recentRuns: HomeRecentRun[]
  mentor: MentorProgressResponse | null
  preferredTrainingDatasetId: number | null
}) {
  const latestProcessedPaper = input.mentor?.quick_links.latest_processed_paper
  const latestDataset = input.mentor?.latest_ready_dataset
  const latestFailedRun = input.recentRuns.find((run) => isFailedStatus(run.status))

  const actions: HomeSuggestedAction[] = [
    {
      id: 'continue-review',
      label: input.isChinese ? '继续审阅最近一篇文献' : 'Continue Reviewing The Latest Paper',
      description: latestProcessedPaper?.detail
        || (input.reviewPending > 0
          ? (input.isChinese ? '优先把最近机器抽取结果推进到人工确认。' : 'Move the latest machine output into human review first.')
          : (input.isChinese ? '打开文献库并检查最近一批抽取结果。' : 'Open the library and inspect the latest extracted records.')),
      actionType: latestProcessedPaper?.literature_id ? 'open_record' : 'route',
      target: latestProcessedPaper?.literature_id ? String(latestProcessedPaper.literature_id) : 'library/explorer',
      priority: input.failedRuns > 0 ? 'medium' : input.reviewPending > 0 ? 'high' : 'medium',
    },
    {
      id: 'retry-failed-run',
      label: input.isChinese ? '重试最近失败运行' : 'Retry The Latest Failed Run',
      description: latestFailedRun
        ? (input.isChinese
          ? `最近失败任务来自《${latestFailedRun.literatureTitle}》。`
          : `The latest failed run came from ${latestFailedRun.literatureTitle}.`)
        : (input.failedRuns > 0
          ? (input.isChinese ? '优先回到 Pipeline 处理失败运行。' : 'Go back to Pipeline and clear the failed run first.')
          : (input.isChinese ? '当前没有失败运行。' : 'There is no failed run right now.')),
      actionType: 'retry_run',
      target: latestFailedRun?.runId || 'library/explorer',
      priority: input.failedRuns > 0 ? 'high' : 'low',
    },
    {
      id: 'open-review-queue',
      label: input.isChinese ? '打开文献库' : 'Open Library',
      description: input.reviewPending > 0
        ? (input.isChinese
          ? `${input.reviewPending} 条记录仍待人工确认。`
          : `${input.reviewPending} records still need human confirmation.`)
        : (input.isChinese ? '当前没有明显的待审积压。' : 'There is no obvious review backlog right now.'),
      actionType: 'route',
      target: 'library/explorer',
      priority: input.reviewPending > 0 ? 'high' : input.runningRuns > 0 ? 'medium' : 'low',
    },
    {
      id: 'open-dataset-builder',
      label: input.isChinese ? '进入数据集构建' : 'Enter Dataset Builder',
      description: input.preferredTrainingDatasetId !== null
        ? (input.isChinese
          ? `继续处理数据集 ${input.preferredTrainingDatasetId}。`
          : `Continue working with dataset ${input.preferredTrainingDatasetId}.`)
        : latestDataset?.name
          ? (input.isChinese
            ? `最近可用数据集为 ${latestDataset.name}。`
            : `The latest ready dataset is ${latestDataset.name}.`)
          : input.datasetReadyRecords > 0
            ? (input.isChinese
              ? `${input.datasetReadyRecords} 条记录已接近可建模状态。`
              : `${input.datasetReadyRecords} records are ready for dataset building.`)
            : (input.isChinese ? '当审阅压力下降后，继续推进数据集构建。' : 'Move into dataset building once review pressure drops.'),
      actionType: 'route',
      target: 'knowledge/datasets',
      priority: input.failedRuns > 0 || input.reviewPending > 0 ? 'medium' : input.datasetReadyRecords > 0 ? 'high' : 'low',
    },
  ]

  return actions.sort((left, right) => actionPriorityWeight(right.priority) - actionPriorityWeight(left.priority))
}

function actionPriorityWeight(priority: HomeActionPriority) {
  switch (priority) {
    case 'high':
      return 3
    case 'medium':
      return 2
    default:
      return 1
  }
}

function literatureCandidateCount(item: any): number {
  const typedCandidates = Number(item?.tribologyCandidateCount ?? 0) + Number(item?.diffusionCandidateCount ?? 0)
  if (typedCandidates > 0) return typedCandidates
  return Number(item?.candidateCount ?? 0)
}

function homeRecordScope(): 'active' | 'all_visible' {
  const role = String(sessionState.user?.role || '').trim().toLowerCase()
  return role === 'principal_investigator' || role === 'group_admin' ? 'all_visible' : 'active'
}

function literatureOfficialRecordCount(item: any): number {
  const typedRecords = Number(item?.tribologyRecordCount ?? 0) + Number(item?.diffusionRecordCount ?? 0)
  if (typedRecords > 0) return typedRecords
  return Number(item?.recordCount ?? 0)
}

function literatureReviewableCount(item: any): number {
  const explicitTotal = Number(item?.totalCount ?? 0)
  if (explicitTotal > 0) return explicitTotal
  const typedTotal =
    Number(item?.tribologyRecordCount ?? 0)
    + Number(item?.tribologyCandidateCount ?? 0)
    + Number(item?.diffusionRecordCount ?? 0)
    + Number(item?.diffusionCandidateCount ?? 0)
  if (typedTotal > 0) return typedTotal
  return Number(item?.recordCount ?? 0) + Number(item?.candidateCount ?? 0)
}

function countLocalReviewPending(files: BatchFile[], workflow: AgentWorkflow | null) {
  const validation = workflow?.validation
  if (validation) {
    const validationCount =
      Number(validation.missing_material_count || 0)
      + Number(validation.missing_lubricant_count || 0)
      + Number(validation.missing_cof_count || 0)
      + Number(validation.duplicate_count || 0)
    return Math.max(validationCount, files.filter((file) => file.hasWarnings).length)
  }
  return files.filter((file) => file.hasWarnings).length
}

function countLocalReviewedToday(files: BatchFile[]) {
  void files
  return 0
}

function countRemoteReviewedToday(mentor: MentorProgressResponse | null) {
  if (!mentor) return 0

  const start = startOfToday()
  const todayEvents = mentor.timeline.filter((item) => {
    const stamp = toTimestamp(item.timestamp)
    const haystack = `${item.kind} ${item.resource_type} ${item.title}`.toLowerCase()
    return stamp >= start && /(review|verify|verified|record)/.test(haystack)
  })

  if (todayEvents.length > 0) {
    return todayEvents.length
  }

  const verifiedStage = mentor.progress_overview.stages.find((item) => item.key === 'verified_records')
  if (verifiedStage?.last_updated_at && toTimestamp(verifiedStage.last_updated_at) >= start) {
    return Math.max(0, Number(verifiedStage.delta_count || 0))
  }

  return 0
}

function getLocalEvidenceCoverageRate(files: BatchFile[], workflow: AgentWorkflow | null) {
  const validation = workflow?.validation
  const recordsTotal = files.reduce((sum, file) => sum + (file.records?.length || 0), 0)
  const missingEvidenceSignals =
    Number(validation?.missing_material_count || 0)
    + Number(validation?.missing_cof_count || 0)

  if (recordsTotal <= 0) return null
  return clampRate(1 - missingEvidenceSignals / recordsTotal)
}

function getLocalReviewCompletionRate(files: BatchFile[], workflow: AgentWorkflow | null) {
  const recordsTotal = files.reduce((sum, file) => sum + (file.records?.length || 0), 0)
  if (recordsTotal <= 0) return null

  return clampRate(1 - countLocalReviewPending(files, workflow) / recordsTotal)
}

function startOfToday() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.getTime()
}

function clampRate(value: number) {
  return Math.max(0, Math.min(1, value))
}

function toTimestamp(value?: string | null) {
  if (!value) return 0
  const stamp = new Date(value).getTime()
  return Number.isFinite(stamp) ? stamp : 0
}

function isRunningStatus(status?: string | null) {
  return RUNNING_STATUSES.has(String(status || '').trim().toLowerCase())
}

function isFailedStatus(status?: string | null) {
  return FAILED_STATUSES.has(String(status || '').trim().toLowerCase())
}

function isSuccessStatus(status?: string | null) {
  return SUCCESS_STATUSES.has(String(status || '').trim().toLowerCase())
}
