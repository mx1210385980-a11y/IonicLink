<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { GraphSeriesOption } from 'echarts/charts'
import type { TooltipComponentOption } from 'echarts/components'
import type { ComposeOption, EChartsType } from 'echarts/core'
import { AlertTriangle, BookOpen, Database, Loader2, RefreshCw } from 'lucide-vue-next'

import {
  formatTribopairLabel,
  getRelationshipGraph,
  getRelationshipGraphDrilldown,
  type RecordResponse,
  type RelationshipGraphDrilldownResponse,
  type RelationshipGraphEdge,
  type RelationshipGraphNode,
  type RelationshipGraphResponse,
  type RelationshipGraphSelection,
  type SearchFilter,
} from '@/lib/api'
import { recoverFromChunkLoadError } from '@/lib/lazyComponent'
import { normalizePotentialDisplayText } from '@/lib/potential'

const props = defineProps<{
  filter: SearchFilter
  active: boolean
  refreshKey: number
}>()

const chartRoot = ref<HTMLDivElement | null>(null)
const graph = ref<RelationshipGraphResponse | null>(null)
const loading = ref(false)
const error = ref('')
const activeSelection = ref<RelationshipGraphSelection | null>(null)
const drilldown = ref<RelationshipGraphDrilldownResponse | null>(null)
const drilldownLoading = ref(false)
const drilldownError = ref('')

type RelationshipChartOption = ComposeOption<GraphSeriesOption | TooltipComponentOption>
type EChartsCoreModule = typeof import('echarts/core')

let chart: EChartsType | null = null
let echartsModule: EChartsCoreModule | null = null
let echartsPromise: Promise<EChartsCoreModule> | null = null
let resizeObserver: ResizeObserver | null = null
let lastLoadedRefreshKey: number | null = null

const typeLabels: Record<string, string> = {
  lubricant: 'Lubricant',
  cation: 'Cation',
  anion: 'Anion',
  tribopair: 'Tribopair',
  temperature: 'Temperature',
  load: 'Load',
  speed: 'Speed',
  waterContent: 'Water Content',
  potential: 'Potential',
  filmThickness: 'Film Thickness',
}

const typeColors: Record<string, string> = {
  lubricant: '#2563eb',
  cation: '#0891b2',
  anion: '#0f766e',
  tribopair: '#7c3aed',
  temperature: '#ea580c',
  load: '#dc2626',
  speed: '#0284c7',
  waterContent: '#059669',
  potential: '#be185d',
  filmThickness: '#475569',
}

const graphState = computed(() => graph.value?.state || 'empty')
const summary = computed(() => graph.value?.summary || null)
const hiddenDimensions = computed(() => summary.value?.hiddenDimensions || [])
const activeDimensions = computed(() => summary.value?.activeDimensions || [])
const selectedRecords = computed(() => drilldown.value?.items || [])

function typeLabel(type: string): string {
  return typeLabels[type] || type
}

function nodeColor(type: string): string {
  return typeColors[type] || '#64748b'
}

function edgeColor(avgCof: number | null | undefined): string {
  const value = Number(avgCof)
  if (!Number.isFinite(value)) return '#94a3b8'
  if (value <= 0.05) return '#059669'
  if (value <= 0.1) return '#2563eb'
  if (value <= 0.2) return '#d97706'
  return '#dc2626'
}

function formatCof(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return Number(value).toFixed(4).replace(/\.?0+$/, '')
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return `${Number(value).toFixed(1)}%`
}

function recordCofLabel(record: RecordResponse): string {
  if (record.cofValue != null && Number.isFinite(Number(record.cofValue))) {
    return formatCof(record.cofValue)
  }
  if (record.cofRaw) return record.cofRaw
  return '--'
}

function recordConditions(record: RecordResponse): string[] {
  return [
    record.temperature ? `T ${record.temperature}` : '',
    record.loadValue ? `Load ${record.loadValue}` : '',
    record.speedValue ? `Speed ${record.speedValue}` : '',
    record.waterContent ? `Water ${record.waterContent}` : '',
    record.potential ? `Potential ${normalizePotentialDisplayText(record.potential)}` : '',
  ].filter(Boolean)
}

function recordTribopair(record: RecordResponse): string {
  return formatTribopairLabel({
    probeMaterial: record.probeMaterial,
    substrateMaterial: record.substrateMaterial,
    substrateCoating: record.substrateCoating,
    materialName: record.materialName,
  })
}

function clearSelection() {
  activeSelection.value = null
  drilldown.value = null
  drilldownError.value = ''
}

