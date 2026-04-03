<script setup lang="ts">
import { computed } from 'vue'
import {
  Activity,
  ArrowRight,
  ClipboardList,
  Database,
  Orbit,
  RotateCcw,
  ScanSearch,
  Sparkles,
} from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'
import type { AgentWorkflow, BatchFile, ExtractionRunDetail } from '@/lib/api'

type HealthTone = 'emerald' | 'amber' | 'sky' | 'rose'
type ActivityItem = {
  key: string
  kind: string
  title: string
  detail: string
  tone: HealthTone
}

type HealthItem = {
  key: string
  label: string
  value: string
  progress: number
  tone: HealthTone
  detail: string
}

const props = defineProps<{
  activeScopeLabel: string
  operatorName: string
  files: BatchFile[]
  activeRun: ExtractionRunDetail | null
  latestWorkflow: AgentWorkflow | null
  preferredTrainingDatasetId: number | null
}>()

const emit = defineEmits<{
  'continue-review': []
  'retry-failed-run': []
  'open-review-queue': []
  'open-dataset-builder': []
}>()

const { isChinese } = useI18n()

const filesReversed = computed(() => [...props.files].reverse())
const validationSummary = computed(() => props.latestWorkflow?.validation || null)
const insightSummary = computed(() => props.latestWorkflow?.insight || null)

const failedFiles = computed(() => filesReversed.value.filter((file) => file.status === 'error'))
const processingFiles = computed(() => filesReversed.value.filter((file) => file.status === 'processing'))
const uploadedFiles = computed(() => filesReversed.value.filter((file) => file.status === 'uploaded'))
const successFiles = computed(() => filesReversed.value.filter((file) => file.status === 'success'))

const latestFailedFile = computed(() => failedFiles.value[0] || null)
const latestReviewFile = computed(() => successFiles.value.find((file) => file.hasWarnings) || successFiles.value[0] || null)

const reviewPendingCount = computed(() => {
  const validation = validationSummary.value
  if (validation) {
    return Math.max(
      Number(validation.missing_material_count || 0)
        + Number(validation.missing_lubricant_count || 0)
        + Number(validation.missing_cof_count || 0)
        + Number(validation.duplicate_count || 0),
      props.files.filter((file) => file.hasWarnings).length,
    )
  }
  return props.files.filter((file) => file.hasWarnings).length
})

const modelReadyRecords = computed(() => {
  const totalRecords = props.files.reduce((sum, file) => sum + (file.records?.length || 0), 0)
  return Math.max(0, totalRecords - reviewPendingCount.value)
})

const todayMetrics = computed(() => [
  {
    key: 'pending-literature',
    label: isChinese.value ? '待处理文献数' : 'Pending Literature',
    value: uploadedFiles.value.length + processingFiles.value.length,
    helper: isChinese.value ? '等待进入或完成流水线' : 'Waiting to enter or finish pipeline',
  },
  {
    key: 'running-tasks',
    label: isChinese.value ? '运行中任务数' : 'Running Tasks',
    value: processingFiles.value.length,
    helper: props.activeRun?.summary?.current_message || (isChinese.value ? '当前没有运行中的任务' : 'No active run right now'),
  },
  {
    key: 'pending-review',
    label: isChinese.value ? '待审记录数' : 'Pending Review Records',
    value: reviewPendingCount.value,
    helper: isChinese.value ? '需要人工确认或修订' : 'Requires human confirmation or correction',
  },
  {
    key: 'failed-tasks',
    label: isChinese.value ? '失败任务数' : 'Failed Tasks',
    value: failedFiles.value.length,
    helper: latestFailedFile.value?.errorMessage || (isChinese.value ? '没有待重试的失败运行' : 'No failed run waiting for retry'),
  },
])

