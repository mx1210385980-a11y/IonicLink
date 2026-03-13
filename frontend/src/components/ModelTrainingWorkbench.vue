<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Activity, AlertTriangle, Database, FlaskConical, Play, Settings2, SlidersHorizontal, Square, Trophy } from 'lucide-vue-next'
import { Chart as ChartJS, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Title, Tooltip } from 'chart.js'
import { Line } from 'vue-chartjs'
import {
  buildModelTrainingWebSocketUrl,
  cancelModelTraining,
  getModelTrainingCleaningSummary,
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

type LeaderboardRow = { taskId: string; finishedAt: string; algorithm: string; usableRecords: number; valR2: number; valRmse: number; valMae: number }
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
const refreshingCleaning = ref(false)
const socketRef = ref<WebSocket | null>(null)
const completedTaskIds = new Set<string>()

const form = reactive<ModelTrainingStartPayload>({
  target: 'cof',
  algorithm: 'gradient_boosting',
  features: { cation_fingerprint: true, anion_fingerprint: true, temperature: true, speed: false, load: false, potential: false, water_content: false, film_thickness: false, alkyl_chain_length: true },
  hyperparameters: { n_estimators: 120, learning_rate: 0.06, max_depth: 3 },
  data_options: { validation_split: 0.2, min_confidence: 0, max_records: null, random_seed: 42 },
  cleaning_options: { source_mode: 'group_library_fallback', drop_missing_target: true, require_dual_smiles: true },
  cleaned_dataset_id: null,
})

const history = computed(() => activeTask.value?.history || [])
const currentPoint = computed(() => activeTask.value?.current || null)
const usingSavedDataset = computed(() => selectedCleanedDatasetId.value != null)
const cleaningReadyCount = computed(() => summary.value?.cleaning.training_ready_records || 0)
const progressPercent = computed(() => Math.round((currentPoint.value?.progress || 0) * 100))
const statusTone = computed(() => activeTask.value?.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : activeTask.value?.status === 'failed' ? 'bg-rose-100 text-rose-700' : activeTask.value?.status === 'cancelled' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700')

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { usePointStyle: true, boxWidth: 10, color: '#475569' } } },
  scales: {
    x: { grid: { color: 'rgba(148,163,184,0.16)' }, ticks: { color: '#64748b' } },
    y: { grid: { color: 'rgba(148,163,184,0.16)' }, ticks: { color: '#64748b' } },
  },
}

