<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  FileSearch,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-vue-next'

import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import {
  getAgentStatus,
  getUsageMetrics,
  type AgentMessage,
  type AgentStatusItem,
  type AgentWorkflow,
  type ExtractionRunDetail,
  type UsageMetricsResponse,
} from '@/lib/api'

const props = defineProps<{
  workflow?: AgentWorkflow | null
  activeRun?: ExtractionRunDetail | null
  activeFileName?: string | null
}>()

const loading = ref(true)
const errorMessage = ref('')
const statusItems = ref<AgentStatusItem[]>([])
const recentMessages = ref<AgentMessage[]>([])
const usageMetrics = ref<UsageMetricsResponse | null>(null)
const lastUpdated = ref<string | null>(null)

let refreshTimer: ReturnType<typeof setInterval> | null = null

const handledTotal = computed(() => statusItems.value.reduce((sum, item) => sum + (item.handled_tasks || 0), 0))
const behaviorTotals = computed(() => usageMetrics.value?.totals || { agent_calls: 0, db_queries: 0, api_calls: 0 })
const topDbOperations = computed(() =>
  Object.entries(usageMetrics.value?.db_queries_by_operation || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4),
)
const topAgentTasks = computed(() =>
  Object.entries(usageMetrics.value?.agent_calls_by_task || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4),
)
const workflowMessages = computed(() => props.workflow?.messages || [])
const validationSummary = computed(() => props.workflow?.validation || null)
const insightSummary = computed(() => props.workflow?.insight || null)

const liveRun = computed(() => props.activeRun || null)
const runSummary = computed(() => liveRun.value?.summary || {})
const runProgressLog = computed(() => liveRun.value?.progress_log || [])
const timelineItems = computed(() => runProgressLog.value.slice(-6).reverse())
const visibleMessages = computed(() => {
  const source = workflowMessages.value.length ? workflowMessages.value : recentMessages.value
  return source.slice(-4).reverse()
})

const runSnapshot = computed(() => {
  const lastEntry = runProgressLog.value[runProgressLog.value.length - 1]
  const stage = String(runSummary.value.current_stage || lastEntry?.stage || '')
  const message = String(runSummary.value.current_message || lastEntry?.message || '')
  const status = String(liveRun.value?.status || '')
  let progress = mapStageToProgress(stage, status)

  if ((liveRun.value?.candidate_count || 0) > 0 && progress < 48) {
    progress = 48
  }
  if ((liveRun.value?.final_count || 0) > 0 && progress < 94 && !isTerminalStatus(status)) {
    progress = 94
  }

  return {
    stage,
    status,
    message: message || formatStageLabel(stage),
    progress,
  }
})

const activeAgentName = computed(() => {
  const stage = runSnapshot.value.stage.toLowerCase()
  if (!stage) return 'moderator'
  if (stage.startsWith('stage_a') || stage.startsWith('stage_b') || stage.startsWith('stage_c') || stage.startsWith('fallback_table')) {
    return 'media'
  }
  if (stage.startsWith('stage_d')) return 'query'
  if (stage.startsWith('stage_e')) return 'insight'
  return 'moderator'
})

const extractionSteps = computed(() => {
  const progress = runSnapshot.value.progress
  const failed = ['failed', 'error', 'cancelled'].includes(runSnapshot.value.status)

  return [
    buildStepState('Coordinator', 'Route document and assign agents', progress, 0, 24, failed),
    buildStepState('Media', 'Read PDF, tables, and figure candidates', progress, 24, 82, failed),
    buildStepState('Query', 'Validate tribology candidates', progress, 82, 94, failed),
    buildStepState('Insight', 'Finalize records and publish summary', progress, 94, 100, failed),
  ]
})

const agentCards = computed(() => {
  const progress = runSnapshot.value.progress
  const failed = ['failed', 'error', 'cancelled'].includes(runSnapshot.value.status)

  return statusItems.value.map((agent) => ({
    ...agent,
    state: resolveAgentState(agent.name, progress, activeAgentName.value, failed, runSnapshot.value.status),
  }))
})

