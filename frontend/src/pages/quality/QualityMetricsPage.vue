<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  ListChecks,
  LocateFixed,
  RefreshCcw,
} from 'lucide-vue-next'

import { listLiterature, type BatchFile, type Literature, type TribologyData } from '@/lib/api'

type MetricTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'

type MetricCard = {
  key: string
  label: string
  value: string
  detail: string
  formula: string
  tone: MetricTone
}

type MetricSectionGroup = {
  key: string
  title: string
  description: string
  metrics: MetricCard[]
  icon: Component
}

type CoreField = {
  key: string
  label: string
  category: string
  fields: Array<keyof TribologyData | string>
}

const props = defineProps<{
  files: BatchFile[]
  activeScopeLabel: string
  operatorName: string
}>()

const loading = ref(false)
const loadError = ref('')
const literatureItems = ref<Literature[]>([])

const coreFields: CoreField[] = [
  { key: 'ionic_liquid', label: '离子液体名称', category: '材料结构', fields: ['ionic_liquid', 'lubricant_alias', 'ionic_liquid_display'] },
  { key: 'cation', label: '阳离子', category: '材料结构', fields: ['cation', 'cation_smiles'] },
  { key: 'anion', label: '阴离子', category: '材料结构', fields: ['anion', 'anion_smiles'] },
  { key: 'substrate', label: '基底', category: '界面材料', fields: ['substrate_material', 'material_name'] },
  { key: 'probe', label: '探针', category: '界面材料', fields: ['probe_material', 'probe_geometry'] },
  { key: 'system', label: '测试体系', category: '界面材料', fields: ['tribological_system', 'experiment_method', 'measurement_type'] },
  { key: 'load', label: '载荷', category: '工况参数', fields: ['load', 'load_conditions', 'normal_load'] },
  { key: 'speed', label: '速度', category: '工况参数', fields: ['speed', 'speed_conditions', 'shear_rate'] },
  { key: 'temperature', label: '温度', category: '工况参数', fields: ['temperature', 'temperature_value'] },
  { key: 'potential', label: '电位', category: '工况参数', fields: ['potential'] },
  { key: 'cof', label: '摩擦系数', category: '性能指标', fields: ['cof', 'cof_extracted'] },
  { key: 'source_page', label: '页码', category: '证据来源', fields: ['source_page'] },
  { key: 'source_figure', label: '图号', category: '证据来源', fields: ['source_figure', 'source'] },
  { key: 'evidence', label: '原文片段', category: '证据来源', fields: ['evidence', 'notes'] },
]

const loadedRecords = computed(() => props.files.flatMap((file) => file.records || []))
const reviewableRecords = computed(() => loadedRecords.value.filter((record) => !isRejectedRecord(record)))

const documents = computed(() => {
  const items = literatureItems.value.map((item) => {
    const file = props.files.find((candidate) => String(candidate.id) === String(item.id))
    const rawCandidateCount = Number(item.candidateCount ?? file?.records?.length ?? 0)
    const recordCount = Number(item.recordCount ?? countValidRecords(file?.records || []) ?? 0)
    return {
      id: String(item.id),
      title: item.title || file?.metadata?.title || file?.name || `Literature ${item.id}`,
      doi: item.doi || file?.metadata?.doi || '',
      status: normalizeStatus(item.status || file?.status || ''),
      rawCandidateCount,
      candidateCount: Math.max(rawCandidateCount, recordCount),
      recordCount,
      hasPdf: Boolean(item.hasPdf ?? file),
      source: 'library' as const,
      file,
    }
  })

  const knownIds = new Set(items.map((item) => item.id))
  const sessionOnly = props.files
    .filter((file) => !knownIds.has(String(file.id)))
    .map((file) => {
      const rawCandidateCount = file.records?.length || 0
      const recordCount = countValidRecords(file.records || [])
      return {
        id: String(file.id),
        title: file.metadata?.title || file.name,
        doi: file.metadata?.doi || '',
        status: normalizeStatus(file.status),
        rawCandidateCount,
        candidateCount: Math.max(rawCandidateCount, recordCount),
        recordCount,
        hasPdf: true,
        source: 'session' as const,
        file,
      }
    })

  return [...items, ...sessionOnly]
})