const r2ChartData = computed(() => ({ labels: history.value.map((p) => String(p.round)), datasets: [{ label: 'Train R2', data: history.value.map((p) => p.train_r2), borderColor: '#0f172a', pointRadius: 0, tension: 0.22 }, { label: 'Validation R2', data: history.value.map((p) => p.val_r2), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.16)', fill: true, pointRadius: 0, tension: 0.22 }] }))
const errorChartData = computed(() => ({ labels: history.value.map((p) => String(p.round)), datasets: [{ label: 'Validation RMSE', data: history.value.map((p) => p.val_rmse), borderColor: '#e11d48', pointRadius: 0, tension: 0.22 }, { label: 'Validation MAE', data: history.value.map((p) => p.val_mae), borderColor: '#f59e0b', pointRadius: 0, tension: 0.22 }] }))

function formatMetric(value: number | null | undefined, digits = 4) { return value == null || Number.isNaN(Number(value)) ? '--' : Number(value).toFixed(digits) }
function formatDateTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : '--' }
function formatCoverage(value: number | null | undefined) { return value == null || Number.isNaN(Number(value)) ? '--' : `${Math.round(Number(value) * 100)}%` }

function hydrateDefaults(nextSummary: ModelTrainingSummary) {
  form.target = nextSummary.defaults.target
  form.algorithm = nextSummary.defaults.algorithm
  Object.assign(form.features, nextSummary.defaults.features)
  Object.assign(form.hyperparameters, nextSummary.defaults.hyperparameters)
  Object.assign(form.data_options, nextSummary.defaults.data_options)
  Object.assign(form.cleaning_options, nextSummary.defaults.cleaning_options)
}

async function refreshSavedDatasets() {
  const response = await listCleanedDatasets()
  savedDatasets.value = response.items
}

async function refreshTrainingSummary(datasetId?: number | null, applyDefaults: boolean = false) {
  const nextSummary = await getModelTrainingSummary(datasetId)
  summary.value = nextSummary
  if (applyDefaults) hydrateDefaults(nextSummary)
}

async function initialize() {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([refreshTrainingSummary(selectedCleanedDatasetId.value, true), refreshSavedDatasets()])
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to load training workspace.'
  } finally {
    loading.value = false
  }
}

function pushLeaderboard(snapshot: ModelTrainingTaskSnapshot) {
  if (snapshot.status !== 'completed' || !snapshot.current || completedTaskIds.has(snapshot.task_id)) return
  completedTaskIds.add(snapshot.task_id)
  leaderboard.value.unshift({ taskId: snapshot.task_id, finishedAt: snapshot.finished_at || snapshot.created_at, algorithm: snapshot.config.algorithm, usableRecords: snapshot.dataset.usable_records, valR2: snapshot.current.val_r2, valRmse: snapshot.current.val_rmse, valMae: snapshot.current.val_mae })
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

async function handleSourceChange() {
  loadError.value = ''
  try {
    await refreshTrainingSummary(selectedCleanedDatasetId.value, false)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to refresh dataset source.'
  }
}

async function handleRefreshCleaning() {
  if (usingSavedDataset.value) return
  refreshingCleaning.value = true
  loadError.value = ''
  try {
    summary.value = await getModelTrainingCleaningSummary({ ...form.cleaning_options })
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to refresh live cleaned source.'
  } finally {
    refreshingCleaning.value = false
  }
}

async function handleStartTraining() {
  if (!summary.value) return
  starting.value = true
  loadError.value = ''
  try {
    const payload: ModelTrainingStartPayload = { ...form, features: { ...form.features }, hyperparameters: { ...form.hyperparameters }, data_options: { ...form.data_options }, cleaning_options: { ...form.cleaning_options }, cleaned_dataset_id: selectedCleanedDatasetId.value }
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

onMounted(() => { void initialize() })
onBeforeUnmount(() => { closeSocket() })
watch(
  () => props.preselectedCleanedDatasetId,
  async (datasetId) => {
    const normalizedDatasetId = datasetId == null ? null : Number(datasetId)
    if (selectedCleanedDatasetId.value === normalizedDatasetId) return
    selectedCleanedDatasetId.value = normalizedDatasetId
    if (!loading.value) {
      await handleSourceChange()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] text-slate-900">
    <aside class="flex w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-white/85 px-6 py-6">
      <div class="mb-8 flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white"><FlaskConical class="h-5 w-5" /></div>
        <div><h1 class="text-xl font-bold tracking-tight">Predictive Model Training</h1><p class="text-sm text-slate-500">Train on live cleaned data or saved datasets.</p></div>
      </div>

      <div v-if="loading" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading training workspace...</div>
      <div v-else-if="loadError && !summary" class="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700"><AlertTriangle class="mb-2 h-4 w-4" />{{ loadError }}</div>

      <template v-else-if="summary">
        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <section class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Database class="h-4 w-4 text-sky-700" />Training Data Source</div>
            <select v-model="selectedCleanedDatasetId" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm" @change="handleSourceChange">
              <option :value="null">Live cleaned scope data</option>
              <option v-for="dataset in savedDatasets" :key="dataset.id" :value="dataset.id">{{ dataset.name }} - {{ dataset.row_count }} rows</option>
            </select>
            <p class="mt-3 text-xs text-slate-500">{{ usingSavedDataset ? 'Using a saved cleaned dataset.' : 'Using the live cleaned source below.' }}</p>
          </section>

          <section v-if="!usingSavedDataset" class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Settings2 class="h-4 w-4 text-cyan-700" />Live Cleaning Rules</div>
            <select v-model="form.cleaning_options.source_mode" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm">
              <option value="group_library_fallback">Current scope, fallback to group library</option>
              <option value="current_scope">Current scope only</option>
              <option value="group_library">Group library only</option>
            </select>
            <label class="mt-3 flex items-start gap-3 text-sm text-slate-700"><input v-model="form.cleaning_options.drop_missing_target" type="checkbox" class="mt-1 h-4 w-4 rounded" />Drop records without numeric COF</label>
            <label class="mt-2 flex items-start gap-3 text-sm text-slate-700"><input v-model="form.cleaning_options.require_dual_smiles" type="checkbox" class="mt-1 h-4 w-4 rounded" />Require both cation and anion SMILES</label>
            <p class="mt-3 text-xs text-slate-500">Raw {{ summary.cleaning.raw_records }} - Ready {{ summary.cleaning.training_ready_records }} - Source {{ summary.dataset.source_scope.label }}</p>
            <button class="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 disabled:opacity-60" :disabled="refreshingCleaning" @click="handleRefreshCleaning">{{ refreshingCleaning ? 'Refreshing...' : 'Refresh Live Cleaned Source' }}</button>
          </section>

          <section>
            <label class="mb-2 block text-sm font-semibold text-slate-700">Prediction Target</label>
            <select v-model="form.target" class="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm">
              <option v-for="target in summary.targets" :key="target.key" :value="target.key">{{ target.label }} - {{ target.available_count }} records</option>
            </select>
          </section>

          <section>
            <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Settings2 class="h-4 w-4 text-blue-600" />Feature Engineering</div>
            <div class="space-y-2 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <label v-for="feature in summary.features" :key="feature.key" class="flex items-start gap-3 rounded-2xl border px-3 py-3" :class="feature.disabled ? 'border-slate-100 bg-slate-100/80 opacity-60' : 'border-slate-200 bg-white'">
                <input v-model="form.features[feature.key as keyof typeof form.features]" :disabled="feature.disabled" type="checkbox" class="mt-1 h-4 w-4 rounded" />
                <div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><p class="text-sm font-semibold text-slate-800">{{ feature.label }}</p><span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{{ feature.available_count }}</span></div><p class="mt-1 text-xs text-slate-500">{{ feature.group }} - Coverage {{ formatCoverage(feature.coverage) }}</p></div>
              </label>
            </div>
          </section>

          <section class="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal class="h-4 w-4 text-blue-600" />Hyperparameters</div>
            <label class="mb-2 block text-sm text-slate-600">Algorithm</label>
            <select v-model="form.algorithm" class="mb-4 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm">
              <option v-for="algorithm in summary.algorithms" :key="algorithm.key" :value="algorithm.key">{{ algorithm.label }}</option>
            </select>
            <div class="mb-3 text-sm text-slate-600">Rounds: {{ form.hyperparameters.n_estimators }}</div>
            <input v-model="form.hyperparameters.n_estimators" type="range" min="20" max="300" step="10" class="mb-4 w-full accent-blue-600" />
            <div class="mb-3 text-sm text-slate-600">Learning Rate: {{ form.hyperparameters.learning_rate.toFixed(2) }}</div>
            <input v-model="form.hyperparameters.learning_rate" type="range" min="0.01" max="0.30" step="0.01" class="mb-4 w-full accent-blue-600" :disabled="form.algorithm === 'random_forest'" />
            <div class="mb-3 text-sm text-slate-600">Tree Depth: {{ form.hyperparameters.max_depth }}</div>
            <input v-model="form.hyperparameters.max_depth" type="range" min="1" max="8" step="1" class="w-full accent-blue-600" />
          </section>
        </div>

        <div class="mt-6 space-y-3">
          <button class="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-base font-semibold text-white disabled:opacity-60" :disabled="starting || !cleaningReadyCount" @click="handleStartTraining"><Play class="h-4 w-4" />Start Training Run</button>
          <button class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 disabled:opacity-60" :disabled="!activeTask || cancelling" @click="handleCancelTraining"><Square class="h-4 w-4" />Cancel Active Run</button>
        </div>
      </template>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto px-8 py-8">
      <div class="mx-auto max-w-[1180px] space-y-6">
        <section v-if="loadError && summary" class="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">{{ loadError }}</section>

        <section class="rounded-[30px] border border-slate-200/80 bg-white px-8 py-6 shadow-sm">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div><div class="mb-3 flex items-center gap-2"><Activity class="h-5 w-5 text-blue-600" /><h2 class="text-2xl font-bold tracking-tight">Live Training Monitor</h2></div><div class="flex items-center gap-3"><span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" :class="statusTone">{{ activeTask?.status ? activeTask.status.toUpperCase() : 'READY' }}</span><p class="text-sm text-slate-500">{{ activeTask?.status_message || 'Choose features and start a training run.' }}</p></div></div>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"><p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Validation R2</p><p class="mt-2 text-3xl font-black">{{ formatMetric(currentPoint?.val_r2) }}</p></div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"><p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">RMSE</p><p class="mt-2 text-3xl font-black">{{ formatMetric(currentPoint?.val_rmse) }}</p></div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"><p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">MAE</p><p class="mt-2 text-3xl font-black">{{ formatMetric(currentPoint?.val_mae) }}</p></div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4"><p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Progress</p><p class="mt-2 text-3xl font-black">{{ activeTask?.current_round || 0 }}/{{ activeTask?.total_rounds || 0 }}</p></div>
            </div>
          </div>
          <div class="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500" :style="{ width: `${progressPercent}%` }"></div></div>
        </section>

        <section class="grid gap-6 xl:grid-cols-2">
          <div class="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm"><h3 class="mb-2 text-lg font-bold">R2 Learning Curve</h3><div class="h-[320px]"><div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Start a run to populate the R2 trajectory.</div><Line v-else :data="r2ChartData" :options="chartOptions" /></div></div>
          <div class="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm"><h3 class="mb-2 text-lg font-bold">Validation Error Curve</h3><div class="h-[320px]"><div v-if="history.length === 0" class="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Error metrics will appear here once training begins.</div><Line v-else :data="errorChartData" :options="chartOptions" /></div></div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div class="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm">
            <div class="mb-4 flex items-center gap-2"><Database class="h-4 w-4 text-blue-600" /><h3 class="text-lg font-bold">Dataset Snapshot</h3></div>
            <div class="grid grid-cols-2 gap-3">
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Raw Records</p><p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.total_records || summary?.cleaning.raw_records || 0 }}</p></div>
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Cleaned Records</p><p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.cleaned_records || summary?.cleaning.training_ready_records || 0 }}</p></div>
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Usable Records</p><p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.usable_records || summary?.cleaning.training_ready_records || 0 }}</p></div>
              <div class="rounded-2xl bg-slate-50 p-4"><p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Feature Dims</p><p class="mt-2 text-2xl font-bold">{{ activeTask?.dataset?.feature_dimensions || 0 }}</p></div>
            </div>
          </div>

          <div class="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm">
            <div class="mb-4 flex items-center gap-2"><Trophy class="h-4 w-4 text-amber-500" /><h3 class="text-lg font-bold">Run Leaderboard</h3></div>
            <div v-if="leaderboard.length === 0" class="flex min-h-[240px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">Completed runs will be listed here for comparison.</div>
            <div v-else class="overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead><tr class="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-400"><th class="px-3 py-3 font-semibold">Run</th><th class="px-3 py-3 font-semibold">Algorithm</th><th class="px-3 py-3 font-semibold">Records</th><th class="px-3 py-3 font-semibold">Val R2</th><th class="px-3 py-3 font-semibold">RMSE</th><th class="px-3 py-3 font-semibold">MAE</th></tr></thead>
                <tbody><tr v-for="row in leaderboard" :key="row.taskId" class="border-b border-slate-100"><td class="px-3 py-3 font-semibold text-slate-900">{{ formatDateTime(row.finishedAt) }}</td><td class="px-3 py-3">{{ row.algorithm.replace(/_/g, ' ') }}</td><td class="px-3 py-3">{{ row.usableRecords }}</td><td class="px-3 py-3 text-blue-700">{{ formatMetric(row.valR2) }}</td><td class="px-3 py-3 text-rose-600">{{ formatMetric(row.valRmse) }}</td><td class="px-3 py-3 text-amber-600">{{ formatMetric(row.valMae) }}</td></tr></tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
