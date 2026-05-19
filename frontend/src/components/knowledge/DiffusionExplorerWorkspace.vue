<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDownUp,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Search,
  Sigma,
} from 'lucide-vue-next'

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

type DiffusionRow = {
  record: TribologyData
  recordNo: string
  materialSystem: string
  sideChain: string
  waterUptake: string
  diffusingSpecies: string
  dAngstrom: string
  dMetric: string
  dataType: string
  method: string
  note: string
  coefficient: number | null
  source: string
}

type IonMappingRow = {
  system: string
  cation: string
  anion: string
  diffusingIon: string
}

const query = ref('')
const speciesFilter = ref('all')
const sourceFilter = ref('all')

const selectedTitle = computed(() => {
  return props.selectedFile?.metadata?.title || props.selectedFileName || props.selectedFile?.name || 'Diffusion Dataset'
})

const allRecords = computed(() => {
  const records = props.selectedFile?.records || []
  return records.filter((record) => record.system_name || record.D_total != null || record.D_cation != null || record.D_anion != null)
})

const tableRows = computed<DiffusionRow[]>(() => {
  return allRecords.value
    .map(toDiffusionRow)
    .sort((left, right) => {
      const leftValue = left.coefficient ?? Number.POSITIVE_INFINITY
      const rightValue = right.coefficient ?? Number.POSITIVE_INFINITY
      if (leftValue !== rightValue) return leftValue - rightValue
      return left.materialSystem.localeCompare(right.materialSystem)
    })
    .map((row, index) => ({
      ...row,
      recordNo: `D-${String(index + 1).padStart(2, '0')}`,
    }))
})

const speciesOptions = computed(() => {
  return ['all', ...new Set(tableRows.value.map((row) => row.diffusingSpecies).filter(Boolean))]
})

const sourceOptions = computed(() => {
  return ['all', ...new Set(tableRows.value.map((row) => row.source).filter((value) => value && value !== '--'))]
})

const filteredRows = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  return tableRows.value.filter((row) => {
    if (speciesFilter.value !== 'all' && row.diffusingSpecies !== speciesFilter.value) return false
    if (sourceFilter.value !== 'all' && row.source !== sourceFilter.value) return false
    if (!normalizedQuery) return true
    const haystack = [
      row.recordNo,
      row.materialSystem,
      row.sideChain,
      row.waterUptake,
      row.diffusingSpecies,
      row.dAngstrom,
      row.dMetric,
      row.dataType,
      row.method,
      row.note,
      row.record.evidence,
    ].join(' ').toLowerCase()
    return haystack.includes(normalizedQuery)
  })
})

const trendRows = computed(() => {
  return [...tableRows.value]
    .filter((row) => row.coefficient != null)
    .sort((left, right) => Number(right.coefficient || 0) - Number(left.coefficient || 0))
})

const trendStatement = computed(() => {
  if (trendRows.value.length < 2) return '扩散趋势需要至少两条记录才能比较。'
  return trendRows.value.map((row) => baseSystemName(row.record)).join(' > ')
})

const mechanismStatement = computed(() => {
  const systems = tableRows.value.map((row) => baseSystemName(row.record).toLowerCase())
  if (systems.some((name) => name.includes('mpil'))) {
    return '侧链由 octyl 缩短至 ethyl 时，水吸收率和水相连通性提高，Cl− 迁移更容易；长烷基链会使水通道局域化，扩散受限。'
  }
  const species = dominantSpecies.value
  return `${species} 的扩散差异主要由限域材料、孔道几何、温度和相互作用位点共同决定。`
})

const dominantSpecies = computed(() => {
  const counts = new Map<string, number>()
  tableRows.value.forEach((row) => {
    counts.set(row.diffusingSpecies, (counts.get(row.diffusingSpecies) || 0) + 1)
  })
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 'Diffusing species'
})

const qualityIssueCount = computed(() => tableRows.value.filter((row) => {
  const record = row.record
  return !record.system_name || !record.ionic_liquid || !hasDiffusionCoefficient(record) || row.source === '--'
}).length)

