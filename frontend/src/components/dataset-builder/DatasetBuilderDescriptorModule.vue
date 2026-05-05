<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, BarElement, CategoryScale, Legend, LinearScale, Tooltip } from 'chart.js'
import { BarChart3, Database, TableProperties } from 'lucide-vue-next'
import type { BuilderSubsetSummary } from './types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type PreviewRow = Record<string, string>

type DatasetCard = {
  key: 'dataset_a' | 'dataset_b'
  title: string
  code: string
  tag: string
  sampleCount: number
  summary: string
  bestFor: string
  note: string
  previewColumns: string[]
  previewRows: PreviewRow[]
  accentClass: string
  tagClass: string
}

const props = defineProps<{
  descriptorSummary: unknown
  datasetASummary: BuilderSubsetSummary | null
  datasetBSummary: BuilderSubsetSummary | null
  selectedSourceMode: string
  rdkitStatusLabel: string
  outlierLabel: string
}>()

const histogramLabels = ['0.00-0.38', '0.38-0.75', '0.75-1.13', '1.13-1.50', '1.50-1.88', '1.88-2.25', '2.25-2.63', '2.63-3.00', '3.00-3.38', '3.38-3.75', '3.75-4.13', '4.13-4.50']

const datasetCards = computed<DatasetCard[]>(() => [
  {
    key: 'dataset_a',
    title: '基础数据集',
    code: 'Dataset-A',
    tag: '覆盖优先',
    sampleCount: props.datasetASummary?.row_count ?? 256,
    summary: '不强制要求膜厚字段,优先保留更多文献样本。',
    bestFor: '第一次训练、课堂演示、快速比较算法。',
    note: '保存后会作为一个独立训练版本出现在 Modeling 页。',
    previewColumns: ['Cation', 'anion', 'surface', 'Potential', 'T', 'velocity', 'Rq', 'μ'],
    previewRows: [
      { Cation: '[EtA]+', anion: '[N]-', surface: 'mica', Potential: '0.0', T: '298', velocity: '20.0', Rq: '0.0569', μ: '0.6709' },
      { Cation: '[P6,6,6,14]+', anion: '[AOT]-', surface: 'stainless steel', Potential: '0.24', T: '298', velocity: '6.0', Rq: '0.9', μ: '0.23' },
      { Cation: '[P6,6,6,14]+', anion: '[BScB]-', surface: 'titanium', Potential: '0.0', T: '298', velocity: '6.0', Rq: '0.5', μ: '0.089' },
    ],
    accentClass: 'border-l-violet-300 bg-violet-50/40',
    tagClass: 'bg-violet-100 text-violet-700',
  },
  {
    key: 'dataset_b',
    title: '增强数据集',
    code: 'Dataset-B',
    tag: '含膜厚',
    sampleCount: props.datasetBSummary?.row_count ?? 212,
    summary: '在基础特征之外加入膜厚 h,只使用真实给出膜厚的样本。',
    bestFor: '机制解释、膜厚影响分析、进阶实验。',
    note: '膜厚缺失的记录不会被硬填,留在基础数据集中。',
    previewColumns: ['Cation', 'anion', 'surface', 'h', 'T', 'velocity', 'Rq', 'μ'],
    previewRows: [
      { Cation: '[BMIm]+', anion: '[TFSI]-', surface: 'Au(111)', h: '2.6499', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.319' },
      { Cation: '[BMIm]+', anion: '[PF6]-', surface: 'mica', h: '2.2', T: '298', velocity: '20.0', Rq: '0.66', μ: '0.1' },
      { Cation: '[P6,6,6,14]+', anion: '[BMB]-', surface: 'Au(111)', h: '2.9', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.2' },
    ],
    accentClass: 'border-l-sky-300 bg-sky-50/40',
    tagClass: 'bg-sky-100 text-sky-700',
  },
])

const histogramData = computed(() => ({
  labels: histogramLabels,
  datasets: [
    {
      label: 'Dataset-A',
      data: [182, 45, 28, 3, 1, 0, 0, 2, 0, 3, 1, 0],
      backgroundColor: 'rgba(196, 181, 253, 0.85)',
      borderRadius: 6,
      barThickness: 16,
      categoryPercentage: 0.72,
      barPercentage: 0.9,
    },
    {
      label: 'Dataset-B',
      data: [129, 29, 25, 5, 6, 2, 2, 4, 1, 4, 2, 3],
      backgroundColor: 'rgba(125, 211, 252, 0.9)',
      borderRadius: 6,
      barThickness: 16,
      categoryPercentage: 0.72,
      barPercentage: 0.9,
    },
  ],
}))

const histogramOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'rectRounded' as const,
        boxWidth: 8,
        boxHeight: 8,
        color: '#334155',
        font: { size: 12, weight: 600 },
        padding: 14,
      },
    },
    tooltip: {
      backgroundColor: '#0f172a',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      padding: 10,
      cornerRadius: 10,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#94a3b8', maxRotation: 0, minRotation: 0, font: { size: 10 } },
      border: { display: false },
    },
    y: {
      beginAtZero: true,
      ticks: { color: '#94a3b8', stepSize: 20, font: { size: 10 } },
      grid: { color: 'rgba(148, 163, 184, 0.15)' },
      border: { display: false },
    },
  },
}

