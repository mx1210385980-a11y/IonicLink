<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Library, RefreshCw, TrendingUp } from 'lucide-vue-next'
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
import { Chart } from 'vue-chartjs'

import {
  getExtractionReviewProgress,
  type ExtractionReviewProgressResponse,
} from '@/lib/api'
import { buildReviewProgressChartData, formatReviewCompletion } from './reviewProgress'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

const progress = ref<ExtractionReviewProgressResponse | null>(null)
const loading = ref(false)
const error = ref('')

const summary = computed(() => progress.value?.summary || {
  libraryLiterature: 0,
  reviewedLiterature: 0,
  approvedRecords: 0,
  approvedTribologyRecords: 0,
  approvedDiffusionRecords: 0,
  flaggedOrRejectedRecords: 0,
  unpromotedCandidates: 0,
  unpromotedTribologyCandidates: 0,
  unpromotedDiffusionCandidates: 0,
  reviewCompletionRate: 0,
  reviewCompletionNumerator: 0,
  reviewCompletionDenominator: 0,
  reviewCompletionLabel: 'Approved final records / review work surface',
})

const chartData = computed(() => buildReviewProgressChartData(progress.value?.trend || []))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: { boxWidth: 10, usePointStyle: true, font: { size: 11 } },
    },
    tooltip: {
      callbacks: {
        label: (context: any) => {
          if (context.dataset?.label === 'Review completion') return `${context.dataset.label}: ${context.parsed.y}%`
          return `${context.dataset?.label || 'Value'}: ${context.parsed.y}`
        },
      },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 11 } } },
    yCompletion: {
      type: 'linear' as const,
      position: 'left' as const,
      min: 0,
      max: 100,
      ticks: { callback: (value: string | number) => `${value}%`, color: '#0f766e', font: { size: 11 } },
      grid: { color: 'rgba(15, 118, 110, 0.08)' },
    },
    yRecords: {
      type: 'linear' as const,
      position: 'right' as const,
      beginAtZero: true,
      ticks: { color: '#0284c7', font: { size: 11 } },
      grid: { drawOnChartArea: false },
    },
  },
}

