<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Database,
  FlaskConical,
  Layers3,
  Orbit,
  Play,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trophy,
  Waves,
} from 'lucide-vue-next'
import { Chart as ChartJS, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Title, Tooltip } from 'chart.js'
import { Line } from 'vue-chartjs'
import {
  buildModelTrainingWebSocketUrl,
  cancelModelTraining,
  getModelTrainingSummary,
  listCleanedDatasets,
  startModelTraining,
  type ModelTrainingMetricPoint,
  type ModelTrainingStartPayload,
  type ModelTrainingSummary,
  type ModelTrainingTaskSnapshot,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

type LeaderboardRow = {
  taskId: string
  finishedAt: string
  algorithm: string
  usableRecords: number
  valR2: number
  valRmse: number
  valMae: number
}

const props = defineProps<{
  preselectedCleanedDatasetId?: number | null
}>()

const summary = ref<ModelTrainingSummary | null>(null)
const activeTask = ref<ModelTrainingTaskSnapshot | null>(null)
const savedDatasets = ref<SavedCleanedDatasetSummary[]>([])
const selectedCleanedDatasetId = ref<number | null>(null)
const leaderboard = ref<LeaderboardRow[]>([])
const loading = ref(true)
const loadError = ref('')
const starting = ref(false)
const cancelling = ref(false)
const socketRef = ref<WebSocket | null>(null)
const completedTaskIds = new Set<string>()

const form = reactive<ModelTrainingStartPayload>({
  target: 'Target_COF',
  algorithm: 'gradient_boosting',
  hyperparameters: { n_estimators: 120, learning_rate: 0.06, max_depth: 3, l2_leaf_reg: 3, random_strength: 1 },
  data_options: { validation_split: 0.2, min_confidence: 0, max_records: null, random_seed: 42 },
  cleaned_dataset_id: null,
})

const selectedDatasetValue = computed({
  get: () => (selectedCleanedDatasetId.value == null ? '' : String(selectedCleanedDatasetId.value)),
  set: (value: string) => {
    selectedCleanedDatasetId.value = value ? Number(value) : null
  },
})

const history = computed(() => activeTask.value?.history || [])
const currentPoint = computed(() => activeTask.value?.current || null)
const hasSavedDatasets = computed(() => savedDatasets.value.length > 0)
const selectedDataset = computed(() => savedDatasets.value.find((dataset) => dataset.id === selectedCleanedDatasetId.value) || null)
const sourceScope = computed(() => activeTask.value?.dataset.source_scope || summary.value?.dataset.source_scope || null)
const cleaningSummary = computed(() => activeTask.value?.dataset.cleaning || summary.value?.cleaning || null)
const pcaInfo = computed(() => activeTask.value?.dataset.pca_info || summary.value?.pca_info || null)
const selectedFeatureColumns = computed(() => {
  return activeTask.value?.dataset.cleaning?.final_feature_columns
    || activeTask.value?.dataset.feature_columns
    || summary.value?.dataset.feature_columns
    || []
})
const visibleFeatureColumns = computed(() => selectedFeatureColumns.value.slice(0, 14))
const featureBlocks = computed(() => activeTask.value?.feature_blocks || [])
const runWarnings = computed(() => activeTask.value?.warnings || [])
const currentAlgorithm = computed(() => summary.value?.algorithms.find((algorithm) => algorithm.key === form.algorithm) || null)
const isRandomForest = computed(() => form.algorithm === 'random_forest')
const isCatBoost = computed(() => form.algorithm === 'catboost')
const usableRecords = computed(() => activeTask.value?.dataset.usable_records || summary.value?.dataset.usable_records || 0)
const progressPercent = computed(() => Math.round((currentPoint.value?.progress || 0) * 100))
const validationSplitPercent = computed(() => Math.round((form.data_options.validation_split || 0) * 100))
const targetLabel = computed(() => summary.value?.dataset.target?.label || formatColumnLabel(summary.value?.dataset.target_column || form.target))
const datasetTitle = computed(() => selectedDataset.value?.name || summary.value?.dataset.name || 'Training workspace')
const datasetDescription = computed(() => selectedDataset.value?.description || summary.value?.dataset.description || 'Train against a cleaned matrix with a fully tracked data lineage.')
const statusTone = computed(() => {
  if (activeTask.value?.status === 'completed') {
    return {
      chip: 'bg-emerald-500/14 text-emerald-200 ring-1 ring-emerald-400/20',
      accent: 'from-emerald-400 via-cyan-400 to-sky-400',
    }
  }
  if (activeTask.value?.status === 'failed') {
    return {
      chip: 'bg-rose-500/14 text-rose-200 ring-1 ring-rose-400/20',
      accent: 'from-rose-400 via-orange-300 to-amber-300',
    }
  }
  if (activeTask.value?.status === 'cancelled') {
    return {
      chip: 'bg-amber-500/14 text-amber-200 ring-1 ring-amber-400/20',
      accent: 'from-amber-300 via-orange-300 to-rose-300',
    }
  }
  if (activeTask.value?.status === 'running') {
    return {
      chip: 'bg-sky-500/14 text-sky-200 ring-1 ring-sky-400/20',
      accent: 'from-sky-300 via-cyan-300 to-emerald-300',
    }
  }
  return {
    chip: 'bg-white/10 text-slate-200 ring-1 ring-white/10',
    accent: 'from-slate-400 via-slate-300 to-slate-200',
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  interaction: { intersect: false, mode: 'index' as const },
  plugins: {
    legend: {
      labels: {
        usePointStyle: true,
        boxWidth: 10,
        color: 'rgba(51,65,85,0.82)',
        padding: 20,
        font: { size: 11, weight: 600 },
      },
    },
    tooltip: {
      backgroundColor: '#ffffff',
      titleColor: '#0f172a',
      bodyColor: '#475569',
      borderColor: 'rgba(148,163,184,0.2)',
      borderWidth: 1,
      displayColors: true,
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)' },
    },
    y: {
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)' },
    },
  },
}))