const documentTotal = computed(() => documents.value.length)
const uploadedTotal = computed(() => Math.max(documentTotal.value, props.files.length))
const processedCount = computed(() => documents.value.filter((item) => isProcessedDocument(item)).length)
const metadataRecognizedCount = computed(() => documents.value.filter((item) => hasText(item.doi) || hasUsefulTitle(item.title)).length)
const figureParseDenominator = computed(() => props.files.filter((file) => (file.records || []).length > 0).length)
const figureParsedCount = computed(() => props.files.filter((file) => (file.records || []).some(hasFigureEvidence)).length)
const reprocessNeededCount = computed(() => documents.value.filter((item) => needsReprocess(item)).length)

const candidateCount = computed(() => {
  const fromLibrary = sum(documents.value.map((item) => item.candidateCount))
  return fromLibrary || loadedRecords.value.length
})
const rawCandidateCount = computed(() => sum(documents.value.map((item) => item.rawCandidateCount)))
const candidateCountAdjusted = computed(() => documents.value.some((item) => item.rawCandidateCount < item.recordCount))
const validRecordCount = computed(() => {
  const fromLibrary = sum(documents.value.map((item) => item.recordCount))
  return fromLibrary || countValidRecords(loadedRecords.value)
})
const acceptedCount = computed(() => loadedRecords.value.filter(isAcceptedRecord).length)
const correctedCount = computed(() => loadedRecords.value.filter(isCorrectedRecord).length)
const rejectedCount = computed(() => loadedRecords.value.filter(isRejectedRecord).length)

const fieldStats = computed(() => {
  const rows = reviewableRecords.value
  const denominator = rows.length * coreFields.length
  const filled = rows.reduce((total, record) => {
    return total + coreFields.filter((field) => hasAnyField(record, field.fields)).length
  }, 0)
  return { filled, denominator }
})

const fieldCategoryRows = computed(() => {
  const grouped = new Map<string, { category: string; fields: CoreField[] }>()
  coreFields.forEach((field) => {
    if (!grouped.has(field.category)) grouped.set(field.category, { category: field.category, fields: [] })
    grouped.get(field.category)!.fields.push(field)
  })

  return [...grouped.values()].map((group) => {
    const denominator = reviewableRecords.value.length * group.fields.length
    const filled = reviewableRecords.value.reduce((total, record) => {
      return total + group.fields.filter((field) => hasAnyField(record, field.fields)).length
    }, 0)
    return {
      category: group.category,
      filled,
      denominator,
      rate: ratio(filled, denominator),
      fields: group.fields.map((field) => field.label).join('、'),
    }
  })
})

const evidenceStats = computed(() => {
  const rows = reviewableRecords.value
  const pageCovered = rows.filter((record) => Boolean(record.source_page)).length
  const figureCovered = rows.filter(hasFigureEvidence).length
  const textCovered = rows.filter((record) => hasText(record.evidence) || hasText(record.source) || hasText(record.notes)).length
  const fieldEvidence = countFieldEvidence(rows)
  return {
    rows: rows.length,
    pageCovered,
    figureCovered,
    textCovered,
    fieldEvidenceCovered: fieldEvidence.covered,
    fieldEvidenceTotal: fieldEvidence.total,
  }
})

const literatureMetrics = computed<MetricCard[]>(() => [
  {
    key: 'document_success',
    label: '文献处理成功率',
    value: formatPercent(processedCount.value, uploadedTotal.value),
    detail: `${processedCount.value} / ${uploadedTotal.value} 篇完成解析或产生候选记录`,
    formula: '成功完成解析和候选生成的文献数 / 上传文献数',
    tone: rateTone(ratio(processedCount.value, uploadedTotal.value)),
  },
  {
    key: 'metadata',
    label: 'DOI/标题识别率',
    value: formatPercent(metadataRecognizedCount.value, documentTotal.value),
    detail: `${metadataRecognizedCount.value} / ${documentTotal.value} 篇识别到 DOI 或有效标题`,
    formula: '能识别基础文献信息的文献数 / 文献总数',
    tone: rateTone(ratio(metadataRecognizedCount.value, documentTotal.value)),
  },
  {
    key: 'figure_parse',
    label: '图表解析成功率',
    value: formatPercent(figureParsedCount.value, figureParseDenominator.value),
    detail: `${figureParsedCount.value} / ${figureParseDenominator.value} 篇已加载文献含图表证据`,
    formula: '可定位主要图表或表格的文献数 / 已加载记录的文献数',
    tone: rateTone(ratio(figureParsedCount.value, figureParseDenominator.value)),
  },
  {
    key: 'reprocess',
    label: '重处理比例',
    value: formatPercent(reprocessNeededCount.value, documentTotal.value),
    detail: `${reprocessNeededCount.value} / ${documentTotal.value} 篇失败、无数据或仍有明显警告`,
    formula: '需要重新抽取的文献数 / 文献总数',
    tone: reprocessNeededCount.value > 0 ? 'amber' : 'emerald',
  },
])