const sourceSummary = computed(() => {
  const sources = sourceOptions.value.filter((source) => source !== 'all')
  return sources.length ? sources.slice(0, 3).join(' / ') : '--'
})

const ionMappingRows = computed<IonMappingRow[]>(() => {
  return tableRows.value.map((row) => ({
    system: baseSystemName(row.record),
    cation: inferCation(row.record),
    anion: inferAnion(row.record),
    diffusingIon: row.diffusingSpecies,
  }))
})

const exportRows = computed(() => filteredRows.value.map((row) => ({
  record_no: row.recordNo,
  system: row.materialSystem,
  side_chain: row.sideChain,
  water_uptake: row.waterUptake,
  diffusing_species: row.diffusingSpecies,
  D_A2_ps: row.dAngstrom,
  D_m2_s: row.dMetric,
  data_type: row.dataType,
  method_conditions: row.method,
  note: row.note,
  source: row.source,
  source_page: row.record.source_page ?? null,
  evidence: row.record.evidence || '',
  review_status: row.record.review_status || '',
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

function primaryCoefficient(record: TribologyData) {
  const value = record.D_total ?? record.D_anion ?? record.D_cation
  return value == null || Number.isNaN(Number(value)) ? null : Number(value)
}

function readFeatureObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function baseSystemName(record: TribologyData) {
  return String(record.system_name || record.ionic_liquid || '--').trim() || '--'
}

function materialSystemLabel(record: TribologyData) {
  const base = baseSystemName(record)
  const material = String(record.confinement_material_class || '').trim()
  if (/mpil/i.test(base)) return `${base} 水合膜`
  return material && !base.toLowerCase().includes(material.toLowerCase()) ? `${base} / ${material}` : base
}

function inferSideChain(record: TribologyData) {
  const text = `${record.system_name || ''} ${record.ionic_liquid || ''}`.toLowerCase()
  if (text.includes('ethyl')) return '-C₂H₅'
  if (text.includes('butyl')) return '-C₄H₉'
  if (text.includes('octyl')) return '-C₈H₁₇'
  if (text.includes('hexyl')) return '-C₆H₁₃'
  const match = text.match(/c(\d{1,2})/)
  return match?.[1] ? `-C${toSubscript(match[1])}` : '--'
}

function waterUptake(record: TribologyData) {
  const features = readFeatureObject(record.novel_features_json)
  const value = features.water_uptake_value ?? features.waterUptakeValue ?? features.water_uptake ?? features.waterUptake
  const unit = String(features.water_uptake_unit ?? features.waterUptakeUnit ?? 'wt%').replace(/\s+/g, ' ').trim()
  if (value != null && value !== '') return `${formatPlainNumber(Number(value))} ${unit}`
  const match = String(record.evidence || '').match(/water\s+uptake[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(wt\s*%|%)/i)
  return match?.[1] && match?.[2] ? `${match[1]} ${match[2].replace(/\s+/g, '')}` : '--'
}

function inferDiffusingSpecies(record: TribologyData) {
  const text = `${record.evidence || ''} ${record.ionic_liquid || ''} ${record.system_name || ''}`
  if (record.D_anion != null && record.D_cation == null) {
    if (/cl[−-]?/i.test(text)) return 'Cl−'
    if (/bf\s*4|bf4/i.test(text)) return 'BF₄−'
    return 'anion'
  }
  if (record.D_cation != null && record.D_anion == null) return 'cation'
  if (record.D_cation != null && record.D_anion != null) return 'cation / anion'
  return 'overall'
}

function inferCation(record: TribologyData) {
  const name = `${record.system_name || ''} ${record.ionic_liquid || ''}`.toLowerCase()
  if (name.includes('octyl')) return 'phosphonium, trioctyl-substituted'
  if (name.includes('butyl')) return 'phosphonium, tributyl-substituted'
  if (name.includes('ethyl')) return 'phosphonium, triethyl-substituted'
  const bracket = String(record.ionic_liquid || '').match(/\[([^\]]+)\]/)
  return bracket ? `${bracket[1]}+` : '--'
}

function inferAnion(record: TribologyData) {
  const text = `${record.evidence || ''} ${record.ionic_liquid || ''}`.toLowerCase()
  const system = `${record.system_name || ''} ${record.ionic_liquid || ''}`.toLowerCase()
  if (system.includes('mpil')) return 'BF₄−'
  if (/bf\s*4|bf4/.test(text)) return 'BF₄−'
  if (/tfsi|ntf2/.test(text)) return 'TFSI−'
  const brackets = [...String(record.ionic_liquid || '').matchAll(/\[([^\]]+)\]/g)]
  return brackets[1]?.[1] ? `${brackets[1][1]}−` : '--'
}

function dataType(record: TribologyData) {
  const text = `${record.evidence || ''} ${record.source || ''}`.toLowerCase()
  if (/msd|einstein|molecular dynamics|\bmd\b|å²|a2|ps/.test(text)) return 'MD 计算值'
  if (/table|reported|experiment/.test(text)) return '文献报道值'
  return '结构化记录'
}

function methodConditions(record: TribologyData) {
  const method = /msd|einstein|å²|ps/i.test(String(record.evidence || '')) ? 'MSD-Einstein' : dataType(record)
  const parts = [
    method,
    record.temperature_value != null ? `${formatPlainNumber(Number(record.temperature_value))} K` : '',
    /20\s*ns/i.test(String(record.evidence || '')) ? '20 ns production MD' : '',
    /n\s*=\s*3|replicas/i.test(String(record.evidence || '')) ? 'n = 3 replicas' : '',
  ].filter(Boolean)
  return parts.join('; ') || '--'
}

function rowNote(record: TribologyData, coefficient: number | null) {
  const name = baseSystemName(record).toLowerCase()
  if (name.includes('octyl')) return '最低扩散系数；长烷基链限制水通道形成，离子迁移受限'
  if (name.includes('ethyl')) return '最高扩散系数；短侧链促进连续水相通道和 Cl− 迁移'
  if (name.includes('butyl')) return '中等扩散能力；介于 ethyl 与 octyl 之间'
  if (coefficient == null) return '缺少可比较的扩散系数'
  return record.confinement_geometry_class || record.confinement_material_class || '--'
}

function parseEvidenceScientific(record: TribologyData) {
  const evidence = String(record.evidence || '').replace(/−/g, '-')
  const match = evidence.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:±|\+\/-)\s*(\d+(?:\.\d+)?)\s*\)?\s*(?:×|x)\s*10\s*\^?\s*(-?\d+)/i)
  if (!match) return null
  const coefficientText = match[1] || ''
  const uncertaintyText = match[2] || ''
  return {
    coefficient: Number(coefficientText),
    uncertainty: Number(uncertaintyText),
    coefficientText,
    uncertaintyText,
    exponent: Number(match[3]),
  }
}

