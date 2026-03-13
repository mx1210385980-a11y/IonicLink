<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Activity, AlertTriangle, Database, FlaskConical, Play, Settings2, SlidersHorizontal, Square, Trophy } from 'lucide-vue-next'
import { Chart as ChartJS, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Title, Tooltip } from 'chart.js'
import { Line } from 'vue-chartjs'
import {
  buildModelTrainingWebSocketUrl,
  cancelModelTraining,
  getModelTrainingSummary,
  getModelTrainingTask,
  startModelTraining,
  type ModelTrainingMetricPoint,
  type ModelTrainingStartPayload,
  type ModelTrainingSummary,
  type ModelTrainingTaskSnapshot,
} from '@/lib/api'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

type LeaderboardRow = {
  taskId: string
  finishedAt: string
  algorithm: string
  usableRecords: number
  features: string[]
  valR2: number
  valRmse: number
  valMae: number
}

const summary = ref<ModelTrainingSummary | null>(null)
const activeTask = ref<ModelTrainingTaskSnapshot | null>(null)
const leaderboard = ref<LeaderboardRow[]>([])
const loading = ref(true)
const loadError = ref('')
const starting = ref(false)
const cancelling = ref(false)
const socketRef = ref<WebSocket | null>(null)
const completedTaskIds = new Set<string>()

const form = reactive<ModelTrainingStartPayload>({
  target: 'cof',
  algorithm: 'gradient_boosting',
  features: {
    cation_fingerprint: true,
    anion_fingerprint: true,
    temperature: true,
    speed: false,
    load: false,
    potential: false,
    water_content: false,
    film_thickness: false,
    alkyl_chain_length: true,
  },
  hyperparameters: {
    n_estimators: 120,
    learning_rate: 0.06,
    max_depth: 3,
  },
  data_options: {
    validation_split: 0.2,
    min_confidence: 0,
    max_records: null,
    random_seed: 42,
  },
})

const isRunning = computed(() => ['queued', 'running'].includes(activeTask.value?.status || ''))
const currentPoint = computed(() => activeTask.value?.current || null)
const history = computed(() => activeTask.value?.history || [])
const activeAlgorithmLabel = computed(() => {
  const key = activeTask.value?.config.algorithm || form.algorithm
  return summary.value?.algorithms.find((item) => item.key === key)?.label || 'Model'
})
const selectedFeatureLabels = computed(() => {
  const source = activeTask.value?.config.features || form.features
  return (summary.value?.features || [])
  .filter((feature) => source[feature.key as keyof typeof source])
  .map((feature) => feature.label)
})
const progressPercent = computed(() => Math.round((currentPoint.value?.progress || 0) * 100))

const statusTone = computed(() => {
  const status = activeTask.value?.status || 'ready'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 ring-emerald-200'
  if (status === 'failed') return 'bg-rose-100 text-rose-700 ring-rose-200'
  if (status === 'cancelled') return 'bg-amber-100 text-amber-700 ring-amber-200'
  return 'bg-blue-100 text-blue-700 ring-blue-200'
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 10, color: '#475569' } },
  },
  scales: {
    x: { grid: { color: 'rgba(148,163,184,0.16)' }, ticks: { color: '#64748b' } },
    y: { grid: { color: 'rgba(148,163,184,0.16)' }, ticks: { color: '#64748b' } },
  },
}

const r2ChartData = computed(() => ({
  labels: history.value.map((point) => point.round.toString()),
  datasets: [
    {
      label: 'Train R²',
      data: history.value.map((point) => point.train_r2),
      borderColor: '#0f172a',
      backgroundColor: 'rgba(15,23,42,0.06)',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.22,
      fill: false,
    },
    {
      label: 'Validation R²',
      data: history.value.map((point) => point.val_r2),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37,99,235,0.16)',
      pointRadius: 0,
      borderWidth: 2.4,
      tension: 0.22,
      fill: true,
    },
  ],
}))

const errorChartData = computed(() => ({
  labels: history.value.map((point) => point.round.toString()),
  datasets: [
    {
      label: 'Validation RMSE',
      data: history.value.map((point) => point.val_rmse),
      borderColor: '#e11d48',
      backgroundColor: 'rgba(225,29,72,0.10)',
      pointRadius: 0,
      borderWidth: 2.1,
      tension: 0.22,
      fill: false,
    },
    {
      label: 'Validation MAE',
      data: history.value.map((point) => point.val_mae),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245,158,11,0.12)',
      pointRadius: 0,
      borderWidth: 2.1,
      tension: 0.22,
      fill: false,
    },
  ],
}))

