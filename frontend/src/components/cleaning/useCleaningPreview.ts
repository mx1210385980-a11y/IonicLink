import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  deleteCleanedDataset,
  downloadCleanedDataset,
  getCleanedDataset,
  importCleanedDatasetCsv,
  listCleanedDatasets,
  previewModelCleaning,
  updateCleanedDataset,
  type ModelCleaningMatrixRow,
  type ModelCleaningOptions,
  type ModelCleaningPreview,
  type SavedCleanedDatasetDetail,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'
import type { BuilderSubsetSummary, SubsetCard, SubsetKey } from '../dataset-builder/types'

export type CleaningPresetKey = 'balanced' | 'strict'

export const DEFAULT_KEEP_FEATURES = [
  'temperature',
  'speed',
  'load',
  'system_total_load',
  'contact_load_per_unit',
  'load_min',
  'load_max',
  'load_span',
  'load_is_range',
  'potential',
  'water_content',
  'il_additive_mol_fraction',
  'base_oil_mol_fraction',
  'film_thickness',
  'alkyl_chain_length',
]

export const SOURCE_MODE_OPTIONS = [
  { value: 'group_library', label: '使用课题组文献库', detail: '默认数据源，适合学生直接构建统一训练集。' },
  { value: 'current_scope', label: '使用当前文献库', detail: '适合做严格、可追踪的小范围分析。' },
  { value: 'group_library_fallback', label: '当前文献库 + 课题组补全', detail: '适合快速构建覆盖更广的训练集。' },
] as const

export const TRAINING_VIEW_OPTIONS = [
  { value: 'all', label: '统一知识库全部样本', detail: '保留 macro 与 AFM 数据,适合先看总体覆盖。' },
  { value: 'macro_performance', label: '宏观性能预测', detail: '优先使用 ball-on-disk / ball-on-flat / pin-on-disk 等宏观 COF 与磨损数据。' },
  { value: 'afm_surface_response', label: 'AFM 表面响应', detail: '优先使用 AFM / FFM 的纳米摩擦、侧向力、粘附和表面响应数据。' },
  { value: 'cross_scale', label: '跨尺度数据池', detail: '保留已识别为宏观或 AFM 的记录,为后续跨尺度建模做准备。' },
] as const

export const STARTER_PRESETS = [
  { key: 'balanced' as const, label: '平衡模式', badge: '推荐', summary: '兼顾样本量与完整性。' },
  { key: 'strict' as const, label: '严格模式', badge: '严格', summary: '更适合复现实验和小样本验证。' },
]

