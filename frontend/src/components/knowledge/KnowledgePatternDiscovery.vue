<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Bar, Line } from 'vue-chartjs'
import {
  Activity,
  Database,
  FileText,
  FlaskConical,
  Library,
  RefreshCw,
  Save,
  ShieldCheck,
  TrendingDown,
  Zap,
} from 'lucide-vue-next'

import {
  getPatternDiscovery,
  savePatternDiscoveryReport,
  type PatternDiscoveryResponse,
  type PatternDiscoveryReportSaveResponse,
} from '@/lib/api'

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
)

const props = defineProps<{
  activeScopeLabel: string
}>()

const discovery = ref<PatternDiscoveryResponse | null>(null)
const savedReport = ref<PatternDiscoveryReportSaveResponse | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const saveError = ref('')

const chartPalette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#4f46e5', '#be123c']
const mutedPalette = ['#93c5fd', '#86efac', '#fde68a', '#fca5a5', '#c4b5fd', '#67e8f9', '#a5b4fc', '#f9a8d4']

function formatNumber(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('zh-CN', {
    maximumFractionDigits: digits,
  })
}

function compactLabel(value: string, max = 24) {
  if (!value) return '未标注'
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatIqr(row?: { q1Cof?: number | null, q3Cof?: number | null } | null) {
  if (!row) return 'IQR —'
  return `IQR ${formatNumber(row.q1Cof)} - ${formatNumber(row.q3Cof)}`
}

function formatN(row?: { count?: number | null } | null) {
  return `n=${formatNumber(row?.count, 0)}`
}

async function saveReport() {
  saving.value = true
  saveError.value = ''
  try {
    savedReport.value = await savePatternDiscoveryReport()
  } catch (err: any) {
    saveError.value = err?.response?.data?.detail || err?.message || '保存文字稿失败'
  } finally {
    saving.value = false
  }
}

async function loadDiscovery({ autoSave = false } = {}) {
  loading.value = true
  error.value = ''
  try {
    discovery.value = await getPatternDiscovery()
    if (autoSave) {
      void saveReport()
    }
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.message || '加载规律发现统计失败'
  } finally {
    loading.value = false
  }
}

const summaryCards = computed<Array<{
  label: string
  value: string
  caption: string
  icon: Component
  tone: string
}>>(() => {
  const summary = discovery.value?.summary
  return [
    {
      label: '研究样本',
      value: formatNumber(summary?.literatureCount, 0),
      caption: `${formatNumber(summary?.recordCount, 0)} 条记录，${props.activeScopeLabel}`,
      icon: Library,
      tone: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    {
      label: 'COF 中位数',
      value: formatNumber(summary?.medianCof),
      caption: formatIqr(summary),
      icon: Database,
      tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    {
      label: 'COF 均值',
      value: formatNumber(summary?.avgCof),
      caption: '受高值长尾影响，作为辅助指标',
      icon: TrendingDown,
      tone: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    {
      label: '离子液体种类',
      value: formatNumber(summary?.distinctLubricantCount, 0),
      caption: `范围 ${formatNumber(summary?.minCof, 4)} - ${formatNumber(summary?.maxCof)}`,
      icon: FlaskConical,
      tone: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    },
  ]
})

const sharedChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      labels: {
        usePointStyle: true,
        boxWidth: 8,
        font: { size: 11, weight: 600 },
      },
    },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)',
      padding: 12,
      titleFont: { size: 12, weight: 700 },
      bodyFont: { size: 12 },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#64748b', font: { size: 11 } },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: '#64748b', font: { size: 11 } },
    },
  },
} as any

const horizontalChartOptions = computed(() => ({
  ...sharedChartOptions,
  indexAxis: 'y',
  scales: {
    x: {
      beginAtZero: true,
      grid: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: '#64748b', font: { size: 11 } },
    },
    y: {
      grid: { display: false },
      ticks: { color: '#64748b', font: { size: 11 } },
    },
  },
}) as any)

