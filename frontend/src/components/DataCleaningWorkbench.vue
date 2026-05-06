<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Eye,
  Loader2,
  Package,
  Pencil,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  X,
  XCircle,
} from 'lucide-vue-next'
import type { ModelCleaningMatrixRow } from '@/lib/api'
import type { BuilderSubsetSummary, SubsetCard } from './dataset-builder/types'
import { formatDateTime } from './dataset-builder/formatters'
import {
  SOURCE_MODE_OPTIONS,
  STARTER_PRESETS,
  TRAINING_VIEW_OPTIONS,
  useCleaningPreview,
} from './cleaning/useCleaningPreview'
import { useQualityIssues } from './cleaning/useQualityIssues'

defineProps<{
  currentSection?: string
}>()

const emit = defineEmits<{
  (e: 'open-training', datasetId: number | null): void
  (e: 'change-section', section: string): void
  (e: 'open-review', payload?: { mode?: 'training-blockers' | null }): void
}>()

const {
  form,
  preview,
  savedDatasets,
  loading,
  previewLoading,
  errorMessage,
  statusMessage,
  exportLoadingId,
  detailLoadingId,
  savingDatasetId,
  deletingDatasetId,
  lastSavedDatasetId,
  selectedDatasetDetail,
  editingDatasetId,
  editDatasetName,
  editDatasetDescription,
  builder,
  descriptorSummary,
  screeningSummary,
  datasetASummary,
  datasetBSummary,
  selectedSourceMode,
  selectedTrainingView,
  activePresetKey,
  initialize,
  runPreview,
  applyStarterPreset,
  saveSubsetCardToWorkspace,
  exportSavedDataset,
  viewSavedDataset,
  startDatasetEdit,
  cancelDatasetEdit,
  saveDatasetEdit,
  deleteSavedDataset,
} = useCleaningPreview()

const {
  qualityIssueCards,
  actionIssueCards,
  actionIssueCount,
  watchIssueCount,
  trainingReadyCount,
  rawRecordCount,
} = useQualityIssues({
  preview,
  form,
  selectedTrainingView,
  datasetASummary,
  datasetBSummary,
  savedDatasets,
})

const buildingState = ref<'idle' | 'building' | 'done' | 'error'>('idle')
const buildErrorMessage = ref('')
const showDetails = ref(false)
const showAdvancedBuilder = ref(false)
const trainingPlanTitle = '离子结构 + 工况协变量模型'
const trainingPlanTreatment = '正式训练要求阴/阳离子 SMILES,自动加入离子描述符;载荷、速度、温度、基底等只作为协变量。'
const FEATURE_BUDGET = 64
const MIN_DESCRIPTOR_FEATURES_PER_ION = 12

const MISSING_VALUE_OPTIONS = [
  { value: 'median', label: '中位数填补', detail: '适合保留样本量。' },
  { value: 'keep', label: '保留缺失', detail: '适合后续手动处理。' },
  { value: 'zero', label: '0 填补', detail: '只在字段含义允许时使用。' },
] as const

const PROCESS_FEATURE_OPTIONS = [
  { key: 'temperature', label: '温度', column: 'Temperature' },
  { key: 'speed', label: '速度', column: 'Speed' },
  { key: 'load', label: '载荷', column: 'Load' },
  { key: 'system_total_load', label: '系统总载荷', column: 'System_Total_Load' },
  { key: 'contact_load_per_unit', label: '单接触载荷', column: 'Contact_Load_Per_Unit' },
  { key: 'load_min', label: '载荷下限', column: 'Load_Min' },
  { key: 'load_max', label: '载荷上限', column: 'Load_Max' },
  { key: 'load_span', label: '载荷跨度', column: 'Load_Span' },
  { key: 'load_is_range', label: '载荷范围标记', column: 'Load_Is_Range' },
  { key: 'potential', label: '电位', column: 'Potential' },
  { key: 'water_content', label: '含水量', column: 'Water_Content' },
  { key: 'il_additive_mol_fraction', label: 'IL 摩尔分数', column: 'IL_Additive_Mol_Fraction' },
  { key: 'base_oil_mol_fraction', label: '基础油摩尔分数', column: 'Base_Oil_Mol_Fraction' },
  { key: 'film_thickness', label: '膜厚', column: 'Film_Thickness' },
  { key: 'alkyl_chain_length', label: '烷基链长', column: 'Alkyl_Chain_Length' },
] as const

const BUILDER_METADATA_COLUMNS = [
  '__record_id',
  '__literature_id',
  '__confidence',
  '__cation',
  '__anion',
  '__cation_smiles',
  '__anion_smiles',
  '__experiment_scale',
  '__experiment_method',
  '__measurement_type',
  '__training_view',
] as const

const SURFACE_FEATURE_COLUMNS = [
  'gamma_s',
  'sigma_s',
  'Surface_Roughness',
  'theta_s',
  'I_ss',
  'Probe_Roughness',
  'Substrate_Roughness',
] as const

type FeatureMeta = {
  symbol: string
  meaning: string
}

const FEATURE_META: Record<string, FeatureMeta> = {
  gamma_s: { symbol: 'γ_s', meaning: '固体表面自由能' },
  sigma_s: { symbol: 'σ_s', meaning: '固体表面电荷密度' },
  Surface_Roughness: { symbol: 'Rq', meaning: '表面均方根粗糙度' },
  theta_s: { symbol: 'θ_s', meaning: '静态接触角' },
  I_ss: { symbol: 'I_ss', meaning: '不锈钢基底指示变量' },
  Probe_Roughness: { symbol: 'Rq_probe', meaning: '探针粗糙度' },
  Substrate_Roughness: { symbol: 'Rq_sub', meaning: '基底粗糙度' },
  Temperature: { symbol: 'T', meaning: '温度' },
  Speed: { symbol: 'velocity', meaning: '滑动速度' },
  Load: { symbol: 'Load', meaning: '法向载荷中点' },
  System_Total_Load: { symbol: 'Load_total', meaning: '系统总载荷' },
  Contact_Load_Per_Unit: { symbol: 'Load_contact', meaning: '单接触点载荷' },
  Load_Min: { symbol: 'Load_min', meaning: '载荷范围下限' },
  Load_Max: { symbol: 'Load_max', meaning: '载荷范围上限' },
  Load_Span: { symbol: 'Load_span', meaning: '载荷范围跨度' },
  Load_Is_Range: { symbol: 'Load_range', meaning: '载荷是否为范围值' },
  Potential: { symbol: 'Potential', meaning: '外加电势' },
  Water_Content: { symbol: 'I_H2O', meaning: '含水量' },
  IL_Additive_Mol_Fraction: { symbol: 'x_IL', meaning: '离子液体摩尔分数' },
  Base_Oil_Mol_Fraction: { symbol: 'x_oil', meaning: '基础油摩尔分数' },
  Film_Thickness: { symbol: 'h', meaning: '界面膜厚' },
  Alkyl_Chain_Length: { symbol: 'n_alkyl', meaning: '烷基链长' },
}