const recordMetrics = computed<MetricCard[]>(() => [
  {
    key: 'candidates',
    label: candidateCountAdjusted.value ? '候选记录数（下限）' : '候选记录数',
    value: formatInteger(candidateCount.value),
    detail: candidateCountAdjusted.value
      ? `候选历史表记录 ${rawCandidateCount.value} 条，小于已入库记录；这里按有效记录数补足下限。`
      : '模型初步生成的候选记录总量',
    formula: 'max(候选历史记录数, 有效记录数)',
    tone: 'sky',
  },
  {
    key: 'valid',
    label: '有效记录数',
    value: formatInteger(validRecordCount.value),
    detail: 'accepted 或 corrected 后可入库的记录数',
    formula: 'accepted + corrected 或已入库记录数',
    tone: 'emerald',
  },
  {
    key: 'candidate_rate',
    label: '候选有效率',
    value: formatPercent(validRecordCount.value, candidateCount.value),
    detail: `${validRecordCount.value} / ${candidateCount.value} 条候选可用`,
    formula: '有效记录数 / 候选记录数下限',
    tone: rateTone(ratio(validRecordCount.value, candidateCount.value)),
  },
  {
    key: 'reject',
    label: '驳回率',
    value: formatPercent(rejectedCount.value, candidateCount.value),
    detail: `${rejectedCount.value} / ${candidateCount.value} 条候选被 rejected`,
    formula: 'rejected 记录数 / 候选记录数',
    tone: rejectedCount.value > 0 ? 'amber' : 'emerald',
  },
  {
    key: 'correction',
    label: '人工修正率',
    value: formatPercent(correctedCount.value, Math.max(acceptedCount.value + correctedCount.value, validRecordCount.value)),
    detail: `${correctedCount.value} 条 corrected；accepted ${acceptedCount.value} 条`,
    formula: 'corrected 记录数 / 有效记录数',
    tone: correctedCount.value > 0 ? 'amber' : 'emerald',
  },
])

const fieldMetrics = computed<MetricCard[]>(() => [
  {
    key: 'field_completeness',
    label: '字段完整率',
    value: formatPercent(fieldStats.value.filled, fieldStats.value.denominator),
    detail: `${fieldStats.value.filled} / ${fieldStats.value.denominator} 个核心字段已填`,
    formula: '已填核心字段数 / 应填核心字段数',
    tone: rateTone(ratio(fieldStats.value.filled, fieldStats.value.denominator)),
  },
  {
    key: 'field_accuracy',
    label: '字段正确率',
    value: '待抽查',
    detail: '建议抽查 5 篇代表性文献，每篇 5 条记录',
    formula: '人工判断正确的字段数 / 人工检查的字段数',
    tone: 'slate',
  },
])

const evidenceMetrics = computed<MetricCard[]>(() => [
  {
    key: 'page',
    label: '页码证据覆盖率',
    value: formatPercent(evidenceStats.value.pageCovered, evidenceStats.value.rows),
    detail: `${evidenceStats.value.pageCovered} / ${evidenceStats.value.rows} 条记录有 source_page`,
    formula: '有 source_page 的记录数 / 有效记录数',
    tone: rateTone(ratio(evidenceStats.value.pageCovered, evidenceStats.value.rows)),
  },
  {
    key: 'figure',
    label: '图表证据覆盖率',
    value: formatPercent(evidenceStats.value.figureCovered, evidenceStats.value.rows),
    detail: `${evidenceStats.value.figureCovered} / ${evidenceStats.value.rows} 条记录有 source_figure`,
    formula: '有 source_figure 的记录数 / 有效记录数',
    tone: rateTone(ratio(evidenceStats.value.figureCovered, evidenceStats.value.rows)),
  },
  {
    key: 'text',
    label: '原文证据覆盖率',
    value: formatPercent(evidenceStats.value.textCovered, evidenceStats.value.rows),
    detail: `${evidenceStats.value.textCovered} / ${evidenceStats.value.rows} 条记录有 evidence_text`,
    formula: '有 evidence_text 的记录数 / 有效记录数',
    tone: rateTone(ratio(evidenceStats.value.textCovered, evidenceStats.value.rows)),
  },
  {
    key: 'field_evidence',
    label: '字段级证据覆盖率',
    value: formatPercent(evidenceStats.value.fieldEvidenceCovered, evidenceStats.value.fieldEvidenceTotal),
    detail: `${evidenceStats.value.fieldEvidenceCovered} / ${evidenceStats.value.fieldEvidenceTotal} 个核心字段有 field_evidence`,
    formula: '有 field_evidence 的字段数 / 应检查核心字段数',
    tone: rateTone(ratio(evidenceStats.value.fieldEvidenceCovered, evidenceStats.value.fieldEvidenceTotal)),
  },
  {
    key: 'evidence_accuracy',
    label: '证据匹配正确率',
    value: '待抽查',
    detail: '人工检查证据是否真的支持该字段',
    formula: '证据支持字段的数量 / 人工检查证据数量',
    tone: 'slate',
  },
])