const r2ChartData = computed(() => ({
  labels: history.value.map((point) => String(point.round)),
  datasets: [
    {
      label: 'Train R2',
      data: history.value.map((point) => point.train_r2),
      borderColor: '#b7791f',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
    {
      label: 'Validation R2',
      data: history.value.map((point) => point.val_r2),
      borderColor: '#0f766e',
      backgroundColor: 'rgba(20,184,166,0.12)',
      fill: true,
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
  ],
}))

const errorChartData = computed(() => ({
  labels: history.value.map((point) => String(point.round)),
  datasets: [
    {
      label: 'Validation RMSE',
      data: history.value.map((point) => point.val_rmse),
      borderColor: '#e11d48',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
    {
      label: 'Validation MAE',
      data: history.value.map((point) => point.val_mae),
      borderColor: '#d97706',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
  ],
}))

function formatMetric(value: number | null | undefined, digits = 4) {
  return value == null || Number.isNaN(Number(value)) ? '--' : Number(value).toFixed(digits)
}

function formatNumber(value: number | null | undefined) {
  return value == null || Number.isNaN(Number(value)) ? '--' : new Intl.NumberFormat().format(Number(value))
}

function formatPercent(value: number | null | undefined, digits = 0) {
  return value == null || Number.isNaN(Number(value)) ? '--' : `${(Number(value) * 100).toFixed(digits)}%`
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '--'
}

function formatColumnLabel(value: string | null | undefined) {
  return String(value || '').replace(/_/g, ' ')
}

function formatTitleLabel(value: string | null | undefined) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatScopeMode(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return 'Unknown scope'
  if (normalized === 'group_library_fallback') return 'Group Library Fallback'
  return formatTitleLabel(normalized)
}

function hydrateDefaults(nextSummary: ModelTrainingSummary) {
  form.target = nextSummary.defaults.target
  form.algorithm = nextSummary.defaults.algorithm
  Object.assign(form.hyperparameters, nextSummary.defaults.hyperparameters)
  Object.assign(form.data_options, nextSummary.defaults.data_options)
  form.cleaned_dataset_id = nextSummary.defaults.cleaned_dataset_id // selectedCleanedDatasetId.value
}

async function refreshSavedDatasets() {
  const response = await listCleanedDatasets()
  savedDatasets.value = response.items
}

async function refreshTrainingSummary(datasetId: number | null, applyDefaults: boolean = false) {
  const nextSummary = await getModelTrainingSummary(datasetId)
  summary.value = nextSummary
  form.target = nextSummary.defaults.target
  form.cleaned_dataset_id = datasetId // nextSummary.defaults.cleaned_dataset_id // null
  if (applyDefaults) {
    hydrateDefaults(nextSummary)
  }
}

async function initialize() {
  loading.value = true
  loadError.value = ''
  try {
    await refreshSavedDatasets()
    const preferredId = props.preselectedCleanedDatasetId // savedDatasets.value[0]?.id // null
    selectedCleanedDatasetId.value = preferredId ?? null
    await refreshTrainingSummary(selectedCleanedDatasetId.value, true)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to load training workspace.'
  } finally {
    loading.value = false
  }
}

function pushLeaderboard(snapshot: ModelTrainingTaskSnapshot) {
  if (snapshot.status !== 'completed' || !snapshot.current || completedTaskIds.has(snapshot.task_id)) return
  completedTaskIds.add(snapshot.task_id)
  leaderboard.value.unshift({
    taskId: snapshot.task_id,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    algorithm: snapshot.config.algorithm,
    usableRecords: snapshot.dataset.usable_records,
    valR2: snapshot.current.val_r2,
    valRmse: snapshot.current.val_rmse,
    valMae: snapshot.current.val_mae,
  })
}

function applyTaskSnapshot(snapshot: ModelTrainingTaskSnapshot) {
  activeTask.value = snapshot
  pushLeaderboard(snapshot)
}

function applyMetric(snapshot: ModelTrainingTaskSnapshot, point: ModelTrainingMetricPoint) {
  const previous = activeTask.value?.history || []
  const nextHistory = [...previous.filter((item) => item.round !== point.round), point].sort((a, b) => a.round - b.round)
  activeTask.value = { ...snapshot, current: point, history: nextHistory }
}

function closeSocket() {
  if (socketRef.value) socketRef.value.close()
  socketRef.value = null
}

function openSocket(taskId: string) {
  closeSocket()
  const ws = new WebSocket(buildModelTrainingWebSocketUrl(taskId))
  socketRef.value = ws
  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data)
    if (payload.type === 'task.snapshot') applyTaskSnapshot(payload.task)
    if (payload.type === 'task.metric') applyMetric(payload.snapshot, payload.point)
    if (payload.type === 'task.completed' || payload.type === 'task.failed' || payload.type === 'task.cancelled') {
      applyTaskSnapshot(payload.task)
      closeSocket()
    }
  }
}

async function handleDatasetChange() {
  loadError.value = ''
  try {
    await refreshTrainingSummary(selectedCleanedDatasetId.value, false)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to refresh selected dataset.'
  }
}

async function handleStartTraining() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  starting.value = true
  loadError.value = ''
  try {
    const payload: ModelTrainingStartPayload = {
      target: summary.value.dataset.target_column || form.target,
      algorithm: form.algorithm,
      hyperparameters: { ...form.hyperparameters },
      data_options: { ...form.data_options },
      cleaned_dataset_id: selectedCleanedDatasetId.value,
    }
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
  } finally {
    cancelling.value = false
  }
}

onMounted(() => {
  void initialize()
})

onBeforeUnmount(() => {
  closeSocket()
})

watch(
  () => props.preselectedCleanedDatasetId,
  async (datasetId) => {
    if (datasetId == null || selectedCleanedDatasetId.value === datasetId) return
    selectedCleanedDatasetId.value = Number(datasetId)
    if (!loading.value) {
      await handleDatasetChange()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="training-workbench flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f7f3eb_0%,#eef4f7_100%)] text-slate-900 lg:flex-row">
    <aside class="flex w-full shrink-0 flex-col border-b border-slate-200 bg-[linear-gradient(180deg,rgba(252,249,243,0.98),rgba(246,241,232,0.98))] lg:w-[23rem] lg:border-b-0 lg:border-r">
      <div class="border-b border-slate-200 px-6 py-6">
        <div class="flex items-start gap-4">
          <div class="flex h-12 w-12 items-center justify-center rounded-[1.25rem] border border-amber-200 bg-amber-50 text-amber-700">
            <FlaskConical class="h-5 w-5" />
          </div>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-700">Model Studio</p>
            <h1 class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">Predictive Training</h1>
            <p class="mt-2 text-sm leading-6 text-slate-600">
              Configure a cleaned matrix, tune the run, and monitor every metric live.
            </p>
          </div>
        </div>
      </div>

      <div v-if="loading" class="px-6 py-6">
        <div class="rounded-[1.6rem] border border-slate-200 bg-white px-5 py-5 text-sm text-slate-500">
          Loading training workspace...
        </div>
      </div>

      <div v-else-if="loadError && !summary" class="px-6 py-6">
        <div class="rounded-[1.6rem] border border-rose-200 bg-rose-50 px-5 py-5 text-sm text-rose-700">
          <div class="flex items-center gap-2 font-semibold">
            <AlertTriangle class="h-4 w-4" />
            Initialization failed
          </div>
          <p class="mt-3 leading-6">{{ loadError }}</p>
        </div>
      </div>

      <template v-else-if="summary">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <section class="border-b border-slate-200 px-6 py-6">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Database class="h-4 w-4 text-amber-700" />
              Dataset
            </div>

            <label class="mt-4 block">
              <span class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Saved Matrix</span>
              <select
                v-model="selectedDatasetValue"
                class="h-12 w-full rounded-[1.2rem] border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                @change="handleDatasetChange"
              >
                <option value="" :disabled="hasSavedDatasets">Select a cleaned dataset</option>
                <option v-for="dataset in savedDatasets" :key="dataset.id" :value="String(dataset.id)">
                  {{ dataset.name }} / {{ dataset.row_count }} rows
                </option>
              </select>
            </label>

            <p class="mt-4 text-sm leading-6 text-slate-600">{{ datasetDescription }}</p>

            <div class="mt-5 space-y-3 border-t border-slate-200 pt-5 text-sm">
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Target</span>
                <span class="font-semibold text-slate-900">{{ targetLabel }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Source Scope</span>
                  <p class="mt-2 font-semibold text-slate-950">{{ formatScopeMode(sourceScope?.resolved_scope_type || sourceScope?.requested_mode) }}</p>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Rows Ready</span>
                <span class="font-semibold text-slate-900">{{ formatNumber(cleaningSummary?.training_ready_records || summary.dataset.usable_records) }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-500">Feature Dimensions</span>
                <span class="font-semibold text-slate-900">{{ formatNumber(activeTask?.dataset.feature_dimensions || summary.dataset.feature_dimensions) }}</span>
              </div>
            </div>

            <div
              v-if="!hasSavedDatasets"
              class="mt-5 rounded-[1.4rem] border border-dashed border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-500"
            >
              No cleaned dataset is available yet. Save one from the Cleaning page first.
            </div>
          </section>

          <section class="border-b border-slate-200 px-6 py-6">
            <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <SlidersHorizontal class="h-4 w-4 text-teal-700" />
              Run Configuration
            </div>

            <div class="mt-4">
              <label class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Algorithm</label>
              <select
                v-model="form.algorithm"
                class="h-12 w-full rounded-[1.2rem] border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
              >
                <option v-for="algorithm in summary.algorithms" :key="algorithm.key" :value="algorithm.key">
                  {{ algorithm.label }}
                </option>
              </select>
              <p class="mt-3 text-sm leading-6 text-slate-600">
                {{ currentAlgorithm?.description || 'Choose the estimator used for the next run.' }}
              </p>
            </div>

            <div class="mt-6 space-y-5">
              <label class="block">
                <div class="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-600">Rounds</span>
                  <span class="font-semibold text-slate-900">{{ form.hyperparameters.n_estimators }}</span>
                </div>
                <input
                  v-model.number="form.hyperparameters.n_estimators"
                  type="range"
                  min="20"
                  max="300"
                  step="10"
                  class="training-range w-full"
                >
              </label>

              <label class="block">
                <div class="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-600">Learning Rate</span>
                  <span class="font-semibold text-slate-900">{{ form.hyperparameters.learning_rate.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="form.hyperparameters.learning_rate"
                  type="range"
                  min="0.01"
                  max="0.30"
                  step="0.01"
                  class="training-range w-full"
                  :disabled="isRandomForest"
                >
              </label>

              <label class="block">
                <div class="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-600">Tree Depth</span>
                  <span class="font-semibold text-slate-900">{{ form.hyperparameters.max_depth }}</span>
                </div>
                <input
                  v-model.number="form.hyperparameters.max_depth"
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  class="training-range w-full"
                >
              </label>

              <label v-if="isCatBoost" class="block">
                <div class="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-600">L2 Regularization</span>
                  <span class="font-semibold text-slate-900">{{ form.hyperparameters.l2_leaf_reg.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="form.hyperparameters.l2_leaf_reg"
                  type="range"
                  min="0"
                  max="20"
                  step="0.5"
                  class="training-range w-full"
                >
              </label>

              <label v-if="isCatBoost" class="block">
                <div class="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span class="text-slate-600">Random Strength</span>
                  <span class="font-semibold text-slate-900">{{ form.hyperparameters.random_strength.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="form.hyperparameters.random_strength"
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  class="training-range w-full"
                >
              </label>
            </div>

            <div class="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
              <div class="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Validation Split</p>
                <p class="mt-2 font-semibold text-slate-900">{{ validationSplitPercent }}%</p>
              </div>
              <div class="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Random Seed</p>
                <p class="mt-2 font-semibold text-slate-900">{{ form.data_options.random_seed }}</p>
              </div>
            </div>
          </section>

          <section class="px-6 py-6">
            <div class="flex flex-col gap-3 sm:flex-row">
              <button
                class="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="starting || selectedCleanedDatasetId == null || usableRecords < 10"
                @click="handleStartTraining"
              >
                <Play class="h-4 w-4" />
                {{ starting ? 'Starting Run' : 'Start Training' }}
              </button>
              <button
                class="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!activeTask || cancelling"
                @click="handleCancelTraining"
              >
                <Square class="h-4 w-4" />
                {{ cancelling ? 'Cancelling' : 'Cancel Run' }}
              </button>
            </div>

            <p class="mt-4 text-sm leading-6 text-slate-500">
              Training is enabled once the cleaned dataset has at least 10 usable rows.
            </p>
          </section>
        </div>
      </template>
    </aside>

    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex min-h-full max-w-[1400px] flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
        <section class="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,rgba(255,252,246,0.98),rgba(247,243,233,0.98)_55%,rgba(239,246,248,0.98))] px-6 py-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)] sm:px-8 sm:py-8">
          <div class="pointer-events-none absolute -right-24 top-[-5rem] h-[18rem] w-[18rem] rounded-full bg-amber-200/30 blur-3xl" />
          <div class="pointer-events-none absolute bottom-[-7rem] right-[12%] h-[18rem] w-[18rem] rounded-full bg-cyan-200/25 blur-3xl" />

          <div class="relative grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)] xl:items-end">
            <div>
              <div class="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-700">
                <Sparkles class="h-3.5 w-3.5" />
                Live Training Monitor
              </div>
              <h2 class="mt-4 text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-4xl">
                {{ datasetTitle }}
              </h2>
              <p class="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-[15px]">
                  {{ activeTask?.status ? activeTask.status : 'ready' }}
              </p>

              <div class="mt-6 flex flex-wrap items-center gap-3">
                <span class="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]" :class="statusTone.chip">
                  {{ activeTask?.status ? activeTask.status : 'ready' }}
                </span>
                <span class="text-sm text-slate-400">
                  {{ currentAlgorithm?.label || formatTitleLabel(form.algorithm) }}
                </span>
                <span class="text-sm text-slate-500">/</span>
                <span class="text-sm text-slate-400">
                  {{ formatNumber(activeTask?.dataset.train_size || Math.round(usableRecords * (1 - form.data_options.validation_split))) }} train /
                  {{ formatNumber(activeTask?.dataset.validation_size || Math.round(usableRecords * form.data_options.validation_split)) }} validation
                </span>
              </div>

              <div v-if="loadError && summary" class="mt-6 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                {{ loadError }}
              </div>

              <div v-if="runWarnings.length > 0" class="mt-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                <div class="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <AlertTriangle class="h-4 w-4" />
                  Run warnings
                </div>
                <ul class="mt-3 space-y-2 text-sm leading-6 text-amber-700">
                  <li v-for="warning in runWarnings" :key="warning">- {{ warning }}</li>
                </ul>
              </div>
            </div>

            <div class="rounded-[1.7rem] border border-slate-200 bg-white/80 p-4 sm:p-5">
              <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div class="border-b border-slate-200 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Validation R2</p>
                  <p class="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{{ formatMetric(currentPoint?.val_r2) }}</p>
                </div>
                <div class="border-b border-slate-200 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:px-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">RMSE</p>
                  <p class="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{{ formatMetric(currentPoint?.val_rmse) }}</p>
                </div>
                <div class="border-b border-slate-200 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:px-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">MAE</p>
                  <p class="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">{{ formatMetric(currentPoint?.val_mae) }}</p>
                </div>
                <div class="sm:pl-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Progress</p>
                  <p class="mt-3 text-3xl font-semibold tracking-[-0.05em] text-slate-950">
                    {{ activeTask?.current_round || 0 }}/{{ activeTask?.total_rounds || form.hyperparameters.n_estimators }}
                  </p>
                </div>
              </div>

              <div class="mt-5">
                <div class="mb-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span>Training trajectory</span>
                  <span>{{ progressPercent }}%</span>
                </div>
                <div class="h-2.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    class="h-full rounded-full bg-gradient-to-r transition-all duration-500"
                    :class="statusTone.accent"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </div>
              </div>

              <div class="mt-5 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
                <div class="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target</p>
                  <p class="mt-2 font-semibold text-slate-950">{{ targetLabel }}</p>
                </div>
                <div class="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Scope</p>
                  <p class="mt-2 font-semibold text-slate-950">{{ formatScopeMode(sourceScope?.resolved_scope_type || sourceScope?.requested_mode) }}</p>
                </div>
                <div class="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">PCA</p>
                  <p class="mt-2 font-semibold text-slate-950">
                    {{ pcaInfo?.enabled ? `Enabled / ${formatPercent(pcaInfo.explained_variance_ratio)}` : 'Disabled' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-2">
          <div class="rounded-[1.8rem] border border-slate-200 bg-white/85 p-5 sm:p-6">
            <div class="mb-5 flex items-center justify-between gap-4">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Learning Trace</p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">R2 trajectory</h3>
              </div>
              <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <Activity class="h-3.5 w-3.5 text-teal-700" />
                Train vs validation
              </div>
            </div>

            <div class="h-[320px]">
              <div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                Start a run to populate the R2 trajectory.
              </div>
              <Line v-else :data="r2ChartData" :options="chartOptions" />
            </div>
          </div>

          <div class="rounded-[1.8rem] border border-slate-200 bg-white/85 p-5 sm:p-6">
            <div class="mb-5 flex items-center justify-between gap-4">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Error Trace</p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">Validation loss profile</h3>
              </div>
              <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <Waves class="h-3.5 w-3.5 text-rose-600" />
                RMSE and MAE
              </div>
            </div>

            <div class="h-[320px]">
              <div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                Error metrics appear once training begins.
              </div>
              <Line v-else :data="errorChartData" :options="chartOptions" />
            </div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div class="rounded-[1.8rem] border border-slate-200 bg-white/85 p-5 sm:p-6">
            <div class="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Data Provenance</p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">Dataset readiness and feature lineage</h3>
              </div>
              <div class="text-sm text-slate-400">
                {{ selectedFeatureColumns.length }} selected features
              </div>
            </div>

            <div class="mt-5 grid gap-4 md:grid-cols-2">
              <div class="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Database class="h-4 w-4 text-amber-700" />
                  Record flow
                </div>
                <dl class="mt-4 space-y-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Raw records</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.raw_records || activeTask?.dataset.total_records || summary?.dataset.total_records) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Target ready</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.target_ready_records) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Chemistry ready</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.chemistry_ready_records) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Training ready</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.training_ready_records || activeTask?.dataset.usable_records || summary?.dataset.usable_records) }}</dd>
                  </div>
                </dl>
              </div>

              <div class="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Target class="h-4 w-4 text-teal-700" />
                  Cleaning rules
                </div>
                <dl class="mt-4 space-y-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Missing target rows</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.dropped_by_reason.missing_target) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Missing cation SMILES</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.dropped_by_reason.missing_cation_smiles) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Missing anion SMILES</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.dropped_by_reason.missing_anion_smiles) }}</dd>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-500">Outliers removed</dt>
                    <dd class="font-semibold text-slate-950">{{ formatNumber(cleaningSummary?.outliers_removed || 0) }}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div class="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div class="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Orbit class="h-4 w-4 text-amber-600" />
                  Feature blocks
                </div>
                <div v-if="featureBlocks.length === 0" class="mt-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  Feature block dimensions become available after a run starts.
                </div>
                <div v-else class="mt-4 space-y-3">
                  <div
                    v-for="block in featureBlocks"
                    :key="block.key"
                    class="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <p class="font-semibold text-slate-950">{{ block.label }}</p>
                      <span class="text-sm text-slate-400">{{ block.dimensions }} dims</span>
                    </div>
                    <p class="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{{ formatTitleLabel(block.key) }}</p>
                  </div>
                </div>
              </div>

              <div class="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Layers3 class="h-4 w-4 text-amber-700" />
                    Active feature columns
                  </div>
                  <span class="text-xs uppercase tracking-[0.18em] text-slate-500">{{ selectedFeatureColumns.length }} total</span>
                </div>

                <div v-if="selectedFeatureColumns.length === 0" class="mt-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  Select a saved cleaned dataset to inspect the matrix columns.
                </div>
                <div v-else class="mt-4 flex flex-wrap gap-2">
                  <span
                    v-for="column in visibleFeatureColumns"
                    :key="column"
                    class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {{ formatColumnLabel(column) }}
                  </span>
                </div>
                <p v-if="selectedFeatureColumns.length > visibleFeatureColumns.length" class="mt-4 text-sm text-slate-500">
                  Showing the first {{ visibleFeatureColumns.length }} columns from the cleaned matrix.
                </p>
              </div>
            </div>
          </div>

          <div class="rounded-[1.8rem] border border-slate-200 bg-white/85 p-5 sm:p-6">
            <div class="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Run Archive</p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">Leaderboard</h3>
              </div>
              <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                <Trophy class="h-3.5 w-3.5 text-amber-600" />
                Best completed runs
              </div>
            </div>

            <div v-if="leaderboard.length === 0" class="mt-5 flex min-h-[420px] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm leading-6 text-slate-500">
              Completed runs will appear here once the first training session finishes.
            </div>
            <div v-else class="mt-5 overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-slate-200 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    <th class="px-3 py-3 font-semibold">Finished</th>
                    <th class="px-3 py-3 font-semibold">Algorithm</th>
                    <th class="px-3 py-3 font-semibold">Rows</th>
                    <th class="px-3 py-3 font-semibold">Val R2</th>
                    <th class="px-3 py-3 font-semibold">RMSE</th>
                    <th class="px-3 py-3 font-semibold">MAE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in leaderboard"
                    :key="row.taskId"
                    class="border-b border-slate-100 transition hover:bg-slate-50"
                  >
                    <td class="px-3 py-4 font-semibold text-slate-950">{{ formatDateTime(row.finishedAt) }}</td>
                    <td class="px-3 py-4 text-slate-600">{{ formatTitleLabel(row.algorithm) }}</td>
                    <td class="px-3 py-4 text-slate-600">{{ formatNumber(row.usableRecords) }}</td>
                    <td class="px-3 py-4 font-semibold text-teal-700">{{ formatMetric(row.valR2) }}</td>
                    <td class="px-3 py-4 font-semibold text-rose-600">{{ formatMetric(row.valRmse) }}</td>
                    <td class="px-3 py-4 font-semibold text-amber-600">{{ formatMetric(row.valMae) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-5 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
              <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ArrowUpRight class="h-4 w-4 text-amber-700" />
                Current run snapshot
              </div>
              <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Status</p>
                  {{ activeTask?.status ? activeTask.status : 'ready' }}
                </div>
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Started</p>
                  <p class="mt-2 font-semibold text-slate-950">{{ formatDateTime(activeTask?.started_at || activeTask?.created_at) }}</p>
                </div>
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Usable records</p>
                  <p class="mt-2 font-semibold text-slate-950">{{ formatNumber(activeTask?.dataset.usable_records || summary?.dataset.usable_records) }}</p>
                </div>
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Validation split</p>
                  <p class="mt-2 font-semibold text-slate-950">{{ formatPercent(activeTask?.dataset.filters.validation_split ?? form.data_options.validation_split, 0) }}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.training-range {
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: 9999px;
  background: linear-gradient(90deg, rgba(241, 204, 130, 0.9), rgba(94, 234, 212, 0.8));
  outline: none;
}

.training-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  border: 2px solid rgba(6, 12, 19, 0.9);
  background: #f8fafc;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.training-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 9999px;
  border: 2px solid rgba(6, 12, 19, 0.9);
  background: #f8fafc;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.training-range:disabled {
  opacity: 0.45;
}
</style>