async function fetchAgentStatus() {
  try {
    const [payload, usagePayload] = await Promise.all([
      getAgentStatus(),
      getUsageMetrics().catch(() => null),
    ])
    statusItems.value = payload.agents || []
    recentMessages.value = payload.recent_messages || []
    if (usagePayload) {
      usageMetrics.value = usagePayload
    }
    lastUpdated.value = new Date().toLocaleTimeString()
    errorMessage.value = ''
  } catch (error: any) {
    errorMessage.value = error?.message || 'Failed to load agent status'
  } finally {
    loading.value = false
  }
}

function isTerminalStatus(status?: string | null): boolean {
  return ['completed', 'failed', 'error', 'cancelled'].includes(String(status || '').toLowerCase())
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

function buildStepState(
  label: string,
  description: string,
  progress: number,
  start: number,
  complete: number,
  failed: boolean,
) {
  let state: 'waiting' | 'active' | 'complete' | 'error' = 'waiting'
  if (failed && progress >= start) {
    state = 'error'
  } else if (progress >= complete) {
    state = 'complete'
  } else if (progress >= start) {
    state = 'active'
  }

  return { label, description, state }
}

function resolveAgentState(
  agentName: string,
  progress: number,
  activeName: string,
  failed: boolean,
  runStatus: string,
) {
  if (!runStatus) return 'idle'
  if (failed && agentName === activeName) return 'error'
  if (runStatus === 'completed') return 'complete'
  if (agentName === activeName) return 'active'
  if (agentName === 'moderator' && progress >= 24) return 'complete'
  if (agentName === 'media' && progress >= 82) return 'complete'
  if (agentName === 'query' && progress >= 94) return 'complete'
  return 'waiting'
}

function agentTone(name: string): string {
  const tones: Record<string, string> = {
    moderator: 'from-sky-500 to-cyan-400',
    media: 'from-emerald-500 to-teal-400',
    query: 'from-amber-500 to-orange-400',
    insight: 'from-indigo-500 to-violet-400',
  }
  return tones[name] || 'from-slate-500 to-slate-400'
}

function stateTone(state: string): string {
  if (state === 'complete') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (state === 'active') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
  if (state === 'error') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
  return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
}

function progressTone(status: string): string {
  if (status === 'completed') return 'from-emerald-500 to-teal-400'
  if (status === 'failed' || status === 'error') return 'from-rose-500 to-orange-400'
  if (status === 'cancelled') return 'from-amber-500 to-orange-400'
  return 'from-blue-500 to-cyan-400'
}

function formatRunStatus(status?: string | null): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return 'Idle'
  if (normalized === 'cancelled') return 'Stopped'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function formatTaskName(value: string | null | undefined): string {
  if (!value) return 'idle'
  return value.replace(/_/g, ' ')
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString()
}

function formatMessage(message: AgentMessage): string {
  return `${message.sender} -> ${message.receiver}`
}

function describeProgressItem(item: { stage: string, message: string, page?: number }) {
  const base = item.message || formatStageLabel(item.stage)
  return item.page ? `${base} (page ${item.page})` : base
}

onMounted(() => {
  fetchAgentStatus()
  refreshTimer = setInterval(fetchAgentStatus, 5000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<template>
  <Card class="h-full rounded-none border-0 bg-gradient-to-b from-slate-50 to-white shadow-none dark:from-[#091321] dark:to-slate-950">
    <CardHeader class="border-b border-slate-200/80 px-4 py-3 dark:border-slate-800/80">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            <Activity class="h-3.5 w-3.5" />
            Agent Runtime
          </div>
          <CardTitle class="text-base font-semibold text-slate-900 dark:text-slate-100">Coordination Panel</CardTitle>
        </div>
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
          :disabled="loading"
          @click="fetchAgentStatus"
        >
          <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        </button>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        Last updated: {{ lastUpdated || '--' }}
      </p>
    </CardHeader>

    <CardContent class="h-[calc(100%-84px)] overflow-y-auto p-3">
      <div class="space-y-3">
        <div v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {{ errorMessage }}
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Agents</div>
            <div class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{{ statusItems.length }}</div>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Handled</div>
            <div class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{{ handledTotal }}</div>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Warnings</div>
            <div class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{{ validationSummary?.warnings?.length || 0 }}</div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Database class="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Backend Usage Metrics
            </div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              runtime
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Agent Calls</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{{ behaviorTotals.agent_calls }}</div>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">DB Queries</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{{ behaviorTotals.db_queries }}</div>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">API Calls</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{{ behaviorTotals.api_calls }}</div>
            </div>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/70">
              <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Top DB Ops</div>
              <div v-if="topDbOperations.length" class="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div v-for="[name, count] in topDbOperations" :key="`db-${name}`" class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ name }}</span>
                  <span class="font-semibold text-slate-900 dark:text-slate-100">{{ count }}</span>
                </div>
              </div>
              <div v-else class="text-[11px] text-slate-400 dark:text-slate-500">No DB metrics yet</div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/70">
              <div class="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Top Agent Tasks</div>
              <div v-if="topAgentTasks.length" class="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                <div v-for="[name, count] in topAgentTasks" :key="`agent-${name}`" class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ name }}</span>
                  <span class="font-semibold text-slate-900 dark:text-slate-100">{{ count }}</span>
                </div>
              </div>
              <div v-else class="text-[11px] text-slate-400 dark:text-slate-500">No agent metrics yet</div>
            </div>
          </div>
        </div>

        <div
          v-if="liveRun"
          class="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Live Extraction</div>
              <div class="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {{ activeFileName || `Literature #${liveRun.literature_id}` }}
              </div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ runSnapshot.message }}
              </div>
            </div>
            <div
              class="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              :class="stateTone(runSnapshot.status === 'completed' ? 'complete' : ['failed', 'error', 'cancelled'].includes(runSnapshot.status) ? 'error' : 'active')"
            >
              {{ formatRunStatus(runSnapshot.status) }}
            </div>
          </div>

          <div class="mt-3">
            <div class="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>{{ formatStageLabel(runSnapshot.stage) }}</span>
              <span>{{ runSnapshot.progress }}%</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                class="h-full rounded-full bg-gradient-to-r transition-all duration-300"
                :class="progressTone(runSnapshot.status)"
                :style="{ width: `${runSnapshot.progress}%` }"
              />
            </div>
          </div>

          <div class="mt-3 grid grid-cols-3 gap-2">
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Candidates</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{{ liveRun.candidate_count }}</div>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Records</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{{ liveRun.final_count }}</div>
            </div>
            <div class="rounded-2xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
              <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Run</div>
              <div class="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{{ liveRun.run_id.slice(0, 8) }}</div>
            </div>
          </div>
        </div>

        <div v-if="liveRun" class="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
            <FileSearch class="h-4 w-4 text-blue-500" />
            Extraction Flow
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="step in extractionSteps"
              :key="step.label"
              class="rounded-2xl border px-3 py-2"
              :class="stateTone(step.state)"
            >
              <div class="text-xs font-semibold">{{ step.label }}</div>
              <div class="mt-1 text-[11px] opacity-80">{{ step.description }}</div>
            </div>
          </div>
        </div>

        <div class="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Bot class="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Agent Loadout
            </div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {{ activeAgentName }}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="agent in agentCards"
              :key="agent.name"
              class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/70"
            >
              <div class="mb-2 flex items-center gap-2">
                <div
                  class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm"
                  :class="agentTone(agent.name)"
                >
                  <Bot class="h-4.5 w-4.5" />
                </div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold capitalize text-slate-900 dark:text-slate-100">{{ agent.name }}</div>
                  <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ agent.capabilities.length }} capabilities</div>
                </div>
              </div>
              <div class="mb-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="stateTone(agent.state)">
                {{ agent.state }}
              </div>
              <div class="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                <div class="flex items-center justify-between">
                  <span>Handled</span>
                  <span class="font-semibold text-slate-900 dark:text-slate-100">{{ agent.handled_tasks }}</span>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <span>Task</span>
                  <span class="max-w-[92px] truncate text-right font-medium text-slate-700 dark:text-slate-300">{{ formatTaskName(agent.last_task_type) }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span>Seen</span>
                  <span class="font-medium text-slate-700 dark:text-slate-300">{{ formatTimestamp(agent.last_task_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="validationSummary || insightSummary" class="grid grid-cols-1 gap-2">
          <div v-if="validationSummary" class="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <ShieldCheck class="h-4 w-4" />
              Validation
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-emerald-900/80 dark:text-emerald-200/85">
              <div>Records: {{ validationSummary.record_count ?? '--' }}</div>
              <div>Duplicates: {{ validationSummary.duplicate_count ?? '--' }}</div>
              <div>Missing material: {{ validationSummary.missing_material_count ?? '--' }}</div>
              <div>Missing COF: {{ validationSummary.missing_cof_count ?? '--' }}</div>
            </div>
          </div>

          <div v-if="insightSummary" class="rounded-2xl border border-sky-200 bg-sky-50/80 px-3 py-2 dark:border-sky-500/30 dark:bg-sky-500/10">
            <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-300">
              <Sparkles class="h-4 w-4" />
              Workflow Insight
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-sky-900/80 dark:text-sky-200/85">
              <div class="col-span-2 truncate">Title: {{ insightSummary.title || '--' }}</div>
              <div>Records: {{ insightSummary.record_count ?? '--' }}</div>
              <div>Top material: {{ insightSummary.top_materials?.[0]?.name || '--' }}</div>
            </div>
          </div>
        </div>

        <div v-if="timelineItems.length" class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div class="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Clock3 class="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Extraction Timeline
            </div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {{ timelineItems.length }} events
            </div>
          </div>
          <div class="space-y-2 px-3 py-2">
            <div
              v-for="item in timelineItems"
              :key="`${item.stage}-${item.message}-${item.page || 0}`"
              class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/70"
            >
              <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-200">{{ formatStageLabel(item.stage) }}</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-400">{{ describeProgressItem(item) }}</div>
            </div>
          </div>
        </div>

        <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
          <div class="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Database class="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Agent Messages
            </div>
            <div class="text-[10px] uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
              {{ workflowMessages.length ? 'workflow' : 'runtime' }}
            </div>
          </div>
          <div class="px-3 py-2">
            <div v-if="visibleMessages.length" class="space-y-2">
              <div
                v-for="message in visibleMessages"
                :key="`${message.task_id}-${message.timestamp}-${message.message_type}`"
                class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/70"
              >
                <div class="mb-1 flex items-center justify-between gap-2">
                  <div class="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-200">{{ formatMessage(message) }}</div>
                  <div class="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{{ formatTimestamp(message.timestamp) }}</div>
                </div>
                <div class="text-[11px] text-slate-600 dark:text-slate-400">{{ formatTaskName(message.message_type) }}</div>
              </div>
            </div>
            <div v-else class="flex items-center justify-center rounded-xl border border-dashed border-slate-200 px-3 py-6 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
              No agent messages yet
            </div>
          </div>
        </div>

        <div
          v-if="liveRun?.error_message"
          class="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <div class="flex items-center gap-2 font-semibold">
            <CircleAlert class="h-4 w-4" />
            Extraction run reported an error
          </div>
          <div class="mt-1">{{ liveRun.error_message }}</div>
        </div>

        <div
          v-if="liveRun?.status === 'completed' && !liveRun.final_count"
          class="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <div class="flex items-center gap-2 font-semibold">
            <CheckCircle2 class="h-4 w-4" />
            Run finished without extracted records
          </div>
          <div class="mt-1">The document completed processing, but no usable tribology rows were produced.</div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
