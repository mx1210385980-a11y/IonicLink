import { formatTribopairLabel, type EvidenceResult, type LubricantComponent, type RecordResponse } from '@/lib/api'
import { normalizePotentialDisplayText } from '@/lib/potential'

export type ConfidenceLineItem = {
  reason: string
  value: number
}

export type ConfidenceDetailsView = {
  base_score: number
  base_percent: number
  score: number
  percent: number
  penalties: ConfidenceLineItem[]
  boosts: ConfidenceLineItem[]
  penalty_total: number
  penalty_percent: number
  boost_total: number
  boost_percent: number
}

export type ConditionGroupTone = 'env' | 'dyn' | 'surf'

export type ConditionGroup = {
  key: ConditionGroupTone
  label: string
  summary: string
  title: string
}

export type SurfaceRoughnessBadgeTone = 'specified' | 'estimated'

export type SurfaceRoughnessBadge = {
  label: string
  tone: SurfaceRoughnessBadgeTone
}

export function cofDisplay(record: RecordResponse): string {
  if (record.cofValue != null && !isNaN(Number(record.cofValue))) {
    return Number(record.cofValue).toFixed(4)
  }
  if (record.cofRaw) return record.cofRaw
  return '--'
}

export function confidenceDisplay(conf: number | null | undefined): string {
  const value = Number(conf ?? 0)
  return `${Math.round(value * 100)}%`
}

