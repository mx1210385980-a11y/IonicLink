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

const COEFFICIENT_KEYS = ['d_total', 'd_cation', 'd_anion'] as const
const COEFFICIENT_RECORD_KEYS = ['D_total', 'D_cation', 'D_anion'] as const

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