const ION_DESCRIPTOR_MEANINGS: Record<string, string> = {
  MolWt: '分子量',
  HeavyAtomMolWt: '重原子分子量',
  ExactMolWt: '精确分子量',
  MolLogP: '亲疏水性',
  MolMR: '摩尔折射率',
  TPSA: '拓扑极性表面积',
  LabuteASA: '近似溶剂可及表面积',
  FractionCSP3: '饱和碳比例',
  HeavyAtomCount: '重原子数',
  NHOHCount: '羟基和胺氢数量',
  NOCount: '氮氧原子数',
  NumHAcceptors: '氢键受体数',
  NumHDonors: '氢键供体数',
  NumHeteroatoms: '杂原子数',
  NumRotatableBonds: '可旋转键数',
  RingCount: '环数量',
  NumAromaticRings: '芳香环数量',
  NumSaturatedRings: '饱和环数量',
  NumAliphaticRings: '脂肪环数量',
  NumAromaticHeterocycles: '芳香杂环数量',
  NumSaturatedHeterocycles: '饱和杂环数量',
  NumAliphaticHeterocycles: '脂肪杂环数量',
  NumAromaticCarbocycles: '芳香碳环数量',
  NumSaturatedCarbocycles: '饱和碳环数量',
  NumAliphaticCarbocycles: '脂肪碳环数量',
  HallKierAlpha: '霍尔-基尔校正项',
  BalabanJ: '拓扑连接指数',
  BertzCT: '拓扑复杂度',
  Kappa1: '形状指数一阶',
  Kappa2: '形状指数二阶',
  Kappa3: '形状指数三阶',
  Chi0: '价连接指数零阶',
  Chi0n: '归一化连接指数零阶',
  Chi0v: '价态连接指数零阶',
  Chi1: '价连接指数一阶',
  Chi1n: '归一化连接指数一阶',
  Chi1v: '价态连接指数一阶',
  Chi2n: '归一化连接指数二阶',
  Chi2v: '价态连接指数二阶',
  Chi3n: '归一化连接指数三阶',
  Chi3v: '价态连接指数三阶',
  Chi4n: '归一化连接指数四阶',
  Chi4v: '价态连接指数四阶',
  MaxAbsPartialCharge: '最大绝对部分电荷',
  MaxPartialCharge: '最大部分电荷',
  MinAbsPartialCharge: '最小绝对部分电荷',
  MinPartialCharge: '最小部分电荷',
  NumValenceElectrons: '价电子数',
  NumRadicalElectrons: '自由基电子数',
  FpDensityMorgan1: '摩根指纹密度一阶',
  FpDensityMorgan2: '摩根指纹密度二阶',
  FpDensityMorgan3: '摩根指纹密度三阶',
  NumBridgeheadAtoms: '桥头原子数',
  NumSpiroAtoms: '螺原子数',
}

type DescriptorDecision = 'keep' | 'drop' | 'reserve'
type DescriptorScreeningRow = {
  feature: string
  role: string
  coverage: number
  availableCount: number
  correlation: number | null
  absCorrelation: number
  importance: number
  score: number
  decision: DescriptorDecision
  reason: string
  representative?: string
  collinearGroupSize?: number
}

const availableFeatures = computed(() => datasetASummary.value?.columns.filter((c) => c !== datasetASummary.value?.target_column) || [])
const selectedProcessFeatureSet = computed<Set<string>>(() => new Set(form.feature_config.keep_features))
const selectedProcessFeatureColumns = computed<Set<string>>(() => new Set(
  PROCESS_FEATURE_OPTIONS
    .filter((option) => selectedProcessFeatureSet.value.has(option.key))
    .map((option) => option.column),
))
const builderMetadataColumnSet = new Set<string>(BUILDER_METADATA_COLUMNS)
const smilesScreeningSummary = computed(() => preview.value?.summary.smiles_screening || null)
const smilesDescriptorReadyCount = computed(() => smilesScreeningSummary.value?.descriptor_ready_records ?? 0)
const smilesInvalidCount = computed(() =>
  (smilesScreeningSummary.value?.invalid_cation_smiles || 0)
  + (smilesScreeningSummary.value?.invalid_anion_smiles || 0),
)
const surfaceDescriptorSource = computed(() => descriptorSummary.value?.surface_descriptor_source || null)
const descriptorCoverageThreshold = ref(0.6)
const descriptorCorrelationThreshold = ref(0.03)
const descriptorCollinearityThreshold = ref(0.88)
const advancedSummary = computed(() => {
  const source = SOURCE_MODE_OPTIONS.find((option) => option.value === form.source_mode)?.label || selectedSourceMode.value
  const view = selectedTrainingView.value.label
  return `${view} · ${source} · ${smilesDescriptorReadyCount.value} 条结构可解析`
})

function isCationDescriptor(column: string) {
  return column.startsWith('Cation_')
}

function isAnionDescriptor(column: string) {
  return column.startsWith('Anion_')
}

function isIonDescriptor(column: string) {
  return isCationDescriptor(column) || isAnionDescriptor(column)
}

function isSurfaceFeature(column: string) {
  return (SURFACE_FEATURE_COLUMNS as readonly string[]).includes(column)
}

function featureRole(column: string) {
  if (isCationDescriptor(column)) return '阳离子'
  if (isAnionDescriptor(column)) return '阴离子'
  if (isSurfaceFeature(column)) return '表面'
  if (column === 'Film_Thickness') return '膜厚'
  return '工况'
}