function diffusionDisplays(record: TribologyData) {
  const parsed = parseEvidenceScientific(record)
  if (parsed) {
    return {
      coefficientA2Ps: parsed.coefficient * Math.pow(10, parsed.exponent),
      angstrom: `(${parsed.coefficientText} ± ${parsed.uncertaintyText}) × 10${toSuperscriptInt(parsed.exponent)}`,
      metric: `(${parsed.coefficientText} ± ${parsed.uncertaintyText}) × 10${toSuperscriptInt(parsed.exponent - 8)}`,
    }
  }

  const value = primaryCoefficient(record)
  if (value == null) {
    return {
      coefficientA2Ps: null,
      angstrom: '--',
      metric: '--',
    }
  }

  const unit = String(record.D_unit || '').toLowerCase()
  const metricValue = unit.includes('10') && unit.includes('12') ? value * 1e-12 : value
  const a2PsValue = metricValue / 1e-8
  return {
    coefficientA2Ps: a2PsValue,
    angstrom: formatScientificValue(a2PsValue),
    metric: formatScientificValue(metricValue),
  }
}

function toDiffusionRow(record: TribologyData): DiffusionRow {
  const displays = diffusionDisplays(record)
  const source = record.source ? String(record.source) : record.source_page ? `Page ${record.source_page}` : '--'
  return {
    record,
    recordNo: 'D-00',
    materialSystem: materialSystemLabel(record),
    sideChain: inferSideChain(record),
    waterUptake: waterUptake(record),
    diffusingSpecies: inferDiffusingSpecies(record),
    dAngstrom: displays.angstrom,
    dMetric: displays.metric,
    dataType: dataType(record),
    method: methodConditions(record),
    note: rowNote(record, displays.coefficientA2Ps),
    coefficient: displays.coefficientA2Ps,
    source,
  }
}

