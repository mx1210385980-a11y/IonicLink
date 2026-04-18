<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Database, Download, ExternalLink, FlaskConical, Search, Sparkles } from 'lucide-vue-next'

import type { BatchFile, TribologyData } from '@/lib/api'

const props = defineProps<{
  currentSection: string
  selectedFile: BatchFile | null
  selectedFileName: string
  externalExportRequest?: { id: number, format: 'json' | 'csv' | 'ndjson' } | null
}>()

const emit = defineEmits<{
  openReview: []
}>()

const query = ref('')
const ionicLiquidFilter = ref('all')
const geometryFilter = ref('all')

const allRecords = computed(() => {
  const records = props.selectedFile?.records || []
  return records.filter((record) => record.system_name || record.D_total != null || record.D_cation != null || record.D_anion != null)
})

const ionicLiquidOptions = computed(() => {
  return ['all', ...new Set(allRecords.value.map((record) => String(record.ionic_liquid || '').trim()).filter(Boolean))].slice(0, 40)
})

const geometryOptions = computed(() => {
  return ['all', ...new Set(allRecords.value.map((record) => String(record.confinement_geometry_class || '').trim()).filter(Boolean))].slice(0, 30)
})

const filteredRecords = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  return allRecords.value.filter((record) => {
    if (ionicLiquidFilter.value !== 'all' && String(record.ionic_liquid || '').trim() !== ionicLiquidFilter.value) return false
    if (geometryFilter.value !== 'all' && String(record.confinement_geometry_class || '').trim() !== geometryFilter.value) return false
    if (!normalizedQuery) return true
    const haystack = [
      record.system_name,
      record.ionic_liquid,
      record.confinement_material_class,
      record.confinement_geometry_class,
      record.surface_functional_groups,
      record.source,
    ].map((item) => String(item || '').toLowerCase()).join(' ')
    return haystack.includes(normalizedQuery)
  })
})

const qualityIssueCount = computed(() => filteredRecords.value.filter((record) => {
  const missingCore = !String(record.system_name || '').trim()
    || !String(record.ionic_liquid || '').trim()
    || !hasDiffusionCoefficient(record)
  const missingEvidence = !record.source_page && !String(record.evidence || record.source || '').trim()
  return missingCore || missingEvidence
}).length)

const featureReadyCount = computed(() => filteredRecords.value.filter((record) => {
  return Boolean(String(record.smiles || '').trim()) && Object.keys(record.rdkit_features_json || {}).length > 0
}).length)

const exportRows = computed(() => filteredRecords.value.map((record) => ({
  id: record.id,
  system_name: record.system_name || '',
  ionic_liquid: record.ionic_liquid || '',
  confinement_material_class: record.confinement_material_class || '',
  confinement_geometry_class: record.confinement_geometry_class || '',
  surface_functional_groups: record.surface_functional_groups || '',
  confinement_dimensionality: record.confinement_dimensionality || '',
  D_total: record.D_total ?? null,
  D_cation: record.D_cation ?? null,
  D_anion: record.D_anion ?? null,
  D_unit: record.D_unit || '',
  temperature_value: record.temperature_value ?? null,
  confinement_scale_value: record.confinement_scale_value ?? null,
  confinement_scale_unit: record.confinement_scale_unit || '',
  source: record.source || '',
  source_page: record.source_page ?? null,
  evidence: record.evidence || '',
  smiles: record.smiles || '',
  rdkit_feature_count: Object.keys(record.rdkit_features_json || {}).length,
  novel_feature_count: Object.keys(record.novel_features_json || {}).length,
  review_status: record.review_status || '',
})))

watch(
  () => props.externalExportRequest?.id,
  () => {
    if (!props.externalExportRequest) return
    exportData(props.externalExportRequest.format)
  },
)

function hasDiffusionCoefficient(record: TribologyData) {
  return [record.D_total, record.D_cation, record.D_anion].some((value) => value !== null && value !== undefined)
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--'
  return `${Number(value).toPrecision(4)}`.replace(/\.?0+e/, 'e').replace(/\.?0+$/, '')
}