function disposeChart() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (chart) {
    chart.dispose()
    chart = null
  }
}

async function loadECharts() {
  if (echartsModule) return echartsModule
  if (!echartsPromise) {
    echartsPromise = Promise.all([
      import('echarts/core'),
      import('echarts/lib/chart/graph'),
      import('echarts/lib/component/tooltip'),
      import('echarts/lib/renderer/installCanvasRenderer'),
    ])
      .then(([core, , , canvasRenderer]) => {
        core.use([canvasRenderer.install])
        echartsModule = core
        return core
      })
      .catch((error) => {
        echartsPromise = null
        recoverFromChunkLoadError(error)
        throw error
      })
  }
  return echartsPromise
}

async function ensureChart() {
  if (!chartRoot.value) return null
  const echarts = await loadECharts()
  if (!chart) {
    chart = echarts.init(chartRoot.value)
  }
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartRoot.value)
  }
  return chart
}

function nodeSymbolSize(node: RelationshipGraphNode, maxCount: number): number {
  if (maxCount <= 1) return 34
  const ratio = node.count / maxCount
  return Math.round(28 + ratio * 26)
}

function edgeWidth(edge: RelationshipGraphEdge, maxCount: number): number {
  if (maxCount <= 1) return 2.5
  const ratio = edge.count / maxCount
  return Number((1.8 + ratio * 5.2).toFixed(2))
}

function buildChartOption(data: RelationshipGraphResponse): RelationshipChartOption {
  const isDark = document.documentElement.classList.contains('dark')
  const categories = Array.from(new Set(data.nodes.map((node) => node.type))).map((type) => ({
    name: typeLabel(type),
  }))
  const categoryIndex = Object.fromEntries(Array.from(new Set(data.nodes.map((node) => node.type))).map((type, index) => [type, index]))
  const maxNodeCount = Math.max(...data.nodes.map((node) => node.count), 1)
  const maxEdgeCount = Math.max(...data.edges.map((edge) => edge.count), 1)

  return {
    animationDuration: 350,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'item',
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.97)',
      borderColor: isDark ? '#334155' : '#cbd5e1',
      textStyle: {
        color: isDark ? '#e2e8f0' : '#0f172a',
      },
      formatter: (params: any) => {
        const item = params.data || {}
        if (params.dataType === 'edge') {
          return [
            `<strong>${item.sourceLabel} → ${item.targetLabel}</strong>`,
            `${typeLabel(item.targetType || '')}`,
            `Samples: ${item.count ?? '--'}`,
            `Avg COF: ${formatCof(item.avgCof)}`,
          ].join('<br/>')
        }

        return [
          `<strong>${item.label || item.name || '--'}</strong>`,
          `${typeLabel(item.type || '')}`,
          `Samples: ${item.count ?? '--'}`,
          `Coverage: ${formatPercent(item.coveragePct)}`,
          `Avg COF: ${formatCof(item.avgCof)}`,
        ].join('<br/>')
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        emphasis: {
          focus: 'adjacency',
          scale: true,
        },
        force: {
          repulsion: 280,
          edgeLength: [90, 180],
          gravity: 0.06,
        },
        label: {
          show: true,
          position: 'right',
          color: isDark ? '#e2e8f0' : '#0f172a',
          fontSize: 12,
          formatter: (params: any) => params.data?.label || params.data?.name || '',
        },
        lineStyle: {
          opacity: 0.78,
          curveness: 0.12,
        },
        categories,
        data: data.nodes.map((node) => ({
          ...node,
          name: node.label,
          category: categoryIndex[node.type],
          value: node.count,
          symbolSize: nodeSymbolSize(node, maxNodeCount),
          itemStyle: {
            color: nodeColor(node.type),
            shadowBlur: 14,
            shadowColor: `${nodeColor(node.type)}44`,
          },
        })) as any,
        links: data.edges.map((edge) => ({
          ...edge,
          lineStyle: {
            width: edgeWidth(edge, maxEdgeCount),
            color: edgeColor(edge.avgCof),
            opacity: 0.82,
          },
        })) as any,
      },
    ],
  }
}