function formatCount(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString()
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

async function fetchProgress() {
  loading.value = true
  error.value = ''
  try {
    progress.value = await getExtractionReviewProgress()
  } catch (event: any) {
    error.value = event?.message || 'Failed to load review progress'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void fetchProgress()
})
</script>

<template>
  <div class="h-full overflow-auto bg-slate-50 p-4 dark:bg-slate-950">
    <div class="mx-auto max-w-7xl space-y-4">
      <header class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
            <TrendingUp class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <h2 class="truncate text-base font-extrabold text-slate-900 dark:text-white">Extraction review progress</h2>
            <p class="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              {{ summary.reviewCompletionLabel }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-teal-300 hover:text-teal-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          :disabled="loading"
          @click="fetchProgress"
        >
          <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          Refresh
        </button>
      </header>

      <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
        {{ error }}
      </div>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border border-teal-200 bg-white p-4 shadow-sm dark:border-teal-900 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-black uppercase tracking-[0.16em] text-teal-700 dark:text-teal-300">Review completion</p>
            <CheckCircle2 class="h-5 w-5 text-teal-600" />
          </div>
          <p class="mt-3 text-3xl font-black text-slate-950 dark:text-white">{{ formatReviewCompletion(summary.reviewCompletionRate) }}</p>
          <p class="mt-1 text-xs font-semibold text-slate-500">
            {{ formatCount(summary.reviewCompletionNumerator) }} / {{ formatCount(summary.reviewCompletionDenominator) }} review surface
          </p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Reviewed papers</p>
            <Library class="h-5 w-5 text-slate-500" />
          </div>
          <p class="mt-3 text-3xl font-black text-slate-950 dark:text-white">{{ formatCount(summary.reviewedLiterature) }}</p>
          <p class="mt-1 text-xs font-semibold text-slate-500">of {{ formatCount(summary.libraryLiterature) }} Library papers</p>
        </div>
        <div class="rounded-lg border border-sky-200 bg-white p-4 shadow-sm dark:border-sky-900 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-black uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Approved records</p>
            <ClipboardCheck class="h-5 w-5 text-sky-600" />
          </div>
          <p class="mt-3 text-3xl font-black text-slate-950 dark:text-white">{{ formatCount(summary.approvedRecords) }}</p>
          <p class="mt-1 text-xs font-semibold text-slate-500">
            {{ formatCount(summary.approvedTribologyRecords) }} tribology · {{ formatCount(summary.approvedDiffusionRecords) }} diffusion
          </p>
        </div>
        <div class="rounded-lg border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-black uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Candidate backlog</p>
            <AlertTriangle class="h-5 w-5 text-amber-600" />
          </div>
          <p class="mt-3 text-3xl font-black text-slate-950 dark:text-white">{{ formatCount(summary.unpromotedCandidates) }}</p>
          <p class="mt-1 text-xs font-semibold text-slate-500">
            {{ formatCount(summary.unpromotedTribologyCandidates) }} tribology · {{ formatCount(summary.unpromotedDiffusionCandidates) }} diffusion
          </p>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">Iteration trend</h3>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500 dark:bg-slate-800">records + completion</span>
          </div>
          <div class="h-72">
            <Chart type="bar" :data="chartData" :options="chartOptions" />
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">Review surface</h3>
          <div class="mt-4 space-y-3">
            <div class="flex items-center justify-between gap-3 rounded-lg bg-teal-50 px-3 py-2 text-sm dark:bg-teal-950/40">
              <span class="font-bold text-teal-900 dark:text-teal-200">Approved records</span>
              <span class="font-black text-teal-700 dark:text-teal-300">{{ formatCount(summary.approvedRecords) }}</span>
            </div>
            <div class="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
              <span class="font-bold text-amber-900 dark:text-amber-200">Unpromoted candidates</span>
              <span class="font-black text-amber-700 dark:text-amber-300">{{ formatCount(summary.unpromotedCandidates) }}</span>
            </div>
            <div class="flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2 text-sm dark:bg-rose-950/40">
              <span class="font-bold text-rose-900 dark:text-rose-200">Flagged / rejected</span>
              <span class="font-black text-rose-700 dark:text-rose-300">{{ formatCount(summary.flaggedOrRejectedRecords) }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-2">
        <div class="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">Recently reviewed Library papers</h3>
          </div>
          <div class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-if="(progress?.recentReviewedLiterature || []).length === 0" class="p-6 text-sm font-semibold text-slate-400">
              No reviewed papers yet.
            </div>
            <article
              v-for="paper in progress?.recentReviewedLiterature || []"
              :key="paper.id"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-extrabold text-slate-900 dark:text-white">{{ paper.title }}</p>
                <p class="mt-1 truncate text-xs font-semibold text-slate-500">{{ paper.journal }} · {{ paper.year }} · {{ formatDate(paper.reviewedAt) }}</p>
              </div>
              <div class="text-right">
                <p class="text-sm font-black text-teal-700">{{ formatCount(paper.approvedRecords) }}</p>
                <p class="text-xs font-semibold text-slate-400">records</p>
              </div>
            </article>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div class="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h3 class="text-sm font-extrabold text-slate-900 dark:text-white">Largest candidate queues</h3>
          </div>
          <div class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-if="(progress?.candidateBacklog || []).length === 0" class="p-6 text-sm font-semibold text-slate-400">
              Candidate backlog is clear.
            </div>
            <article
              v-for="paper in progress?.candidateBacklog || []"
              :key="paper.id"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-extrabold text-slate-900 dark:text-white">{{ paper.title }}</p>
                <p class="mt-1 truncate text-xs font-semibold text-slate-500">{{ paper.journal }} · {{ paper.year }}</p>
              </div>
              <span class="self-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                {{ formatCount(paper.unpromotedCandidates) }}
              </span>
            </article>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
