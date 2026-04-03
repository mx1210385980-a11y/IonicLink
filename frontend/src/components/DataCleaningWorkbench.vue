<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AlertTriangle, RefreshCcw, Sparkles, Workflow } from 'lucide-vue-next'
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
type BuilderModuleKey = 'descriptor' | 'reduction' | 'export'
type RepresentativeFeatureSelection = Record<SubsetKey, string[]>

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

const emit = defineEmits<{
  (e: 'open-training', datasetId: number | null): void
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
const activeModule = ref<BuilderModuleKey>('descriptor')
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
      title: '通用池',
      summary: filterSubsetSummary('dataset_a', datasetASummary.value),
      accent: 'sky',
      description: '剔除膜厚 h，保留覆盖更广的离子性质、表面与工况特征。',
    },
    {
      key: 'dataset_b',
      label: 'Dataset-B',
      title: '机理池',
      summary: filterSubsetSummary('dataset_b', datasetBSummary.value),
      accent: 'emerald',
      description: '保留含膜厚 h 的样本，用于分析成膜相关机制。',
    },
  ]
})

const moduleTabs = computed(() => [
  {
    key: 'descriptor' as const,
    step: '01',
    title: '数据集划分',
    detail: '先确认 Dataset-A 和 Dataset-B 的样本结构与分布。',
    metricValue: 2,
    metricLabel: '双池数据',
  },
  {
    key: 'reduction' as const,
    step: '02',
    title: '降维工作站',
    detail: '基于真实 CSV 识别共线簇，并手动决定每个数据集保留哪些代表特征。',
    metricValue: retainedFeatureColumns.value.length,
    metricLabel: '已选特征',
  },
  {
    key: 'export' as const,
    step: '03',
    title: '分流与导出',
    detail: '把处理后的 Dataset-A / Dataset-B 导出或保存到工作区。',
    metricValue: (datasetASummary.value?.row_count ?? 0) + (datasetBSummary.value?.row_count ?? 0),
    metricLabel: '导出样本',
  },
])

const cleaningComparisonCards = computed(() => {
  const rawRecords = Number(preview.value?.summary.raw_records || 0)
  const readyRecords = Number(preview.value?.summary.training_ready_records || 0)
  const blockedRecords = Math.max(0, rawRecords - readyRecords)
  const descriptorFeatures = Number((descriptorSummary.value?.descriptor_count || 0) + (descriptorSummary.value?.macro_feature_count || 0))
  const retainedFeatures = retainedFeatureColumns.value.length
  const latestSavedDataset = savedDatasets.value[0] || null

  return [
    {
      key: 'retained_rows',
      label: 'Retained Rows',
      beforeLabel: 'Raw scope',
      beforeValue: rawRecords,
      afterLabel: 'Training-ready',
      afterValue: readyRecords,
      badge: rawRecords ? `${readyRecords}/${rawRecords} retained` : 'No rows yet',
      tone: 'sky',
      note: 'How many rows survive the default cleaning path.',
    },
    {
      key: 'missing_blockers',
      label: 'Missing-Field Reduction',
      beforeLabel: 'Blocked rows',
      beforeValue: blockedRecords,
      afterLabel: 'After cleaning',
      afterValue: 0,
      badge: `${blockedRecords} blockers removed`,
      tone: 'emerald',
      note: 'Rows excluded because required targets or chemistry fields are missing.',
    },
    {
      key: 'feature_reduction',
      label: 'Feature Reduction',
      beforeLabel: 'Candidate features',
      beforeValue: descriptorFeatures,
      afterLabel: 'Retained features',
      afterValue: retainedFeatures,
      badge: `${Math.max(0, descriptorFeatures - retainedFeatures)} reduced`,
      tone: 'amber',
      note: 'From descriptor generation down to the representative feature set.',
    },
    {
      key: 'saved_outputs',
      label: 'Saved Outputs',
      beforeLabel: 'Saved datasets',
      beforeValue: savedDatasets.value.length,
      afterLabel: 'Latest rows',
      afterValue: Number(latestSavedDataset?.row_count || 0),
      badge: latestSavedDataset ? `Latest: ${latestSavedDataset.name}` : 'No saved dataset yet',
      tone: 'violet',
      note: 'Concrete outputs the mentor can inspect or hand into training.',
    },
  ]
})