const metricGroups = computed<MetricSectionGroup[]>(() => [
  {
    key: 'literature',
    title: '1. 文献级：这篇文献有没有跑通',
    description: '衡量一篇 PDF 从上传到入库的流程是否成功，回答平台能不能稳定处理文献。',
    metrics: literatureMetrics.value,
    icon: FileSearch,
  },
  {
    key: 'records',
    title: '2. 记录级：抽出来的实验记录有没有用',
    description: '用 Review 状态评价候选记录质量：accepted 可直接使用，corrected 代表字段需修正，rejected 不适合入库。',
    metrics: recordMetrics.value,
    icon: BarChart3,
  },
  {
    key: 'fields',
    title: '3. 字段级：核心材料字段抽得全不全、对不对',
    description: '字段完整率可以全量统计；字段正确率需要人工抽查小样本后录入。',
    metrics: fieldMetrics.value,
    icon: ListChecks,
  },
  {
    key: 'evidence',
    title: '4. 证据级：能不能回到原文',
    description: '这是平台亮点：不仅看字段是否存在，还看它能否回到页码、图表或原文片段。',
    metrics: evidenceMetrics.value,
    icon: LocateFixed,
  },
])

const documentRows = computed(() => documents.value.slice(0, 10))

async function refreshLiterature() {
  loading.value = true
  loadError.value = ''
  try {
    literatureItems.value = await listLiterature(0, 500)
  } catch (error: any) {
    loadError.value = error?.response?.data?.detail || error?.message || '加载文献库统计失败。'
  } finally {
    loading.value = false
  }
}

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function hasText(value: unknown) {
  return String(value ?? '').trim().length > 0
}

function hasUsefulTitle(value: unknown) {
  const text = String(value || '').trim()
  return Boolean(text && !/^literature\s+\d+$/i.test(text) && text !== 'No file selected')
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return null
  return numerator / denominator
}

function formatPercent(numerator: number, denominator: number) {
  const value = ratio(numerator, denominator)
  if (value == null) return '—'
  return `${Math.round(value * 100)}%`
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function rateTone(value: number | null): MetricTone {
  if (value == null) return 'slate'
  if (value >= 0.8) return 'emerald'
  if (value >= 0.6) return 'sky'
  if (value >= 0.35) return 'amber'
  return 'rose'
}

function toneClass(tone: MetricTone) {
  if (tone === 'emerald') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function progressClass(tone: MetricTone) {
  if (tone === 'emerald') return 'bg-emerald-500'
  if (tone === 'sky') return 'bg-sky-500'
  if (tone === 'amber') return 'bg-amber-500'
  if (tone === 'rose') return 'bg-rose-500'
  return 'bg-slate-400'
}

function metricWidth(value: string) {
  if (!value.endsWith('%')) return '100%'
  const numeric = Number(value.replace('%', ''))
  return `${Math.max(4, Math.min(100, Number.isFinite(numeric) ? numeric : 0))}%`
}

function isProcessedDocument(item: { status: string; candidateCount: number; recordCount: number }) {
  return ['success', 'completed', 'done'].includes(item.status) || item.candidateCount > 0 || item.recordCount > 0
}

function needsReprocess(item: { status: string; candidateCount: number; recordCount: number; file?: BatchFile }) {
  return ['error', 'failed', 'no_data'].includes(item.status) || Boolean(item.file?.hasWarnings)
}

function countValidRecords(records: TribologyData[]) {
  return records.filter((record) => !isRejectedRecord(record)).length
}

function normalizedReviewStatus(record: TribologyData) {
  return String(record.review_status || record.validationStatus || '').trim().toLowerCase()
}

function isAcceptedRecord(record: TribologyData) {
  const status = normalizedReviewStatus(record)
  return ['accepted', 'approved', 'verified', 'confirmed'].includes(status)
}

function isCorrectedRecord(record: TribologyData) {
  const status = normalizedReviewStatus(record)
  return ['corrected', 'modified'].includes(status)
}

function isRejectedRecord(record: TribologyData) {
  const status = normalizedReviewStatus(record)
  return ['rejected', 'discarded', 'excluded'].includes(status)
}

function hasAnyField(record: TribologyData, fields: Array<keyof TribologyData | string>) {
  return fields.some((field) => {
    const value = (record as unknown as Record<string, unknown>)[String(field)]
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
    return hasText(value)
  })
}

function hasFigureEvidence(record: TribologyData) {
  return hasText(record.source_figure) || /fig|figure|table|图|表/i.test(String(record.source || ''))
}

function fieldEvidenceMap(record: TribologyData) {
  const value = record.field_evidence_json
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {}
    } catch {
      return {}
    }
  }
  return value as Record<string, any>
}

