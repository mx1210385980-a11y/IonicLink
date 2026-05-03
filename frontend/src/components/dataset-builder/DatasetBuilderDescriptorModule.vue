<script setup lang="ts">
import { computed } from 'vue'
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
  frameClass: string
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
    summary: '不强制要求膜厚字段，优先保留更多文献样本。适合学生先跑通一个基线模型，理解离子性质、表面和工况如何共同影响摩擦系数。',
    bestFor: '第一次训练、课堂演示、快速比较算法。',
    note: '保存后会作为一个独立训练版本出现在 Modeling 页。',
    previewColumns: ['Cation', 'anion', 'surface', 'Potential', 'T', 'velocity', 'Rq', 'μ'],
    previewRows: [
      { Cation: '[EtA]+', anion: '[N]-', surface: 'mica', Potential: '0.0', T: '298', velocity: '20.0', Rq: '0.0569', μ: '0.6709' },
      { Cation: '[P6,6,6,14]+', anion: '[AOT]-', surface: 'stainless steel', Potential: '0.24', T: '298', velocity: '6.0', Rq: '0.9', μ: '0.23' },
      { Cation: '[P6,6,6,14]+', anion: '[BScB]-', surface: 'titanium', Potential: '0.0', T: '298', velocity: '6.0', Rq: '0.5', μ: '0.089' },
    ],
    frameClass: 'border-violet-200 bg-[linear-gradient(180deg,rgba(250,245,255,0.98),rgba(255,255,255,0.98))]',
    tagClass: 'bg-violet-100 text-violet-700',
  },
  {
    key: 'dataset_b',
    title: '增强数据集',
    code: 'Dataset-B',
    tag: '含膜厚',
    sampleCount: props.datasetBSummary?.row_count ?? 212,
    summary: '在基础特征之外加入膜厚 h，只使用真实给出膜厚的样本。适合进一步探索受限液膜、界面结构和预测精度之间的关系。',
    bestFor: '机制解释、膜厚影响分析、进阶实验。',
    note: '膜厚缺失的记录不会被硬填，会留在基础数据集中。',
    previewColumns: ['Cation', 'anion', 'surface', 'h', 'T', 'velocity', 'Rq', 'μ'],
    previewRows: [
      { Cation: '[BMIm]+', anion: '[TFSI]-', surface: 'Au(111)', h: '2.6499', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.319' },
      { Cation: '[BMIm]+', anion: '[PF6]-', surface: 'mica', h: '2.2', T: '298', velocity: '20.0', Rq: '0.66', μ: '0.1' },
      { Cation: '[P6,6,6,14]+', anion: '[BMB]-', surface: 'Au(111)', h: '2.9', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.2' },
    ],
    frameClass: 'border-sky-200 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(255,255,255,0.98))]',
    tagClass: 'bg-sky-100 text-sky-700',
  },
])

const histogramData = computed(() => ({
  labels: histogramLabels,
  datasets: [
    {
      label: 'Dataset-A',
      data: [182, 45, 28, 3, 1, 0, 0, 2, 0, 3, 1, 0],
      backgroundColor: 'rgba(221, 190, 255, 0.9)',
      borderRadius: 8,
      barThickness: 18,
      categoryPercentage: 0.72,
      barPercentage: 0.9,
    },
    {
      label: 'Dataset-B',
      data: [129, 29, 25, 5, 6, 2, 2, 4, 1, 4, 2, 3],
      backgroundColor: 'rgba(173, 220, 248, 0.95)',
      borderRadius: 8,
      barThickness: 18,
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
        boxWidth: 10,
        boxHeight: 10,
        color: '#1e293b',
        font: {
          size: 13,
          weight: 600,
        },
        padding: 18,
      },
    },
    tooltip: {
      backgroundColor: '#0f172a',
      titleColor: '#ffffff',
      bodyColor: '#e2e8f0',
      padding: 12,
      cornerRadius: 12,
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        color: '#94a3b8',
        maxRotation: 0,
        minRotation: 0,
        font: {
          size: 11,
        },
      },
      border: {
        display: false,
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#94a3b8',
        stepSize: 20,
        font: {
          size: 11,
        },
      },
      grid: {
        color: 'rgba(148, 163, 184, 0.18)',
      },
      border: {
        display: false,
      },
    },
  },
}
</script>

