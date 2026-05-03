<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileWarning,
  FlaskConical,
  ListChecks,
  RefreshCcw,
  Sparkles,
  Wand2,
  Workflow,
} from 'lucide-vue-next'
import {
  downloadCleanedDataset,
  importCleanedDatasetCsv,
  listCleanedDatasets,
  previewModelCleaning,
  type ModelCleaningMatrixRow,
  type ModelCleaningOptions,
  type ModelCleaningPreview,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'
import DatasetBuilderDescriptorModule from './dataset-builder/DatasetBuilderDescriptorModule.vue'
import DatasetBuilderExportModule from './dataset-builder/DatasetBuilderExportModule.vue'
import DatasetBuilderReductionStudio from './dataset-builder/DatasetBuilderReductionStudio.vue'
import type { BuilderSubsetSummary, SubsetCard, SubsetKey } from './dataset-builder/types'

type CleaningPresetKey = 'balanced' | 'strict' | 'coverage'
type BuilderModuleKey = 'quality' | 'descriptor' | 'reduction' | 'export'
type RepresentativeFeatureSelection = Record<SubsetKey, string[]>
type QualitySeverity = 'ok' | 'watch' | 'action'

const SOURCE_MODE_OPTIONS = [
  { value: 'group_library_fallback', label: '当前工作区优先，缺失时回退组库', detail: '适合快速构建覆盖更广的训练集。' },
  { value: 'current_scope', label: '只使用当前工作区', detail: '适合做严格、可追踪的小范围分析。' },
  { value: 'group_library', label: '只使用组级共享库', detail: '适合构建跨工作区的统一数据池。' },
] as const

const STARTER_PRESETS = [
  { key: 'balanced', label: '平衡模式', badge: '推荐', summary: '兼顾样本量与完整性。' },
  { key: 'strict', label: '严格模式', badge: '严格', summary: '更适合复现实验和小样本验证。' },
  { key: 'coverage', label: '扩展模式', badge: '扩展', summary: '优先保留更多记录，形成更大的总池。' },
] as const

const DEFAULT_KEEP_FEATURES = [
  'temperature',
  'speed',
  'load',
  'load_min',
  'load_max',
  'load_span',
  'load_is_range',
  'potential',
  'water_content',
  'film_thickness',
  'alkyl_chain_length',
]

const props = defineProps<{
  currentSection?: string
}>()

const emit = defineEmits<{
  (e: 'open-training', datasetId: number | null): void
  (e: 'change-section', section: string): void
}>()

const form = reactive<ModelCleaningOptions>({
  source_mode: 'group_library_fallback',
  drop_missing_target: true,
  require_dual_smiles: true,
  missing_value_strategy: 'median',
  remove_target_outliers: false,
  iqr_multiplier: 1.5,
  feature_config: {
    use_pca: false,
    n_components: 10,
    keep_features: [...DEFAULT_KEEP_FEATURES],
  },
})

const preview = ref<ModelCleaningPreview | null>(null)
const savedDatasets = ref<SavedCleanedDatasetSummary[]>([])
const loading = ref(true)
const previewLoading = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const exportLoadingId = ref<number | null>(null)
const subsetSavingKey = ref<SubsetKey | null>(null)
const bundleName = ref('')
const lastSavedDatasetId = ref<number | null>(null)
const autoPreviewReady = ref(false)
const activeModule = ref<BuilderModuleKey>(props.currentSection === 'datasets' ? 'descriptor' : 'quality')
const selectedRepresentativeFeatures = ref<RepresentativeFeatureSelection>({
  dataset_a: [],
  dataset_b: [],
})
const representativeSelectionDirty = ref<Record<SubsetKey, boolean>>({
  dataset_a: false,
  dataset_b: false,
})

let autoPreviewTimer: ReturnType<typeof setTimeout> | null = null

const builder = computed(() => preview.value?.dataset_builder || null)
const descriptorSummary = computed(() => builder.value?.descriptor_generation || null)
const screeningSummary = computed(() => builder.value?.screening || null)
const datasetASummary = computed(() => builder.value?.subsets.dataset_a || null)
const datasetBSummary = computed(() => builder.value?.subsets.dataset_b || null)

const availableRepresentativeFeatures = computed<Record<SubsetKey, string[]>>(() => ({
  dataset_a: datasetASummary.value?.columns.filter((column) => column !== datasetASummary.value?.target_column) || [],
  dataset_b: datasetBSummary.value?.columns.filter((column) => column !== datasetBSummary.value?.target_column) || [],
}))

const recommendedRepresentativeFeatures = computed<RepresentativeFeatureSelection>(() => {
  const strongest = screeningSummary.value?.strongest_to_target || []
  const ionicGroups = screeningSummary.value?.ionic_collinearity_groups || []
  const surfaceAlerts = screeningSummary.value?.surface_bias_alerts || []
  const correlationMap = new Map(strongest.map((item) => [item.feature, item.abs_correlation]))

  const buildFor = (key: SubsetKey) => {
    const available = new Set(availableRepresentativeFeatures.value[key])
    const picked: string[] = []
    const pickedSet = new Set<string>()
    const groupedSet = new Set<string>()

    const add = (feature: string) => {
      if (!available.has(feature) || pickedSet.has(feature)) return
      picked.push(feature)
      pickedSet.add(feature)
    }

    for (const group of ionicGroups) {
      const features = group.features.filter((feature) => available.has(feature))
      features.forEach((feature) => groupedSet.add(feature))
      const representative = [...features].sort((left, right) => (correlationMap.get(right) || 0) - (correlationMap.get(left) || 0))[0]
      if (representative) add(representative)
    }

    for (const alert of surfaceAlerts) {
      const features = alert.features.filter((feature) => available.has(feature))
      features.forEach((feature) => groupedSet.add(feature))
      const representative = [...features].sort((left, right) => (correlationMap.get(right) || 0) - (correlationMap.get(left) || 0))[0]
      if (representative) add(representative)
    }

    for (const item of strongest) {
      if (!available.has(item.feature) || groupedSet.has(item.feature)) continue
      add(item.feature)
      if (picked.length >= 10) break
    }

    if (key === 'dataset_b' && available.has('Film_Thickness')) {
      add('Film_Thickness')
    }

    return picked.length ? picked : [...availableRepresentativeFeatures.value[key]].slice(0, 10)
  }

  return {
    dataset_a: buildFor('dataset_a'),
    dataset_b: buildFor('dataset_b'),
  }
})

const retainedFeatureColumns = computed(() => [
  ...selectedRepresentativeFeatures.value.dataset_a,
  ...selectedRepresentativeFeatures.value.dataset_b,
])

const selectedSourceMode = computed(() => {
  return SOURCE_MODE_OPTIONS.find((option) => option.value === form.source_mode)?.label || SOURCE_MODE_OPTIONS[0].label
})

const rdkitStatusLabel = computed(() => {
  if (!descriptorSummary.value) return '--'
  return descriptorSummary.value.rdkit_enabled ? '已启用' : '未启用'
})

const outlierLabel = computed(() => {
  return form.remove_target_outliers ? `开启 · IQR ${form.iqr_multiplier.toFixed(1)}` : '关闭'
})

const activePresetKey = computed<CleaningPresetKey | null>(() => {
  if (
    form.source_mode === 'current_scope' &&
    form.drop_missing_target &&
    form.require_dual_smiles &&
    form.remove_target_outliers
  ) return 'strict'

  if (
    form.source_mode === 'group_library_fallback' &&
    form.drop_missing_target &&
    !form.require_dual_smiles &&
    !form.remove_target_outliers
  ) return 'coverage'

  if (
    form.source_mode === 'group_library_fallback' &&
    form.drop_missing_target &&
    form.require_dual_smiles &&
    !form.remove_target_outliers
  ) return 'balanced'

  return null
})

const cleaningSummary = computed(() => preview.value?.summary || null)
const missingTargetCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_target || 0)
const missingCationCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_cation_smiles || 0)
const missingAnionCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_anion_smiles || 0)
const missingChemistryFieldCount = computed(() => missingCationCount.value + missingAnionCount.value)
const repairCount = computed(() => {
  const repairs = cleaningSummary.value?.missing_value_repairs || {}
  return Object.values(repairs).reduce((sum, value) => sum + Number(value || 0), 0)
})
const rawRecordCount = computed(() => cleaningSummary.value?.raw_records || 0)
const trainingReadyCount = computed(() => cleaningSummary.value?.training_ready_records || 0)
const chemistryReadyCount = computed(() => cleaningSummary.value?.chemistry_ready_records || 0)
const outlierCount = computed(() => cleaningSummary.value?.outliers_detected || 0)
const baseDatasetCount = computed(() => datasetASummary.value?.row_count || descriptorSummary.value?.usable_rows || trainingReadyCount.value)
const enhancedDatasetCount = computed(() => datasetBSummary.value?.row_count || 0)
const filmMissingCount = computed(() => Math.max(0, baseDatasetCount.value - enhancedDatasetCount.value))
const readyRatio = computed(() => {
  if (!rawRecordCount.value) return 0
  return trainingReadyCount.value / rawRecordCount.value
})
const filmCoverageRatio = computed(() => {
  if (!baseDatasetCount.value) return 0
  return enhancedDatasetCount.value / baseDatasetCount.value
})

