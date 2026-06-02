<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, BarElement, CategoryScale, Legend, LinearScale, Tooltip } from 'chart.js'
import { BarChart3, Database, TableProperties } from 'lucide-vue-next'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

type PreviewRow = Record<string, string>

type DatasetCard = {
  key: 'dataset_a' | 'dataset_b'
  title: string
  tag: string
  sampleCount: number
  summary: string
  note: string
  previewColumns: string[]
  previewRows: PreviewRow[]
  frameClass: string
  tagClass: string
}

defineProps<{
  descriptorSummary: unknown
  selectedSourceMode: string
  rdkitStatusLabel: string
  outlierLabel: string
}>()

const histogramLabels = ['0.00-0.38', '0.38-0.75', '0.75-1.13', '1.13-1.50', '1.50-1.88', '1.88-2.25', '2.25-2.63', '2.63-3.00', '3.00-3.38', '3.38-3.75', '3.75-4.13', '4.13-4.50']

const datasetCards: DatasetCard[] = [
  {
    key: 'dataset_a',
    title: 'Dataset-A',
    tag: '不含膜厚',
    sampleCount: 256,
    summary: '收录仅给出界面摩擦系数及相应工况参数的数据点。旨在最大化样本规模，建立“离子液体自身性质-固体表面性质-外界环境-界面纳米摩擦系数”的通用预测模型。',
    note: '预览来自已上传文件 `no film dataset 0312.csv`。',
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
    title: 'Dataset-B',
    tag: '含膜厚',
    sampleCount: 212,
    summary: '在 Dataset-A 的特征基础上额外引入关键特征膜厚 h。这部分数据用于评估微观受限膜厚对预测精度的影响，探索界面结构决定的机理。',
    note: '预览来自已上传文件 `film dataset0312.csv`。',
    previewColumns: ['Cation', 'anion', 'surface', 'h', 'T', 'velocity', 'Rq', 'μ'],
    previewRows: [
      { Cation: '[BMIm]+', anion: '[TFSI]-', surface: 'Au(111)', h: '2.6499', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.319' },
      { Cation: '[BMIm]+', anion: '[PF6]-', surface: 'mica', h: '2.2', T: '298', velocity: '20.0', Rq: '0.66', μ: '0.1' },
      { Cation: '[P6,6,6,14]+', anion: '[BMB]-', surface: 'Au(111)', h: '2.9', T: '298', velocity: '6.0', Rq: '1.0', μ: '0.2' },
    ],
    frameClass: 'border-sky-200 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(255,255,255,0.98))]',
    tagClass: 'bg-sky-100 text-sky-700',
  },
]

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
          <h2 class="text-[2rem] font-semibold tracking-tight text-slate-950">数据集构建与划分</h2>
          <p class="mt-2 max-w-4xl text-sm leading-7 text-slate-600">
            为了避免经验插补缺失膜厚特征引入不可控偏差，平台并行构建了两套数据集，并直接接入你上传的 CSV 做样例预览和分布可视化。
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
              <p class="mt-6 text-xs font-medium text-slate-400">{{ card.note }}</p>
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