export function confidencePenaltyLabel(reason: string): string {
  const labels: Record<string, string> = {
    missing_source: 'Missing source label',
    missing_page: 'Missing source page',
    missing_evidence: 'Missing evidence quote or bbox',
    text_only_source: 'Only text source available',
    inferred_source: 'Source inferred from context',
    missing_value: 'Missing extracted value',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

export function confidencePenaltyValue(value: number | null | undefined): string {
  return `-${Math.round(Math.abs(Number(value || 0)) * 100)}`
}

export function confidenceBoostLabel(reason: string): string {
  const labels: Record<string, string> = {
    evidence_quote_present: 'Evidence quote present',
    evidence_bbox_present: 'Evidence bbox present',
    explicit_page_reference: 'Page-level grounding',
    explicit_source_label: 'Explicit figure/table label',
    verified_pdf_match: 'Verified PDF match',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

export function confidenceBoostValue(value: number | null | undefined): string {
  return `+${Math.round(Math.abs(Number(value || 0)) * 100)}`
}

export function confidencePercentNumber(conf: number | null | undefined): number {
  return Math.max(0, Math.min(100, Number(conf ?? 0) * 100))
}

export function hasEvidenceText(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim())
}

export function hasEvidenceBBox(value: number[] | string | null | undefined): boolean {
  return Array.isArray(value) ? value.length === 4 : Boolean(String(value || '').trim())
}

export function normalizeConfidenceDetails(details?: RecordResponse['confidenceDetails'] | null): ConfidenceDetailsView {
  const penalties = Array.isArray(details?.penalties) ? details.penalties.map((item) => ({
    reason: String(item.reason || 'unknown'),
    value: Number(item.value || 0),
  })) : []
  const boosts = Array.isArray(details?.boosts) ? details.boosts.map((item) => ({
    reason: String(item.reason || 'unknown'),
    value: Number(item.value || 0),
  })) : []
  const baseScore = Number(details?.base_score ?? 1)
  const penaltyTotal = penalties.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const boostTotal = boosts.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const score = Math.max(0.05, Math.min(1, baseScore - penaltyTotal + boostTotal))
  return {
    base_score: baseScore,
    base_percent: Number((baseScore * 100).toFixed(1)),
    score: Number(score.toFixed(4)),
    percent: Number((score * 100).toFixed(1)),
    penalties,
    boosts,
    penalty_total: Number(penaltyTotal.toFixed(4)),
    penalty_percent: Number((penaltyTotal * 100).toFixed(1)),
    boost_total: Number(boostTotal.toFixed(4)),
    boost_percent: Number((boostTotal * 100).toFixed(1)),
  }
}

export function confidenceDetailsFor(record: RecordResponse, evidence?: EvidenceResult | null): ConfidenceDetailsView {
  const base = normalizeConfidenceDetails(record.confidenceDetails)
  const ev = evidence || null
  if (!ev) return base
  const hasSource = !!String(ev?.source || record.source || record.sourceFigure || '').trim()
  const hasPage = !!(ev?.page || record.sourcePage || record.evidencePage)
  const hasGroundedEvidence =
    hasEvidenceText(ev?.text_snippet) ||
    hasEvidenceText(ev?.evidence_text) ||
    hasEvidenceText(record.evidence) ||
    hasEvidenceBBox(ev?.bbox) ||
    hasEvidenceBBox(record.evidenceBbox)

  const penalties = base.penalties.filter((penalty) => {
    if (penalty.reason === 'missing_source' && hasSource) return false
    if (penalty.reason === 'missing_source_page' && hasPage) return false
    if (penalty.reason === 'missing_evidence' && hasGroundedEvidence) return false
    return true
  })

  return normalizeConfidenceDetails({
    ...base,
    penalties,
    penalty_total: penalties.reduce((sum, item) => sum + Number(item.value || 0), 0),
    penalty_percent: penalties.reduce((sum, item) => sum + Number(item.value || 0), 0) * 100,
  })
}

export function confidenceValueFor(record: RecordResponse, evidence?: EvidenceResult | null): number {
  return confidenceDetailsFor(record, evidence).score
}

export function confidenceDeltaPercent(record: RecordResponse, evidence?: EvidenceResult | null): number {
  return Number(((confidenceValueFor(record, evidence) - Number(record.confidence || 0)) * 100).toFixed(1))
}

export function applyLiveConfidence(record: RecordResponse, evidence?: EvidenceResult | null): number {
  const previousStoredScore = Number(record.confidence || 0)
  const liveDetails = confidenceDetailsFor(record, evidence)
  record.confidence = liveDetails.score
  record.confidenceDetails = {
    base_score: liveDetails.base_score,
    base_percent: liveDetails.base_percent,
    score: liveDetails.score,
    percent: liveDetails.percent,
    penalties: liveDetails.penalties,
    boosts: liveDetails.boosts,
    penalty_total: liveDetails.penalty_total,
    penalty_percent: liveDetails.penalty_percent,
    boost_total: liveDetails.boost_total,
    boost_percent: liveDetails.boost_percent,
  }
  return previousStoredScore
}

export function conditionGroupClass(key: ConditionGroupTone): string {
  const classes: Record<ConditionGroupTone, string> = {
    env: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300',
    dyn: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300',
    surf: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return classes[key]
}

export function surfaceRoughnessBadgeClass(tone: SurfaceRoughnessBadgeTone): string {
  const classes: Record<SurfaceRoughnessBadgeTone, string> = {
    specified: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    estimated: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  }
  return classes[tone]
}

export function normalizeTraceDisplayText(input: string | null | undefined): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/渭/g, 'μ')
    .replace(/碌/g, 'μ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2')  // 数字间的连字符换成 en-dash 更紧凑
    .trim()
}

/**
 * 把"6.5 μm/s"或"0–100 nN"或"<2 nm RMS"拆成数字部分和单位部分，
 * 给前端做"数字加粗 + 单位变小"的样式分级。
 */
export function splitNumberAndUnit(text: string): { number: string; unit: string } {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { number: '', unit: '' }
  // 抓取前导：可选 < > ≈ ~ ± ≤ ≥ 符号 + 数字（含小数 / 区间 / 科学计数法）
  const match = trimmed.match(/^([<>≈~±≤≥]?\s*[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*[–\-~]\s*[-+]?\d+(?:\.\d+)?)?\s*%?)\s*(.*)$/)
  if (!match) return { number: trimmed, unit: '' }
  const number = (match[1] || '').trim()
  const unit = (match[2] || '').trim()
  // 数字部分必须真的有数字字符；否则视为整段都是文本（如 "Sphere"、"Tip"）
  if (!/\d/.test(number)) return { number: trimmed, unit: '' }
  return { number, unit }
}

/** 清理水含量字段里的 "IL-" 等数据前缀，仅保留 "0%" 这种主体值 */
function cleanWaterContent(text: string): string {
  return String(text || '')
    .replace(/^IL[-_]?/i, '')
    .trim()
}

function summarizeConditionGroup(items: string[], maxItems: number = 2): string {
  const filtered = items.filter(Boolean)
  if (!filtered.length) return ''
  if (filtered.length <= maxItems) return filtered.join(' · ')
  return `${filtered.slice(0, maxItems).join(' · ')} +${filtered.length - maxItems}`
}

export function conditionGroups(record: RecordResponse): ConditionGroup[] {
  const groups: ConditionGroup[] = [
    {
      key: 'env',
      label: 'ENV',
      summary: summarizeConditionGroup([
        record.temperature ? `${normalizeTraceDisplayText(record.temperature)}` : '',
        record.waterContent ? `${normalizeTraceDisplayText(record.waterContent)}` : '',
        record.potential ? normalizePotentialDisplayText(record.potential) : '',
      ]),
      title: 'Environmental conditions',
    },
    {
      key: 'dyn',
      label: 'DYN',
      summary: summarizeConditionGroup([
        record.speedValue ? `${normalizeTraceDisplayText(record.speedValue)}` : '',
        record.shearRate ? `剪切率 ${normalizeTraceDisplayText(record.shearRate)}` : '',
        record.loadValue ? `${normalizeTraceDisplayText(record.loadValue)}` : '',
      ]),
      title: 'Dynamic conditions',
    },
    {
      key: 'surf',
      label: 'SURF',
      summary: summarizeConditionGroup([
        record.probeGeometry ? `${record.probeGeometry}` : '',
        record.probeRadius ? `${record.probeRadius}` : '',
        record.probeRoughness ? `Probe ${record.probeRoughness}` : '',
        record.substrateCoating ? `${record.substrateCoating}` : '',
        String(record.filmThickness || '').trim() ? `${record.filmThickness}` : '',
      ]),
      title: 'Surface descriptors',
    },
  ]
  return groups.filter((group) => Boolean(group.summary))
}

export type DetailedConditionChip = {
  key: string
  label: string
  full: string
  shortcut?: string
  tone: ConditionGroupTone
  title: string
}

export type DetailedConditionChipDisplay = {
  label: string
  value: string
  unit: string
}

function compactScientificUnit(unit: string): string {
  const normalized = String(unit || '').trim()
  if (!normalized) return ''
  if (/^uN$/i.test(normalized)) return 'μN'
  if (/^um\/s$/i.test(normalized)) return 'μm/s'
  if (/^s\s*(?:\^\s*)?[-−]?\s*1$/i.test(normalized) || /^s[−-]1$/i.test(normalized) || normalized === 's⁻¹') {
    return 's^-1'
  }
  return normalized
}

function extractValueWithUnit(text: string, units: string[]): { value: string, unit: string } | null {
  const unitPattern = units.map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const match = text.match(new RegExp(`([<>≈~±≤≥]?\\s*[-+]?\\d+(?:\\.\\d+)?(?:\\s*[–\\-~]\\s*[-+]?\\d+(?:\\.\\d+)?)?)\\s*(${unitPattern})\\b`, 'i'))
  if (!match) return null
  return {
    value: normalizeTraceDisplayText(match[1] || ''),
    unit: compactScientificUnit(match[2] || ''),
  }
}

function extractShearRate(text: string): { value: string, unit: string } | null {
  const normalized = normalizeTraceDisplayText(text)
  const match = normalized.match(/([<>≈~±≤≥]?\s*[-+]?\d+(?:\.\d+)?(?:\s*[–\-~]\s*[-+]?\d+(?:\.\d+)?)?)\s*(s\s*(?:\^\s*)?[-−]?\s*1|s[−-]1|s⁻¹)\b/i)
  if (match) {
    return {
      value: normalizeTraceDisplayText(match[1] || ''),
      unit: compactScientificUnit(match[2] || ''),
    }
  }

  if (!/shear\s*rate/i.test(normalized)) return null
  const fallback = normalized.match(/([<>≈~±≤≥]?\s*[-+]?\d+(?:\.\d+)?(?:\s*[–\-~]\s*[-+]?\d+(?:\.\d+)?)?)/)
  if (!fallback) return null
  return {
    value: normalizeTraceDisplayText(fallback[1] || ''),
    unit: 's^-1',
  }
}

function conditionValueIsBareNumber(text: string): boolean {
  return /^[<>≈~±≤≥]?\s*[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*[–\-~]\s*[-+]?\d+(?:\.\d+)?)?\s*%?$/.test(String(text || '').trim())
}

export function conditionChipDisplayParts(chip: DetailedConditionChip, fallback?: string): DetailedConditionChipDisplay {
  const raw = normalizeTraceDisplayText(fallback || chip.full)
  const lower = raw.toLowerCase()

  if (chip.key === 'speed' || chip.key === 'shear_rate') {
    const shearRate = extractShearRate(raw)
    if (shearRate) {
      return { label: '剪切率', value: shearRate.value, unit: shearRate.unit }
    }
  }

  if (chip.key === 'load') {
    const measuredLoad = extractValueWithUnit(raw, ['nN', 'μN', 'µN', 'uN', 'mN'])
    if (/\blow\s+load\b/i.test(raw)) {
      return {
        label: '低载荷',
        value: measuredLoad ? measuredLoad.value.replace(/^~\s*/, '≤') : '低载荷',
        unit: measuredLoad?.unit || '',
      }
    }
    if (/\bhigh\s+load\b/i.test(raw)) {
      return {
        label: '高载荷',
        value: measuredLoad?.value || (lower.includes('squeeze') ? 'squeeze-out' : '高载荷'),
        unit: measuredLoad?.unit || '',
      }
    }
  }

  const parsed = splitNumberAndUnit(raw)
  const inferredUnits: Partial<Record<string, string>> = {
    potential: 'V',
    speed: 'μm/s',
    shear_rate: 's^-1',
    load: 'nN',
  }
  const inferredUnit = parsed.unit
    ? compactScientificUnit(parsed.unit)
    : conditionValueIsBareNumber(parsed.number)
      ? inferredUnits[chip.key] || ''
      : ''

  return {
    label: chip.label,
    value: parsed.number,
    unit: inferredUnit,
  }
}

function parseTempCelsius(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  const numeric = parseFloat(match[1]!)
  if (!Number.isFinite(numeric)) return null
  // 出现"K"或者数值 > 200 视作开尔文，否则视作摄氏度
  if (/k\b/i.test(trimmed) || numeric > 200) return numeric - 273.15
  return numeric
}

function tempShortcut(text: string): string | undefined {
  const c = parseTempCelsius(text)
  if (c == null) return undefined
  if (c >= 15 && c <= 35) return '室温'
  return undefined
}

function potentialShortcut(text: string): string | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  if (/^[-+]?0+(?:\.0+)?\s*v?$/i.test(t)) return '0 V'
  if (/^0+(?:\.0+)?\s*v\s+vs\s+ocp$/i.test(t)) return 'OCP'
  if (t.includes('ocv') || t.includes('open circuit')) return '开路'
  return undefined
}

function waterShortcut(text: string): string | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  if (t.includes('anhydrous') || t === 'dry') return '干燥'
  if (/^0\s*%?$/.test(t)) return '干燥'
  if (/^<\s*1\s*%/.test(t)) return '<1%'
  return undefined
}