function numericCell(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pearsonForColumns(rows: ModelCleaningMatrixRow[], left: string, right: string) {
  const pairs = rows
    .map((row) => [numericCell(row[left]), numericCell(row[right])] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] != null && pair[1] != null)
  if (pairs.length < 3) return null
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length
  let numerator = 0
  let leftSq = 0
  let rightSq = 0
  for (const [leftValue, rightValue] of pairs) {
    const leftDelta = leftValue - leftMean
    const rightDelta = rightValue - rightMean
    numerator += leftDelta * rightDelta
    leftSq += leftDelta ** 2
    rightSq += rightDelta ** 2
  }
  if (leftSq <= 0 || rightSq <= 0) return null
  const value = numerator / Math.sqrt(leftSq * rightSq)
  return Number.isFinite(value) ? value : null
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatCorrelation(value: number | null) {
  if (value == null) return '--'
  return Math.abs(value).toFixed(3)
}

function featureMeta(feature: string): FeatureMeta {
  if (FEATURE_META[feature]) return FEATURE_META[feature]
  const ionMatch = /^(Cation|Anion)_(.+)$/.exec(feature)
  if (ionMatch) {
    const ionSuffix = ionMatch[1] === 'Cation' ? 'cat' : 'an'
    const ionMeaning = ionMatch[1] === 'Cation' ? '阳离子' : '阴离子'
    const descriptor = ionMatch[2] || feature
    return {
      symbol: `${descriptor}_${ionSuffix}`,
      meaning: `${ionMeaning}${ION_DESCRIPTOR_MEANINGS[descriptor] || '结构描述符'}`,
    }
  }
  return {
    symbol: feature,
    meaning: '训练矩阵字段',
  }
}

function formatFeatureSymbol(feature: string) {
  return featureMeta(feature).symbol
}

function formatFeatureMeaning(feature: string) {
  return featureMeta(feature).meaning
}

function decisionLabel(decision: DescriptorDecision) {
  if (decision === 'keep') return '保留'
  if (decision === 'reserve') return '候补'
  return '排除'
}

function decisionPillClass(decision: DescriptorDecision) {
  if (decision === 'keep') return 'bg-emerald-100 text-emerald-700'
  if (decision === 'reserve') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}

const descriptorScreeningRows = computed<DescriptorScreeningRow[]>(() => {
  const summary = datasetASummary.value
  if (!summary) return []
  const rows = summary.rows || []
  const targetColumn = summary.target_column
  const featureColumns = availableFeatures.value
  const importanceMap = new Map(
    (screeningSummary.value?.feature_importance?.features || [])
      .map((item) => [item.feature, Number(item.importance || 0)]),
  )
  const maxImportance = Math.max(...Array.from(importanceMap.values()), 0)
  const baseRows = featureColumns.map((feature) => {
    const availableCount = rows.reduce((count, row) => count + (numericCell(row[feature]) != null ? 1 : 0), 0)
    const coverage = rows.length ? availableCount / rows.length : 0
    const correlation = pearsonForColumns(rows, feature, targetColumn)
    const importance = importanceMap.get(feature) || 0
    const normalizedImportance = maxImportance > 0 ? importance / maxImportance : 0
    const absCorrelation = Math.abs(correlation || 0)
    return {
      feature,
      role: featureRole(feature),
      coverage,
      availableCount,
      correlation,
      absCorrelation,
      importance,
      score: normalizedImportance * 0.65 + absCorrelation * 0.35,
      decision: 'keep' as DescriptorDecision,
      reason: '进入候选特征',
    }
  })

  const candidates = baseRows.filter((row) => {
    if (!selectedProcessFeatureColumns.value.has(row.feature) && !isIonDescriptor(row.feature) && !isSurfaceFeature(row.feature)) return false
    return row.coverage >= descriptorCoverageThreshold.value
  })
  const parent = new Map<string, string>()
  const find = (feature: string): string => {
    const current = parent.get(feature) || feature
    if (current === feature) return current
    const root = find(current)
    parent.set(feature, root)
    return root
  }
  const union = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }
  candidates.forEach((row) => parent.set(row.feature, row.feature))
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]
    if (!left || (!isIonDescriptor(left.feature) && !isSurfaceFeature(left.feature))) continue
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]
      if (!right || (!isIonDescriptor(right.feature) && !isSurfaceFeature(right.feature))) continue
      if (left.role !== right.role) continue
      const correlation = pearsonForColumns(rows, left.feature, right.feature)
      if (correlation != null && Math.abs(correlation) >= descriptorCollinearityThreshold.value) {
        union(left.feature, right.feature)
      }
    }
  }
  const groups = new Map<string, DescriptorScreeningRow[]>()
  for (const row of candidates) {
    const root = find(row.feature)
    const members = groups.get(root) || []
    members.push(row)
    groups.set(root, members)
  }
  const representativeMap = new Map<string, string>()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const representative = [...members].sort((left, right) =>
      right.score - left.score
      || right.absCorrelation - left.absCorrelation
      || right.coverage - left.coverage
      || left.feature.localeCompare(right.feature),
    )[0]
    if (!representative) continue
    members.forEach((member) => representativeMap.set(member.feature, representative.feature))
  }

  return baseRows
    .map((row) => {
      const representative = representativeMap.get(row.feature)
      let decision: DescriptorDecision = 'keep'
      let reason = '覆盖率和排序通过'
      if (!selectedProcessFeatureColumns.value.has(row.feature) && !isIonDescriptor(row.feature) && !isSurfaceFeature(row.feature)) {
        decision = 'drop'
        reason = '工况字段未开启'
      } else if (row.coverage < descriptorCoverageThreshold.value) {
        decision = 'drop'
        reason = '覆盖率不足'
      } else if (isIonDescriptor(row.feature) && row.absCorrelation < descriptorCorrelationThreshold.value && row.importance <= 0) {
        decision = 'reserve'
        reason = '与目标的线性相关偏弱'
      } else if (representative && representative !== row.feature) {
        decision = 'drop'
        reason = `与 ${formatFeatureSymbol(representative)} 高共线`
      }
      return {
        ...row,
        decision,
        reason,
        representative,
        collinearGroupSize: representative ? groups.get(find(row.feature))?.length : undefined,
      }
    })
    .sort((left, right) =>
      (left.decision === 'keep' ? 0 : left.decision === 'reserve' ? 1 : 2)
      - (right.decision === 'keep' ? 0 : right.decision === 'reserve' ? 1 : 2)
      || right.score - left.score
      || right.absCorrelation - left.absCorrelation,
    )
})

const descriptorKeptRows = computed(() => descriptorScreeningRows.value.filter((row) => row.decision === 'keep'))
const descriptorReservedRows = computed(() => descriptorScreeningRows.value.filter((row) => row.decision === 'reserve'))
const descriptorDroppedRows = computed(() => descriptorScreeningRows.value.filter((row) => row.decision === 'drop'))
const descriptorTopRows = computed(() => descriptorScreeningRows.value.slice(0, 12))
const descriptorImportanceTopRows = computed(() =>
  [...descriptorScreeningRows.value]
    .filter((row) => row.importance > 0)
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 8),
)
const descriptorCollinearityPreview = computed(() => {
  const groups = new Map<string, DescriptorScreeningRow[]>()
  for (const row of descriptorScreeningRows.value) {
    if (!row.representative) continue
    const members = groups.get(row.representative) || []
    members.push(row)
    groups.set(row.representative, members)
  }
  return Array.from(groups.entries())
    .map(([representative, members]) => ({ representative, members }))
    .filter((group) => group.members.length > 1)
    .slice(0, 5)
})

const recommendedFeatures = computed<string[]>(() => {
  const picked: string[] = []
  const pickedSet = new Set<string>()
  const add = (feature: string) => {
    if (picked.length >= FEATURE_BUDGET || pickedSet.has(feature)) return
    picked.push(feature)
    pickedSet.add(feature)
  }

  descriptorKeptRows.value
    .filter((row) => !isIonDescriptor(row.feature))
    .forEach((row) => add(row.feature))

  for (const predicate of [isCationDescriptor, isAnionDescriptor]) {
    const rows = descriptorKeptRows.value.filter((row) => predicate(row.feature))
    rows.slice(0, Math.max(MIN_DESCRIPTOR_FEATURES_PER_ION, Math.ceil(rows.length / 3))).forEach((row) => add(row.feature))
  }

  descriptorKeptRows.value.forEach((row) => add(row.feature))
  descriptorReservedRows.value.forEach((row) => add(row.feature))
  return picked.length ? picked : availableFeatures.value.slice(0, FEATURE_BUDGET)
})

const retainedFeatureColumns = computed(() => recommendedFeatures.value)

