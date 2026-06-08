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

import {
  getQualityAssetSummary,
  listLiterature,
  type BatchFile,
  type Literature,
  type QualityAssetMetric,
  type QualityAssetSlice,
  type QualityAssetSummary,
  type QualityReplenishmentRecord,
  type TribologyData,
} from '@/lib/api'

type MetricTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'

type MetricCard = {
  key: string
  label: string
  value: string
  detail: string
  formula: string
  tone: MetricTone
  progress?: number | null
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
const qualityAssetSummary = ref<QualityAssetSummary | null>(null)
const selectedQualityScale = ref('all')

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

const allQualitySlice = computed<QualityAssetSlice | null>(() => {
  const payload = qualityAssetSummary.value
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

const qualityScaleOptions = computed(() => {
  const all = allQualitySlice.value
  const slices = qualityAssetSummary.value?.scaleBreakdown || []
  return [
    ...(all ? [all] : []),
    ...slices,
  ].map((slice) => ({
    key: slice.key,
    label: slice.label,
    recordCount: slice.summary.activeRecordCount,
    trainableCount: slice.summary.trainableSampleCount,
    tone: (slice.training.readiness?.tone || 'slate') as MetricTone,
  }))
})

const activeQualitySlice = computed<QualityAssetSlice | null>(() => {
  const all = allQualitySlice.value
  if (!all) return null
  if (selectedQualityScale.value === 'all') return all
  return qualityAssetSummary.value?.scaleBreakdown?.find((slice) => slice.key === selectedQualityScale.value) || all
})

const assetSummary = computed(() => activeQualitySlice.value?.summary || null)
const trainingReadiness = computed(() => activeQualitySlice.value?.training.readiness || null)
const trainingReplenishment = computed(() => activeQualitySlice.value?.training.replenishment || null)
const replenishmentActionRows = computed(() => trainingReplenishment.value?.actionItems || [])
const replenishmentSourceRows = computed(() => trainingReplenishment.value?.sourceLiterature || [])
const blockerRecordRows = computed(() => {
  const groups = trainingReplenishment.value?.recordGroups || {}
  const orderedKeys = ['missingTarget', 'missingCondition', 'missingTribopair', 'missingLubricant', 'missingEvidence']
  const rows: Array<QualityReplenishmentRecord & { groupKey: string; groupLabel: string }> = []
  orderedKeys.forEach((key) => {
    ;(groups[key] || []).slice(0, 4).forEach((record) => {
      rows.push({
        ...record,
        groupKey: key,
        groupLabel: blockerLabel(key),
      })
    })
  })
  return rows.slice(0, 8)
})
const unknownMacroCandidateRows = computed(() => trainingReplenishment.value?.unknownMacroCandidates || [])
const effectiveFieldStats = computed(() => {
  if (assetSummary.value) {
    return {
      filled: Math.max(0, assetSummary.value.coreFieldSlots - assetSummary.value.missingFieldSlots),
      denominator: assetSummary.value.coreFieldSlots,
    }
  }
  return fieldStats.value
})
const effectiveEvidenceStats = computed(() => {
  if (assetSummary.value) {
    return {
      rows: assetSummary.value.activeRecordCount,
      pageCovered: assetSummary.value.pageEvidenceCount,
      figureCovered: assetSummary.value.figureEvidenceCount,
      textCovered: assetSummary.value.textEvidenceCount,
      fieldEvidenceCovered: assetSummary.value.fieldEvidenceCoveredSlots,
      fieldEvidenceTotal: assetSummary.value.fieldEvidenceSlots,
    }
  }
  return evidenceStats.value
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
    value: formatPercent(effectiveFieldStats.value.filled, effectiveFieldStats.value.denominator),
    detail: `${effectiveFieldStats.value.filled} / ${effectiveFieldStats.value.denominator} 个核心字段已填`,
    formula: '已填核心字段数 / 应填核心字段数',
    tone: rateTone(ratio(effectiveFieldStats.value.filled, effectiveFieldStats.value.denominator)),
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
    value: formatPercent(effectiveEvidenceStats.value.pageCovered, effectiveEvidenceStats.value.rows),
    detail: `${effectiveEvidenceStats.value.pageCovered} / ${effectiveEvidenceStats.value.rows} 条记录有 source_page 或 evidence_page`,
    formula: '有 source_page 的记录数 / 有效记录数',
    tone: rateTone(ratio(effectiveEvidenceStats.value.pageCovered, effectiveEvidenceStats.value.rows)),
  },
  {
    key: 'figure',
    label: '图表证据覆盖率',
    value: formatPercent(effectiveEvidenceStats.value.figureCovered, effectiveEvidenceStats.value.rows),
    detail: `${effectiveEvidenceStats.value.figureCovered} / ${effectiveEvidenceStats.value.rows} 条记录有 source_figure`,
    formula: '有 source_figure 的记录数 / 有效记录数',
    tone: rateTone(ratio(effectiveEvidenceStats.value.figureCovered, effectiveEvidenceStats.value.rows)),
  },
  {
    key: 'text',
    label: '原文证据覆盖率',
    value: formatPercent(effectiveEvidenceStats.value.textCovered, effectiveEvidenceStats.value.rows),
    detail: `${effectiveEvidenceStats.value.textCovered} / ${effectiveEvidenceStats.value.rows} 条记录有 evidence 或 source 文本`,
    formula: '有 evidence_text 的记录数 / 有效记录数',
    tone: rateTone(ratio(effectiveEvidenceStats.value.textCovered, effectiveEvidenceStats.value.rows)),
  },
  {
    key: 'field_evidence',
    label: '字段级证据覆盖率',
    value: formatPercent(effectiveEvidenceStats.value.fieldEvidenceCovered, effectiveEvidenceStats.value.fieldEvidenceTotal),
    detail: `${effectiveEvidenceStats.value.fieldEvidenceCovered} / ${effectiveEvidenceStats.value.fieldEvidenceTotal} 个核心字段有 field_evidence`,
    formula: '有 field_evidence 的字段数 / 应检查核心字段数',
    tone: rateTone(ratio(effectiveEvidenceStats.value.fieldEvidenceCovered, effectiveEvidenceStats.value.fieldEvidenceTotal)),
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

const assetMetricCards = computed<MetricCard[]>(() => {
  const metrics = activeQualitySlice.value?.metrics || []
  if (metrics.length) {
    return metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: formatAssetMetricValue(metric),
      detail: metric.detail,
      formula: metric.formula,
      tone: metric.tone,
      progress: metric.rate,
    }))
  }

  const missingFieldSlots = Math.max(0, fieldStats.value.denominator - fieldStats.value.filled)
  const missingEvidence = Math.max(0, evidenceStats.value.rows - Math.max(
    evidenceStats.value.pageCovered,
    evidenceStats.value.figureCovered,
    evidenceStats.value.textCovered,
  ))
  const reviewed = acceptedCount.value + correctedCount.value + rejectedCount.value

  return [
    {
      key: 'missing_fields',
      label: '缺失字段率',
      value: formatPercent(missingFieldSlots, fieldStats.value.denominator),
      detail: `${missingFieldSlots} / ${fieldStats.value.denominator} 个核心字段槽位为空`,
      formula: '空核心字段槽位 / 活跃记录数 × 核心字段数',
      tone: riskTone(ratio(missingFieldSlots, fieldStats.value.denominator)),
      progress: ratio(missingFieldSlots, fieldStats.value.denominator),
    },
    {
      key: 'unit_issues',
      label: '单位混乱率',
      value: '后端统计',
      detail: '刷新后由文献库记录统一检查载荷、速度、剪切率、温度、电位和水含量单位。',
      formula: '疑似单位问题字段 / 已填工况字段',
      tone: 'slate',
      progress: null,
    },
    {
      key: 'duplicate_doi',
      label: 'DOI 重复率',
      value: '后端统计',
      detail: '刷新后按规范化 DOI 检查同一范围内的重复文献。',
      formula: '重复 DOI 超额文献数 / 有 DOI 文献数',
      tone: 'slate',
      progress: null,
    },
    {
      key: 'cof_outliers',
      label: 'COF 异常值率',
      value: '后端统计',
      detail: '刷新后检查 COF 是否触发硬阈值或 IQR 异常。',
      formula: '异常 COF 记录 / 有 COF 数值记录',
      tone: 'slate',
      progress: null,
    },
    {
      key: 'missing_evidence',
      label: '证据缺失率',
      value: formatPercent(missingEvidence, evidenceStats.value.rows),
      detail: `${missingEvidence} / ${evidenceStats.value.rows} 条当前记录缺少可用证据线索`,
      formula: '无证据记录 / 活跃记录数',
      tone: riskTone(ratio(missingEvidence, evidenceStats.value.rows)),
      progress: ratio(missingEvidence, evidenceStats.value.rows),
    },
    {
      key: 'trainable_samples',
      label: '可训练样本数量',
      value: formatInteger(validRecordCount.value),
      detail: '当前会话中可用记录的保守下限；后端统计会进一步检查 COF、材料、润滑剂和工况字段。',
      formula: '可训练记录 / 活跃记录数',
      tone: rateTone(ratio(validRecordCount.value, reviewableRecords.value.length)),
      progress: ratio(validRecordCount.value, reviewableRecords.value.length),
    },
    {
      key: 'reviewed_records',
      label: '已审阅比例',
      value: formatPercent(reviewed, loadedRecords.value.length),
      detail: `${reviewed} 条已有 accepted / corrected / rejected 状态`,
      formula: '有明确 Review 状态的记录 / 全部记录数',
      tone: rateTone(ratio(reviewed, loadedRecords.value.length)),
      progress: ratio(reviewed, loadedRecords.value.length),
    },
  ]
})

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
const overviewDocumentTotal = computed(() => assetSummary.value?.literatureCount ?? documentTotal.value)
const overviewActiveRecordTotal = computed(() => assetSummary.value?.activeRecordCount ?? validRecordCount.value)
const overviewTrainableTotal = computed(() => assetSummary.value?.trainableSampleCount ?? validRecordCount.value)
const overviewUnreviewedTotal = computed(() => assetSummary.value?.unreviewedCount ?? Math.max(0, loadedRecords.value.length - acceptedCount.value - correctedCount.value - rejectedCount.value))
const displayedFieldCategoryRows = computed(() => {
  return activeQualitySlice.value?.fieldCategories?.length
    ? activeQualitySlice.value.fieldCategories
    : fieldCategoryRows.value
})
const unitIssueRows = computed(() => activeQualitySlice.value?.unitIssues.fieldBreakdown || [])
const issuePreviewRows = computed(() => {
  const rows: Array<{ key: string; type: string; label: string; detail: string; scaleLabel?: string }> = []
  ;(activeQualitySlice.value?.unitIssues.examples || []).slice(0, 4).forEach((item) => {
    rows.push({
      key: `unit-${item.recordId}-${item.field}`,
      type: '单位',
      label: `#${item.recordId} ${item.field}`,
      detail: item.value,
      scaleLabel: item.scaleLabel,
    })
  })
  ;(activeQualitySlice.value?.cofOutliers || []).slice(0, 4).forEach((item) => {
    rows.push({
      key: `cof-${item.recordId}`,
      type: 'COF',
      label: `#${item.recordId} COF ${item.cofValue}`,
      detail: item.reason,
      scaleLabel: item.scaleLabel,
    })
  })
  ;(activeQualitySlice.value?.doiDuplicates || []).slice(0, 4).forEach((item) => {
    rows.push({
      key: `doi-${item.doi}`,
      type: 'DOI',
      label: item.doi,
      detail: `${item.count} 篇重复：${item.literatureIds.join(', ')}`,
      scaleLabel: activeQualitySlice.value?.key === 'all' ? undefined : activeQualitySlice.value?.label,
    })
  })
  return rows.slice(0, 8)
})

async function refreshLiterature() {
  loading.value = true
  loadError.value = ''
  const errors: string[] = []
  const [literatureResult, qualityResult] = await Promise.allSettled([
    listLiterature(0, 500),
    getQualityAssetSummary(),
  ])

  if (literatureResult.status === 'fulfilled') {
    literatureItems.value = literatureResult.value
  } else {
    const error: any = literatureResult.reason
    errors.push(error?.response?.data?.detail || error?.message || '加载文献库列表失败。')
  }

  if (qualityResult.status === 'fulfilled') {
    qualityAssetSummary.value = qualityResult.value
  } else {
    const error: any = qualityResult.reason
    errors.push(error?.response?.data?.detail || error?.message || '加载数据资产质量统计失败。')
  }

  if (errors.length) {
    loadError.value = errors.join(' ')
  }
  loading.value = false
}

function formatAssetMetricValue(metric: QualityAssetMetric) {
  if (metric.key === 'trainable_samples') {
    return formatInteger(metric.numerator)
  }
  return formatPercent(metric.numerator, metric.denominator)
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

function blockerLabel(key: string) {
  const labels: Record<string, string> = {
    missingTarget: '缺 COF',
    missingLubricant: '缺润滑剂/离子结构',
    missingTribopair: '缺摩擦副',
    missingCondition: '缺工况',
    missingEvidence: '缺证据',
  }
  return labels[key] || key
}

function rateTone(value: number | null): MetricTone {
  if (value == null) return 'slate'
  if (value >= 0.8) return 'emerald'
  if (value >= 0.6) return 'sky'
  if (value >= 0.35) return 'amber'
  return 'rose'
}

function riskTone(value: number | null): MetricTone {
  if (value == null) return 'slate'
  if (value <= 0.05) return 'emerald'
  if (value <= 0.15) return 'sky'
  if (value <= 0.35) return 'amber'
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

function metricWidth(metric: MetricCard) {
  if (typeof metric.progress === 'number') {
    return `${Math.max(4, Math.min(100, Math.round(metric.progress * 100)))}%`
  }
  const value = metric.value
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
  <div class="min-h-0 flex-1 overflow-auto bg-slate-100 text-slate-900">
    <div class="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 py-5 lg:px-6">
      <section class="rounded-lg border border-slate-200 bg-white px-5 py-5">
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
            <div class="rounded-md bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              当前账户：<span class="font-semibold text-slate-800">{{ activeScopeLabel }}</span><br />
              操作员：<span class="font-semibold text-slate-800">{{ operatorName }}</span>
            </div>
            <button
              type="button"
              class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
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

      <section v-if="qualityScaleOptions.length" class="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold tracking-tight text-slate-950">按实验尺度查看质量</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">把同一套质量门禁拆到宏观摩擦和纳米摩擦训练池，避免混在一起看不出短板。</p>
          </div>
          <p v-if="trainingReadiness" class="rounded-full px-3 py-1 text-xs font-semibold" :class="toneClass(trainingReadiness.tone)">
            {{ trainingReadiness.label }}
          </p>
        </div>

        <div class="mt-4 grid gap-2 md:grid-cols-3">
          <button
            v-for="option in qualityScaleOptions"
            :key="option.key"
            type="button"
            class="rounded-2xl border px-4 py-3 text-left transition"
            :class="selectedQualityScale === option.key ? toneClass(option.tone) : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'"
            @click="selectedQualityScale = option.key"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="font-semibold">{{ option.label }}</p>
              <span class="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">{{ option.recordCount }} 条</span>
            </div>
            <p class="mt-2 text-xs leading-5 opacity-80">可训练 {{ option.trainableCount }} 条</p>
          </button>
        </div>

        <p v-if="trainingReadiness" class="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          {{ trainingReadiness.detail }}
        </p>
      </section>

      <section v-if="trainingReplenishment" class="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">训练池补数建议</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">把当前尺度的数据缺口拆成可以执行的补记录、补文献和补字段任务。</p>
            </div>
            <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="toneClass(trainingReadiness?.tone || 'slate')">
              {{ activeQualitySlice?.trainingView || 'all' }}
            </span>
          </div>

          <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs font-semibold text-slate-500">当前可训练</p>
              <p class="mt-1 text-2xl font-semibold text-slate-950">{{ formatInteger(trainingReplenishment.currentTrainableCount) }}</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs font-semibold text-slate-500">建议门槛</p>
              <p class="mt-1 text-2xl font-semibold text-slate-950">{{ formatInteger(trainingReplenishment.minimumSampleTarget) }}</p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs font-semibold text-slate-500">样本缺口</p>
              <p class="mt-1 text-2xl font-semibold" :class="trainingReplenishment.sampleGap ? 'text-amber-700' : 'text-emerald-700'">
                {{ formatInteger(trainingReplenishment.sampleGap) }}
              </p>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p class="text-xs font-semibold text-slate-500">来源文献</p>
              <p class="mt-1 text-2xl font-semibold text-slate-950">
                {{ formatInteger(trainingReplenishment.sourceLiteratureCount) }}
                <span class="text-sm text-slate-400">/ {{ trainingReplenishment.sourceLiteratureTarget }}</span>
              </p>
            </div>
          </div>

          <p class="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold leading-6 text-white">
            {{ trainingReplenishment.recommendedAction }}
          </p>

          <div class="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
            <div
              v-for="item in replenishmentActionRows"
              :key="item.key"
              class="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div class="min-w-0">
                <p class="font-semibold text-slate-950">{{ item.label }}</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">{{ item.detail }}</p>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" :class="toneClass(item.tone)">
                {{ formatInteger(item.count) }}
              </span>
            </div>
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-3">
            <FileSearch class="h-5 w-5 text-indigo-600" />
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">待办来源和阻断记录</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">先看字段阻断，再看来源文献是否过于集中。</p>
            </div>
          </div>

          <div class="mt-5">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-950">字段阻断记录</p>
              <span class="text-xs text-slate-400">最多展示 8 条</span>
            </div>
            <div class="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <table class="min-w-full text-left text-sm">
                <thead class="bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th class="px-3 py-3">问题</th>
                    <th class="px-3 py-3">记录</th>
                    <th class="px-3 py-3">文献</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in blockerRecordRows" :key="`${row.groupKey}-${row.recordId}`" class="border-t border-slate-100">
                    <td class="px-3 py-3">
                      <span class="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{{ row.groupLabel }}</span>
                    </td>
                    <td class="max-w-[12rem] px-3 py-3">
                      <p class="font-semibold text-slate-900">#{{ row.recordId }}</p>
                      <p class="mt-1 truncate text-xs text-slate-500">{{ row.lubricant || row.tribopair || row.scaleLabel }}</p>
                    </td>
                    <td class="max-w-[18rem] px-3 py-3">
                      <p class="truncate text-xs leading-5 text-slate-500">{{ row.title }}</p>
                    </td>
                  </tr>
                  <tr v-if="!blockerRecordRows.length">
                    <td colspan="3" class="px-3 py-8 text-center text-sm text-slate-500">当前尺度没有字段阻断记录，补数重点是新增同尺度样本或扩大来源文献。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="mt-5">
            <div class="flex items-center justify-between">
              <p class="text-sm font-semibold text-slate-950">来源文献分布</p>
              <span class="text-xs text-slate-400">按可训练记录排序</span>
            </div>
            <div class="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200">
              <div
                v-for="row in replenishmentSourceRows.slice(0, 5)"
                :key="row.literatureId"
                class="px-4 py-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <p class="min-w-0 truncate text-sm font-semibold text-slate-900">{{ row.title }}</p>
                  <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    {{ row.trainableCount }} / {{ row.recordCount }}
                  </span>
                </div>
                <p v-if="row.doi" class="mt-1 truncate text-xs text-slate-400">{{ row.doi }}</p>
              </div>
              <p v-if="!replenishmentSourceRows.length" class="px-4 py-8 text-center text-sm text-slate-500">暂无来源文献分布。</p>
            </div>
          </div>

          <div v-if="unknownMacroCandidateRows.length" class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            有 {{ unknownMacroCandidateRows.length }} 条未归类记录疑似宏观摩擦，建议回到 Review 核查尺度。
          </div>
        </section>
      </section>

      <section class="grid gap-4 xl:grid-cols-4">
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <FileText class="h-5 w-5 text-indigo-600" />
            <p class="text-sm font-semibold text-slate-950">文献总数</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ overviewDocumentTotal }}</p>
          <p class="mt-1 text-xs text-slate-500">当前账户中的文献资产</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <Database class="h-5 w-5 text-emerald-600" />
            <p class="text-sm font-semibold text-slate-950">活跃记录</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ overviewActiveRecordTotal }}</p>
          <p class="mt-1 text-xs text-slate-500">排除 rejected / discarded / excluded</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <ListChecks class="h-5 w-5 text-sky-600" />
            <p class="text-sm font-semibold text-slate-950">可训练样本</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ overviewTrainableTotal }}</p>
          <p class="mt-1 text-xs text-slate-500">具备 COF、材料/润滑剂和工况字段</p>
        </div>
        <div class="rounded-[1.35rem] border border-slate-200 bg-white px-5 py-4">
          <div class="flex items-center gap-3">
            <LocateFixed class="h-5 w-5 text-amber-600" />
            <p class="text-sm font-semibold text-slate-950">未审阅记录</p>
          </div>
          <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{{ overviewUnreviewedTotal }}</p>
          <p class="mt-1 text-xs text-slate-500">需要进入 Review 队列</p>
        </div>
      </section>

      <section>
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold tracking-tight text-slate-950">数据资产质量门禁</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">
              面向建库和建模的七个核心指标：字段、单位、DOI、COF、证据、训练样本和审阅覆盖。
            </p>
          </div>
          <p v-if="qualityAssetSummary" class="text-xs font-medium text-slate-400">
            生成时间 {{ qualityAssetSummary.generatedAt }}
          </p>
        </div>

        <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <article
            v-for="metric in assetMetricCards"
            :key="metric.key"
            class="rounded-2xl border px-4 py-4"
            :class="toneClass(metric.tone)"
          >
            <p class="text-sm font-semibold">{{ metric.label }}</p>
            <p class="mt-2 text-3xl font-semibold tracking-tight">{{ metric.value }}</p>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/75">
              <div class="h-full rounded-full" :class="progressClass(metric.tone)" :style="{ width: metricWidth(metric) }"></div>
            </div>
            <p class="mt-3 text-xs leading-5 opacity-85">{{ metric.detail }}</p>
            <p class="mt-2 rounded-xl bg-white/65 px-3 py-2 text-[11px] leading-5 opacity-80">{{ metric.formula }}</p>
          </article>
        </div>
      </section>

      <section v-if="unitIssueRows.length || issuePreviewRows.length" class="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-3">
            <AlertTriangle class="h-5 w-5 text-amber-600" />
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">单位字段体检</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">按工况字段定位可能缺少单位或单位不可识别的位置。</p>
            </div>
          </div>
          <div class="mt-5 divide-y divide-slate-100">
            <div v-for="row in unitIssueRows" :key="row.key" class="py-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-slate-950">{{ row.label }}</p>
                  <p class="mt-1 text-xs text-slate-500">{{ row.issues }} / {{ row.denominator }} 个已填字段疑似有问题</p>
                </div>
                <p class="text-sm font-semibold text-slate-900">{{ formatPercent(row.issues, row.denominator) }}</p>
              </div>
              <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-amber-500" :style="{ width: `${Math.max(4, Math.round((row.rate || 0) * 100))}%` }"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-3">
            <FileSearch class="h-5 w-5 text-rose-600" />
            <div>
              <h2 class="text-lg font-semibold tracking-tight text-slate-950">优先核查样本</h2>
              <p class="mt-1 text-sm leading-6 text-slate-500">展示单位、COF 异常和 DOI 重复的前几个样本。</p>
            </div>
          </div>

          <div class="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th class="px-3 py-3">类型</th>
                  <th class="px-3 py-3">尺度</th>
                  <th class="px-3 py-3">对象</th>
                  <th class="px-3 py-3">说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in issuePreviewRows" :key="row.key" class="border-t border-slate-100">
                  <td class="px-3 py-3">
                    <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{{ row.type }}</span>
                  </td>
                  <td class="px-3 py-3">
                    <span class="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{{ row.scaleLabel || activeQualitySlice?.label || '全部' }}</span>
                  </td>
                  <td class="max-w-[14rem] px-3 py-3">
                    <p class="truncate font-medium text-slate-900">{{ row.label }}</p>
                  </td>
                  <td class="px-3 py-3 text-xs leading-5 text-slate-500">{{ row.detail }}</td>
                </tr>
                <tr v-if="!issuePreviewRows.length">
                  <td colspan="4" class="px-3 py-8 text-center text-sm text-slate-500">当前没有需要优先核查的样本。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
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
                <div class="h-full rounded-full" :class="progressClass(metric.tone)" :style="{ width: metricWidth(metric) }"></div>
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
            <div v-for="row in displayedFieldCategoryRows" :key="row.category" class="py-3">
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