export function detailedConditionChips(record: RecordResponse): DetailedConditionChip[] {
  const chips: DetailedConditionChip[] = []

  const temperature = String(record.temperature || '').trim()
  if (temperature) {
    const full = normalizeTraceDisplayText(temperature)
    chips.push({ key: 'temperature', label: '温度', full, shortcut: tempShortcut(full), tone: 'env', title: '温度' })
  }

  const potential = String(record.potential || '').trim()
  if (potential) {
    const full = normalizePotentialDisplayText(potential)
    chips.push({ key: 'potential', label: '电势', full, shortcut: potentialShortcut(full), tone: 'env', title: '外加电势' })
  }

  const water = String(record.waterContent || '').trim()
  if (water) {
    const full = normalizeTraceDisplayText(cleanWaterContent(water))
    chips.push({ key: 'water', label: '含水', full, shortcut: waterShortcut(full), tone: 'env', title: '含水量' })
  }

  const speed = String(record.speedValue || '').trim()
  if (speed) {
    chips.push({ key: 'speed', label: '速度', full: normalizeTraceDisplayText(speed), tone: 'dyn', title: '滑动速度' })
  }

  const shearRate = String(record.shearRate || '').trim()
  if (shearRate) {
    chips.push({ key: 'shear_rate', label: '剪切率', full: normalizeTraceDisplayText(shearRate), tone: 'dyn', title: '剪切率' })
  }

  const load = String(record.loadValue || '').trim()
  if (load) {
    chips.push({ key: 'load', label: '载荷', full: normalizeTraceDisplayText(load), tone: 'dyn', title: '法向载荷' })
  }

  // 注意：探针几何 / 探针半径 / 探针粗糙度 / 膜厚 不再放在"实验条件"里，
  // 它们逻辑上属于探针/基底物理属性，由 RecordTable 的"摩擦副"列负责渲染。

  return chips
}