function filterTrainingSummary(summary: BuilderSubsetSummary | null) {
  if (!summary) return null
  const selected = new Set(recommendedFeatures.value)
  const cols = summary.columns.filter((c) => builderMetadataColumnSet.has(c) || c === summary.target_column || selected.has(c))
  const pickRow = (row: ModelCleaningMatrixRow) => Object.fromEntries(
    cols.map((c) => [c, row[c] ?? null]),
  ) as ModelCleaningMatrixRow
  return {
    ...summary,
    name: 'Training Dataset',
    description: `${trainingPlanTitle} generated from the current Knowledge view.`,
    columns: cols,
    rows: summary.rows.map(pickRow),
    preview_rows: summary.preview_rows.map(pickRow),
    feature_count: cols.filter((c) => c !== summary.target_column && !builderMetadataColumnSet.has(c)).length,
  }
}

const buildableSubsets = computed<SubsetCard[]>(() => {
  if (!builder.value) return []
  return [
    {
      key: 'dataset_a',
      label: 'Training Dataset',
      title: '训练数据集',
      summary: filterTrainingSummary(datasetASummary.value),
      accent: 'sky',
      description: `${trainingPlanTitle}:当前只冻结一个训练数据集版本。`,
    },
  ]
})

const isBlocked = computed(() => {
  if (loading.value || previewLoading.value) return true
  if (rawRecordCount.value === 0) return true
  if (trainingReadyCount.value < 10) return true
  return false
})

const canBuild = computed(() => !isBlocked.value && buildableSubsets.value.length > 0)

const droppedCount = computed(() => {
  const dropped = preview.value?.summary?.dropped_by_reason
  if (!dropped) return 0
  return Object.values(dropped).reduce((sum, v) => sum + Number(v || 0), 0)
})

const trainingDatasetSummary = computed(() => filterTrainingSummary(datasetASummary.value))

async function autoBuild() {
  if (!canBuild.value || buildingState.value === 'building') return

  buildingState.value = 'building'
  buildErrorMessage.value = ''

  try {
    for (const card of buildableSubsets.value) {
      if (!card.summary) continue
      await saveSubsetCardToWorkspace(card)
      if (errorMessage.value) {
        throw new Error(errorMessage.value)
      }
    }
    buildingState.value = 'done'
  } catch (error: any) {
    buildingState.value = 'error'
    buildErrorMessage.value = error?.message || '生成失败,请重试。'
  }
}

function goReview() {
  emit('open-review', { mode: 'training-blockers' })
}

function goExplorer() {
  emit('change-section', 'explorer')
}

function goTraining(datasetId: number | null = lastSavedDatasetId.value) {
  emit('open-training', datasetId)
}

function previewColumns(dataset: typeof selectedDatasetDetail.value) {
  return (dataset?.matrix_columns || []).slice(0, 8)
}

function previewRows(dataset: typeof selectedDatasetDetail.value) {
  return (dataset?.rows || []).slice(0, 6)
}

function formatCell(value: unknown) {
  if (value == null || value === '') return '--'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4)
  return String(value)
}

function toggleProcessFeature(featureKey: string) {
  const current = new Set(form.feature_config.keep_features)
  if (current.has(featureKey)) current.delete(featureKey)
  else current.add(featureKey)
  form.feature_config.keep_features = PROCESS_FEATURE_OPTIONS
    .map((option) => option.key)
    .filter((key) => current.has(key))
}

const verdictTone = computed(() => {
  if (loading.value || previewLoading.value) return 'loading'
  if (rawRecordCount.value === 0) return 'empty'
  if (trainingReadyCount.value < 10) return 'blocked'
  if (actionIssueCount.value > 0 || watchIssueCount.value > 0) return 'caution'
  return 'ready'
})

const verdictView = computed(() => {
  if (verdictTone.value === 'loading') {
    return { icon: Loader2, headline: '正在分析...', subtext: '系统正在读取数据并做体检。' }
  }
  if (verdictTone.value === 'empty') {
    return {
      icon: AlertTriangle,
      headline: '还没有可用的记录',
      subtext: '先回到数据浏览,选择本次想要训练的文献。',
    }
  }
  if (verdictTone.value === 'blocked') {
    if (rawRecordCount.value > 0 && trainingReadyCount.value < 10) {
      return {
        icon: XCircle,
        headline: `只有 ${trainingReadyCount.value} 条数据能用,太少了`,
        subtext: '少于 10 条时模型很不稳定。先去补更多文献,或回到 Review 把缺失字段补齐。',
      }
    }
  }
  if (verdictTone.value === 'caution') {
    return {
      icon: AlertTriangle,
      headline: `${trainingReadyCount.value} 条可训练,还有 ${actionIssueCount.value + watchIssueCount.value} 类建模处理项`,
      subtext: '这些问题不必都回 Review 修;本页会冻结结构特征训练视图,通过样本筛选、字段舍弃或后续诊断来处理。',
    }
  }
  return {
    icon: CheckCircle2,
    headline: `${trainingReadyCount.value} 条数据通过检查,可以生成训练集`,
    subtext: '点击下面的按钮即可生成。',
  }
})

const verdictIconClass = computed(() => {
  if (verdictTone.value === 'ready') return 'text-emerald-600'
  if (verdictTone.value === 'caution') return 'text-amber-600'
  if (verdictTone.value === 'loading') return 'text-slate-500 animate-spin'
  return 'text-rose-600'
})

const primaryActionLabel = computed(() => {
  if (buildingState.value === 'building') return '正在生成...'
  if (buildingState.value === 'done') return '去 Modeling 训练'
  if (rawRecordCount.value === 0 || trainingReadyCount.value < 10) return '去数据浏览选记录'
  return '生成训练数据集'
})

const primaryActionHelp = computed(() => {
  if (buildingState.value === 'done') return '训练数据集已保存,下一步到 Modeling 选择模型。'
  if (canBuild.value) return '将冻结一个包含离子描述符和工况协变量的训练数据集版本。'
  if (trainingReadyCount.value < 10) return '样本不足时不生成训练版本,先扩大文献范围或补齐结构字段。'
  return '先等待当前数据体检完成。'
})

const displayIssueCards = computed(() => actionIssueCards.value.slice(0, 4))
const issueTotalCount = computed(() => actionIssueCount.value + watchIssueCount.value)

function handlePrimaryAction() {
  if (buildingState.value === 'building') return
  if (buildingState.value === 'done') {
    goTraining()
    return
  }
  if (!canBuild.value) {
    goExplorer()
    return
  }
  void autoBuild()
}

