<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Activity, RefreshCw, Cpu, Database as DbIcon, ShieldCheck, CheckCircle2, Clock, Server, Users } from 'lucide-vue-next'
import {
  Chart as ChartJS, Title, Tooltip, Legend, BarElement,
  CategoryScale, LinearScale, PointElement, LineElement, Filler
} from 'chart.js'
import { Bar } from 'vue-chartjs'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler
)

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Modal from '@/components/ui/Modal.vue'
import LiteratureSourceMonitor from '@/components/monitor/LiteratureSourceMonitor.vue'
import LlmRuntimeMonitor from '@/components/monitor/LlmRuntimeMonitor.vue'
import UserManagement from '@/components/monitor/UserManagement.vue'
import {
  getUsageMetrics,
  type AgentWorkflow,
  type ExtractionRunDetail,
  type UsageMetricsResponse,
  type UsageMetricEvent
} from '@/lib/api'

defineProps<{
  workflow?: AgentWorkflow | null
  activeRun?: ExtractionRunDetail | null
  activeFileName?: string | null
}>()

// Tab state
const activeTab = ref<'literature' | 'llm' | 'system' | 'users'>('literature')

const usageMetrics = ref<UsageMetricsResponse | null>(null)
const usageLoading = ref(false)
const usageError = ref('')
const behaviorModalOpen = ref(false)

const usageTotals = computed(() => usageMetrics.value?.totals || { agent_calls: 0, db_queries: 0, api_calls: 0 })
const topAgentTasks = computed(() =>
  Object.entries(usageMetrics.value?.agent_calls_by_task || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8),
)
const topDbOperations = computed(() =>
  Object.entries(usageMetrics.value?.db_queries_by_operation || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8),
)
const recentBehaviorEvents = computed(() => (usageMetrics.value?.recent_events || []).slice(-15).reverse())

// Map basic agent tasks and database queries to readable forms
function readableTaskName(value: string): string {
  const labels: Record<string, string> = {
    orchestrate_search: 'Search orchestration',
    orchestrate_stats: 'Stats orchestration',
    orchestrate_filter_options: 'Filter options orchestration',
    orchestrate_extraction: 'Extraction orchestration',
    orchestrate_reprocess: 'Reprocess orchestration',
    search_records: 'Search records',
    get_stats: 'Load overview stats',
    get_filter_options: 'Load filter options',
  }
  return labels[value] || value.replace(/_/g, ' ')
}

function readableDbOperation(value: string): string {
  const labels: Record<string, string> = {
    'search_records.load_filtered': 'Search records',
    'search_records.count': 'Records count',
    'search_records.page': 'Records page query',
    'filter_options.materials': 'Filter (materials)',
    'filter_options.lubricants': 'Filter (ionic liquids)',
    'confidence_buckets.records': 'Confidence breakdown',
    'top_entities.materials': 'Top (materials)',
    'top_entities.liquids': 'Top (ionic liquids)',
  }
  return labels[value] || value.replace(/\./g, ' > ').replace(/_/g, ' ')
}

function readableEvent(event: UsageMetricEvent) {
  if (event.category === 'agent') return `${readableTaskName(event.action)}`
  if (event.category === 'database') return `${readableDbOperation(event.action)}`
  if (event.category === 'api') return `API: ${event.action}`
  return `${event.category}: ${event.action}`
}

function readableEventDetail(event: UsageMetricEvent): string {
  const detail = event.detail || {}
  if (event.category === 'agent') {
    const receiver = String(detail.receiver || 'unknown')
    const sender = String(detail.sender || 'unknown')
    return `${sender} -> ${receiver}`
  }
  if (event.category === 'database') {
    const count = Number(detail.count || 1)
    return `${count} query${count > 1 ? 'ies' : ''}`
  }
  return ''
}

// Map events to the Activity Stream UI visual presentation
const streamItems = computed(() => {
  return recentBehaviorEvents.value.map((event) => {
    let title = readableEvent(event)
    let secondary = ''
    let status = 'RECORDED'
    let duration = '--'
    let icon = Activity
    let iconBg = 'bg-blue-100 text-blue-500'
    let statusColor = 'text-sky-700 bg-sky-50'

    if (event.category === 'agent') {
      title = 'Agent Task'
      secondary = readableTaskName(event.action)
      icon = Cpu
      iconBg = 'bg-emerald-100 text-emerald-500'
      statusColor = 'text-emerald-700 bg-emerald-50'
    } else if (event.category === 'database') {
      title = 'Database Query'
      secondary = readableDbOperation(event.action)
      icon = DbIcon
      iconBg = 'bg-slate-100 text-slate-500'
      statusColor = 'text-slate-700 bg-slate-100'
      const count = Number(event.detail?.count || 0)
      if (count > 0) duration = `${count} row${count > 1 ? 's' : ''}`
    } else if (event.category === 'api') {
      title = 'API Call'
      secondary = event.action
      icon = Server
      iconBg = 'bg-indigo-100 text-indigo-500'
      statusColor = 'text-indigo-700 bg-indigo-50'
    }

    const detailText = readableEventDetail(event)
    const identifier = detailText || 'runtime event'

    return {
      title,
      secondary,
      status,
      duration,
      timeAgo: getRelativeTime(event.timestamp),
      identifier,
      icon,
      iconBg,
      statusColor,
    }
  })
})