async function renderGraph() {
  if (!graph.value || graph.value.state !== 'ready' || !graph.value.nodes.length || !graph.value.edges.length) {
    disposeChart()
    return
  }

  await nextTick()
  const instance = await ensureChart()
  if (!instance) return

  instance.off('click')
  instance.setOption(buildChartOption(graph.value), true)
  instance.on('click', (params: any) => {
    if (params.dataType === 'node') {
      const node = params.data as RelationshipGraphNode
      void loadDrilldown({
        kind: 'node',
        nodeType: node.type,
        nodeValue: node.label,
      })
      return
    }

    if (params.dataType === 'edge') {
      const edge = params.data as RelationshipGraphEdge
      void loadDrilldown({
        kind: 'edge',
        sourceType: edge.sourceType,
        sourceValue: edge.sourceLabel,
        targetType: edge.targetType,
        targetValue: edge.targetLabel,
      })
    }
  })
  instance.resize()
}

async function loadGraph() {
  loading.value = true
  error.value = ''
  clearSelection()
  try {
    const payload = await getRelationshipGraph(props.filter)
    graph.value = payload
    lastLoadedRefreshKey = props.refreshKey
    loading.value = false
    await nextTick()
    await renderGraph()
  } catch (err: any) {
    graph.value = null
    error.value = err?.response?.data?.detail || err?.message || 'Failed to generate relationship graph.'
    disposeChart()
  } finally {
    if (loading.value) {
      loading.value = false
    }
  }
}

async function loadDrilldown(selection: RelationshipGraphSelection) {
  activeSelection.value = selection
  drilldownLoading.value = true
  drilldownError.value = ''
  try {
    drilldown.value = await getRelationshipGraphDrilldown(props.filter, selection, 0, 20)
  } catch (err: any) {
    drilldown.value = null
    drilldownError.value = err?.response?.data?.detail || err?.message || 'Failed to load drilldown details.'
  } finally {
    drilldownLoading.value = false
  }
}

async function refreshGraph() {
  await loadGraph()
}

watch(
  () => [props.active, props.refreshKey] as const,
  async ([active, refreshKey]) => {
    if (!active) return
    if (lastLoadedRefreshKey === refreshKey && graph.value) {
      await renderGraph()
      return
    }
    await loadGraph()
  },
  { immediate: true }
)

watch(
  () => [graphState.value, loading.value, props.active] as const,
  async ([state, isLoading, active]) => {
    if (state === 'ready' && !isLoading && active) {
      await renderGraph()
      return
    }
    disposeChart()
  }
)

onBeforeUnmount(() => {
  disposeChart()
})
</script>

