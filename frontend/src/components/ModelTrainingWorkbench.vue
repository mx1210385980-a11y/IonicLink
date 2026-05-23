<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Eye,
  ExternalLink,
  Layers,
  Loader2,
  Play,
  Search,
  Sparkles,
  Star,
  Square,
  Trash2,
  Trophy,
  X,
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
  deleteRegisteredModel,
  getQualityAssetSummary,
  getModelTrainingRun,
  getModelTrainingSummary,
  importWffThesisDatasets,
  listCleanedDatasets,
  listModelTrainingRuns,
  listModelPredictionRuns,
  listRegisteredModels,
  predictWithRegisteredModel,
  previewModelTrainingPlan,
  registerModelTrainingRun,
  setRecommendedRegisteredModel,
  startModelTraining,
  type ModelTrainingExternalDiagnosticItem,
  type ModelTrainingMetricPoint,
  type ModelTrainingPlanPreview,
  type ModelPredictionRunListItem,
  type ModelTrainingRunListItem,
  type ModelTrainingStartPayload,
  type ModelTrainingSummary,
  type ModelTrainingTaskSnapshot,
  type QualityAssetSlice,
  type QualityAssetSummary,
  type QualityTrainingReadiness,
  type QualityTrainingReplenishment,
  type RegisteredModelListItem,
  type RegisteredModelPredictionResult,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'

const paperRegionPlugin = {
  id: 'paperRegionBackground',
  beforeDraw(chart: any) {
    const region = chart.options?.plugins?.paperRegion
    if (!region?.enabled) return
    const { ctx, chartArea, scales } = chart
    const xScale = scales.x
    const yScale = scales.y
    if (!chartArea || !xScale || !yScale) return
    const colors = region.colors || ['rgba(220, 252, 231, 0.48)', 'rgba(207, 250, 254, 0.46)', 'rgba(252, 231, 243, 0.50)']
    const min = Number(region.min ?? 0)
    const max = Number(region.max ?? 1)
    const low = Number(region.low ?? min)
    const high = Number(region.high ?? max)

    const drawBand = (from: number, to: number, color: string) => {
      if (to <= from) return
      ctx.save()
      ctx.fillStyle = color
      if (region.axis === 'y') {
        const y1 = yScale.getPixelForValue(Math.min(Math.max(from, min), max))
        const y2 = yScale.getPixelForValue(Math.min(Math.max(to, min), max))
        ctx.fillRect(chartArea.left, Math.min(y1, y2), chartArea.right - chartArea.left, Math.abs(y2 - y1))
      } else {
        const x1 = xScale.getPixelForValue(Math.min(Math.max(from, min), max))
        const x2 = xScale.getPixelForValue(Math.min(Math.max(to, min), max))
        ctx.fillRect(Math.min(x1, x2), chartArea.top, Math.abs(x2 - x1), chartArea.bottom - chartArea.top)
      }
      ctx.restore()
    }

    drawBand(min, low, colors[0])
    drawBand(low, high, colors[1])
    drawBand(high, max, colors[2])
  },
  afterDatasetsDraw(chart: any) {
    const region = chart.options?.plugins?.paperRegion
    if (!region?.enabled) return
    const { ctx, chartArea, scales } = chart
    const scale = region.axis === 'y' ? scales.y : scales.x
    if (!chartArea || !scale) return
    const thresholds = [
      Number(region.low),
      Number(region.high),
    ].filter((value) => Number.isFinite(value))
    ctx.save()
    ctx.setLineDash([3, 4])
    ctx.strokeStyle = 'rgba(100,116,139,0.72)'
    ctx.fillStyle = 'rgba(15,23,42,0.86)'
    ctx.lineWidth = 1
    ctx.font = '600 10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    thresholds.forEach((threshold) => {
      if (region.axis === 'y') {
        const y = scale.getPixelForValue(threshold)
        if (y < chartArea.top || y > chartArea.bottom) return
        ctx.beginPath()
        ctx.moveTo(chartArea.left, y)
        ctx.lineTo(chartArea.right, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.textAlign = 'right'
        ctx.fillText(String(Number(threshold.toFixed(3))), chartArea.right - 4, y - 5)
        ctx.setLineDash([3, 4])
      } else {
        const x = scale.getPixelForValue(threshold)
        if (x < chartArea.left || x > chartArea.right) return
        ctx.beginPath()
        ctx.moveTo(x, chartArea.top)
        ctx.lineTo(x, chartArea.bottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.textAlign = 'center'
        ctx.fillText(String(Number(threshold.toFixed(3))), x, chartArea.top + 12)
        ctx.setLineDash([3, 4])
      }
    })
    ctx.restore()
  },
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, paperRegionPlugin)

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
  snapshot?: ModelTrainingTaskSnapshot | null
  error?: string | null
}

type FeatureGroupKey =
  | 'cation_descriptor'
  | 'anion_descriptor'
  | 'process_condition'
  | 'surface_feature'
  | 'mechanism_feature'
  | 'fingerprint'
  | 'pca'
  | 'other'

type FeatureGroupDefinition = {
  key: FeatureGroupKey
  label: string
  shortLabel: string
  description: string
  toneClass: string
}

type FeatureGainRecipe = {
  key: string
  label: string
  groups: FeatureGroupKey[]
  purpose: string
}

type FeatureGainRunStep = {
  key: string
  label: string
  step: number
  purpose: string
  featureColumns: string[]
  featureCount: number
  cumulativeCount: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  taskId?: string | null
  valR2?: number | null
  valRmse?: number | null
  valMae?: number | null
  testR2?: number | null
  testRmse?: number | null
  testMae?: number | null
  externalR2?: number | null
  externalRmse?: number | null
  externalMae?: number | null
  finishedAt?: string | null
  snapshot?: ModelTrainingTaskSnapshot | null
  error?: string | null
}

type SegmentMixRecipe = {
  key: string
  label: string
  shortLabel: string
  baseModels: string[]
  metaModel: string
  purpose: string
  hyperparameters: Record<string, unknown>
}

type SegmentMixRunStep = {
  key: string
  label: string
  shortLabel: string
  baseModels: string[]
  metaModel: string
  purpose: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  taskId?: string | null
  valR2?: number | null
  valRmse?: number | null
  valMae?: number | null
  testR2?: number | null
  testRmse?: number | null
  testMae?: number | null
  externalR2?: number | null
  externalRmse?: number | null
  externalMae?: number | null
  finishedAt?: string | null
  snapshot?: ModelTrainingTaskSnapshot | null
  error?: string | null
}

type TrainingViewKey = 'macro_performance' | 'afm_surface_response' | 'cross_scale' | 'all'
type QualityScaleKey = 'macroscale' | 'nanoscale' | 'all'

type TrainingViewEntry = {
  key: TrainingViewKey
  scaleKey: QualityScaleKey
  label: string
  shortLabel: string
  detail: string
  badge: string
  recommended?: boolean
}

type TrainingViewCard = TrainingViewEntry & {
  slice: QualityAssetSlice | null
  readiness: QualityTrainingReadiness | null
  replenishment: QualityTrainingReplenishment | null
  trainableCount: number | null
  activeCount: number | null
  sampleGap: number | null
  active: boolean
  exploratory: boolean
}

const props = defineProps<{
  preselectedCleanedDatasetId?: number | null
}>()

const summary = ref<ModelTrainingSummary | null>(null)
const qualitySummary = ref<QualityAssetSummary | null>(null)
const activeTask = ref<ModelTrainingTaskSnapshot | null>(null)
const savedDatasets = ref<SavedCleanedDatasetSummary[]>([])
const trainingRuns = ref<ModelTrainingRunListItem[]>([])
const registeredModels = ref<RegisteredModelListItem[]>([])
const predictionRuns = ref<ModelPredictionRunListItem[]>([])
const selectedCleanedDatasetId = ref<number | null>(null)
const leaderboard = ref<LeaderboardRow[]>([])
const loading = ref(true)
const loadError = ref('')
const wffImporting = ref(false)
const qualityLoading = ref(false)
const qualityError = ref('')
const starting = ref(false)
const cancelling = ref(false)
const versionActionLoading = ref('')
const versionError = ref('')
const socketRef = ref<WebSocket | null>(null)
const completedTaskIds = new Set<string>()
const showAdvanced = ref(false)
const HIDDEN_ALGORITHMS = new Set(['mlp', 'high_cof_segmented'])
type WorkbenchTabKey = 'overview' | 'data' | 'experiments' | 'reports' | 'diagnostics' | 'predict' | 'versions'
const activeWorkbenchTab = ref<WorkbenchTabKey>('overview')
const defaultWorkbenchTab = { key: 'overview', label: '总览', description: '核心指标、拟合曲线和预测诊断。' } as const
const workbenchTabs: Array<{ key: WorkbenchTabKey; label: string; description: string }> = [
  defaultWorkbenchTab,
  { key: 'data', label: '数据', description: '划分策略、测试集合和重复工况噪声。' },
  { key: 'experiments', label: '实验', description: '特征组增益、自动调参和算法对比。' },
  { key: 'reports', label: '报告', description: '训练报告、特征重要性和可解释摘要。' },
  { key: 'diagnostics', label: '诊断', description: '高残差样本归因和数据回看。' },
  { key: 'predict', label: '预测', description: '按训练视图选择推荐模型并批量预测目标数据集。' },
  { key: 'versions', label: '版本', description: '保存、推荐、编辑和回看模型版本。' },
]
const activeWorkbenchTabMeta = computed(() => workbenchTabs.find((tab) => tab.key === activeWorkbenchTab.value) || defaultWorkbenchTab)
const splitDetailTab = ref<'subsets' | 'bins' | 'folds'>('subsets')
const activeFoldIndex = ref(0)
const showExperimentModal = ref(false)
const experimentPreview = ref<ModelTrainingPlanPreview | null>(null)
const experimentPreviewLoading = ref(false)
const experimentPreviewError = ref('')
const pendingExperimentAction = ref<'start' | 'tune' | 'compare' | null>(null)
const activeVersionViewKey = ref<TrainingViewKey>('afm_surface_response')
const predictionViewKey = ref<TrainingViewKey>('afm_surface_response')
const selectedPredictionDatasetId = ref<number | null>(null)
const predictionLoading = ref(false)
const predictionError = ref('')
const predictionResult = ref<RegisteredModelPredictionResult | null>(null)
const predictionHistoryLoading = ref(false)
const predictionHistoryError = ref('')
const showSaveVersionModal = ref(false)
const saveVersionName = ref('')
const saveVersionDescription = ref('')
const saveVersionRecommended = ref(false)
const NON_ITERATIVE_ALGORITHMS = new Set(['svr', 'linear_regression', 'high_cof_segmented'])
const splitDetailTabs: Array<{ key: 'subsets' | 'bins' | 'folds'; label: string }> = [
  { key: 'subsets', label: '总体' },
  { key: 'bins', label: 'μ 分箱' },
  { key: 'folds', label: '折次' },
]
const targetAggregationOptions = [
  {
    key: 'raw',
    label: '保留原始（验证稳健）',
    description: '默认推荐：保留完整样本，只剔除极端目标点；验证 R² 更可信，但同工况冲突会让预测略向均值收缩。',
  },
  {
    key: 'drop_conflicts',
    label: '剔除冲突组（拟合优先）',
    description: '移除同工况下 COF 差异过大的记录，只影响训练矩阵，不删除知识库原始数据；曲线更贴近 Y=X，但 #8 样本会变少，CV R² 容易偏低。',
  },
  {
    key: 'mean_by_condition',
    label: '按工况均值聚合',
    description: '同一离子/工况的重复实验合成一条均值样本，优先降低目标噪声。',
  },
]
const targetOutlierOptions = [
  {
    key: 'robust_iqr',
    label: '稳健剔除（推荐）',
    description: '按训练集 COF 的 3×IQR 稳健边界剔除极端目标值，并保留 0-2 的物理安全范围；#8 会排除 3 条高端异常样本。',
  },
  {
    key: 'physical',
    label: '只剔除物理越界',
    description: '只剔除 COF < 0 或 COF > 2 的明显越界值，保留高摩擦长尾。',
  },
  {
    key: 'off',
    label: '不剔除',
    description: '完整保留所有样本；适合做审计对照，但容易被少数极端点拉低 R²。',
  },
]
const TRAINING_VIEW_ENTRIES: TrainingViewEntry[] = [
  {
    key: 'afm_surface_response',
    scaleKey: 'nanoscale',
    label: '纳米摩擦',
    shortLabel: '纳米',
    detail: 'AFM / FFM / SFA 表面响应，当前最适合做稳定基线。',
    badge: '推荐',
    recommended: true,
  },
  {
    key: 'macro_performance',
    scaleKey: 'macroscale',
    label: '宏观摩擦',
    shortLabel: '宏观',
    detail: 'ball-on-disk、pin-on-disk 等宏观 COF / 磨损性能。',
    badge: '补数后训练',
  },
  {
    key: 'cross_scale',
    scaleKey: 'all',
    label: '跨尺度研究',
    shortLabel: '跨尺度',
    detail: '只用于研究宏观与纳米是否可迁移，不作为默认模型。',
    badge: '研究',
  },
  {
    key: 'all',
    scaleKey: 'all',
    label: '统一数据池',
    shortLabel: '全部',
    detail: '包含所有训练样本，仅作审计或算法对照。',
    badge: '对照',
  },
]
const FEATURE_GROUP_DEFINITIONS: FeatureGroupDefinition[] = [
  {
    key: 'cation_descriptor',
    label: '阳离子结构描述符',
    shortLabel: '阳离子',
    description: '阳离子的拓扑、极性、杂原子和形状等结构表达。',
    toneClass: 'border-[#cdd7ff] bg-[#f5f7ff] text-[#3d56d2]',
  },
  {
    key: 'anion_descriptor',
    label: '阴离子结构描述符',
    shortLabel: '阴离子',
    description: '阴离子的电荷分布、极性表面积、连接指数等结构表达。',
    toneClass: 'border-[#d9f99d] bg-[#f7fee7] text-[#4d7c0f]',
  },
  {
    key: 'process_condition',
    label: '工况协变量',
    shortLabel: '工况',
    description: '载荷、速度、温度、电位、含水量等实验条件。',
    toneClass: 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]',
  },
  {
    key: 'surface_feature',
    label: '表面特征',
    shortLabel: '表面',
    description: 'γ_s、σ_s、Rq、θ_s、I_ss 等基底/探针表面状态。',
    toneClass: 'border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]',
  },
  {
    key: 'mechanism_feature',
    label: '膜层与链长机制量',
    shortLabel: '机制',
    description: '膜厚、烷基链长、吸附层和润滑膜相关变量。',
    toneClass: 'border-[#e9d5ff] bg-[#faf5ff] text-[#7e22ce]',
  },
  {
    key: 'fingerprint',
    label: '指纹/高阶拓扑描述符',
    shortLabel: '指纹',
    description: 'Morgan、FpDensity、Kappa、Chi 等高阶结构描述。',
    toneClass: 'border-[#ddd6fe] bg-[#f5f3ff] text-[#5b21b6]',
  },
  {
    key: 'pca',
    label: 'PCA 压缩特征',
    shortLabel: 'PCA',
    description: '高维描述符经过主成分压缩后的低维表达。',
    toneClass: 'border-[#ccfbf1] bg-[#f0fdfa] text-[#0f766e]',
  },
  {
    key: 'other',
    label: '其他数值特征',
    shortLabel: '其他',
    description: '尚未归类但进入训练矩阵的数值列。',
    toneClass: 'border-[#e2e8f0] bg-[#fbfcff] text-slate-600',
  },
]
const FEATURE_GAIN_RECIPES: FeatureGainRecipe[] = [
  {
    key: 'structure_core',
    label: '结构核心',
    groups: ['cation_descriptor', 'anion_descriptor'],
    purpose: '先确认阴/阳离子描述符本身能否解释摩擦系数。',
  },
  {
    key: 'condition_gain',
    label: '+ 工况协变量',
    groups: ['process_condition'],
    purpose: '衡量载荷、速度、温度和电位等实验条件带来的增益。',
  },
  {
    key: 'surface_gain',
    label: '+ 表面特征',
    groups: ['surface_feature'],
    purpose: '回测 γ_s、σ_s、Rq、θ_s、I_ss 等论文式表面变量是否改善泛化。',
  },
  {
    key: 'mechanism_gain',
    label: '+ 膜层/链长',
    groups: ['mechanism_feature'],
    purpose: '检查膜厚、烷基链长和吸附层变量能否补足低 R²。',
  },
  {
    key: 'descriptor_guard',
    label: '+ 高阶描述符',
    groups: ['fingerprint', 'pca', 'other'],
    purpose: '最后加入指纹或 PCA 特征，观察是否增益或引入噪声。',
  },
]
const SEGMENT_MIX_RECIPES: SegmentMixRecipe[] = [
  {
    key: 'catboost_rf_svr',
    label: '论文对照：CatBoost + RF 稳定融合',
    shortLabel: 'CatBoost + RF 融合',
    baseModels: ['catboost', 'random_forest'],
    metaModel: 'svr',
    purpose: '论文 4.3.2 的两基学习器对照：外部文献验证较稳，用来和三基最优方案比较。',
    hyperparameters: {
      q1: 0.3,
      q2: 0.8,
      high_blend: 0,
      base_models: ['catboost', 'random_forest'],
      meta_model: 'svr',
      thesis_profile: true,
      min_segment_size: 8,
    },
  },
  {
    key: 'catboost_xgboost_catboost',
    label: '论文对照：CatBoost + XGBoost 稳定融合',
    shortLabel: 'CatBoost + XGBoost 融合',
    baseModels: ['catboost', 'xgboost'],
    metaModel: 'catboost',
    purpose: '论文 4.3.2 的检验集强对照：检验集拟合高，但超低摩擦趋势不是最终最优。',
    hyperparameters: {
      q1: 0.3,
      q2: 0.8,
      high_blend: 0,
      base_models: ['catboost', 'xgboost'],
      meta_model: 'catboost',
      thesis_profile: true,
      min_segment_size: 8,
    },
  },
  {
    key: 'catboost_rf_xgboost_catboost',
    label: '论文最优：CatBoost + RF + XGBoost 稳定融合',
    shortLabel: '三基稳定融合',
    baseModels: ['catboost', 'random_forest', 'xgboost'],
    metaModel: 'catboost',
    purpose: '复刻论文第 4 章最终模型：CatBoost 门控低/中/高区间，三基学习器按论文矩阵做稳定融合。',
    hyperparameters: {
      q1: 0.3,
      q2: 0.8,
      high_blend: 0,
      base_models: ['catboost', 'random_forest', 'xgboost'],
      meta_model: 'catboost',
      thesis_profile: true,
      min_segment_size: 8,
    },
  },
]

// 全算法对比模式
const compareMode = ref(false)
const compareQueue = ref<string[]>([])
const compareResults = ref<ComparisonRow[]>([])
const compareTotal = ref(0)
const compareCurrentAlgorithm = ref<string | null>(null)
const featureGainMode = ref(false)
const featureGainQueue = ref<FeatureGainRunStep[]>([])
const featureGainResults = ref<FeatureGainRunStep[]>([])
const featureGainTotal = ref(0)
const featureGainCurrent = ref<FeatureGainRunStep | null>(null)
const featureGainBaseAlgorithm = ref<string | null>(null)
const segmentMixMode = ref(false)
const segmentMixQueue = ref<SegmentMixRecipe[]>([])
const segmentMixResults = ref<SegmentMixRunStep[]>([])
const segmentMixTotal = ref(0)
const segmentMixCurrent = ref<SegmentMixRunStep | null>(null)

const emit = defineEmits<{
  'open-knowledge': []
  'inspect-record': [payload: {
    literatureId?: number | null
    recordId?: number | null
    rowIndex?: number | null
    source: 'val' | 'test' | 'external'
    actual: number
    predicted: number
    residual: number
    absResidual: number
  }]
}>()

