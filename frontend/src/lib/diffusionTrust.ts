import { formatScientificUnit } from '@/lib/diffusionReview'

type RecordLike = Record<string, any>

export type DiffusionSourceTierId =
  | 'original_source'
  | 'figure_estimate'
  | 'model_candidate'
  | 'needs_evidence'

export type DiffusionNormalizationStateId =
  | 'ready'
  | 'pending'
  | 'warning'
  | 'missing'

export type DiffusionSourceTier = {
  id: DiffusionSourceTierId
  label: string
  shortLabel: string
  description: string
  rank: number
}

export type DiffusionNormalizationState = {
  id: DiffusionNormalizationStateId
  label: string
  shortLabel: string
  description: string
}

export type DiffusionNormalizationWorkbenchRow = {
  id: 'd_total' | 'd_cation' | 'd_anion'
  label: string
  original: string
  canonical: string
  si: string
  a2ps: string
  status: string
  statusLabel: string
  note: string
  source: string
  isPrimary: boolean
}

export type DiffusionNormalizationWorkbench = {
  state: DiffusionNormalizationState
  title: string
  summary: string
  canonicalUnit: string
  canonicalUnitSi: string
  readyCount: number
  warningCount: number
  totalCount: number
  primary: DiffusionNormalizationWorkbenchRow | null
  rows: DiffusionNormalizationWorkbenchRow[]
  blockers: string[]
}

const COEFFICIENT_KEYS = ['d_total', 'd_cation', 'd_anion'] as const
const COEFFICIENT_RECORD_KEYS = ['D_total', 'D_cation', 'D_anion'] as const
const COEFFICIENT_CONFIG = [
  { id: 'd_total', recordKey: 'D_total', label: 'D total' },
  { id: 'd_cation', recordKey: 'D_cation', label: 'D+' },
  { id: 'd_anion', recordKey: 'D_anion', label: 'D-' },
] as const

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function plainObject(value: unknown): RecordLike {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RecordLike : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {}
}

function evidenceFromEntry(entry: unknown): RecordLike {
  return plainObject(plainObject(entry).evidence)
}

function fieldEvidenceMap(record: RecordLike, remoteFields?: RecordLike | null): RecordLike {
  return {
    ...plainObject(record.field_evidence_json || record.fieldEvidenceJson),
    ...plainObject(remoteFields),
  }
}

function coefficientEntries(record: RecordLike, remoteFields?: RecordLike | null) {
  const fieldMap = fieldEvidenceMap(record, remoteFields)
  return COEFFICIENT_KEYS.map((key) => plainObject(fieldMap[key])).filter((entry) => Object.keys(entry).length)
}

function hasCoefficient(record: RecordLike) {
  return COEFFICIENT_RECORD_KEYS.some((key) => {
    const value = record[key]
    return value !== null && value !== undefined && clean(value) !== ''
  })
}

function entrySourceType(entry: RecordLike) {
  return clean(evidenceFromEntry(entry).source_type || evidenceFromEntry(entry).sourceType).toLowerCase()
}

function entryGroundingMode(entry: RecordLike) {
  return clean(entry.grounding_mode || entry.groundingMode).toLowerCase()
}

function normalizationPayload(record: RecordLike, remotePayload?: RecordLike | null): RecordLike {
  const features = plainObject(record.novel_features_json || record.novelFeaturesJson)
  return {
    ...plainObject(features.diffusion_normalization || features.diffusionNormalization),
    ...plainObject(record.diffusion_normalization || record.diffusionNormalization),
    ...plainObject(remotePayload?.diffusion_normalization || remotePayload?.diffusionNormalization),
  }
}

function coefficientPayloads(payload: RecordLike): RecordLike {
  return plainObject(payload.coefficients)
}