function hasFieldEvidenceEntry(entry: any) {
  if (!entry) return false
  const status = String(entry.status || entry.evidence?.status || '').toLowerCase()
  return ['grounded', 'partial'].includes(status)
    || Boolean(entry.evidence?.quote || entry.evidence?.matched_text || entry.evidence?.page || entry.quote || entry.page)
}

function countFieldEvidence(records: TribologyData[]) {
  let covered = 0
  let total = 0
  records.forEach((record) => {
    const evidence = fieldEvidenceMap(record)
    coreFields.forEach((field) => {
      total += 1
      const matched = [field.key, ...field.fields.map(String)].some((key) => hasFieldEvidenceEntry(evidence[key]))
      if (matched) covered += 1
    })
  })
  return { covered, total }
}

function documentStatusLabel(status: string) {
  if (['success', 'completed', 'done'].includes(status)) return '已跑通'
  if (status === 'processing' || status === 'running') return '处理中'
  if (status === 'no_data') return '无记录'
  if (status === 'error' || status === 'failed') return '失败'
  if (status === 'uploaded') return '已上传'
  return status || '未知'
}

onMounted(() => {
  void refreshLiterature()
})
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto bg-[#f5f7fb] text-slate-900">
    <div class="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 lg:px-6">
      <section class="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="max-w-4xl">
            <div class="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
              <ClipboardCheck class="h-3.5 w-3.5" />
              Extraction Quality
            </div>
            <h1 class="mt-3 text-[2rem] font-semibold tracking-tight text-slate-950">提取质量评估</h1>
            <p class="mt-2 text-sm leading-7 text-slate-600">
              按文献级、记录级、字段级和证据级四层看平台是否稳定处理 PDF、生成可用实验记录，并把关键字段定位回原文。
            </p>
          </div>

          <div class="flex flex-col items-stretch gap-2 sm:min-w-[17rem]">
            <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              当前范围：<span class="font-semibold text-slate-800">{{ activeScopeLabel }}</span><br />
              操作员：<span class="font-semibold text-slate-800">{{ operatorName }}</span>
            </div>
            <button
              type="button"
              class="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              :disabled="loading"
              @click="refreshLiterature"
            >
              <RefreshCcw class="h-4 w-4" />
              {{ loading ? '刷新中...' : '刷新统计' }}
            </button>
          </div>
        </div>

        <div v-if="loadError" class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div class="flex items-center gap-2 font-semibold">
            <AlertTriangle class="h-4 w-4" />
            {{ loadError }}
          </div>
          <p class="mt-1 text-xs leading-5">已退回使用当前会话中加载的文件和记录计算可用指标。</p>
        </div>

        <div v-if="candidateCountAdjusted" class="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div class="flex items-center gap-2 font-semibold">
            <AlertTriangle class="h-4 w-4" />
            候选记录历史不完整，已使用保守下限口径
          </div>
          <p class="mt-1 text-xs leading-5">
            当前接口返回的候选历史数为 {{ rawCandidateCount }}，小于已入库有效记录数 {{ validRecordCount }}。为避免出现有效率超过 100%，本页把候选记录数按“至少等于有效记录数”计算。
          </p>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-4">
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <FileText class="h-5 w-5 text-indigo-600" />
            <p class="text-sm font-semibold text-slate-950">文献总数</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ documentTotal }}</p>
          <p class="mt-1 text-xs text-slate-500">来自文献库和当前上传队列</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <Database class="h-5 w-5 text-emerald-600" />
            <p class="text-sm font-semibold text-slate-950">有效记录</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ validRecordCount }}</p>
          <p class="mt-1 text-xs text-slate-500">入库记录或 Review 后可用记录</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <ListChecks class="h-5 w-5 text-sky-600" />
            <p class="text-sm font-semibold text-slate-950">核心字段</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ coreFields.length }}</p>
          <p class="mt-1 text-xs text-slate-500">覆盖材料、界面、工况、性能和证据</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <LocateFixed class="h-5 w-5 text-amber-600" />
            <p class="text-sm font-semibold text-slate-950">证据字段</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ evidenceStats.fieldEvidenceCovered }}</p>
          <p class="mt-1 text-xs text-slate-500">已有字段级证据的核心字段数</p>
        </div>
      </section>

      <section class="grid gap-5 2xl:grid-cols-2">
        <section
          v-for="group in metricGroups"
          :key="group.key"
          class="min-w-0"
        >
          <div class="flex items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-indigo-600 ring-1 ring-indigo-100">
              <component :is="group.icon" class="h-5 w-5" />
            </div>
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">{{ group.title }}</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">{{ group.description }}</p>
            </div>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-2">
            <article
              v-for="metric in group.metrics"
              :key="metric.key"
              class="rounded-2xl border px-4 py-4"
              :class="toneClass(metric.tone)"
            >
              <p class="text-sm font-semibold">{{ metric.label }}</p>
              <p class="mt-2 text-3xl font-semibold tracking-tight">{{ metric.value }}</p>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/75">
                <div class="h-full rounded-full" :class="progressClass(metric.tone)" :style="{ width: metricWidth(metric.value) }"></div>
              </div>
              <p class="mt-3 text-xs leading-5 opacity-85">{{ metric.detail }}</p>
              <p class="mt-2 rounded-xl bg-white/65 px-3 py-2 text-[11px] leading-5 opacity-80">{{ metric.formula }}</p>
            </article>
          </div>
        </section>
      </section>

      <section class="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-3">
            <CheckCircle2 class="h-5 w-5 text-emerald-600" />
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">字段类别完整率</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">按论文中可解释的核心字段分组，便于写实验评价。</p>
            </div>
          </div>

          <div class="mt-5 divide-y divide-slate-100">
            <div v-for="row in fieldCategoryRows" :key="row.category" class="py-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-slate-950">{{ row.category }}</p>
                  <p class="mt-1 text-xs leading-5 text-slate-500">{{ row.fields }}</p>
                </div>
                <p class="text-sm font-semibold text-slate-900">{{ formatPercent(row.filled, row.denominator) }}</p>
              </div>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div class="h-full rounded-full bg-indigo-500" :style="{ width: `${Math.max(4, Math.round((row.rate || 0) * 100))}%` }"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-3">
            <FileSearch class="h-5 w-5 text-indigo-600" />
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">文献处理明细</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">用于定位哪些文献没有跑通、哪些文献需要重新抽取。</p>
            </div>
          </div>

          <div class="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th class="px-3 py-3">文献</th>
                  <th class="px-3 py-3">状态</th>
                  <th class="px-3 py-3 text-right">候选</th>
                  <th class="px-3 py-3 text-right">有效</th>
                  <th class="px-3 py-3">DOI</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in documentRows" :key="item.id" class="border-t border-slate-100">
                  <td class="max-w-[16rem] px-3 py-3">
                    <p class="truncate font-medium text-slate-900">{{ item.title }}</p>
                    <p class="mt-1 text-xs text-slate-400">{{ item.source === 'library' ? '文献库' : '当前会话' }}</p>
                  </td>
                  <td class="px-3 py-3">
                    <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {{ documentStatusLabel(item.status) }}
                    </span>
                  </td>
                  <td class="px-3 py-3 text-right tabular-nums">
                    <span>{{ item.candidateCount }}</span>
                    <span v-if="item.rawCandidateCount < item.candidateCount" class="mt-1 block text-[11px] text-slate-400">
                      原始 {{ item.rawCandidateCount }}
                    </span>
                  </td>
                  <td class="px-3 py-3 text-right tabular-nums">{{ item.recordCount }}</td>
                  <td class="max-w-[12rem] px-3 py-3">
                    <span class="block truncate text-xs text-slate-500">{{ item.doi || '未识别' }}</span>
                  </td>
                </tr>
                <tr v-if="!documentRows.length">
                  <td colspan="5" class="px-3 py-8 text-center text-sm text-slate-500">暂无文献统计，请先上传或同步文献。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  </div>
</template>
