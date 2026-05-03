<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  ChevronDown,
  Database,
  ExternalLink,
  Layers,
  Loader2,
  Play,
  Search,
  Sparkles,
  Square,
  Trophy,
} from 'lucide-vue-next'
import {
  BarElement,
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js'
import { Bar, Line } from 'vue-chartjs'
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

type LeaderboardRow = {
  taskId: string
  finishedAt: string
  algorithm: string
  usableRecords: number
  valR2: number
  valRmse: number
  valMae: number
}

type ComparisonRow = {
  algorithm: string
  taskId: string
  status: 'completed' | 'failed' | 'cancelled'
  valR2: number | null
  valRmse: number | null
  valMae: number | null
  finishedAt: string
  error?: string | null
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
const showAdvanced = ref(false)

// 全算法对比模式
const compareMode = ref(false)
const compareQueue = ref<string[]>([])
const compareResults = ref<ComparisonRow[]>([])
const compareTotal = ref(0)
const compareCurrentAlgorithm = ref<string | null>(null)

// 自动调参模式（仅作用于"开始训练"那一次任务，对比模式各算法走默认参数）
const tuneRequested = ref(false)

const emit = defineEmits<{
  'open-knowledge': []
  'inspect-record': [payload: {
    literatureId?: number | null
    recordId?: number | null
    rowIndex?: number | null
    source: 'val' | 'test'
    actual: number
    predicted: number
    residual: number
    absResidual: number
  }]
}>()

const form = reactive<ModelTrainingStartPayload>({
  target: 'Target_COF',
  algorithm: 'gradient_boosting',
  hyperparameters: { n_estimators: 120, learning_rate: 0.06, max_depth: 3, l2_leaf_reg: 3, random_strength: 1 },
  data_options: { validation_split: 0.2, min_confidence: 0, max_records: null, random_seed: 42, split_strategy: 'k_fold', cv_folds: 5 },
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
const runWarnings = computed(() => activeTask.value?.warnings || [])
const isRandomForest = computed(() => form.algorithm === 'random_forest')
const usableRecords = computed(() => activeTask.value?.dataset.usable_records || summary.value?.dataset.usable_records || 0)
const progressPercent = computed(() => Math.round((currentPoint.value?.progress || 0) * 100))
const validationSplitPercent = computed(() => Math.round((form.data_options.validation_split || 0) * 100))
const targetLabel = computed(() => summary.value?.dataset.target?.label || formatColumnLabel(summary.value?.dataset.target_column || form.target))
const datasetTitle = computed(() => selectedDataset.value?.name || summary.value?.dataset.name || '训练工作台')

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
      label: '训练集 R²',
      data: history.value.map((point) => point.train_r2),
      borderColor: '#b7791f',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
    {
      label: '验证集 R²',
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
      label: '验证集 RMSE',
      data: history.value.map((point) => point.val_rmse),
      borderColor: '#e11d48',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
    {
      label: '验证集 MAE',
      data: history.value.map((point) => point.val_mae),
      borderColor: '#d97706',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0.28,
    },
  ],
}))

// ── Insights：来自后端训练完成时计算的预测样本 + 特征重要性 ──────────────
const insights = computed(() => activeTask.value?.insights || null)
const predictionSamples = computed(() => insights.value?.prediction_samples || [])
const testSamples = computed(() => insights.value?.test_samples || [])
const featureImportances = computed(() => (insights.value?.feature_importance || []).slice(0, 10))
const testMetrics = computed(() => activeTask.value?.test_metrics || null)

const allScatterSamples = computed(() => [
  ...predictionSamples.value,
  ...testSamples.value,
])

// 异常样本诊断：把验证 OOF 和测试样本合起来，按残差降序取 Top 10
type DiagSample = {
  source: 'val' | 'test'
  recordId: number | null
  literatureId: number | null
  actual: number
  predicted: number
  residual: number
  absResidual: number
  rowIndex: number | null
}

function nullableNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const topResiduals = computed<DiagSample[]>(() => {
  const merged: DiagSample[] = []
  for (const s of predictionSamples.value) {
    merged.push({
      source: 'val',
      recordId: nullableNumber(s.record_id),
      literatureId: nullableNumber(s.literature_id),
      actual: Number(s.actual),
      predicted: Number(s.predicted),
      residual: Number(s.residual ?? (Number(s.predicted) - Number(s.actual))),
      absResidual: Number(s.abs_residual ?? Math.abs(Number(s.predicted) - Number(s.actual))),
      rowIndex: nullableNumber(s.row_index),
    })
  }
  for (const s of testSamples.value) {
    merged.push({
      source: 'test',
      recordId: nullableNumber(s.record_id),
      literatureId: nullableNumber(s.literature_id),
      actual: Number(s.actual),
      predicted: Number(s.predicted),
      residual: Number(s.residual ?? (Number(s.predicted) - Number(s.actual))),
      absResidual: Number(s.abs_residual ?? Math.abs(Number(s.predicted) - Number(s.actual))),
      rowIndex: nullableNumber(s.row_index),
    })
  }
  return merged
    .filter((s) => Number.isFinite(s.absResidual))
    .sort((a, b) => b.absResidual - a.absResidual)
    .slice(0, 10)
})

function suspiciousFlag(sample: DiagSample): { kind: 'impossible' | 'extreme' | null; hint: string } {
  if (sample.actual < 0) return { kind: 'impossible', hint: 'COF 物理上不可为负，几乎肯定是提取错误。' }
  if (sample.predicted < 0) return { kind: 'impossible', hint: '模型预测出负 COF，建议检查特征是否有异常输入。' }
  if (sample.actual > 2) return { kind: 'extreme', hint: '极少见的高摩擦区间——请核对原文是否真是 μCOF（可能是 ΔμCOF 或其他物理量）。' }
  return { kind: null, hint: '' }
}

function handleInspectRecord(sample: DiagSample) {
  emit('inspect-record', {
    literatureId: sample.literatureId,
    recordId: sample.recordId,
    rowIndex: sample.rowIndex,
    source: sample.source,
    actual: sample.actual,
    predicted: sample.predicted,
    residual: sample.residual,
    absResidual: sample.absResidual,
  })
}

const predictionRange = computed(() => {
  const samples = allScatterSamples.value
  if (!samples.length) return { min: 0, max: 1 }
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const sample of samples) {
    if (sample.actual < min) min = sample.actual
    if (sample.predicted < min) min = sample.predicted
    if (sample.actual > max) max = sample.actual
    if (sample.predicted > max) max = sample.predicted
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  const padding = Math.max(0.05, (max - min) * 0.08)
  return { min: min - padding, max: max + padding }
})

const predictionScatterData = computed(() => {
  const valSamples = predictionSamples.value
  const testSamplesData = testSamples.value
  const { min, max } = predictionRange.value
  return {
    datasets: [
      {
        type: 'line' as const,
        label: 'Y = X 参考线',
        data: [
          { x: min, y: min },
          { x: max, y: max },
        ],
        borderColor: 'rgba(148,163,184,0.7)',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        showLine: true,
        fill: false,
      },
      {
        type: 'line' as const,
        label: `验证集 (CV) · ${valSamples.length}`,
        data: valSamples.map((sample) => ({ x: sample.actual, y: sample.predicted })),
        backgroundColor: 'rgba(91, 86, 234, 0.55)',
        borderColor: 'rgba(255,255,255,0.7)',
        borderWidth: 0.8,
        pointRadius: 4,
        pointHoverRadius: 6,
        showLine: false,
      },
      {
        type: 'line' as const,
        label: `测试集（隔离）· ${testSamplesData.length}`,
        data: testSamplesData.map((sample) => ({ x: sample.actual, y: sample.predicted })),
        backgroundColor: 'rgba(239, 68, 68, 0.78)',
        borderColor: 'rgba(255,255,255,0.85)',
        borderWidth: 1,
        pointRadius: 5.5,
        pointHoverRadius: 8,
        pointStyle: 'rectRot' as const,
        showLine: false,
      },
    ],
  }
})

const predictionScatterOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: {
      labels: {
        usePointStyle: true,
        boxWidth: 10,
        color: 'rgba(51,65,85,0.82)',
        padding: 14,
        font: { size: 11, weight: 600 },
      },
    },
    tooltip: {
      backgroundColor: '#ffffff',
      titleColor: '#0f172a',
      bodyColor: '#475569',
      borderColor: 'rgba(148,163,184,0.2)',
      borderWidth: 1,
      callbacks: {
        label: (ctx: any) => {
          const x = Number(ctx.parsed?.x ?? 0)
          const y = Number(ctx.parsed?.y ?? 0)
          if (ctx.dataset.label === 'Y = X') return `Y = X (${x.toFixed(3)}, ${y.toFixed(3)})`
          return `真实 ${x.toFixed(3)}  /  预测 ${y.toFixed(3)}  /  残差 ${(y - x).toFixed(3)}`
        },
      },
    },
  },
  scales: {
    x: {
      type: 'linear' as const,
      title: { display: true, text: '真实值', color: 'rgba(71,85,105,0.78)', font: { size: 11, weight: 600 } },
      min: predictionRange.value.min,
      max: predictionRange.value.max,
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)' },
    },
    y: {
      type: 'linear' as const,
      title: { display: true, text: '预测值', color: 'rgba(71,85,105,0.78)', font: { size: 11, weight: 600 } },
      min: predictionRange.value.min,
      max: predictionRange.value.max,
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)' },
    },
  },
}))