<template>
  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
    <section class="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-500">Relationship Graph</div>
            <h2 class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {{ graph?.title || '当前筛选结果润滑参数关系图谱' }}
            </h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
              边宽表示样本数，边色表示平均 COF。点击节点或边查看命中记录和文献摘要。
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            :disabled="loading"
            @click="refreshGraph"
          >
            <RefreshCw class="h-4 w-4" />
            重新生成
          </button>
        </div>

        <div v-if="summary" class="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
          <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
            Records {{ summary.totalRecords }}
          </span>
          <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
            Literature {{ summary.totalLiterature }}
          </span>
          <span class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            Avg COF {{ formatCof(summary.avgCof) }}
          </span>
        </div>

        <div v-if="activeDimensions.length" class="mt-4">
          <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Active Dimensions</div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="dimension in activeDimensions"
              :key="dimension.type"
              class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <span>{{ dimension.label }}</span>
              <span class="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                {{ dimension.nodeCount }} nodes · {{ formatPercent(dimension.coveragePct) }}
              </span>
            </span>
          </div>
        </div>

        <div v-if="hiddenDimensions.length" class="mt-4">
          <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Coverage Notes</div>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="dimension in hiddenDimensions"
              :key="dimension.type"
              class="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
            >
              {{ dimension.label }}
              <span class="text-[10px] font-medium opacity-80">
                {{ dimension.nonEmptyCount }} rec / {{ dimension.distinctCount }} val
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="min-h-[620px] px-5 py-5">
        <div v-if="loading" class="flex h-[560px] items-center justify-center text-slate-500 dark:text-slate-400">
          <Loader2 class="mr-2 h-5 w-5 animate-spin" />
          正在生成关系图谱...
        </div>

        <div
          v-else-if="error"
          class="flex h-[560px] flex-col items-center justify-center rounded-3xl border border-rose-200 bg-rose-50 px-6 text-center text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
        >
          <AlertTriangle class="mb-3 h-8 w-8" />
          <p class="text-base font-semibold">关系图谱生成失败</p>
          <p class="mt-2 max-w-xl text-sm">{{ error }}</p>
        </div>

        <div
          v-else-if="graphState === 'empty'"
          class="flex h-[560px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-slate-700 dark:bg-slate-900/60"
        >
          <Database class="mb-3 h-8 w-8 text-slate-400" />
          <p class="text-base font-semibold text-slate-700 dark:text-slate-200">当前筛选结果没有可用数据</p>
          <p class="mt-2 max-w-lg text-sm text-slate-500 dark:text-slate-400">调整 DOI、润滑剂、tribopair 或 COF 范围后再生成图谱。</p>
        </div>

        <div
          v-else-if="graphState === 'insufficient_data'"
          class="flex h-[560px] flex-col items-center justify-center rounded-3xl border border-dashed border-amber-300 bg-amber-50 px-6 text-center dark:border-amber-500/30 dark:bg-amber-500/10"
        >
          <AlertTriangle class="mb-3 h-8 w-8 text-amber-600 dark:text-amber-300" />
          <p class="text-base font-semibold text-amber-800 dark:text-amber-200">当前筛选结果不足以形成有效关系网络</p>
          <p class="mt-2 max-w-2xl text-sm text-amber-700 dark:text-amber-300">
            当前结果中只有少量高覆盖参数满足聚合条件。建议放宽筛选范围，或先聚焦到包含更多实验条件的润滑剂。
          </p>
        </div>

        <div v-else ref="chartRoot" class="h-[560px] rounded-[24px] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_28%)]"></div>
      </div>
    </section>

    <aside class="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85">
      <div class="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Details</div>
        <div class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {{ drilldown?.summary.label || '选择一个节点或边' }}
        </div>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {{ drilldown ? '查看命中记录和文献来源。' : '点击图中的节点或连线，查看对应参数关系。' }}
        </p>
      </div>

      <div class="max-h-[700px] overflow-auto px-5 py-5">
        <div v-if="drilldownLoading" class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 class="h-4 w-4 animate-spin" />
          正在加载 drilldown 详情...
        </div>

        <div v-else-if="drilldownError" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {{ drilldownError }}
        </div>

        <template v-else-if="drilldown">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Matched Records</div>
              <div class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ drilldown.summary.count }}</div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Avg COF</div>
              <div class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ formatCof(drilldown.summary.avgCof) }}</div>
            </div>
          </div>

          <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">COF Span</div>
            <div class="mt-3 flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
              <span>Min {{ formatCof(drilldown.summary.minCof) }}</span>
              <span>Max {{ formatCof(drilldown.summary.maxCof) }}</span>
            </div>
          </div>

          <div class="mt-5">
            <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <BookOpen class="h-4 w-4 text-blue-500" />
              Literature Summary
            </div>
            <div v-if="drilldown.literatureSummaries.length" class="space-y-2">
              <div
                v-for="literature in drilldown.literatureSummaries"
                :key="literature.id"
                class="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{{ literature.title || '--' }}</div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {{ literature.journal || '--' }}<span v-if="literature.year"> · {{ literature.year }}</span>
                    </div>
                    <a
                      v-if="literature.doi"
                      :href="`https://doi.org/${literature.doi}`"
                      target="_blank"
                      rel="noreferrer"
                      class="mt-1 inline-block truncate text-xs text-blue-600 hover:underline dark:text-blue-300"
                    >
                      {{ literature.doi }}
                    </a>
                  </div>
                  <span class="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                    {{ literature.hitCount }} hits
                  </span>
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-slate-500 dark:text-slate-400">没有可展示的文献摘要。</p>
          </div>

          <div class="mt-5">
            <div class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <Database class="h-4 w-4 text-emerald-500" />
              Matched Records
            </div>
            <div v-if="selectedRecords.length" class="space-y-3">
              <div
                v-for="record in selectedRecords"
                :key="record.id"
                class="rounded-2xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{{ record.lubricant || '--' }}</div>
                    <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Record #{{ record.id }} · {{ recordTribopair(record) }}
                    </div>
                  </div>
                  <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    COF {{ recordCofLabel(record) }}
                  </span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span
                    v-for="condition in recordConditions(record)"
                    :key="`${record.id}-${condition}`"
                    class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {{ condition }}
                  </span>
                </div>
                <div v-if="record.literature?.title" class="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  {{ record.literature.title }}
                </div>
              </div>
            </div>
            <p v-else class="text-sm text-slate-500 dark:text-slate-400">当前选择下没有可展示的记录。</p>
          </div>
        </template>

        <div v-else class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
          图谱右侧会显示你点击的节点或边所对应的记录、平均 COF 和文献命中数。
        </div>
      </div>
    </aside>
  </div>
</template>