export type TribopairExtras = {
  probeDetails: string  // 例如 "Tip · 8 nm"，用于显示在探针名下方
  filmThickness: string  // 例如 "RMS 0.89 nm"
}

export function tribopairExtras(record: RecordResponse): TribopairExtras {
  const pieces: string[] = []
  const geometry = String(record.probeGeometry || '').trim()
  const radius = String(record.probeRadius || '').trim()
  const probeRoughness = String(record.probeRoughness || '').trim()
  if (geometry) pieces.push(geometry)
  if (radius) pieces.push(radius)
  if (probeRoughness) pieces.push(probeRoughness)
  return {
    probeDetails: pieces.join(' · '),
    filmThickness: String(record.filmThickness || '').trim(),
  }
}

export function surfaceRoughnessBadge(record: RecordResponse): SurfaceRoughnessBadge | null {
  const raw = String(record.surfaceRoughness || record.substrateRoughness || '').trim()
  if (!raw) return null
  const lowered = raw.toLowerCase()
  if (lowered.includes('atomically flat') || lowered.includes('estimated')) {
    return { label: raw, tone: 'estimated' }
  }
  return { label: raw, tone: 'specified' }
}

function normalizeOptionalTagValue(value: string | null | undefined): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.toLowerCase() === 'none') return ''
  return normalized
}

export function tribopairParts(record: RecordResponse): { probe: string, substrate: string, coating: string } {
  return {
    probe: String(record.probeMaterial || '').trim() || 'Probe N/A',
    substrate: String(record.substrateMaterial || record.materialName || '').trim() || 'Substrate N/A',
    coating: normalizeOptionalTagValue(record.substrateCoating),
  }
}