const qualityIssueCards = computed(() => {
  const cards = [
    {
      key: 'target',
      title: '目标值完整度',
      value: missingTargetCount.value,
      unit: '条缺少 μ/COF',
      severity: missingTargetCount.value > 0 ? 'action' : 'ok',
      status: form.drop_missing_target ? '已按推荐排除' : '建议排除后再训练',
      explanation: '模型必须知道每条样本的摩擦系数，缺少目标值的记录不能直接进入训练。',
      studentAction: '保留“有 μ/COF 的样本”开关，必要时回到审核页补充原文证据。',
      icon: FileWarning,
    },
    {
      key: 'chemistry',
      title: '离子结构可用性',
      value: missingChemistryFieldCount.value,
      unit: '个 SMILES 缺口',
      severity: missingChemistryFieldCount.value > 0 ? 'action' : 'ok',
      status: `${chemistryReadyCount.value} 条记录可生成分子描述符`,
      explanation: '阳离子和阴离子 SMILES 会生成结构描述符，是后续特征筛选和建模的基础。',
      studentAction: '优先补齐缺失的 SMILES；如果只是做覆盖率探索，可以临时关闭严格要求。',
      icon: Database,
    },
    {
      key: 'process',
      title: '工况字段缺失',
      value: repairCount.value,
      unit: '个空值已处理',
      severity: repairCount.value > 0 ? 'watch' : 'ok',
      status: form.missing_value_strategy === 'median' ? '当前使用中位数补齐' : '当前不做中位数补齐',
      explanation: '温度、速度、载荷等工况缺失会让模型误判实验条件。',
      studentAction: '先用推荐补齐方案生成基线数据集，关键字段仍应回到文献证据中修正。',
      icon: Wand2,
    },
    {
      key: 'outlier',
      title: '异常摩擦系数',
      value: outlierCount.value,
      unit: '条疑似异常',
      severity: outlierCount.value > 0 ? 'watch' : 'ok',
      status: form.remove_target_outliers ? '已移出训练池' : '保留但会提示风险',
      explanation: '极端 μ/COF 可能是真实特殊现象，也可能是单位或抽取错误。',
      studentAction: '课堂练习可先保留观察；正式训练前建议逐条检查证据。',
      icon: AlertTriangle,
    },
    {
      key: 'film',
      title: '膜厚覆盖',
      value: enhancedDatasetCount.value,
      unit: '条含膜厚',
      severity: enhancedDatasetCount.value > 0 ? 'ok' : 'watch',
      status: `${Math.round(filmCoverageRatio.value * 100)}% 可进入增强数据集`,
      explanation: '膜厚不是所有文献都会给出，所以平台会自动分成基础数据集和增强数据集。',
      studentAction: filmMissingCount.value > 0
        ? `不要强行补膜厚；${filmMissingCount.value} 条样本会留在基础数据集中。`
        : '当前样本都可以进入增强数据集。',
      icon: ListChecks,
    },
    {
      key: 'ready',
      title: '可训练样本池',
      value: trainingReadyCount.value,
      unit: '条可训练',
      severity: trainingReadyCount.value >= 10 ? 'ok' : 'action',
      status: trainingReadyCount.value >= 10 ? '已达到 Modeling 最低要求' : '少于 10 条，暂不建议训练',
      explanation: '样本太少时模型评估不稳定，训练结果更像演示而不是可靠实验。',
      studentAction: '如果不足 10 条，先扩大文献范围或降低筛选限制。',
      icon: CheckCircle2,
    },
  ]

  return cards as Array<typeof cards[number] & { severity: QualitySeverity }>
})