const previewTab = ref<'dataset_a' | 'dataset_b'>('dataset_a')
const activePreviewCard = computed(() => datasetCards.value.find((card) => card.key === previewTab.value)!)
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl border border-amber-100 bg-amber-50/50 p-3.5">
      <div class="flex items-start gap-2.5">
        <span class="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-amber-200/70 px-2 text-[10px] font-bold text-amber-900">第 2 步</span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-900">把通过检查的数据自动分成两个训练版本。</p>
          <p class="mt-1 text-xs leading-5 text-slate-600">为什么:不是每篇文献都报告了膜厚 (h)。所以系统先做一份"不要膜厚"的<b>基础数据集</b>(样本多,先跑通模型);再做一份"必须有膜厚"的<b>增强数据集</b>(样本少但能分析膜厚机制)。这一步你不用操作,看下结果就行。</p>
        </div>
      </div>
    </div>

    <section class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Database class="h-4 w-4" />
        </div>
        <div>
          <h2 class="text-2xl font-semibold tracking-tight text-slate-950">两个训练版本</h2>
          <p class="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            同一批清洗后的记录被自动拆成两份:基础数据集跑通基线,增强数据集分析膜厚机制。
          </p>
        </div>
      </div>

      <div class="mt-5 grid gap-3 lg:grid-cols-2">
        <article
          v-for="card in datasetCards"
          :key="card.key"
          class="rounded-2xl border border-l-4 border-slate-200 p-5"
          :class="card.accentClass"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{{ card.code }}</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <h3 class="text-xl font-semibold tracking-tight text-slate-950">{{ card.title }}</h3>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="card.tagClass">{{ card.tag }}</span>
              </div>
            </div>
            <div class="shrink-0 rounded-xl bg-white px-3 py-2 text-right ring-1 ring-slate-200">
              <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">样本</p>
              <p class="mt-0.5 text-2xl font-semibold tabular-nums text-slate-950">{{ card.sampleCount }}</p>
            </div>
          </div>

          <p class="mt-4 text-sm leading-6 text-slate-700">{{ card.summary }}</p>

          <div class="mt-3 rounded-xl bg-white px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/70">
            <span class="font-semibold text-slate-900">适合:</span>{{ card.bestFor }}
          </div>
          <p class="mt-2 text-[11px] leading-5 text-slate-400">{{ card.note }}</p>
        </article>
      </div>
    </section>

    <section class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <BarChart3 class="h-4 w-4" />
        </div>
        <div>
          <h3 class="text-base font-semibold tracking-tight text-slate-950">摩擦系数 μ 频数分布</h3>
          <p class="mt-0.5 text-xs leading-5 text-slate-500">横轴为 μ 区间,柱高为该区间的样本数。</p>
        </div>
      </div>

      <div class="mt-4 h-[280px] w-full overflow-x-auto">
        <div class="h-full min-w-[640px]">
          <Bar :data="histogramData" :options="histogramOptions" />
        </div>
      </div>
    </section>

    <section class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <TableProperties class="h-4 w-4" />
          </div>
          <div>
            <h3 class="text-base font-semibold tracking-tight text-slate-950">数据预览</h3>
            <p class="mt-0.5 text-xs leading-5 text-slate-500">展示典型样本,用于核对字段结构。</p>
          </div>
        </div>

        <div class="inline-flex rounded-xl bg-slate-100 p-0.5">
          <button
            v-for="card in datasetCards"
            :key="`tab-${card.key}`"
            type="button"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
            :class="previewTab === card.key ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
            @click="previewTab = card.key"
          >
            {{ card.title }}
          </button>
        </div>
      </div>

      <div class="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <th v-for="column in activePreviewCard.previewColumns" :key="`${activePreviewCard.key}-${column}`" class="px-3 py-2.5 font-semibold">
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in activePreviewCard.previewRows" :key="`${activePreviewCard.key}-${rowIndex}`" class="border-b border-slate-200/70 last:border-b-0">
              <td v-for="column in activePreviewCard.previewColumns" :key="`${activePreviewCard.key}-${rowIndex}-${column}`" class="px-3 py-2.5 text-slate-700">
                {{ row[column] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-[11px] text-slate-400">显示 {{ activePreviewCard.previewRows.length }} 条样例。</p>
    </section>
  </div>
</template>