const cofBucketData = computed(() => {
  const rows = discovery.value?.charts.cofBuckets || []
  return {
    labels: rows.map((item) => item.name),
    datasets: [
      {
        label: '记录数',
        data: rows.map((item) => item.count),
        backgroundColor: rows.map((_, index) => mutedPalette[index % mutedPalette.length] ?? '#bfdbfe'),
        borderColor: rows.map((_, index) => chartPalette[index % chartPalette.length] ?? '#2563eb'),
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  }
})

const yearlyTrendData = computed(() => {
  const rows = discovery.value?.charts.yearlyTrend || []
  return {
    labels: rows.map((item) => String(item.year)),
    datasets: [
      {
        label: '中位数 COF',
        data: rows.map((item) => item.medianCof ?? item.avgCof ?? null),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.12)',
        pointBackgroundColor: '#2563eb',
        pointRadius: 3,
        fill: true,
        tension: 0.32,
      },
    ],
  }
})

const materialData = computed(() => {
  const rows = (discovery.value?.charts.lowFrictionMaterials || []).slice(0, 8)
  return {
    labels: rows.map((item) => compactLabel(item.name, 28)),
    datasets: [
      {
        label: '中位数 COF',
        data: rows.map((item) => item.medianCof ?? item.avgCof ?? null),
        backgroundColor: '#86efac',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 5,
      },
    ],
  }
})

const potentialData = computed(() => {
  const rows = discovery.value?.charts.potential.byPotential || []
  return {
    labels: rows.map((item) => item.potential),
    datasets: [
      {
        label: '中位数 COF',
        data: rows.map((item) => item.medianCof ?? item.avgCof ?? null),
        borderColor: '#d97706',
        backgroundColor: 'rgba(217,119,6,0.12)',
        pointBackgroundColor: '#d97706',
        pointRadius: 3,
        fill: true,
        tension: 0.28,
      },
    ],
  }
})

const chainData = computed(() => {
  const rows = discovery.value?.charts.chainLength || []
  return {
    labels: rows.map((item) => `C${item.chainLength}`),
    datasets: [
      {
        label: '中位数 COF',
        data: rows.map((item) => item.medianCof ?? item.avgCof ?? null),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124,58,237,0.12)',
        pointBackgroundColor: '#7c3aed',
        pointRadius: 3,
        fill: true,
        tension: 0.3,
      },
    ],
  }
})

