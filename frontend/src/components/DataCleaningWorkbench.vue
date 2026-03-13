<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AlertTriangle, ArrowRightLeft, Database, Download, RefreshCcw, Save, Sparkles, TableProperties, WandSparkles } from 'lucide-vue-next'
import {
  downloadCleanedDataset,
  listCleanedDatasets,
  previewModelCleaning,
  saveCleanedDataset,
  type ModelCleaningOptions,
  type ModelCleaningPreview,
  type ModelCleaningPreviewRow,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'

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

const repairRows = computed(() => {
  const repairs = preview.value?.summary.missing_value_repairs || {}
  return Object.entries(repairs)
    .map(([key, count]) => ({ key, count }))
    .filter((item) => item.count > 0)
})

const cleanedRows = computed(() => preview.value?.rows || [])
const previewRows = computed(() => preview.value?.preview_rows || [])
const normalizationRows = computed(() => preview.value?.normalization_preview || [])

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

function rowsToCsv(rows: ModelCleaningPreviewRow[]) {
  const fields = [
    'record_id',
    'literature_id',
    'material_name',
    'lubricant',
    'cof_value',
    'normalized_temperature_c',
    'normalized_speed_mps',
    'normalized_load_n',
    'normalized_potential_v',
    'normalized_water_content_ppm',
    'normalized_film_thickness_nm',
    'normalized_alkyl_chain_length',
    'cation_smiles',
    'anion_smiles',
    'confidence',
    'is_target_outlier',
    'repaired_fields',
  ] as const

  const lines = [
    fields.join(','),
    ...rows.map((row) => fields.map((field) => {
      const value = field === 'repaired_fields' ? row.repaired_fields.join('|') : row[field]
      return csvEscape(value)
    }).join(',')),
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

async function fetchSavedDatasets() {
  const response = await listCleanedDatasets()
  savedDatasets.value = response.items
}

async function runPreview() {
  previewLoading.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    preview.value = await previewModelCleaning({ ...form })
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
      cleaning_options: { ...form },
    })
    lastSavedDatasetId.value = response.dataset.id
    statusMessage.value = `Saved cleaned dataset #${response.dataset.id}. Open Training Page to use it immediately.`
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
  if (!cleanedRows.value.length) return
  const csv = rowsToCsv(cleanedRows.value)
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

onMounted(() => {
  void initialize()
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
          <p class="text-sm text-slate-500">Repair, normalize, filter, save, and export cleaned datasets.</p>
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
                <input v-model="form.iqr_multiplier" type="range" min="0.5" max="3.0" step="0.1" class="w-full accent-cyan-600" :disabled="!form.remove_target_outliers" />
              </div>
            </div>

            <div class="mt-4 space-y-3">
              <button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 text-sm font-semibold text-white shadow-lg shadow-cyan-200/80 transition hover:translate-y-[-1px] disabled:opacity-60" :disabled="previewLoading" @click="runPreview">
                <RefreshCcw class="h-4 w-4" />
                {{ previewLoading ? 'Refreshing Preview...' : 'Build Cleaning Preview' }}
              </button>
              <button class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60" :disabled="!cleanedRows.length" @click="handleExportPreview">
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
              <textarea v-model="datasetDescription" rows="3" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder="Optional notes about cleaning rules and intended training use." />
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
                    <p class="mt-1 text-xs text-slate-500">{{ dataset.row_count }} rows - {{ formatDateTime(dataset.created_at) }}</p>
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
          <div class="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 class="text-2xl font-bold tracking-tight">Cleaning Summary</h2>
              <p class="mt-2 text-sm text-slate-500">
                Active source: {{ preview.source_scope.label }}
                <span v-if="preview.source_scope.used_fallback"> - Group library fallback applied.</span>
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
                <p class="mt-2 text-2xl font-bold">{{ preview.summary.outliers_detected }}</p>
              </div>
            </div>
          </div>
        </section>

        <section v-if="preview" class="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <h3 class="text-lg font-bold">Missing Value Repair</h3>
            <p class="mt-2 text-sm text-slate-500">Counts of repaired numeric process fields after normalization.</p>
            <div v-if="repairRows.length === 0" class="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
              No repairs were needed with the current rules.
            </div>
            <div v-else class="mt-5 space-y-3">
              <div v-for="item in repairRows" :key="item.key" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-slate-800">{{ item.key }}</span>
                  <span class="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{{ item.count }}</span>
                </div>
              </div>
            </div>

            <div class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h4 class="text-sm font-semibold text-slate-800">Feature Coverage After Cleaning</h4>
              <div class="mt-3 space-y-3">
                <div v-for="feature in preview.feature_coverage" :key="feature.key">
                  <div class="mb-1 flex items-center justify-between text-xs">
                    <span class="font-medium text-slate-600">{{ feature.label }}</span>
                    <span class="text-slate-400">{{ feature.available_count }} - {{ formatCoverage(feature.coverage) }}</span>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div class="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" :style="{ width: `${Math.max(4, feature.coverage * 100)}%` }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
            <h3 class="text-lg font-bold">Unit Normalization Preview</h3>
            <p class="mt-2 text-sm text-slate-500">Raw experimental conditions aligned to model-friendly numeric units.</p>
            <div class="mt-5 overflow-x-auto">
              <table class="min-w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                    <th class="px-3 py-3 font-semibold">Record</th>
                    <th class="px-3 py-3 font-semibold">Temperature</th>
                    <th class="px-3 py-3 font-semibold">Speed</th>
                    <th class="px-3 py-3 font-semibold">Load</th>
                    <th class="px-3 py-3 font-semibold">Water</th>
                    <th class="px-3 py-3 font-semibold">Film</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in normalizationRows" :key="row.record_id" class="border-b border-slate-100 align-top">
                    <td class="px-3 py-3">
                      <div class="font-semibold text-slate-800">#{{ row.record_id }}</div>
                      <div class="text-xs text-slate-400">{{ row.lubricant }}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div>{{ row.temperature || '--' }}</div>
                      <div class="text-xs text-blue-600">{{ formatMetric(row.normalized_temperature_c, 3) }}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div>{{ row.speed_value || '--' }}</div>
                      <div class="text-xs text-blue-600">{{ formatMetric(row.normalized_speed_mps, 6) }}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div>{{ row.load_raw || '--' }}</div>
                      <div class="text-xs text-blue-600">{{ formatMetric(row.normalized_load_n, 6) }}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div>{{ row.water_content || '--' }}</div>
                      <div class="text-xs text-blue-600">{{ formatMetric(row.normalized_water_content_ppm, 2) }}</div>
                    </td>
                    <td class="px-3 py-3">
                      <div>{{ row.film_thickness || '--' }}</div>
                      <div class="text-xs text-blue-600">{{ formatMetric(row.normalized_film_thickness_nm, 2) }}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section v-if="preview" class="rounded-[30px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
          <h3 class="text-lg font-bold">Cleaned Dataset Table</h3>
          <p class="mt-2 text-sm text-slate-500">Preview of rows that can be saved and imported into the training page.</p>
          <div class="mt-5 overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <th class="px-3 py-3 font-semibold">Record</th>
                  <th class="px-3 py-3 font-semibold">Surface</th>
                  <th class="px-3 py-3 font-semibold">Lubricant</th>
                  <th class="px-3 py-3 font-semibold">COF</th>
                  <th class="px-3 py-3 font-semibold">Normalized Fields</th>
                  <th class="px-3 py-3 font-semibold">Flags</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in previewRows" :key="row.record_id" class="border-b border-slate-100 align-top">
                  <td class="px-3 py-3 font-semibold text-slate-800">#{{ row.record_id }}</td>
                  <td class="px-3 py-3">{{ row.material_name }}</td>
                  <td class="px-3 py-3">{{ row.lubricant }}</td>
                  <td class="px-3 py-3 font-semibold text-blue-700">{{ formatMetric(row.cof_value, 4) }}</td>
                  <td class="px-3 py-3 text-xs leading-6 text-slate-600">
                    T {{ formatMetric(row.normalized_temperature_c, 2) }} ·
                    v {{ formatMetric(row.normalized_speed_mps, 6) }} ·
                    F {{ formatMetric(row.normalized_load_n, 6) }} ·
                    H2O {{ formatMetric(row.normalized_water_content_ppm, 1) }}
                  </td>
                  <td class="px-3 py-3">
                    <div class="flex flex-wrap gap-2">
                      <span v-if="row.is_target_outlier" class="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Outlier</span>
                      <span v-for="flag in row.repaired_fields" :key="flag" class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{{ flag }}</span>
                      <span v-if="!row.is_target_outlier && row.repaired_fields.length === 0" class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Clean</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