const form = reactive<ModelTrainingStartPayload>({
  target: 'Target_COF',
  algorithm: 'catboost',
  hyperparameters: { n_estimators: 300, learning_rate: 0.08, max_depth: 3, l2_leaf_reg: 2, random_strength: 1 },
  data_options: {
    validation_split: 0.2,
    training_view: 'afm_surface_response',
    min_confidence: 0,
    max_records: null,
    random_seed: 42,
    split_strategy: 'joint_stratified',
    cv_folds: 5,
    reserve_external_validation: false,
    target_aggregation_strategy: 'raw',
    target_outlier_strategy: 'robust_iqr',
    target_outlier_iqr_multiplier: 3,
    target_outlier_min: 0,
    target_outlier_max: 2,
  },
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
const availableAlgorithms = computed(() => (summary.value?.algorithms || []).filter((algorithm) => !HIDDEN_ALGORITHMS.has(algorithm.key)))
const availableAlgorithmKeys = computed(() => new Set(availableAlgorithms.value.map((algorithm) => algorithm.key)))
const allQualitySlice = computed<QualityAssetSlice | null>(() => {
  const payload = qualitySummary.value
  if (!payload) return null
  return {
    key: 'all',
    label: '全部',
    trainingView: 'all',
    summary: payload.summary,
    metrics: payload.metrics,
    fieldCategories: payload.fieldCategories,
    unitIssues: payload.unitIssues,
    doiDuplicates: payload.doiDuplicates,
    cofOutliers: payload.cofOutliers,
    evidence: payload.evidence,
    training: payload.training,
    review: payload.review,
  }
})
const selectedTrainingViewKey = computed<TrainingViewKey>(() => normalizeTrainingViewKey(form.data_options.training_view))
const trainingViewCards = computed<TrainingViewCard[]>(() => TRAINING_VIEW_ENTRIES.map((entry) => {
  const slice = qualitySliceForScale(entry.scaleKey)
  const readiness = slice?.training.readiness || null
  const replenishment = slice?.training.replenishment || null
  return {
    ...entry,
    slice,
    readiness,
    replenishment,
    trainableCount: replenishment?.currentTrainableCount ?? slice?.training.trainableRecordIds?.length ?? null,
    activeCount: slice?.summary.activeRecordCount ?? null,
    sampleGap: replenishment?.sampleGap ?? null,
    active: selectedTrainingViewKey.value === entry.key,
    exploratory: entry.key === 'all' || entry.key === 'cross_scale',
  }
}))
const selectedTrainingViewCard = computed(() =>
  trainingViewCards.value.find((card) => card.key === selectedTrainingViewKey.value) || trainingViewCards.value[0] || null,
)
const selectedTrainingViewHardBlocked = computed(() => {
  const state = selectedTrainingViewCard.value?.readiness?.state
  return state === 'empty' || state === 'blocked'
})
const selectedTrainingViewWarnings = computed(() => buildTrainingViewWarnings(selectedTrainingViewCard.value))
const trainingLaunchDisabled = computed(() =>
  starting.value
  || selectedCleanedDatasetId.value == null
  || usableRecords.value < 10
  || activeTask.value?.status === 'running'
  || selectedTrainingViewHardBlocked.value,
)
const trainingCompareDisabled = computed(() =>
  trainingLaunchDisabled.value
  || !summary.value
  || !availableAlgorithms.value.length,
)
const segmentMixPlan = computed(() => SEGMENT_MIX_RECIPES.filter((recipe) => (
  recipe.baseModels.every((key) => key !== 'xgboost' || availableAlgorithmKeys.value.has('xgboost'))
)))
const isRandomForest = computed(() => form.algorithm === 'random_forest')
const usableRecords = computed(() => activeTask.value?.dataset.usable_records || summary.value?.dataset.usable_records || 0)
const progressPercent = computed(() => Math.round((currentPoint.value?.progress || 0) * 100))
const validationSplitPercent = computed(() => Math.round((form.data_options.validation_split || 0) * 100))
const targetLabel = computed(() => targetDisplayLabel(
  summary.value?.dataset.target?.label
  || summary.value?.dataset.target_column
  || form.target,
))
const datasetTitle = computed(() => selectedDataset.value?.name || summary.value?.dataset.name || '训练工作台')
const activeAlgorithm = computed(() => activeTask.value?.config.algorithm || form.algorithm)
const isActiveNonIterativeModel = computed(() => NON_ITERATIVE_ALGORITHMS.has(activeAlgorithm.value))
const fitProgressLabel = computed(() => {
  if (activeTask.value?.status !== 'running') return ''
  if (isActiveNonIterativeModel.value) {
    if (activeAlgorithm.value === 'svr') return 'SVR 单次拟合中'
    if (activeAlgorithm.value === 'high_cof_segmented') return '门控分段堆叠中'
    return '线性回归拟合中'
  }
  return `${activeTask.value?.current_round || 0} / ${activeTask.value?.total_rounds || form.hyperparameters.n_estimators} 轮`
})
const fitModeTitle = computed(() => {
  if (activeAlgorithm.value === 'svr') return 'SVR 单次拟合结果'
  if (activeAlgorithm.value === 'high_cof_segmented') return '论文门控分区堆叠结果'
  return '线性回归单次拟合结果'
})
const fitModeDescription = computed(() => {
  if (activeAlgorithm.value === 'svr') {
    return 'SVR 一次性求解支持向量回归目标，没有逐轮加树或 epoch；这里固定展示最终交叉验证和测试集表现。'
  }
  if (activeAlgorithm.value === 'high_cof_segmented') {
    return '先用 CatBoost 门控低/中/高摩擦区间，再在各区间做局部堆叠；它没有逐轮曲线，重点观察最终 CV、测试和外部文献验证。'
  }
  return '线性回归一次性求解系数，没有逐轮训练轨迹；这里固定展示最终交叉验证和测试集表现。'
})
const activeTaskTrainingViewKey = computed<TrainingViewKey>(() => normalizeTrainingViewKey(
  activeTask.value?.config?.data_options?.training_view
  || activeTask.value?.dataset?.filters?.training_view
  || form.data_options.training_view,
))
const versionTrainingViewTabs = computed(() => TRAINING_VIEW_ENTRIES.map((entry) => {
  const models = registeredModels.value.filter((model) => modelTrainingViewKey(model) === entry.key)
  const runs = trainingRuns.value.filter((run) => runTrainingViewKey(run) === entry.key)
  return {
    ...entry,
    modelCount: models.length,
    runCount: runs.length,
    recommended: models.find((model) => model.is_recommended) || null,
  }
}))
const activeVersionViewMeta = computed(() =>
  versionTrainingViewTabs.value.find((tab) => tab.key === activeVersionViewKey.value) || versionTrainingViewTabs.value[0],
)
const filteredRegisteredModels = computed(() =>
  registeredModels.value.filter((model) => modelTrainingViewKey(model) === activeVersionViewKey.value),
)
const recommendedModel = computed(() => filteredRegisteredModels.value.find((model) => model.is_recommended) || null)
const recommendedModelForActiveTaskView = computed(() =>
  registeredModels.value.find((model) => model.is_recommended && modelTrainingViewKey(model) === activeTaskTrainingViewKey.value) || null,
)
const predictionViewTabs = computed(() => TRAINING_VIEW_ENTRIES.map((entry) => {
  const recommended = registeredModels.value.find((model) => model.is_recommended && modelTrainingViewKey(model) === entry.key) || null
  const fallback = registeredModels.value.find((model) => modelTrainingViewKey(model) === entry.key) || null
  return {
    ...entry,
    recommended,
    fallback,
    modelCount: registeredModels.value.filter((model) => modelTrainingViewKey(model) === entry.key).length,
  }
}))
const activePredictionViewMeta = computed(() =>
  predictionViewTabs.value.find((tab) => tab.key === predictionViewKey.value) || predictionViewTabs.value[0],
)
const selectedPredictionModel = computed(() => {
  const meta = activePredictionViewMeta.value
  return meta?.recommended || meta?.fallback || null
})
const selectedPredictionDataset = computed(() =>
  savedDatasets.value.find((dataset) => dataset.id === selectedPredictionDatasetId.value) || null,
)
const filteredPredictionRuns = computed(() =>
  predictionRuns.value.filter((run) => normalizeTrainingViewKey(run.training_view) === predictionViewKey.value),
)
const activeRegisteredModel = computed(() => {
  const taskId = activeTask.value?.task_id
  if (!taskId) return null
  return registeredModels.value.find((model) => model.task_id === taskId) || null
})
const activeRunVersion = computed(() => {
  const taskId = activeTask.value?.task_id
  if (!taskId) return null
  return trainingRuns.value.find((run) => run.task_id === taskId) || null
})
const versionRuns = computed(() => trainingRuns.value.slice(0, 12))
const filteredVersionRuns = computed(() => versionRuns.value.filter((run) => runTrainingViewKey(run) === activeVersionViewKey.value))
const canSaveActiveVersion = computed(() => Boolean(activeTask.value?.status === 'completed'))
const versionModalTitle = computed(() => activeRegisteredModel.value ? '编辑模型版本' : '保存模型版本')
const versionModalConfirmLabel = computed(() => activeRegisteredModel.value ? '保存修改' : '保存模型版本')

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
const externalSamples = computed(() => insights.value?.external_samples || [])
const externalMetrics = computed(() => insights.value?.external_metrics || null)
const featureImportances = computed(() => (insights.value?.feature_importance || []).slice(0, 10))
const testMetrics = computed(() => activeTask.value?.test_metrics || null)
const experimentReport = computed(() => insights.value?.experiment_report || null)
const segmentSummary = computed(() => insights.value?.segment_summary || experimentReport.value?.segment_summary || null)
const reportMetrics = computed(() => {
  const metrics = experimentReport.value?.metrics
  if (!metrics) return []
  return [
    { key: 'training', label: '训练集', tone: 'text-[#7c3aed]', metric: metrics.training },
    { key: 'validation', label: '验证集', tone: 'text-[#0f766e]', metric: metrics.validation },
    { key: 'test', label: '测试集', tone: 'text-[#cf334f]', metric: metrics.test || null },
    { key: 'external', label: '外推验证', tone: 'text-[#c2410c]', metric: metrics.external || null },
  ].filter((row) => row.metric)
})
const reportRisks = computed(() => experimentReport.value?.risks || [])
const reportFeatureTop = computed(() => experimentReport.value?.feature_importance_top?.slice(0, 6) || [])
const reportResidualTop = computed(() => experimentReport.value?.residual_top?.slice(0, 6) || [])
const reportFoldPreview = computed(() => experimentReport.value?.split?.folds?.slice(0, 5) || [])
const reportHyperparameterEntries = computed(() => Object.entries(experimentReport.value?.hyperparameters || {}).slice(0, 6).map(([key, value]) => ({
  key,
  value: Array.isArray(value) ? `[${value.join(', ')}]` : String(value),
})))
const maxReportFeatureImportance = computed(() => Math.max(1e-9, ...reportFeatureTop.value.map((entry) => Number(entry.importance || 0))))
const datasetSplit = computed(() => activeTask.value?.dataset?.split || summary.value?.dataset?.split || null)
const targetNoise = computed(() =>
  activeTask.value?.dataset?.target_noise
  || experimentReport.value?.target_noise
  || experimentPreview.value?.dataset?.target_noise
  || summary.value?.dataset?.target_noise
  || null,
)
const targetOutliers = computed(() =>
  activeTask.value?.dataset?.target_outliers
  || experimentPreview.value?.dataset?.target_outliers
  || summary.value?.dataset?.target_outliers
  || null,
)
const targetNoiseTopGroups = computed(() => (targetNoise.value?.top_groups || []).slice(0, 5))
const selectedAggregationOption = computed(() =>
  targetAggregationOptions.find((option) => option.key === (form.data_options.target_aggregation_strategy || 'raw')) ?? targetAggregationOptions[0],
)
const selectedOutlierOption = computed(() =>
  targetOutlierOptions.find((option) => option.key === (form.data_options.target_outlier_strategy || 'robust_iqr')) ?? targetOutlierOptions[0],
)
const targetNoiseAppliedLabel = computed(() => targetAggregationLabel(targetNoise.value?.strategy_applied || 'raw'))
const targetNoiseRecommendationLabel = computed(() => targetAggregationLabel(targetNoise.value?.recommended_strategy || 'raw'))
const splitDetails = computed(() => datasetSplit.value?.details || null)
const splitSubsets = computed(() => splitDetails.value?.subsets || [])
const splitBins = computed(() => splitDetails.value?.target_bins || [])
const splitStrataPreview = computed(() => splitDetails.value?.strata?.slice(0, 8) || [])
const splitFolds = computed(() => splitDetails.value?.folds || [])
const selectedFold = computed(() => {
  const folds = splitFolds.value
  if (!folds.length) return null
  return folds[Math.min(activeFoldIndex.value, folds.length - 1)]
})
const maxSplitBinTotal = computed(() => Math.max(1, ...splitBins.value.map((bin) => Number(bin.total || bin.count || 0))))
const externalValidationNote = computed(() => {
  const count = Number(externalMetrics.value?.sample_count ?? datasetSplit.value?.external_size ?? activeTask.value?.dataset?.external_size ?? 0)
  if (!count) return null
  const singleton = Number(datasetSplit.value?.singleton_strata ?? experimentReport.value?.split?.singleton_strata ?? 0)
  const externalR2 = externalMetrics.value?.external_r2 ?? experimentReport.value?.metrics?.external?.r2 ?? null
  const isSmall = count < 30
  const isNegative = typeof externalR2 === 'number' && externalR2 < 0
  if (!isSmall && !isNegative) return null
  return {
    severity: isNegative ? 'medium' : 'low',
    title: isNegative ? '外推验证 R² 为负' : '外推验证样本偏少',
    message: `这里不是普通测试集，而是 ${count} 条训练中未见过的稀有阳离子 × μ 分箱组合${singleton ? `（其中 ${singleton} 组为单样本组合）` : ''}。${isNegative ? 'R² 为负说明模型外推这些稀有组合时低于均值基线。' : '样本少时 R² 对单个极端点非常敏感。'}主泛化表现优先看测试集 R²，外推验证用于提示需要补哪些离子和工况。`,
  }
})

const allScatterSamples = computed(() => [
  ...predictionSamples.value,
  ...testSamples.value,
  ...externalSamples.value,
])

// 异常样本诊断：把验证 OOF 和测试样本合起来，按残差降序取 Top 10
type DiagSample = {
  source: 'val' | 'test' | 'external'
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

const topExternalResiduals = computed<DiagSample[]>(() => externalSamples.value
  .map((sample) => ({
    source: 'external' as const,
    recordId: nullableNumber(sample.record_id),
    literatureId: nullableNumber(sample.literature_id),
    actual: Number(sample.actual),
    predicted: Number(sample.predicted),
    residual: Number(sample.residual ?? (Number(sample.predicted) - Number(sample.actual))),
    absResidual: Number(sample.abs_residual ?? Math.abs(Number(sample.predicted) - Number(sample.actual))),
    rowIndex: nullableNumber(sample.row_index),
  }))
  .filter((sample) => Number.isFinite(sample.absResidual))
  .sort((a, b) => b.absResidual - a.absResidual)
  .slice(0, 5))

const externalDiagnostics = computed(() => insights.value?.external_diagnostics || experimentReport.value?.external_diagnostics || null)
const externalDiagnosticItems = computed<ModelTrainingExternalDiagnosticItem[]>(() => {
  const diagnosticItems = externalDiagnostics.value?.items || []
  if (diagnosticItems.length) {
    return [...diagnosticItems]
      .sort((a, b) => Number(b.abs_residual || 0) - Number(a.abs_residual || 0))
      .slice(0, 8)
  }
  return topExternalResiduals.value.map((sample) => ({
    matrix_index: undefined,
    row_index: sample.rowIndex ?? -1,
    record_id: sample.recordId,
    literature_id: sample.literatureId,
    cation: null,
    friction_bin: null,
    joint_stratum: null,
    actual: sample.actual,
    predicted: sample.predicted,
    residual: sample.residual,
    abs_residual: sample.absResidual,
    severity: sample.absResidual >= 0.25 ? 'high' : sample.absResidual >= 0.12 ? 'medium' : 'low',
    bin_label: null,
    training_context: {},
    reasons: [
      {
        kind: 'large_residual',
        label: sample.absResidual >= 0.12 ? '外推残差偏大' : '外推样本',
        detail: '该旧训练版本尚未保存完整覆盖归因，只能根据外推残差提示优先核对。',
      },
    ],
    out_of_range_features: [],
    suggestions: ['回 Knowledge 定位原始记录，核对 COF、载荷、速度和单位。'],
  }))
})

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
  for (const s of externalSamples.value) {
    merged.push({
      source: 'external',
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
  const externalSamplesData = externalSamples.value
  const { min, max } = predictionRange.value
  const datasets: any[] = [
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
  ]
  if (externalSamplesData.length) {
    datasets.push({
      type: 'line' as const,
      label: `外推验证 · ${externalSamplesData.length}`,
      data: externalSamplesData.map((sample) => ({ x: sample.actual, y: sample.predicted })),
      backgroundColor: 'rgba(245, 158, 11, 0.82)',
      borderColor: 'rgba(255,255,255,0.9)',
      borderWidth: 1,
      pointRadius: 5.5,
      pointHoverRadius: 8,
      pointStyle: 'triangle' as const,
      showLine: false,
    })
  }
  return { datasets }
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

const isWffThesisRun = computed(() =>
  selectedDataset.value?.dataset_kind === 'wff_thesis_csv'
  || activeTask.value?.config?.data_options?.split_strategy === 'wff_thesis'
  || experimentReport.value?.split?.strategy === 'wff_thesis',
)

const paperFitThresholds = computed(() => {
  const thresholds = segmentSummary.value?.thresholds || {}
  const low = nullableNumber(thresholds.low)
  const high = nullableNumber(thresholds.high ?? thresholds.high_quantile_reference)
  if (low != null && high != null && high > low) return { low, high }
  if (isWffThesisRun.value) return { low: 0.10, high: 1.06 }
  const range = predictionRange.value
  const span = Math.max(0.1, range.max - range.min)
  return {
    low: range.min + span * 0.30,
    high: range.min + span * 0.80,
  }
})

const paperFitAxisRange = computed(() => {
  if (isWffThesisRun.value) return { min: 0, max: 5 }
  const range = predictionRange.value
  return {
    min: Math.min(0, range.min),
    max: Math.max(1, range.max),
  }
})

const paperExternalAxisRange = computed(() => {
  if (isWffThesisRun.value) return { min: 0, max: 1.4 }
  const values = externalSamples.value.flatMap((sample) => [Number(sample.actual), Number(sample.predicted)])
    .filter((value) => Number.isFinite(value))
  const maxValue = Math.max(1, ...values)
  return { min: 0, max: maxValue + Math.max(0.08, maxValue * 0.08) }
})

const paperFitScatterData = computed(() => {
  const range = paperFitAxisRange.value
  return {
    datasets: [
      {
        type: 'line' as const,
        label: 'Y = X',
        data: [
          { x: range.min, y: range.min },
          { x: range.max, y: range.max },
        ],
        borderColor: 'rgba(15,23,42,0.88)',
        borderDash: [7, 5],
        borderWidth: 1.6,
        pointRadius: 0,
        showLine: true,
      },
      {
        type: 'line' as const,
        label: `训练池 CV · ${predictionSamples.value.length}`,
        data: predictionSamples.value.map((sample) => ({ x: sample.actual, y: sample.predicted })),
        backgroundColor: 'rgba(239, 68, 68, 0.82)',
        borderColor: 'rgba(255,255,255,0.86)',
        borderWidth: 0.8,
        pointRadius: 3.8,
        pointHoverRadius: 6,
        showLine: false,
      },
      {
        type: 'line' as const,
        label: `检验集 · ${testSamples.value.length}`,
        data: testSamples.value.map((sample) => ({ x: sample.actual, y: sample.predicted })),
        backgroundColor: 'rgba(37, 99, 235, 0.82)',
        borderColor: 'rgba(255,255,255,0.9)',
        borderWidth: 0.9,
        pointRadius: 4.4,
        pointHoverRadius: 7,
        showLine: false,
      },
    ],
  }
})

const paperFitScatterOptions = computed(() => {
  const range = paperFitAxisRange.value
  const thresholds = paperFitThresholds.value
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      paperRegion: {
        enabled: true,
        axis: 'x',
        min: range.min,
        max: range.max,
        low: thresholds.low,
        high: thresholds.high,
      },
      legend: {
        labels: {
          usePointStyle: true,
          boxWidth: 10,
          color: 'rgba(15,23,42,0.80)',
          padding: 12,
          font: { size: 11, weight: 600 },
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#0f172a',
        bodyColor: '#475569',
        borderColor: 'rgba(148,163,184,0.22)',
        borderWidth: 1,
        callbacks: {
          label: (ctx: any) => {
            const x = Number(ctx.parsed?.x ?? 0)
            const y = Number(ctx.parsed?.y ?? 0)
            if (ctx.dataset.label === 'Y = X') return `Y = X (${x.toFixed(3)}, ${y.toFixed(3)})`
            return `True ${x.toFixed(3)} / Predicted ${y.toFixed(3)} / Residual ${(y - x).toFixed(3)}`
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        min: range.min,
        max: range.max,
        title: { display: true, text: 'True', color: 'rgba(15,23,42,0.86)', font: { size: 12, weight: 700 } },
        grid: { color: 'rgba(148,163,184,0.12)' },
        ticks: { color: 'rgba(15,23,42,0.74)' },
      },
      y: {
        type: 'linear' as const,
        min: range.min,
        max: range.max,
        title: { display: true, text: 'Predicted', color: 'rgba(15,23,42,0.86)', font: { size: 12, weight: 700 } },
        grid: { color: 'rgba(148,163,184,0.12)' },
        ticks: { color: 'rgba(15,23,42,0.74)' },
      },
    },
  }
})

const paperExternalLineData = computed(() => {
  return {
    datasets: [
      {
        type: 'line' as const,
        label: '外部文献验证',
        data: externalSamples.value.map((sample, index) => ({ x: index + 1, y: sample.actual })),
        borderColor: 'rgba(15,23,42,0.92)',
        backgroundColor: 'rgba(15,23,42,0.92)',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2,
        tension: 0.12,
      },
      {
        type: 'line' as const,
        label: 'Predicted',
        data: externalSamples.value.map((sample, index) => ({ x: index + 1, y: sample.predicted })),
        borderColor: 'rgba(22, 163, 74, 0.95)',
        backgroundColor: 'rgba(22, 163, 74, 0.95)',
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        tension: 0.12,
      },
    ],
  }
})

const paperExternalLineOptions = computed(() => {
  const range = paperExternalAxisRange.value
  const thresholds = paperFitThresholds.value
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { intersect: false, mode: 'index' as const },
    plugins: {
      paperRegion: {
        enabled: true,
        axis: 'y',
        min: range.min,
        max: range.max,
        low: thresholds.low,
        high: thresholds.high,
      },
      legend: {
        position: 'top' as const,
        align: 'start' as const,
        labels: {
          usePointStyle: true,
          boxWidth: 10,
          color: 'rgba(15,23,42,0.82)',
          padding: 10,
          font: { size: 11, weight: 600 },
        },
      },
      tooltip: {
        backgroundColor: '#ffffff',
        titleColor: '#0f172a',
        bodyColor: '#475569',
        borderColor: 'rgba(148,163,184,0.22)',
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        min: 0.5,
        max: Math.max(1.5, externalSamples.value.length + 0.5),
        title: { display: true, text: 'Data points', color: 'rgba(15,23,42,0.86)', font: { size: 12, weight: 700 } },
        ticks: { stepSize: 1, color: 'rgba(15,23,42,0.74)' },
        grid: { color: 'rgba(148,163,184,0.10)' },
      },
      y: {
        type: 'linear' as const,
        min: range.min,
        max: range.max,
        title: { display: true, text: 'Friction coefficient', color: 'rgba(15,23,42,0.86)', font: { size: 12, weight: 700 } },
        ticks: { color: 'rgba(15,23,42,0.74)' },
        grid: { color: 'rgba(148,163,184,0.12)' },
      },
    },
  }
})

const paperFitMetrics = computed(() => [
  {
    label: 'Train/CV',
    r2: currentPoint.value?.train_r2 ?? null,
    rmse: currentPoint.value?.train_rmse ?? null,
    mae: currentPoint.value?.train_mae ?? null,
  },
  {
    label: 'Test',
    r2: testMetrics.value?.test_r2 ?? null,
    rmse: testMetrics.value?.test_rmse ?? null,
    mae: testMetrics.value?.test_mae ?? null,
  },
  {
    label: 'External',
    r2: externalMetrics.value?.external_r2 ?? null,
    rmse: externalMetrics.value?.external_rmse ?? null,
    mae: externalMetrics.value?.external_mae ?? null,
  },
])

// 数据切分策略 ─────────────────────────────────────────────────
const splitOptions = computed(() => summary.value?.split_options || [])
const activeSplitOption = computed(() =>
  splitOptions.value.find((opt) => opt.key === form.data_options.split_strategy) || null,
)
const experimentDataset = computed(() => experimentPreview.value?.dataset || summary.value?.dataset || null)
const experimentTargetOutliers = computed(() => experimentPreview.value?.dataset?.target_outliers || null)
const experimentSplit = computed(() => experimentPreview.value?.dataset?.split || null)
const experimentSplitDetails = computed(() => experimentSplit.value?.details || null)
const experimentSplitSubsets = computed(() => experimentSplitDetails.value?.subsets || [])
const experimentFeatureColumns = computed(() => experimentDataset.value?.feature_columns || summary.value?.dataset.feature_columns || [])
const experimentFeaturePreview = computed(() => experimentFeatureColumns.value.slice(0, 14))
const experimentFeatureHiddenCount = computed(() => Math.max(0, experimentFeatureColumns.value.length - experimentFeaturePreview.value.length))
const experimentWarnings = computed(() => {
  const warnings = [...(experimentPreview.value?.warnings || [])]
  for (const warning of selectedTrainingViewWarnings.value) {
    if (!warnings.includes(warning)) warnings.push(warning)
  }
  return warnings
})
const experimentSplitPlanPreview = computed(() => experimentPreview.value?.split_plan?.slice(0, 4) || [])
const experimentCleaning = computed(() => summary.value?.cleaning || selectedDataset.value?.summary || null)
const experimentSmiles = computed(() => experimentCleaning.value?.smiles_screening || null)
const experimentRules = computed(() => experimentCleaning.value?.rules || null)
const experimentActionLabel = computed(() => {
  if (pendingExperimentAction.value === 'compare') return '全部算法对比'
  if (pendingExperimentAction.value === 'tune') return '自动调参后训练'
  return '单模型训练'
})
const experimentConfirmLabel = computed(() => {
  if (pendingExperimentAction.value === 'compare') return '确认并开始对比'
  if (pendingExperimentAction.value === 'tune') return '确认并自动调参'
  return '确认并开始训练'
})
const fullDatasetFeatureColumns = computed(() => {
  const columns = summary.value?.dataset.feature_columns
  if (Array.isArray(columns) && columns.length) return columns
  return experimentFeatureColumns.value
})
const trainingFeatureColumns = computed(() => {
  const taskColumns = activeTask.value?.dataset?.feature_columns
  if (Array.isArray(taskColumns) && taskColumns.length) return taskColumns
  return fullDatasetFeatureColumns.value
})
const featureGroupSummaries = computed(() => {
  const buckets = new Map<FeatureGroupKey, string[]>()
  for (const definition of FEATURE_GROUP_DEFINITIONS) {
    buckets.set(definition.key, [])
  }
  for (const column of fullDatasetFeatureColumns.value) {
    buckets.get(classifyFeatureGroup(column))?.push(column)
  }
  return FEATURE_GROUP_DEFINITIONS.map((definition) => {
    const columns = buckets.get(definition.key) || []
    return {
      ...definition,
      count: columns.length,
      columns,
      examples: columns.slice(0, 3),
    }
  })
})
const activeFeatureGroupSummaries = computed(() => featureGroupSummaries.value.filter((group) => group.count > 0))
const featureGainPlan = computed(() => {
  const groups = new Map(featureGroupSummaries.value.map((group) => [group.key, group]))
  const cumulativeColumns: string[] = []
  const cumulativeSet = new Set<string>()
  return FEATURE_GAIN_RECIPES.map((recipe, index) => {
    const recipeGroups = recipe.groups.map((key) => groups.get(key)).filter(Boolean) as Array<(typeof featureGroupSummaries.value)[number]>
    const recipeColumns = recipeGroups.flatMap((group) => group.columns)
    for (const column of recipeColumns) {
      if (cumulativeSet.has(column)) continue
      cumulativeSet.add(column)
      cumulativeColumns.push(column)
    }
    const count = recipeColumns.length
    const cumulativeCount = cumulativeColumns.length
    return {
      ...recipe,
      step: index + 1,
      count,
      cumulativeCount,
      featureColumns: [...cumulativeColumns],
      groupLabels: recipeGroups.map((group) => ({
        key: group.key,
        label: group.shortLabel,
        count: group.count,
      })),
      statusLabel: cumulativeCount > 0 ? (count > 0 ? '可回测' : '沿用前一步') : '待补字段',
      statusClass: cumulativeCount > 0 ? 'bg-[#e8fff2] text-[#0b9d63]' : 'bg-[#fff4da] text-[#b97113]',
    }
  })
})
const featureGainRunnablePlan = computed(() => {
  const seen = new Set<string>()
  return featureGainPlan.value.filter((recipe) => {
    if (!recipe.featureColumns.length) return false
    const signature = recipe.featureColumns.join('\u0000')
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
})
const featureGainCompleted = computed(() => featureGainResults.value.filter((row) => row.status === 'completed'))
const featureGainProgressLabel = computed(() => {
  const done = featureGainResults.value.filter((row) => row.status !== 'queued' && row.status !== 'running').length
  const total = featureGainTotal.value || featureGainResults.value.length
  return `${done} / ${total}`
})
const featureGainCurrentLabel = computed(() => featureGainCurrent.value?.label || '')
const featureGainBestResult = computed(() => [...featureGainCompleted.value].sort((a, b) => featureGainScore(b) - featureGainScore(a))[0] || null)
const segmentMixCompleted = computed(() => segmentMixResults.value.filter((row) => row.status === 'completed' && row.valR2 != null))
const segmentMixSorted = computed(() => [...segmentMixCompleted.value].sort((a, b) => segmentMixScore(b) - segmentMixScore(a)))
const segmentMixFailed = computed(() => segmentMixResults.value.filter((row) => row.status !== 'completed'))
const segmentMixBestResult = computed(() => segmentMixSorted.value[0] || null)
const segmentMixProgressLabel = computed(() => {
  const done = segmentMixResults.value.filter((row) => row.status !== 'queued' && row.status !== 'running').length
  const total = segmentMixTotal.value || segmentMixResults.value.length
  return `${done} / ${total}`
})
const segmentMixCurrentLabel = computed(() => segmentMixCurrent.value?.shortLabel || '')
const fitDiagnostic = computed(() => {
  if (activeTask.value?.status !== 'completed' || !currentPoint.value) return null
  const trainR2 = nullableNumber(currentPoint.value.train_r2)
  const valR2 = nullableNumber(currentPoint.value.val_r2)
  const testR2 = nullableNumber(testMetrics.value?.test_r2)
  const holdoutScores = [valR2, testR2].filter((value): value is number => value != null)
  const featureCount = trainingFeatureColumns.value.length || activeTask.value?.dataset?.feature_dimensions || summary.value?.dataset.feature_dimensions || 0
  const sampleCount = activeTask.value?.dataset?.usable_records || summary.value?.dataset.usable_records || 0
  const lowTrain = trainR2 != null && trainR2 < 0.65
  const lowHoldout = holdoutScores.length > 0 && Math.max(...holdoutScores) < 0.5
  const negativeHoldout = holdoutScores.some((value) => value < 0)
  const trainHigh = trainR2 != null && trainR2 >= 0.82
  const trainValGap = trainR2 != null && valR2 != null ? trainR2 - valR2 : null

  if (lowTrain && lowHoldout) {
    return {
      tone: 'underfit',
      title: '疑似欠拟合：训练集也没有学起来',
      message: `训练 R² 仍偏低，说明当前 ${formatNumber(featureCount)} 个特征不足以表达 μ/COF 的主要变化。优先做特征组增益实验，确认是缺表面/膜层变量，还是离子描述符本身覆盖不够。`,
      metrics: [
        { label: '训练 R²', value: trainR2 },
        { label: '验证 R²', value: valR2 },
        { label: '测试 R²', value: testR2 },
        { label: '样本', value: sampleCount, integer: true },
      ],
      actions: [
        '按下方顺序跑结构核心、+工况、+表面特征、+膜层/链长的对照。',
        '补齐 γ_s、σ_s、Rq、θ_s、I_ss、膜厚和烷基链长后再回测。',
        '如果结构核心仍很低，优先检查 SMILES 标准化和阴/阳离子别名映射。',
      ],
    }
  }

  if (trainHigh && (lowHoldout || negativeHoldout)) {
    return {
      tone: 'overfit',
      title: '更像过拟合或划分外推过难',
      message: `训练 R² 已经较高，但验证/测试没有跟上${trainValGap != null ? `（训练-验证差 ${formatMetric(trainValGap, 3)}）` : ''}。先固定 seed 和 split，看减少高维描述符或补稀有分箱样本是否改善。`,
      metrics: [
        { label: '训练 R²', value: trainR2 },
        { label: '验证 R²', value: valR2 },
        { label: '测试 R²', value: testR2 },
      ],
      actions: [
        '先比较“结构核心”和“结构核心 + 工况”，不要直接堆高维特征。',
        '查看测试集高残差样本，补阳离子 × μ 分箱覆盖不足的区域。',
        '尝试随机森林或梯度提升的更强正则化版本，再比较测试集表现。',
      ],
    }
  }

  if (negativeHoldout) {
    return {
      tone: 'data',
      title: '验证/测试低于均值基线',
      message: 'R² 为负说明模型不如直接预测训练均值。此时先别追算法，应该回看目标值、单位、重复条件冲突和特征缺失。',
      metrics: [
        { label: '训练 R²', value: trainR2 },
        { label: '验证 R²', value: valR2 },
        { label: '测试 R²', value: testR2 },
        { label: '特征', value: featureCount, integer: true },
      ],
      actions: [
        '优先处理残差最大的样本，确认 COF、载荷、速度和温度没有单位错位。',
        '排查同一配方同一工况下目标值差异过大的冲突组。',
        '保留当前 split，再跑特征组增益，避免换划分后误判。',
      ],
    }
  }

  return {
    tone: 'stable',
    title: '当前不像典型欠拟合',
    message: '训练、验证和测试之间没有出现明显的共同低平台。下一步适合用特征组增益实验确认哪些变量真正带来提升。',
    metrics: [
      { label: '训练 R²', value: trainR2 },
      { label: '验证 R²', value: valR2 },
      { label: '测试 R²', value: testR2 },
    ],
    actions: [
      '用同一 seed/split 做阶梯式特征加入，避免把划分波动误认为特征增益。',
      '优先关注测试集提升，并用高残差样本定位需要补数据的稀有组合。',
    ],
  }
})

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
const visibleCompareResults = computed(() => compareResults.value.filter((row) => !HIDDEN_ALGORITHMS.has(row.algorithm)))
const compareSucceeded = computed(() => visibleCompareResults.value.filter((row) => row.status === 'completed' && row.valR2 != null))
const compareSorted = computed(() => [...compareSucceeded.value].sort((a, b) => Number(b.valR2) - Number(a.valR2)))
const compareFailed = computed(() => visibleCompareResults.value.filter((row) => row.status !== 'completed'))
const compareBestAlgorithm = computed(() => compareSorted.value[0] || null)
const negativeR2Diagnostic = computed(() => {
  const currentValR2 = currentPoint.value?.val_r2
  const completedSingleRun = activeTask.value?.status === 'completed' && typeof currentValR2 === 'number' && currentValR2 < 0
  const completedCompare = compareTotal.value > 0 && visibleCompareResults.value.length >= compareTotal.value && !compareMode.value
  const comparedScores = compareSucceeded.value
    .map((row) => row.valR2)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const allComparedNegative = completedCompare && comparedScores.length > 0 && Math.max(...comparedScores) < 0
  if (!completedSingleRun && !allComparedNegative) return null

  const featureCount = activeTask.value?.dataset?.feature_dimensions || summary.value?.dataset.feature_dimensions || 0
  return {
    title: allComparedNegative ? '全部算法的验证集 R² 都低于 0' : '当前模型的验证集 R² 低于 0',
    message: `这不是显示错误,而是模型比“直接预测训练均值”还差。当前数据集只有 ${formatNumber(featureCount)} 个特征,建议回到数据准备重新生成包含更多离子描述符和工况协变量的训练集,再做宏观/AFM 视图筛选。`,
  }
})
const compareProgressLabel = computed(() => {
  if (!compareMode.value && !compareTotal.value) return ''
  const done = visibleCompareResults.value.length
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

const compareR2Axis = computed(() => {
  const values = compareSorted.value
    .map((row) => Number(row.valR2))
    .filter((value) => Number.isFinite(value))
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  return {
    min: min < 0 ? Math.floor((min - 0.05) * 10) / 10 : 0,
    max: max <= 0 ? 0.05 : Math.min(1, Math.ceil((max + 0.05) * 10) / 10),
  }
})

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
      min: compareR2Axis.value.min,
      max: compareR2Axis.value.max,
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

const segmentMixChartData = computed(() => ({
  labels: segmentMixSorted.value.map((row) => row.shortLabel),
  datasets: [
    {
      label: '验证集 R²',
      data: segmentMixSorted.value.map((row) => Number(row.valR2 || 0)),
      backgroundColor: segmentMixSorted.value.map((_, idx) => idx === 0 ? 'rgba(14, 165, 142, 0.85)' : 'rgba(91, 86, 234, 0.62)'),
      borderRadius: 6,
      borderSkipped: false as const,
    },
  ],
}))

const segmentMixR2Axis = computed(() => {
  const values = segmentMixSorted.value
    .map((row) => Number(row.valR2))
    .filter((value) => Number.isFinite(value))
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  return {
    min: min < 0 ? Math.floor((min - 0.05) * 10) / 10 : 0,
    max: max <= 0 ? 0.05 : Math.min(1, Math.ceil((max + 0.05) * 10) / 10),
  }
})

const segmentMixChartOptions = computed(() => ({
  ...compareChartOptions.value,
  plugins: {
    ...compareChartOptions.value.plugins,
    tooltip: {
      ...(compareChartOptions.value.plugins as any)?.tooltip,
      callbacks: {
        label: (ctx: any) => {
          const row = segmentMixSorted.value[ctx.dataIndex]
          if (!row) return `R²：${Number(ctx.parsed.x).toFixed(4)}`
          return [
            `R² = ${formatMetric(row.valR2, 3)}`,
            `RMSE = ${formatMetric(row.valRmse, 3)}`,
            `MAE = ${formatMetric(row.valMae, 3)}`,
            `测试 R² = ${formatMetric(row.testR2, 3)}`,
            `外部 R² = ${formatMetric(row.externalR2, 3)}`,
          ]
        },
      },
    },
  },
  scales: {
    ...compareChartOptions.value.scales,
    x: {
      ...(compareChartOptions.value.scales as any).x,
      min: segmentMixR2Axis.value.min,
      max: segmentMixR2Axis.value.max,
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
    case 'high_cof_segmented': return '论文门控分区堆叠'
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
  if (value == null || Number.isNaN(Number(value))) return '--'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  if (Math.abs(numeric) >= 10000) return numeric.toExponential(2)
  return numeric.toFixed(digits)
}

function formatNumber(value: number | null | undefined) {
  return value == null || Number.isNaN(Number(value)) ? '--' : new Intl.NumberFormat().format(Number(value))
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '--'
}

function normalizeTrainingViewKey(value: string | null | undefined): TrainingViewKey {
  if (value === 'macro_performance' || value === 'afm_surface_response' || value === 'cross_scale' || value === 'all') {
    return value
  }
  return 'afm_surface_response'
}

function trainingViewEntryFor(value: string | null | undefined) {
  const key = normalizeTrainingViewKey(value)
  return TRAINING_VIEW_ENTRIES.find((entry) => entry.key === key) ?? TRAINING_VIEW_ENTRIES[0]!
}

function trainingViewShortLabel(value: string | null | undefined) {
  return trainingViewEntryFor(value).shortLabel
}

function modelTrainingViewKey(model: RegisteredModelListItem | null | undefined): TrainingViewKey {
  return normalizeTrainingViewKey(model?.training_view)
}

function runTrainingViewKey(row: ModelTrainingRunListItem | null | undefined): TrainingViewKey {
  return normalizeTrainingViewKey(row?.training_view || row?.registered_model_training_view)
}

function qualitySliceForScale(scaleKey: QualityScaleKey): QualityAssetSlice | null {
  if (scaleKey === 'all') return allQualitySlice.value
  return qualitySummary.value?.scaleBreakdown?.find((slice) => slice.key === scaleKey) || null
}

function buildTrainingViewWarnings(card: TrainingViewCard | null) {
  if (!card) return []
  const warnings: string[] = []
  const readiness = card.readiness
  const gap = card.sampleGap || 0
  if (card.exploratory) {
    warnings.push(`${card.label}包含多个实验尺度,只建议作为算法对照；正式模型请优先选择宏观摩擦或纳米摩擦视图。`)
  }
  if (readiness?.state === 'limited') {
    warnings.push(`${card.label}训练池只有 ${formatNumber(card.trainableCount)} 条可训练样本,建议先补 ${formatNumber(gap)} 条后再作为正式模型。`)
  } else if (readiness?.state === 'empty' || readiness?.state === 'blocked') {
    warnings.push(`${card.label}训练池暂时未达启动条件,请先补齐目标值、润滑体系和工况字段。`)
  } else if (readiness?.state === 'needs_review') {
    warnings.push(`${card.label}仍有待审记录,建议先完成审阅再冻结正式训练版本。`)
  }
  return warnings
}

function trainingViewReadinessClass(readiness: QualityTrainingReadiness | null | undefined, active = false) {
  if (readiness?.state === 'ready') return active ? 'bg-[#e8fff2] text-[#087443] ring-[#bdeccf]' : 'bg-[#f2fbf5] text-[#28784d] ring-[#d8f3df]'
  if (readiness?.state === 'limited' || readiness?.state === 'needs_review') return active ? 'bg-[#fff4da] text-[#9a5a0b] ring-[#f6d99a]' : 'bg-[#fffaf0] text-[#a16207] ring-[#ffe4b5]'
  if (readiness?.state === 'empty' || readiness?.state === 'blocked') return active ? 'bg-[#fff5f6] text-[#cf334f] ring-[#ffd4da]' : 'bg-[#fff5f6] text-[#cf334f] ring-[#ffd4da]'
  return active ? 'bg-[#f5f7ff] text-[#3d56d2] ring-[#cdd7ff]' : 'bg-[#f8fafc] text-slate-500 ring-[#e2e8f0]'
}

function trainingViewCardClass(card: TrainingViewCard) {
  if (card.active) {
    if (card.readiness?.state === 'ready') return 'border-[#9be4b5] bg-[#f2fbf5] ring-1 ring-[#bdeccf]'
    if (card.readiness?.state === 'limited' || card.readiness?.state === 'needs_review') return 'border-[#f6d99a] bg-[#fffaf0] ring-1 ring-[#f6d99a]/70'
    if (card.readiness?.state === 'empty' || card.readiness?.state === 'blocked') return 'border-[#ffd4da] bg-[#fff5f6] ring-1 ring-[#ffd4da]'
    return 'border-[#aebdfc] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/40'
  }
  return 'border-[#eef2f6] bg-white hover:border-[#d8e0eb]'
}

function trainingViewStatusLabel(card: TrainingViewCard) {
  if (card.readiness?.label) return card.readiness.label
  if (qualityLoading.value) return '加载中'
  if (qualityError.value) return '质量数据不可用'
  return card.badge
}

function selectTrainingView(key: TrainingViewKey) {
  form.data_options.training_view = key
  activeVersionViewKey.value = key
  predictionViewKey.value = key
  experimentPreview.value = null
  experimentPreviewError.value = ''
}

function setActiveVersionView(key: TrainingViewKey) {
  activeVersionViewKey.value = key
}

function setPredictionView(key: TrainingViewKey) {
  predictionViewKey.value = key
  predictionResult.value = null
  predictionError.value = ''
}

async function handleRunPrediction() {
  const model = selectedPredictionModel.value
  if (!model || selectedPredictionDatasetId.value == null) return
  predictionLoading.value = true
  predictionError.value = ''
  predictionResult.value = null
  try {
    const response = await predictWithRegisteredModel(model.id, selectedPredictionDatasetId.value)
    predictionResult.value = response.prediction
    await refreshPredictionRuns()
  } catch (error: any) {
    predictionError.value = error?.response?.data?.detail || error?.message || 'Failed to run prediction.'
  } finally {
    predictionLoading.value = false
  }
}

function trainingViewLabel(value: string | null | undefined) {
  switch (value) {
    case 'macro_performance': return '宏观性能预测'
    case 'afm_surface_response': return 'AFM 表面响应'
    case 'cross_scale': return '跨尺度数据池'
    case 'all': return '统一知识库全部样本'
    default: return value || '未记录'
  }
}

function splitStrategyLabel(value: string | null | undefined) {
  switch (value) {
    case 'joint_stratified': return '阳离子 × μ 分层'
    case 'k_fold': return 'K 折交叉验证'
    case 'literature_group_kfold': return '文献分组 K 折'
    case 'random_holdout': return '随机留出'
    default: return value ? formatTitleLabel(value) : '未记录'
  }
}

function targetAggregationLabel(value: string | null | undefined) {
  switch (value) {
    case 'mean_by_condition': return '按工况均值聚合'
    case 'drop_conflicts': return '剔除冲突组'
    case 'raw':
    default: return '保留原始'
  }
}

function targetOutlierLabel(value: string | null | undefined) {
  switch (value) {
    case 'robust_iqr': return '稳健剔除'
    case 'physical': return '物理越界'
    case 'off': return '不剔除'
    default: return value ? formatTitleLabel(value) : '稳健剔除'
  }
}

function targetNoiseToneClass() {
  const conflicts = Number(targetNoise.value?.conflict_groups || 0)
  const ceiling = nullableNumber(targetNoise.value?.estimated_r2_ceiling)
  if (conflicts > 0 || (ceiling != null && ceiling < 0.75)) return 'border-[#ffe4b5] bg-[#fffaf0]'
  if (Number(targetNoise.value?.duplicate_condition_groups || 0) > 0) return 'border-[#cdd7ff] bg-[#f5f7ff]'
  return 'border-[#dbe4f2] bg-white'
}

function targetNoiseBadgeClass() {
  const conflicts = Number(targetNoise.value?.conflict_groups || 0)
  const ceiling = nullableNumber(targetNoise.value?.estimated_r2_ceiling)
  if (conflicts > 0 || (ceiling != null && ceiling < 0.75)) return 'bg-[#fff4da] text-[#b97113]'
  if (Number(targetNoise.value?.duplicate_condition_groups || 0) > 0) return 'bg-[#edf2ff] text-[#3d56d2]'
  return 'bg-[#e8fff2] text-[#0b9d63]'
}

function targetNoiseBadgeLabel() {
  const conflicts = Number(targetNoise.value?.conflict_groups || 0)
  if (conflicts > 0) return `${conflicts} 组冲突`
  if (Number(targetNoise.value?.duplicate_condition_groups || 0) > 0) return '存在重复工况'
  return '未见明显重复噪声'
}

function versionScoreLabel(value: { test_r2?: number | null; val_r2?: number | null }) {
  return value.test_r2 != null ? '测试 R²' : '验证 R²'
}

function versionScoreValue(value: { test_r2?: number | null; val_r2?: number | null }) {
  return value.test_r2 != null ? value.test_r2 : value.val_r2
}

function sampleSourceLabel(source: DiagSample['source']) {
  if (source === 'test') return '测试'
  if (source === 'external') return '外推'
  return '验证'
}

function sampleSourceBadgeClass(source: DiagSample['source']) {
  if (source === 'test') return 'bg-[#fff5f6] text-[#cf334f]'
  if (source === 'external') return 'bg-[#fff7ed] text-[#c2410c]'
  return 'bg-[#f5f7ff] text-[#5b56ea]'
}

function formatTargetRange(minValue: number | null | undefined, maxValue: number | null | undefined) {
  if (minValue == null || maxValue == null) return 'μ --'
  return `μ ${formatMetric(minValue, 3)}-${formatMetric(maxValue, 3)}`
}

function splitSubsetTone(key: string | null | undefined) {
  if (key === 'test') return 'text-[#cf334f]'
  if (key === 'external') return 'text-[#c2410c]'
  return 'text-[#5b56ea]'
}

function splitBinWidth(count: number | null | undefined) {
  const value = Math.max(0, Number(count || 0))
  return `${Math.max(3, (value / maxSplitBinTotal.value) * 100)}%`
}

function reportFeatureWidth(value: number | null | undefined) {
  const numeric = Math.max(0, Number(value || 0))
  return `${Math.max(4, (numeric / maxReportFeatureImportance.value) * 100)}%`
}

function riskSeverityLabel(severity: string | null | undefined) {
  if (severity === 'high') return '高风险'
  if (severity === 'medium') return '需关注'
  return '提示'
}

function riskSeverityClass(severity: string | null | undefined) {
  if (severity === 'high') return 'border-[#ffd4da] bg-[#fff5f6] text-[#cf334f]'
  if (severity === 'medium') return 'border-[#ffe4b5] bg-[#fffaf0] text-[#a16207]'
  return 'border-[#dbeafe] bg-[#f0f7ff] text-[#2563eb]'
}

function diagnosticSeverityClass(severity: string | null | undefined) {
  if (severity === 'high') return 'border-[#ffd4da] bg-[#fff5f6]'
  if (severity === 'medium') return 'border-[#ffe4b5] bg-[#fffaf0]'
  return 'border-[#dbe4f2] bg-white'
}

function diagnosticBadgeClass(kind: string | null | undefined) {
  if (kind === 'out_of_range') return 'bg-[#fff5f6] text-[#cf334f] ring-[#ffd4da]'
  if (kind === 'unseen_stratum') return 'bg-[#fff4da] text-[#b97113] ring-[#f6d99a]'
  if (kind === 'sparse_cation' || kind === 'sparse_bin') return 'bg-[#f5f7ff] text-[#5b56ea] ring-[#cdd7ff]'
  if (kind === 'large_residual') return 'bg-[#fff5f6] text-[#cf334f] ring-[#ffd4da]'
  return 'bg-slate-100 text-slate-600 ring-[#e2e8f0]'
}

function classifyFeatureGroup(column: string | null | undefined): FeatureGroupKey {
  const normalized = String(column || '').trim().toLowerCase()
  const compact = normalized.replace(/[^\wμµγθσ]+/g, '_')
  if (!compact) return 'other'
  if (/(^|_)pca(_|$)|(^|_)pc\d+(_|$)|principal_component/.test(compact)) return 'pca'
  if (/(^|_)cation(_|$)|(^|_)cat(_|$)|_cat$|cation|阳离子/.test(compact)) return 'cation_descriptor'
  if (/(^|_)anion(_|$)|(^|_)an(_|$)|_an$|anion|阴离子/.test(compact)) return 'anion_descriptor'
  if (/(gamma_s|γ_s|sigma_s|σ_s|surface|substrate|(^|_)sub(_|$)|rough|(^|_)rq(_|$)|theta_s|θ_s|contact_angle|wetting|i_ss|(^|_)iss(_|$))/.test(compact)) {
    return 'surface_feature'
  }
  if (/(load|force|speed|velocity|temperature|(^|_)temp(_|$)|potential|voltage|water|humidity|(^|_)ph(_|$)|pressure|sliding|frequency|stroke|cycle)/.test(compact)) {
    return 'process_condition'
  }
  if (/(film|thickness|chain|alkyl|adsorption|layer|viscosity|density|molecular_weight|(^|_)mw(_|$))/.test(compact)) {
    return 'mechanism_feature'
  }
  if (/(morgan|fingerprint|fpdensity|balaban|bertz|kappa|chi|tpsa|labute|logp|molmr|descriptor|(^|_)fp(_|$)|bit)/.test(compact)) {
    return 'fingerprint'
  }
  return 'other'
}

function fitDiagnosticClass(tone: string | null | undefined) {
  if (tone === 'underfit') return 'border-[#fed7aa] bg-[#fff7ed]'
  if (tone === 'overfit') return 'border-[#cdd7ff] bg-[#f5f7ff]'
  if (tone === 'data') return 'border-[#ffd4da] bg-[#fff5f6]'
  return 'border-[#dbe4f2] bg-white'
}

function fitDiagnosticBadgeClass(tone: string | null | undefined) {
  if (tone === 'underfit') return 'bg-[#fff4da] text-[#b97113]'
  if (tone === 'overfit') return 'bg-[#edf2ff] text-[#3d56d2]'
  if (tone === 'data') return 'bg-[#fff5f6] text-[#cf334f]'
  return 'bg-[#e8fff2] text-[#0b9d63]'
}

function diagnosticMetricValue(item: { value: number | null | undefined; integer?: boolean }) {
  if (item.value == null) return '--'
  return item.integer ? formatNumber(item.value) : formatMetric(item.value, 3)
}

function featureGainScore(row: FeatureGainRunStep | null | undefined) {
  const testScore = nullableNumber(row?.testR2)
  if (testScore != null) return testScore
  const valScore = nullableNumber(row?.valR2)
  return valScore ?? Number.NEGATIVE_INFINITY
}

function segmentMixScore(row: SegmentMixRunStep | null | undefined) {
  const testScore = nullableNumber(row?.testR2)
  const externalScore = nullableNumber(row?.externalR2)
  if (testScore != null && externalScore != null) return (testScore + externalScore) / 2
  if (testScore != null) return testScore
  const valScore = nullableNumber(row?.valR2)
  return valScore ?? Number.NEGATIVE_INFINITY
}

function featureGainResultFor(key: string) {
  return featureGainResults.value.find((row) => row.key === key) || null
}

function featureGainStatusLabel(status: FeatureGainRunStep['status'] | null | undefined) {
  if (status === 'completed') return '完成'
  if (status === 'running') return '训练中'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已中止'
  return '排队'
}

function featureGainStatusClass(status: FeatureGainRunStep['status'] | null | undefined) {
  if (status === 'completed') return 'bg-[#e8fff2] text-[#0b9d63]'
  if (status === 'running') return 'bg-[#edf2ff] text-[#3d56d2]'
  if (status === 'failed') return 'bg-[#fff5f6] text-[#cf334f]'
  if (status === 'cancelled') return 'bg-[#fff4da] text-[#b97113]'
  return 'bg-slate-100 text-slate-500'
}

function featureGainDelta(row: FeatureGainRunStep | null | undefined) {
  if (!row || row.status !== 'completed') return null
  const currentIndex = featureGainResults.value.findIndex((item) => item.key === row.key)
  if (currentIndex <= 0) return null
  const previous = [...featureGainResults.value.slice(0, currentIndex)]
    .reverse()
    .find((item) => item.status === 'completed')
  if (!previous) return null
  const currentScore = featureGainScore(row)
  const previousScore = featureGainScore(previous)
  if (!Number.isFinite(currentScore) || !Number.isFinite(previousScore)) return null
  return currentScore - previousScore
}

function featureGainDeltaLabel(row: FeatureGainRunStep | null | undefined) {
  const delta = featureGainDelta(row)
  if (delta == null) return ''
  return `${delta >= 0 ? '+' : ''}${formatMetric(delta, 3)}`
}

function diagnosticSampleForInspect(item: ModelTrainingExternalDiagnosticItem): DiagSample {
  return {
    source: 'external',
    recordId: nullableNumber(item.record_id),
    literatureId: nullableNumber(item.literature_id),
    rowIndex: nullableNumber(item.row_index),
    actual: Number(item.actual),
    predicted: Number(item.predicted),
    residual: Number(item.residual),
    absResidual: Number(item.abs_residual),
  }
}

function targetDisplayLabel(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[μµ]/g, 'mu').replace(/[^a-z0-9]+/g, '')
  if (['mu', 'cof', 'targetcof', 'targetmu', 'frictioncoefficient', 'coefficientoffriction'].includes(normalized)) {
    return '摩擦系数 μ/COF'
  }
  return formatColumnLabel(value)
}

function formatColumnLabel(value: string | null | undefined) {
  return String(value || '').replace(/_/g, ' ')
}

function formatTitleLabel(value: string | null | undefined) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function preferredTrainingViewKey(): TrainingViewKey {
  if (selectedDataset.value?.dataset_kind === 'imported_csv' || selectedDataset.value?.dataset_kind === 'wff_thesis_csv') {
    return 'all'
  }
  const datasetView = selectedDataset.value?.summary?.rules?.training_view
  const normalized = normalizeTrainingViewKey(datasetView)
  return datasetView && normalized !== 'all' ? normalized : 'afm_surface_response'
}

function ensureExplicitTrainingView(replaceMixedDefault = false) {
  const current = normalizeTrainingViewKey(form.data_options.training_view)
  if (replaceMixedDefault && (!form.data_options.training_view || current === 'all')) {
    form.data_options.training_view = preferredTrainingViewKey()
    activeVersionViewKey.value = form.data_options.training_view
    predictionViewKey.value = form.data_options.training_view
    return
  }
  form.data_options.training_view = current
  activeVersionViewKey.value = current
  predictionViewKey.value = current
}

function hydrateDefaults(nextSummary: ModelTrainingSummary) {
  form.target = nextSummary.defaults.target
  form.algorithm = nextSummary.defaults.algorithm
  Object.assign(form.hyperparameters, nextSummary.defaults.hyperparameters)
  Object.assign(form.data_options, nextSummary.defaults.data_options)
  ensureExplicitTrainingView(true)
  form.cleaned_dataset_id = nextSummary.defaults.cleaned_dataset_id // selectedCleanedDatasetId.value
}

async function refreshSavedDatasets() {
  const response = await listCleanedDatasets()
  savedDatasets.value = response.items
  if (selectedPredictionDatasetId.value == null) {
    selectedPredictionDatasetId.value = response.items[0]?.id ?? null
  }
}

async function handleImportWffThesisDatasets() {
  if (wffImporting.value || activeTask.value?.status === 'running') return
  wffImporting.value = true
  loadError.value = ''
  try {
    const response = await importWffThesisDatasets()
    await refreshSavedDatasets()
    const datasetB = response.items.find((dataset) => dataset.import_metadata?.wff_dataset_key === 'dataset_b')
      || response.items.find((dataset) => dataset.name.includes('Dataset-B'))
      || response.items[0]
    if (datasetB) {
      selectedCleanedDatasetId.value = datasetB.id
      await refreshTrainingSummary(datasetB.id, true)
      form.algorithm = 'catboost'
      form.data_options.training_view = 'all'
      form.data_options.split_strategy = 'wff_thesis'
      form.data_options.target_aggregation_strategy = 'raw'
      form.data_options.target_outlier_strategy = 'off'
      activeWorkbenchTab.value = 'experiments'
    }
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || '导入论文复现数据失败。'
  } finally {
    wffImporting.value = false
  }
}

async function refreshModelVersions() {
  const [runsResponse, registryResponse] = await Promise.all([
    listModelTrainingRuns(30),
    listRegisteredModels(),
  ])
  trainingRuns.value = runsResponse.items
  registeredModels.value = registryResponse.items
}

async function refreshPredictionRuns() {
  predictionHistoryLoading.value = true
  predictionHistoryError.value = ''
  try {
    const response = await listModelPredictionRuns(30)
    predictionRuns.value = response.items
  } catch (error: any) {
    predictionHistoryError.value = error?.response?.data?.detail || error?.message || 'Failed to load prediction history.'
  } finally {
    predictionHistoryLoading.value = false
  }
}

async function refreshQualitySummary() {
  qualityLoading.value = true
  qualityError.value = ''
  try {
    qualitySummary.value = await getQualityAssetSummary()
  } catch (error: any) {
    qualityError.value = error?.response?.data?.detail || error?.message || 'Failed to load quality assets.'
  } finally {
    qualityLoading.value = false
  }
}

function defaultVersionNameForActiveTask() {
  const task = activeTask.value
  if (!task) return datasetTitle.value
  const datasetName = activeRunVersion.value?.cleaned_dataset_name || selectedDataset.value?.name || datasetTitle.value
  const stamp = formatDateTime(task.finished_at || task.created_at)
  return `${algorithmLabelZh(task.config.algorithm)} / ${datasetName} / ${stamp}`
}

function openSaveVersionModal() {
  if (!canSaveActiveVersion.value || !activeTask.value) return
  const existing = activeRegisteredModel.value
  versionError.value = ''
  saveVersionName.value = existing?.name || defaultVersionNameForActiveTask()
  saveVersionDescription.value = existing?.description || ''
  saveVersionRecommended.value = existing?.is_recommended ?? !recommendedModelForActiveTaskView.value
  showSaveVersionModal.value = true
}

function closeSaveVersionModal() {
  if (versionActionLoading.value === 'save-version') return
  showSaveVersionModal.value = false
}

async function refreshModelVersionsQuietly() {
  try {
    await refreshModelVersions()
  } catch (error: any) {
    versionError.value = error?.response?.data?.detail || error?.message || 'Failed to load model versions.'
  }
}

async function handleSaveVersion() {
  if (!activeTask.value || activeTask.value.status !== 'completed') return
  versionActionLoading.value = 'save-version'
  versionError.value = ''
  try {
    await registerModelTrainingRun(activeTask.value.task_id, {
      name: saveVersionName.value.trim() || null,
      description: saveVersionDescription.value.trim() || null,
      is_recommended: saveVersionRecommended.value,
    })
    activeVersionViewKey.value = activeTaskTrainingViewKey.value
    showSaveVersionModal.value = false
    await refreshModelVersions()
  } catch (error: any) {
    versionError.value = error?.response?.data?.detail || error?.message || 'Failed to save model version.'
  } finally {
    versionActionLoading.value = ''
  }
}

async function handleViewRun(taskId: string) {
  versionActionLoading.value = `view-${taskId}`
  versionError.value = ''
  try {
    const response = await getModelTrainingRun(taskId)
    activeTask.value = response.task
    form.algorithm = response.task.config.algorithm
    const runView = normalizeTrainingViewKey(response.task.config.data_options?.training_view || response.task.dataset.filters?.training_view)
    form.data_options.training_view = runView
    activeVersionViewKey.value = runView
    predictionViewKey.value = runView
    if (response.task.config.cleaned_dataset_id != null) {
      selectedCleanedDatasetId.value = response.task.config.cleaned_dataset_id
      form.cleaned_dataset_id = response.task.config.cleaned_dataset_id
    }
  } catch (error: any) {
    versionError.value = error?.response?.data?.detail || error?.message || 'Failed to load training run.'
  } finally {
    versionActionLoading.value = ''
  }
}

async function handleSaveRunAsVersion(row: ModelTrainingRunListItem) {
  if (row.status !== 'completed') return
  await handleViewRun(row.task_id)
  if (activeTask.value?.task_id === row.task_id) openSaveVersionModal()
}

async function handleEditVersion(model: RegisteredModelListItem) {
  await handleViewRun(model.task_id)
  if (activeTask.value?.task_id === model.task_id) openSaveVersionModal()
}

async function handleDeleteVersion(model: RegisteredModelListItem) {
  if (!window.confirm(`删除模型版本“${model.name}”？训练 run 会保留，之后仍可从训练回看重新保存。`)) return
  versionActionLoading.value = `delete-${model.id}`
  versionError.value = ''
  try {
    await deleteRegisteredModel(model.id)
    await refreshModelVersions()
  } catch (error: any) {
    versionError.value = error?.response?.data?.detail || error?.message || 'Failed to delete model version.'
  } finally {
    versionActionLoading.value = ''
  }
}

async function handleRecommendVersion(model: RegisteredModelListItem, recommended = true) {
  versionActionLoading.value = `recommend-${model.id}`
  versionError.value = ''
  try {
    await setRecommendedRegisteredModel(model.id, recommended)
    await refreshModelVersions()
  } catch (error: any) {
    versionError.value = error?.response?.data?.detail || error?.message || 'Failed to update recommended model.'
  } finally {
    versionActionLoading.value = ''
  }
}

async function refreshTrainingSummary(datasetId: number | null, applyDefaults: boolean = false) {
  const nextSummary = await getModelTrainingSummary(datasetId)
  summary.value = nextSummary
  form.target = nextSummary.defaults.target
  form.cleaned_dataset_id = datasetId // nextSummary.defaults.cleaned_dataset_id // null
  if (applyDefaults) {
    hydrateDefaults(nextSummary)
  } else {
    ensureExplicitTrainingView(false)
  }
}

async function initialize() {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([
      refreshSavedDatasets(),
      refreshModelVersions(),
      refreshPredictionRuns(),
      refreshQualitySummary(),
    ])
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
  if (HIDDEN_ALGORITHMS.has(snapshot.config.algorithm)) return
  const existing = compareResults.value.find((row) => row.taskId === snapshot.task_id)
  const row: ComparisonRow = {
    algorithm: snapshot.config.algorithm,
    taskId: snapshot.task_id,
    status: (snapshot.status as ComparisonRow['status']) || 'cancelled',
    valR2: snapshot.current?.val_r2 ?? null,
    valRmse: snapshot.current?.val_rmse ?? null,
    valMae: snapshot.current?.val_mae ?? null,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    snapshot,
    error: snapshot.error,
  }
  if (existing) Object.assign(existing, row)
  else compareResults.value.push(row)
}

function canViewCompareResult(row: ComparisonRow) {
  return Boolean(row.snapshot) && !compareMode.value && activeTask.value?.status !== 'running'
}

function isCompareRowActive(row: ComparisonRow) {
  return activeTask.value?.task_id === row.taskId
}

function viewCompareResult(row: ComparisonRow) {
  if (!canViewCompareResult(row) || !row.snapshot) return
  activeTask.value = row.snapshot
  form.algorithm = row.algorithm
}

async function onTaskTerminal(snapshot: ModelTrainingTaskSnapshot) {
  void refreshModelVersionsQuietly()
  if (segmentMixMode.value) {
    recordSegmentMixResult(snapshot)
    if (snapshot.status === 'cancelled') {
      segmentMixMode.value = false
      segmentMixQueue.value = []
      segmentMixCurrent.value = null
      return
    }
    if (segmentMixQueue.value.length) {
      await runNextSegmentMixItem()
    } else {
      segmentMixMode.value = false
      segmentMixCurrent.value = null
    }
    return
  }
  if (featureGainMode.value) {
    recordFeatureGainResult(snapshot)
    if (snapshot.status === 'cancelled') {
      featureGainMode.value = false
      featureGainQueue.value = []
      featureGainCurrent.value = null
      return
    }
    if (featureGainQueue.value.length) {
      await runNextFeatureGainItem()
    } else {
      featureGainMode.value = false
      featureGainCurrent.value = null
      featureGainBaseAlgorithm.value = null
    }
    return
  }
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

function recordFeatureGainResult(snapshot: ModelTrainingTaskSnapshot) {
  const current = featureGainCurrent.value
  if (!current) return
  const row: FeatureGainRunStep = {
    ...current,
    status: (snapshot.status as FeatureGainRunStep['status']) || 'cancelled',
    taskId: snapshot.task_id,
    valR2: snapshot.current?.val_r2 ?? null,
    valRmse: snapshot.current?.val_rmse ?? null,
    valMae: snapshot.current?.val_mae ?? null,
    testR2: snapshot.test_metrics?.test_r2 ?? null,
    testRmse: snapshot.test_metrics?.test_rmse ?? null,
    testMae: snapshot.test_metrics?.test_mae ?? null,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    snapshot,
    error: snapshot.error,
  }
  upsertFeatureGainResult(row)
}

function upsertFeatureGainResult(row: FeatureGainRunStep) {
  const existing = featureGainResults.value.find((item) => item.key === row.key)
  if (existing) Object.assign(existing, row)
  else featureGainResults.value.push(row)
}

function buildFeatureGainSteps(): FeatureGainRunStep[] {
  return featureGainRunnablePlan.value.map((recipe) => ({
    key: recipe.key,
    label: recipe.label,
    step: recipe.step,
    purpose: recipe.purpose,
    featureColumns: recipe.featureColumns,
    featureCount: recipe.count,
    cumulativeCount: recipe.cumulativeCount,
    status: 'queued',
    taskId: null,
    valR2: null,
    valRmse: null,
    valMae: null,
    testR2: null,
    testRmse: null,
    testMae: null,
    finishedAt: null,
    snapshot: null,
    error: null,
  }))
}

async function runNextFeatureGainItem() {
  const next = featureGainQueue.value.shift()
  if (!next) {
    featureGainMode.value = false
    featureGainCurrent.value = null
    featureGainBaseAlgorithm.value = null
    return
  }
  const runningStep = { ...next, status: 'running' as const }
  featureGainCurrent.value = runningStep
  upsertFeatureGainResult(runningStep)
  loadError.value = ''
  await startTrainingRun({
    tune: false,
    algorithm: featureGainBaseAlgorithm.value || form.algorithm,
    featureSubset: {
      key: next.key,
      label: next.label,
      columns: next.featureColumns,
    },
  })
  if (loadError.value) {
    upsertFeatureGainResult({
      ...runningStep,
      status: 'failed',
      taskId: `error-${Date.now()}`,
      finishedAt: new Date().toISOString(),
      error: loadError.value,
    })
    if (featureGainQueue.value.length) {
      await runNextFeatureGainItem()
    } else {
      featureGainMode.value = false
      featureGainCurrent.value = null
      featureGainBaseAlgorithm.value = null
    }
  }
}

async function handleStartFeatureGainExperiment() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  const steps = buildFeatureGainSteps()
  if (!steps.length) return
  featureGainResults.value = steps.map((step) => ({ ...step }))
  featureGainQueue.value = steps.map((step) => ({ ...step }))
  featureGainTotal.value = steps.length
  featureGainBaseAlgorithm.value = form.algorithm
  featureGainMode.value = true
  await runNextFeatureGainItem()
}

async function handleStopFeatureGainExperiment() {
  if (!featureGainMode.value) return
  featureGainQueue.value = []
  if (activeTask.value && activeTask.value.status === 'running') {
    await handleCancelTraining()
  } else {
    featureGainMode.value = false
    featureGainCurrent.value = null
    featureGainBaseAlgorithm.value = null
  }
}

function viewFeatureGainResult(key: string) {
  const row = featureGainResultFor(key)
  if (!row?.snapshot || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  activeTask.value = row.snapshot
  form.algorithm = row.snapshot.config.algorithm
}

function upsertSegmentMixResult(row: SegmentMixRunStep) {
  const existing = segmentMixResults.value.find((item) => item.key === row.key)
  if (existing) Object.assign(existing, row)
  else segmentMixResults.value.push(row)
}

function recordSegmentMixResult(snapshot: ModelTrainingTaskSnapshot) {
  const current = segmentMixCurrent.value
  if (!current) return
  const external = snapshot.insights?.external_metrics || null
  upsertSegmentMixResult({
    ...current,
    status: (snapshot.status as SegmentMixRunStep['status']) || 'cancelled',
    taskId: snapshot.task_id,
    valR2: snapshot.current?.val_r2 ?? null,
    valRmse: snapshot.current?.val_rmse ?? null,
    valMae: snapshot.current?.val_mae ?? null,
    testR2: snapshot.test_metrics?.test_r2 ?? null,
    testRmse: snapshot.test_metrics?.test_rmse ?? null,
    testMae: snapshot.test_metrics?.test_mae ?? null,
    externalR2: external?.external_r2 ?? null,
    externalRmse: external?.external_rmse ?? null,
    externalMae: external?.external_mae ?? null,
    finishedAt: snapshot.finished_at || snapshot.created_at,
    snapshot,
    error: snapshot.error,
  })
}

function buildSegmentMixStep(recipe: SegmentMixRecipe, status: SegmentMixRunStep['status'] = 'queued'): SegmentMixRunStep {
  return {
    key: recipe.key,
    label: recipe.label,
    shortLabel: recipe.shortLabel,
    baseModels: recipe.baseModels,
    metaModel: recipe.metaModel,
    purpose: recipe.purpose,
    status,
    taskId: null,
    valR2: null,
    valRmse: null,
    valMae: null,
    testR2: null,
    testRmse: null,
    testMae: null,
    externalR2: null,
    externalRmse: null,
    externalMae: null,
    finishedAt: null,
    snapshot: null,
    error: null,
  }
}

async function runNextSegmentMixItem() {
  const next = segmentMixQueue.value.shift()
  if (!next) {
    segmentMixMode.value = false
    segmentMixCurrent.value = null
    return
  }
  const runningStep = buildSegmentMixStep(next, 'running')
  segmentMixCurrent.value = runningStep
  upsertSegmentMixResult(runningStep)
  loadError.value = ''
  await startTrainingRun({
    tune: false,
    algorithm: 'high_cof_segmented',
    hyperparameters: next.hyperparameters,
  })
  if (loadError.value) {
    upsertSegmentMixResult({
      ...runningStep,
      status: 'failed',
      taskId: `error-${Date.now()}`,
      finishedAt: new Date().toISOString(),
      error: loadError.value,
    })
    if (segmentMixQueue.value.length) {
      await runNextSegmentMixItem()
    } else {
      segmentMixMode.value = false
      segmentMixCurrent.value = null
    }
  }
}

async function handleStartSegmentMixExperiment() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  if (!segmentMixPlan.value.length) return
  segmentMixResults.value = segmentMixPlan.value.map((recipe) => buildSegmentMixStep(recipe))
  segmentMixQueue.value = segmentMixPlan.value.slice()
  segmentMixTotal.value = segmentMixPlan.value.length
  segmentMixMode.value = true
  await runNextSegmentMixItem()
}

async function handleStopSegmentMixExperiment() {
  if (!segmentMixMode.value) return
  segmentMixQueue.value = []
  if (activeTask.value && activeTask.value.status === 'running') {
    await handleCancelTraining()
  } else {
    segmentMixMode.value = false
    segmentMixCurrent.value = null
  }
}

function viewSegmentMixResult(row: SegmentMixRunStep) {
  if (!row.snapshot || segmentMixMode.value || activeTask.value?.status === 'running') return
  activeTask.value = row.snapshot
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
  await startTrainingRun({ tune: false })
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

async function startCompareAllConfirmed() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (selectedTrainingViewHardBlocked.value) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  const algorithms = availableAlgorithms.value.map((alg) => alg.key)
  if (!algorithms.length) return
  compareResults.value = []
  compareQueue.value = algorithms.slice()
  compareTotal.value = algorithms.length
  compareMode.value = true
  await runNextCompareItem()
}

async function handleCompareAll() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (selectedTrainingViewHardBlocked.value) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  await openExperimentPreview('compare')
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

function buildTrainingPayload(options: {
  tune?: boolean
  algorithm?: string
  featureSubset?: { key: string; label: string; columns: string[] }
  hyperparameters?: Record<string, unknown>
} = {}): ModelTrainingStartPayload | null {
  if (!summary.value || selectedCleanedDatasetId.value == null) return null
  const dataOptions = { ...form.data_options }
  if (options.featureSubset) {
    dataOptions.feature_columns = options.featureSubset.columns
    dataOptions.feature_subset_key = options.featureSubset.key
    dataOptions.feature_subset_label = options.featureSubset.label
  } else {
    delete dataOptions.feature_columns
    delete dataOptions.feature_subset_key
    delete dataOptions.feature_subset_label
  }
  return {
    target: summary.value.dataset.target_column || form.target,
    algorithm: options.algorithm || form.algorithm,
    hyperparameters: { ...form.hyperparameters, ...(options.hyperparameters || {}) },
    data_options: dataOptions,
    cleaned_dataset_id: selectedCleanedDatasetId.value,
    tune: Boolean(options.tune) && !compareMode.value && !featureGainMode.value && !segmentMixMode.value,
  }
}

async function loadExperimentPreview(action: 'start' | 'tune' | 'compare') {
  const payload = buildTrainingPayload({ tune: action === 'tune' })
  if (!payload) return
  experimentPreviewLoading.value = true
  experimentPreviewError.value = ''
  experimentPreview.value = null
  try {
    experimentPreview.value = await previewModelTrainingPlan(payload)
  } catch (error: any) {
    experimentPreviewError.value = error?.response?.data?.detail || error?.message || 'Failed to preview training plan.'
  } finally {
    experimentPreviewLoading.value = false
  }
}

async function openExperimentPreview(action: 'start' | 'tune' | 'compare') {
  pendingExperimentAction.value = action
  showExperimentModal.value = true
  await loadExperimentPreview(action)
}

function closeExperimentPreview() {
  if (starting.value || experimentPreviewLoading.value) return
  showExperimentModal.value = false
  pendingExperimentAction.value = null
}

async function startTrainingRun(options: {
  tune?: boolean
  algorithm?: string
  featureSubset?: { key: string; label: string; columns: string[] }
  hyperparameters?: Record<string, unknown>
} = {}) {
  if (selectedTrainingViewHardBlocked.value) return
  const payload = buildTrainingPayload(options)
  if (!payload) return
  starting.value = true
  loadError.value = ''
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

async function confirmExperimentStart() {
  const action = pendingExperimentAction.value
  if (!action || experimentPreviewLoading.value || experimentPreviewError.value || selectedTrainingViewHardBlocked.value) return
  showExperimentModal.value = false
  pendingExperimentAction.value = null
  if (action === 'compare') {
    await startCompareAllConfirmed()
    return
  }
  await startTrainingRun({ tune: action === 'tune' })
}

async function handleStartTraining() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (selectedTrainingViewHardBlocked.value) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  await openExperimentPreview('start')
}

async function handleAutoTune() {
  if (!summary.value || selectedCleanedDatasetId.value == null) return
  if (selectedTrainingViewHardBlocked.value) return
  if (compareMode.value || featureGainMode.value || segmentMixMode.value || activeTask.value?.status === 'running') return
  await openExperimentPreview('tune')
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

watch(
  () => splitFolds.value.length,
  (length) => {
    if (!length || activeFoldIndex.value >= length) activeFoldIndex.value = 0
  },
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
          v-if="selectedTrainingViewCard"
          class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1"
          :class="trainingViewReadinessClass(selectedTrainingViewCard.readiness, true)"
        >
          {{ selectedTrainingViewCard.label }} · {{ trainingViewStatusLabel(selectedTrainingViewCard) }}
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
          {{ fitProgressLabel }}
        </span>
        <span
          v-if="compareMode"
          class="shrink-0 rounded-full bg-[#5b56ea]/10 px-2.5 py-0.5 text-xs font-semibold text-[#5b56ea]"
        >
          对比中 {{ compareProgressLabel }} · {{ compareCurrentLabel }}
        </span>
        <span
          v-if="featureGainMode"
          class="shrink-0 rounded-full bg-[#5b56ea]/10 px-2.5 py-0.5 text-xs font-semibold text-[#5b56ea]"
        >
          特征增益 {{ featureGainProgressLabel }} · {{ featureGainCurrentLabel }}
        </span>
        <span
          v-if="segmentMixMode"
          class="shrink-0 rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-xs font-semibold text-[#0f766e]"
        >
          论文复刻 {{ segmentMixProgressLabel }} · {{ segmentMixCurrentLabel }}
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
          v-if="!compareMode && !featureGainMode && !segmentMixMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] bg-[#5b56ea] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_10px_24px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
          :disabled="trainingLaunchDisabled"
          @click="handleStartTraining"
        >
          <Loader2 v-if="starting" class="h-3.5 w-3.5 animate-spin" />
          <Play v-else class="h-3.5 w-3.5" />
          {{ starting ? '启动中' : '开始训练' }}
        </button>
        <button
          v-if="!compareMode && !featureGainMode && !segmentMixMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] border border-[#5b56ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#5b56ea] transition hover:bg-[#f5f7ff] disabled:cursor-not-allowed disabled:border-[#cfd2f3] disabled:text-[#cfd2f3]"
          :disabled="trainingLaunchDisabled || !summary"
          title="对当前算法做小规模网格搜索，自动找到最佳超参数后再训练"
          @click="handleAutoTune"
        >
          <Sparkles class="h-3.5 w-3.5" />
          自动调参
        </button>
        <button
          v-if="!compareMode && !featureGainMode && !segmentMixMode"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-[0.6rem] border border-[#5b56ea] bg-white px-3 py-1.5 text-xs font-semibold text-[#5b56ea] transition hover:bg-[#f5f7ff] disabled:cursor-not-allowed disabled:border-[#cfd2f3] disabled:text-[#cfd2f3]"
          :disabled="trainingCompareDisabled"
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
          v-if="featureGainMode"
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#ffd4da] bg-white px-2.5 py-1.5 text-xs font-medium text-[#cf334f] transition hover:bg-[#fff5f6]"
          @click="handleStopFeatureGainExperiment"
        >
          <Square class="h-3.5 w-3.5" />
          停止特征实验
        </button>
        <button
          v-if="segmentMixMode"
          type="button"
          class="inline-flex items-center gap-1 rounded-[0.6rem] border border-[#ffd4da] bg-white px-2.5 py-1.5 text-xs font-medium text-[#cf334f] transition hover:bg-[#fff5f6]"
          @click="handleStopSegmentMixExperiment"
        >
          <Square class="h-3.5 w-3.5" />
          停止分段实验
        </button>
        <button
          v-if="!compareMode && !featureGainMode && !segmentMixMode"
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
              <button
                type="button"
                class="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[0.6rem] border border-[#bbf7d0] bg-[#f0fdfa] px-3 py-2 text-xs font-semibold text-[#0f766e] transition hover:bg-[#dcfce7] disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="wffImporting || activeTask?.status === 'running'"
                title="导入内置论文复现数据，并保留论文固定划分"
                @click="handleImportWffThesisDatasets"
              >
                <Loader2 v-if="wffImporting" class="h-3.5 w-3.5 animate-spin" />
                <Database v-else class="h-3.5 w-3.5" />
                {{ wffImporting ? '正在导入论文复现数据' : '导入论文复现数据' }}
              </button>
              <div v-if="hasSavedDatasets" class="mt-2.5 grid grid-cols-3 gap-2 text-xs">
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

            <!-- ② 训练视图 -->
            <section>
              <p class="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#5b56ea] text-[9px] text-white">2</span>
                训练视图
              </p>
              <div v-if="qualityError" class="mb-2 rounded-[0.6rem] border border-[#ffe4b5] bg-[#fffaf0] px-3 py-2 text-[11px] leading-5 text-[#854d0e]">
                Quality 状态暂不可用，训练仍会按所选视图过滤。
              </div>
              <div class="space-y-2">
                <button
                  v-for="card in trainingViewCards"
                  :key="card.key"
                  type="button"
                  class="w-full rounded-[0.75rem] border px-3 py-2.5 text-left transition"
                  :class="trainingViewCardClass(card)"
                  @click="selectTrainingView(card.key)"
                >
                  <span class="flex items-start justify-between gap-2">
                    <span class="min-w-0">
                      <span class="block text-sm font-semibold text-slate-950">{{ card.label }}</span>
                      <span class="mt-0.5 block text-[11px] leading-4 text-slate-500">{{ card.detail }}</span>
                    </span>
                    <span
                      class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1"
                      :class="trainingViewReadinessClass(card.readiness, card.active)"
                    >
                      {{ trainingViewStatusLabel(card) }}
                    </span>
                  </span>
                  <span class="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-semibold text-slate-500">
                    <span class="rounded-md bg-white/75 px-2 py-1 ring-1 ring-black/5">
                      可训练 {{ formatNumber(card.trainableCount) }}
                    </span>
                    <span class="rounded-md bg-white/75 px-2 py-1 ring-1 ring-black/5">
                      活跃 {{ formatNumber(card.activeCount) }}
                    </span>
                    <span
                      class="rounded-md bg-white/75 px-2 py-1 ring-1 ring-black/5"
                      :class="card.sampleGap ? 'text-[#a16207]' : 'text-[#28784d]'"
                    >
                      {{ card.sampleGap ? `缺 ${formatNumber(card.sampleGap)}` : '达标' }}
                    </span>
                  </span>
                </button>
              </div>
              <div
                v-if="selectedTrainingViewWarnings.length"
                class="mt-2 rounded-[0.6rem] border border-[#ffe4b5] bg-[#fffaf0] px-3 py-2 text-[11px] leading-5 text-[#854d0e]"
              >
                <p v-for="warning in selectedTrainingViewWarnings" :key="warning">{{ warning }}</p>
              </div>
            </section>

            <!-- ③ 算法 -->
            <section>
              <p class="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                <span class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#5b56ea] text-[9px] text-white">3</span>
                算法
              </p>
              <div class="space-y-1.5">
                <label
                  v-for="algorithm in availableAlgorithms"
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

            <!-- ④ 高级设置（默认折叠） -->
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

                <div class="border-t border-[#eef2f6] pt-3">
                  <label class="block text-xs">
                    <span
                      class="mb-1 block font-semibold text-slate-700"
                      title="处理同一离子液体、同一实验工况下 COF 不一致的重复实验。均值聚合通常能降低目标噪声，排除冲突组适合先做干净基线。"
                    >重复工况处理</span>
                    <select
                      v-model="form.data_options.target_aggregation_strategy"
                      class="h-8 w-full rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2 text-xs text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                    >
                      <option v-for="option in targetAggregationOptions" :key="option.key" :value="option.key">
                        {{ option.label }}
                      </option>
                    </select>
                    <p class="mt-1.5 text-[11px] leading-snug text-slate-500">
                      {{ selectedAggregationOption?.description || '选择训练前如何处理重复工况目标噪声。' }}
                    </p>
                    <p
                      v-if="form.data_options.target_aggregation_strategy === 'drop_conflicts'"
                      class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-700"
                    >
                      拟合优先会显著减少训练样本：隔离测试曲线通常更好看，但交叉验证 R² 可能因每折样本太少而偏低。
                    </p>
                  </label>
                </div>

                <div class="border-t border-[#eef2f6] pt-3">
                  <label class="block text-xs">
                    <span
                      class="mb-1 block font-semibold text-slate-700"
                      title="仅从训练矩阵中排除极端目标值，不会删除 Knowledge 原始记录。适合 COF=3.4 这类少数点把模型整体拉歪的情况。"
                    >目标异常点处理</span>
                    <select
                      v-model="form.data_options.target_outlier_strategy"
                      class="h-8 w-full rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2 text-xs text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                    >
                      <option v-for="option in targetOutlierOptions" :key="option.key" :value="option.key">
                        {{ option.label }}
                      </option>
                    </select>
                    <p class="mt-1.5 text-[11px] leading-snug text-slate-500">
                      {{ selectedOutlierOption?.description || '选择训练前如何处理极端目标值。' }}
                    </p>
                  </label>
                  <div
                    v-if="form.data_options.target_outlier_strategy === 'robust_iqr'"
                    class="mt-2 grid grid-cols-2 gap-2 text-[11px]"
                  >
                    <label>
                      <span class="mb-1 block font-semibold text-slate-500">IQR 倍数</span>
                      <input
                        v-model.number="form.data_options.target_outlier_iqr_multiplier"
                        type="number"
                        min="1"
                        max="6"
                        step="0.5"
                        class="h-8 w-full rounded-[0.5rem] border border-[#e2e8f0] bg-white px-2 text-xs outline-none focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                      >
                    </label>
                    <label>
                      <span class="mb-1 block font-semibold text-slate-500">COF 上限</span>
                      <input
                        v-model.number="form.data_options.target_outlier_max"
                        type="number"
                        min="0.5"
                        max="5"
                        step="0.1"
                        class="h-8 w-full rounded-[0.5rem] border border-[#e2e8f0] bg-white px-2 text-xs outline-none focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                      >
                    </label>
                  </div>
                  <p
                    v-if="targetOutliers?.rows_removed"
                    class="mt-2 rounded-md border border-[#d8f3df] bg-[#f2fbf5] px-2 py-1.5 text-[11px] leading-snug text-[#28784d]"
                  >
                    当前预览会从训练矩阵排除 {{ targetOutliers.rows_removed }} 条目标异常点；原始数据库不受影响。
                  </p>
                </div>

                <p class="text-[11px] leading-5 text-slate-500">
                  随机种子 {{ form.data_options.random_seed }}<template v-if="form.data_options.split_strategy === 'random_holdout'"> · 验证集占比 {{ validationSplitPercent }}%</template><template v-else-if="form.data_options.split_strategy === 'joint_stratified'"> · 测试集约 {{ validationSplitPercent }}% · {{ form.data_options.cv_folds || 5 }} 折 CV</template><template v-else> · 折数 {{ form.data_options.cv_folds || 5 }}</template>
                  · {{ targetAggregationLabel(form.data_options.target_aggregation_strategy) }}
                  · {{ targetOutlierLabel(form.data_options.target_outlier_strategy) }}
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
        <header class="shrink-0 border-b border-[#eef2f6] bg-white px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">训练工作台</p>
              <p class="mt-1 truncate text-xs text-slate-500">
                {{ activeWorkbenchTabMeta.description }}
              </p>
            </div>
            <div class="flex max-w-full gap-1 overflow-x-auto rounded-[0.75rem] bg-[#f8fafc] p-1 ring-1 ring-[#e2e8f0]">
              <button
                v-for="tab in workbenchTabs"
                :key="tab.key"
                type="button"
                class="shrink-0 rounded-[0.58rem] px-3 py-1.5 text-xs font-semibold transition"
                :class="activeWorkbenchTab === tab.key
                  ? 'bg-[#5b56ea] text-white shadow-[0_10px_22px_-18px_rgba(91,86,234,0.95)]'
                  : 'text-slate-500 hover:bg-white hover:text-slate-900'"
                @click="activeWorkbenchTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>
        </header>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar p-4">
          <!-- 4 个核心指标：训练 / 验证 / 测试 / 进度 -->
          <section v-if="activeWorkbenchTab === 'overview'" class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
                title='完全藏起来不参与训练的数据，最后给模型出一份"考卷"。论文复现策略下按阳离子 × μ 分箱做 8:2 分层切分。'
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

          <section v-if="activeWorkbenchTab === 'overview'" class="grid gap-2.5 md:grid-cols-3">
            <button
              type="button"
              class="rounded-[0.85rem] border border-[#e2e8f0] bg-[#fbfcff] px-4 py-3 text-left transition hover:border-[#aebdfc] hover:bg-[#f8faff]"
              @click="activeWorkbenchTab = 'data'"
            >
              <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-[#64748b]">先看数据</p>
              <p class="mt-1 text-sm font-semibold text-slate-950">划分、外推与重复噪声</p>
            </button>
            <button
              type="button"
              class="rounded-[0.85rem] border border-[#e2e8f0] bg-[#fbfcff] px-4 py-3 text-left transition hover:border-[#aebdfc] hover:bg-[#f8faff]"
              @click="activeWorkbenchTab = 'experiments'"
            >
              <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-[#64748b]">再做实验</p>
              <p class="mt-1 text-sm font-semibold text-slate-950">特征增益、调参、算法对比</p>
            </button>
            <button
              type="button"
              class="rounded-[0.85rem] border border-[#e2e8f0] bg-[#fbfcff] px-4 py-3 text-left transition hover:border-[#aebdfc] hover:bg-[#f8faff]"
              @click="activeWorkbenchTab = 'reports'"
            >
              <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-[#64748b]">最后读报告</p>
              <p class="mt-1 text-sm font-semibold text-slate-950">训练摘要、特征重要性</p>
            </button>
          </section>

          <section
            v-if="activeWorkbenchTab === 'data' && datasetSplit"
            class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] px-4 py-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#64748b]">数据划分策略</p>
                <p class="mt-1 text-sm font-semibold text-slate-900">{{ datasetSplit.label }}</p>
              </div>
              <div class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span class="rounded-full bg-white px-2.5 py-1 ring-1 ring-[#e2e8f0]">训练池 {{ datasetSplit.train_pool_size ?? activeTask?.dataset?.pool_size ?? 0 }}</span>
                <span class="rounded-full bg-white px-2.5 py-1 ring-1 ring-[#e2e8f0]">测试集 {{ datasetSplit.test_size ?? activeTask?.dataset?.test_size ?? 0 }}</span>
                <span
                  v-if="Number(datasetSplit.external_size ?? activeTask?.dataset?.external_size ?? 0) > 0"
                  class="rounded-full bg-white px-2.5 py-1 ring-1 ring-[#e2e8f0]"
                >外推验证 {{ datasetSplit.external_size ?? activeTask?.dataset?.external_size ?? 0 }}</span>
                <span v-if="datasetSplit.cv_folds" class="rounded-full bg-white px-2.5 py-1 ring-1 ring-[#e2e8f0]">{{ datasetSplit.cv_folds }} 折 CV</span>
              </div>
            </div>
            <p
              v-if="datasetSplit.strategy === 'joint_stratified'"
              class="mt-2 text-xs leading-5 text-slate-500"
            >
              联合标签 {{ datasetSplit.strata_count ?? 0 }} 组 · 稀有单样本组合 {{ datasetSplit.singleton_strata ?? 0 }} 组 · μ 分箱 {{ datasetSplit.target_bin_count ?? 0 }} 档 · 阳离子 {{ datasetSplit.cation_count ?? 0 }} 类
            </p>
            <p
              v-if="externalMetrics"
              class="mt-1 text-xs leading-5 text-slate-500"
            >
              外推验证 R² {{ formatMetric(externalMetrics.external_r2, 3) }} · RMSE {{ formatMetric(externalMetrics.external_rmse, 3) }} · MAE {{ formatMetric(externalMetrics.external_mae, 3) }} · {{ externalMetrics.sample_count }} 行
            </p>

            <div
              v-if="externalValidationNote"
              class="mt-2 rounded-[0.7rem] border px-3 py-2 text-xs leading-5"
              :class="externalValidationNote.severity === 'medium' ? 'border-[#ffe4b5] bg-[#fffaf0] text-[#854d0e]' : 'border-[#dbeafe] bg-[#f0f7ff] text-[#1d4ed8]'"
            >
              <p class="font-semibold">{{ externalValidationNote.title }}</p>
              <p class="mt-0.5 opacity-90">{{ externalValidationNote.message }}</p>
              <div v-if="topExternalResiduals.length" class="mt-2 grid gap-1.5 md:grid-cols-2">
                <button
                  v-for="(sample, idx) in topExternalResiduals.slice(0, 4)"
                  :key="`external-note-${sample.rowIndex}-${idx}`"
                  type="button"
                  class="flex min-w-0 items-center gap-2 rounded-[0.55rem] border border-white/70 bg-white/75 px-2.5 py-1.5 text-left text-[11px] transition hover:bg-white"
                  :disabled="sample.recordId == null"
                  title="回 Knowledge 定位这条外推残差样本"
                  @click="handleInspectRecord(sample)"
                >
                  <span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#f59e0b]/15 text-[9px] font-bold text-[#c2410c]">{{ idx + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate tabular-nums">
                    真实 {{ formatMetric(sample.actual, 3) }} -> 预测 {{ formatMetric(sample.predicted, 3) }}
                  </span>
                  <span class="shrink-0 font-semibold tabular-nums">|残差| {{ formatMetric(sample.absResidual, 3) }}</span>
                </button>
              </div>
            </div>

            <div v-if="splitDetails" class="mt-3 border-t border-[#e2e8f0] pt-3">
              <div class="mb-3 inline-flex rounded-[0.65rem] bg-white p-1 ring-1 ring-[#e2e8f0]">
                <button
                  v-for="tab in splitDetailTabs"
                  :key="tab.key"
                  type="button"
                  class="rounded-[0.5rem] px-3 py-1.5 text-[11px] font-semibold transition"
                  :class="splitDetailTab === tab.key ? 'bg-[#5b56ea] text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'"
                  @click="splitDetailTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>

              <div v-if="splitDetailTab === 'subsets'" class="space-y-3">
                <div class="grid gap-3 sm:grid-cols-3">
                  <div
                    v-for="subset in splitSubsets"
                    :key="subset.key || subset.label"
                    class="min-w-0 border-l-2 pl-3"
                    :class="subset.key === 'test' ? 'border-[#cf334f]' : subset.key === 'external' ? 'border-[#f97316]' : 'border-[#5b56ea]'"
                  >
                    <p class="text-[10px] font-bold uppercase tracking-[0.14em]" :class="splitSubsetTone(subset.key)">
                      {{ subset.label }}
                    </p>
                    <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(subset.count) }}</p>
                    <p class="mt-0.5 text-[11px] leading-4 text-slate-500">
                      {{ subset.cation_count }} 类阳离子 · {{ subset.strata_count }} 个联合标签
                    </p>
                    <p class="text-[11px] text-slate-400 tabular-nums">
                      {{ formatTargetRange(subset.target_min, subset.target_max) }}
                    </p>
                  </div>
                </div>

                <div v-if="splitStrataPreview.length" class="border-t border-[#eef2f6] pt-2">
                  <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
                    <span>联合标签预览</span>
                    <span>{{ splitDetails.strata_total }} 组<template v-if="splitDetails.strata_truncated">，仅显示前 120 组</template></span>
                  </div>
                  <div class="grid gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-2">
                    <div
                      v-for="stratum in splitStrataPreview"
                      :key="stratum.stratum"
                      class="flex min-w-0 items-center gap-2"
                    >
                      <span class="min-w-0 flex-1 truncate font-medium text-slate-700">{{ stratum.cation }}</span>
                      <span class="shrink-0 text-slate-400">{{ stratum.bin_label }}</span>
                      <span class="shrink-0 tabular-nums text-slate-500">
                        训 {{ stratum.train_pool || 0 }} / 测 {{ stratum.test || 0 }} / 外推 {{ stratum.external || 0 }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="splitDetailTab === 'bins'" class="space-y-2">
                <div
                  v-for="bin in splitBins"
                  :key="bin.bin"
                  class="grid gap-2 border-b border-[#eef2f6] pb-2 text-xs last:border-b-0 last:pb-0 sm:grid-cols-[8rem_minmax(0,1fr)_10rem]"
                >
                  <div>
                    <p class="font-semibold text-slate-900">{{ bin.label }}</p>
                    <p class="text-[11px] text-slate-400">bin {{ bin.bin }}</p>
                  </div>
                  <div class="min-w-0">
                    <div class="mt-1 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                      <div class="h-full rounded-full bg-[#5b56ea]" :style="{ width: splitBinWidth(bin.total || bin.count) }" />
                    </div>
                    <p class="mt-1 text-[11px] text-slate-500">
                      训练池 {{ bin.train_pool || 0 }} · 测试 {{ bin.test || 0 }} · 外推 {{ bin.external || 0 }}
                    </p>
                  </div>
                  <p class="self-center text-right text-sm font-semibold text-slate-950 tabular-nums">
                    {{ formatNumber(bin.total || bin.count) }} 行
                  </p>
                </div>
              </div>

              <div v-else class="space-y-3">
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="(fold, idx) in splitFolds"
                    :key="fold.label"
                    type="button"
                    class="rounded-full px-2.5 py-1 text-[11px] font-semibold transition"
                    :class="activeFoldIndex === idx ? 'bg-[#5b56ea] text-white' : 'bg-white text-slate-500 ring-1 ring-[#e2e8f0] hover:text-slate-900'"
                    @click="activeFoldIndex = idx"
                  >
                    {{ fold.label }}
                  </button>
                </div>

                <div v-if="selectedFold" class="grid gap-3 md:grid-cols-[13rem_minmax(0,1fr)]">
                  <div class="space-y-2 text-xs">
                    <div>
                      <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5b56ea]">训练折</p>
                      <p class="mt-0.5 text-base font-semibold text-slate-950">{{ formatNumber(selectedFold.train.count) }} 行</p>
                      <p class="text-[11px] text-slate-500">{{ selectedFold.train.cation_count }} 类阳离子 · {{ selectedFold.train.strata_count }} 标签</p>
                    </div>
                    <div class="border-t border-[#eef2f6] pt-2">
                      <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f766e]">验证折</p>
                      <p class="mt-0.5 text-base font-semibold text-slate-950">{{ formatNumber(selectedFold.validation.count) }} 行</p>
                      <p class="text-[11px] text-slate-500">{{ selectedFold.validation.cation_count }} 类阳离子 · {{ selectedFold.validation.strata_count }} 标签</p>
                    </div>
                  </div>

                  <div class="min-w-0 space-y-2">
                    <div>
                      <p class="mb-1 text-[11px] font-semibold text-slate-500">验证折 μ 覆盖</p>
                      <div class="flex flex-wrap gap-1.5">
                        <span
                          v-for="bin in selectedFold.validation_bins"
                          :key="`${selectedFold.label}-${bin.bin}`"
                          class="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-[#e2e8f0]"
                        >
                          {{ bin.label }} · {{ bin.count }} 行
                        </span>
                      </div>
                    </div>
                    <div>
                      <p class="mb-1 text-[11px] font-semibold text-slate-500">验证折联合标签</p>
                      <div class="grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
                        <div
                          v-for="stratum in selectedFold.validation_strata"
                          :key="`${selectedFold.label}-${stratum.stratum}`"
                          class="flex min-w-0 items-center gap-2"
                        >
                          <span class="min-w-0 flex-1 truncate font-medium text-slate-700">{{ stratum.cation }}</span>
                          <span class="shrink-0 text-slate-400">{{ stratum.bin_label }}</span>
                          <span class="shrink-0 font-semibold text-slate-900 tabular-nums">{{ stratum.count }} 行</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'data' && targetNoise"
            class="rounded-[0.95rem] border p-4"
            :class="targetNoiseToneClass()"
          >
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#c2410c]">
                  <AlertTriangle class="h-3.5 w-3.5" />
                  重复工况与目标噪声
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-600">
                  同一离子液体、相近载荷/速度/温度/电位下，如果 COF 波动很大，验证集和测试集会天然被压低。
                  当前策略：<span class="font-semibold text-slate-900">{{ targetNoiseAppliedLabel }}</span>
                  <template v-if="targetNoise.recommended_strategy && targetNoise.recommended_strategy !== targetNoise.strategy_applied">
                    · 建议尝试 <span class="font-semibold text-[#5b56ea]">{{ targetNoiseRecommendationLabel }}</span>
                  </template>
                </p>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="targetNoiseBadgeClass()">
                {{ targetNoiseBadgeLabel() }}
              </span>
            </div>

            <div class="grid gap-2 sm:grid-cols-4">
              <div class="rounded-[0.7rem] border border-white/70 bg-white/75 px-3 py-2">
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa0ba]">重复工况</p>
                <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">
                  {{ formatNumber(targetNoise.duplicate_condition_groups) }}
                </p>
                <p class="text-[10px] text-slate-400">{{ formatNumber(targetNoise.duplicate_condition_records) }} 条记录</p>
              </div>
              <div class="rounded-[0.7rem] border border-white/70 bg-white/75 px-3 py-2">
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa0ba]">冲突组</p>
                <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">
                  {{ formatNumber(targetNoise.conflict_groups) }}
                </p>
                <p class="text-[10px] text-slate-400">阈值 Δμ ≥ {{ formatMetric(targetNoise.conflict_threshold?.absolute_range, 2) }}</p>
              </div>
              <div class="rounded-[0.7rem] border border-white/70 bg-white/75 px-3 py-2">
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa0ba]">噪声 RMSE</p>
                <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">
                  {{ formatMetric(targetNoise.within_condition_rmse, 3) }}
                </p>
                <p class="text-[10px] text-slate-400">同工况内部波动</p>
              </div>
              <div class="rounded-[0.7rem] border border-white/70 bg-white/75 px-3 py-2">
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa0ba]">估计 R² 上限</p>
                <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">
                  {{ formatMetric(targetNoise.estimated_r2_ceiling, 3) }}
                </p>
                <p class="text-[10px] text-slate-400">重复噪声粗估</p>
              </div>
            </div>

            <div
              v-if="targetNoise.rows_before_aggregation != null && targetNoise.rows_after_aggregation != null && targetNoise.strategy_applied !== 'raw'"
              class="mt-3 rounded-[0.7rem] border border-white/70 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600"
            >
              {{ targetNoiseAppliedLabel }} 已将 {{ formatNumber(targetNoise.rows_before_aggregation) }} 条候选样本处理为
              {{ formatNumber(targetNoise.rows_after_aggregation) }} 条训练样本。
              <template v-if="targetNoise.groups_merged_by_strategy">
                合并 {{ formatNumber(targetNoise.groups_merged_by_strategy) }} 组重复工况。
              </template>
              <template v-if="targetNoise.rows_removed_by_strategy">
                排除 {{ formatNumber(targetNoise.rows_removed_by_strategy) }} 条冲突记录。
              </template>
            </div>

            <div v-if="targetNoiseTopGroups.length" class="mt-3 space-y-1.5">
              <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-[#8fa0ba]">
                波动最大的重复组
              </p>
              <div
                v-for="group in targetNoiseTopGroups"
                :key="group.key"
                class="grid gap-2 rounded-[0.7rem] border bg-white/75 px-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_7rem_7rem]"
                :class="group.is_conflict ? 'border-[#ffe4b5]' : 'border-white/80'"
              >
                <div class="min-w-0">
                  <p class="truncate font-semibold text-slate-900" :title="group.label">{{ group.label }}</p>
                  <p class="mt-0.5 truncate text-[11px] text-slate-500">
                    μ: {{ group.values.map((value) => formatMetric(value, 3)).join(' / ') }}
                  </p>
                </div>
                <p class="self-center text-slate-600 tabular-nums">
                  {{ group.count }} 条 · Δ {{ formatMetric(group.range, 3) }}
                </p>
                <p class="self-center text-right font-semibold tabular-nums" :class="group.is_conflict ? 'text-[#b97113]' : 'text-slate-700'">
                  σ {{ formatMetric(group.std, 3) }}
                </p>
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'overview' && negativeR2Diagnostic"
            class="rounded-[0.85rem] border border-[#ffd4da] bg-[#fff5f6] px-4 py-3"
          >
            <p class="flex items-center gap-1.5 text-xs font-semibold text-[#cf334f]">
              <AlertTriangle class="h-3.5 w-3.5" />
              {{ negativeR2Diagnostic.title }}
            </p>
            <p class="mt-1.5 text-xs leading-5 text-[#9f1239]">
              {{ negativeR2Diagnostic.message }}
            </p>
          </section>

          <section
            v-if="activeWorkbenchTab === 'diagnostics' && fitDiagnostic"
            class="rounded-[0.95rem] border p-4"
            :class="fitDiagnosticClass(fitDiagnostic.tone)"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <AlertTriangle class="h-3.5 w-3.5" />
                  拟合状态诊断
                </p>
                <h3 class="mt-1 text-base font-semibold tracking-[-0.03em] text-slate-950">
                  {{ fitDiagnostic.title }}
                </h3>
                <p class="mt-1 text-xs leading-5 text-slate-600">
                  {{ fitDiagnostic.message }}
                </p>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold" :class="fitDiagnosticBadgeClass(fitDiagnostic.tone)">
                {{ fitDiagnostic.tone === 'underfit' ? '优先补特征表达' : fitDiagnostic.tone === 'overfit' ? '优先看泛化' : fitDiagnostic.tone === 'data' ? '优先核数据' : '继续做增益实验' }}
              </span>
            </div>

            <div class="mt-3 grid gap-2 sm:grid-cols-4">
              <div
                v-for="metric in fitDiagnostic.metrics"
                :key="metric.label"
                class="rounded-[0.7rem] border border-white/70 bg-white/75 px-3 py-2"
              >
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa0ba]">{{ metric.label }}</p>
                <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">
                  {{ diagnosticMetricValue(metric) }}
                </p>
              </div>
            </div>

            <div class="mt-3 grid gap-2 lg:grid-cols-3">
              <div
                v-for="action in fitDiagnostic.actions"
                :key="action"
                class="rounded-[0.7rem] border border-white/80 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600"
              >
                {{ action }}
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'experiments'"
            class="rounded-[0.95rem] border border-[#bbf7d0] bg-gradient-to-br from-[#f0fdfa] via-white to-[#f8fafc] p-4"
          >
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#0f766e]">
                  <Layers class="h-3.5 w-3.5" />
                  论文门控分区复刻
                </p>
                <p class="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
                  按论文第 4 章执行：CatBoost 门控低/中/高摩擦区间，并用 CatBoost、RF、XGBoost 的稳定融合复刻固定划分下的检验和外部文献验证效果。
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                <span class="rounded-full bg-white/80 px-2.5 py-1 text-[#0f766e] ring-1 ring-[#bbf7d0]">
                  {{ segmentMixPlan.length }} 个组合
                </span>
                <button
                  v-if="!segmentMixMode"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full bg-[#0f766e] px-3 py-1 text-[11px] font-semibold text-white shadow-[0_10px_24px_-18px_rgba(15,118,110,0.85)] transition hover:bg-[#0b635d] disabled:cursor-not-allowed disabled:bg-[#b6dfd8] disabled:shadow-none"
                  :disabled="starting || compareMode || featureGainMode || activeTask?.status === 'running' || selectedCleanedDatasetId == null || !segmentMixPlan.length"
                  title="固定当前数据划分，依次训练论文中的二基和三基门控分区方案"
                  @click="handleStartSegmentMixExperiment"
                >
                  <Play class="h-3 w-3" />
                  开始论文复刻
                </button>
                <button
                  v-else
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-[#ffd4da] bg-white px-3 py-1 text-[11px] font-semibold text-[#cf334f] transition hover:bg-[#fff5f6]"
                  @click="handleStopSegmentMixExperiment"
                >
                  <Square class="h-3 w-3" />
                  停止
                </button>
              </div>
            </div>

            <div class="grid gap-3 xl:grid-cols-[1fr_1.1fr]">
              <div class="space-y-2">
                <article
                  v-for="recipe in segmentMixPlan"
                  :key="recipe.key"
                  class="rounded-[0.75rem] border border-[#ccfbf1] bg-white/85 px-3 py-2"
                >
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="text-sm font-semibold text-slate-950">{{ recipe.label }}</p>
                      <p class="mt-1 text-[11px] leading-5 text-slate-500">{{ recipe.purpose }}</p>
                    </div>
                    <span class="shrink-0 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-semibold text-[#0f766e]">
                      固定融合
                    </span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    <span
                      v-for="modelKey in recipe.baseModels"
                      :key="`${recipe.key}-${modelKey}`"
                      class="rounded-full bg-[#f8fafc] px-2 py-1 text-slate-600 ring-1 ring-[#e2e8f0]"
                    >
                      {{ algorithmLabelZh(modelKey) }}
                    </span>
                  </div>
                </article>
              </div>

              <div class="rounded-[0.85rem] border border-[#ccfbf1] bg-white/85 p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0f766e]">混合效果对比</p>
                  <span class="text-[10px] text-slate-400">
                    <template v-if="segmentMixMode">运行中 {{ segmentMixProgressLabel }}</template>
                    <template v-else-if="segmentMixResults.length">已完成 {{ segmentMixCompleted.length }} / {{ segmentMixResults.length }}</template>
                    <template v-else>固定划分与随机种子，独立复刻入口</template>
                  </span>
                </div>
                <div
                  v-if="segmentMixBestResult"
                  class="mb-2 rounded-[0.7rem] border border-[#99f6e4] bg-[#ecfdf5] px-3 py-2 text-xs text-slate-700"
                >
                  当前最佳：
                  <span class="font-semibold text-[#0f766e]">{{ segmentMixBestResult.shortLabel }}</span>
                  · 验证 R² {{ formatMetric(segmentMixBestResult.valR2, 3) }}
                  · 测试 R² {{ formatMetric(segmentMixBestResult.testR2, 3) }}
                  · 外部 R² {{ formatMetric(segmentMixBestResult.externalR2, 3) }}
                </div>
                <div v-if="segmentMixSorted.length" :style="{ height: `${Math.max(140, segmentMixSorted.length * 42)}px` }">
                  <Bar :data="segmentMixChartData" :options="segmentMixChartOptions" />
                </div>
                <div v-if="segmentMixResults.length" class="mt-3 space-y-1.5">
                  <button
                    v-for="(row, idx) in segmentMixSorted"
                    :key="row.key"
                    type="button"
                    class="flex w-full flex-wrap items-center gap-2 rounded-[0.6rem] border px-3 py-2 text-left text-xs transition"
                    :class="[
                      activeTask?.task_id === row.taskId
                        ? 'border-[#0f766e] bg-[#ecfdf5] ring-1 ring-[#99f6e4]/70'
                        : idx === 0
                          ? 'border-[#99f6e4] bg-[#f0fdfa]'
                          : 'border-[#eef2f6] bg-white',
                      row.snapshot && !segmentMixMode && activeTask?.status !== 'running' ? 'cursor-pointer hover:border-[#99f6e4] hover:bg-[#f0fdfa]' : 'cursor-default',
                    ]"
                    :disabled="!row.snapshot || segmentMixMode || activeTask?.status === 'running'"
                    @click="viewSegmentMixResult(row)"
                  >
                    <span
                      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      :class="idx === 0 ? 'bg-[#0f766e] text-white' : 'bg-slate-100 text-slate-600'"
                    >{{ idx + 1 }}</span>
                    <span class="min-w-0 flex-1 truncate font-medium text-slate-800">
                      {{ row.shortLabel }}
                    </span>
                    <span class="shrink-0 font-semibold text-slate-900 tabular-nums">R²={{ formatMetric(row.valR2, 3) }}</span>
                    <span class="shrink-0 text-slate-500 tabular-nums">测试={{ formatMetric(row.testR2, 3) }}</span>
                    <span class="shrink-0 text-slate-500 tabular-nums">外部={{ formatMetric(row.externalR2, 3) }}</span>
                  </button>
                  <div
                    v-for="row in segmentMixFailed"
                    :key="`segment-failed-${row.key}`"
                    class="flex items-center gap-3 rounded-[0.6rem] border border-[#ffe4e6] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
                  >
                    <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
                    <span class="min-w-0 flex-1 truncate font-medium">{{ row.shortLabel }} · {{ row.status === 'failed' ? '失败' : '已中止' }}</span>
                  </div>
                </div>
                <div v-else class="rounded-[0.6rem] border border-dashed border-[#a7f3d0] bg-[#f0fdfa]/60 px-3 py-3 text-center text-xs text-slate-500">
                  <Loader2 v-if="segmentMixMode" class="mx-auto h-4 w-4 animate-spin text-[#0f766e]" />
                  <p class="mt-1">{{ segmentMixMode ? '正在训练第一个论文复刻组合...' : '尚未运行论文复刻实验' }}</p>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'experiments' && activeFeatureGroupSummaries.length"
            class="rounded-[0.95rem] border border-[#dbe4f2] bg-white p-4"
          >
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <Layers class="h-3.5 w-3.5" />
                  特征组增益实验入口
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  建议固定同一 seed、同一 split、同一算法，逐步加入特征组。这样可以判断低 R² 是离子结构表达不足、工况缺失，还是表面/膜层变量缺口。
                </p>
              </div>
              <div class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  {{ formatNumber(fullDatasetFeatureColumns.length) }} 个特征
                </span>
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  {{ activeFeatureGroupSummaries.length }} 组已识别
                </span>
                <button
                  v-if="!featureGainMode"
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full bg-[#5b56ea] px-3 py-1 text-[11px] font-semibold text-white shadow-[0_10px_24px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
                  :disabled="starting || compareMode || segmentMixMode || activeTask?.status === 'running' || selectedCleanedDatasetId == null || !featureGainRunnablePlan.length"
                  title="按同一算法、同一 seed 和同一 split 依次训练累计特征组"
                  @click="handleStartFeatureGainExperiment"
                >
                  <Play class="h-3 w-3" />
                  开始增益实验
                </button>
                <button
                  v-else
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-[#ffd4da] bg-white px-3 py-1 text-[11px] font-semibold text-[#cf334f] transition hover:bg-[#fff5f6]"
                  @click="handleStopFeatureGainExperiment"
                >
                  <Square class="h-3 w-3" />
                  停止
                </button>
              </div>
            </div>

            <div class="grid gap-3 xl:grid-cols-[1fr_1.1fr]">
              <div class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">当前特征池</p>
                  <span class="text-[10px] text-slate-400">按列名自动归组</span>
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <article
                    v-for="group in activeFeatureGroupSummaries"
                    :key="group.key"
                    class="rounded-[0.7rem] border px-3 py-2"
                    :class="group.toneClass"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <p class="truncate text-sm font-semibold">{{ group.label }}</p>
                      <span class="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold tabular-nums">
                        {{ group.count }}
                      </span>
                    </div>
                    <p class="mt-1 text-[11px] leading-4 opacity-80">{{ group.description }}</p>
                    <p v-if="group.examples.length" class="mt-1 truncate text-[10px] opacity-70" :title="group.columns.join(', ')">
                      {{ group.examples.map(formatColumnLabel).join(' / ') }}
                    </p>
                  </article>
                </div>
              </div>

              <div class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">建议回测顺序</p>
                  <span class="text-[10px] text-slate-400">
                    <template v-if="featureGainMode">运行中 {{ featureGainProgressLabel }}</template>
                    <template v-else-if="featureGainResults.length">已完成 {{ featureGainCompleted.length }} / {{ featureGainResults.length }}</template>
                    <template v-else>同一划分与随机种子</template>
                  </span>
                </div>
                <div
                  v-if="featureGainBestResult"
                  class="mb-2 rounded-[0.7rem] border border-[#cdd7ff] bg-[#f5f7ff] px-3 py-2 text-xs text-slate-700"
                >
                  当前最佳：
                  <span class="font-semibold text-[#5b56ea]">{{ featureGainBestResult.label }}</span>
                  · 测试 R² {{ formatMetric(featureGainBestResult.testR2, 3) }}
                  · 验证 R² {{ formatMetric(featureGainBestResult.valR2, 3) }}
                </div>
                <div class="space-y-2">
                  <article
                    v-for="recipe in featureGainPlan"
                    :key="recipe.key"
                    class="rounded-[0.7rem] border border-[#e2e8f0] bg-white px-3 py-2"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="flex items-center gap-2 text-sm font-semibold text-slate-950">
                          <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f5f7ff] text-[10px] font-bold text-[#5b56ea] ring-1 ring-[#cdd7ff]">
                            {{ recipe.step }}
                          </span>
                          {{ recipe.label }}
                        </p>
                        <p class="mt-1 text-[11px] leading-5 text-slate-500">{{ recipe.purpose }}</p>
                      </div>
                      <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="recipe.statusClass">
                        {{ recipe.statusLabel }}
                      </span>
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold">
                      <span
                        v-for="group in recipe.groupLabels"
                        :key="`${recipe.key}-${group.key}`"
                        class="rounded-full bg-[#f8fafc] px-2 py-1 text-slate-600 ring-1 ring-[#e2e8f0]"
                      >
                        {{ group.label }} {{ group.count }}
                      </span>
                      <span class="ml-auto text-slate-400 tabular-nums">
                        累计 {{ formatNumber(recipe.cumulativeCount) }} 个特征
                      </span>
                    </div>
                    <div
                      v-if="featureGainResultFor(recipe.key)"
                      class="mt-2 grid gap-2 rounded-[0.6rem] border border-[#eef2f6] bg-[#fbfcff] px-2.5 py-2 text-[11px] sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
                    >
                      <span
                        class="inline-flex w-fit items-center rounded-full px-2 py-0.5 font-semibold"
                        :class="featureGainStatusClass(featureGainResultFor(recipe.key)?.status)"
                      >
                        {{ featureGainStatusLabel(featureGainResultFor(recipe.key)?.status) }}
                      </span>
                      <span class="tabular-nums text-slate-600">
                        验证 R² <span class="font-semibold text-slate-950">{{ formatMetric(featureGainResultFor(recipe.key)?.valR2, 3) }}</span>
                        · RMSE {{ formatMetric(featureGainResultFor(recipe.key)?.valRmse, 3) }}
                      </span>
                      <span class="tabular-nums text-slate-600">
                        测试 R² <span class="font-semibold text-slate-950">{{ formatMetric(featureGainResultFor(recipe.key)?.testR2, 3) }}</span>
                        <template v-if="featureGainDelta(featureGainResultFor(recipe.key)) != null">
                          · Δ {{ featureGainDeltaLabel(featureGainResultFor(recipe.key)) }}
                        </template>
                      </span>
                      <button
                        type="button"
                        class="inline-flex justify-self-start rounded-md border border-[#e2e8f0] bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f8fbff] hover:text-[#5b56ea] sm:justify-self-end"
                        :disabled="!featureGainResultFor(recipe.key)?.snapshot || featureGainMode || segmentMixMode || activeTask?.status === 'running'"
                        @click="viewFeatureGainResult(recipe.key)"
                      >
                        查看
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'reports' && experimentReport && activeTask?.status === 'completed'"
            class="rounded-[1rem] border border-[#dbe4f2] bg-white p-4 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.28)]"
          >
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <ClipboardCheck class="h-3.5 w-3.5" />
                  训练后实验报告
                </p>
                <h3 class="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                  {{ algorithmLabelZh(experimentReport.algorithm) }} · {{ targetDisplayLabel(experimentReport.target?.label || experimentReport.target?.column) }}
                </h3>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  生成时间 {{ formatDateTime(experimentReport.generated_at) }} · seed {{ experimentReport.split.random_seed }} · {{ experimentReport.split.label || datasetSplit?.label || '数据划分' }}
                </p>
              </div>
              <div class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  训练池 {{ formatNumber(experimentReport.split.train_pool_size) }}
                </span>
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  测试 {{ formatNumber(experimentReport.split.test_size) }}
                </span>
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  外推 {{ formatNumber(experimentReport.split.external_size) }}
                </span>
                <span v-if="experimentReport.split.cv_folds" class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  {{ experimentReport.split.cv_folds }} 折 CV
                </span>
              </div>
            </div>

            <div class="grid gap-2.5 md:grid-cols-4">
              <div
                v-for="item in reportMetrics"
                :key="item.key"
                class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3"
              >
                <p class="text-[10px] font-bold uppercase tracking-[0.16em]" :class="item.tone">{{ item.label }}</p>
                <p class="mt-1 text-xl font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">
                  R² {{ item.metric ? formatMetric(item.metric.r2, 3) : '--' }}
                </p>
                <p class="mt-1 text-[11px] leading-5 text-slate-500 tabular-nums">
                  RMSE {{ item.metric ? formatMetric(item.metric.rmse, 3) : '--' }} · MAE {{ item.metric ? formatMetric(item.metric.mae, 3) : '--' }}
                </p>
                <p class="text-[11px] text-slate-400 tabular-nums">
                  {{ item.metric ? formatNumber(item.metric.sample_count) : '--' }} 行
                </p>
              </div>
            </div>

            <div
              v-if="reportRisks.length"
              class="mt-3 grid gap-2 lg:grid-cols-2"
            >
              <div
                v-for="risk in reportRisks"
                :key="`${risk.severity}-${risk.title}`"
                class="rounded-[0.75rem] border px-3 py-2"
                :class="riskSeverityClass(risk.severity)"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold">{{ risk.title }}</p>
                  <span class="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold">{{ riskSeverityLabel(risk.severity) }}</span>
                </div>
                <p class="mt-1 text-[11px] leading-5 opacity-85">{{ risk.message }}</p>
              </div>
            </div>

            <div class="mt-4 grid gap-3 xl:grid-cols-3">
              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">特征重要性 Top</p>
                  <span class="text-[10px] text-slate-400">{{ reportFeatureTop.length }} 个</span>
                </div>
                <div v-if="!reportFeatureTop.length" class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-5 text-center text-xs text-slate-500">
                  当前算法未提供特征重要性。
                </div>
                <div v-else class="space-y-2">
                  <div v-for="entry in reportFeatureTop" :key="entry.feature">
                    <div class="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <span class="min-w-0 truncate font-semibold text-slate-700">{{ formatColumnLabel(entry.feature) }}</span>
                      <span class="shrink-0 text-slate-400 tabular-nums">{{ formatMetric(entry.importance, 4) }}</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]">
                      <div class="h-full rounded-full bg-[#5b56ea]" :style="{ width: reportFeatureWidth(entry.importance) }" />
                    </div>
                  </div>
                </div>
              </div>

              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">残差最大样本</p>
                  <span class="text-[10px] text-slate-400">{{ reportResidualTop.length }} 条</span>
                </div>
                <div v-if="!reportResidualTop.length" class="rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-5 text-center text-xs text-slate-500">
                  暂无残差样本。
                </div>
                <div v-else class="space-y-1.5">
                  <button
                    v-for="(sample, idx) in reportResidualTop"
                    :key="`${sample.source}-${sample.row_index}-${idx}`"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-[0.6rem] border border-[#eef2f6] bg-[#fbfcff] px-2.5 py-2 text-left text-[11px] transition hover:border-[#aebdfc] hover:bg-[#f8faff]"
                    @click="handleInspectRecord({
                      source: sample.source,
                      recordId: nullableNumber(sample.record_id),
                      literatureId: nullableNumber(sample.literature_id),
                      rowIndex: nullableNumber(sample.row_index),
                      actual: Number(sample.actual),
                      predicted: Number(sample.predicted),
                      residual: Number(sample.residual),
                      absResidual: Number(sample.abs_residual),
                    })"
                  >
                    <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-500 ring-1 ring-[#e2e8f0]">{{ idx + 1 }}</span>
                    <span class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" :class="sampleSourceBadgeClass(sample.source)">
                      {{ sampleSourceLabel(sample.source) }}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-slate-600 tabular-nums">
                      {{ formatMetric(sample.actual, 3) }} -> {{ formatMetric(sample.predicted, 3) }}
                    </span>
                    <span class="shrink-0 font-semibold text-[#cf334f] tabular-nums">
                      {{ formatMetric(sample.abs_residual, 3) }}
                    </span>
                  </button>
                </div>
              </div>

              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">划分与参数</p>
                  <span class="text-[10px] text-slate-400">seed {{ experimentReport.split.random_seed }}</span>
                </div>
                <div class="space-y-2 text-[11px]">
                  <div v-if="experimentReport.split.strata_count" class="rounded-[0.6rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
                    联合标签 {{ experimentReport.split.strata_count }} 组 · μ 分箱 {{ experimentReport.split.target_bin_count || '--' }} 档
                  </div>
                  <div v-if="reportFoldPreview.length" class="space-y-1">
                    <div
                      v-for="fold in reportFoldPreview"
                      :key="fold.label"
                      class="flex items-center justify-between gap-2 rounded-[0.55rem] bg-[#fbfcff] px-2.5 py-1.5 ring-1 ring-[#eef2f6]"
                    >
                      <span class="truncate font-medium text-slate-700">{{ fold.label }}</span>
                      <span class="shrink-0 text-slate-500 tabular-nums">R² {{ formatMetric(fold.metrics?.val_r2, 3) }}</span>
                    </div>
                  </div>
                  <div v-if="reportHyperparameterEntries.length" class="flex flex-wrap gap-1.5 pt-1">
                    <span
                      v-for="entry in reportHyperparameterEntries"
                      :key="entry.key"
                      class="rounded-full bg-[#f5f7ff] px-2 py-1 text-[10px] font-semibold text-[#3d56d2]"
                    >
                      {{ entry.key }}={{ entry.value }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 自动调参进度 / 结果 -->
          <section
            v-if="activeWorkbenchTab === 'experiments' && tuneProgress"
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
            v-if="activeWorkbenchTab === 'experiments' && (compareMode || visibleCompareResults.length)"
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
                完成 {{ visibleCompareResults.length }} / {{ compareTotal || visibleCompareResults.length }}
              </span>
            </div>

            <div v-if="compareSucceeded.length" :style="{ height: `${Math.max(140, compareSucceeded.length * 38)}px` }">
              <Bar :data="compareChartData" :options="compareChartOptions" />
            </div>

            <div v-if="visibleCompareResults.length" class="mt-3 space-y-1.5">
              <button
                v-for="(row, idx) in compareSorted"
                :key="row.taskId"
                type="button"
                class="flex w-full items-center gap-3 rounded-[0.6rem] border px-3 py-2 text-left text-xs transition"
                :class="[
                  isCompareRowActive(row)
                    ? 'border-[#5b56ea] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/50'
                    : idx === 0 && row.status === 'completed'
                      ? 'border-[#aebdfc] bg-[#f5f7ff]'
                      : 'border-[#eef2f6] bg-white',
                  canViewCompareResult(row) ? 'cursor-pointer hover:border-[#aebdfc] hover:bg-[#f8faff]' : 'cursor-default',
                ]"
                :disabled="!canViewCompareResult(row)"
                @click="viewCompareResult(row)"
              >
                <span
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                  :class="isCompareRowActive(row) || idx === 0 ? 'bg-[#5b56ea] text-white' : 'bg-slate-100 text-slate-600'"
                >{{ idx + 1 }}</span>
                <span class="min-w-0 flex-1 truncate font-medium text-slate-800">
                  {{ algorithmLabelZh(row.algorithm) }}
                </span>
                <span
                  v-if="isCompareRowActive(row)"
                  class="hidden shrink-0 rounded-full bg-[#edf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#3d56d2] sm:inline"
                >
                  正在查看
                </span>
                <span
                  v-else-if="canViewCompareResult(row)"
                  class="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 sm:inline"
                >
                  查看
                </span>
                <span class="shrink-0 font-semibold text-slate-900 tabular-nums">R²={{ formatMetric(row.valR2, 3) }}</span>
                <span class="shrink-0 text-slate-500 tabular-nums">RMSE={{ formatMetric(row.valRmse, 3) }}</span>
                <span class="hidden shrink-0 text-slate-400 sm:inline tabular-nums">MAE={{ formatMetric(row.valMae, 3) }}</span>
              </button>
              <div
                v-for="row in compareFailed"
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

          <!-- 学习曲线 / 单次拟合摘要 -->
          <section v-if="activeWorkbenchTab === 'overview' && isActiveNonIterativeModel" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  {{ fitModeTitle }}
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  {{ fitModeDescription }}
                </p>
              </div>
              <span class="rounded-full bg-[#f5f7ff] px-2.5 py-1 text-[11px] font-semibold text-[#5b56ea] ring-1 ring-[#cdd7ff]">
                非迭代模型
              </span>
            </div>

            <div class="grid gap-2.5 md:grid-cols-4">
              <div class="rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3">
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c3aed]">训练集</p>
                <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">R² {{ formatMetric(currentPoint?.train_r2, 3) }}</p>
                <p class="mt-1 text-[11px] text-slate-500 tabular-nums">
                  RMSE {{ formatMetric(currentPoint?.train_rmse, 3) }} · MAE {{ formatMetric(currentPoint?.train_mae, 3) }}
                </p>
              </div>
              <div class="rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3">
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#0f766e]">验证集</p>
                <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">R² {{ formatMetric(currentPoint?.val_r2, 3) }}</p>
                <p class="mt-1 text-[11px] text-slate-500 tabular-nums">
                  RMSE {{ formatMetric(currentPoint?.val_rmse, 3) }} · MAE {{ formatMetric(currentPoint?.val_mae, 3) }}
                </p>
              </div>
              <div class="rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3">
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#cf334f]">测试集</p>
                <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">R² {{ formatMetric(testMetrics?.test_r2, 3) }}</p>
                <p class="mt-1 text-[11px] text-slate-500 tabular-nums">
                  RMSE {{ formatMetric(testMetrics?.test_rmse, 3) }} · MAE {{ formatMetric(testMetrics?.test_mae, 3) }}
                </p>
              </div>
              <div
                v-if="externalMetrics?.sample_count"
                class="rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3"
              >
                <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c2410c]">外推验证</p>
                <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">R² {{ formatMetric(externalMetrics?.external_r2, 3) }}</p>
                <p class="mt-1 text-[11px] text-slate-500 tabular-nums">
                  RMSE {{ formatMetric(externalMetrics?.external_rmse, 3) }} · MAE {{ formatMetric(externalMetrics?.external_mae, 3) }}
                </p>
              </div>
            </div>

            <div
              v-if="tuneProgress?.all_results?.length"
              class="mt-3 rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-2"
            >
              <p class="text-[11px] font-semibold text-slate-700">调参轨迹</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="(result, idx) in tuneProgress.all_results.slice(0, 8)"
                  :key="`tune-result-${idx}`"
                  class="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-[#e2e8f0]"
                >
                  R² {{ formatMetric(result.score, 3) }}
                </span>
              </div>
            </div>
          </section>

          <section v-else-if="activeWorkbenchTab === 'overview'" class="grid gap-3 xl:grid-cols-2">
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
          <section v-if="activeWorkbenchTab === 'overview'" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
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
                  <span v-if="externalSamples.length" class="inline-flex items-center gap-1 ml-1">
                    <span class="inline-block h-0 w-0 border-x-[5px] border-b-[8px] border-x-transparent border-b-[#f59e0b]" />橙色=外推验证
                  </span>
                </p>
              </div>
              <span v-if="allScatterSamples.length" class="text-[10px] text-slate-400 tabular-nums">
                验证 {{ predictionSamples.length }} · 测试 {{ testSamples.length }}<template v-if="externalSamples.length"> · 外推 {{ externalSamples.length }}</template>
              </span>
            </div>
            <div class="h-[300px]">
              <div v-if="!allScatterSamples.length" class="flex h-full flex-col items-center justify-center gap-1 rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-center text-xs text-slate-500">
                <p>训练完成后在此显示散点图</p>
                <p class="text-slate-400">紫色 = 验证集 K 折预测，红色 = 测试集</p>
              </div>
              <Line v-else :data="predictionScatterData" :options="predictionScatterOptions" />
            </div>
          </section>

          <section v-if="activeWorkbenchTab === 'overview'" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#0f766e]">
                  <Layers class="h-3.5 w-3.5" />
                  论文 4.3.3 拟合图
                </p>
                <p class="mt-0.5 max-w-3xl text-xs leading-5 text-slate-500">
                  左图复刻预测值-真实值散点，右图复刻外部文献样本逐点真实/预测对比；背景色按低/中/高摩擦区间分区。
                </p>
              </div>
              <div v-if="allScatterSamples.length" class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span class="rounded-full bg-[#f8fafc] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  训练池 {{ predictionSamples.length }}
                </span>
                <span class="rounded-full bg-[#f8fafc] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  测试 {{ testSamples.length }}
                </span>
                <span class="rounded-full bg-[#f8fafc] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  外部文献 {{ externalSamples.length }}
                </span>
              </div>
            </div>

            <div v-if="!allScatterSamples.length" class="flex h-[260px] flex-col items-center justify-center gap-1 rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-center text-xs text-slate-500">
              <p>训练完成后在此显示论文式拟合图</p>
              <p class="text-slate-400">论文固定划分会自动显示外部文献 6 点折线</p>
            </div>
            <div v-else class="space-y-3">
              <div class="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div class="min-w-0">
                  <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600">
                    <span>(a) 训练与检验样本预测对照</span>
                    <span class="text-slate-400">Y = X</span>
                  </div>
                  <div class="h-[360px]">
                    <Line :data="paperFitScatterData" :options="paperFitScatterOptions" />
                  </div>
                </div>
                <div class="min-w-0">
                  <div class="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600">
                    <span>(b) 外部文献验证</span>
                    <span class="text-slate-400">Pred-literature</span>
                  </div>
                  <div v-if="!externalSamples.length" class="flex h-[360px] items-center justify-center rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-xs text-slate-500">
                    当前训练没有外部文献验证样本
                  </div>
                  <div v-else class="h-[360px]">
                    <Line :data="paperExternalLineData" :options="paperExternalLineOptions" />
                  </div>
                </div>
              </div>
              <div class="grid gap-2 text-xs sm:grid-cols-3">
                <div
                  v-for="item in paperFitMetrics"
                  :key="item.label"
                  class="rounded-[0.6rem] bg-[#f8fafc] px-3 py-2"
                >
                  <p class="font-semibold text-slate-900">{{ item.label }}</p>
                  <p class="mt-1 text-slate-500">
                    R² {{ formatMetric(item.r2, 3) }} · RMSE {{ formatMetric(item.rmse, 3) }} · MAE {{ formatMetric(item.mae, 3) }}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <!-- 外推失败样本归因 -->
          <section
            v-if="activeWorkbenchTab === 'diagnostics' && externalDiagnosticItems.length"
            class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4"
          >
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#c2410c]">
                  <AlertTriangle class="h-3.5 w-3.5" />
                  外推失败样本归因
                </p>
                <p class="mt-0.5 text-xs leading-5 text-slate-500">
                  按外推残差排序，解释哪些点是稀有组合、覆盖不足、工况越界或需要回原文核对。
                </p>
              </div>
              <div class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">
                  外推样本 {{ externalDiagnostics?.summary?.sample_count ?? externalSamples.length }}
                </span>
                <span
                  v-if="externalDiagnostics?.summary?.unseen_strata_count"
                  class="rounded-full bg-[#fff4da] px-2.5 py-1 text-[#b97113] ring-1 ring-[#f6d99a]"
                >
                  未见组合 {{ externalDiagnostics.summary.unseen_strata_count }}
                </span>
                <span
                  v-if="externalDiagnostics?.summary?.out_of_range_count"
                  class="rounded-full bg-[#fff5f6] px-2.5 py-1 text-[#cf334f] ring-1 ring-[#ffd4da]"
                >
                  工况越界 {{ externalDiagnostics.summary.out_of_range_count }}
                </span>
                <span
                  v-if="externalDiagnostics?.summary?.high_residual_count"
                  class="rounded-full bg-[#fff5f6] px-2.5 py-1 text-[#cf334f] ring-1 ring-[#ffd4da]"
                >
                  高残差 {{ externalDiagnostics.summary.high_residual_count }}
                </span>
              </div>
            </div>

            <div class="grid gap-2 xl:grid-cols-2">
              <article
                v-for="(item, idx) in externalDiagnosticItems"
                :key="`external-diagnostic-${item.record_id ?? item.row_index}-${idx}`"
                class="rounded-[0.8rem] border px-3 py-3"
                :class="diagnosticSeverityClass(item.severity)"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-950">
                      <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#c2410c] ring-1 ring-[#f6d99a]">{{ idx + 1 }}</span>
                      <span class="truncate">{{ item.cation || '未知阳离子' }}</span>
                      <span class="text-xs font-medium text-slate-400">{{ item.bin_label || 'μ 分箱未记录' }}</span>
                    </p>
                    <p class="mt-1 text-[11px] leading-5 text-slate-500">
                      训练覆盖：
                      阳离子 {{ item.training_context?.cation_train_count ?? '--' }} 条 ·
                      μ 分箱 {{ item.training_context?.bin_train_count ?? '--' }} 条 ·
                      联合标签 {{ item.training_context?.stratum_train_count ?? '--' }} 条
                    </p>
                  </div>
                  <div class="shrink-0 text-right text-[11px] tabular-nums">
                    <p class="font-semibold text-slate-950">
                      {{ formatMetric(item.actual, 3) }} -> {{ formatMetric(item.predicted, 3) }}
                    </p>
                    <p class="mt-0.5 font-semibold" :class="Number(item.residual) > 0 ? 'text-[#cf334f]' : 'text-[#3d56d2]'">
                      残差 {{ Number(item.residual) >= 0 ? '+' : '' }}{{ formatMetric(item.residual, 3) }}
                    </p>
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="reason in item.reasons"
                    :key="`${item.row_index}-${reason.kind}-${reason.label}`"
                    class="rounded-full px-2 py-1 text-[10px] font-semibold ring-1"
                    :class="diagnosticBadgeClass(reason.kind)"
                    :title="reason.detail"
                  >
                    {{ reason.label }}
                  </span>
                </div>

                <div v-if="item.reasons?.length" class="mt-2 space-y-1 text-[11px] leading-5 text-slate-600">
                  <p v-for="reason in item.reasons.slice(0, 2)" :key="`${item.row_index}-${reason.kind}-detail`">
                    {{ reason.detail }}
                  </p>
                </div>

                <div v-if="item.out_of_range_features?.length" class="mt-2 rounded-[0.6rem] bg-white/70 px-2.5 py-2 ring-1 ring-white/80">
                  <p class="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#cf334f]">越界工况</p>
                  <div class="flex flex-wrap gap-1.5">
                    <span
                      v-for="feature in item.out_of_range_features.slice(0, 4)"
                      :key="`${item.row_index}-${feature.feature}`"
                      class="rounded-full bg-[#fff5f6] px-2 py-1 text-[10px] font-semibold text-[#cf334f] ring-1 ring-[#ffd4da]"
                      :title="`训练范围 ${formatMetric(feature.train_min, 3)}-${formatMetric(feature.train_max, 3)}`"
                    >
                      {{ feature.label }} {{ formatMetric(feature.value, 3) }}
                    </span>
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <p class="min-w-0 flex-1 text-[11px] leading-5 text-slate-500">
                    {{ item.suggestions?.[0] || '建议补充相似离子、相似 μ 区间和相近工况样本。' }}
                  </p>
                  <button
                    type="button"
                    class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#e2e8f0] bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                    :disabled="item.record_id == null"
                    title="跳到 Knowledge 数据库定位这条外推样本"
                    @click="handleInspectRecord(diagnosticSampleForInspect(item))"
                  >
                    <ExternalLink class="h-3 w-3" />
                    定位数据
                  </button>
                </div>
              </article>
            </div>
          </section>

          <!-- ⭐ 异常样本诊断（残差 Top10） -->
          <section
            v-if="activeWorkbenchTab === 'diagnostics' && topResiduals.length"
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
                  :class="sampleSourceBadgeClass(sample.source)"
                >
                  {{ sampleSourceLabel(sample.source) }}
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
          <section v-if="activeWorkbenchTab === 'reports'" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
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

          <!-- 预测入口 -->
          <section v-if="activeWorkbenchTab === 'predict'" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <Sparkles class="h-3.5 w-3.5" />
                  按训练视图预测
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  先选择宏观/纳米视图，系统会使用该视图的推荐模型；目标数据集也会按相同视图过滤后再预测。
                </p>
              </div>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-[0.65rem] bg-[#5b56ea] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_12px_28px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
                :disabled="predictionLoading || !selectedPredictionModel || selectedPredictionDatasetId == null"
                @click="handleRunPrediction"
              >
                <Loader2 v-if="predictionLoading" class="h-3.5 w-3.5 animate-spin" />
                <Play v-else class="h-3.5 w-3.5" />
                {{ predictionLoading ? '预测中' : '运行预测' }}
              </button>
            </div>

            <div class="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
              <div class="space-y-3">
                <div class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] p-3">
                  <p class="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">训练视图</p>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <button
                      v-for="tab in predictionViewTabs"
                      :key="`predict-${tab.key}`"
                      type="button"
                      class="rounded-[0.75rem] border px-3 py-2.5 text-left transition"
                      :class="predictionViewKey === tab.key
                        ? 'border-[#aebdfc] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/40'
                        : 'border-[#eef2f6] bg-white hover:border-[#d8e0eb]'"
                      @click="setPredictionView(tab.key)"
                    >
                      <span class="flex items-center justify-between gap-2">
                        <span class="text-sm font-semibold text-slate-950">{{ tab.label }}</span>
                        <span
                          class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          :class="tab.recommended ? 'bg-[#edf2ff] text-[#5b56ea]' : tab.fallback ? 'bg-[#fff4da] text-[#b97113]' : 'bg-slate-100 text-slate-400'"
                        >
                          {{ tab.recommended ? '推荐模型' : tab.fallback ? '有版本' : '无模型' }}
                        </span>
                      </span>
                      <span class="mt-1 block text-[11px] leading-4 text-slate-500">
                        {{ tab.modelCount }} 个版本<template v-if="tab.recommended"> · {{ algorithmLabelZh(tab.recommended.algorithm) }}</template>
                      </span>
                    </button>
                  </div>
                </div>

                <div class="rounded-[0.85rem] border border-[#eef2f6] bg-white p-3">
                  <p class="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">推荐模型</p>
                  <div v-if="selectedPredictionModel" class="rounded-[0.7rem] border border-[#cdd7ff] bg-[#f5f7ff] px-3 py-2">
                    <p class="truncate text-sm font-semibold text-slate-950">{{ selectedPredictionModel.name }}</p>
                    <p class="mt-1 text-[11px] leading-5 text-slate-500">
                      {{ trainingViewShortLabel(selectedPredictionModel.training_view) }} · {{ algorithmLabelZh(selectedPredictionModel.algorithm) }} ·
                      {{ versionScoreLabel(selectedPredictionModel) }} {{ formatMetric(versionScoreValue(selectedPredictionModel), 3) }}
                    </p>
                    <p v-if="!selectedPredictionModel.is_recommended" class="mt-1 text-[11px] text-[#b97113]">
                      当前视图还没有推荐模型，暂用最新保存版本。建议先在版本页标记推荐模型。
                    </p>
                  </div>
                  <div v-else class="rounded-[0.7rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-6 text-center text-xs text-slate-500">
                    当前视图还没有可用模型。先完成训练并保存为模型版本。
                  </div>
                </div>

                <div class="rounded-[0.85rem] border border-[#eef2f6] bg-white p-3">
                  <label class="block text-xs">
                    <span class="mb-1.5 block font-semibold text-slate-700">目标数据集</span>
                    <select
                      v-model.number="selectedPredictionDatasetId"
                      class="h-10 w-full rounded-[0.6rem] border border-[#e2e8f0] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/20"
                    >
                      <option v-for="dataset in savedDatasets" :key="`predict-dataset-${dataset.id}`" :value="dataset.id">
                        {{ dataset.name }} · {{ dataset.row_count }} 条
                      </option>
                    </select>
                  </label>
                  <p class="mt-2 text-[11px] leading-5 text-slate-500">
                    目标数据集会先按 {{ activePredictionViewMeta?.label }} 过滤，再进入推荐模型预测。
                  </p>
                </div>
              </div>

              <div class="rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] p-3">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">预测结果</p>
                  <span v-if="predictionResult" class="text-[10px] text-slate-400">{{ predictionResult.preview_rows.length }} 条预览</span>
                </div>

                <p
                  v-if="predictionError"
                  class="mb-3 rounded-[0.7rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
                >
                  {{ predictionError }}
                </p>

                <div v-if="predictionResult" class="space-y-3">
                  <div class="grid gap-2 sm:grid-cols-4">
                    <div class="rounded-[0.65rem] bg-white px-3 py-2 ring-1 ring-[#eef2f6]">
                      <p class="text-[10px] font-semibold text-slate-400">预测行</p>
                      <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(predictionResult.summary.predicted_rows) }}</p>
                    </div>
                    <div class="rounded-[0.65rem] bg-white px-3 py-2 ring-1 ring-[#eef2f6]">
                      <p class="text-[10px] font-semibold text-slate-400">有真值</p>
                      <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(predictionResult.summary.scored_rows) }}</p>
                    </div>
                    <div class="rounded-[0.65rem] bg-white px-3 py-2 ring-1 ring-[#eef2f6]">
                      <p class="text-[10px] font-semibold text-slate-400">R²</p>
                      <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">{{ formatMetric(predictionResult.summary.r2, 3) }}</p>
                    </div>
                    <div class="rounded-[0.65rem] bg-white px-3 py-2 ring-1 ring-[#eef2f6]">
                      <p class="text-[10px] font-semibold text-slate-400">排除</p>
                      <p class="mt-1 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(predictionResult.summary.dropped_outside_training_view || 0) }}</p>
                    </div>
                  </div>
                  <p class="text-[11px] leading-5 text-slate-500">
                    {{ predictionResult.registered_model_name }} → {{ selectedPredictionDataset?.name || predictionResult.target_dataset.name }}；
                    仅预测 {{ trainingViewShortLabel(predictionResult.training_view) }} 视图内记录。
                  </p>
                  <div class="space-y-1.5">
                    <div
                      v-for="row in predictionResult.preview_rows"
                      :key="`prediction-${row.row_index}-${row.record_id || 'row'}`"
                      class="grid gap-2 rounded-[0.6rem] border border-[#eef2f6] bg-white px-3 py-2 text-xs sm:grid-cols-[5rem_minmax(0,1fr)_8rem_8rem]"
                    >
                      <span class="font-semibold text-slate-500">#{{ row.record_id || row.row_index }}</span>
                      <span class="truncate text-slate-500">
                        文献 {{ row.literature_id || '--' }} · 置信度 {{ formatMetric(row.confidence, 2) }}
                      </span>
                      <span class="font-semibold text-slate-900 tabular-nums">预测 {{ formatMetric(row.predicted, 3) }}</span>
                      <span class="text-slate-500 tabular-nums">残差 {{ formatMetric(row.residual, 3) }}</span>
                    </div>
                  </div>
                </div>
                <div v-else class="rounded-[0.7rem] border border-dashed border-[#dbe4f2] bg-white px-3 py-10 text-center text-xs text-slate-500">
                  选择训练视图和目标数据集后运行预测。
                </div>

                <div class="mt-4 border-t border-[#e6edf5] pt-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">Prediction Runs</p>
                    <span class="text-[10px] text-slate-400">
                      {{ predictionHistoryLoading ? '加载中' : `${filteredPredictionRuns.length} 条` }}
                    </span>
                  </div>
                  <p
                    v-if="predictionHistoryError"
                    class="mb-2 rounded-[0.65rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
                  >
                    {{ predictionHistoryError }}
                  </p>
                  <div v-if="filteredPredictionRuns.length" class="space-y-2">
                    <div
                      v-for="run in filteredPredictionRuns.slice(0, 5)"
                      :key="`prediction-run-${run.id}`"
                      class="grid gap-2 border-b border-[#eef2f6] pb-2 text-xs last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_7rem_5rem]"
                    >
                      <div class="min-w-0">
                        <p class="truncate font-semibold text-slate-900">
                          {{ run.registered_model_name }}
                        </p>
                        <p class="mt-0.5 truncate text-[11px] text-slate-500">
                          {{ trainingViewShortLabel(run.training_view) }} · {{ run.target_dataset_name || '目标数据集' }} · {{ formatDateTime(run.created_at) }}
                        </p>
                      </div>
                      <div class="text-slate-500">
                        <p class="font-semibold text-slate-900 tabular-nums">{{ formatNumber(run.target_predicted_rows) }} 行</p>
                        <p class="mt-0.5 text-[11px]">排除 {{ formatNumber(run.dropped_outside_training_view) }}</p>
                      </div>
                      <div class="text-right">
                        <p class="font-semibold text-slate-900 tabular-nums">{{ formatMetric(run.r2, 3) }}</p>
                        <p class="mt-0.5 text-[11px] text-slate-500">R²</p>
                      </div>
                    </div>
                  </div>
                  <div v-else class="rounded-[0.65rem] border border-dashed border-[#dbe4f2] bg-white px-3 py-5 text-center text-xs text-slate-500">
                    当前训练视图还没有预测历史。
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 模型版本与训练回看 -->
          <section v-if="activeWorkbenchTab === 'versions'" class="rounded-[0.95rem] border border-[#eef2f6] bg-white p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
                  <Trophy class="h-3.5 w-3.5" />
                  模型版本与回看
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  训练 run 保留完整过程；保存为模型版本后可推荐、删除，并随时回看配置、特征、split/fold 和实验报告。
                </p>
              </div>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-[0.65rem] bg-[#5b56ea] px-3.5 py-2 text-xs font-semibold text-white shadow-[0_12px_28px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
                :disabled="!canSaveActiveVersion || versionActionLoading === 'save-version'"
                :title="activeTask?.status === 'completed' ? '保存或编辑当前训练结果对应的模型版本' : '训练完成后才能保存模型版本'"
                @click="openSaveVersionModal"
              >
                <ClipboardCheck class="h-3.5 w-3.5" />
                {{ activeRegisteredModel ? '编辑当前版本' : '保存当前模型' }}
              </button>
            </div>

            <div
              v-if="activeTask?.status === 'completed'"
              class="mb-3 flex flex-wrap items-center gap-2 rounded-[0.7rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-2 text-xs text-slate-600"
            >
              <span class="font-semibold text-slate-900">当前回看：</span>
              <span>{{ algorithmLabelZh(activeTask.config.algorithm) }}</span>
              <span class="text-slate-300">·</span>
              <span>{{ splitStrategyLabel(activeTask.config.data_options?.split_strategy) }}</span>
              <span class="text-slate-300">·</span>
              <span>{{ formatNumber(activeTask.dataset.feature_dimensions) }} 个特征</span>
              <span
                v-if="activeRegisteredModel"
                class="rounded-full bg-[#e8fff2] px-2 py-0.5 text-[10px] font-semibold text-[#0b9d63]"
              >
                已保存：{{ activeRegisteredModel.name }}
              </span>
              <span
                v-else
                class="rounded-full bg-[#fff4da] px-2 py-0.5 text-[10px] font-semibold text-[#b97113]"
              >
                尚未保存为版本
              </span>
            </div>

            <p
              v-if="versionError"
              class="mb-3 rounded-[0.7rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
            >
              {{ versionError }}
            </p>

            <div class="mb-3 flex max-w-full gap-1 overflow-x-auto rounded-[0.75rem] bg-[#f8fafc] p-1 ring-1 ring-[#e2e8f0]">
              <button
                v-for="tab in versionTrainingViewTabs"
                :key="tab.key"
                type="button"
                class="shrink-0 rounded-[0.58rem] px-3 py-1.5 text-left text-xs font-semibold transition"
                :class="activeVersionViewKey === tab.key
                  ? 'bg-[#5b56ea] text-white shadow-[0_10px_22px_-18px_rgba(91,86,234,0.95)]'
                  : 'text-slate-500 hover:bg-white hover:text-slate-900'"
                @click="setActiveVersionView(tab.key)"
              >
                <span>{{ tab.shortLabel }}</span>
                <span class="ml-1 tabular-nums opacity-75">{{ tab.modelCount }}</span>
                <span v-if="tab.recommended" class="ml-1 opacity-75">推荐</span>
              </button>
            </div>

            <div class="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
              <div class="min-w-0 rounded-[0.85rem] border border-[#eef2f6] bg-[#fbfcff] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">已保存模型版本 · {{ activeVersionViewMeta?.label }}</p>
                  <span class="text-[10px] text-slate-400">{{ filteredRegisteredModels.length }} / {{ registeredModels.length }} 个</span>
                </div>

                <div
                  v-if="recommendedModel"
                  class="mb-2 rounded-[0.7rem] border border-[#cdd7ff] bg-white px-3 py-2"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#5b56ea]">
                        <Star class="h-3.5 w-3.5 fill-[#5b56ea]" />
                        推荐模型
                      </p>
                      <p class="mt-1 truncate text-sm font-semibold text-slate-950">{{ recommendedModel.name }}</p>
                      <p class="mt-0.5 text-[11px] text-slate-500">
                        {{ versionScoreLabel(recommendedModel) }} {{ formatMetric(versionScoreValue(recommendedModel), 3) }}
                        · {{ algorithmLabelZh(recommendedModel.algorithm) }}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1 rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                      :disabled="versionActionLoading === `view-${recommendedModel.task_id}`"
                      @click="handleViewRun(recommendedModel.task_id)"
                    >
                      <Eye class="h-3 w-3" />
                      回看
                    </button>
                  </div>
                </div>

                <div v-if="!filteredRegisteredModels.length" class="rounded-[0.7rem] border border-dashed border-[#dbe4f2] bg-white px-3 py-8 text-center text-xs text-slate-500">
                  当前训练视图还没有保存的模型版本。训练完成后点击“保存当前模型”即可固定一个可复用版本。
                </div>

                <div v-else class="space-y-2">
                  <div
                    v-for="model in filteredRegisteredModels"
                    :key="model.id"
                    class="rounded-[0.75rem] border bg-white px-3 py-3"
                    :class="model.is_recommended ? 'border-[#aebdfc] ring-1 ring-[#aebdfc]/50' : 'border-[#eef2f6]'"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                          <p class="min-w-0 truncate text-sm font-semibold text-slate-950">{{ model.name }}</p>
                          <span
                            v-if="model.is_recommended"
                            class="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#edf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#5b56ea]"
                          >
                            <Star class="h-3 w-3 fill-[#5b56ea]" />
                            推荐
                          </span>
                        </div>
                        <p class="mt-1 text-[11px] leading-5 text-slate-500">
                          {{ trainingViewShortLabel(model.training_view) }} · {{ algorithmLabelZh(model.algorithm) }} · {{ splitStrategyLabel(model.split_strategy) }} ·
                          {{ formatNumber(model.usable_records) }} 行 · {{ formatNumber(model.feature_dimensions) }} 特征
                        </p>
                        <p v-if="model.description" class="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
                          {{ model.description }}
                        </p>
                      </div>
                      <div class="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                          :disabled="versionActionLoading === `view-${model.task_id}`"
                          title="回看该版本的训练配置、特征和划分"
                          @click="handleViewRun(model.task_id)"
                        >
                          <Eye class="h-3 w-3" />
                          回看
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.55rem] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                          :disabled="versionActionLoading === `view-${model.task_id}`"
                          title="编辑版本名称、备注和推荐状态"
                          @click="handleEditVersion(model)"
                        >
                          <ClipboardCheck class="h-3 w-3" />
                          编辑
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.55rem] border px-2.5 py-1.5 text-[11px] font-semibold transition"
                          :class="model.is_recommended ? 'border-[#cdd7ff] bg-[#f5f7ff] text-[#5b56ea]' : 'border-[#e2e8f0] bg-white text-slate-600 hover:bg-[#f8fbff] hover:text-[#5b56ea]'"
                          :disabled="versionActionLoading === `recommend-${model.id}`"
                          :title="model.is_recommended ? '取消推荐模型' : '标记为推荐模型'"
                          @click="handleRecommendVersion(model, !model.is_recommended)"
                        >
                          <Star class="h-3 w-3" :class="model.is_recommended ? 'fill-[#5b56ea]' : ''" />
                          {{ model.is_recommended ? '取消推荐' : '推荐' }}
                        </button>
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.55rem] border border-[#ffd4da] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#cf334f] transition hover:bg-[#fff5f6]"
                          :disabled="versionActionLoading === `delete-${model.id}`"
                          title="删除该模型版本"
                          @click="handleDeleteVersion(model)"
                        >
                          <Trash2 class="h-3 w-3" />
                          删除
                        </button>
                      </div>
                    </div>

                    <div class="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-3">
                      <div class="rounded-[0.55rem] bg-[#fbfcff] px-2.5 py-1.5 ring-1 ring-[#eef2f6]">
                        <span class="text-slate-400">验证 R²</span>
                        <span class="ml-1 font-semibold text-slate-900 tabular-nums">{{ formatMetric(model.val_r2, 3) }}</span>
                      </div>
                      <div class="rounded-[0.55rem] bg-[#fbfcff] px-2.5 py-1.5 ring-1 ring-[#eef2f6]">
                        <span class="text-slate-400">测试 R²</span>
                        <span class="ml-1 font-semibold text-slate-900 tabular-nums">{{ formatMetric(model.test_r2, 3) }}</span>
                      </div>
                      <div class="rounded-[0.55rem] bg-[#fbfcff] px-2.5 py-1.5 ring-1 ring-[#eef2f6]">
                        <span class="text-slate-400">外推 R²</span>
                        <span class="ml-1 font-semibold text-slate-900 tabular-nums">{{ formatMetric(model.external_r2, 3) }}</span>
                        <span v-if="model.risk_count" class="ml-1 text-[#b97113]">· {{ model.risk_count }} 风险</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="min-w-0 rounded-[0.85rem] border border-[#eef2f6] bg-white p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">训练 run 回看 · {{ activeVersionViewMeta?.label }}</p>
                  <span class="text-[10px] text-slate-400">{{ filteredVersionRuns.length }} / {{ versionRuns.length }} 条</span>
                </div>
                <p class="mb-2 text-[11px] leading-5 text-slate-500">
                  这里按后端持久化记录列出最近训练。点“回看”后，上方报告区会切到当时冻结的配置、特征、split/fold。
                </p>

                <div v-if="!filteredVersionRuns.length" class="rounded-[0.7rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-8 text-center text-xs text-slate-500">
                  当前训练视图暂无训练 run。完成一次训练后会自动出现在这里。
                </div>
                <div v-else class="space-y-1.5">
                  <div
                    v-for="row in filteredVersionRuns"
                    :key="row.task_id"
                    class="rounded-[0.65rem] border px-3 py-2 text-xs"
                    :class="activeTask?.task_id === row.task_id ? 'border-[#aebdfc] bg-[#f5f7ff] ring-1 ring-[#aebdfc]/40' : 'border-[#eef2f6] bg-[#fbfcff]'"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p class="truncate font-semibold text-slate-900">
                          {{ algorithmLabelZh(row.algorithm) }}
                        </p>
                        <p class="mt-0.5 text-[11px] text-slate-500">
                          {{ trainingViewShortLabel(row.training_view) }} · {{ formatDateTime(row.finished_at || row.created_at) }} · {{ formatNumber(row.usable_records) }} 行 · {{ splitStrategyLabel(row.split_strategy) }}
                        </p>
                      </div>
                      <span
                        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        :class="statusBadgeClass(row.status)"
                      >
                        {{ statusLabelZh(row.status) }}
                      </span>
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-slate-900 tabular-nums">
                        {{ versionScoreLabel(row) }}={{ formatMetric(versionScoreValue(row), 3) }}
                      </span>
                      <span class="text-slate-400 tabular-nums">RMSE={{ formatMetric(row.test_rmse ?? row.val_rmse, 3) }}</span>
                      <span
                        v-if="row.is_registered"
                        class="rounded-full bg-[#e8fff2] px-2 py-0.5 text-[10px] font-semibold text-[#0b9d63]"
                      >
                        已保存
                      </span>
                      <span
                        v-if="row.is_recommended"
                        class="rounded-full bg-[#edf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#5b56ea]"
                      >
                        推荐
                      </span>
                      <div class="ml-auto flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.5rem] border border-[#e2e8f0] bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-[#5b56ea]"
                          :disabled="versionActionLoading === `view-${row.task_id}`"
                          @click="handleViewRun(row.task_id)"
                        >
                          <Eye class="h-3 w-3" />
                          回看
                        </button>
                        <button
                          v-if="row.status === 'completed' && !row.is_registered"
                          type="button"
                          class="inline-flex items-center gap-1 rounded-[0.5rem] border border-[#aebdfc] bg-white px-2 py-1 text-[10px] font-semibold text-[#5b56ea] transition hover:bg-[#f5f7ff]"
                          :disabled="versionActionLoading === `view-${row.task_id}` || versionActionLoading === 'save-version'"
                          @click="handleSaveRunAsVersion(row)"
                        >
                          <ClipboardCheck class="h-3 w-3" />
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="activeWorkbenchTab === 'data' && !datasetSplit && !targetNoise"
            class="rounded-[0.95rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-4 py-10 text-center"
          >
            <p class="text-sm font-semibold text-slate-900">还没有数据划分结果</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              开始一次训练后，这里会显示训练池、测试集、外推验证和重复工况噪声。
            </p>
          </section>

          <section
            v-if="activeWorkbenchTab === 'experiments' && !activeFeatureGroupSummaries.length && !tuneProgress && !compareMode && !visibleCompareResults.length"
            class="rounded-[0.95rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-4 py-10 text-center"
          >
            <p class="text-sm font-semibold text-slate-900">暂无可展示的实验</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              生成包含结构描述符的训练集后，可以在这里跑特征组增益、自动调参和全部算法对比。
            </p>
          </section>

          <section
            v-if="activeWorkbenchTab === 'diagnostics' && !fitDiagnostic && !externalDiagnosticItems.length && !topResiduals.length"
            class="rounded-[0.95rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-4 py-10 text-center"
          >
            <p class="text-sm font-semibold text-slate-900">暂无诊断样本</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              训练完成后，这里会聚合外推失败归因和残差最大的样本，并支持回 Knowledge 定位。
            </p>
          </section>
        </div>
      </main>
    </div>

    <div
      v-if="showExperimentModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
      @click.self="closeExperimentPreview"
    >
      <section class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.1rem] border border-[#dbe4f2] bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef2f6] px-5 py-4">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
              <ClipboardCheck class="h-3.5 w-3.5" />
              训练前实验摘要
            </p>
            <h2 class="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">
              确认 {{ experimentActionLabel }}
            </h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              这里会冻结本次训练的样本筛选、特征、划分策略和超参数；确认后才会启动训练任务。
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.65rem] border border-[#e2e8f0] bg-white text-slate-500 transition hover:bg-[#f8fbff] hover:text-slate-900"
            :disabled="starting || experimentPreviewLoading"
            title="关闭"
            @click="closeExperimentPreview"
          >
            <X class="h-4 w-4" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
          <div
            v-if="experimentPreviewLoading"
            class="flex min-h-[22rem] flex-col items-center justify-center gap-2 rounded-[0.9rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] text-sm text-slate-500"
          >
            <Loader2 class="h-5 w-5 animate-spin text-[#5b56ea]" />
            正在生成实验摘要...
          </div>

          <div
            v-else-if="experimentPreviewError"
            class="rounded-[0.9rem] border border-[#ffd4da] bg-[#fff5f6] px-4 py-3 text-sm text-[#cf334f]"
          >
            <p class="flex items-center gap-1.5 font-semibold">
              <AlertTriangle class="h-4 w-4" />
              无法生成训练预览
            </p>
            <p class="mt-1.5 leading-6">{{ experimentPreviewError }}</p>
          </div>

          <div v-else class="space-y-4">
            <section class="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-[#fbfcff] p-4">
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">数据集版本</p>
                <h3 class="mt-1 truncate text-lg font-semibold text-slate-950">
                  {{ selectedDataset?.name || summary?.dataset?.name || datasetTitle }}
                </h3>
                <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div class="rounded-[0.6rem] bg-white px-3 py-2 ring-1 ring-[#e2e8f0]">
                    <p class="text-[10px] font-semibold text-slate-400">可用样本</p>
                    <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(experimentDataset?.usable_records) }}</p>
                  </div>
                  <div class="rounded-[0.6rem] bg-white px-3 py-2 ring-1 ring-[#e2e8f0]">
                    <p class="text-[10px] font-semibold text-slate-400">目标</p>
                    <p class="mt-1 truncate font-semibold text-slate-900">{{ targetLabel }}</p>
                  </div>
                  <div class="rounded-[0.6rem] bg-white px-3 py-2 ring-1 ring-[#e2e8f0]">
                    <p class="text-[10px] font-semibold text-slate-400">特征</p>
                    <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(experimentFeatureColumns.length) }}</p>
                  </div>
                  <div class="rounded-[0.6rem] bg-white px-3 py-2 ring-1 ring-[#e2e8f0]">
                    <p class="text-[10px] font-semibold text-slate-400">训练视图</p>
                    <p class="mt-1 truncate font-semibold text-slate-900">{{ trainingViewLabel(form.data_options.training_view || experimentRules?.training_view) }}</p>
                  </div>
                </div>
              </div>

              <div class="rounded-[0.9rem] border border-[#d8f3df] bg-[#f2fbf5] p-4">
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#28784d]">目标异常点过滤</p>
                <p class="mt-1 text-sm font-semibold text-slate-950">
                  {{ targetOutlierLabel(form.data_options.target_outlier_strategy) }}
                  <template v-if="experimentTargetOutliers?.rows_removed">
                    · 排除 {{ experimentTargetOutliers.rows_removed }} 条
                  </template>
                </p>
                <p class="mt-1 text-xs leading-5 text-slate-600">
                  只从本次训练矩阵中排除，不删除 Knowledge 原始数据。
                  <template v-if="experimentTargetOutliers?.bounds?.upper != null">
                    当前 COF 上界约 {{ formatMetric(experimentTargetOutliers.bounds.upper, 3) }}。
                  </template>
                </p>
                <div v-if="experimentTargetOutliers?.removed_records?.length" class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="record in experimentTargetOutliers.removed_records.slice(0, 6)"
                    :key="`${record.record_id}-${record.row_index}`"
                    class="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-[#28784d] ring-1 ring-[#bee8ca]"
                  >
                    #{{ record.record_id || record.row_index }} · COF {{ formatMetric(record.target, 3) }}
                  </span>
                </div>
              </div>

              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-4">
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">SMILES 筛选</p>
                <template v-if="experimentSmiles">
                  <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div class="rounded-[0.6rem] bg-[#f8fafc] px-3 py-2">
                      <p class="text-[10px] text-slate-400">双离子 SMILES</p>
                      <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
                        {{ formatNumber(experimentSmiles.dual_smiles_records) }} / {{ formatNumber(experimentSmiles.input_records) }}
                      </p>
                    </div>
                    <div class="rounded-[0.6rem] bg-[#f8fafc] px-3 py-2">
                      <p class="text-[10px] text-slate-400">描述符可用</p>
                      <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">{{ formatNumber(experimentSmiles.descriptor_ready_records) }}</p>
                    </div>
                    <div class="rounded-[0.6rem] bg-[#f8fafc] px-3 py-2">
                      <p class="text-[10px] text-slate-400">阳/阴离子种类</p>
                      <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">
                        {{ experimentSmiles.unique_cations }} / {{ experimentSmiles.unique_anions }}
                      </p>
                    </div>
                    <div class="rounded-[0.6rem] bg-[#f8fafc] px-3 py-2">
                      <p class="text-[10px] text-slate-400">无效 SMILES</p>
                      <p class="mt-0.5 font-semibold text-slate-900 tabular-nums">{{ formatNumber(experimentSmiles.invalid_smiles_records) }}</p>
                    </div>
                  </div>
                  <p class="mt-2 text-[11px] leading-5 text-slate-500">
                    规则：{{ experimentRules?.require_dual_smiles ? '要求阴/阳离子 SMILES' : '允许缺少 SMILES' }} ·
                    {{ experimentRules?.require_valid_smiles ? '要求 RDKit 可解析' : '不强制 RDKit 解析' }}
                  </p>
                </template>
                <p v-else class="mt-3 rounded-[0.6rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3 py-3 text-xs text-slate-500">
                  该数据集未记录 SMILES 筛选摘要，可能来自 CSV 导入或旧版本数据集。
                </p>
              </div>
            </section>

            <section class="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-4">
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">数据划分</p>
                <p class="mt-1 text-sm font-semibold text-slate-950">{{ experimentSplit?.label || activeSplitOption?.label || '未选择' }}</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">
                  随机种子 {{ form.data_options.random_seed }} · 测试占比 {{ validationSplitPercent }}% · {{ form.data_options.cv_folds || 5 }} 折 CV
                </p>
                <div v-if="experimentSplitSubsets.length" class="mt-3 grid gap-2 sm:grid-cols-3">
                  <div
                    v-for="subset in experimentSplitSubsets"
                    :key="subset.key || subset.label"
                    class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#e2e8f0]"
                  >
                    <p class="text-[10px] font-bold uppercase tracking-[0.14em]" :class="splitSubsetTone(subset.key)">
                      {{ subset.label }}
                    </p>
                    <p class="mt-0.5 text-lg font-semibold text-slate-950 tabular-nums">{{ formatNumber(subset.count) }}</p>
                    <p class="text-[11px] text-slate-500">{{ subset.cation_count }} 类阳离子 · {{ subset.strata_count }} 标签</p>
                  </div>
                </div>
                <div v-if="experimentSplitPlanPreview.length" class="mt-3 border-t border-[#eef2f6] pt-2">
                  <p class="mb-1.5 text-[11px] font-semibold text-slate-500">CV 折次预览</p>
                  <div class="space-y-1">
                    <div
                      v-for="fold in experimentSplitPlanPreview"
                      :key="fold.label"
                      class="flex items-center justify-between gap-3 text-[11px] text-slate-600"
                    >
                      <span class="truncate font-medium">{{ fold.label }}</span>
                      <span class="shrink-0 tabular-nums">训练 {{ fold.train_size }} · 验证 {{ fold.validation_size }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-4">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">特征快照</p>
                  <span class="text-[11px] font-semibold text-slate-500">{{ formatNumber(experimentFeatureColumns.length) }} 个特征</span>
                </div>
                <div class="mt-3 flex flex-wrap gap-1.5">
                  <span
                    v-for="feature in experimentFeaturePreview"
                    :key="feature"
                    class="rounded-full bg-[#f5f7ff] px-2.5 py-1 text-[11px] font-semibold text-[#3d56d2] ring-1 ring-[#cdd7ff]"
                  >
                    {{ formatColumnLabel(feature) }}
                  </span>
                  <span
                    v-if="experimentFeatureHiddenCount"
                    class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                  >
                    还有 {{ experimentFeatureHiddenCount }} 个
                  </span>
                </div>
                <div class="mt-3 rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 text-xs leading-5 text-slate-500 ring-1 ring-[#eef2f6]">
                  <p>
                    特征来源：{{ experimentPreview?.feature_blocks?.[0]?.label || 'Saved cleaned feature matrix' }}
                    <template v-if="summary?.pca_info?.enabled"> · PCA {{ summary.pca_info.actual_components }} 个主成分</template>
                  </p>
                  <p>
                    缺失值策略：{{ experimentRules?.missing_value_strategy || '训练时中位数补齐' }} ·
                    目标异常值：{{ experimentRules?.remove_target_outliers ? `IQR ${experimentRules.iqr_multiplier || 1.5}` : '未移除' }}
                  </p>
                </div>
              </div>
            </section>

            <section class="rounded-[0.9rem] border border-[#eef2f6] bg-white p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8fa0ba]">算法与超参数</p>
                  <p class="mt-1 text-base font-semibold text-slate-950">
                    <template v-if="pendingExperimentAction === 'compare'">
                      {{ availableAlgorithms.length }} 个算法依次对比
                    </template>
                    <template v-else>
                      {{ algorithmLabelZh(form.algorithm) }}
                    </template>
                  </p>
                </div>
                <div class="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                  <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">轮次 {{ form.hyperparameters.n_estimators }}</span>
                  <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">学习率 {{ form.hyperparameters.learning_rate.toFixed(2) }}</span>
                  <span class="rounded-full bg-[#fbfcff] px-2.5 py-1 ring-1 ring-[#e2e8f0]">深度 {{ form.hyperparameters.max_depth }}</span>
                  <span v-if="pendingExperimentAction === 'tune'" class="rounded-full bg-[#fff4da] px-2.5 py-1 text-[#b97113] ring-1 ring-[#f6d99a]">先自动调参</span>
                </div>
              </div>
              <p v-if="pendingExperimentAction === 'compare'" class="mt-2 text-xs leading-5 text-slate-500">
                对比算法：{{ availableAlgorithms.map((alg) => algorithmLabelZh(alg.key)).join('、') }}。每个算法会使用同一份数据划分预览规则，便于横向比较。
              </p>
            </section>

            <section
              v-if="experimentWarnings.length"
              class="rounded-[0.9rem] border border-[#ffe4b5] bg-[#fffaf0] px-4 py-3"
            >
              <p class="flex items-center gap-1.5 text-xs font-semibold text-[#a16207]">
                <AlertTriangle class="h-3.5 w-3.5" />
                启动前提示
              </p>
              <ul class="mt-1.5 space-y-1 text-xs leading-5 text-[#854d0e]">
                <li v-for="warning in experimentWarnings" :key="warning">· {{ warning }}</li>
              </ul>
            </section>
          </div>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#eef2f6] px-5 py-4">
          <p class="flex items-center gap-1.5 text-xs text-slate-500">
            <CheckCircle2 class="h-3.5 w-3.5 text-[#0b9d63]" />
            确认后会保存为一次可追溯训练任务。
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-[0.65rem] border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-slate-900"
              :disabled="starting || experimentPreviewLoading"
              @click="closeExperimentPreview"
            >
              <X class="h-3.5 w-3.5" />
              返回调整
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-[0.65rem] bg-[#5b56ea] px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_28px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
              :disabled="starting || experimentPreviewLoading || Boolean(experimentPreviewError) || selectedTrainingViewHardBlocked"
              @click="confirmExperimentStart"
            >
              <Loader2 v-if="starting" class="h-3.5 w-3.5 animate-spin" />
              <Play v-else class="h-3.5 w-3.5" />
              {{ starting ? '启动中' : experimentConfirmLabel }}
            </button>
          </div>
        </footer>
      </section>
    </div>

    <div
      v-if="showSaveVersionModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
      @click.self="closeSaveVersionModal"
    >
      <section class="w-full max-w-2xl overflow-hidden rounded-[1.1rem] border border-[#dbe4f2] bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]">
        <header class="flex items-start justify-between gap-4 border-b border-[#eef2f6] px-5 py-4">
          <div class="min-w-0">
            <p class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b56ea]">
              <ClipboardCheck class="h-3.5 w-3.5" />
              模型版本
            </p>
            <h2 class="mt-1 text-xl font-semibold tracking-[-0.03em] text-slate-950">{{ versionModalTitle }}</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              保存后会固定本次训练的配置、保留特征、划分方案、指标和实验报告；后续数据集变化不会改写这个版本。
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.65rem] border border-[#e2e8f0] bg-white text-slate-500 transition hover:bg-[#f8fbff] hover:text-slate-900"
            :disabled="versionActionLoading === 'save-version'"
            title="关闭"
            @click="closeSaveVersionModal"
          >
            <X class="h-4 w-4" />
          </button>
        </header>

        <div class="space-y-4 px-5 py-4">
          <div class="grid gap-2 text-xs sm:grid-cols-5">
            <div class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
              <p class="text-[10px] font-semibold text-slate-400">算法</p>
              <p class="mt-1 truncate font-semibold text-slate-900">{{ algorithmLabelZh(activeTask?.config.algorithm) }}</p>
            </div>
            <div class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
              <p class="text-[10px] font-semibold text-slate-400">视图</p>
              <p class="mt-1 truncate font-semibold text-slate-900">{{ trainingViewShortLabel(activeTaskTrainingViewKey) }}</p>
            </div>
            <div class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
              <p class="text-[10px] font-semibold text-slate-400">划分</p>
              <p class="mt-1 truncate font-semibold text-slate-900">{{ splitStrategyLabel(activeTask?.config.data_options?.split_strategy) }}</p>
            </div>
            <div class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
              <p class="text-[10px] font-semibold text-slate-400">样本</p>
              <p class="mt-1 font-semibold text-slate-900 tabular-nums">{{ formatNumber(activeTask?.dataset.usable_records) }}</p>
            </div>
            <div class="rounded-[0.65rem] bg-[#fbfcff] px-3 py-2 ring-1 ring-[#eef2f6]">
              <p class="text-[10px] font-semibold text-slate-400">特征</p>
              <p class="mt-1 font-semibold text-slate-900 tabular-nums">{{ formatNumber(activeTask?.dataset.feature_dimensions) }}</p>
            </div>
          </div>

          <label class="block">
            <span class="mb-1.5 block text-xs font-semibold text-slate-700">版本名称</span>
            <input
              v-model="saveVersionName"
              type="text"
              class="h-11 w-full rounded-[0.7rem] border border-[#dbe4f2] bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/25"
              placeholder="例如：Gradient Boosting / 116 samples / paper split"
            >
          </label>

          <label class="block">
            <span class="mb-1.5 block text-xs font-semibold text-slate-700">备注</span>
            <textarea
              v-model="saveVersionDescription"
              rows="3"
              class="w-full resize-none rounded-[0.7rem] border border-[#dbe4f2] bg-white px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition focus:border-[#aebdfc] focus:ring-2 focus:ring-[#aebdfc]/25"
              placeholder="记录本版本适用场景、数据处理选择或需要注意的风险。"
            />
          </label>

          <label class="flex cursor-pointer items-start gap-3 rounded-[0.75rem] border border-[#eef2f6] bg-[#fbfcff] px-3 py-3">
            <input
              v-model="saveVersionRecommended"
              type="checkbox"
              class="mt-1 h-4 w-4 rounded border-slate-300 text-[#5b56ea] focus:ring-[#5b56ea]"
            >
            <span>
              <span class="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Star class="h-3.5 w-3.5" :class="saveVersionRecommended ? 'fill-[#5b56ea] text-[#5b56ea]' : 'text-slate-400'" />
                标记为推荐模型
              </span>
              <span class="mt-1 block text-xs leading-5 text-slate-500">
                同一工作区的同一训练视图只保留一个推荐模型；宏观与纳米会分别保留自己的推荐版本。
              </span>
            </span>
          </label>

          <p
            v-if="versionError"
            class="rounded-[0.7rem] border border-[#ffd4da] bg-[#fff5f6] px-3 py-2 text-xs text-[#cf334f]"
          >
            {{ versionError }}
          </p>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef2f6] px-5 py-4">
          <p class="text-xs text-slate-500">
            保存的是模型版本索引；训练 run 本身会继续保留，便于课程回放和结果追踪。
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-[0.65rem] border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-[#f8fbff] hover:text-slate-900"
              :disabled="versionActionLoading === 'save-version'"
              @click="closeSaveVersionModal"
            >
              <X class="h-3.5 w-3.5" />
              取消
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-[0.65rem] bg-[#5b56ea] px-4 py-2 text-xs font-semibold text-white shadow-[0_12px_28px_-18px_rgba(91,86,234,0.85)] transition hover:bg-[#4c47d9] disabled:cursor-not-allowed disabled:bg-[#cfd2f3] disabled:shadow-none"
              :disabled="versionActionLoading === 'save-version' || !saveVersionName.trim()"
              @click="handleSaveVersion"
            >
              <Loader2 v-if="versionActionLoading === 'save-version'" class="h-3.5 w-3.5 animate-spin" />
              <ClipboardCheck v-else class="h-3.5 w-3.5" />
              {{ versionActionLoading === 'save-version' ? '保存中' : versionModalConfirmLabel }}
            </button>
          </div>
        </footer>
      </section>
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