export function tribopairDisplay(record: RecordResponse): string {
  return formatTribopairLabel({
    probeMaterial: record.probeMaterial,
    substrateMaterial: record.substrateMaterial,
    substrateCoating: record.substrateCoating,
    materialName: record.materialName,
  })
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function recordLubricantRaw(record: RecordResponse): string {
  return String(record.lubricant ?? (record as any).ionic_liquid ?? '').trim()
}

function recordLubricantAlias(record: RecordResponse): string {
  return String(record.lubricantAlias ?? (record as any).lubricant_alias ?? '').trim()
}

function canonicalIonToken(token: string): string {
  const trimmed = String(token || '').trim()
  const phosphonium = trimmed.match(/^([PNpn])(\d+)$/)
  if (!phosphonium) return trimmed
  const head = phosphonium[1]?.toUpperCase() || ''
  const digits = phosphonium[2] || ''
  if (digits.length === 4) {
    return `${head}${digits.split('').join(',')}`
  }
  if (digits.length === 5) {
    return `${head}${digits.slice(0, 1)},${digits.slice(1, 2)},${digits.slice(2, 3)},${digits.slice(3)}`
  }
  return trimmed
}

function canonicalIonicLiquidLabel(input: string): string {
  return String(input || '').replace(/\[([PNpn]\d+)\]/g, (_match, token) => `[${canonicalIonToken(token)}]`)
}

const CATION_STRUCTURE_SMILES: Record<string, string> = {
  emim: 'CCn1cc[n+](C)c1',
  bmim: 'CCCCn1cc[n+](C)c1',
  hmim: 'CCCCCCn1cc[n+](C)c1',
  omim: 'CCCCCCCCn1cc[n+](C)c1',
  mmim: 'Cn1cc[n+](C)c1',
  pyr13: 'CCC[N+]1(C)CCCC1',
  pyr14: 'CCCC[N+]1(C)CCCC1',
  pyr15: 'CCCCC[N+]1(C)CCCC1',
  pip14: 'CCCC[N+]1(C)CCCCC1',
  p66614: 'CCCCCCCCCCCCCC[P+](CCCCCC)(CCCCCC)CCCCCC',
  p4441: 'C[P+](CCCC)(CCCC)CCCC',
  p4444: 'CCCC[P+](CCCC)(CCCC)CCCC',
  p4448: 'CCCCCCCC[P+](CCCC)(CCCC)CCCC',
  n4444: 'CCCC[N+](CCCC)(CCCC)CCCC',
  ea: 'CC[NH3+]',
  pa: 'CCC[NH3+]',
  dmea: 'CC[NH+](C)C',
  mor11: 'C[N+]1(C)CCOCC1',
}

const ANION_STRUCTURE_SMILES: Record<string, string> = {
  pf6: 'F[P-](F)(F)(F)(F)F',
  bf4: 'F[B-](F)(F)F',
  tfsi: 'O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F',
  bob: '[B-]1(OC(=O)C(=O)O1)OC(=O)C(=O)O',
  bmb: '[B-]1(OC(=O)CC(=O)O1)OC(=O)CC(=O)O',
  cl: '[Cl-]',
  br: '[Br-]',
  i: '[I-]',
  dca: 'N#C[N-]C#N',
  otf: 'O=S(=O)([O-])C(F)(F)F',
  fap: 'F[P-](F)(F)(C(F)(F)F)(C(F)(F)F)C(F)(F)F',
  ac: 'CC([O-])=O',
  scn: '[S-]C#N',
  no3: '[O-][N+](=O)[O-]',
  bscb: '[B-]1(OC2=CC=CC=C2C(=O)O1)OC3=CC=CC=C3C(=O)O',
  aot: 'CCCCC(CC)COC(=O)CC(C(=O)OCC(CCCC)CC)S([O-])(=O)=O',
  doc: 'CCCCC(CC)COC(=O)CC(C(=O)OCC(CCCC)CC)S([O-])(=O)=O',
  ds: 'CCCCCCCCCCCCOS([O-])(=O)=O',
  etso4: 'CCOS([O-])(=O)=O',
  oms: 'CS([O-])(=O)=O',
  f: '[F-]',
}

const CATION_STRUCTURE_ALIASES: Record<string, string> = {
  c2mim: 'emim',
  c4mim: 'bmim',
  c6mim: 'hmim',
  c8mim: 'omim',
  p66614: 'p66614',
  p66614plus: 'p66614',
}

const ANION_STRUCTURE_ALIASES: Record<string, string> = {
  bta: 'tfsi',
  ntf2: 'tfsi',
  tf2n: 'tfsi',
  bistrifluoromethanesulfonylimide: 'tfsi',
  bistrifluoromethylsulfonylimide: 'tfsi',
  bistrifluoromethanesulfonamide: 'tfsi',
  doc: 'doc',
  docusate: 'doc',
  docminus: 'doc',
  etso4: 'etso4',
  ethylsulfate: 'etso4',
  c2h5so4: 'etso4',
  aot: 'aot',
  dioctylsulfosuccinate: 'aot',
}

export type IonStructureRole = 'cation' | 'anion'

export type IonStructurePreviewItem = {
  key: string
  role: IonStructureRole
  token: string
  label: string
  smiles: string | null
}

export type LubricantStructurePair = {
  key: string
  label: string
  cation: IonStructurePreviewItem
  anion: IonStructurePreviewItem
}

export type LubricantStructureLayout = {
  kind: 'single' | 'shared-cation' | 'component-pairs'
  ratioLabel: string
  pairs: LubricantStructurePair[]
  cation?: IonStructurePreviewItem
  anions?: IonStructurePreviewItem[]
}

function normalizeStructureIonKey(input: string): string {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeCationStructureKey(input: string): string {
  const key = normalizeStructureIonKey(input)
  return CATION_STRUCTURE_ALIASES[key] || key
}

function normalizeAnionStructureKey(input: string): string {
  const key = normalizeStructureIonKey(input)
  return ANION_STRUCTURE_ALIASES[key] || key
}

function parseIonicLiquidCompound(compound: string) {
  const match = String(compound || '').trim().match(/^\[([^\]]+)\]\s*\[([^\]]+)\](\d+)?$/)
  if (!match) return null
  const cationToken = match[1] || ''
  const anionToken = match[2] || ''
  const anionCount = match[3] || ''
  return {
    cationToken,
    anionToken,
    cationKey: normalizeCationStructureKey(cationToken),
    anionKey: normalizeAnionStructureKey(anionToken),
    cationLabel: `[${canonicalIonToken(cationToken)}]`,
    anionLabel: `[${anionToken}]${anionCount}`,
    label: canonicalIonicLiquidLabel(`[${cationToken}][${anionToken}]${anionCount}`),
  }
}