function toSubscript(value: string) {
  const map: Record<string, string> = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
  }
  return String(value).replace(/[0-9]/g, (digit) => map[digit] || digit)
}

function toSuperscriptInt(value: number) {
  const map: Record<string, string> = {
    '-': '⁻',
    '+': '⁺',
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
  }
  return String(value).replace(/[+\-0-9]/g, (char) => map[char] || char)
}

function formatPlainNumber(value: number) {
  if (!Number.isFinite(value)) return '--'
  if (Math.abs(value) >= 100) return Number.isInteger(value) ? String(value) : value.toPrecision(4).replace(/(\.\d*?[1-9])0+$/, '$1')
  return value.toPrecision(3).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function formatScientificValue(value: number) {
  if (!Number.isFinite(value) || value === 0) return '--'
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  const coefficient = value / Math.pow(10, exponent)
  return `${formatPlainNumber(coefficient)} × 10${toSuperscriptInt(exponent)}`
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
  const baseName = selectedTitle.value.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'diffusion-dataset'
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
  <div class="flex h-full min-h-0 flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <header class="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700 dark:text-cyan-300">Diffusion Knowledge</p>
          <h2 class="mt-1 truncate text-[1.08rem] font-semibold tracking-normal text-slate-950 dark:text-white">
            {{ selectedTitle }}
          </h2>
          <p class="mt-1 max-w-5xl text-[12px] leading-5 text-slate-500 dark:text-slate-400">
            当前可结构化记录 {{ tableRows.length }} 条；主要扩散物种 {{ dominantSpecies }}；证据来源 {{ sourceSummary }}。
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="emit('openReview')"
          >
            <ExternalLink class="h-3.5 w-3.5" />
            Open Review
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-[12px] font-semibold text-white transition hover:bg-slate-800 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300"
            @click="exportData('csv')"
          >
            <Download class="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <div class="mt-3 grid gap-2 md:grid-cols-4">
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Database class="h-3.5 w-3.5" />
            Records
          </div>
          <p class="mt-1 text-xl font-semibold tabular-nums">{{ filteredRows.length }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Sigma class="h-3.5 w-3.5" />
            Trend
          </div>
          <p class="mt-1 truncate text-sm font-semibold">{{ trendStatement }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <CheckCircle2 class="h-3.5 w-3.5" />
            Review Flags
          </div>
          <p class="mt-1 text-xl font-semibold tabular-nums">{{ qualityIssueCount }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <FlaskConical class="h-3.5 w-3.5" />
            Species
          </div>
          <p class="mt-1 truncate text-sm font-semibold">{{ dominantSpecies }}</p>
        </div>
      </div>

      <div class="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <label class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            v-model="query"
            type="text"
            class="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-[12px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            placeholder="Search system, side chain, species, note..."
          >
        </label>
        <select v-model="speciesFilter" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <option value="all">All species</option>
          <option v-for="item in speciesOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
        <select v-model="sourceFilter" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
          <option value="all">All sources</option>
          <option v-for="item in sourceOptions.filter((value) => value !== 'all')" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div v-if="filteredRows.length" class="min-w-[78rem]">
        <div class="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
          <section class="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <ArrowDownUp class="h-3.5 w-3.5" />
              可直接入库的结论字段
            </div>
            <p class="mt-2 text-sm font-semibold leading-6 text-slate-900 dark:text-slate-100">
              扩散系数趋势：{{ trendStatement }}
            </p>
            <p class="mt-1 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
              机理归因：{{ mechanismStatement }}
            </p>
          </section>

          <section class="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <FileText class="h-3.5 w-3.5" />
              文献证据摘要
            </div>
            <p class="mt-2 text-[12px] leading-6 text-slate-500 dark:text-slate-400">
              提取到 {{ tableRows.length }} 条扩散系数记录，来源集中于 {{ sourceSummary }}，当前表格按扩散系数从低到高排序，便于检查侧链长度、水吸收率和扩散能力的对应关系。
            </p>
          </section>
        </div>

        <div class="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table class="min-w-full divide-y divide-slate-200 text-left text-[12px] dark:divide-slate-800">
            <thead class="sticky top-0 z-10 bg-slate-50 text-[10.5px] font-semibold tracking-[0.08em] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th class="w-[6.5rem] px-3 py-2.5">记录编号</th>
                <th class="w-[12rem] px-3 py-2.5">材料体系</th>
                <th class="w-[7rem] px-3 py-2.5">侧链类型</th>
                <th class="w-[8rem] px-3 py-2.5">水吸收率 WU</th>
                <th class="w-[7rem] px-3 py-2.5">扩散物种</th>
                <th class="w-[12rem] px-3 py-2.5">D / Å²·ps⁻¹</th>
                <th class="w-[12rem] px-3 py-2.5">D / m²·s⁻¹</th>
                <th class="w-[8rem] px-3 py-2.5">数据类型</th>
                <th class="w-[16rem] px-3 py-2.5">方法与条件</th>
                <th class="min-w-[18rem] px-3 py-2.5">备注</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
              <tr v-for="row in filteredRows" :key="row.record.id || row.recordNo" class="align-top hover:bg-slate-50 dark:hover:bg-slate-900">
                <td class="px-3 py-3 font-mono text-[12px] font-semibold text-slate-800 dark:text-slate-100">{{ row.recordNo }}</td>
                <td class="px-3 py-3">
                  <p class="font-semibold text-slate-900 dark:text-white">{{ row.materialSystem }}</p>
                  <p class="mt-1 text-[11px] leading-4 text-slate-500">{{ row.record.confinement_material_class || row.record.confinement_geometry_class || '--' }}</p>
                </td>
                <td class="px-3 py-3 font-mono text-slate-700 dark:text-slate-200">{{ row.sideChain }}</td>
                <td class="px-3 py-3 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{{ row.waterUptake }}</td>
                <td class="px-3 py-3 font-semibold text-slate-800 dark:text-slate-100">{{ row.diffusingSpecies }}</td>
                <td class="px-3 py-3 font-mono leading-5 text-slate-800 dark:text-slate-100">{{ row.dAngstrom }}</td>
                <td class="px-3 py-3 font-mono leading-5 text-slate-800 dark:text-slate-100">{{ row.dMetric }}</td>
                <td class="px-3 py-3 text-slate-700 dark:text-slate-200">{{ row.dataType }}</td>
                <td class="px-3 py-3 leading-5 text-slate-700 dark:text-slate-300">{{ row.method }}</td>
                <td class="px-3 py-3 leading-5 text-slate-600 dark:text-slate-400">{{ row.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section class="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">离子字段归一化</p>
              <h3 class="mt-1 text-sm font-semibold text-slate-950 dark:text-white">数据库字段建议</h3>
            </div>
            <span class="rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">
              cation / anion / diffusing ion
            </span>
          </div>

          <div class="mt-3 overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
            <table class="min-w-full divide-y divide-slate-200 text-left text-[12px] dark:divide-slate-800">
              <thead class="bg-slate-50 text-[10.5px] font-semibold tracking-[0.08em] text-slate-500 dark:bg-slate-950">
                <tr>
                  <th class="px-3 py-2">体系</th>
                  <th class="px-3 py-2">cation 字段</th>
                  <th class="px-3 py-2">anion 字段</th>
                  <th class="px-3 py-2">diffusing ion 字段</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                <tr v-for="item in ionMappingRows" :key="`${item.system}-${item.diffusingIon}`">
                  <td class="px-3 py-2 font-semibold text-slate-900 dark:text-white">{{ item.system }}</td>
                  <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{{ item.cation }}</td>
                  <td class="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">{{ item.anion }}</td>
                  <td class="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">{{ item.diffusingIon }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div
        v-else
        class="flex h-full min-h-[18rem] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
      >
        No diffusion records are available for the current selection.
      </div>
    </div>
  </div>
</template>