const actionIssueCount = computed(() => qualityIssueCards.value.filter((card) => card.severity === 'action').length)
const watchIssueCount = computed(() => qualityIssueCards.value.filter((card) => card.severity === 'watch').length)
const qualityScore = computed(() => {
  const readiness = Math.round(readyRatio.value * 70)
  const issuePenalty = actionIssueCount.value * 10 + watchIssueCount.value * 4
  const savedBonus = savedDatasets.value.length > 0 ? 8 : 0
  return Math.max(0, Math.min(100, readiness + 22 + savedBonus - issuePenalty))
})

const qualityVerdict = computed(() => {
  if (trainingReadyCount.value < 10) return '需要先补数据'
  if (actionIssueCount.value > 0) return '建议修完关键问题'
  if (watchIssueCount.value > 0) return '可以生成基线数据集'
  return '可以进入训练'
})

function severityCardClass(severity: QualitySeverity) {
  if (severity === 'action') return 'border-rose-200 bg-rose-50/70'
  if (severity === 'watch') return 'border-amber-200 bg-amber-50/70'
  return 'border-emerald-200 bg-emerald-50/60'
}

function severityIconClass(severity: QualitySeverity) {
  if (severity === 'action') return 'bg-rose-100 text-rose-700'
  if (severity === 'watch') return 'bg-amber-100 text-amber-700'
  return 'bg-emerald-100 text-emerald-700'
}