function recordCationKey(record: RecordResponse): string {
  return normalizeCationStructureKey(String(record.cation || (record as any).cation_raw || ''))
}

function recordAnionKey(record: RecordResponse): string {
  return normalizeAnionStructureKey(String(record.anion || (record as any).anion_raw || ''))
}

function resolveCationStructureSmiles(key: string, record: RecordResponse, useRecordFallback: boolean): string | null {
  const direct = CATION_STRUCTURE_SMILES[key]
  if (direct) return direct
  const recordKey = recordCationKey(record)
  if (record.cationSmiles && (key === recordKey || useRecordFallback)) return record.cationSmiles
  return null
}

function resolveAnionStructureSmiles(key: string, record: RecordResponse): string | null {
  const direct = ANION_STRUCTURE_SMILES[key]
  if (direct) return direct
  const recordKey = recordAnionKey(record)
  if (record.anionSmiles && key === recordKey) return record.anionSmiles
  return null
}

function structureItem(
  role: IonStructureRole,
  token: string,
  key: string,
  label: string,
  smiles: string | null,
): IonStructurePreviewItem {
  return {
    role,
    token,
    key: `${role}:${key || token}`,
    label,
    smiles,
  }
}

function parseMixtureComponentsFromLabel(label: string): LubricantComponent[] {
  const compounds = String(label || '').match(/\[[^\]]+\]\[[^\]]+\]/g) || []
  if (compounds.length < 2) return []
  const ratioMatch = String(label || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*(mass|wt|weight|mol))?/i)
  if (!ratioMatch) return []
  const firstRatio = Number(ratioMatch[1])
  const secondRatio = Number(ratioMatch[2])
  const ratio = [firstRatio, secondRatio]
  if (ratio.some((value) => !Number.isFinite(value) || value <= 0)) return []
  const total = firstRatio + secondRatio
  const rawUnit = String(ratioMatch[3] || '').toLowerCase()
  const unit = rawUnit === 'mol' ? 'mol%' : 'wt%'
  return compounds.slice(0, 2).map((compound, index) => ({
    compound,
    fraction: Math.round(((index === 0 ? firstRatio : secondRatio) / total * 100) * 10000) / 10000,
    unit,
  }))
}

function recordLubricantComponents(record: RecordResponse): LubricantComponent[] {
  const raw = record.lubricantComponents ?? (record as any).lubricant_components
  const components = Array.isArray(raw) ? raw
    .map((component) => ({
      compound: String(component?.compound || '').trim(),
      fraction: component?.fraction ?? null,
      unit: component?.unit ?? null,
      role: component?.role ?? null,
    }))
    .filter((component) => component.compound) : []
  return components.length ? components : parseMixtureComponentsFromLabel(recordLubricantRaw(record))
}

function componentRatioLabel(components: LubricantComponent[]): string {
  const fractions = components.map((component) => Number(component.fraction))
  if (!fractions.length || fractions.some((value) => !Number.isFinite(value))) return ''
  const ratioParts = approximateRatioParts(fractions)
  if (!ratioParts.length) return ''
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
  const common = ratioParts.reduce((acc, value) => gcd(acc, value), ratioParts[0] || 1) || 1
  const ratio = ratioParts.map((value) => String(value / common)).join(':')
  const units = Array.from(new Set(components.map((component) => String(component.unit || '').trim()).filter(Boolean)))
  if (units.length !== 1) return ratio
  const unit = units[0] === 'wt%' ? 'wt' : units[0] === 'mol%' ? 'mol' : units[0]
  return `${ratio} ${unit}`.trim()
}

function approximateRatioParts(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return []
  let bestParts: number[] = []
  let bestError = Number.POSITIVE_INFINITY
  for (let totalParts = values.length; totalParts <= 200; totalParts += 1) {
    const parts = values.map((value) => Math.max(1, Math.round(value / total * totalParts)))
    if (parts.reduce((sum, value) => sum + value, 0) !== totalParts) continue
    const error = parts.reduce((sum, part, index) => sum + Math.abs(part / totalParts - (values[index] ?? 0) / total), 0)
    if (error < bestError) {
      bestError = error
      bestParts = parts
      if (error < 1e-6) break
    }
  }
  if (bestParts.length && bestError <= 0.002) return bestParts
  return values.map((value) => Math.round(value * 1000))
}