// 数据切分策略 ─────────────────────────────────────────────────
const splitOptions = computed(() => summary.value?.split_options || [])
const activeSplitOption = computed(() =>
  splitOptions.value.find((opt) => opt.key === form.data_options.split_strategy) || null,
)

// 自动调参 ─────────────────────────────────────────────────────
const tuneProgress = computed(() => activeTask.value?.tune_progress || null)
const tuneActive = computed(() => Boolean(tuneProgress.value?.active))
const tuneSearched = computed(() => Number(tuneProgress.value?.searched || 0))
const tuneTotal = computed(() => Number(tuneProgress.value?.total || 0))
const tuneBestScore = computed(() => {
  const v = tuneProgress.value?.best_score
  return typeof v === 'number' && Number.isFinite(v) ? v : null
})
const tuneBestParamEntries = computed(() => {
  const params = tuneProgress.value?.best_params
  if (!params || typeof params !== 'object') return []
  return Object.entries(params as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: Array.isArray(v) ? `[${v.join(', ')}]` : String(v),
  }))
})

// 算法对比 ─────────────────────────────────────────────────────
const compareSucceeded = computed(() => compareResults.value.filter((row) => row.status === 'completed' && row.valR2 != null))
const compareSorted = computed(() => [...compareSucceeded.value].sort((a, b) => Number(b.valR2) - Number(a.valR2)))
const compareBestAlgorithm = computed(() => compareSorted.value[0] || null)
const compareProgressLabel = computed(() => {
  if (!compareMode.value && !compareTotal.value) return ''
  const done = compareResults.value.length
  const total = compareTotal.value || done
  return `${done} / ${total}`
})
const compareCurrentLabel = computed(() => algorithmLabelZh(compareCurrentAlgorithm.value))

const compareChartData = computed(() => ({
  labels: compareSorted.value.map((row) => algorithmLabelZh(row.algorithm)),
  datasets: [
    {
      label: '验证集 R²',
      data: compareSorted.value.map((row) => Number(row.valR2 || 0)),
      backgroundColor: compareSorted.value.map((_, idx) => idx === 0 ? 'rgba(91, 86, 234, 0.85)' : 'rgba(148, 163, 184, 0.6)'),
      borderRadius: 6,
      borderSkipped: false as const,
    },
  ],
}))

const compareChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#ffffff',
      titleColor: '#0f172a',
      bodyColor: '#475569',
      borderColor: 'rgba(148,163,184,0.2)',
      borderWidth: 1,
      callbacks: {
        label: (ctx: any) => {
          const row = compareSorted.value[ctx.dataIndex]
          if (!row) return `R²：${Number(ctx.parsed.x).toFixed(4)}`
          return [
            `R² = ${formatMetric(row.valR2, 3)}`,
            `RMSE = ${formatMetric(row.valRmse, 3)}`,
            `MAE = ${formatMetric(row.valMae, 3)}`,
          ]
        },
      },
    },
  },
  scales: {
    x: {
      min: 0,
      max: 1,
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)', callback: (v: any) => Number(v).toFixed(2) },
    },
    y: {
      grid: { display: false },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.85)', font: { size: 11, weight: 500 } },
    },
  },
}))

