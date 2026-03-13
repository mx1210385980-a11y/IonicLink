<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  Chart as ChartJS, Title, Tooltip, Legend, ArcElement, 
  CategoryScale, LinearScale, PointElement, LineElement, Filler
} from 'chart.js'
import { Doughnut, Line } from 'vue-chartjs'
import { FileText, Database, Zap, ShieldCheck } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { getDashboardStats } from '@/lib/api'

// --- Register Chart.js Components ---
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, 
  ArcElement, Title, Tooltip, Legend, Filler
)

// --- Types ---
interface DashboardStats {
  total_records: number
  literature_count: number
  distinct_il_count: number
  cof_stats: { min: number | null, max: number | null, avg: number | null }
  confidence_stats?: {
    avg: number | null
    avg_percent: number | null
    min_percent: number | null
    max_percent: number | null
    count: number
    breakdown?: Record<string, {
      count: number
      share_percent: number
      avg: number | null
      avg_percent: number | null
    }>
  }
  materials_ratio: { name: string, count: number }[]
  top_liquids: { name: string, count: number }[]
  publication_trend: { year: number, count: number }[]
  top_journals: { name: string, count: number }[]
  cof_ranges: { name: string, min: number, max: number }[]
}

// --- State ---
const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const emit = defineEmits<{
  (e: 'open-library'): void
}>()

// --- Colors & Styling Helpers ---
const CHAT_COLORS = [
  '#4ade80', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#14b8a6', // teal
]



// --- Methods ---
async function fetchStats() {
  try {
    stats.value = await getDashboardStats()
  } catch (e) {
    console.error('Failed to fetch stats:', e)
  } finally {
    loading.value = false
  }
}

// --- Computed Chart Data ---
const publicationTrendData = computed(() => {
  if (!stats.value?.publication_trend) return { labels: [], datasets: [] }
  const data = [...stats.value.publication_trend].sort((a, b) => a.year - b.year)
  return {
    labels: data.map(d => d.year.toString()),
    datasets: [{
      label: 'Publications',
      data: data.map(d => d.count),
      borderColor: '#8b5cf6',
      backgroundColor: (context: any) => {
        const ctx = context.chart.ctx
        const gradient = ctx.createLinearGradient(0, 0, 0, 300)
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)')
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)')
        return gradient
      },
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#fff',
      pointBorderColor: '#8b5cf6',
      pointBorderWidth: 2,
    }]
  }
})

const publicationTrendOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: { display: false, beginAtZero: true },
    x: { grid: { display: false } }
  }
}

const materialsRatioData = computed(() => {
  if (!stats.value?.materials_ratio) return { labels: [], datasets: [] }
  return {
    labels: stats.value.materials_ratio.map(d => d.name),
    datasets: [{
      data: stats.value.materials_ratio.map(d => d.count),
      backgroundColor: CHAT_COLORS,
      borderWidth: 0,
      cutout: '65%'
    }]
  }
})

const materialsRatioOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' as const, labels: { boxWidth: 10, usePointStyle: true } }
  }
}

const materialsCount = computed(() => {
  return stats.value?.materials_ratio?.length || 0
})

const topLiquidsMax = computed(() => {
  if (!stats.value?.top_liquids || stats.value.top_liquids.length === 0) return 1
  return Math.max(...stats.value.top_liquids.map(d => d.count))
})

const topJournalsMax = computed(() => {
  if (!stats.value?.top_journals || stats.value.top_journals.length === 0) return 1
  return Math.max(...stats.value.top_journals.map(d => d.count))
})

const cofSpanMax = computed(() => {
  if (!stats.value?.cof_ranges || stats.value.cof_ranges.length === 0) return 1.0
  return Math.max(...stats.value.cof_ranges.map(d => d.max))
})

const cofSpanMin = computed(() => {
  if (!stats.value?.cof_ranges || stats.value.cof_ranges.length === 0) return 0.0
  return Math.min(...stats.value.cof_ranges.map(d => d.min))
})

const cofSpanRange = computed(() => {
  const span = cofSpanMax.value - cofSpanMin.value
  return span > 0 ? span : 1
})

const cofSpanMid = computed(() => cofSpanMin.value + cofSpanRange.value / 2)

function formatCofTick(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  let decimals = 3
  if (abs >= 1) decimals = 2
  else if (abs >= 0.1) decimals = 3
  else if (abs >= 0.01) decimals = 3
  else decimals = 4
  return value.toFixed(decimals).replace(/\.?0+$/, '')
}

function formatConfidencePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const safe = Math.max(0, Math.min(100, Number(value)))
  return `${safe.toFixed(1)}%`
}

function confidenceBucketLabel(key: string): string {
  const labels: Record<string, string> = {
    text_grounded: 'Text-grounded',
    figure_grounded: 'Figure-grounded',
    inferred: 'Model-inferred',
  }
  return labels[key] || key.replace(/_/g, ' ')
}

function confidenceBucketTone(key: string): string {
  const tones: Record<string, string> = {
    text_grounded: 'from-emerald-400 to-teal-500',
    figure_grounded: 'from-cyan-400 to-blue-500',
    inferred: 'from-amber-400 to-orange-500',
  }
  return tones[key] || 'from-slate-400 to-slate-500'
}

const confidenceBreakdownItems = computed(() => {
  const breakdown = stats.value?.confidence_stats?.breakdown || {}
  const order = ['text_grounded', 'figure_grounded', 'inferred']
  return order
    .filter((key) => breakdown[key])
    .map((key) => ({
      key,
      ...breakdown[key],
    }))
})

// --- Lifecycle ---
onMounted(() => {
  fetchStats()
})
</script>

<template>
  <div class="flex flex-col h-full bg-[#f5f6fa] overflow-y-auto p-6 space-y-6">
    <!-- Header Summary Stats -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <!-- Total Papers -->
      <Card
        class="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow cursor-pointer hover:ring-2 hover:ring-blue-200"
        role="button"
        tabindex="0"
        @click="emit('open-library')"
        @keydown.enter="emit('open-library')"
      >
        <CardContent class="p-6 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">Processed Papers</p>
            <h2 class="text-3xl font-bold">{{ stats?.literature_count || 0 }}</h2>
            <p class="text-xs text-blue-500 font-medium mt-1">Total literature loaded</p>
          </div>
          <div class="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
            <FileText class="w-6 h-6 text-blue-600" />
          </div>
        </CardContent>
      </Card>
      
      <!-- Total Records -->
      <Card class="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
        <CardContent class="p-6 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">Extracted Data Points</p>
            <h2 class="text-3xl font-bold">{{ stats?.total_records || 0 }}</h2>
            <p class="text-xs text-purple-500 font-medium mt-1">across {{ stats?.distinct_il_count || 0 }} Ionic Liquids</p>
          </div>
          <div class="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center">
            <Database class="w-6 h-6 text-purple-600" />
          </div>
        </CardContent>
      </Card>
      
      <!-- Speed Metric -->
      <Card class="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
        <CardContent class="p-6 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">Avg Extraction Speed</p>
            <h2 class="text-3xl font-bold">1.2s</h2>
            <p class="text-xs text-amber-500 font-medium mt-1">per document via AI</p>
          </div>
          <div class="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center">
            <Zap class="w-6 h-6 text-white" />
          </div>
        </CardContent>
      </Card>
      
      <!-- Confidence Metric -->
      <Card class="border-0 shadow-sm rounded-xl hover:shadow-md transition-shadow">
        <CardContent class="p-6 flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-muted-foreground mb-1">Data Confidence Score</p>
            <h2 class="text-3xl font-bold">{{ formatConfidencePercent(stats?.confidence_stats?.avg_percent ?? null) }}</h2>
            <p class="text-xs text-green-500 font-medium mt-1">AI composite confidence across library records</p>
            <div class="mt-3 space-y-2">
              <div v-for="bucket in confidenceBreakdownItems" :key="bucket.key">
                <div class="mb-1 flex items-center justify-between text-[11px]">
                  <span class="font-semibold text-slate-600">{{ confidenceBucketLabel(bucket.key) }}</span>
                  <span class="text-slate-500">{{ bucket.count }} rec / {{ formatConfidencePercent(bucket.avg_percent) }}</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    class="h-full rounded-full bg-gradient-to-r"
                    :class="confidenceBucketTone(bucket.key)"
                    :style="{ width: `${Math.max(8, Math.min(100, bucket.share_percent || 0))}%` }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div class="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center">
            <ShieldCheck class="w-6 h-6 text-white" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Main Charts Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      <!-- Publication Trend line chart -->
      <Card class="md:col-span-2 border-0 shadow-sm rounded-xl overflow-hidden">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-base font-semibold text-gray-800 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-blue-500" />
              Publication & Data Trend
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div class="h-64 mt-4 w-full relative">
            <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
              <span class="text-sm text-muted-foreground">Loading...</span>
            </div>
            <Line v-if="stats" :data="publicationTrendData" :options="publicationTrendOptions" />
          </div>
        </CardContent>
      </Card>

      <!-- Materials Donut Chart -->
      <Card class="border-0 shadow-sm rounded-xl overflow-hidden">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            Surface Material Ratio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="h-64 w-full relative">
             <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
              <span class="text-sm text-muted-foreground">Loading...</span>
            </div>
            <!-- Inner Label for Donut -->
            <div v-if="!loading" class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -translate-x-[4rem]">
               <span class="text-3xl font-bold text-gray-800">{{ materialsCount }}</span>
               <span class="text-[0.6rem] font-bold text-gray-400 tracking-wider">MATERIALS</span>
            </div>
            <Doughnut v-if="stats" :data="materialsRatioData" :options="materialsRatioOptions" class="relative z-0" />
          </div>
        </CardContent>
      </Card>

    </div>

    <!-- Bottom Charts Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      <!-- COF Span Ranges -->
      <Card class="border-0 shadow-sm rounded-xl overflow-hidden">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            Friction Coef (COF) Range Span
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-4 mt-6">
            <div class="grid grid-cols-[96px_1fr_86px] items-center text-xs text-slate-500 mb-2">
              <span></span>
              <div class="flex justify-between px-1">
                <span>{{ formatCofTick(cofSpanMin) }}</span>
                <span class="font-semibold text-slate-700">{{ formatCofTick(cofSpanMid) }}</span>
                <span>{{ formatCofTick(cofSpanMax) }}</span>
              </div>
              <span class="text-right">min ~ max</span>
            </div>
            <div v-for="range in stats?.cof_ranges.slice(0, 5)" :key="range.name" class="grid grid-cols-[96px_1fr_86px] items-center gap-2 text-sm">
              <span class="text-xs font-bold text-gray-800 text-right pr-2 truncate">{{ range.name }}</span>
              <div class="h-8 bg-slate-100 rounded-full relative flex items-center px-1 border border-slate-200">
                <!-- Span visualization -->
                <div 
                  class="absolute h-6 bg-blue-200/90 rounded-full border border-blue-300"
                  :style="{
                    left: `${((range.min - cofSpanMin) / cofSpanRange) * 100}%`,
                    width: `${Math.max(2, ((range.max - range.min) / cofSpanRange) * 100)}%`
                  }"
                ></div>
                <!-- Average point (approximated as middle for demo) -->
                <div 
                  class="absolute w-2.5 h-6 bg-blue-600 rounded-full shadow-sm"
                  :style="{
                    left: `${((((range.min + range.max) / 2) - cofSpanMin) / cofSpanRange) * 100}%`,
                    transform: 'translateX(-50%)'
                  }"
                ></div>
              </div>
              <span class="text-right text-[11px] font-medium text-slate-600 tabular-nums">
                {{ formatCofTick(range.min) }}-{{ formatCofTick(range.max) }}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Top Ionic Liquids -->
      <Card class="border-0 shadow-sm rounded-xl overflow-hidden">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            Top Ionic Liquids Analyzed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-3 mt-4 h-52 overflow-y-auto pr-2 custom-scrollbar flex flex-col pt-1">
            <div v-for="item in stats?.top_liquids" :key="item.name" class="w-full flex">
              <div 
                class="h-9 rounded-md bg-gradient-to-r from-blue-200/60 to-cyan-200/60 flex items-center justify-between px-3"
                :style="{ width: `${Math.max(20, (item.count / topLiquidsMax) * 100)}%` }"
              >
                <span class="text-xs font-bold text-gray-800 truncate pr-4">{{ item.name }}</span>
                <span class="text-xs font-bold text-gray-800">{{ item.count }}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Leading Journals -->
      <Card class="border-0 shadow-sm rounded-xl overflow-hidden">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500" />
            Leading Journals Source
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="space-y-3 mt-4 h-52 overflow-y-auto pr-2 custom-scrollbar flex flex-col pt-1">
            <div v-for="item in stats?.top_journals" :key="item.name" class="w-full flex">
              <div 
                class="h-9 rounded-md bg-gradient-to-r from-purple-200/60 to-pink-200/60 flex items-center justify-between px-3"
                :style="{ width: `${Math.max(20, (item.count / topJournalsMax) * 100)}%` }"
              >
                <span class="text-xs font-bold text-gray-800 truncate pr-4">{{ item.name }}</span>
                <span class="text-xs font-bold text-gray-800">{{ item.count }}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  </div>
</template>

<style scoped>
/* Scoped styles if necessary, layout relies mainly on Tailwind classes */
</style>