function isBaseOilComponent(component: LubricantComponent): boolean {
  const role = String(component.role || '').trim().toLowerCase()
  const compound = String(component.compound || '').trim().toLowerCase()
  return ['base_oil', 'oil', 'solvent'].includes(role) || compound.includes('oil') || ['degdbe', 'peg', 'pao'].includes(compound)
}

function compactMixtureLabel(components: LubricantComponent[]): string {
  if (components.length < 2) return ''
  const baseOilComponents = components.filter(isBaseOilComponent)
  const ionicComponents = components.filter((component) => !isBaseOilComponent(component))
  if (ionicComponents.length === 1 && baseOilComponents.length) {
    const ratio = componentRatioLabel(components)
    const ionicComponent = ionicComponents[0]
    const oilComponent = baseOilComponents[0]
    const label = `${canonicalIonicLiquidLabel(ionicComponent?.compound || '')} / ${oilComponent?.compound || 'base oil'}`
    return ratio ? `${label} (${ratio})` : label
  }

  const parsed = components.map((component) => component.compound.match(/^\[([^\]]+)\]\[([^\]]+)\]$/))
  if (!parsed.every(Boolean)) return ''
  const cations = parsed.map((match) => canonicalIonToken(match?.[1] || ''))
  const anions = parsed.map((match) => match?.[2] || '')
  const ratio = componentRatioLabel(components)
  if (new Set(cations).size === 1) {
    const label = `[${cations[0]}] ${anions.map((anion) => `[${anion}]`).join('/')}`
    return ratio ? `${label} (${ratio})` : label
  }
  const label = components.map((component) => component.compound).join('/')
  return ratio ? `${label} (${ratio})` : label
}

export function lubricantDisplay(record: RecordResponse): string {
  const components = recordLubricantComponents(record)
  
  if (components.length === 1) {
    const [component] = components
    return canonicalIonicLiquidLabel(component?.compound || recordLubricantRaw(record) || '--')
  }
  
  const compactMixture = compactMixtureLabel(components)
  if (compactMixture) return compactMixture
  
  const apiDisplay = String(record.ionicLiquidDisplay ?? (record as any).ionic_liquid_display ?? '').trim()
  if (apiDisplay) return canonicalIonicLiquidLabel(apiDisplay)

  return canonicalIonicLiquidLabel(recordLubricantRaw(record) || '--')
}

export function lubricantAliasDisplay(record: RecordResponse): string {
  const alias = recordLubricantAlias(record)
  if (!alias) return ''
  const display = lubricantDisplay(record)
  const raw = recordLubricantRaw(record)
  const normalizedAlias = alias.replace(/\s+/g, '').toLowerCase()
  const normalizedDisplay = display.replace(/\s+/g, '').toLowerCase()
  const normalizedRaw = raw.replace(/\s+/g, '').toLowerCase()
  if (normalizedAlias === normalizedDisplay || normalizedAlias === normalizedRaw) return ''
  return alias
}

export function lubricantDisplayLines(record: RecordResponse): string[] {
  const components = recordLubricantComponents(record)
  if (components.length <= 1) return [lubricantDisplay(record)]
  if (components.some(isBaseOilComponent)) return [lubricantDisplay(record)]

  const lines = components.map((component) => canonicalIonicLiquidLabel(component.compound))
  const ratio = componentRatioLabel(components)
  return ratio ? [...lines, `(${ratio})`] : lines
}

export function lubricantStructureLayout(record: RecordResponse): LubricantStructureLayout | null {
  const components = recordLubricantComponents(record)
  const parsedComponents = components
    .map((component) => parseIonicLiquidCompound(component.compound))
    .filter((component): component is NonNullable<typeof component> => Boolean(component))
  const ratioLabel = componentRatioLabel(components)

  if (parsedComponents.length >= 2) {
    const cationKeys = new Set(parsedComponents.map((component) => component.cationKey).filter(Boolean))
    const allSameCation = cationKeys.size === 1
    const pairs = parsedComponents.map((component, index) => {
      const cationSmiles = resolveCationStructureSmiles(component.cationKey, record, allSameCation)
      const anionSmiles = resolveAnionStructureSmiles(component.anionKey, record)
      return {
        key: `${component.cationKey}-${component.anionKey}-${index}`,
        label: component.label,
        cation: structureItem('cation', component.cationToken, component.cationKey, component.cationLabel, cationSmiles),
        anion: structureItem('anion', component.anionToken, component.anionKey, component.anionLabel, anionSmiles),
      }
    })

    if (allSameCation) {
      return {
        kind: 'shared-cation',
        ratioLabel,
        pairs,
        cation: pairs[0]?.cation,
        anions: pairs.map((pair) => pair.anion),
      }
    }

    return { kind: 'component-pairs', ratioLabel, pairs }
  }

  const rawPair = parseIonicLiquidCompound(recordLubricantRaw(record))
  const cationToken = rawPair?.cationToken || String(record.cation || '').replace(/^\[|\]$/g, '')
  const anionToken = rawPair?.anionToken || String(record.anion || '').replace(/^\[|\]$/g, '')
  const cationKey = rawPair?.cationKey || normalizeCationStructureKey(cationToken)
  const anionKey = rawPair?.anionKey || normalizeAnionStructureKey(anionToken)
  if (!cationToken && !anionToken && !record.cationSmiles && !record.anionSmiles) return null

  const cationLabel = cationToken ? `[${canonicalIonToken(cationToken)}]` : 'Cation'
  const anionLabel = anionToken ? `[${anionToken}]` : 'Anion'
  const cationSmiles = record.cationSmiles || resolveCationStructureSmiles(cationKey, record, false)
  const anionSmiles = record.anionSmiles || resolveAnionStructureSmiles(anionKey, record)
  const pair: LubricantStructurePair = {
    key: `${cationKey || 'cation'}-${anionKey || 'anion'}`,
    label: rawPair?.label || `${cationLabel}${anionLabel}`,
    cation: structureItem('cation', cationToken, cationKey, cationLabel, cationSmiles || null),
    anion: structureItem('anion', anionToken, anionKey, anionLabel, anionSmiles || null),
  }
  return { kind: 'single', ratioLabel: '', pairs: [pair] }
}