const trafficData = computed(() => {
  return {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        type: 'bar' as const,
        label: 'Agent Calls',
        data: [150, 180, 120, 310, 240, 80, 90],
        backgroundColor: '#f43f5e',
        borderRadius: 4,
        barPercentage: 0.4,
      },
      {
        type: 'bar' as const,
        label: 'DB Queries',
        data: [180, 210, 140, 310, 200, 80, 90],
        backgroundColor: (context: any) => {
            const chart = context.chart
            const {ctx, chartArea} = chart
            if (!chartArea) return '#93c5fd'
            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top)
            gradient.addColorStop(0, '#93c5fd')
            gradient.addColorStop(1, '#60a5fa')
            return gradient
        },
        borderRadius: 4,
        barPercentage: 0.4,
      }
    ]
  }
})

const trafficOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top' as const, align: 'end' as const, labels: { boxWidth: 8, usePointStyle: true, font: { size: 10 } } }
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
    y: { display: false, beginAtZero: true }
  }
}

function getRelativeTime(dateString: string) {
    const diff = (new Date(dateString).getTime() - Date.now()) / 1000
    if (Math.abs(diff) < 60) return 'Just now'
    if (Math.abs(diff) < 3600) {
        const mins = Math.round(Math.abs(diff) / 60)
        return `${mins} min${mins > 1 ? 's' : ''} ago`
    }
    const hours = Math.round(Math.abs(diff) / 3600)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
}

function formatCount(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString()
}