const reviewStatusData = computed(() => {
  const rows = discovery.value?.charts.reviewStatus || []
  return {
    labels: rows.map((item) => item.name),
    datasets: [
      {
        label: '中位数 COF',
        data: rows.map((item) => item.medianCof ?? item.avgCof ?? null),
        backgroundColor: rows.map((_, index) => mutedPalette[(index + 2) % mutedPalette.length] ?? '#fde68a'),
        borderColor: rows.map((_, index) => chartPalette[(index + 2) % chartPalette.length] ?? '#d97706'),
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  }
})

const fieldCoverageData = computed(() => {
  const rows = discovery.value?.charts.fieldCoverage || []
  return {
    labels: rows.map((item) => item.name),
    datasets: [
      {
        label: '覆盖率 %',
        data: rows.map((item) => item.sharePercent || 0),
        backgroundColor: '#bfdbfe',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  }
})

const methodologyRows = computed(() => {
  const methodology = discovery.value?.methodology
  return [
    { label: '研究对象', value: methodology?.outcome || '摩擦系数 COF' },
    { label: '稳健统计', value: methodology?.robustStatistic || '中位数、IQR、样本量 n' },
    { label: '分层阈值', value: methodology?.minimumGroupSize || 'n >= 5' },
    { label: '分层变量', value: methodology?.stratification || '材料、电位、离子结构、审核状态' },
  ]
})

const materialSummaryRows = computed(() => (discovery.value?.charts.lowFrictionMaterials || []).slice(0, 6))
const potentialSummaryRows = computed(() => discovery.value?.charts.potential.byPolarity || [])
const anionSummaryRows = computed(() => (discovery.value?.charts.lowFrictionAnions || discovery.value?.charts.anions || []).slice(0, 6))
const topFindingRows = computed(() => discovery.value?.insights || [])
const markdownPreview = computed(() => discovery.value?.markdown || savedReport.value?.markdown || '')

onMounted(() => {
  void loadDiscovery({ autoSave: true })
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7fafc]">
    <header class="shrink-0 border-b border-[#dbe5f0] bg-white px-5 py-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#64748b]">Pattern Discovery</p>
          <h2 class="mt-1 text-2xl font-semibold tracking-tight text-slate-950">论文式规律发现统计</h2>
          <p class="mt-1 text-sm text-slate-500">
            基于当前 {{ activeScopeLabel }} 的摩擦学记录，按中位数、IQR、样本量和分层变量组织论文结果。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="loading"
            @click="loadDiscovery()"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
            刷新
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="saving || loading || !discovery"
            @click="saveReport"
          >
            <Save class="h-4 w-4" :class="{ 'animate-pulse': saving }" />
            保存文字稿
          </button>
        </div>
      </div>
      <div
        v-if="savedReport || saveError"
        class="mt-3 rounded-md border px-3 py-2 text-xs"
        :class="saveError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'"
      >
        <span v-if="savedReport">文字稿已保存到个人空间：{{ savedReport.relativePath }}</span>
        <span v-else>{{ saveError }}</span>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div v-if="loading && !discovery" class="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div v-for="item in 4" :key="item" class="h-28 animate-pulse rounded-lg border border-slate-200 bg-white" />
      </div>

      <div v-else-if="error" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ error }}
      </div>

      <template v-else-if="discovery">
        <section class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div
            v-for="card in summaryCards"
            :key="card.label"
            class="rounded-lg border bg-white p-4 shadow-sm"
            :class="card.tone"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-semibold text-current/70">{{ card.label }}</p>
                <p class="mt-2 text-3xl font-semibold tracking-tight">{{ card.value }}</p>
              </div>
              <span class="flex h-10 w-10 items-center justify-center rounded-md bg-white/70">
                <component :is="card.icon" class="h-5 w-5" />
              </span>
            </div>
            <p class="mt-2 truncate text-xs text-current/70">{{ card.caption }}</p>
          </div>
        </section>

        <section class="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">统计口径</h3>
                <p class="mt-1 text-xs text-slate-500">页面默认使用稳健描述统计，避免把异质文献汇总误读为单因素实验。</p>
              </div>
              <ShieldCheck class="h-4 w-4 text-slate-600" />
            </div>
            <dl class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div
                v-for="item in methodologyRows"
                :key="item.label"
                class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <dt class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{{ item.label }}</dt>
                <dd class="mt-1 text-sm leading-6 text-slate-800">{{ item.value }}</dd>
              </div>
            </dl>
            <p class="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              限制：{{ discovery.methodology?.caveat || '文献汇总数据存在实验条件异质性，不能替代单因素对照实验。' }}
            </p>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 class="text-sm font-semibold text-slate-900">字段覆盖率</h3>
            <p class="mt-1 text-xs text-slate-500">用于判断哪些分层分析有足够数据支撑。</p>
            <div class="mt-3 h-48">
              <Bar :data="fieldCoverageData" :options="sharedChartOptions" />
            </div>
          </div>
        </section>

        <section class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">COF 分布与长尾</h3>
                <p class="mt-1 text-xs text-slate-500">频数分箱用于展示总体偏态；中位数/IQR 用于正文描述。</p>
              </div>
              <Activity class="h-4 w-4 text-blue-600" />
            </div>
            <div class="mt-3 h-72">
              <Bar :data="cofBucketData" :options="sharedChartOptions" />
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">年度 COF 中位数</h3>
                <p class="mt-1 text-xs text-slate-500">按发表年份观察记录中心值，避免少量极端值主导趋势。</p>
              </div>
              <FileText class="h-4 w-4 text-slate-600" />
            </div>
            <div class="mt-3 h-72">
              <Line :data="yearlyTrendData" :options="sharedChartOptions" />
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">材料/基底分层</h3>
                <p class="mt-1 text-xs text-slate-500">仅展示样本数不少于 5 的组别，按 COF 中位数排序。</p>
              </div>
              <TrendingDown class="h-4 w-4 text-emerald-600" />
            </div>
            <div class="mt-3 h-80">
              <Bar :data="materialData" :options="horizontalChartOptions" />
            </div>
            <table class="mt-3 w-full text-left text-xs">
              <thead class="text-slate-500">
                <tr>
                  <th class="py-1 font-semibold">材料/基底</th>
                  <th class="py-1 text-right font-semibold">n</th>
                  <th class="py-1 text-right font-semibold">Median</th>
                  <th class="py-1 text-right font-semibold">IQR</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                <tr v-for="row in materialSummaryRows" :key="row.name">
                  <td class="py-1.5 pr-2">{{ compactLabel(row.name, 24) }}</td>
                  <td class="py-1.5 text-right tabular-nums">{{ row.count }}</td>
                  <td class="py-1.5 text-right tabular-nums">{{ formatNumber(row.medianCof ?? row.avgCof) }}</td>
                  <td class="py-1.5 text-right tabular-nums">{{ formatNumber(row.q1Cof) }}-{{ formatNumber(row.q3Cof) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">电位标注子集</h3>
                <p class="mt-1 text-xs text-slate-500">按可解析电位档位统计中位数 COF，并保留极性分组。</p>
              </div>
              <Zap class="h-4 w-4 text-amber-600" />
            </div>
            <div class="mt-3 h-72">
              <Line :data="potentialData" :options="sharedChartOptions" />
            </div>
            <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div
                v-for="row in potentialSummaryRows"
                :key="row.name"
                class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <p class="text-[11px] font-semibold text-slate-500">{{ row.name }}</p>
                <p class="mt-1 text-lg font-semibold text-slate-900">{{ formatNumber(row.medianCof ?? row.avgCof) }}</p>
                <p class="mt-0.5 text-[11px] text-slate-500">{{ formatN(row) }} · {{ formatIqr(row) }}</p>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">烷基链长相关性</h3>
                <p class="mt-1 text-xs text-slate-500">展示链长组的 COF 中位数；小样本组只作为提示。</p>
              </div>
              <FlaskConical class="h-4 w-4 text-violet-600" />
            </div>
            <div class="mt-3 h-72">
              <Line :data="chainData" :options="sharedChartOptions" />
            </div>
            <div class="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p class="text-xs font-semibold text-slate-700">低中位数阴离子组（n ≥ 5）</p>
              <div class="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div v-for="row in anionSummaryRows" :key="row.name" class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ row.name }}</span>
                  <span class="font-semibold tabular-nums text-slate-900">{{ formatNumber(row.medianCof ?? row.avgCof) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">审核状态敏感性</h3>
                <p class="mt-1 text-xs text-slate-500">比较主分析集与待核验数据，说明证据质量对统计叙述的影响。</p>
              </div>
              <ShieldCheck class="h-4 w-4 text-cyan-600" />
            </div>
            <div class="mt-3 h-72">
              <Bar :data="reviewStatusData" :options="sharedChartOptions" />
            </div>
          </div>
        </section>

        <section class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-900">论文结果草稿</h3>
                <p class="mt-1 text-xs text-slate-500">每条发现按“统计观察、证据依据、可能解释、限制条件”组织。</p>
              </div>
              <FileText class="h-4 w-4 text-slate-600" />
            </div>
            <div class="mt-4 space-y-3">
              <article
                v-for="(item, index) in topFindingRows"
                :key="item.title"
                class="rounded-md border border-slate-200 bg-slate-50 p-4"
              >
                <div class="flex items-start gap-3">
                  <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-950 text-xs font-semibold text-white">
                    {{ index + 1 }}
                  </span>
                  <div class="min-w-0">
                    <h4 class="text-sm font-semibold text-slate-950">{{ item.title }}</h4>
                    <p class="mt-2 text-sm leading-6 text-slate-700"><span class="font-semibold text-slate-900">统计观察：</span>{{ item.claim }}</p>
                    <p class="mt-2 text-sm leading-6 text-slate-600"><span class="font-semibold text-slate-800">证据依据：</span>{{ item.evidence }}</p>
                    <p v-if="item.interpretation" class="mt-2 text-sm leading-6 text-slate-600"><span class="font-semibold text-slate-800">可能解释：</span>{{ item.interpretation }}</p>
                    <p v-if="item.limitation" class="mt-2 text-sm leading-6 text-slate-600"><span class="font-semibold text-slate-800">限制条件：</span>{{ item.limitation }}</p>
                    <p class="mt-2 text-xs font-semibold leading-5 text-slate-500">{{ item.thesisUse }}</p>
                  </div>
                </div>
              </article>
            </div>
          </div>

          <aside class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 class="text-sm font-semibold text-slate-900">Markdown 预览</h3>
            <p class="mt-1 text-xs text-slate-500">
              {{ savedReport ? `已同步：${savedReport.savedAt}` : '页面加载后会自动保存一次，也可以手动刷新保存。' }}
            </p>
            <div class="mt-3 max-h-[38rem] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
              <pre class="whitespace-pre-wrap break-words font-mono">{{ markdownPreview }}</pre>
            </div>
          </aside>
        </section>
      </template>
    </div>
  </div>
</template>