const featureImportanceChartData = computed(() => ({
  labels: featureImportances.value.map((entry) => formatColumnLabel(entry.feature)),
  datasets: [
    {
      label: '重要性',
      data: featureImportances.value.map((entry) => Number(entry.importance)),
      backgroundColor: 'rgba(91, 86, 234, 0.78)',
      borderRadius: 6,
      borderSkipped: false as const,
    },
  ],
}))

const featureImportanceChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#ffffff',
      titleColor: '#0f172a',
      bodyColor: '#475569',
      borderColor: 'rgba(148,163,184,0.2)',
      borderWidth: 1,
      callbacks: { label: (ctx: any) => `${ctx.label}：${Number(ctx.parsed.x).toFixed(4)}` },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(148,163,184,0.12)' },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.72)' },
    },
    y: {
      grid: { display: false },
      border: { color: 'rgba(148,163,184,0.18)' },
      ticks: { color: 'rgba(71,85,105,0.85)', font: { size: 11, weight: 500 } },
    },
  },
}))

function algorithmLabelZh(key: string | null | undefined) {
  switch (key) {
    case 'gradient_boosting': return '梯度提升（Gradient Boosting）'
    case 'random_forest': return '随机森林（Random Forest）'
    case 'catboost': return 'CatBoost'
    case 'xgboost': return '极端梯度提升（XGBoost）'
    case 'svr': return '支持向量回归（SVR）'
    case 'mlp': return '多层感知机（MLP）'
    case 'linear_regression': return '线性回归（Linear Regression）'
    default: return formatTitleLabel(key || '')
  }
}

function statusLabelZh(status: string | null | undefined) {
  switch (status) {
    case 'completed': return '已完成'
    case 'running': return '训练中'
    case 'failed': return '失败'
    case 'cancelled': return '已中止'
    case 'queued': return '排队中'
    default: return '就绪'
  }
}

function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'completed': return 'bg-[#e8fff2] text-[#0b9d63]'
    case 'running': return 'bg-[#edf2ff] text-[#3d56d2]'
    case 'failed': return 'bg-[#fff5f6] text-[#cf334f]'
    case 'cancelled': return 'bg-[#fff4da] text-[#c97a00]'
    default: return 'bg-[#f1f5f9] text-slate-600'
  }
}

function formatMetric(value: number | null | undefined, digits = 4) {
  return value == null || Number.isNaN(Number(value)) ? '--' : Number(value).toFixed(digits)
}

function formatNumber(value: number | null | undefined) {
  return value == null || Number.isNaN(Number(value)) ? '--' : new Intl.NumberFormat().format(Number(value))
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
      void onTaskTerminal(payload.task)
    }
  }
}

function recordCompareResult(snapshot: ModelTrainingTaskSnapshot) {
  const existing = compareResults.value.find((row) => row.taskId === snapshot.task_id)
  const row: ComparisonRow = {
    algorithm: snapshot.config.algorithm,
    taskId: snapshot.task_id,
    status: (snapshot.status as ComparisonRow['status']) || 'cancelled',
    valR2: snapshot.current?.val_r2 ?? null,
    valRmse: snapshot.current?.val_rmse ?? null,
    valMae: snapshot.current?.val_mae ?? null,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    error: snapshot.error,
  }
  if (existing) Object.assign(existing, row)
  else compareResults.value.push(row)
}

async function onTaskTerminal(snapshot: ModelTrainingTaskSnapshot) {
  if (!compareMode.value) return
  recordCompareResult(snapshot)
  if (snapshot.status === 'cancelled') {
    // 用户主动取消整个对比流程
    compareMode.value = false
    compareQueue.value = []
    compareCurrentAlgorithm.value = null
    return
  }
  if (compareQueue.value.length) {
    await runNextCompareItem()
  } else {
    compareMode.value = false
    compareCurrentAlgorithm.value = null
  }
}

async function runNextCompareItem() {
  const next = compareQueue.value.shift()
  if (!next) {
    compareMode.value = false
    compareCurrentAlgorithm.value = null
    return
  }
  compareCurrentAlgorithm.value = next
  form.algorithm = next
  loadError.value = ''
  await handleStartTraining()
  // 启动失败时（loadError 被设置），WebSocket 不会触发完成事件，需手动推进队列
  if (loadError.value) {
    compareResults.value.push({
      algorithm: next,
      taskId: `error-${Date.now()}`,
      status: 'failed',
      valR2: null,
      valRmse: null,
      valMae: null,
      finishedAt: new Date().toISOString(),
      error: loadError.value,
    })
    if (compareQueue.value.length) {
      await runNextCompareItem()
    } else {
      compareMode.value = false
      compareCurrentAlgorithm.value = null
    }
  }
}

async function handleCompareAll() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (compareMode.value || activeTask.value?.status === 'running') return
  const algorithms = summary.value.algorithms.map((alg) => alg.key)
  if (!algorithms.length) return
  compareResults.value = []
  compareQueue.value = algorithms.slice()
  compareTotal.value = algorithms.length
  compareMode.value = true
  await runNextCompareItem()
}

async function handleStopCompare() {
  if (!compareMode.value) return
  compareQueue.value = []
  if (activeTask.value && activeTask.value.status === 'running') {
    await handleCancelTraining()
  } else {
    compareMode.value = false
    compareCurrentAlgorithm.value = null
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
      tune: tuneRequested.value && !compareMode.value,
    }
    const response = await startModelTraining(payload)
    applyTaskSnapshot(response.task)
    openSocket(response.task.task_id)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || 'Failed to start training.'
  } finally {
    starting.value = false
    tuneRequested.value = false  // 一次性标志，下次"开始训练"恢复默认
  }
}