function numberFromKeys(source: RecordLike, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toSuperscript(value: string) {
  const map: Record<string, string> = {
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
    '-': '⁻',
    '+': '⁺',
  }
  return Array.from(value).map((char) => map[char] || char).join('')
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--'
  return `${Number(value).toPrecision(6)}`.replace(/\.?0+e/, 'e').replace(/\.?0+$/, '')
}

function formatScientificScalar(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--'
  const numeric = Number(value)
  if (numeric === 0) return '0'
  const exponent = Math.floor(Math.log10(Math.abs(numeric)))
  const mantissa = numeric / Math.pow(10, exponent)
  return `${formatNumber(mantissa)} × 10${toSuperscript(String(exponent))}`
}

function prettifyDiffusionLabel(value: unknown) {
  const text = clean(value)
  if (!text) return '--'
  return formatScientificUnit(text)
    .replace(/\s*[x*×]\s*10\s*(?:\^\s*)?([+\-−]?\s*\d+)/gi, (_match, exponent: string) => ` × 10${toSuperscript(clean(exponent).replace('−', '-').replace(/\s+/g, ''))}`)
    .replace(/\s+/g, ' ')
    .trim()
}

function coefficientStatusLabel(status: string) {
  if (status === 'normalized') return '已归一'
  if (status === 'unit_warning') return '单位疑'
  if (status === 'pending') return '待归一'
  return '缺数值'
}

function fallbackOriginalLabel(record: RecordLike, recordKey: string) {
  const value = record[recordKey]
  if (value === null || value === undefined || clean(value) === '') return '--'
  return prettifyDiffusionLabel([value, record.D_unit].filter((item) => clean(item)).join(' '))
}

function buildNormalizationRow(
  record: RecordLike,
  payload: RecordLike,
  config: typeof COEFFICIENT_CONFIG[number],
  primaryField: string,
): DiffusionNormalizationWorkbenchRow | null {
  const coefficients = coefficientPayloads(payload)
  const coefficient = plainObject(coefficients[config.id])
  const hasPayload = Object.keys(coefficient).length > 0
  const hasRecordValue = record[config.recordKey] !== null
    && record[config.recordKey] !== undefined
    && clean(record[config.recordKey]) !== ''

  if (!hasPayload && !hasRecordValue) return null

  const status = clean(coefficient.status).toLowerCase() || (hasPayload ? 'missing' : 'pending')
  const original = prettifyDiffusionLabel(
    coefficient.original_label
    || coefficient.originalLabel
    || [coefficient.original_value ?? coefficient.originalValue, coefficient.original_unit ?? coefficient.originalUnit]
      .filter((item) => clean(item))
      .join(' ')
    || fallbackOriginalLabel(record, config.recordKey),
  )
  const canonicalValue = numberFromKeys(coefficient, 'value_10e12_m2_s', 'value10e12M2S', 'canonical_value', 'canonicalValue')
  const siValue = numberFromKeys(coefficient, 'value_m2_s', 'valueM2S')
  const a2psValue = numberFromKeys(coefficient, 'value_a2_ps', 'valueA2Ps')
  const canonicalUnit = clean(coefficient.canonical_unit || coefficient.canonicalUnit || payload.canonical_unit || payload.canonicalUnit) || '10⁻¹² m²/s'
  const canonicalLabel = clean(coefficient.canonical_label || coefficient.canonicalLabel)

  return {
    id: config.id,
    label: clean(coefficient.label) || config.label,
    original,
    canonical: canonicalValue == null
      ? (canonicalLabel ? prettifyDiffusionLabel(canonicalLabel) : '--')
      : `${formatNumber(canonicalValue)} × ${formatScientificUnit(canonicalUnit)}`,
    si: siValue == null ? '--' : `${formatScientificScalar(siValue)} m²/s`,
    a2ps: a2psValue == null ? '--' : `${formatScientificScalar(a2psValue)} Å²/ps`,
    status,
    statusLabel: coefficientStatusLabel(status),
    note: clean(coefficient.note),
    source: clean(coefficient.source) || (hasPayload ? 'normalization' : 'record'),
    isPrimary: primaryField === config.id,
  }
}

function workbenchTitle(state: DiffusionNormalizationState) {
  if (state.id === 'ready') return '可入库单位'
  if (state.id === 'warning') return '单位需要确认'
  if (state.id === 'missing') return '无法归一化'
  return '等待归一化'
}

function workbenchBlockers(state: DiffusionNormalizationState, rows: DiffusionNormalizationWorkbenchRow[], warnings: unknown) {
  if (state.id === 'ready') return []
  if (state.id === 'warning') {
    const warningList = Array.isArray(warnings) ? warnings.map(clean).filter(Boolean) : []
    return warningList.length ? warningList : rows.map((row) => row.note).filter(Boolean)
  }
  if (state.id === 'missing') return ['缺少可换算的扩散系数或单位。']
  return ['等待归一化结果生成，先保留原文值，不要覆盖原始记录。']
}

export function classifyDiffusionSourceTier(
  recordInput: unknown,
  remoteFields?: RecordLike | null,
): DiffusionSourceTier {
  const record = plainObject(recordInput)
  const origin = clean(record.record_origin || record.recordOrigin).toLowerCase()
  const entries = coefficientEntries(record, remoteFields)
  const sourceTypes = entries.map(entrySourceType)
  const groundingModes = entries.map(entryGroundingMode)

  if (origin.includes('manual_figure_estimate') || sourceTypes.some((source) => ['figure', 'visual', 'image'].includes(source))) {
    return {
      id: 'figure_estimate',
      label: '图表估读',
      shortLabel: '图估',
      description: '来自图、曲线或人工估读，入库前保留页码和图号。',
      rank: 2,
    }
  }

  if (sourceTypes.some((source) => ['table', 'text'].includes(source)) && !groundingModes.every((mode) => mode === 'inferred')) {
    return {
      id: 'original_source',
      label: '原文摘录',
      shortLabel: '原文',
      description: '数值能定位到正文或表格，可优先审阅。',
      rank: 1,
    }
  }

  if (hasCoefficient(record)) {
    return {
      id: 'model_candidate',
      label: '模型候选',
      shortLabel: '候选',
      description: '已有扩散值，但还需要人工确认原文证据。',
      rank: 3,
    }
  }

  return {
    id: 'needs_evidence',
    label: '待补证据',
    shortLabel: '待补',
    description: '缺少可审阅的扩散系数或来源证据。',
    rank: 4,
  }
}

export function classifyDiffusionNormalizationState(
  recordInput: unknown,
  remotePayload?: RecordLike | null,
): DiffusionNormalizationState {
  const record = plainObject(recordInput)
  const payload = normalizationPayload(record, remotePayload)
  const status = clean(payload.status).toLowerCase()
  const primary = plainObject(payload.primary)
  const primaryStatus = clean(primary.status).toLowerCase()

  if (status === 'ready' || primaryStatus === 'normalized') {
    return {
      id: 'ready',
      label: '已归一化',
      shortLabel: '已归一',
      description: '已经生成统一单位，可进入入库前确认。',
    }
  }

  if (status === 'unit_warning' || primaryStatus === 'unit_warning') {
    return {
      id: 'warning',
      label: '单位异常',
      shortLabel: '单位疑',
      description: '原始单位需要人工检查，暂不建议直接入库。',
    }
  }

  if (!hasCoefficient(record) || status === 'missing') {
    return {
      id: 'missing',
      label: '无法换算',
      shortLabel: '缺数值',
      description: '缺少扩散系数或单位，无法生成统一值。',
    }
  }

  return {
    id: 'pending',
    label: '待归一化',
    shortLabel: '待归一',
    description: '已保留原文数值，统一单位还未确认。',
  }
}

export function buildDiffusionNormalizationWorkbench(
  recordInput: unknown,
  remotePayload?: RecordLike | null,
): DiffusionNormalizationWorkbench {
  const record = plainObject(recordInput)
  const payload = normalizationPayload(record, remotePayload)
  const state = classifyDiffusionNormalizationState(record, remotePayload)
  const primaryField = clean(payload.primary_field || payload.primaryField)
  const rows = COEFFICIENT_CONFIG
    .map((config) => buildNormalizationRow(record, payload, config, primaryField))
    .filter((row): row is DiffusionNormalizationWorkbenchRow => Boolean(row))
  const primary = rows.find((row) => row.isPrimary)
    || rows.find((row) => row.status === 'normalized')
    || rows.find((row) => row.status === 'unit_warning')
    || rows[0]
    || null
  const readyCount = Number(payload.ready_count ?? payload.readyCount ?? rows.filter((row) => row.status === 'normalized').length)
  const warningCount = Number(payload.warning_count ?? payload.warningCount ?? rows.filter((row) => row.status === 'unit_warning').length)
  const blockers = workbenchBlockers(state, rows, payload.warnings)

  return {
    state,
    title: workbenchTitle(state),
    summary: primary
      ? `${primary.label}: ${primary.original} → ${primary.canonical}`
      : state.description,
    canonicalUnit: formatScientificUnit(clean(payload.canonical_unit || payload.canonicalUnit) || '10^-12 m2/s'),
    canonicalUnitSi: formatScientificUnit(clean(payload.canonical_unit_si || payload.canonicalUnitSi) || 'm2/s'),
    readyCount: Number.isFinite(readyCount) ? readyCount : 0,
    warningCount: Number.isFinite(warningCount) ? warningCount : 0,
    totalCount: rows.length,
    primary,
    rows,
    blockers,
  }
}