export function lubricantStructureItems(record: RecordResponse): IonStructurePreviewItem[] {
  const layout = lubricantStructureLayout(record)
  if (!layout) return []
  const items = layout.kind === 'shared-cation'
    ? [layout.cation, ...(layout.anions || [])]
    : layout.pairs.flatMap((pair) => [pair.cation, pair.anion])
  const seen = new Set<string>()
  return items
    .filter((item): item is IonStructurePreviewItem => Boolean(item?.smiles))
    .filter((item) => {
      const key = `${item.role}:${item.key}:${item.smiles}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function lubricantTooltip(record: RecordResponse): string {
  const components = recordLubricantComponents(record)
  const alias = lubricantAliasDisplay(record)
  
  if (components.length <= 1) {
    return alias ? `文献别名: ${alias}; 标准离子形式: ${lubricantDisplay(record)}` : ''
  }

  const details = components
    .map((component) => {
      const fraction = component.fraction == null ? '' : `: ${component.fraction} ${component.unit || ''}`.trimEnd()
      return `${canonicalIonicLiquidLabel(component.compound)}${fraction}`
    })
    .join('; ')

  const compact = compactMixtureLabel(components) || recordLubricantRaw(record) || '--'
  const tooltip = details || compact
  return alias ? `${tooltip} · 文献别名: ${alias}` : tooltip
}

function renderChemicalDigitsAsSubscriptHtml(input: string): string {
  const canonicalInput = canonicalIonicLiquidLabel(String(input || ''))
  const withPhosphoniumAliases = escapeHtml(canonicalInput).replace(/\[([PNpn])([0-9,]+)\]/g, (_match, aliasHead, aliasDigits) => {
    return `[${escapeHtml(String(aliasHead))}<sub>${escapeHtml(String(aliasDigits))}</sub>]`
  })
  return withPhosphoniumAliases.replace(/([A-Za-z\]\)])(\d{1,2})(?!\d)/g, '$1<sub>$2</sub>')
}

export function ionicLiquidParts(input: string | null | undefined): string[] {
  const normalized = String(input || '').trim()
  if (!normalized) return ['--']

  const compact = normalized.replace(/\s+/g, '')
  const bracketParts = compact.match(/\[[^\]]+\]/g)
  if (bracketParts && bracketParts.join('') === compact) {
    return bracketParts
  }

  return [normalized]
}

export function formatIonicLiquidPartHtml(input: string | null | undefined): string {
  return renderChemicalDigitsAsSubscriptHtml(String(input || '--'))
}

export function formatIonicLiquidHtml(input: string | null | undefined): string {
  const str = String(input || '').trim()
  if (!str || str === '--') return '--'

  const ratioMatch = str.match(/^(.*?)\s*\(([^)]+)\)$/)
  let mainText = str
  let ratioBadge = ''

  if (ratioMatch) {
    mainText = (ratioMatch[1] || '').trim()
    const ratio = (ratioMatch[2] || '').trim()
    ratioBadge = `<div class="mt-1.5"><span class="inline-flex items-center gap-1.5 rounded-[0.25rem] bg-[#f8fafc] px-1.5 py-[2px] text-[9.5px] font-bold text-[#475569] shadow-[inset_0_0_0_1px_rgba(226,232,240,1)]"><span class="text-[8.5px] font-black uppercase tracking-wider text-[#94a3b8]">Ratio</span>${escapeHtml(ratio)}</span></div>`
  }

  const mainHtml = ionicLiquidParts(mainText)
    .map((part) => formatIonicLiquidPartHtml(part))
    .join('')

  return `${mainHtml}${ratioBadge}`
}