function formatConditions(record: TribologyData) {
  const parts = [
    record.temperature_value != null ? `T ${formatNumber(record.temperature_value)}` : '',
    record.confinement_scale_value != null
      ? `Scale ${formatNumber(record.confinement_scale_value)}${record.confinement_scale_unit ? ` ${record.confinement_scale_unit}` : ''}`
      : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : '--'
}

function qualityNote(record: TribologyData) {
  const notes: string[] = []
  if (!String(record.system_name || '').trim()) notes.push('missing system')
  if (!String(record.ionic_liquid || '').trim()) notes.push('missing ionic liquid')
  if (!hasDiffusionCoefficient(record)) notes.push('missing D value')
  if (!record.source_page && !String(record.evidence || record.source || '').trim()) notes.push('missing evidence')
  return notes.length ? notes.join(', ') : 'ready'
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0] || {})
  const escapeCell = (value: unknown) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`
    }
    return text
  }
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n')
}

function exportData(format: 'json' | 'csv' | 'ndjson') {
  const baseName = (props.selectedFileName || 'diffusion-dataset').replace(/\.[^.]+$/, '')
  if (format === 'json') {
    triggerDownload(`${baseName}.diffusion.json`, JSON.stringify(exportRows.value, null, 2), 'application/json')
    return
  }
  if (format === 'ndjson') {
    triggerDownload(
      `${baseName}.diffusion.ndjson`,
      exportRows.value.map((row) => JSON.stringify(row)).join('\n'),
      'application/x-ndjson',
    )
    return
  }
  triggerDownload(`${baseName}.diffusion.csv`, toCsv(exportRows.value), 'text/csv;charset=utf-8')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white">
    <div class="border-b border-slate-100 px-5 py-4">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8ca0ba]">Diffusion Knowledge</p>
          <h2 class="mt-2 text-[1.15rem] font-semibold tracking-[-0.04em] text-slate-950">
            {{ selectedFileName || 'Diffusion Dataset' }}
          </h2>
          <p class="mt-2 text-sm text-slate-500">
            {{ filteredRecords.length }} records visible. {{ featureReadyCount }} feature-ready. {{ qualityIssueCount }} quality issues.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-[0.9rem] border border-[#d9e2ef] bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f8fbff]"
            @click="emit('openReview')"
          >
            <ExternalLink class="h-4 w-4" />
            Open Review
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-[0.9rem] bg-[#101b29] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#1f2937]"
            @click="exportData('csv')"
          >
            <Download class="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-4">
        <div class="rounded-[1rem] border border-[#edf2f7] bg-[#fafcff] px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ca0ba]">
            <Database class="h-4 w-4" />
            Visible
          </div>
          <p class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{{ filteredRecords.length }}</p>
        </div>
        <div class="rounded-[1rem] border border-[#edf2f7] bg-[#fafcff] px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ca0ba]">
            <Sparkles class="h-4 w-4" />
            Quality
          </div>
          <p class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{{ qualityIssueCount }}</p>
        </div>
        <div class="rounded-[1rem] border border-[#edf2f7] bg-[#fafcff] px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ca0ba]">
            <FlaskConical class="h-4 w-4" />
            Feature Ready
          </div>
          <p class="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{{ featureReadyCount }}</p>
        </div>
        <div class="rounded-[1rem] border border-[#edf2f7] bg-[#fafcff] px-4 py-3">
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ca0ba]">
            <Download class="h-4 w-4" />
            Export
          </div>
          <p class="mt-2 text-sm font-medium text-slate-700">JSON / CSV / NDJSON</p>
        </div>
      </div>

      <div class="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
        <label class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model="query"
            type="text"
            class="h-11 w-full rounded-[0.95rem] border border-[#d9e2ef] bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#b7c6ef]"
            placeholder="Search system, ionic liquid, confinement..."
          >
        </label>
        <select v-model="ionicLiquidFilter" class="h-11 rounded-[0.95rem] border border-[#d9e2ef] bg-white px-3 text-sm text-slate-700 outline-none">
          <option value="all">All ionic liquids</option>
          <option v-for="item in ionicLiquidOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="geometryFilter" class="h-11 rounded-[0.95rem] border border-[#d9e2ef] bg-white px-3 text-sm text-slate-700 outline-none">
          <option value="all">All geometries</option>
          <option v-for="item in geometryOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
      <div v-if="filteredRecords.length" class="overflow-hidden rounded-[1.2rem] border border-[#e5ebf4]">
        <table class="min-w-full divide-y divide-[#e9eef5] text-left text-sm">
          <thead class="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8ca0ba]">
            <tr>
              <th class="px-4 py-3">System</th>
              <th class="px-4 py-3">Ionic Liquid</th>
              <th class="px-4 py-3">D_total</th>
              <th class="px-4 py-3">D_cation</th>
              <th class="px-4 py-3">D_anion</th>
              <th class="px-4 py-3">Conditions</th>
              <th class="px-4 py-3">Evidence</th>
              <th class="px-4 py-3">Features</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#eef2f7] bg-white">
            <tr v-for="record in filteredRecords" :key="record.id || `${record.system_name}-${record.ionic_liquid}`" class="align-top">
              <td class="px-4 py-3">
                <p class="font-semibold text-slate-900">{{ record.system_name || '--' }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ record.confinement_material_class || '--' }} / {{ record.confinement_geometry_class || '--' }}</p>
              </td>
              <td class="px-4 py-3 text-slate-700">
                <p>{{ record.ionic_liquid || '--' }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ record.surface_functional_groups || record.confinement_dimensionality || '--' }}</p>
              </td>
              <td class="px-4 py-3 font-mono text-slate-700">{{ formatNumber(record.D_total) }}</td>
              <td class="px-4 py-3 font-mono text-slate-700">{{ formatNumber(record.D_cation) }}</td>
              <td class="px-4 py-3 font-mono text-slate-700">{{ formatNumber(record.D_anion) }}</td>
              <td class="px-4 py-3 text-slate-700">{{ formatConditions(record) }}</td>
              <td class="px-4 py-3">
                <p class="text-slate-700">{{ record.source_page ? `Page ${record.source_page}` : '--' }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ record.source || qualityNote(record) }}</p>
              </td>
              <td class="px-4 py-3">
                <p class="text-slate-700">{{ Object.keys(record.rdkit_features_json || {}).length }} RDKit</p>
                <p class="mt-1 text-xs text-slate-500">{{ Object.keys(record.novel_features_json || {}).length }} novel</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-else
        class="flex h-full min-h-[18rem] items-center justify-center rounded-[1.2rem] border border-dashed border-black/10 bg-white/55 px-6 text-center text-sm text-slate-500"
      >
        No diffusion records are available for the current selection.
      </div>
    </div>
  </div>
</template>