const primaryStatus = computed(() => {
  if (failedFiles.value.length > 0) {
    return {
      tone: 'rose',
      badge: isChinese.value ? '需要立即处理' : 'Needs Attention',
      title: isChinese.value ? '平台有失败运行堵在主线上。' : 'Failed runs are blocking the main workflow.',
      body: isChinese.value
        ? `最近失败任务来自 ${latestFailedFile.value?.name || '当前会话'}，建议优先重试，再进入审阅队列。`
        : `The latest failure came from ${latestFailedFile.value?.name || 'this session'}. Retry it first, then clear the review queue.`,
    }
  }

  if (processingFiles.value.length > 0) {
    return {
      tone: 'sky',
      badge: isChinese.value ? '流水线活跃' : 'Pipeline Active',
      title: isChinese.value ? '抽取流水线正在推进，不需要去做图表筛选。' : 'The extraction pipeline is active. You do not need charts first.',
      body: isChinese.value
        ? `当前有 ${processingFiles.value.length} 个运行中的任务，最值得做的是盯住进度并准备接手待审记录。`
        : `${processingFiles.value.length} tasks are currently running. The best next move is to watch progress and prepare for review.`,
    }
  }

  if (reviewPendingCount.value > 0) {
    return {
      tone: 'amber',
      badge: isChinese.value ? '优先审阅' : 'Review First',
      title: isChinese.value ? '现在最值钱的是把机器结果推进成人工确认。' : 'The most valuable work now is turning machine output into reviewed records.',
      body: isChinese.value
        ? `当前有 ${reviewPendingCount.value} 条待审记录，建议直接进入审阅队列，而不是在首页做探索。`
        : `${reviewPendingCount.value} records still need review. Go straight to the queue instead of exploring from Home.`,
    }
  }

  return {
    tone: 'emerald',
    badge: isChinese.value ? '平台稳定' : 'Platform Stable',
    title: isChinese.value ? '平台当前稳定，下一步适合推进数据沉淀和建模。' : 'The platform is stable. This is a good moment to push knowledge and modeling forward.',
    body: isChinese.value
      ? '失败运行和待审压力都不高，可以直接进入数据集构建或继续整理可建模记录。'
      : 'Failure pressure and review debt are low, so this is a good time to continue dataset building and model-ready curation.',
  }
})

const actionCards = computed(() => [
  {
    key: 'continue-review',
    icon: ScanSearch,
    title: isChinese.value ? '继续审阅最近一篇文献' : 'Continue Reviewing The Latest Paper',
    description: latestReviewFile.value
      ? (isChinese.value ? `从 ${latestReviewFile.value.name} 继续接手审阅。` : `Resume review from ${latestReviewFile.value.name}.`)
      : (isChinese.value ? '当前没有已完成抽取的文献，先等待流水线产出。' : 'No extracted literature is ready yet. Let the pipeline finish first.'),
    meta: latestReviewFile.value?.hasWarnings
      ? (isChinese.value ? '有待修正字段' : 'Fields need correction')
      : (isChinese.value ? '可直接进入审阅层' : 'Ready for review'),
    disabled: !latestReviewFile.value,
    action: () => emit('continue-review'),
  },
  {
    key: 'retry-failed',
    icon: RotateCcw,
    title: isChinese.value ? '重试最近失败运行' : 'Retry The Latest Failed Run',
    description: latestFailedFile.value
      ? (isChinese.value ? `失败文件：${latestFailedFile.value.name}` : `Failed file: ${latestFailedFile.value.name}`)
      : (isChinese.value ? '当前没有失败运行。' : 'There is no failed run right now.'),
    meta: latestFailedFile.value?.errorMessage || (isChinese.value ? '流水线目前稳定' : 'Pipeline is stable'),
    disabled: !latestFailedFile.value,
    action: () => emit('retry-failed-run'),
  },
  {
    key: 'review-queue',
    icon: ClipboardList,
    title: isChinese.value ? '打开待审队列' : 'Open Review Queue',
    description: isChinese.value
      ? '直接进入需要人工判断的记录，不在首页做筛选与探索。'
      : 'Jump straight into records that need human judgment instead of filtering from Home.',
    meta: isChinese.value ? `${reviewPendingCount.value} 条待审` : `${reviewPendingCount.value} waiting`,
    disabled: false,
    action: () => emit('open-review-queue'),
  },
  {
    key: 'dataset-builder',
    icon: Database,
    title: isChinese.value ? '进入数据集构建' : 'Enter Dataset Builder',
    description: isChinese.value
      ? '把已沉淀的数据推进到清洗与数据集构建，而不是继续堆叠首页内容。'
      : 'Move cleaned records into dataset building instead of expanding the Home surface.',
    meta: props.preferredTrainingDatasetId !== null
      ? (isChinese.value ? `已接力数据集 ${props.preferredTrainingDatasetId}` : `Dataset ${props.preferredTrainingDatasetId} ready`)
      : (isChinese.value ? `${modelReadyRecords.value} 条可建模记录` : `${modelReadyRecords.value} model-ready records`),
    disabled: false,
    action: () => emit('open-dataset-builder'),
  },
])

