<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AlertTriangle,
  ArrowRightLeft,
  Database,
  Download,
  RefreshCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  WandSparkles,
} from 'lucide-vue-next'
import {
  downloadCleanedDataset,
  listCleanedDatasets,
  previewModelCleaning,
  saveCleanedDataset,
  type ModelCleaningMatrixRow,
  type ModelCleaningOptions,
  type ModelCleaningPreview,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'

const PROCESS_FEATURE_OPTIONS = [
  { key: 'temperature', label: 'Temperature', description: 'Keep normalized temperature in degrees Celsius.' },
  { key: 'speed', label: 'Speed', description: 'Keep sliding speed after unit conversion.' },
  { key: 'load', label: 'Load', description: 'Keep applied load converted to Newtons.' },
  { key: 'potential', label: 'Potential', description: 'Keep electrochemical potential values.' },
  { key: 'water_content', label: 'Water Content', description: 'Keep water content normalized to ppm.' },
  { key: 'film_thickness', label: 'Film Thickness', description: 'Keep normalized film thickness in nm.' },
  { key: 'alkyl_chain_length', label: 'Alkyl Chain Length', description: 'Keep resolved alkyl chain length metadata.' },
] as const

const DEFAULT_KEEP_FEATURES = PROCESS_FEATURE_OPTIONS.map((feature) => feature.key)

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
const saveLoading = ref(false)
const exportLoadingId = ref<number | null>(null)
const errorMessage = ref('')
const statusMessage = ref('')
const datasetName = ref('')
const datasetDescription = ref('')
const lastSavedDatasetId = ref<number | null>(null)
const autoPreviewReady = ref(false)

let autoPreviewTimer: ReturnType<typeof setTimeout> | null = null

const repairRows = computed(() => {
  const repairs = preview.value?.summary.missing_value_repairs || {}
  return Object.entries(repairs)
    .map(([key, count]) => ({ key, count }))
    .filter((item) => item.count > 0)
})

const cleanedRows = computed(() => preview.value?.rows || [])
const previewRows = computed(() => preview.value?.preview_rows || [])
const normalizationRows = computed(() => preview.value?.normalization_preview || [])
const explainedVariancePercent = computed(() => {
  const ratio = preview.value?.pca_info?.explained_variance_ratio
  return ratio == null || Number.isNaN(Number(ratio)) ? null : Math.round(Number(ratio) * 100)
})
const finalFeatureCount = computed(() => preview.value?.feature_columns.length || 0)
const normalizationColumns = computed(() => {
  const columns = preview.value?.matrix_columns || []
  const limit = preview.value?.pca_info?.enabled ? 8 : 6
  return columns.slice(0, Math.min(limit, columns.length))
})
const matrixPreviewColumns = computed(() => {
  const columns = preview.value?.matrix_columns || []
  const limit = preview.value?.pca_info?.enabled ? 12 : 10
  return columns.slice(0, Math.min(limit, columns.length))
})
const autoPreviewSignature = computed(() => JSON.stringify(buildOptionsPayload()))

function buildOptionsPayload(): ModelCleaningOptions {
  return {
    source_mode: form.source_mode,
    drop_missing_target: Boolean(form.drop_missing_target),
    require_dual_smiles: Boolean(form.require_dual_smiles),
    missing_value_strategy: form.missing_value_strategy,
    remove_target_outliers: Boolean(form.remove_target_outliers),
    iqr_multiplier: Number(form.iqr_multiplier),
    feature_config: {
      use_pca: Boolean(form.feature_config.use_pca),
      n_components: Number(form.feature_config.n_components),
      keep_features: [...form.feature_config.keep_features],
    },
  }
}

function formatMetric(value: number | null | undefined, digits: number = 4) {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return Number(value).toFixed(digits).replace(/\.?0+$/, '')
}

function formatCoverage(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}

function formatColumnLabel(column: string) {
  return column.replace(/_/g, ' ')
}

function defaultDatasetName() {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `Cleaned COF Dataset ${stamp}`
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function rowsToCsv(rows: ModelCleaningMatrixRow[], columns: string[]) {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ]
  return lines.join('\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function scheduleAutoPreview() {
  if (!autoPreviewReady.value) return
  if (autoPreviewTimer) {
    clearTimeout(autoPreviewTimer)
  }
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
  if (!silent) {
    statusMessage.value = ''
  }
  try {
    preview.value = await previewModelCleaning(buildOptionsPayload())
    if (!datasetName.value) {
      datasetName.value = defaultDatasetName()
    }
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || 'Failed to build cleaning preview.'
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

async function handleSaveDataset() {
  if (!preview.value) return
  saveLoading.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    const response = await saveCleanedDataset({
      name: datasetName.value || defaultDatasetName(),
      description: datasetDescription.value,
      target_key: 'cof',
      cleaning_options: buildOptionsPayload(),
    })
    lastSavedDatasetId.value = response.dataset.id
    statusMessage.value = `Saved cleaned dataset #${response.dataset.id}. Open Training Page to train on the matrix immediately.`
    await fetchSavedDatasets()
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || 'Failed to save cleaned dataset.'
  } finally {
    saveLoading.value = false
  }
}

function openTraining(datasetId: number | null = lastSavedDatasetId.value) {
  emit('open-training', datasetId)
}

function handleExportPreview() {
  if (!preview.value || !cleanedRows.value.length) return
  const csv = rowsToCsv(cleanedRows.value, preview.value.matrix_columns)
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'cleaned-preview.csv')
}

async function handleExportSaved(dataset: SavedCleanedDatasetSummary) {
  exportLoadingId.value = dataset.id
  try {
    const blob = await downloadCleanedDataset(dataset.id)
    triggerDownload(blob, `${dataset.name || `cleaned-dataset-${dataset.id}`}.csv`)
  } catch (error: any) {
    errorMessage.value = error?.message || 'Failed to export saved dataset.'
  } finally {
    exportLoadingId.value = null
  }
}

watch(autoPreviewSignature, () => {
  scheduleAutoPreview()
})

onMounted(() => {
  void initialize()
})

onBeforeUnmount(() => {
  if (autoPreviewTimer) {
    clearTimeout(autoPreviewTimer)
  }
})
</script>

<template>
  <div class="flex h-full bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.10),_transparent_35%),linear-gradient(180deg,_#f8fafc_0%,_#ecfeff_100%)] text-slate-900">
    <aside class="flex w-[360px] shrink-0 flex-col border-r border-slate-200/80 bg-white/85 px-6 py-6 backdrop-blur">
      <div class="mb-8 flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-500 text-white shadow-lg shadow-cyan-200/80">
          <Database class="h-5 w-5" />
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight">Data Cleaning Bridge</h1>
          <p class="text-sm text-slate-500">Repair, engineer, prune, and save ready-to-train matrices.</p>
        </div>
      </div>

      <div v-if="loading" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        Loading cleaning workspace...
      </div>

      <template v-else>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          <section class="rounded-[28px] border border-slate-200 bg-gradient-to-br from-cyan-50 to-sky-50 p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <WandSparkles class="h-4 w-4 text-cyan-700" />
              <h2 class="text-sm font-semibold text-slate-800">Cleaning Controls</h2>
            </div>

            <label class="mb-3 block">
              <span class="mb-2 block text-sm font-medium text-slate-600">Data Source</span>
              <select v-model="form.source_mode" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100">
                <option value="group_library_fallback">Current scope, fallback to group library</option>
                <option value="current_scope">Current scope only</option>
                <option value="group_library">Group library only</option>
              </select>
            </label>

            <div class="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
              <label class="flex items-start gap-3 text-sm text-slate-700">
                <input v-model="form.drop_missing_target" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                <span>Drop records without a numeric COF target</span>
              </label>
              <label class="flex items-start gap-3 text-sm text-slate-700">
                <input v-model="form.require_dual_smiles" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                <span>Require both cation and anion SMILES</span>
              </label>
            </div>

            <div class="mt-4 grid gap-3">
              <label class="block">
                <span class="mb-2 block text-sm font-medium text-slate-600">Missing Value Strategy</span>
                <select v-model="form.missing_value_strategy" class="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100">
                  <option value="median">Median repair</option>
                  <option value="zero">Zero fill</option>
                  <option value="keep">Keep missing values</option>
                </select>
              </label>

              <label class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                <input v-model="form.remove_target_outliers" type="checkbox" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                <span>Remove COF target outliers with IQR filtering</span>
              </label>

              <div>
                <div class="mb-2 flex items-center justify-between text-sm">
                  <label class="font-medium text-slate-600">IQR Multiplier</label>
                  <span class="font-semibold text-cyan-700">{{ form.iqr_multiplier.toFixed(1) }}</span>
                </div>
                <input v-model.number="form.iqr_multiplier" type="range" min="0.5" max="3.0" step="0.1" class="w-full accent-cyan-600" :disabled="!form.remove_target_outliers" />
              </div>
            </div>
          </section>

          <section class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <SlidersHorizontal class="h-4 w-4 text-blue-600" />
              <h2 class="text-sm font-semibold text-slate-800">Feature Engineering</h2>
            </div>

            <div class="space-y-4">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold text-slate-800">Molecular Features</p>
                    <p class="mt-1 text-xs leading-5 text-slate-500">Apply PCA to the concatenated 512-dimensional Morgan fingerprint block before saving the cleaned matrix.</p>
                  </div>
                  <label class="relative inline-flex cursor-pointer items-center">
                    <input v-model="form.feature_config.use_pca" type="checkbox" class="peer sr-only" />
                    <div class="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-cyan-500"></div>
                    <div class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition peer-checked:translate-x-5"></div>
                  </label>
                </div>

                <div v-if="form.feature_config.use_pca" class="mt-4 rounded-2xl border border-cyan-100 bg-white p-3">
                  <div class="mb-2 flex items-center justify-between text-sm">
                    <label class="font-medium text-slate-600">PCA Components</label>
                    <span class="font-semibold text-cyan-700">{{ form.feature_config.n_components }}</span>
                  </div>
                  <input v-model.number="form.feature_config.n_components" type="range" min="2" max="30" step="1" class="w-full accent-cyan-600" />
                  <p class="mt-2 text-xs text-slate-500">The preview will report how much fingerprint variance these components retain.</p>
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-semibold text-slate-800">Process Features</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">Unchecked process variables are dropped from the final matrix before the dataset is saved.</p>
                <div class="mt-4 grid gap-2">
                  <label v-for="feature in PROCESS_FEATURE_OPTIONS" :key="feature.key" class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                    <input v-model="form.feature_config.keep_features" type="checkbox" :value="feature.key" class="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
                    <div class="min-w-0">
                      <p class="font-semibold text-slate-800">{{ feature.label }}</p>
                      <p class="mt-1 text-xs leading-5 text-slate-500">{{ feature.description }}</p>
                    </div>
                  </label>
                </div>
                <p class="mt-3 text-xs text-slate-500">{{ form.feature_config.keep_features.length }} process features will be kept in the cleaned matrix.</p>
              </div>
            </div>

            <div class="mt-4 space-y-3">
              <button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 text-sm font-semibold text-white shadow-lg shadow-cyan-200/80 transition hover:translate-y-[-1px] disabled:opacity-60" :disabled="previewLoading" @click="runPreview()">
                <RefreshCcw class="h-4 w-4" />
                {{ previewLoading ? 'Refreshing Preview...' : 'Build Cleaning Preview' }}
              </button>
              <button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" :disabled="!preview?.rows.length" @click="handleExportPreview">
                <Download class="h-4 w-4" />
                Export Preview CSV
              </button>
            </div>
          </section>

          <section class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <Save class="h-4 w-4 text-blue-600" />
              <h2 class="text-sm font-semibold text-slate-800">Save Cleaned Dataset</h2>
            </div>
            <label class="mb-3 block">
              <span class="mb-2 block text-sm font-medium text-slate-600">Dataset Name</span>
              <input v-model="datasetName" type="text" class="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="Cleaned COF Dataset" />
            </label>
            <label class="block">
              <span class="mb-2 block text-sm font-medium text-slate-600">Description</span>
              <textarea v-model="datasetDescription" rows="3" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="Optional notes about feature pruning, PCA, and intended training use." />
            </label>
            <button class="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" :disabled="saveLoading || !preview" @click="handleSaveDataset">
              <Save class="h-4 w-4" />
              {{ saveLoading ? 'Saving Dataset...' : 'Save Cleaned Dataset' }}
            </button>
            <button class="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="openTraining()">
              <ArrowRightLeft class="h-4 w-4" />
              Open Training Page
            </button>
          </section>

          <section class="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div class="mb-4 flex items-center gap-2">
              <TableProperties class="h-4 w-4 text-amber-500" />
              <h2 class="text-sm font-semibold text-slate-800">Saved Cleaned Datasets</h2>
            </div>
            <div v-if="savedDatasets.length === 0" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">
              No cleaned datasets saved in this scope yet.
            </div>
            <div v-else class="space-y-3">
              <div v-for="dataset in savedDatasets" :key="dataset.id" class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-semibold text-slate-800">{{ dataset.name }}</p>
                    <p class="mt-1 text-xs text-slate-500">
                      {{ dataset.row_count }} rows · {{ dataset.feature_columns.length }} features · {{ formatDateTime(dataset.created_at) }}
                    </p>
                    <p v-if="dataset.pca_info?.enabled && dataset.pca_info.explained_variance_ratio != null" class="mt-1 text-[11px] font-semibold text-cyan-700">
                      PCA variance retained: {{ Math.round(dataset.pca_info.explained_variance_ratio * 100) }}%
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50" @click="openTraining(dataset.id)">
                      Train
                    </button>
                    <button class="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60" :disabled="exportLoadingId === dataset.id" @click="handleExportSaved(dataset)">
                      {{ exportLoadingId === dataset.id ? '...' : 'Export' }}
                    </button>
                  </div>
                </div>
                <p v-if="dataset.description" class="mt-2 text-xs leading-5 text-slate-500">{{ dataset.description }}</p>
              </div>
            </div>
          </section>
        </div>
      </template>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto px-8 py-8">
      <div class="mx-auto max-w-[1240px] space-y-6">
        <section v-if="errorMessage" class="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">
          <div class="flex items-center gap-2 font-semibold">
            <AlertTriangle class="h-4 w-4" />
            {{ errorMessage }}
          </div>
        </section>

        <section v-if="statusMessage" class="rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-sm text-emerald-700">
          <div class="flex items-center gap-2 font-semibold">
            <Sparkles class="h-4 w-4" />
            {{ statusMessage }}
          </div>
        </section>

        <section v-if="preview" class="rounded-[30px] border border-slate-200/80 bg-white/90 px-8 py-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div class="flex flex-wrap items-center gap-3">
                <h2 class="text-2xl font-bold tracking-tight">Cleaning Summary</h2>
                <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{{ finalFeatureCount }} final features</span>
                <span v-if="preview.pca_info?.enabled && explainedVariancePercent != null" class="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">
                  PCA Explained Variance: {{ explainedVariancePercent }}%
                </span>
                <span v-else class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">PCA disabled</span>
              </div>
              <p class="mt-2 text-sm text-slate-500">
                Active source: {{ preview.source_scope.label }}
                <span v-if="preview.source_scope.used_fallback"> · Group library fallback applied.</span>
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Raw</p>
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.raw_records }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Target Ready</p>
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.target_ready_records }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">SMILES Ready</p>
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.chemistry_ready_records }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Training Ready</p>
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.training_ready_records }}</p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Outliers</p>
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.outliers_detected || 0 }}</p>
              </div>
            </div>
          </div>
        </section>

        <section v-if="preview" class="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <h3 class="text-lg font-bold">Missing Value Repair</h3>
            <p class="mt-2 text-sm text-slate-500">Counts of repaired process fields that remain in the final matrix.</p>
            <div v-if="repairRows.length === 0" class="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
              No repairs were needed with the current rules.
            </div>
            <div v-else class="mt-5 space-y-3">
              <div v-for="item in repairRows" :key="item.key" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-slate-800">{{ formatColumnLabel(item.key) }}</span>
                  <span class="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{{ item.count }}</span>
                </div>
              </div>
            </div>

            <div class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h4 class="text-sm font-semibold text-slate-800">Feature Coverage After Cleaning</h4>
                <span class="text-xs text-slate-400">{{ preview.summary.training_ready_records }} cleaned rows</span>
              </div>
              <div class="mt-3 space-y-3">
                <div v-for="feature in preview.feature_coverage" :key="feature.key">
                  <div class="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span class="font-medium text-slate-600">{{ feature.label }}</span>
                    <span class="text-right text-slate-400">{{ feature.available_count }} / {{ preview.summary.training_ready_records }} · {{ formatCoverage(feature.coverage) }}</span>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" :style="{ width: `${Math.max(4, feature.coverage * 100)}%` }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-lg font-bold">Unit Normalization Preview</h3>
                <p class="mt-2 text-sm text-slate-500">Preview the final cleaned matrix shape after feature pruning and optional PCA.</p>
              </div>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                Showing {{ normalizationColumns.length }} of {{ preview.matrix_columns.length }} columns
              </span>
            </div>
            <div class="mt-5 overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                    <th class="px-3 py-3 font-semibold">Row</th>
                    <th v-for="column in normalizationColumns" :key="column" class="px-3 py-3 font-semibold">{{ formatColumnLabel(column) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in normalizationRows" :key="rowIndex" class="border-b border-slate-100 align-top">
                    <td class="px-3 py-3 font-semibold text-slate-800">#{{ rowIndex + 1 }}</td>
                    <td v-for="column in normalizationColumns" :key="column" class="px-3 py-3 text-slate-700">
                      {{ formatMetric(row[column], column.startsWith('PCA_') ? 5 : 4) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section v-if="preview" class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-bold">Ready-to-Train Matrix Preview</h3>
              <p class="mt-2 text-sm text-slate-500">Every saved row is numeric only: target plus retained process columns and molecular features.</p>
            </div>
            <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
              Target: {{ formatColumnLabel(preview.target_column) }}
            </span>
          </div>
          <div class="mt-5 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <th class="px-3 py-3 font-semibold">Row</th>
                  <th v-for="column in matrixPreviewColumns" :key="column" class="px-3 py-3 font-semibold">{{ formatColumnLabel(column) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in previewRows" :key="rowIndex" class="border-b border-slate-100 align-top">
                  <td class="px-3 py-3 font-semibold text-slate-800">#{{ rowIndex + 1 }}</td>
                  <td v-for="column in matrixPreviewColumns" :key="column" class="px-3 py-3 text-slate-700">
                    {{ formatMetric(row[column], column.startsWith('PCA_') ? 5 : 4) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="preview.matrix_columns.length > matrixPreviewColumns.length" class="mt-3 text-xs text-slate-400">
            Showing the first {{ matrixPreviewColumns.length }} columns. The saved CSV and database matrix contain all {{ preview.matrix_columns.length }} columns.
          </p>
        </section>
      </div>
    </main>
  </div>
</template>