function formatDuration(seconds: number | null | undefined): string {
  const s = Number(seconds || 0)
  if (!Number.isFinite(s) || s <= 0) return '0s'
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s % 60)
  if (m < 60) return `${m}m ${r}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

function formatIsoDateTime(input: string | null | undefined): string {
  if (!input) return '--'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toLocaleString()
}

async function fetchUsageBehavior() {
  usageLoading.value = true
  usageError.value = ''
  try {
    usageMetrics.value = await getUsageMetrics()
  } catch (e: any) {
    usageError.value = e?.message || 'Failed to load usage metrics'
  } finally {
    usageLoading.value = false
  }
}

function openBehaviorModal() {
  behaviorModalOpen.value = true
  void fetchUsageBehavior()
}

onMounted(() => {
  fetchUsageBehavior()
})
</script>

<template>
  <div class="flex h-full flex-col bg-[#f5f6fa] dark:bg-[#06101c]">
    <!-- Tab Navigation -->
    <div class="flex-shrink-0 border-b border-slate-200 bg-white px-4">
      <nav class="flex gap-4">
        <button
          @click="activeTab = 'literature'"
          :class="[
            'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'literature'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          ]"
        >
          <Activity class="h-4 w-4" />
          Literature Source
        </button>
        <button
          @click="activeTab = 'llm'"
          :class="[
            'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'llm'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          ]"
        >
          <Cpu class="h-4 w-4" />
          LLM Runtime
        </button>
        <button
          @click="activeTab = 'users'"
          :class="[
            'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'users'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          ]"
        >
          <Users class="h-4 w-4" />
          用户管理
        </button>
        <button
          @click="activeTab = 'system'"
          :class="[
            'flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors',
            activeTab === 'system'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          ]"
        >
          <Server class="h-4 w-4" />
          系统监控
        </button>
      </nav>
    </div>

    <div v-if="activeTab === 'literature'" class="flex-1 overflow-hidden">
      <LiteratureSourceMonitor />
    </div>

    <div v-else-if="activeTab === 'llm'" class="flex-1 overflow-hidden">
      <LlmRuntimeMonitor />
    </div>

    <!-- User Management Tab -->
    <div v-else-if="activeTab === 'users'" class="flex-1 overflow-hidden">
      <UserManagement />
    </div>

    <!-- System Monitoring Tab -->
    <div v-else class="flex-1 overflow-auto p-4">
    <!-- Top Global Box -->
    <Card class="border-0 shadow-sm rounded-xl flex-shrink-0 mb-4">
      <CardContent class="p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div class="flex items-start gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
              <Activity class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-800">Global Behavior Metrics</p>
              <p class="text-xs text-slate-500">
                Independent of workspace. Tracks runtime usage for agents, APIs, and database queries.
              </p>
            </div>
          </div>
          <Button variant="outline" class="self-start md:self-auto" @click="openBehaviorModal">
            Open Metrics Window
          </Button>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">Agent Calls</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">{{ formatCount(usageTotals.agent_calls) }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">DB Queries</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">{{ formatCount(usageTotals.db_queries) }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">API Calls</p>
            <p class="mt-1 text-2xl font-bold text-slate-900">{{ formatCount(usageTotals.api_calls) }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Main content container -->
    <div class="min-h-0 flex-1 overflow-y-auto pr-2 custom-scrollbar">
      <div class="mb-4 flex items-center gap-2">
        <Server class="w-5 h-5 text-indigo-600" />
        <h2 class="text-[15px] font-bold text-slate-800 dark:text-slate-100">System Metrics & Analytics</h2>
      </div>

      <!-- Top metric cards -->
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Total Agent Calls</span>
            <div class="w-6 h-6 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center"><Cpu class="w-3.5 h-3.5" /></div>
          </div>
          <div>
            <div class="text-2xl font-bold text-slate-900">{{ formatCount(usageTotals.agent_calls) }}</div>
            <div class="text-[10px] mt-1 text-slate-400">+15% vs last week</div>
          </div>
        </div>
        
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Database Queries</span>
            <div class="w-6 h-6 rounded-md bg-blue-50 text-blue-500 flex items-center justify-center"><DbIcon class="w-3.5 h-3.5" /></div>
          </div>
          <div>
            <div class="text-2xl font-bold text-slate-900">{{ usageTotals.db_queries > 1000 ? (usageTotals.db_queries/1000).toFixed(1) + 'k' : usageTotals.db_queries }}</div>
            <div class="text-[10px] mt-1 text-slate-400">+5% vs last week</div>
          </div>
        </div>

        <div class="rounded-xl border-0 bg-[#0f172a] text-white p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
          <div class="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/20 rounded-full blur-xl"></div>
          <div class="flex items-center justify-between mb-2 relative z-10">
            <span class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Tokens Saved</span>
            <div class="w-6 h-6 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center"><ShieldCheck class="w-3.5 h-3.5" /></div>
          </div>
          <div class="relative z-10">
            <div class="text-2xl font-bold text-white">2.4<span class="text-lg text-slate-300 ml-0.5">M</span></div>
            <div class="text-[10px] mt-1 text-emerald-400 font-medium tracking-wide">↑ via Zero-Storage Caching</div>
          </div>
        </div>

        <div class="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-white p-4 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Global Hit Rate</span>
            <div class="w-6 h-6 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-500 flex items-center justify-center"><CheckCircle2 class="w-3.5 h-3.5" /></div>
          </div>
          <div>
            <div class="text-2xl font-bold text-slate-900">68.5<span class="text-lg text-slate-500 ml-0.5">%</span></div>
            <div class="text-[10px] mt-1 text-slate-500">Level 1 & Level 2 Caches</div>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold tracking-wider text-slate-500 uppercase">Avg Latency</span>
            <div class="w-6 h-6 rounded-full border border-amber-200 bg-amber-50 text-amber-500 flex items-center justify-center"><Clock class="w-3.5 h-3.5" /></div>
          </div>
          <div>
            <div class="text-2xl font-bold text-slate-900">1.2<span class="text-lg text-slate-500 ml-0.5">s</span></div>
            <div class="text-[10px] mt-1 text-slate-500">0.4% Error Rate (Auto-recovering)</div>
          </div>
        </div>
      </div>

      <!-- Charts & Stream -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-4">
        <!-- Traffic Load Chart -->
        <div class="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
           <div class="mb-4">
             <div class="flex items-center gap-2 text-sm font-bold text-slate-800">
               <Activity class="w-4 h-4 text-blue-500" />
               Traffic Load (Last 7 Days)
             </div>
             <p class="text-[11px] text-slate-500 mt-1">Correlation between LLM Agent invocations and backend database read/writes.</p>
           </div>
           <div class="h-[250px] w-full">
             <Bar :data="trafficData" :options="trafficOptions" />
           </div>
        </div>

        <!-- Activity Stream -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col h-[340px]">
           <div class="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
             <div class="flex items-center gap-2 text-sm font-bold text-slate-800">
               <Activity class="w-4 h-4 text-indigo-500" />
               Activity Stream
             </div>
             <div class="w-2 h-2 rounded-full bg-emerald-400 flex items-center justify-center shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
           </div>
           
           <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar relative pl-6 space-y-5">
              <div v-if="streamItems.length === 0" class="text-sm text-slate-500 text-center mt-10">
                No events recorded.
              </div>
              
              <div v-for="(item, index) in streamItems" :key="item.identifier + index" class="relative">
                <!-- Timeline line -->
                <div v-if="index !== streamItems.length - 1" class="absolute left-[-15px] top-6 bottom-[-20px] w-px bg-slate-200"></div>
                
                <!-- Icon -->
                <div class="absolute left-[-26px] top-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-white z-10" :class="item.iconBg">
                  <component :is="item.icon" class="w-3 h-3" />
                </div>
                
                <!-- Content -->
                <div class="flex items-start justify-between">
                  <div>
                    <h4 class="text-xs font-bold text-slate-800">
                       {{ item.title }} <span v-if="item.secondary" class="font-normal text-slate-500">({{ item.secondary }})</span>
                    </h4>
                    <p class="text-[10px] text-slate-400 mt-1">{{ item.identifier }}</p>
                  </div>
                  <div class="text-right flex flex-col items-end gap-1">
                    <div class="text-[10px] text-slate-400">{{ item.timeAgo }}</div>
                    <div class="flex items-center gap-1.5 justify-end">
                      <span class="text-[10px] font-medium text-slate-600">{{ item.duration }}</span>
                      <span class="text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm" :class="item.statusColor">{{ item.status }}</span>
                    </div>
                  </div>
                </div>
              </div>
           </div>
        </div>
      </div>
    </div>
    
    <!-- Retained old Metric Modal -->
    <Modal
      :show="behaviorModalOpen"
      max-width="5xl"
      @close="behaviorModalOpen = false"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <Activity class="h-5 w-5 text-cyan-600" />
          <span>Global Behavior Metrics</span>
        </div>
      </template>

      <div class="space-y-5">
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <div class="text-slate-600">
            <span class="font-medium">Started:</span>
            {{ formatIsoDateTime(usageMetrics?.started_at) }}
          </div>
          <div class="text-slate-600">
            <span class="font-medium">Uptime:</span>
            {{ formatDuration(usageMetrics?.uptime_seconds) }}
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Agent Calls</p>
            <p class="mt-2 text-3xl font-bold text-slate-900">{{ formatCount(usageTotals.agent_calls) }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">DB Queries</p>
            <p class="mt-2 text-3xl font-bold text-slate-900">{{ formatCount(usageTotals.db_queries) }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-white p-4">
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">API Calls</p>
            <p class="mt-2 text-3xl font-bold text-slate-900">{{ formatCount(usageTotals.api_calls) }}</p>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-white">
            <div class="border-b border-slate-200 px-4 py-3">
              <p class="text-sm font-semibold text-slate-800">Top Agent Tasks</p>
            </div>
            <div class="max-h-72 overflow-auto px-4 py-3">
              <div v-if="topAgentTasks.length === 0" class="text-sm text-slate-500">No agent calls yet.</div>
              <div v-for="[task, count] in topAgentTasks" :key="task" class="mb-2 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span class="text-sm text-slate-700">{{ readableTaskName(task) }}</span>
                <span class="text-sm font-semibold tabular-nums text-slate-900">{{ formatCount(count) }}</span>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white">
            <div class="border-b border-slate-200 px-4 py-3">
              <p class="text-sm font-semibold text-slate-800">Top Database Operations</p>
            </div>
            <div class="max-h-72 overflow-auto px-4 py-3">
              <div v-if="topDbOperations.length === 0" class="text-sm text-slate-500">No DB queries yet.</div>
              <div v-for="[operation, count] in topDbOperations" :key="operation" class="mb-2 flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span class="text-sm text-slate-700">{{ readableDbOperation(operation) }}</span>
                <span class="text-sm font-semibold tabular-nums text-slate-900">{{ formatCount(count) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white">
          <div class="border-b border-slate-200 px-4 py-3">
            <p class="text-sm font-semibold text-slate-800">Recent Runtime Events</p>
          </div>
          <div class="max-h-72 overflow-auto">
            <div v-if="recentBehaviorEvents.length === 0" class="px-4 py-4 text-sm text-slate-500">
              No events recorded yet.
            </div>
            <div
              v-for="event in recentBehaviorEvents"
              :key="`${event.timestamp}-${event.category}-${event.action}`"
              class="grid grid-cols-1 gap-1 border-b border-slate-100 px-4 py-3 md:grid-cols-[180px_1fr_180px]"
            >
              <span class="text-xs text-slate-500">{{ formatIsoDateTime(event.timestamp) }}</span>
              <span class="text-sm text-slate-800">{{ readableEvent(event) }}</span>
              <span class="text-xs text-slate-500 md:text-right">{{ readableEventDetail(event) }}</span>
            </div>
          </div>
        </div>

        <div v-if="usageError" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ usageError }}
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="behaviorModalOpen = false">
            Close
          </Button>
          <Button :loading="usageLoading" @click="fetchUsageBehavior">
            <RefreshCw class="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </template>
    </Modal>
    </div>
  </div>
</template>