const recentActivity = computed<ActivityItem[]>(() => {
  const extractionItem = props.activeRun
    ? {
        key: 'extraction',
        kind: isChinese.value ? '抽取运行' : 'Extraction',
        title: props.activeRun.summary?.current_message || props.activeRun.status || (isChinese.value ? '运行状态已更新' : 'Run updated'),
        detail: props.activeRun.updated_at || (isChinese.value ? '当前会话' : 'Current session'),
        tone: 'sky' as HealthTone,
      }
    : {
        key: 'extraction',
        kind: isChinese.value ? '抽取运行' : 'Extraction',
        title: latestFailedFile.value
          ? (isChinese.value ? `失败：${latestFailedFile.value.name}` : `Failed: ${latestFailedFile.value.name}`)
          : (isChinese.value ? '当前会话还没有新的抽取运行' : 'No new extraction run in this session'),
        detail: latestFailedFile.value?.errorMessage || (isChinese.value ? '等待新的文献进入流水线' : 'Waiting for the next document to enter the pipeline'),
        tone: (latestFailedFile.value ? 'rose' : 'sky') as HealthTone,
      }

  const reviewItem = validationSummary.value
    ? {
        key: 'review',
        kind: isChinese.value ? '审阅动作' : 'Review',
        title: isChinese.value
          ? `待修正 ${reviewPendingCount.value} 条记录`
          : `${reviewPendingCount.value} records still need correction`,
        detail: isChinese.value
          ? `最近校验产出 ${validationSummary.value.record_count ?? 0} 条记录`
          : `Latest validation touched ${validationSummary.value.record_count ?? 0} records`,
        tone: (reviewPendingCount.value > 0 ? 'amber' : 'emerald') as HealthTone,
      }
    : {
        key: 'review',
        kind: isChinese.value ? '审阅动作' : 'Review',
        title: isChinese.value ? '当前会话还没有新的审阅动作' : 'No review action captured in this session',
        detail: isChinese.value ? '下一步适合从 Suggested Actions 直接进入 Review。' : 'Use Suggested Actions to move into Review directly.',
        tone: 'amber' as HealthTone,
      }

  const modelingItem = props.preferredTrainingDatasetId !== null || insightSummary.value
    ? {
        key: 'modeling',
        kind: isChinese.value ? '训练 / 导出' : 'Training / Export',
        title: props.preferredTrainingDatasetId !== null
          ? (isChinese.value ? `数据集 ${props.preferredTrainingDatasetId} 已接力到建模层` : `Dataset ${props.preferredTrainingDatasetId} is handed off to Modeling`)
          : (isChinese.value ? `最近洞察：${insightSummary.value?.title || '已生成摘要'}` : `Latest insight: ${insightSummary.value?.title || 'summary generated'}`),
        detail: isChinese.value ? `${modelReadyRecords.value} 条记录可用于下一步建模` : `${modelReadyRecords.value} records are ready for the next modeling step`,
        tone: 'emerald' as HealthTone,
      }
    : {
        key: 'modeling',
        kind: isChinese.value ? '训练 / 导出' : 'Training / Export',
        title: isChinese.value ? '当前会话还没有导出或训练动作' : 'No export or training action in this session',
        detail: isChinese.value ? '当审阅压力下降后，适合直接进入数据集构建。' : 'When review pressure drops, move straight into dataset building.',
        tone: 'emerald' as HealthTone,
      }

  return [extractionItem, reviewItem, modelingItem]
})