function comparisonTone(tone: string) {
  if (tone === 'emerald') return 'from-emerald-500/15 to-teal-500/10 border-emerald-200 dark:border-emerald-500/20'
  if (tone === 'amber') return 'from-amber-500/15 to-orange-500/10 border-amber-200 dark:border-amber-500/20'
  if (tone === 'violet') return 'from-violet-500/15 to-fuchsia-500/10 border-violet-200 dark:border-violet-500/20'
  return 'from-sky-500/15 to-cyan-500/10 border-sky-200 dark:border-sky-500/20'
}

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
          <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div class="inline-flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1">
                <button
                  v-for="tab in moduleTabs"
                  :key="tab.key"
                  type="button"
                  class="rounded-xl px-3 py-2 text-xs font-semibold transition"
                  :class="activeModule === tab.key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'"
                  @click="activeModule = tab.key"
                >
                  {{ tab.title }}
                </button>
              </div>
              <p class="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
                先看样本池，再在第二步决定哪些代表特征真正保留；第三步导出和保存时会自动继承这个选择。
              </p>
            </div>

            <div class="grid min-w-[280px] gap-3 sm:grid-cols-3">
              <div class="border-l border-slate-200 pl-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">可用样本</p>
                <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{{ descriptorSummary?.usable_rows ?? 0 }}</p>
              </div>
              <div class="border-l border-slate-200 pl-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">当前保留</p>
                <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{{ retainedFeatureColumns.length }}</p>
              </div>
              <div class="border-l border-slate-200 pl-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">已保存数据集</p>
                <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{{ savedDatasets.length }}</p>
              </div>
            </div>
          </div>

          <div v-if="activeModule === 'export'" class="grid gap-6 pt-5 xl:grid-cols-[1.3fr_1fr]">
            <div>
              <div class="flex items-center gap-2">
                <Workflow class="h-4 w-4 text-cyan-700" />
                <h2 class="text-base font-semibold text-slate-950">一步设置</h2>
              </div>

              <div class="mt-4 grid gap-3 sm:grid-cols-3">
                <button
                  v-for="preset in STARTER_PRESETS"
                  :key="preset.key"
                  type="button"
                  class="rounded-2xl border px-4 py-4 text-left transition"
                  :class="activePresetKey === preset.key ? 'border-cyan-300 bg-cyan-50' : 'border-slate-200 bg-slate-50 hover:bg-white'"
                  @click="applyStarterPreset(preset.key)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-sm font-semibold text-slate-950">{{ preset.label }}</p>
                    <span class="rounded-full px-2.5 py-1 text-[10px] font-semibold" :class="activePresetKey === preset.key ? 'bg-cyan-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'">
                      {{ preset.badge }}
                    </span>
                  </div>
                  <p class="mt-2 text-xs leading-5 text-slate-500">{{ preset.summary }}</p>
                </button>
              </div>
            </div>

            <div class="space-y-4">
              <div>
                <label class="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">样本来源</label>
                <select v-model="form.source_mode" class="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100">
                  <option v-for="option in SOURCE_MODE_OPTIONS" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <p class="mt-2 text-xs leading-5 text-slate-500">{{ SOURCE_MODE_OPTIONS.find((option) => option.value === form.source_mode)?.detail }}</p>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input v-model="form.drop_missing_target" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                  <span>
                    <span class="block font-medium text-slate-900">保留有 μ/COF 的样本</span>
                    <span class="mt-1 block text-xs leading-5 text-slate-500">建议开启</span>
                  </span>
                </label>

                <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input v-model="form.require_dual_smiles" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                  <span>
                    <span class="block font-medium text-slate-900">要求双离子 SMILES</span>
                    <span class="mt-1 block text-xs leading-5 text-slate-500">保证描述符完整</span>
                  </span>
                </label>
              </div>

              <div class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input v-model="form.remove_target_outliers" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                  <span>
                    <span class="block font-medium text-slate-900">移除异常值</span>
                    <span class="mt-1 block text-xs leading-5 text-slate-500">{{ outlierLabel }}</span>
                  </span>
                </label>

                <button
                  type="button"
                  class="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  :disabled="previewLoading"
                  @click="runPreview()"
                >
                  <RefreshCcw class="h-4 w-4" />
                  {{ previewLoading ? '重建中...' : '重建预览' }}
                </button>
              </div>

              <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                当前来源：{{ selectedSourceMode }} · RDKit：{{ rdkitStatusLabel }} · 异常值过滤：{{ outlierLabel }}
              </div>
            </div>
          </div>
        </section>

        <section class="mt-6 grid gap-4 xl:grid-cols-2">
          <article
            v-for="card in cleaningComparisonCards"
            :key="card.key"
            class="rounded-[28px] border bg-gradient-to-br p-5"
            :class="comparisonTone(card.tone)"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{{ card.label }}</p>
                <p class="mt-2 text-sm leading-6 text-slate-600">{{ card.note }}</p>
              </div>
              <span class="rounded-full bg-white/80 px-3 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
                {{ card.badge }}
              </span>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-3">
              <div class="rounded-2xl border border-slate-200 bg-white/80 p-4">
                <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{{ card.beforeLabel }}</p>
                <p class="mt-2 text-3xl font-semibold text-slate-950">{{ card.beforeValue }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{{ card.afterLabel }}</p>
                <p class="mt-2 text-3xl font-semibold text-slate-950">{{ card.afterValue }}</p>
              </div>
            </div>
          </article>
        </section>

        <section class="mt-6">
          <DatasetBuilderDescriptorModule
            v-if="activeModule === 'descriptor'"
            :descriptor-summary="descriptorSummary"
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