function defaultBundleName() {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `Tribology Builder ${stamp}`
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

export function useCleaningPreview() {
  const form = reactive<ModelCleaningOptions>({
    source_mode: 'group_library',
    training_view: 'all',
    drop_missing_target: true,
    require_dual_smiles: true,
    require_valid_smiles: true,
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
  const detailLoadingId = ref<number | null>(null)
  const savingDatasetId = ref<number | null>(null)
  const deletingDatasetId = ref<number | null>(null)
  const subsetSavingKey = ref<SubsetKey | null>(null)
  const bundleName = ref('')
  const lastSavedDatasetId = ref<number | null>(null)
  const autoPreviewReady = ref(false)
  const selectedDatasetDetail = ref<SavedCleanedDatasetDetail | null>(null)
  const editingDatasetId = ref<number | null>(null)
  const editDatasetName = ref('')
  const editDatasetDescription = ref('')

  let autoPreviewTimer: ReturnType<typeof setTimeout> | null = null

  const builder = computed(() => preview.value?.dataset_builder || null)
  const descriptorSummary = computed(() => builder.value?.descriptor_generation || null)
  const screeningSummary = computed(() => builder.value?.screening || null)
  const datasetASummary = computed(() => builder.value?.subsets.dataset_a || null)
  const datasetBSummary = computed(() => builder.value?.subsets.dataset_b || null)

  const selectedSourceMode = computed(() => SOURCE_MODE_OPTIONS.find((option) => option.value === form.source_mode)?.label || SOURCE_MODE_OPTIONS[0].label)
  const selectedTrainingView = computed(() => TRAINING_VIEW_OPTIONS.find((option) => option.value === form.training_view) || TRAINING_VIEW_OPTIONS[0])
  const rdkitStatusLabel = computed(() => {
    if (!descriptorSummary.value) return '--'
    return descriptorSummary.value.rdkit_enabled ? '已启用' : '未启用'
  })
  const outlierLabel = computed(() => form.remove_target_outliers ? `开启 · IQR ${form.iqr_multiplier.toFixed(1)}` : '关闭')

  const activePresetKey = computed<CleaningPresetKey | null>(() => {
    if (form.source_mode === 'current_scope' && form.drop_missing_target && form.require_dual_smiles && form.require_valid_smiles && form.remove_target_outliers) return 'strict'
    if (form.source_mode === 'group_library' && form.drop_missing_target && form.require_dual_smiles && form.require_valid_smiles && !form.remove_target_outliers) return 'balanced'
    return null
  })

  function applyStarterPreset(presetKey: CleaningPresetKey) {
    if (presetKey === 'strict') {
      form.source_mode = 'current_scope'
      form.drop_missing_target = true
      form.require_dual_smiles = true
      form.require_valid_smiles = true
      form.remove_target_outliers = true
      form.iqr_multiplier = 1.5
      return
    }
    form.source_mode = 'group_library'
    form.drop_missing_target = true
    form.require_dual_smiles = true
    form.require_valid_smiles = true
    form.remove_target_outliers = false
    form.iqr_multiplier = 1.5
  }

  async function fetchSavedDatasets() {
    const response = await listCleanedDatasets()
    savedDatasets.value = response.items
  }

  async function runPreview(silent = false) {
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

  function applyRecommendedAndRebuild() {
    applyStarterPreset('balanced')
    void runPreview()
  }

  const autoPreviewSignature = computed(() => JSON.stringify(form))

  function scheduleAutoPreview() {
    if (!autoPreviewReady.value) return
    if (autoPreviewTimer) clearTimeout(autoPreviewTimer)
    autoPreviewTimer = setTimeout(() => { void runPreview(true) }, 450)
  }

  watch(autoPreviewSignature, () => { scheduleAutoPreview() })

  let lastFocusRefreshAt = 0
  function refreshOnFocus() {
    if (!autoPreviewReady.value) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const now = Date.now()
    if (now - lastFocusRefreshAt < 1500) return
    lastFocusRefreshAt = now
    void runPreview(true)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnFocus)
  }

  onBeforeUnmount(() => {
    if (autoPreviewTimer) clearTimeout(autoPreviewTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnFocus)
    }
  })

  function buildSubsetCsv(subset: BuilderSubsetSummary | null) {
    if (!subset) return null
    return rowsToCsv(subset.rows, subset.columns)
  }

  function downloadSubsetFromCard(card: SubsetCard) {
    if (!card.summary) return
    const csv = rowsToCsv(card.summary.rows, card.summary.columns)
    const filename = `${bundleName.value || defaultBundleName()}-${card.summary.name.toLowerCase()}.csv`
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
  }

  async function saveSubsetCardToWorkspace(card: SubsetCard) {
    const subset = card.summary
    if (!subset) return
    subsetSavingKey.value = card.key
    errorMessage.value = ''
    statusMessage.value = ''

    try {
      const csv = rowsToCsv(subset.rows, subset.columns)
      const filename = `${bundleName.value || defaultBundleName()}-${subset.name.toLowerCase()}.csv`
      const file = new File([csv], filename, { type: 'text/csv;charset=utf-8;' })
      const response = await importCleanedDatasetCsv({
        file,
        name: `${bundleName.value || defaultBundleName()} ${subset.name}`,
        description: `${card.description} 来源:${selectedSourceMode.value}。`,
        targetColumn: subset.target_column,
      })
      lastSavedDatasetId.value = response.dataset.id
      statusMessage.value = `${subset.name} 已保存到工作区,数据集编号 #${response.dataset.id}。`
      await fetchSavedDatasets()
    } catch (error: any) {
      errorMessage.value = error?.response?.data?.detail || error?.message || `${subset.name} 保存失败。`
    } finally {
      subsetSavingKey.value = null
    }
  }

  async function exportSavedDataset(dataset: SavedCleanedDatasetSummary) {
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

  async function viewSavedDataset(dataset: SavedCleanedDatasetSummary) {
    if (selectedDatasetDetail.value?.id === dataset.id) {
      selectedDatasetDetail.value = null
      if (editingDatasetId.value === dataset.id) cancelDatasetEdit()
      return
    }
    detailLoadingId.value = dataset.id
    errorMessage.value = ''
    try {
      const response = await getCleanedDataset(dataset.id)
      selectedDatasetDetail.value = response.dataset
    } catch (error: any) {
      errorMessage.value = error?.response?.data?.detail || error?.message || '读取已保存数据集失败。'
    } finally {
      detailLoadingId.value = null
    }
  }

  function startDatasetEdit(dataset: SavedCleanedDatasetSummary) {
    editingDatasetId.value = dataset.id
    editDatasetName.value = dataset.name || ''
    editDatasetDescription.value = dataset.description || ''
  }

  function cancelDatasetEdit() {
    editingDatasetId.value = null
    editDatasetName.value = ''
    editDatasetDescription.value = ''
  }

  async function saveDatasetEdit(dataset: SavedCleanedDatasetSummary) {
    const nextName = editDatasetName.value.trim()
    if (!nextName) {
      errorMessage.value = '数据集名称不能为空。'
      return
    }
    savingDatasetId.value = dataset.id
    errorMessage.value = ''
    statusMessage.value = ''
    try {
      const response = await updateCleanedDataset(dataset.id, {
        name: nextName,
        description: editDatasetDescription.value.trim() || null,
      })
      savedDatasets.value = savedDatasets.value.map((item) => item.id === dataset.id ? response.dataset : item)
      if (selectedDatasetDetail.value?.id === dataset.id) {
        selectedDatasetDetail.value = response.dataset
      }
      statusMessage.value = `数据集 #${dataset.id} 已更新。`
      cancelDatasetEdit()
    } catch (error: any) {
      errorMessage.value = error?.response?.data?.detail || error?.message || '更新数据集失败。'
    } finally {
      savingDatasetId.value = null
    }
  }

  async function deleteSavedDataset(dataset: SavedCleanedDatasetSummary) {
    const confirmed = window.confirm(`确定删除数据集「${dataset.name}」吗？相关历史训练记录会保留，但不再关联这个数据集。`)
    if (!confirmed) return
    deletingDatasetId.value = dataset.id
    errorMessage.value = ''
    statusMessage.value = ''
    try {
      await deleteCleanedDataset(dataset.id)
      savedDatasets.value = savedDatasets.value.filter((item) => item.id !== dataset.id)
      if (selectedDatasetDetail.value?.id === dataset.id) selectedDatasetDetail.value = null
      if (editingDatasetId.value === dataset.id) cancelDatasetEdit()
      if (lastSavedDatasetId.value === dataset.id) lastSavedDatasetId.value = savedDatasets.value[0]?.id || null
      statusMessage.value = `数据集 #${dataset.id} 已删除。`
    } catch (error: any) {
      errorMessage.value = error?.response?.data?.detail || error?.message || '删除数据集失败。'
    } finally {
      deletingDatasetId.value = null
    }
  }

  return {
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
    subsetSavingKey,
    bundleName,
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
    rdkitStatusLabel,
    outlierLabel,
    activePresetKey,
    initialize,
    runPreview,
    applyStarterPreset,
    applyRecommendedAndRebuild,
    buildSubsetCsv,
    downloadSubsetFromCard,
    saveSubsetCardToWorkspace,
    exportSavedDataset,
    viewSavedDataset,
    startDatasetEdit,
    cancelDatasetEdit,
    saveDatasetEdit,
    deleteSavedDataset,
  }
}