const healthSnapshot = computed<HealthItem[]>(() => {
  const terminalCount = successFiles.value.length + failedFiles.value.length
  const successRate = terminalCount > 0 ? successFiles.value.length / terminalCount : 1

  const validation = validationSummary.value
  const recordCount = Number(validation?.record_count || props.files.reduce((sum, file) => sum + (file.records?.length || 0), 0))
  const missingEvidenceSignals = Number(validation?.missing_material_count || 0) + Number(validation?.missing_cof_count || 0)
  const evidenceCompleteness = recordCount > 0 ? Math.max(0, 1 - missingEvidenceSignals / recordCount) : 1
  const reviewCompletion = recordCount > 0 ? Math.max(0, 1 - reviewPendingCount.value / recordCount) : 1

  const recordsTotal = props.files.reduce((sum, file) => sum + (file.records?.length || 0), 0)

  return [
    {
      key: 'success-rate',
      label: isChinese.value ? '抽取成功率' : 'Extraction Success Rate',
      value: formatPercent(successRate),
      progress: successRate,
      tone: (successRate < 0.7 ? 'rose' : successRate < 0.9 ? 'amber' : 'emerald') as HealthTone,
      detail: isChinese.value ? `${successFiles.value.length} 成功 / ${failedFiles.value.length} 失败` : `${successFiles.value.length} succeeded / ${failedFiles.value.length} failed`,
    },
    {
      key: 'evidence-completeness',
      label: isChinese.value ? 'Evidence 完整率' : 'Evidence Completeness',
      value: formatPercent(evidenceCompleteness),
      progress: evidenceCompleteness,
      tone: (evidenceCompleteness < 0.7 ? 'rose' : evidenceCompleteness < 0.9 ? 'amber' : 'sky') as HealthTone,
      detail: isChinese.value ? '基于当前校验缺口估算' : 'Estimated from current validation gaps',
    },
    {
      key: 'review-completion',
      label: isChinese.value ? '审阅完成率' : 'Review Completion',
      value: formatPercent(reviewCompletion),
      progress: reviewCompletion,
      tone: (reviewCompletion < 0.6 ? 'rose' : reviewCompletion < 0.85 ? 'amber' : 'emerald') as HealthTone,
      detail: isChinese.value ? `${reviewPendingCount.value} 条仍待人工处理` : `${reviewPendingCount.value} still need human work`,
    },
    {
      key: 'model-ready',
      label: isChinese.value ? '可建模记录数' : 'Model-Ready Records',
      value: String(modelReadyRecords.value),
      progress: recordsTotal > 0 ? modelReadyRecords.value / recordsTotal : 0,
      tone: (modelReadyRecords.value === 0 ? 'amber' : 'emerald') as HealthTone,
      detail: isChinese.value ? `总记录 ${recordsTotal} 条` : `${recordsTotal} total extracted records`,
    },
  ]
})

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function toneClasses(tone: HealthTone) {
  switch (tone) {
    case 'rose':
      return {
        chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
        border: 'border-rose-200/70 dark:border-rose-500/20',
        meter: 'from-rose-500 to-orange-400',
      }
    case 'amber':
      return {
        chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200',
        border: 'border-amber-200/70 dark:border-amber-500/20',
        meter: 'from-amber-400 to-[#f4d18f]',
      }
    case 'sky':
      return {
        chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
        border: 'border-sky-200/70 dark:border-sky-500/20',
        meter: 'from-sky-500 to-cyan-300',
      }
    default:
      return {
        chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
        border: 'border-emerald-200/70 dark:border-emerald-500/20',
        meter: 'from-emerald-500 to-lime-300',
      }
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <section class="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#1f2f78_0%,#2e3fa4_48%,#4153cb_100%)] px-6 py-6 text-white shadow-[0_30px_80px_-40px_rgba(28,42,120,0.7)] sm:px-8 sm:py-8">
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(119,223,255,0.14),transparent_28%)]" />
      <div class="absolute -right-10 top-6 h-56 w-56 rounded-full border border-white/10 bg-white/5 blur-2xl" />
      <div class="absolute bottom-0 right-8 hidden translate-y-1/4 text-[14rem] font-black leading-none text-white/6 lg:block">AI</div>

      <div class="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_22rem] lg:items-start">
        <div>
          <div class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/82">
            <Orbit class="h-3.5 w-3.5" />
            {{ isChinese ? '平台指挥台' : 'Platform Command Center' }}
          </div>
          <h1 class="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.05em] sm:text-[3.25rem]">
            {{ isChinese ? '现在平台状态怎么样，下一步该去哪里。' : 'Know platform status now, then move directly to the next step.' }}
          </h1>
          <p class="mt-4 max-w-3xl text-base leading-8 text-white/78">
            {{ primaryStatus.body }}
          </p>

          <div class="mt-6 flex flex-wrap gap-3">
            <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white">
              <Sparkles class="h-4 w-4" />
              {{ primaryStatus.badge }}
            </span>
            <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-sm text-white/78">
              {{ activeScopeLabel }}
            </span>
            <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-sm text-white/78">
              {{ operatorName }}
            </span>
          </div>
        </div>

        <div class="rounded-[1.8rem] border border-white/12 bg-white/10 p-5 backdrop-blur-xl">
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/62">
            {{ isChinese ? '当前判断' : 'Current Reading' }}
          </p>
          <h2 class="mt-4 text-2xl font-semibold leading-tight text-white">
            {{ primaryStatus.title }}
          </h2>
          <div class="mt-6 space-y-3">
            <div
              v-for="metric in todayMetrics"
              :key="metric.key"
              class="flex items-center justify-between rounded-[1.3rem] border border-white/10 bg-black/10 px-4 py-3"
            >
              <div class="min-w-0 pr-4">
                <p class="text-sm font-semibold text-white">{{ metric.label }}</p>
                <p class="mt-1 text-xs leading-5 text-white/60">{{ metric.helper }}</p>
              </div>
              <div class="text-right text-3xl font-semibold tracking-[-0.04em] text-white">
                {{ metric.value }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_23rem]">
      <div class="grid min-h-0 gap-4">
        <section class="shell-surface px-5 py-5 sm:px-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
                {{ isChinese ? 'Today' : 'Today' }}
              </p>
              <h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {{ isChinese ? '先判断平台压力，再决定往哪里走。' : 'Read pressure first, then decide where to go.' }}
              </h2>
            </div>
            <div class="hidden items-center gap-2 rounded-full border border-black/8 bg-white/70 px-4 py-2 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 md:inline-flex">
              <Activity class="h-4 w-4 text-[#4153cb]" />
              {{ isChinese ? 'Home 只保留摘要与动作' : 'Home keeps only summary and action' }}
            </div>
          </div>

          <div class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article
              v-for="metric in todayMetrics"
              :key="metric.key"
              class="rounded-[1.6rem] border border-black/8 bg-white/68 px-4 py-4 shadow-[0_18px_42px_-30px_rgba(15,23,42,0.25)] dark:border-white/10 dark:bg-white/5"
            >
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ metric.label }}</p>
              <p class="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white">{{ metric.value }}</p>
              <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{{ metric.helper }}</p>
            </article>
          </div>
        </section>

        <section class="shell-surface px-5 py-5 sm:px-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
                {{ isChinese ? 'Suggested Actions' : 'Suggested Actions' }}
              </p>
              <h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
                {{ isChinese ? '首页最重要的是直接给出下一步。' : 'The job of Home is to tell you what to do next.' }}
              </h2>
            </div>
          </div>

          <div class="mt-6 grid gap-3 lg:grid-cols-2">
            <button
              v-for="action in actionCards"
              :key="action.key"
              type="button"
              class="group rounded-[1.75rem] border px-5 py-5 text-left transition"
              :class="action.disabled
                ? 'cursor-not-allowed border-black/8 bg-slate-100/80 opacity-70 dark:border-white/10 dark:bg-white/5'
                : 'border-black/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(244,247,255,0.86))] hover:-translate-y-0.5 hover:border-[#4153cb]/25 hover:shadow-[0_24px_54px_-34px_rgba(65,83,203,0.45)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(65,83,203,0.14))]'"
              :disabled="action.disabled"
              @click="action.action"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3">
                  <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#101b29] text-[#f4d18f] transition group-hover:bg-[#22338b] dark:bg-[#f4d18f] dark:text-[#111827] dark:group-hover:bg-white dark:group-hover:text-[#22338b]">
                    <component :is="action.icon" class="h-5 w-5" />
                  </div>
                  <div>
                    <h3 class="text-lg font-semibold text-slate-950 dark:text-white">{{ action.title }}</h3>
                    <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{{ action.description }}</p>
                  </div>
                </div>
                <ArrowRight class="mt-1 h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#4153cb] dark:text-slate-600 dark:group-hover:text-[#f4d18f]" />
              </div>
              <div class="mt-4 inline-flex max-w-full rounded-full border border-black/8 bg-white/72 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/8 dark:text-slate-300">
                <span class="truncate">{{ action.meta }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>

      <div class="grid min-h-0 gap-4">
        <section class="shell-surface px-5 py-5 sm:px-6">
          <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
            {{ isChinese ? 'Recent Activity' : 'Recent Activity' }}
          </p>
          <h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            {{ isChinese ? '最近发生了什么。' : 'What happened most recently.' }}
          </h2>

          <div class="mt-6 space-y-3">
            <article
              v-for="item in recentActivity"
              :key="item.key"
              class="rounded-[1.5rem] border bg-white/68 px-4 py-4 dark:bg-white/5"
              :class="toneClasses(item.tone).border"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ item.kind }}</p>
                  <h3 class="mt-2 text-base font-semibold leading-7 text-slate-950 dark:text-white">{{ item.title }}</h3>
                  <p class="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{{ item.detail }}</p>
                </div>
                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="toneClasses(item.tone).chip">
                  {{ item.kind }}
                </span>
              </div>
            </article>
          </div>
        </section>

        <section class="shell-surface px-5 py-5 sm:px-6">
          <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
            {{ isChinese ? 'Health Snapshot' : 'Health Snapshot' }}
          </p>
          <h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
            {{ isChinese ? '平台健康度只保留关键四项。' : 'Keep health to the four metrics that matter.' }}
          </h2>

          <div class="mt-6 space-y-4">
            <article
              v-for="item in healthSnapshot"
              :key="item.key"
              class="rounded-[1.5rem] border border-black/8 bg-white/68 px-4 py-4 dark:border-white/10 dark:bg-white/5"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-slate-950 dark:text-white">{{ item.label }}</p>
                  <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{{ item.detail }}</p>
                </div>
                <div class="text-right">
                  <p class="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">{{ item.value }}</p>
                </div>
              </div>
              <div class="mt-4 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
                <div
                  class="h-full rounded-full bg-gradient-to-r transition-[width] duration-500"
                  :class="toneClasses(item.tone).meter"
                  :style="{ width: `${Math.max(8, Math.round(item.progress * 100))}%` }"
                />
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