function hydrateDefaults(nextSummary: ModelTrainingSummary) {
  form.target = nextSummary.defaults.target
  form.algorithm = nextSummary.defaults.algorithm
  Object.assign(form.features, nextSummary.defaults.features)
  Object.assign(form.hyperparameters, nextSummary.defaults.hyperparameters)
  Object.assign(form.data_options, nextSummary.defaults.data_options)
}

function closeSocket() {
  if (socketRef.value) {
    socketRef.value.close()
    socketRef.value = null
  }
}

function formatMetric(value: number | null | undefined, digits: number = 4) {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return Number(value).toFixed(digits)
}

function formatCoverage(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}

function featureLabelsFromSnapshot(snapshot: ModelTrainingTaskSnapshot) {
  const options = summary.value?.features || []
  return options
    .filter((feature) => snapshot.config.features[feature.key as keyof typeof snapshot.config.features])
    .map((feature) => feature.label)
}

function pushLeaderboard(snapshot: ModelTrainingTaskSnapshot) {
  if (snapshot.status !== 'completed' || !snapshot.current || completedTaskIds.has(snapshot.task_id)) return
  completedTaskIds.add(snapshot.task_id)
  leaderboard.value.unshift({
    taskId: snapshot.task_id,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    algorithm: snapshot.config.algorithm,
    usableRecords: snapshot.dataset.usable_records,
    features: featureLabelsFromSnapshot(snapshot),
    valR2: snapshot.current.val_r2,
    valRmse: snapshot.current.val_rmse,
    valMae: snapshot.current.val_mae,
  })
}

function applyTaskSnapshot(snapshot: ModelTrainingTaskSnapshot, mode: 'replace' | 'merge' = 'replace') {
  if (mode === 'replace' || !activeTask.value || activeTask.value.task_id !== snapshot.task_id) {
    activeTask.value = snapshot
  } else {
    activeTask.value = { ...activeTask.value, ...snapshot, history: activeTask.value.history }
  }
  pushLeaderboard(snapshot)
}

function applyMetric(snapshot: ModelTrainingTaskSnapshot, point: ModelTrainingMetricPoint) {
  if (!activeTask.value || activeTask.value.task_id !== snapshot.task_id) {
    activeTask.value = { ...snapshot, current: point, history: [point] }
    return
  }
  const nextHistory = [...activeTask.value.history.filter((item) => item.round !== point.round), point].sort((a, b) => a.round - b.round)
  activeTask.value = { ...activeTask.value, ...snapshot, current: point, history: nextHistory }
}

async function fetchSummary() {
  loading.value = true
  loadError.value = ''
  try {
    const nextSummary = await getModelTrainingSummary()
    summary.value = nextSummary
    hydrateDefaults(nextSummary)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to load training summary.'
  } finally {
    loading.value = false
  }
}

async function refreshTask(taskId: string) {
  try {
    const response = await getModelTrainingTask(taskId)
    applyTaskSnapshot(response.task)
  } catch (error) {
    console.warn('[ModelTraining] Refresh failed:', error)
  }
}

function openSocket(taskId: string) {
  closeSocket()
  const ws = new WebSocket(buildModelTrainingWebSocketUrl(taskId))
  socketRef.value = ws

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data)
    if (payload.type === 'task.snapshot') {
      applyTaskSnapshot(payload.task)
      return
    }
    if (payload.type === 'task.metric') {
      applyMetric(payload.snapshot, payload.point)
      return
    }
    if (payload.type === 'task.completed' || payload.type === 'task.failed' || payload.type === 'task.cancelled') {
      applyTaskSnapshot(payload.task)
      closeSocket()
    }
  }

  ws.onclose = () => {
    socketRef.value = null
    if (activeTask.value && ['queued', 'running'].includes(activeTask.value.status)) {
      void refreshTask(activeTask.value.task_id)
    }
  }
}

async function handleStartTraining() {
  if (!summary.value) return
  loadError.value = ''
  const payload: ModelTrainingStartPayload = {
    target: form.target,
    algorithm: form.algorithm,
    features: { ...form.features },
    hyperparameters: { ...form.hyperparameters },
    data_options: { ...form.data_options, max_records: form.data_options.max_records ? Number(form.data_options.max_records) : null },
  }
  for (const feature of summary.value.features) {
    if (feature.disabled) {
      payload.features[feature.key as keyof typeof payload.features] = false
    }
  }
  starting.value = true
  try {
    const response = await startModelTraining(payload)
    applyTaskSnapshot(response.task)
    openSocket(response.task.task_id)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to start training.'
  } finally {
    starting.value = false
  }
}