<template>
  <div class="space-y-6">
    <section class="rounded-[28px] border border-slate-200 bg-white p-6">
      <div class="flex items-start gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Database class="h-6 w-6" />
        </div>
        <div>
          <h2 class="text-[2rem] font-semibold tracking-tight text-slate-950">划分训练数据集</h2>
          <p class="mt-2 max-w-4xl text-sm leading-7 text-slate-600">
            平台把同一批清洗后的记录拆成两个学生更容易理解的版本：先用基础数据集跑通训练，再用增强数据集分析膜厚机制。
          </p>
        </div>
      </div>

      <div class="mt-8 grid gap-6 xl:grid-cols-2">
        <article
          v-for="card in datasetCards"
          :key="card.key"
          class="overflow-hidden rounded-[30px] border p-0"
          :class="card.frameClass"
        >
          <div class="grid min-h-[248px] grid-cols-[8px_1fr]">
            <div :class="card.key === 'dataset_a' ? 'bg-violet-200' : 'bg-sky-300'"></div>
            <div class="p-8">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="text-xs font-semibold text-slate-400">{{ card.code }}</p>
                  <div class="flex items-center gap-3">
                    <h3 class="text-[2rem] font-semibold tracking-tight text-slate-950">{{ card.title }}</h3>
                    <span class="rounded-xl px-3 py-1 text-sm font-semibold" :class="card.tagClass">{{ card.tag }}</span>
                  </div>
                </div>
                <div class="rounded-2xl bg-white/80 px-5 py-4 text-right ring-1 ring-slate-200/70">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">样本规模</p>
                  <p class="mt-2 text-[2.4rem] font-semibold leading-none tracking-tight text-slate-950">{{ card.sampleCount }}</p>
                </div>
              </div>

              <p class="mt-8 text-[1.02rem] leading-8 text-slate-700">{{ card.summary }}</p>
              <div class="mt-6 rounded-2xl bg-white/75 px-4 py-3 text-sm leading-6 text-slate-600 ring-1 ring-slate-200/70">
                <span class="font-semibold text-slate-900">适合：</span>{{ card.bestFor }}
              </div>
              <p class="mt-4 text-xs font-medium text-slate-400">{{ card.note }}</p>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="rounded-[28px] border border-slate-200 bg-white p-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <BarChart3 class="h-5 w-5" />
          </div>
          <div>
            <h3 class="text-[1.9rem] font-semibold tracking-tight text-slate-950">目标变量（摩擦系数 μ）频数分布</h3>
            <p class="mt-1 text-sm leading-6 text-slate-500">横轴为 μ 所在区间，柱高表示每个区间内的数据点数量。</p>
          </div>
        </div>
      </div>

      <div class="mt-6 h-[360px] w-full overflow-x-auto">
        <div class="min-w-[860px] h-full">
          <Bar :data="histogramData" :options="histogramOptions" />
        </div>
      </div>
    </section>

    <section class="rounded-[28px] border border-slate-200 bg-white p-6">
      <div class="flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <TableProperties class="h-5 w-5" />
        </div>
        <div>
          <h3 class="text-[1.6rem] font-semibold tracking-tight text-slate-950">上传数据预览</h3>
          <p class="mt-1 text-sm leading-6 text-slate-500">下面展示每个数据集的一部分样例，方便核对字段结构和典型记录。</p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <article
          v-for="card in datasetCards"
          :key="`preview-${card.key}`"
          class="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <h4 class="text-lg font-semibold tracking-tight text-slate-950">{{ card.title }}</h4>
              <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="card.tagClass">{{ card.tag }}</span>
            </div>
            <span class="text-xs font-medium text-slate-400">显示 3 条样例</span>
          </div>

          <div class="mt-4 overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200/80">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <th v-for="column in card.previewColumns" :key="`${card.key}-${column}`" class="px-3 py-3 font-semibold">
                    {{ column }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in card.previewRows" :key="`${card.key}-${rowIndex}`" class="border-b border-slate-100">
                  <td v-for="column in card.previewColumns" :key="`${card.key}-${rowIndex}-${column}`" class="px-3 py-3 text-slate-700">
                    {{ row[column] }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>

  </div>
</template>