function severityLabel(severity: QualitySeverity) {
  if (severity === 'action') return '需处理'
  if (severity === 'watch') return '需确认'
  return '通过'
}

function filterSubsetSummary(key: SubsetKey, summary: BuilderSubsetSummary | null) {
  if (!summary) return null
  const selectedSet = new Set(selectedRepresentativeFeatures.value[key])
  const filteredColumns = summary.columns.filter((column) => column === summary.target_column || selectedSet.has(column))
  const pickRow = (row: ModelCleaningMatrixRow) => Object.fromEntries(
    filteredColumns.map((column) => [column, row[column] ?? null]),
  ) as ModelCleaningMatrixRow

  return {
    ...summary,
    columns: filteredColumns,
    rows: summary.rows.map((row) => pickRow(row)),
    preview_rows: summary.preview_rows.map((row) => pickRow(row)),
    feature_count: Math.max(0, filteredColumns.length - 1),
  }
}

const subsetCards = computed<SubsetCard[]>(() => {
  if (!builder.value) return []

  return [
    {
      key: 'dataset_a',
      label: 'Dataset-A',
      title: '基础数据集',
      summary: filterSubsetSummary('dataset_a', datasetASummary.value),
      accent: 'sky',
      description: '覆盖优先，不强制要求膜厚，适合先训练一个稳定的基线模型。',
    },
    {
      key: 'dataset_b',
      label: 'Dataset-B',
      title: '增强数据集',
      summary: filterSubsetSummary('dataset_b', datasetBSummary.value),
      accent: 'emerald',
      description: '在基础特征上加入膜厚 h，适合探索界面结构与性能的关系。',
    },
  ]
})

const moduleTabs = computed(() => [
  {
    key: 'quality' as const,
    step: '02',
    title: '质量检查',
    detail: '先看缺失、异常和可训练样本数，确认数据能不能交给模型。',
    metricValue: actionIssueCount.value,
    metricLabel: '关键问题',
  },
  {
    key: 'descriptor' as const,
    step: '03',
    title: '划分数据集',
    detail: '把样本自动拆成基础数据集和增强数据集。',
    metricValue: 2,
    metricLabel: '训练版本',
  },
  {
    key: 'reduction' as const,
    step: '04',
    title: '选择特征',
    detail: '识别共线字段，决定每个数据集保留哪些代表特征。',
    metricValue: retainedFeatureColumns.value.length,
    metricLabel: '已选特征',
  },
  {
    key: 'export' as const,
    step: '05',
    title: '生成训练数据集',
    detail: '保存到工作区，Modeling 可以直接读取这个版本。',
    metricValue: (datasetASummary.value?.row_count ?? 0) + (datasetBSummary.value?.row_count ?? 0),
    metricLabel: '候选样本',
  },
])