async function handleCancelTraining() {
  if (!activeTask.value) return
  cancelling.value = true
  try {
    const response = await cancelModelTraining(activeTask.value.task_id)
    applyTaskSnapshot(response.task)
  } catch (error) {
    console.warn('[ModelTraining] Cancel failed:', error)
  } finally {
    cancelling.value = false
  }
}

onMounted(() => {
  void fetchSummary()
})

onBeforeUnmount(() => {
  closeSocket()
})
</script>

<template>
  <div class="flex h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_36%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
    <aside class="flex w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-white/85 px-6 py-6 backdrop-blur">
      <div class="mb-8 flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-lg shadow-blue-200/80">
          <FlaskConical class="h-5 w-5" />
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight">Predictive Model Training</h1>
          <p class="text-sm text-slate-500">Feature engineering, tuning, and live metrics.</p>
        </div>
      </div>

      <div v-if="loading" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        Loading available features and training targets...
      </div>

      <div v-else-if="loadError && !summary" class="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
        <div class="mb-2 flex items-center gap-2 font-semibold">
          <AlertTriangle class="h-4 w-4" />
          Training workspace unavailable
        </div>
        <p>{{ loadError }}</p>
        <button class="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-700" @click="fetchSummary">Retry</button>
      </div>

      <template v-else-if="summary">
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <section>
            <label class="mb-2 block text-sm font-semibold text-slate-700">Prediction Target</label>
            <select v-model="form.target" class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100">
              <option v-for="target in summary.targets" :key="target.key" :value="target.key">
                {{ target.label }} · {{ target.available_count }} records
              </option>
            </select>
          </section>

          <section>
            <div class="mb-3 flex items-center gap-2">
              <Settings2 class="h-4 w-4 text-blue-600" />
              <h2 class="text-sm font-semibold text-slate-800">Feature Engineering</h2>
            </div>
            <div class="space-y-2 rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
              <label
                v-for="feature in summary.features"
                :key="feature.key"
                class="flex items-start gap-3 rounded-2xl border px-3 py-3"
                :class="feature.disabled ? 'border-slate-100 bg-slate-100/80 opacity-60' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/30'"
              >
                <input
                  v-model="form.features[feature.key as keyof typeof form.features]"
                  :disabled="feature.disabled"
                  type="checkbox"
                  class="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-semibold text-slate-800">{{ feature.label }}</p>
                    <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{{ feature.available_count }}</span>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-slate-500">{{ feature.description }}</p>
                  <p class="mt-1 text-[11px] font-medium text-slate-400">{{ feature.group }} · Coverage {{ formatCoverage(feature.coverage) }}</p>
                </div>
              </label>
            </div>
          </section>

          <section>
            <label class="mb-2 block text-sm font-semibold text-slate-700">Learning Algorithm</label>
            <select v-model="form.algorithm" class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100">
              <option v-for="algorithm in summary.algorithms" :key="algorithm.key" :value="algorithm.key">
                {{ algorithm.label }}
              </option>
            </select>
            <p class="mt-2 text-xs text-slate-500">{{ summary.algorithms.find((item) => item.key === form.algorithm)?.description }}</p>
          </section>

          <section class="rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 to-indigo-50/80 p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <SlidersHorizontal class="h-4 w-4 text-blue-600" />
              <h2 class="text-sm font-semibold text-slate-800">Hyperparameters and Data Controls</h2>
            </div>
            <div class="space-y-5">
              <div>
                <div class="mb-2 flex items-center justify-between text-sm">
                  <label class="font-medium text-slate-600">Boosting / Tree Rounds</label>
                  <span class="font-semibold text-blue-700">{{ form.hyperparameters.n_estimators }}</span>
                </div>
                <input v-model="form.hyperparameters.n_estimators" type="range" min="20" max="300" step="10" class="w-full accent-blue-600" />
              </div>

              <div>
                <div class="mb-2 flex items-center justify-between text-sm">
                  <label class="font-medium text-slate-600">Learning Rate</label>
                  <span class="font-semibold text-blue-700">{{ form.hyperparameters.learning_rate.toFixed(2) }}</span>
                </div>
                <input v-model="form.hyperparameters.learning_rate" type="range" min="0.01" max="0.30" step="0.01" class="w-full accent-blue-600" :disabled="form.algorithm === 'random_forest'" />
                <p v-if="form.algorithm === 'random_forest'" class="mt-1 text-[11px] text-slate-400">Learning rate is ignored for Random Forest.</p>
              </div>

              <div>
                <div class="mb-2 flex items-center justify-between text-sm">
                  <label class="font-medium text-slate-600">Tree Depth</label>
                  <span class="font-semibold text-blue-700">{{ form.hyperparameters.max_depth }}</span>
                </div>
                <input v-model="form.hyperparameters.max_depth" type="range" min="1" max="8" step="1" class="w-full accent-blue-600" />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="mb-2 block text-sm font-medium text-slate-600">Validation Split</span>
                  <select v-model="form.data_options.validation_split" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100">
                    <option :value="0.1">10%</option>
                    <option :value="0.15">15%</option>
                    <option :value="0.2">20%</option>
                    <option :value="0.25">25%</option>
                    <option :value="0.3">30%</option>
                    <option :value="0.4">40%</option>
                  </select>
                </label>
                <label class="block">
                  <span class="mb-2 block text-sm font-medium text-slate-600">Min Confidence</span>
                  <select v-model="form.data_options.min_confidence" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100">
                    <option :value="0">0.00</option>
                    <option :value="0.5">0.50</option>
                    <option :value="0.7">0.70</option>
                    <option :value="0.8">0.80</option>
                    <option :value="0.9">0.90</option>
                  </select>
                </label>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <label class="block">
                  <span class="mb-2 block text-sm font-medium text-slate-600">Max Records</span>
                  <input v-model.number="form.data_options.max_records" type="number" min="10" max="500" placeholder="All" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
                </label>
                <label class="block">
                  <span class="mb-2 block text-sm font-medium text-slate-600">Random Seed</span>
                  <input v-model.number="form.data_options.random_seed" type="number" min="1" max="9999" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
                </label>
              </div>
            </div>
          </section>
        </div>

        <div class="mt-6 space-y-3">
          <button class="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-base font-semibold text-white shadow-lg shadow-blue-300/60 transition hover:translate-y-[-1px] disabled:opacity-60" :disabled="starting || isRunning || !summary.dataset.total_records" @click="handleStartTraining">
            <Play class="h-4 w-4" />
            Start Training Run
          </button>
          <button class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" :disabled="!isRunning || cancelling" @click="handleCancelTraining">
            <Square class="h-4 w-4" />
            Cancel Active Run
          </button>
        </div>
      </template>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto px-8 py-8">
      <div class="mx-auto max-w-[1180px] space-y-6">
        <section v-if="loadError && summary" class="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">
          {{ loadError }}
        </section>

        <section class="rounded-[30px] border border-slate-200/80 bg-white/88 px-8 py-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)] backdrop-blur">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div class="min-w-0">
              <div class="mb-3 flex items-center gap-2">
                <Activity class="h-5 w-5 text-blue-600" />
                <h2 class="text-2xl font-bold tracking-tight">Live Training Monitor</h2>
              </div>
              <div class="flex items-center gap-3">
                <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1" :class="statusTone">
                  {{ activeTask?.status ? activeTask.status.toUpperCase() : 'READY' }}
                </span>
                <p class="text-sm text-slate-500">{{ activeTask?.status_message || 'Choose features and start a training run.' }}</p>
              </div>
              <div v-if="activeTask?.warnings?.length" class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {{ activeTask.warnings.join(' ') }}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Validation R²</p>
                <p class="mt-2 text-3xl font-black tracking-tight">{{ formatMetric(currentPoint?.val_r2) }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">RMSE</p>
                <p class="mt-2 text-3xl font-black tracking-tight">{{ formatMetric(currentPoint?.val_rmse) }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">MAE</p>
                <p class="mt-2 text-3xl font-black tracking-tight">{{ formatMetric(currentPoint?.val_mae) }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Progress</p>
                <p class="mt-2 text-3xl font-black tracking-tight">{{ activeTask?.current_round || 0 }}/{{ activeTask?.total_rounds || 0 }}</p>
              </div>
            </div>
          </div>

          <div class="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500 transition-all duration-300" :style="{ width: `${progressPercent}%` }"></div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
          <div class="rounded-[30px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h3 class="text-lg font-bold">R² Learning Curve</h3>
                <p class="text-sm text-slate-500">Training and validation agreement across staged rounds.</p>
              </div>
              <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{{ activeAlgorithmLabel }}</span>
            </div>
            <div class="h-[340px]">
              <div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                Start a run to populate the R² trajectory.
              </div>
              <Line v-else :data="r2ChartData" :options="chartOptions" />
            </div>
          </div>

          <div class="rounded-[30px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div class="mb-4">
              <h3 class="text-lg font-bold">Validation Error Curve</h3>
              <p class="text-sm text-slate-500">RMSE and MAE updates during training.</p>
            </div>
            <div class="h-[340px]">
              <div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                Error metrics will appear here once training begins.
              </div>
              <Line v-else :data="errorChartData" :options="chartOptions" />
            </div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div class="rounded-[30px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div class="mb-5 flex items-center gap-2">
              <Database class="h-4 w-4 text-blue-600" />
              <h3 class="text-lg font-bold">Dataset Snapshot</h3>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-2xl bg-slate-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Scope Records</p>
                <p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.total_records || summary?.dataset.total_records || 0 }}</p>
              </div>
              <div class="rounded-2xl bg-slate-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Usable Records</p>
                <p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.usable_records || 0 }}</p>
              </div>
              <div class="rounded-2xl bg-slate-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Train / Val</p>
                <p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.train_size || 0 }} / {{ activeTask?.dataset?.validation_size || 0 }}</p>
              </div>
              <div class="rounded-2xl bg-slate-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Feature Dims</p>
                <p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.feature_dimensions || 0 }}</p>
              </div>
            </div>

            <div class="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p><span class="font-semibold text-slate-800">Target:</span> {{ activeTask?.dataset?.target?.label || 'Coefficient of Friction (COF)' }}</p>
              <p class="mt-2"><span class="font-semibold text-slate-800">Algorithm:</span> {{ activeAlgorithmLabel }}</p>
              <p class="mt-2"><span class="font-semibold text-slate-800">Selected features:</span> {{ selectedFeatureLabels.join(', ') || 'None' }}</p>
              <p class="mt-2"><span class="font-semibold text-slate-800">Validation split:</span> {{ Math.round((activeTask?.dataset?.filters?.validation_split || form.data_options.validation_split) * 100) }}%</p>
              <p class="mt-2"><span class="font-semibold text-slate-800">Minimum confidence:</span> {{ formatMetric(activeTask?.dataset?.filters?.min_confidence ?? form.data_options.min_confidence, 2) }}</p>
            </div>

            <div v-if="activeTask?.feature_blocks?.length" class="mt-5 space-y-2">
              <div v-for="block in activeTask.feature_blocks" :key="block.key" class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-slate-800">{{ block.label }}</span>
                  <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{{ block.dimensions }} dims</span>
                </div>
                <p v-if="block.features?.length" class="mt-2 text-xs leading-5 text-slate-500">{{ block.features.join(', ') }}</p>
              </div>
            </div>
          </div>

          <div class="rounded-[30px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div class="mb-5 flex items-center gap-2">
              <Trophy class="h-4 w-4 text-amber-500" />
              <h3 class="text-lg font-bold">Run Leaderboard</h3>
            </div>
            <div v-if="leaderboard.length === 0" class="flex min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
              Completed runs will be listed here for comparison.
            </div>
            <div v-else class="overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400">
                    <th class="px-3 py-3 font-semibold">Run</th>
                    <th class="px-3 py-3 font-semibold">Algorithm</th>
                    <th class="px-3 py-3 font-semibold">Records</th>
                    <th class="px-3 py-3 font-semibold">Val R²</th>
                    <th class="px-3 py-3 font-semibold">RMSE</th>
                    <th class="px-3 py-3 font-semibold">MAE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in leaderboard" :key="row.taskId" class="border-b border-slate-100 text-slate-700">
                    <td class="px-3 py-3">
                      <div class="font-semibold text-slate-900">{{ formatDateTime(row.finishedAt) }}</div>
                      <div class="mt-1 text-xs text-slate-400">{{ row.features.join(', ') }}</div>
                    </td>
                    <td class="px-3 py-3">{{ row.algorithm.replace(/_/g, ' ') }}</td>
                    <td class="px-3 py-3">{{ row.usableRecords }}</td>
                    <td class="px-3 py-3 font-semibold text-blue-700">{{ formatMetric(row.valR2) }}</td>
                    <td class="px-3 py-3 font-semibold text-rose-600">{{ formatMetric(row.valRmse) }}</td>
                    <td class="px-3 py-3 font-semibold text-amber-600">{{ formatMetric(row.valMae) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