watch(
  () => JSON.stringify(form),
  () => {
    if (buildingState.value === 'done' || buildingState.value === 'error') {
      buildingState.value = 'idle'
      buildErrorMessage.value = ''
    }
  },
)

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#f5f7fb]">
    <div class="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
      <div class="mx-auto w-full max-w-[1120px] space-y-3 px-4 py-4 sm:px-6">
        <section v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div class="flex items-center gap-2">
            <AlertTriangle class="h-4 w-4 shrink-0" />
            <span>{{ errorMessage }}</span>
          </div>
        </section>

        <section v-if="statusMessage && buildingState === 'done'" class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <div class="flex items-center gap-2">
            <Sparkles class="h-4 w-4 shrink-0" />
            <span>{{ statusMessage }}</span>
          </div>
        </section>

        <section v-if="loading && !preview" class="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <Loader2 class="mx-auto h-7 w-7 animate-spin text-slate-400" />
          <p class="mt-3 text-sm font-medium text-slate-600">正在分析你的数据...</p>
          <p class="mt-1 text-xs text-slate-400">通常只需要几秒钟</p>
        </section>

        <template v-else-if="preview && builder">
          <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="grid gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]">
              <div class="p-4 sm:p-5">
                <div class="flex items-start gap-3">
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white">
                    <Target class="h-5 w-5" />
                  </div>
                  <div class="min-w-0">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Dataset Workflow</p>
                    <h1 class="mt-0.5 text-xl font-semibold tracking-tight text-slate-950">
                      生成摩擦系数预测训练集
                    </h1>
                    <p class="mt-1 text-sm leading-6 text-slate-600">
                      从 Knowledge 冻结一个结构特征训练视图;Review 继续保留完整事实和证据。
                    </p>
                  </div>
                </div>

                <div class="mt-4 grid gap-2 sm:grid-cols-4">
                  <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <BookOpen class="h-3.5 w-3.5" />
                      原始
                    </div>
                    <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ rawRecordCount }}</p>
                  </div>
                  <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                      <CheckCircle2 class="h-3.5 w-3.5" />
                      可训练
                    </div>
                    <p class="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{{ trainingReadyCount }}</p>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <XCircle class="h-3.5 w-3.5" />
                      排除
                    </div>
                    <p class="mt-1 text-xl font-semibold tabular-nums text-slate-700">{{ droppedCount }}</p>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <Package class="h-3.5 w-3.5" />
                      特征
                    </div>
                    <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ trainingDatasetSummary?.feature_count ?? 0 }}</p>
                  </div>
                </div>

                <div class="mt-4 grid gap-2 sm:grid-cols-3">
                  <div class="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">1 结构特征</p>
                    <p class="mt-1 text-sm font-medium text-slate-800">双离子 SMILES + 描述符</p>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">2 冻结版本</p>
                    <p class="mt-1 text-sm font-medium text-slate-800">{{ trainingDatasetSummary?.row_count ?? 0 }} 行进入训练集</p>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">3 训练模型</p>
                    <p class="mt-1 text-sm font-medium text-slate-800">保存后跳转 Modeling</p>
                  </div>
                </div>

                <section class="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3">
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-3 text-left"
                    @click="showAdvancedBuilder = true"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm">
                        <SlidersHorizontal class="h-4 w-4" />
                      </span>
                      <span class="min-w-0">
                        <span class="block text-sm font-semibold text-slate-950">高级构建参数</span>
                        <span class="mt-0.5 block truncate text-xs text-slate-500">{{ advancedSummary }}</span>
                      </span>
                    </span>
                    <span class="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                      打开设置
                      <ChevronRight class="h-3.5 w-3.5" />
                    </span>
                  </button>
                </section>

              </div>

              <aside class="border-t border-slate-200 bg-slate-50 p-4 sm:p-5 lg:border-l lg:border-t-0">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">将生成</p>
                <h2 class="mt-1 text-lg font-semibold tracking-tight text-slate-950">训练数据集</h2>
                <div class="mt-4 grid grid-cols-2 gap-2">
                  <div>
                    <p class="text-xs text-slate-500">样本</p>
                    <p class="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{{ trainingDatasetSummary?.row_count ?? 0 }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-500">特征</p>
                    <p class="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{{ trainingDatasetSummary?.feature_count ?? 0 }}</p>
                  </div>
                </div>
                <p class="mt-3 text-xs leading-5 text-slate-500">{{ primaryActionHelp }}</p>
                <button
                  type="button"
                  class="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  :disabled="buildingState === 'building' || previewLoading"
                  @click="handlePrimaryAction"
                >
                  <Loader2 v-if="buildingState === 'building' || previewLoading" class="h-4 w-4 animate-spin" />
                  <Sparkles v-else-if="buildingState !== 'done'" class="h-4 w-4" />
                  <ArrowRight v-else class="h-4 w-4" />
                  {{ primaryActionLabel }}
                </button>
                <button
                  v-if="verdictTone === 'caution'"
                  type="button"
                  class="mt-2 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  @click="goReview"
                >
                  回 Review 修事实
                </button>
              </aside>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex items-center gap-2">
                <component :is="verdictView.icon" class="h-5 w-5 shrink-0" :class="verdictIconClass" />
                <div>
                  <h2 class="text-base font-semibold tracking-tight text-slate-950">{{ verdictView.headline }}</h2>
                  <p class="mt-0.5 text-xs leading-5 text-slate-500">{{ verdictView.subtext }}</p>
                </div>
              </div>
              <span
                class="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold"
                :class="verdictTone === 'ready' ? 'bg-emerald-100 text-emerald-700' : verdictTone === 'blocked' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'"
              >
                {{ issueTotalCount }} 类处理项
              </span>
            </div>

            <div v-if="displayIssueCards.length" class="mt-3 grid gap-2 sm:grid-cols-2">
              <div
                v-for="card in displayIssueCards"
                :key="card.key"
                class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div class="flex items-center gap-2">
                  <component :is="card.icon" class="h-4 w-4 shrink-0 text-amber-600" />
                  <p class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                    {{ card.title }}
                    <span class="font-normal text-slate-500"> · {{ card.value }} {{ card.unit }}</span>
                  </p>
                </div>
                <p class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{{ card.trainingTreatment }}</p>
              </div>
            </div>
            <p v-else class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              当前结构训练视图没有阻塞项,可以直接生成训练数据集。
            </p>
            <p v-if="buildErrorMessage" class="mt-2 text-xs text-rose-600">{{ buildErrorMessage }}</p>
          </section>

        <section v-if="savedDatasets.length > 0" class="rounded-2xl border border-emerald-200 bg-white p-5">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div class="flex items-center gap-2">
              <CheckCircle2 class="h-4 w-4 text-emerald-600" />
              <h2 class="text-base font-semibold tracking-tight text-slate-950">已保存的训练数据集</h2>
            </div>
            <span class="text-xs font-medium text-slate-500">{{ savedDatasets.length }} 个版本</span>
          </div>

          <ul class="mt-3 space-y-2">
            <li
              v-for="dataset in savedDatasets"
              :key="dataset.id"
              class="rounded-xl bg-slate-50 px-4 py-3"
            >
              <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-slate-950">{{ dataset.name }}</p>
                  <p class="mt-1 text-xs text-slate-500">
                    {{ dataset.row_count }} 行 · {{ dataset.feature_columns.length }} 个特征 · {{ formatDateTime(dataset.created_at) }}
                  </p>
                  <p v-if="dataset.description" class="mt-1 line-clamp-1 text-xs text-slate-500">{{ dataset.description }}</p>
                </div>
                <div class="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    :disabled="detailLoadingId === dataset.id"
                    @click="viewSavedDataset(dataset)"
                  >
                    <Loader2 v-if="detailLoadingId === dataset.id" class="h-3 w-3 animate-spin" />
                    <Eye v-else class="h-3 w-3" />
                    {{ selectedDatasetDetail?.id === dataset.id ? '收起' : '查看' }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    @click="startDatasetEdit(dataset)"
                  >
                    <Pencil class="h-3 w-3" />
                    编辑
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                    @click="goTraining(dataset.id)"
                  >
                    去 Modeling
                    <ChevronRight class="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    :disabled="exportLoadingId === dataset.id"
                    @click="exportSavedDataset(dataset)"
                  >
                    {{ exportLoadingId === dataset.id ? '导出中...' : '导出 CSV' }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                    :disabled="deletingDatasetId === dataset.id"
                    @click="deleteSavedDataset(dataset)"
                  >
                    <Loader2 v-if="deletingDatasetId === dataset.id" class="h-3 w-3 animate-spin" />
                    <Trash2 v-else class="h-3 w-3" />
                    删除
                  </button>
                </div>
              </div>

              <div v-if="editingDatasetId === dataset.id" class="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div class="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                  <label class="text-xs font-semibold text-slate-600">
                    名称
                    <input
                      v-model="editDatasetName"
                      class="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                    >
                  </label>
                  <label class="text-xs font-semibold text-slate-600">
                    备注
                    <input
                      v-model="editDatasetDescription"
                      class="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                    >
                  </label>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    @click="cancelDatasetEdit"
                  >
                    <X class="h-3 w-3" />
                    取消
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                    :disabled="savingDatasetId === dataset.id"
                    @click="saveDatasetEdit(dataset)"
                  >
                    <Loader2 v-if="savingDatasetId === dataset.id" class="h-3 w-3 animate-spin" />
                    <Save v-else class="h-3 w-3" />
                    保存
                  </button>
                </div>
              </div>

              <div v-if="selectedDatasetDetail?.id === dataset.id" class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <div>
                    <p class="text-xs font-semibold text-slate-900">数据集预览</p>
                    <p class="mt-0.5 text-[11px] text-slate-500">
                      目标列 {{ selectedDatasetDetail.target_column }} · {{ selectedDatasetDetail.matrix_columns.length }} 列
                    </p>
                  </div>
                  <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    前 {{ previewRows(selectedDatasetDetail).length }} 行
                  </span>
                </div>
                <div class="max-h-64 overflow-auto custom-scrollbar">
                  <table class="min-w-full text-left text-[11px]">
                    <thead class="sticky top-0 bg-slate-50 text-slate-500">
                      <tr>
                        <th
                          v-for="column in previewColumns(selectedDatasetDetail)"
                          :key="column"
                          class="whitespace-nowrap border-b border-slate-100 px-3 py-2 font-semibold"
                        >
                          {{ column }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, rowIndex) in previewRows(selectedDatasetDetail)" :key="rowIndex" class="border-b border-slate-50">
                        <td
                          v-for="column in previewColumns(selectedDatasetDetail)"
                          :key="column"
                          class="max-w-[12rem] truncate px-3 py-2 text-slate-700"
                          :title="formatCell(row[column])"
                        >
                          {{ formatCell(row[column]) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </li>
          </ul>

          <button
            type="button"
            class="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white transition hover:bg-emerald-500"
            @click="goTraining()"
          >
            去 Modeling 训练模型
            <ArrowRight class="h-4 w-4" />
          </button>
        </section>

        <details
          class="rounded-2xl border border-slate-200 bg-slate-50/50 p-4"
          :open="showDetails"
          @toggle="showDetails = ($event.target as HTMLDetailsElement).open"
        >
          <summary class="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
            <span class="flex items-center gap-2">
              <RotateCcw class="h-3.5 w-3.5" />
              查看系统做了什么
            </span>
            <span class="text-xs font-normal text-slate-400">展开看细节</span>
          </summary>
          <div class="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs leading-6 text-slate-600">
            <p>· 当前训练路径:{{ trainingPlanTitle }}。{{ trainingPlanTreatment }}</p>
            <p>· 样本来源:{{ selectedSourceMode }}。</p>
            <p>· SMILES 筛选:{{ smilesDescriptorReadyCount }} 条记录可由 RDKit 解析并生成阴/阳离子描述符。</p>
            <p>· 自动选择了 {{ retainedFeatureColumns.length }} 个对预测最有帮助的特征(去掉了重复或共线的字段)。</p>
            <p>· 已检查 {{ qualityIssueCards.length }} 类质量问题,仅在训练视图中排除了 {{ droppedCount }} 条不适合结构训练的记录。</p>
            <p>· Review/证据定位继续服务 Knowledge 追溯,不是训练集生成的唯一入口。</p>
            <p>· 仅工况模型后续可作为消融诊断,用于证明离子描述符带来的增益,不作为这里的训练分支。</p>
            <p v-if="descriptorSummary?.rdkit_enabled">· 已用 RDKit 自动生成离子结构描述符。</p>
            <p v-else>· RDKit 未启用,目前仅使用宏观字段。</p>
          </div>
        </details>

      </template>
      </div>
    </div>
    <div
      v-if="preview && builder"
      class="z-20 shrink-0 border-t border-slate-200 bg-white/92 px-4 py-3 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.55)] backdrop-blur sm:px-6"
    >
      <div class="mx-auto flex w-full max-w-[1080px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold text-slate-950">{{ trainingPlanTitle }} · {{ trainingReadyCount }} 条可训练</p>
          <p class="mt-0.5 truncate text-xs text-slate-500">{{ primaryActionHelp }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            v-if="verdictTone === 'caution'"
            type="button"
            class="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            @click="goReview"
          >
            回 Review 修事实
          </button>
          <button
            type="button"
            class="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="buildingState === 'building' || previewLoading"
            @click="handlePrimaryAction"
          >
            <Loader2 v-if="buildingState === 'building' || previewLoading" class="h-4 w-4 animate-spin" />
            <Sparkles v-else-if="buildingState !== 'done'" class="h-4 w-4" />
            <ArrowRight v-else class="h-4 w-4" />
            {{ primaryActionLabel }}
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="showAdvancedBuilder"
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6"
        role="dialog"
        aria-modal="true"
        @click.self="showAdvancedBuilder = false"
      >
        <section class="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <SlidersHorizontal class="h-4 w-4" />
                </span>
                <div class="min-w-0">
                  <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Advanced Dataset Builder</p>
                  <h2 class="truncate text-lg font-semibold tracking-tight text-slate-950">高级构建参数</h2>
                </div>
              </div>
              <p class="mt-2 text-sm leading-5 text-slate-500">{{ advancedSummary }}</p>
            </div>
            <button
              type="button"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              @click="showAdvancedBuilder = false"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-5 py-4 custom-scrollbar">
            <div class="grid gap-3 sm:grid-cols-4">
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p class="text-xs font-semibold text-slate-500">当前样本</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ trainingDatasetSummary?.row_count ?? 0 }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p class="text-xs font-semibold text-slate-500">SMILES 可解析</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ smilesDescriptorReadyCount }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p class="text-xs font-semibold text-slate-500">当前特征</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ trainingDatasetSummary?.feature_count ?? 0 }}</p>
              </div>
              <div class="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p class="text-xs font-semibold text-slate-500">处理项</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ issueTotalCount }}</p>
              </div>
            </div>

            <section class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Descriptor Screening</p>
                  <h3 class="mt-0.5 text-base font-semibold tracking-tight text-slate-950">描述符筛选</h3>
                  <p class="mt-1 text-xs leading-5 text-slate-500">
                    按覆盖率、Pearson |r|、随机森林重要性和共线性合并推荐训练特征；符号与含义分列展示。
                  </p>
                  <p v-if="surfaceDescriptorSource" class="mt-1 text-xs leading-5 text-slate-500">
                    表面描述符已按论文码表回填 {{ surfaceDescriptorSource.matched_rows }}/{{ surfaceDescriptorSource.input_rows }} 条:
                    {{ surfaceDescriptorSource.matched_surfaces.map((item) => item.label).join('、') || '暂无命中' }}
                  </p>
                </div>
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div class="rounded-xl bg-emerald-50 px-3 py-2">
                    <p class="text-[11px] font-semibold text-emerald-700">保留</p>
                    <p class="text-lg font-semibold tabular-nums text-emerald-700">{{ descriptorKeptRows.length }}</p>
                  </div>
                  <div class="rounded-xl bg-amber-50 px-3 py-2">
                    <p class="text-[11px] font-semibold text-amber-700">候补</p>
                    <p class="text-lg font-semibold tabular-nums text-amber-700">{{ descriptorReservedRows.length }}</p>
                  </div>
                  <div class="rounded-xl bg-slate-100 px-3 py-2">
                    <p class="text-[11px] font-semibold text-slate-500">排除</p>
                    <p class="text-lg font-semibold tabular-nums text-slate-700">{{ descriptorDroppedRows.length }}</p>
                  </div>
                </div>
              </div>

              <div class="mt-4 grid gap-3 lg:grid-cols-3">
                <label class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  最低覆盖率 {{ formatPercent(descriptorCoverageThreshold) }}
                  <input
                    v-model.number="descriptorCoverageThreshold"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    class="mt-2 w-full accent-indigo-600"
                  >
                </label>
                <label class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  目标 Pearson |r| ≥ {{ descriptorCorrelationThreshold.toFixed(2) }}
                  <input
                    v-model.number="descriptorCorrelationThreshold"
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    class="mt-2 w-full accent-indigo-600"
                  >
                </label>
                <label class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  共线性 |r| ≥ {{ descriptorCollinearityThreshold.toFixed(2) }}
                  <input
                    v-model.number="descriptorCollinearityThreshold"
                    type="range"
                    min="0.7"
                    max="0.99"
                    step="0.01"
                    class="mt-2 w-full accent-indigo-600"
                  >
                </label>
              </div>

              <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                <div class="overflow-hidden rounded-xl border border-slate-200">
                  <div class="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                    <p class="text-xs font-semibold text-slate-900">筛选排序</p>
                    <span class="text-[11px] text-slate-500">按综合分排序</span>
                  </div>
                  <div>
                    <table class="w-full table-fixed text-left text-[11px]">
                      <colgroup>
                        <col class="w-[18%]">
                        <col class="w-[24%]">
                        <col class="w-[9%]">
                        <col class="w-[9%]">
                        <col class="w-[9%]">
                        <col class="w-[11%]">
                        <col class="w-[20%]">
                      </colgroup>
                      <thead class="sticky top-0 bg-white text-slate-500 shadow-sm">
                        <tr>
                          <th class="px-2 py-2 font-semibold">符号</th>
                          <th class="px-2 py-2 font-semibold">含义</th>
                          <th class="px-2 py-2 font-semibold">类型</th>
                          <th class="px-2 py-2 font-semibold">覆盖</th>
                          <th class="px-2 py-2 font-semibold">|r|</th>
                          <th class="px-2 py-2 font-semibold">重要性</th>
                          <th class="px-2 py-2 font-semibold">结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="row in descriptorTopRows"
                          :key="row.feature"
                          class="border-b border-slate-50"
                        >
                          <td class="truncate px-2 py-2 font-semibold text-slate-800" :title="row.feature">
                            {{ formatFeatureSymbol(row.feature) }}
                          </td>
                          <td class="truncate px-2 py-2 text-slate-500" :title="formatFeatureMeaning(row.feature)">
                            {{ formatFeatureMeaning(row.feature) }}
                          </td>
                          <td class="px-2 py-2">
                            <span class="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              {{ row.role }}
                            </span>
                          </td>
                          <td class="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{{ formatPercent(row.coverage) }}</td>
                          <td class="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{{ formatCorrelation(row.correlation) }}</td>
                          <td class="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">{{ row.importance.toFixed(4) }}</td>
                          <td class="px-2 py-2">
                            <span class="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-semibold" :class="decisionPillClass(row.decision)">
                              {{ decisionLabel(row.decision) }}
                            </span>
                            <p class="mt-1 truncate text-[10px] text-slate-400" :title="row.reason">{{ row.reason }}</p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-xs font-semibold text-slate-900">特征重要性 Top</p>
                      <span class="text-[11px] text-slate-500">{{ screeningSummary?.feature_importance?.method || 'Random Forest' }}</span>
                    </div>
                    <div v-if="descriptorImportanceTopRows.length" class="mt-2 space-y-2">
                      <div
                        v-for="row in descriptorImportanceTopRows"
                        :key="row.feature"
                        class="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2"
                      >
                        <span class="truncate text-[11px] font-semibold text-slate-700" :title="row.feature">{{ formatFeatureSymbol(row.feature) }}</span>
                        <span class="text-right text-[11px] tabular-nums text-slate-500">{{ row.importance.toFixed(4) }}</span>
                        <p class="col-span-2 -mt-1 truncate text-[10px] text-slate-500" :title="formatFeatureMeaning(row.feature)">
                          {{ formatFeatureMeaning(row.feature) }}
                        </p>
                        <div class="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            class="h-full rounded-full bg-indigo-500"
                            :style="{ width: `${Math.min(100, row.importance * 100)}%` }"
                          />
                        </div>
                      </div>
                    </div>
                    <p v-else class="mt-2 text-xs leading-5 text-slate-500">
                      {{ screeningSummary?.feature_importance?.reason || '当前样本不足,暂不显示重要性。' }}
                    </p>
                  </div>

                  <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-xs font-semibold text-slate-900">共线性合并</p>
                      <span class="text-[11px] text-slate-500">{{ descriptorCollinearityPreview.length }} 组</span>
                    </div>
                    <div v-if="descriptorCollinearityPreview.length" class="mt-2 space-y-2">
                      <div
                        v-for="group in descriptorCollinearityPreview"
                        :key="group.representative"
                        class="rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                      >
                        <p class="truncate text-[11px] font-semibold text-slate-800" :title="group.representative">
                          保留 {{ formatFeatureSymbol(group.representative) }}
                        </p>
                        <p class="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">
                          {{ formatFeatureMeaning(group.representative) }}；合并 {{ group.members.length }} 个高相关特征
                        </p>
                      </div>
                    </div>
                    <p v-else class="mt-2 text-xs leading-5 text-slate-500">当前阈值下未发现需要合并的高共线性簇。</p>
                  </div>
                </div>
              </div>
            </section>

            <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
              <div class="space-y-4">
                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-sm font-semibold text-slate-950">预设</h3>
                    <span class="text-xs text-slate-500">可随时改成自定义</span>
                  </div>
                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    <button
                      v-for="preset in STARTER_PRESETS"
                      :key="preset.key"
                      type="button"
                      class="rounded-xl border px-4 py-3 text-left transition"
                      :class="activePresetKey === preset.key ? 'border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'"
                      @click="applyStarterPreset(preset.key)"
                    >
                      <span class="flex items-center justify-between gap-2">
                        <span class="text-base font-semibold">{{ preset.label }}</span>
                        <span class="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold shadow-sm">{{ preset.badge }}</span>
                      </span>
                      <span class="mt-2 block text-sm leading-5 text-slate-500">{{ preset.summary }}</span>
                    </button>
                  </div>
                </section>

                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 class="text-sm font-semibold text-slate-950">训练视图</h3>
                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    <button
                      v-for="option in TRAINING_VIEW_OPTIONS"
                      :key="option.value"
                      type="button"
                      class="rounded-xl border px-4 py-3 text-left transition"
                      :class="form.training_view === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'"
                      @click="form.training_view = option.value"
                    >
                      <span class="text-sm font-semibold">{{ option.label }}</span>
                      <span class="mt-1 block text-xs leading-5 text-slate-500">{{ option.detail }}</span>
                    </button>
                  </div>
                </section>

                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 class="text-sm font-semibold text-slate-950">样本来源</h3>
                  <div class="mt-3 grid gap-3">
                    <button
                      v-for="option in SOURCE_MODE_OPTIONS"
                      :key="option.value"
                      type="button"
                      class="rounded-xl border px-4 py-3 text-left transition"
                      :class="form.source_mode === option.value ? 'border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'"
                      @click="form.source_mode = option.value"
                    >
                      <span class="text-sm font-semibold">{{ option.label }}</span>
                      <span class="mt-1 block text-xs leading-5 text-slate-500">{{ option.detail }}</span>
                    </button>
                  </div>
                </section>
              </div>

              <div class="space-y-4">
                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-sm font-semibold text-slate-950">SMILES 筛选</h3>
                    <span
                      class="rounded-full px-2.5 py-1 text-xs font-semibold"
                      :class="smilesInvalidCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'"
                    >
                      {{ smilesInvalidCount > 0 ? `${smilesInvalidCount} 个无效` : '已通过' }}
                    </span>
                  </div>

                  <div class="mt-3 grid gap-2 sm:grid-cols-3">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p class="text-[11px] font-semibold text-slate-500">双离子 SMILES</p>
                      <p class="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                        {{ smilesScreeningSummary?.dual_smiles_records ?? 0 }}
                      </p>
                    </div>
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p class="text-[11px] font-semibold text-slate-500">RDKit 可解析</p>
                      <p class="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                        {{ smilesDescriptorReadyCount }}
                      </p>
                    </div>
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p class="text-[11px] font-semibold text-slate-500">阴/阳离子种类</p>
                      <p class="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                        {{ smilesScreeningSummary?.unique_cations ?? 0 }}/{{ smilesScreeningSummary?.unique_anions ?? 0 }}
                      </p>
                    </div>
                  </div>

                  <div class="mt-3 space-y-3">
                    <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        v-model="form.require_dual_smiles"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      >
                      <span>
                        要求阴/阳离子 SMILES
                        <span class="mt-0.5 block text-xs font-normal leading-5 text-slate-500">缺任一离子结构时不进入结构训练集。</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        v-model="form.require_valid_smiles"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      >
                      <span>
                        要求 RDKit 可解析
                        <span class="mt-0.5 block text-xs font-normal leading-5 text-slate-500">复现论文描述符流程时建议开启。</span>
                      </span>
                    </label>
                  </div>

                  <p
                    v-if="smilesScreeningSummary && !smilesScreeningSummary.rdkit_available"
                    class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700"
                  >
                    后端 RDKit 未启用,当前只能检查 SMILES 是否存在。
                  </p>
                </section>

                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <h3 class="text-sm font-semibold text-slate-950">样本筛选</h3>
                  <div class="mt-3 space-y-3">
                    <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        v-model="form.drop_missing_target"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      >
                      <span>
                        排除缺少目标值的记录
                        <span class="mt-0.5 block text-xs font-normal leading-5 text-slate-500">摩擦系数为空时不进入训练。</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        v-model="form.remove_target_outliers"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      >
                      <span>
                        移除目标离群值
                        <span class="mt-0.5 block text-xs font-normal leading-5 text-slate-500">按 IQR 规则筛掉极端 COF。</span>
                      </span>
                    </label>
                  </div>

                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    <label class="text-xs font-semibold text-slate-600">
                      缺失值策略
                      <select
                        v-model="form.missing_value_strategy"
                        class="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option
                          v-for="option in MISSING_VALUE_OPTIONS"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <label class="text-xs font-semibold text-slate-600">
                      IQR 倍数
                      <input
                        v-model.number="form.iqr_multiplier"
                        type="number"
                        min="1"
                        max="5"
                        step="0.1"
                        :disabled="!form.remove_target_outliers"
                        class="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                    </label>
                  </div>
                </section>

                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-sm font-semibold text-slate-950">工况字段</h3>
                    <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{{ form.feature_config.keep_features.length }} 项</span>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      v-for="option in PROCESS_FEATURE_OPTIONS"
                      :key="option.key"
                      type="button"
                      class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                      :class="selectedProcessFeatureSet.has(option.key) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'"
                      @click="toggleProcessFeature(option.key)"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </section>

                <section class="rounded-xl border border-slate-200 bg-white p-4">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label class="flex flex-1 items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium text-slate-800">
                      <input
                        v-model="form.feature_config.use_pca"
                        type="checkbox"
                        class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      >
                      <span>
                        启用 PCA 降维
                        <span class="mt-0.5 block text-xs font-normal leading-5 text-slate-500">高维描述符过多时再开启。</span>
                      </span>
                    </label>
                    <label class="w-full text-xs font-semibold text-slate-600 sm:w-32">
                      主成分
                      <input
                        v-model.number="form.feature_config.n_components"
                        type="number"
                        min="2"
                        max="30"
                        :disabled="!form.feature_config.use_pca"
                        class="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                    </label>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <footer class="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-xs text-slate-500">参数变更后会自动更新预览,也可以手动刷新。</p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                @click="showAdvancedBuilder = false"
              >
                完成
              </button>
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                :disabled="previewLoading"
                @click="runPreview()"
              >
                <Loader2 v-if="previewLoading" class="h-4 w-4 animate-spin" />
                <RotateCcw v-else class="h-4 w-4" />
                刷新预览
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>