async function handleAutoTune() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (compareMode.value || activeTask.value?.status === 'running') return
  tuneRequested.value = true
  await handleStartTraining()
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
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden bg-[#f1f5f9] p-3">
    <!-- ─── 顶部状态条 ─────────────────────────────────────────────── -->
    <section class="shell-surface flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Database class="h-4 w-4 shrink-0 text-[#7d8eaa]" />
        <h1 class="truncate text-[0.95rem] font-semibold text-slate-900">{{ datasetTitle }}</h1>
        <span
          v-if="usableRecords"
          class="shrink-0 rounded-full bg-[#edf2ff] px-2.5 py-0.5 text-xs font-semibold text-[#3d56d2]"
        >
          {{ formatNumber(usableRecords) }} 条
        </span>
        <span
          v-if="targetLabel"
          class="shrink-0 rounded-full bg-[#fff4da] px-2.5 py-0.5 text-xs font-semibold text-[#c97a00]"
        >
          预测 {{ targetLabel }}
        </span>
        <span
          class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="statusBadgeClass(activeTask?.status)"
        >
          {{ statusLabelZh(activeTask?.status) }}
        </span>
        <span
          v-if="activeTask?.status === 'running' && !compareMode"
          class="shrink-0 text-xs font-medium text-slate-500 tabular-nums"
        >
          {{ activeTask?.current_round || 0 }} / {{ activeTask?.total_rounds || form.hyperparameters.n_estimators }} 轮
        </span>
        <span
          v-if="compareMode"
          class="shrink-0 rounded-full bg-[#5b56ea]/10 px-2.5 py-0.5 text-xs font-semibold text-[#5b56ea]"
        >
          对比中 {{ compareProgressLabel }} · {{ compareCurrentLabel }}
        </span>
        <span
          v-if="tuneActive"
          class="shrink-0 rounded-full bg-[#fff4da] px-2.5 py-0.5 text-xs font-semibold text-[#c97a00]"
        >
          调参中 {{ tuneSearched }} / {{ tuneTotal }}<template v-if="tuneBestScore !== null"> · 当前最佳 R²={{ tuneBestScore.toFixed(3) }}</template>
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button
          v-if="!compareMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] bg-[#5b56ea] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_10px_24px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
          :disabled="starting || selectedCleanedDatasetId == null || usableRecords < 10 || activeTask?.status === 'running'"
          @click="handleStartTraining"
        >
          <Loader2 v-if="starting" class="h-3.5 w-3.5 animate-spin" />
          <Play v-else class="h-3.5 w-3.5" />
          {{ starting ? '启动中' : '开始训练' }}
        </button>
        <button
          v-if="!compareMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] border border-[#5b56ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#5b56ea] transition hover:bg-[#f5f7ff] disabled:cursor-not-allowed disabled:border-[#cfd2f3] disabled:text-[#cfd2f3]"
          :disabled="starting || selectedCleanedDatasetId == null || usableRecords < 10 || activeTask?.status === 'running' || !summary"
          title="对当前算法做小规模网格搜索，自动找到最佳超参数后再训练"
          @click="handleAutoTune"
        >
          <Sparkles class="h-3.5 w-3.5" />
          自动调参
        </button>
        <button
          v-if="!compareMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] border border-[#5b56ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#5b56ea] transition hover:bg-[#f5f7ff] disabled:cursor-not-allowed disabled:border-[#cfd2f3] disabled:text-[#cfd2f3]"
          :disabled="starting || selectedCleanedDatasetId == null || usableRecords < 10 || activeTask?.status === 'running' || !summary || !summary.algorithms.length"
          title="依次跑全部算法，自动选出表现最好的一个"
          @click="handleCompareAll"
        >
          <Layers class="h-3.5 w-3.5" />
          全部算法对比
        </button>
        <button
          v-if="compareMode"
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#ffd4da] bg-white px-2.5 py-1.5 text-xs font-medium text-[#cf334f] transition hover:bg-[#fff5f6]"
          @click="handleStopCompare"
        >
          <Square class="h-3.5 w-3.5" />
          停止对比
        </button>
        <button
          v-if="!compareMode"
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#f8fbff] hover:text-slate-900"
          :disabled="!activeTask || activeTask.status !== 'running' || cancelling"
          @click="handleCancelTraining"
        >
          <Square class="h-3.5 w-3.5" />
          {{ cancelling ? '中止中' : '中止' }}
        </button>
        <span class="mx-1 h-5 w-px bg-[#e2e8f0]" />
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#f8fbff] hover:text-slate-900"
          @click="$emit('open-knowledge')"
        >
          返回知识库
        </button>
      </div>

      <p
        v-if="loadError"
        class="basis-full rounded-[0.6rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-1.5 text-xs text-[#cf334f]"
      >
        {{ loadError }}
      </p>
      <div
        v-if="activeTask?.status === 'running'"
        class="basis-full"
      >
        <div class="h-1.5 overflow-hidden rounded-full bg-[#eef2f6]">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#5b56ea] via-[#7d6cff] to-[#a594ff] transition-all duration-500"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <!-- ── 左：训练设置 ─────────────────────────────── -->
      <aside class="flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#e2e8f0] bg-white">
        <div class="border-b border-[#eef2f6] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">训练设置</p>
        </div>

        <div v-if="loading" class="px-4 py-4 text-sm text-slate-500">
          正在加载训练工作台...
        </div>

        <div v-else-if="!summary && loadError" class="px-4 py-4">
          <div class="rounded-[0.7rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-3 text-sm text-[#cf334f]">
            <div class="flex items-center gap-1.5 font-semibold">
              <AlertTriangle class="h-3.5 w-3.5" />
              初始化失败
            </div>
            <p class="mt-1.5 leading-5">{{ loadError }}</p>
          </div>
        </div>

        <template v-else-if="summary">
          <div class="min-h-0 flex-1 space-y-5 overflow-y-auto custom-scrollbar p-4">
            <!-- ① 数据集 -->
            <section>
              <p class="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#5b56ea] text-[9px] text-white">1</span>
                数据集
              </p>
              <select
                v-model="selectedDatasetValue"
                class="h-10 w-full rounded-[0.6rem] border border-[#e2e8f0] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                @change="handleDatasetChange"
              >
                <option value="" :disabled="hasSavedDatasets">选择已清洗的数据集</option>
                <option v-for="dataset in savedDatasets" :key="dataset.id" :value="String(dataset.id)">
                  {{ dataset.name }} · {{ dataset.row_count }} 条
                </option>
              </select>
              <div v-if="!hasSavedDatasets" class="mt-2 rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-2.5 text-xs text-slate-500">
                尚无已清洗的数据集，请先到"知识库"页保存一份。
              </div>
              <div v-else class="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                <div class="rounded-[0.55rem] bg-[#f8fafc] px-2 py-2">
                  <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fa0ba]">目标</p>
                  <p class="mt-0.5 truncate font-semibold text-slate-900">{{ targetLabel }}</p>
                </div>
                <div class="rounded-[0.55rem] bg-[#f8fafc] px-2 py-2">
                  <p
                    class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fa0ba]"
                    title="平台会自动留出 ~15% 作为测试集，绝不参与训练"
                  >行数</p>
                  <p class="mt-0.5 font-semibold text-slate-900">{{ formatNumber(usableRecords) }}</p>
                </div>
                <div class="rounded-[0.55rem] bg-[#f8fafc] px-2 py-2">
                  <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fa0ba]">特征</p>
                  <p class="mt-0.5 font-semibold text-slate-900">{{ formatNumber(activeTask?.dataset.feature_dimensions || summary.dataset.feature_dimensions) }}</p>
                </div>
              </div>
              <div
                v-if="hasSavedDatasets && (activeTask?.dataset?.test_size || summary.dataset?.test_size)"
                class="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500"
              >
                <span class="rounded-md bg-[#eef2ff] px-1.5 py-0.5 text-[#3d56d2]">
                  训练池 {{ formatNumber(activeTask?.dataset?.pool_size || summary.dataset?.pool_size) }}
                </span>
                <span class="rounded-md bg-[#fff5f6] px-1.5 py-0.5 text-[#cf334f]">
                  测试集 {{ formatNumber(activeTask?.dataset?.test_size || summary.dataset?.test_size) }}（隔离）
                </span>
              </div>
            </section>

            <!-- ② 算法 -->
            <section>
              <p class="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#5b56ea] text-[9px] text-white">2</span>
                算法
              </p>
              <div class="space-y-1.5">
                <label
                  v-for="algorithm in summary.algorithms"
                  :key="algorithm.key"
                  class="flex cursor-pointer items-start gap-2 rounded-[0.65rem] border px-3 py-2 transition"
                  :class="form.algorithm === algorithm.key
                    ? 'border-[#aebdfc] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/40'
                    : 'border-[#eef2f6] bg-white hover:border-[#d8e0eb]'"
                >
                  <input
                    v-model="form.algorithm"
                    type="radio"
                    :value="algorithm.key"
                    class="mt-1 h-3.5 w-3.5 border-slate-300 text-[#5b56ea] focus:ring-[#5b56ea]"
                  >
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-slate-900">{{ algorithmLabelZh(algorithm.key) }}</p>
                    <p v-if="algorithm.description" class="mt-0.5 text-[11px] leading-snug text-slate-500">
                      {{ algorithm.description }}
                    </p>
                  </div>
                </label>
              </div>
            </section>

            <!-- ③ 高级设置（默认折叠） -->
            <section>
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-[0.6rem] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:bg-white"
                @click="showAdvanced = !showAdvanced"
              >
                <span>高级设置（超参数）</span>
                <ChevronDown class="h-3.5 w-3.5 transition" :class="showAdvanced ? 'rotate-180 text-[#5b56ea]' : ''" />
              </button>

              <div v-if="showAdvanced" class="mt-2 space-y-4 rounded-[0.6rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3">
                <label class="block">
                  <div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span
                      class="font-semibold text-slate-700"
                      title="决定要训练多少棵树或多少轮迭代。值越大模型越复杂，但训练越慢。"
                    >训练轮次</span>
                    <span class="font-semibold text-slate-900 tabular-nums">{{ form.hyperparameters.n_estimators }}</span>
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
                  <div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span
                      class="font-semibold text-slate-700"
                      title="每棵树对最终预测的贡献权重。一般 0.05-0.10 为佳；越小越稳健，但需要更多轮次。"
                    >学习率</span>
                    <span
                      class="font-semibold tabular-nums"
                      :class="isRandomForest ? 'text-slate-300' : 'text-slate-900'"
                    >
                      {{ isRandomForest ? '不适用' : form.hyperparameters.learning_rate.toFixed(2) }}
                    </span>
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
                  <div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span
                      class="font-semibold text-slate-700"
                      title="单棵树的最大层数。值越大越能拟合复杂关系，但也更容易过拟合。"
                    >树深度</span>
                    <span class="font-semibold text-slate-900 tabular-nums">{{ form.hyperparameters.max_depth }}</span>
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

                <div v-if="splitOptions.length" class="border-t border-[#eef2f6] pt-3">
                  <label class="block text-xs">
                    <span
                      class="mb-1 block font-semibold text-slate-700"
                      title="影响顶部 R² / RMSE / MAE 的计算方式：K 折交叉验证更可靠，单次随机切分更快但容易虚高"
                    >数据切分策略</span>
                    <select
                      v-model="form.data_options.split_strategy"
                      class="h-8 w-full rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2 text-xs text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                    >
                      <option v-for="opt in splitOptions" :key="opt.key" :value="opt.key">
                        {{ opt.label }}
                      </option>
                    </select>
                    <p v-if="activeSplitOption?.description" class="mt-1.5 text-[11px] leading-snug text-slate-500">
                      {{ activeSplitOption.description }}
                    </p>
                  </label>
                </div>

                <p class="text-[11px] leading-5 text-slate-500">
                  随机种子 {{ form.data_options.random_seed }}<template v-if="form.data_options.split_strategy === 'random_holdout'"> · 验证集占比 {{ validationSplitPercent }}%</template><template v-else> · 折数 {{ form.data_options.cv_folds || 5 }}</template>
                </p>
              </div>
            </section>

            <div
              v-if="!hasSavedDatasets || usableRecords < 10"
              class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-2.5 text-xs leading-5 text-slate-500"
            >
              数据集就绪条件：可用样本 ≥ 10 条。
            </div>
          </div>
        </template>
      </aside>

      <!-- ── 右：训练监控 ─────────────────────────────── -->
      <main class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#e2e8f0] bg-white">
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar p-4">
          <!-- 4 个核心指标：训练 / 验证 / 测试 / 进度 -->
          <section class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div class="rounded-[0.85rem] border border-[#eef2f6] bg-white px-4 py-3">
              <p
                class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]"
                title="模型对自己学过的训练集的拟合程度。一般会很高（&gt;0.9）；如果连训练集 R² 都低，说明模型欠拟合，特征或算法不够强。"
              >
                训练集 R²
              </p>
              <p class="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                {{ formatMetric(currentPoint?.train_r2, 3) }}
              </p>
              <p class="mt-1 text-[10px] text-slate-400">
                模型学过的数据 · {{ formatNumber(activeTask?.dataset?.train_size) }} 行
              </p>
            </div>

            <div class="rounded-[0.85rem] border border-[#eef2f6] bg-white px-4 py-3">
              <p
                class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]"
                title="K 折交叉验证：训练池里轮流藏起 1 折当验证集，5 次平均。用于挑选最佳超参，是泛化能力的可靠估计。"
              >
                验证集 R²
              </p>
              <p class="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                {{ formatMetric(currentPoint?.val_r2, 3) }}
              </p>
              <p class="mt-1 text-[10px] text-slate-400">
                K 折 CV 平均 · {{ formatNumber(activeTask?.dataset?.validation_size) }} 行/折
              </p>
            </div>

            <div
              class="rounded-[0.85rem] border bg-white px-4 py-3"
              :class="testMetrics ? 'border-[#aebdfc] ring-1 ring-[#aebdfc]/40' : 'border-dashed border-[#dbe4f2]'"
            >
              <p
                class="text-[10px] font-bold uppercase tracking-[0.18em]"
                :class="testMetrics ? 'text-[#5b56ea]' : 'text-[#8fa0ba]'"
                title='完全藏起来不参与训练的 15% 数据，最后给模型出一份"考卷"。这个数字才是论文里报告的最终成绩，反映模型对全新样本的真实预测能力。'
              >
                测试集 R²
              </p>
              <p class="mt-1 text-2xl font-semibold tracking-[-0.04em]" :class="testMetrics ? 'text-[#5b56ea]' : 'text-slate-300'">
                {{ testMetrics ? formatMetric(testMetrics.test_r2, 3) : '—' }}
              </p>
              <p class="mt-1 text-[10px]" :class="testMetrics ? 'text-[#5b56ea]/70' : 'text-slate-400'">
                <template v-if="testMetrics">
                  从未见过的数据 · {{ testMetrics.sample_count }} 行
                </template>
                <template v-else>
                  训练完成后给出
                </template>
              </p>
            </div>

            <div class="rounded-[0.85rem] border border-[#eef2f6] bg-white px-4 py-3">
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">进度</p>
              <p class="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">
                {{ progressPercent }}%
              </p>
              <p v-if="testMetrics" class="mt-1 text-[10px] text-slate-400 tabular-nums">
                RMSE {{ formatMetric(testMetrics.test_rmse, 3) }} · MAE {{ formatMetric(testMetrics.test_mae, 3) }}
              </p>
              <p v-else class="mt-1 text-[10px] text-slate-400 tabular-nums">
                RMSE {{ formatMetric(currentPoint?.val_rmse, 3) }} · MAE {{ formatMetric(currentPoint?.val_mae, 3) }}
              </p>
            </div>
          </section>

          <!-- 运行警告 -->
          <section
            v-if="runWarnings.length"
            class="rounded-[0.85rem] border border-[#ffe4b5] bg-[#fffaf0] px-4 py-3"
          >
            <p class="flex items-center gap-1.5 text-xs font-semibold text-[#a16207]">
              <AlertTriangle class="h-3.5 w-3.5" />
              运行提示
            </p>
            <ul class="mt-1.5 space-y-1 text-xs leading-5 text-[#854d0e]">
              <li v-for="warning in runWarnings" :key="warning">· {{ warning }}</li>
            </ul>
          </section>

          <!-- 自动调参进度 / 结果 -->
          <section
            v-if="tuneProgress"
            class="rounded-[0.95rem] border bg-white p-4"
            :class="tuneActive ? 'border-[#fbbf24] ring-1 ring-[#fbbf24]/40' : 'border-[#eef2f6]'"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <Sparkles class="h-3.5 w-3.5 text-[#c97a00]" />
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#c97a00]">自动调参</p>
              </div>
              <span v-if="tuneTotal" class="text-[10px] text-slate-400 tabular-nums">
                {{ tuneSearched }} / {{ tuneTotal }} 组
              </span>
            </div>

            <p
              v-if="tuneProgress?.skipped"
              class="mt-2 text-xs text-slate-500"
            >该算法没有可调超参数。</p>
            <template v-else>
              <p class="mt-1.5 text-xs text-slate-500">
                <span v-if="tuneActive">
                  正在 5 折交叉验证下搜索最佳超参组合...
                </span>
                <span v-else-if="tuneBestScore !== null">
                  调参完成 · 最佳 5 折 CV R² = <span class="font-semibold text-[#5b56ea]">{{ tuneBestScore.toFixed(3) }}</span>
                </span>
                <span v-else>
                  调参未找到有效结果，已用默认参数继续训练。
                </span>
              </p>

              <div v-if="tuneActive" class="mt-2 h-1.5 overflow-hidden rounded-full bg-[#fef3c7]">
                <div
                  class="h-full rounded-full bg-gradient-to-r from-[#fbbf24] to-[#f97316] transition-all"
                  :style="{ width: `${tuneTotal ? (tuneSearched / tuneTotal) * 100 : 0}%` }"
                />
              </div>

              <div
                v-if="tuneBestParamEntries.length"
                class="mt-2.5 flex flex-wrap gap-1.5"
              >
                <span
                  v-for="entry in tuneBestParamEntries"
                  :key="entry.key"
                  class="inline-flex items-center gap-1 rounded-md bg-[#f5f7ff] px-2 py-1 text-[11px] font-medium text-[#5b56ea]"
                >
                  <span class="text-slate-500">{{ entry.key }}</span>
                  =
                  <span class="font-semibold tabular-nums">{{ entry.value }}</span>
                </span>
              </div>
            </template>
          </section>

          <!-- ⭐ 算法对比结果 -->
          <section
            v-if="compareMode || compareResults.length"
            class="rounded-[0.95rem] border bg-white p-4"
            :class="compareMode ? 'border-[#aebdfc] ring-1 ring-[#aebdfc]/40' : 'border-[#eef2f6]'"
          >
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <Layers class="h-3.5 w-3.5" />
                  算法对比
                </p>
                <p class="mt-0.5 text-xs text-slate-500">
                  <span v-if="compareMode">
                    正在依次训练全部 {{ compareTotal }} 种算法（默认超参），完成后自动给出最佳推荐。
                  </span>
                  <span v-else-if="compareBestAlgorithm">
                    本轮对比最佳：<span class="font-semibold text-[#5b56ea]">{{ algorithmLabelZh(compareBestAlgorithm.algorithm) }}</span>
                    · 验证集 R² = {{ formatMetric(compareBestAlgorithm.valR2, 3) }}
                  </span>
                  <span v-else>
                    所有算法都未成功完成，可重新尝试或调整数据集。
                  </span>
                </p>
              </div>
              <span class="shrink-0 text-[10px] text-slate-400 tabular-nums">
                完成 {{ compareResults.length }} / {{ compareTotal || compareResults.length }}
              </span>
            </div>

            <div v-if="compareSucceeded.length" :style="{ height: `${Math.max(140, compareSucceeded.length * 38)}px` }">
              <Bar :data="compareChartData" :options="compareChartOptions" />
            </div>

            <div v-if="compareResults.length" class="mt-3 space-y-1.5">
              <div
                v-for="(row, idx) in compareSorted"
                :key="row.taskId"
                class="flex items-center gap-3 rounded-[0.6rem] border px-3 py-2 text-xs"
                :class="idx === 0 && row.status === 'completed'
                  ? 'border-[#aebdfc] bg-[#f5f7ff]'
                  : 'border-[#eef2f6] bg-white'"
              >
                <span
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  :class="idx === 0 ? 'bg-[#5b56ea] text-white' : 'bg-slate-100 text-slate-600'"
                >{{ idx + 1 }}</span>
                <span class="min-w-0 flex-1 truncate font-medium text-slate-800">
                  {{ algorithmLabelZh(row.algorithm) }}
                </span>
                <span class="shrink-0 font-semibold text-slate-900 tabular-nums">R²={{ formatMetric(row.valR2, 3) }}</span>
                <span class="shrink-0 text-slate-500 tabular-nums">RMSE={{ formatMetric(row.valRmse, 3) }}</span>
                <span class="hidden shrink-0 text-slate-400 sm:inline tabular-nums">MAE={{ formatMetric(row.valMae, 3) }}</span>
              </div>
              <div
                v-for="row in compareResults.filter((r) => r.status !== 'completed')"
                :key="`failed-${row.taskId}`"
                class="flex items-center gap-3 rounded-[0.6rem] border border-[#ffe4e6] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
              >
                <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
                <span class="min-w-0 flex-1 truncate font-medium">
                  {{ algorithmLabelZh(row.algorithm) }} · {{ row.status === 'failed' ? '失败' : '已中止' }}
                </span>
                <span v-if="row.error" class="hidden truncate text-[10px] text-[#cf334f]/80 sm:inline">
                  {{ row.error }}
                </span>
              </div>
            </div>

            <div v-else class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-3 text-center text-xs text-slate-500">
              <Loader2 v-if="compareMode" class="mx-auto h-4 w-4 animate-spin text-[#5b56ea]" />
              <p class="mt-1">{{ compareMode ? '正在训练第一个算法...' : '尚无对比结果' }}</p>
            </div>
          </section>

          <!-- 学习曲线 + 误差曲线 -->
          <section class="grid gap-3 xl:grid-cols-2">
            <div class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
              <div class="mb-2 flex items-center justify-between gap-2">
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">
                  学习曲线 · R² 轨迹
                </p>
                <span class="text-[10px] text-slate-400">训练 vs 验证</span>
              </div>
              <div class="h-[200px]">
                <div v-if="!history.length" class="flex h-full items-center justify-center rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-xs text-slate-500">
                  开始训练后此处显示 R² 变化趋势
                </div>
                <Line v-else :data="r2ChartData" :options="chartOptions" />
              </div>
            </div>

            <div class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
              <div class="mb-2 flex items-center justify-between gap-2">
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">
                  误差曲线 · RMSE / MAE
                </p>
                <span class="text-[10px] text-slate-400">越小越好</span>
              </div>
              <div class="h-[200px]">
                <div v-if="!history.length" class="flex h-full items-center justify-center rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-xs text-slate-500">
                  开始训练后此处显示误差变化
                </div>
                <Line v-else :data="errorChartData" :options="chartOptions" />
              </div>
            </div>
          </section>

          <!-- ⭐ 预测 vs 真实（核心可视化，对应论文图 3.2） -->
          <section class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  预测 vs 真实
                </p>
                <p class="mt-0.5 text-xs text-slate-500">
                  散点越靠近虚线（Y = X），表示预测越准确。
                  <span class="inline-flex items-center gap-1 ml-1">
                    <span class="inline-block h-2 w-2 rounded-full bg-[#5b56ea]/60" />紫色=验证集（CV）
                  </span>
                  <span class="inline-flex items-center gap-1 ml-1">
                    <span class="inline-block h-2 w-2 rotate-45 bg-[#ef4444]" />红色=测试集（隔离）
                  </span>
                </p>
              </div>
              <span v-if="allScatterSamples.length" class="text-[10px] text-slate-400 tabular-nums">
                验证 {{ predictionSamples.length }} · 测试 {{ testSamples.length }}
              </span>
            </div>
            <div class="h-[300px]">
              <div v-if="!allScatterSamples.length" class="flex h-full flex-col items-center justify-center gap-1 rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-center text-xs text-slate-500">
                <p>训练完成后在此显示散点图</p>
                <p class="text-slate-400">紫色 = 验证集 K 折预测，红色 = 测试集真实考卷</p>
              </div>
              <Line v-else :data="predictionScatterData" :options="predictionScatterOptions" />
            </div>
          </section>

          <!-- ⭐ 异常样本诊断（残差 Top10） -->
          <section
            v-if="topResiduals.length"
            class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4"
          >
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#cf334f]">
                  <Search class="h-3.5 w-3.5" />
                  异常样本诊断 · 残差 Top {{ topResiduals.length }}
                </p>
                <p class="mt-0.5 text-xs text-slate-500">
                  这些样本的预测值偏离最大——通常是数据本身有问题（提取错误、单位错乱、极端工况）。点"定位数据"跳到 Knowledge 库中的原始记录。
                </p>
              </div>
            </div>
            <div class="space-y-1.5">
              <div
                v-for="(sample, idx) in topResiduals"
                :key="`${sample.source}-${idx}`"
                class="flex items-center gap-2 rounded-[0.6rem] border px-3 py-2 text-xs"
                :class="suspiciousFlag(sample).kind === 'impossible'
                  ? 'border-[#cf334f]/40 bg-[#fff5f6]'
                  : suspiciousFlag(sample).kind === 'extreme'
                    ? 'border-[#fbbf24]/50 bg-[#fffbeb]'
                    : 'border-[#eef2f6] bg-white'"
              >
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                  {{ idx + 1 }}
                </span>
                <span
                  class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  :class="sample.source === 'test' ? 'bg-[#fff5f6] text-[#cf334f]' : 'bg-[#f5f7ff] text-[#5b56ea]'"
                >
                  {{ sample.source === 'test' ? '测试' : '验证' }}
                </span>
                <span class="shrink-0 text-[10px] text-slate-400">
                  <template v-if="sample.literatureId != null">文献#{{ sample.literatureId }}</template>
                  <template v-if="sample.recordId != null"> · 记录#{{ sample.recordId }}</template>
                </span>
                <span class="min-w-0 flex-1 truncate font-medium text-slate-700 tabular-nums">
                  真实 <span class="text-slate-900 font-semibold">{{ sample.actual.toFixed(3) }}</span>
                  → 预测 <span class="text-slate-900 font-semibold">{{ sample.predicted.toFixed(3) }}</span>
                </span>
                <span class="shrink-0 font-bold tabular-nums" :class="sample.residual > 0 ? 'text-[#cf334f]' : 'text-[#3d56d2]'">
                  残差 {{ sample.residual >= 0 ? '+' : '' }}{{ sample.residual.toFixed(3) }}
                </span>
                <span
                  v-if="suspiciousFlag(sample).kind"
                  class="shrink-0 text-[10px]"
                  :class="suspiciousFlag(sample).kind === 'impossible' ? 'text-[#cf334f]' : 'text-[#b97113]'"
                  :title="suspiciousFlag(sample).hint"
                >
                  {{ suspiciousFlag(sample).kind === 'impossible' ? '🚨 不可能值' : '⚠️ 极端值' }}
                </span>
                <button
                  type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#e2e8f0] bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                  :disabled="sample.recordId == null"
                  title="跳到 Knowledge 数据库定位这条异常样本"
                  @click="handleInspectRecord(sample)"
                >
                  <ExternalLink class="h-3 w-3" />
                  定位数据
                </button>
              </div>
            </div>
            <p class="mt-3 text-[11px] leading-snug text-slate-500">
              <span class="font-semibold text-[#cf334f]">🚨 红框</span>：物理上不可能的值，几乎肯定是数据错误，建议直接删除。
              <span class="ml-2 font-semibold text-[#b97113]">⚠️ 黄框</span>：极端值，需核对原文确认。
              <span class="ml-2 font-semibold text-slate-700">无标记</span>：可能是模型本身能力上限，需要更多数据或更强算法。
            </p>
          </section>

          <!-- ⭐ 特征重要性 -->
          <section class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-2 flex items-center justify-between gap-2">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  特征重要性 Top {{ featureImportances.length || 10 }}
                </p>
                <p class="mt-0.5 text-xs text-slate-500">
                  数值越高，说明该特征对模型预测的贡献越大。
                </p>
              </div>
            </div>
            <div :style="{ height: `${Math.max(160, featureImportances.length * 26)}px` }">
              <div v-if="!featureImportances.length" class="flex h-full items-center justify-center rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-xs text-slate-500">
                训练完成后在此显示特征重要性排名
              </div>
              <Bar v-else :data="featureImportanceChartData" :options="featureImportanceChartOptions" />
            </div>
          </section>

          <!-- 历史训练 -->
          <section class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <Trophy class="h-3.5 w-3.5 text-[#5b56ea]" />
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">历史训练</p>
              </div>
              <span class="text-[10px] text-slate-400">{{ leaderboard.length }} 条</span>
            </div>
            <div v-if="!leaderboard.length" class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-3 text-center text-xs text-slate-500">
              本次会话尚无完成的训练记录。
            </div>
            <div v-else class="space-y-1.5">
              <div
                v-for="(row, idx) in leaderboard"
                :key="row.taskId"
                class="flex items-center gap-3 rounded-[0.6rem] border px-3 py-2 text-xs"
                :class="idx === 0 ? 'border-[#aebdfc] bg-[#f5f7ff]' : 'border-[#eef2f6] bg-white'"
              >
                <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                  {{ leaderboard.length - idx }}
                </span>
                <span class="min-w-0 flex-1 truncate font-medium text-slate-700">
                  {{ algorithmLabelZh(row.algorithm) }} · {{ formatNumber(row.usableRecords) }} 条
                </span>
                <span class="shrink-0 font-semibold text-slate-900 tabular-nums">R²={{ formatMetric(row.valR2, 3) }}</span>
                <span class="shrink-0 text-slate-500 tabular-nums">RMSE={{ formatMetric(row.valRmse, 3) }}</span>
                <span class="hidden shrink-0 text-slate-400 sm:inline">{{ formatDateTime(row.finishedAt) }}</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
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