const autoPreviewSignature = computed(() => JSON.stringify(form))

function defaultBundleName() {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `Tribology Builder ${stamp}`
}

function applyStarterPreset(presetKey: CleaningPresetKey) {
  if (presetKey === 'balanced') {
    form.source_mode = 'group_library_fallback'
    form.drop_missing_target = true
    form.require_dual_smiles = true
    form.remove_target_outliers = false
    form.iqr_multiplier = 1.5
    return
  }

  if (presetKey === 'strict') {
    form.source_mode = 'current_scope'
    form.drop_missing_target = true
    form.require_dual_smiles = true
    form.remove_target_outliers = true
    form.iqr_multiplier = 1.5
    return
  }

  form.source_mode = 'group_library_fallback'
  form.drop_missing_target = true
  form.require_dual_smiles = false
  form.remove_target_outliers = false
  form.iqr_multiplier = 1.5
}

function applyRecommendedStudentPreset() {
  applyStarterPreset('balanced')
  void runPreview()
}

function goToDatasetBuilder(module: BuilderModuleKey = 'descriptor') {
  activeModule.value = module
  emit('change-section', 'datasets')
}

function goToQualityCheck() {
  activeModule.value = 'quality'
  emit('change-section', 'cleaning')
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function rowsToCsv(rows: ModelCleaningMatrixRow[], columns: string[]) {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function filteredSubsetByKey(key: SubsetKey) {
  return subsetCards.value.find((card) => card.key === key)?.summary || null
}

function scheduleAutoPreview() {
  if (!autoPreviewReady.value) return
  if (autoPreviewTimer) clearTimeout(autoPreviewTimer)
  autoPreviewTimer = setTimeout(() => {
    void runPreview(true)
  }, 450)
}

async function fetchSavedDatasets() {
  const response = await listCleanedDatasets()
  savedDatasets.value = response.items
}

async function runPreview(silent: boolean = false) {
  previewLoading.value = true
  errorMessage.value = ''
  if (!silent) statusMessage.value = ''

  try {
    preview.value = await previewModelCleaning(form)
    if (!bundleName.value) bundleName.value = defaultBundleName()
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || '生成数据集构建预览失败。'
  } finally {
    previewLoading.value = false
  }
}

async function initialize() {
  loading.value = true
  try {
    await Promise.all([runPreview(), fetchSavedDatasets()])
    autoPreviewReady.value = true
  } finally {
    loading.value = false
  }
}

function downloadSubset(key: SubsetKey) {
  const subset = filteredSubsetByKey(key)
  if (!subset) return
  const csv = rowsToCsv(subset.rows, subset.columns)
  const filename = `${bundleName.value || defaultBundleName()}-${subset.name.toLowerCase()}.csv`
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

async function saveSubsetToWorkspace(key: SubsetKey) {
  const subset = filteredSubsetByKey(key)
  if (!subset) return

  subsetSavingKey.value = key
  errorMessage.value = ''
  statusMessage.value = ''

  try {
    const csv = rowsToCsv(subset.rows, subset.columns)
    const filename = `${bundleName.value || defaultBundleName()}-${subset.name.toLowerCase()}.csv`
    const file = new File([csv], filename, { type: 'text/csv;charset=utf-8;' })
    const response = await importCleanedDatasetCsv({
      file,
      name: `${bundleName.value || defaultBundleName()} ${subset.name}`,
      description: `${subset.description} 来源：${selectedSourceMode.value}。`,
      targetColumn: subset.target_column,
    })
    lastSavedDatasetId.value = response.dataset.id
    statusMessage.value = `${subset.name} 已保存到工作区，数据集编号 #${response.dataset.id}。`
    await fetchSavedDatasets()
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || `${subset.name} 保存失败。`
  } finally {
    subsetSavingKey.value = null
  }
}

function openTraining(datasetId: number | null = lastSavedDatasetId.value) {
  emit('open-training', datasetId)
}

async function handleExportSaved(dataset: SavedCleanedDatasetSummary) {
  exportLoadingId.value = dataset.id
  try {
    const blob = await downloadCleanedDataset(dataset.id)
    triggerDownload(blob, `${dataset.name || `cleaned-dataset-${dataset.id}`}.csv`)
  } catch (error: any) {
    errorMessage.value = error?.message || '导出已保存数据集失败。'
  } finally {
    exportLoadingId.value = null
  }
}

watch(autoPreviewSignature, () => {
  scheduleAutoPreview()
})

watch(
  () => props.currentSection,
  (section) => {
    if (section === 'cleaning') {
      activeModule.value = 'quality'
      return
    }
    if (section === 'datasets' && activeModule.value === 'quality') {
      activeModule.value = 'descriptor'
    }
  },
)

watch(
  [availableRepresentativeFeatures, recommendedRepresentativeFeatures],
  ([available, recommended]) => {
    ;(['dataset_a', 'dataset_b'] as SubsetKey[]).forEach((key) => {
      const availableSet = new Set(available[key])
      const current = selectedRepresentativeFeatures.value[key].filter((feature) => availableSet.has(feature))
      if (!representativeSelectionDirty.value[key] || current.length === 0) {
        selectedRepresentativeFeatures.value[key] = [...recommended[key]]
        representativeSelectionDirty.value[key] = false
      } else {
        selectedRepresentativeFeatures.value[key] = current
      }
    })
  },
  { immediate: true },
)

function updateSelectedRepresentativeFeatures(payload: { dataset: SubsetKey; features: string[] }) {
  const availableSet = new Set(availableRepresentativeFeatures.value[payload.dataset])
  selectedRepresentativeFeatures.value[payload.dataset] = payload.features.filter((feature) => availableSet.has(feature))
  representativeSelectionDirty.value[payload.dataset] = true
}

onMounted(() => {
  void initialize()
})

onBeforeUnmount(() => {
  if (autoPreviewTimer) clearTimeout(autoPreviewTimer)
})
</script>

<template>
  <div class="min-h-full bg-[#f5f7fb] text-slate-900">
    <div class="w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
      <section v-if="errorMessage" class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <div class="flex items-center gap-2 font-semibold">
          <AlertTriangle class="h-4 w-4" />
          {{ errorMessage }}
        </div>
      </section>

      <section v-if="statusMessage" class="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <div class="flex items-center gap-2 font-semibold">
          <Sparkles class="h-4 w-4" />
          {{ statusMessage }}
        </div>
      </section>

      <section v-if="loading && !preview" class="mt-6 rounded-[28px] border border-slate-200 bg-white px-6 py-8">
        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">加载中</p>
        <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-950">正在生成数据集构建预览</h2>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-500">系统正在拉取样本、计算分子描述符并准备当前构建流程。</p>
      </section>

      <template v-else-if="preview && builder">
        <section class="mt-6 rounded-[28px] border border-slate-200 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div class="max-w-3xl">
              <div class="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                <Workflow class="h-3.5 w-3.5" />
                数据准备向导
              </div>
              <h1 class="mt-3 text-[2rem] font-semibold tracking-tight text-slate-950">数据准备：检查并生成训练数据集</h1>
              <p class="mt-3 text-sm leading-7 text-slate-600">
                先确认缺失、异常和膜厚覆盖，再把可用记录保存成训练数据集版本。保存后的版本会直接出现在 Modeling 页。
              </p>
            </div>

            <div class="grid min-w-[18rem] grid-cols-3 gap-2 text-center">
              <div class="rounded-2xl bg-slate-50 px-3 py-3">
                <p class="text-[11px] font-semibold text-slate-400">质量分</p>
                <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ qualityScore }}</p>
              </div>
              <div class="rounded-2xl bg-slate-50 px-3 py-3">
                <p class="text-[11px] font-semibold text-slate-400">可训练</p>
                <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ trainingReadyCount }}</p>
              </div>
              <div class="rounded-2xl bg-slate-50 px-3 py-3">
                <p class="text-[11px] font-semibold text-slate-400">已保存</p>
                <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ savedDatasets.length }}</p>
              </div>
            </div>
          </div>

          <div class="mt-6 grid gap-3 lg:grid-cols-4">
            <button
              type="button"
              class="rounded-2xl border px-4 py-4 text-left transition"
              :class="props.currentSection === 'explorer' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50'"
              @click="emit('change-section', 'explorer')"
            >
              <p class="text-[11px] font-semibold text-slate-400">01</p>
              <p class="mt-2 text-sm font-semibold text-slate-950">选择文献</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">{{ rawRecordCount || '当前' }} 条原始记录进入检查。</p>
            </button>
            <button
              type="button"
              class="rounded-2xl border px-4 py-4 text-left transition"
              :class="activeModule === 'quality' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:bg-white'"
              @click="goToQualityCheck"
            >
              <p class="text-[11px] font-semibold text-indigo-500">02</p>
              <p class="mt-2 text-sm font-semibold text-slate-950">检查数据</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">{{ qualityVerdict }}。</p>
            </button>
            <button
              type="button"
              class="rounded-2xl border px-4 py-4 text-left transition"
              :class="activeModule === 'descriptor' || activeModule === 'reduction' || activeModule === 'export' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:bg-white'"
              @click="goToDatasetBuilder('descriptor')"
            >
              <p class="text-[11px] font-semibold text-slate-400">03</p>
              <p class="mt-2 text-sm font-semibold text-slate-950">生成数据集</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">基础 / 增强两个版本。</p>
            </button>
            <button
              type="button"
              class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:bg-white"
              @click="openTraining()"
            >
              <p class="text-[11px] font-semibold text-slate-400">04</p>
              <p class="mt-2 text-sm font-semibold text-slate-950">训练模型</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">打开 Modeling 读取已保存版本。</p>
            </button>
          </div>

          <div class="mt-5 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              v-for="tab in moduleTabs"
              :key="tab.key"
              type="button"
              class="rounded-xl px-3 py-2 text-xs font-semibold transition"
              :class="activeModule === tab.key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'"
              @click="activeModule = tab.key"
            >
              {{ tab.title }}
              <span class="ml-1 opacity-70">{{ tab.metricValue }} {{ tab.metricLabel }}</span>
            </button>
          </div>
        </section>

        <section v-if="activeModule === 'quality'" class="mt-6 space-y-6">
          <section class="rounded-[28px] border border-slate-200 bg-white p-6">
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div>
                <div class="flex items-center gap-3">
                  <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                    <ListChecks class="h-5 w-5" />
                  </div>
                  <div>
                    <h2 class="text-xl font-semibold tracking-tight text-slate-950">质量问题清单</h2>
                    <p class="mt-1 text-sm leading-6 text-slate-500">按“能不能训练、会不会误导模型、是否需要回到文献修正”来排序。</p>
                  </div>
                </div>

                <div class="mt-6 grid gap-4 lg:grid-cols-2">
                  <article
                    v-for="card in qualityIssueCards"
                    :key="card.key"
                    class="rounded-2xl border p-4"
                    :class="severityCardClass(card.severity)"
                  >
                    <div class="flex items-start gap-3">
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" :class="severityIconClass(card.severity)">
                        <component :is="card.icon" class="h-5 w-5" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <h3 class="text-sm font-semibold text-slate-950">{{ card.title }}</h3>
                          <span class="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
                            {{ severityLabel(card.severity) }}
                          </span>
                        </div>
                        <p class="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                          {{ card.value }}
                          <span class="text-xs font-medium text-slate-500">{{ card.unit }}</span>
                        </p>
                        <p class="mt-2 text-xs font-semibold text-slate-700">{{ card.status }}</p>
                        <p class="mt-2 text-xs leading-5 text-slate-600">{{ card.explanation }}</p>
                        <p class="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600">{{ card.studentAction }}</p>
                      </div>
                    </div>
                  </article>
                </div>
              </div>

              <aside class="space-y-4">
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div class="flex items-center gap-2">
                    <FlaskConical class="h-4 w-4 text-indigo-600" />
                    <h3 class="text-sm font-semibold text-slate-950">学生推荐设置</h3>
                  </div>
                  <div class="mt-4 grid gap-3">
                    <button
                      v-for="preset in STARTER_PRESETS"
                      :key="preset.key"
                      type="button"
                      class="rounded-2xl border px-4 py-3 text-left transition"
                      :class="activePresetKey === preset.key ? 'border-cyan-300 bg-white' : 'border-slate-200 bg-white/70 hover:bg-white'"
                      @click="applyStarterPreset(preset.key)"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <p class="text-sm font-semibold text-slate-950">{{ preset.label }}</p>
                        <span class="rounded-full px-2.5 py-1 text-[10px] font-semibold" :class="activePresetKey === preset.key ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'">
                          {{ preset.badge }}
                        </span>
                      </div>
                      <p class="mt-1 text-xs leading-5 text-slate-500">{{ preset.summary }}</p>
                    </button>
                  </div>
                  <button
                    type="button"
                    class="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    :disabled="previewLoading"
                    @click="applyRecommendedStudentPreset"
                  >
                    <RefreshCcw class="h-4 w-4" />
                    {{ previewLoading ? '重建中...' : '使用推荐设置重建' }}
                  </button>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 class="text-sm font-semibold text-slate-950">当前清洗规则</h3>
                  <div class="mt-4 space-y-3">
                    <label class="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      <input v-model="form.drop_missing_target" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                      <span>
                        <span class="block font-medium text-slate-900">保留有 μ/COF 的样本</span>
                        <span class="mt-1 block text-xs leading-5 text-slate-500">训练模型必须开启。</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      <input v-model="form.require_dual_smiles" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                      <span>
                        <span class="block font-medium text-slate-900">要求双离子 SMILES</span>
                        <span class="mt-1 block text-xs leading-5 text-slate-500">保证结构特征可计算。</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                      <input v-model="form.remove_target_outliers" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                      <span>
                        <span class="block font-medium text-slate-900">移除异常 μ/COF</span>
                        <span class="mt-1 block text-xs leading-5 text-slate-500">{{ outlierLabel }}</span>
                      </span>
                    </label>
                  </div>

                  <div class="mt-4">
                    <label class="mb-2 block text-xs font-semibold text-slate-400">样本来源</label>
                    <select v-model="form.source_mode" class="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100">
                      <option v-for="option in SOURCE_MODE_OPTIONS" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                    <p class="mt-2 text-xs leading-5 text-slate-500">{{ SOURCE_MODE_OPTIONS.find((option) => option.value === form.source_mode)?.detail }}</p>
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                  @click="goToDatasetBuilder('descriptor')"
                >
                  继续生成训练数据集
                  <ArrowRight class="h-4 w-4" />
                </button>
              </aside>
            </div>
          </section>
        </section>

        <section v-else class="mt-6">
          <DatasetBuilderDescriptorModule
            v-if="activeModule === 'descriptor'"
            :descriptor-summary="descriptorSummary"
            :dataset-a-summary="datasetASummary"
            :dataset-b-summary="datasetBSummary"
            :selected-source-mode="selectedSourceMode"
            :rdkit-status-label="rdkitStatusLabel"
            :outlier-label="outlierLabel"
          />

          <DatasetBuilderReductionStudio
            v-else-if="activeModule === 'reduction'"
            :descriptor-summary="descriptorSummary"
            :screening-summary="screeningSummary"
            :dataset-a-summary="datasetASummary"
            :dataset-b-summary="datasetBSummary"
            :selected-representative-features="selectedRepresentativeFeatures"
            :recommended-representative-features="recommendedRepresentativeFeatures"
            @update:selected-representative-features="updateSelectedRepresentativeFeatures"
          />

          <DatasetBuilderExportModule
            v-else
            :subset-cards="subsetCards"
            :bundle-name="bundleName"
            :subset-saving-key="subsetSavingKey"
            :saved-datasets="savedDatasets"
            :export-loading-id="exportLoadingId"
            :retained-feature-columns="retainedFeatureColumns"
            @update:bundle-name="bundleName = $event"
            @download="downloadSubset"
            @save="saveSubsetToWorkspace"
            @open-training="openTraining"
            @export-saved="handleExportSaved"
          />
        </section>
      </template>
    </div>
  </div>
</template>
