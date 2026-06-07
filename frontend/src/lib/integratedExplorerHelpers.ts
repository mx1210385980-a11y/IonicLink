import { formatTribopairLabel, parseLegacyTribopairLabel, type EvidenceResult, type LubricantComponent, type RecordResponse, type RecordLiteratureDTO } from '@/lib/api'
import { canonicalExperimentScaleValue } from '@/lib/experimentScale'
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

export type LubricantDisplayLine = {
  text: string
  kind: 'compound' | 'ratio'
  emphasis: 'primary' | 'secondary'
}

export type LubricantRecipeDisplay = {
  kind: 'single' | 'blend'
  title: string
  primary: string
  secondary: string
  ratio: string
  badge: string
}

export type ContactDisplayMode = 'nano' | 'macro' | 'unknown'

export type ContactDisplayPattern =
  | 'probe_substrate'
  | 'ball_disk'
  | 'pin_disk'
  | 'four_ball'
  | 'ball_pins'
  | 'block_ring'
  | 'counterface_specimen'

export type ContactDisplayModel = {
  mode: ContactDisplayMode
  pattern: ContactDisplayPattern
  primaryRole: string
  secondaryRole: string
  primaryLabel: string
  secondaryLabel: string
  relationLabel: string
  detailBadges: string[]
  title: string
}

export function recordDisplayId(record: Pick<RecordResponse, 'id' | 'displayId'>): string {
  const displayId = String(record.displayId || '').trim()
  if (displayId) return displayId
  const numericId = Number(record.id)
  if (Number.isFinite(numericId) && numericId > 0) {
    return `R-${Math.trunc(numericId).toString().padStart(6, '0')}`
  }
  return 'R-000000'
}

export function compactRecordDisplayId(record: Pick<RecordResponse, 'id' | 'displayId'>): string {
  const fullId = recordDisplayId(record)
  const match = fullId.match(/(\d+)$/)
  if (!match) return '#000'
  const value = Number(match[1])
  if (!Number.isFinite(value)) return '#000'
  return `#${Math.trunc(value).toString().padStart(3, '0').slice(-3)}`
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
    .replace(/(\d)\s*mum\/s\b/gi, '$1 μm/s')
    .replace(/\bup\s+to\s*~?\s*/gi, '≤')
    .replace(/\bat\s+most\s*~?\s*/gi, '≤')
    .replace(/\bmaximum\s*~?\s*/gi, '≤')
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

export type ConditionMicrobarItem = {
  key: string
  symbol: string
  label: string
  value: string
  unit: string
  full: string
  title: string
  tone: ConditionGroupTone
  emphasis: 'primary' | 'secondary' | 'muted'
}

export type ConditionMicrobarDisplay = {
  items: ConditionMicrobarItem[]
  overflow: number
  title: string
}

export type ConditionSealDisplay = {
  primary: ConditionMicrobarItem | null
  badge: ConditionMicrobarItem | null
  meta: ConditionMicrobarItem[]
  overflowItems: ConditionMicrobarItem[]
  overflow: number
  title: string
}

function compactScientificUnit(unit: string): string {
  const normalized = String(unit || '').trim()
  if (!normalized) return ''
  if (/^uN$/i.test(normalized)) return 'μN'
  if (/^(?:um|mum|μm|µm)\/s$/i.test(normalized)) return 'μm/s'
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

function numericConditionValue(value: string): number | null {
  const parsed = Number(String(value || '').replace(/[<>≈~±≤≥]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString()
}

function speedConditionDisplayParts(raw: string, record?: RecordResponse): DetailedConditionChipDisplay {
  const parsed = splitNumberAndUnit(raw)
  let value = parsed.number
  let unit = parsed.unit ? compactScientificUnit(parsed.unit) : conditionValueIsBareNumber(parsed.number) ? 'μm/s' : ''
  const isMacro = record ? contactScale(record) === 'macro' : false

  if (isMacro && unit === 'μm/s') {
    const numeric = numericConditionValue(value)
    if (numeric != null && Math.abs(numeric) >= 1000) {
      value = formatCompactNumber(numeric / 1000)
      unit = 'mm/s'
    }
  }

  return {
    label: isMacro ? 'sliding speed' : 'speed',
    value,
    unit,
  }
}

export function conditionChipDisplayParts(chip: DetailedConditionChip, fallback?: string, record?: RecordResponse): DetailedConditionChipDisplay {
  const raw = normalizeTraceDisplayText(fallback || chip.full)
  const lower = raw.toLowerCase()
  const labelMap: Partial<Record<string, string>> = {
    load: 'load',
    speed: 'speed',
    shear_rate: 'shear rate',
    potential: 'potential',
    current: 'current',
    current_density: 'current density',
    temperature: 'temperature',
    water: 'water',
  }
  const displayLabel = labelMap[chip.key] || chip.label

  if (chip.key === 'speed') {
    return speedConditionDisplayParts(raw, record)
  }

  if (chip.key === 'shear_rate') {
    const shearRate = extractShearRate(raw)
    if (shearRate) {
      return { label: 'shear rate', value: shearRate.value, unit: shearRate.unit }
    }
  }

  if (chip.key === 'load') {
    const measuredLoad = extractValueWithUnit(raw, ['nN', 'μN', 'µN', 'uN', 'mN'])
    if (/\blow\s+load\b/i.test(raw)) {
      return {
        label: 'low load',
        value: measuredLoad ? measuredLoad.value.replace(/^~\s*/, '≤') : 'low',
        unit: measuredLoad?.unit || '',
      }
    }
    if (/\bhigh\s+load\b/i.test(raw)) {
      return {
        label: 'high load',
        value: measuredLoad?.value || (lower.includes('squeeze') ? 'squeeze-out' : 'high load'),
        unit: measuredLoad?.unit || '',
      }
    }
    if (measuredLoad) {
      return {
        label: 'load',
        value: measuredLoad.value,
        unit: measuredLoad.unit,
      }
    }
  }

  const parsed = splitNumberAndUnit(raw)
  const inferredUnits: Partial<Record<string, string>> = {
    potential: 'V',
    current: 'A',
    current_density: 'mA/cm²',
    speed: 'μm/s',
    shear_rate: 's^-1',
    load: 'nN',
  }
  const inferredUnit = parsed.unit
    ? compactScientificUnit(parsed.unit)
    : conditionValueIsBareNumber(parsed.number)
      ? inferredUnits[chip.key] || ''
      : ''

  const displayUnit = chip.key === 'potential'
    ? inferredUnit.replace(/\s+vs\s+ocp\b/i, '').trim()
    : inferredUnit

  return {
    label: displayLabel,
    value: parsed.number,
    unit: displayUnit,
  }
}

const CONDITION_MICROBAR_SYMBOLS: Record<string, string> = {
  load: 'F',
  speed: 'V',
  shear_rate: 'γ̇',
  potential: 'ψ',
  current: 'I',
  current_density: 'J',
  temperature: 'T',
  water: 'H₂O',
}

function conditionMicrobarSymbol(chip: DetailedConditionChip, record: RecordResponse): string {
  if (chip.key === 'speed' && contactScale(record) === 'macro') return 'S'
  return CONDITION_MICROBAR_SYMBOLS[chip.key] || chip.label
}

const CONDITION_MICROBAR_PRIORITY: Record<string, number> = {
  load: 0,
  speed: 1,
  shear_rate: 2,
  current: 3,
  current_density: 4,
  potential: 5,
  temperature: 6,
  water: 7,
}

function isQuietPotential(chip: DetailedConditionChip, display: DetailedConditionChipDisplay): boolean {
  if (chip.key !== 'potential') return false
  const displayText = `${display.value || ''} ${display.unit || ''}`.trim()
  const numeric = Number(String(display.value || '').replace(/[+−]/g, (match) => (match === '−' ? '-' : '')).trim())
  if (Number.isFinite(numeric) && Math.abs(numeric) > 1e-9) return false
  if (Number.isFinite(numeric) && Math.abs(numeric) <= 1e-9) return true

  const shortcut = String(chip.shortcut || '').trim().toLowerCase()
  const full = String(chip.full || '').trim().toLowerCase()
  if (shortcut === 'ocp' || shortcut === '0 v' || shortcut === 'ocv') return true
  if (/^(?:ocp|ocv|open\s+circuit)$/i.test(full)) return true
  return /^[-+]?0+(?:\.0+)?(?:\s*v)?(?:\s+vs\s+ocp)?$/i.test(displayText)
}

function conditionMicrobarEmphasis(chip: DetailedConditionChip, display: DetailedConditionChipDisplay): ConditionMicrobarItem['emphasis'] {
  if (isQuietPotential(chip, display)) return 'muted'
  if (chip.key === 'load' || chip.key === 'speed' || chip.key === 'shear_rate' || chip.key === 'potential' || chip.key === 'current' || chip.key === 'current_density') return 'primary'
  if (chip.key === 'temperature' && chip.shortcut === 'RT') return 'muted'
  if (chip.key === 'temperature') return 'primary'
  return 'secondary'
}

function isMissingConditionDisplay(item: Pick<ConditionMicrobarItem, 'value' | 'full'>): boolean {
  const text = `${item.value || ''} ${item.full || ''}`.toLowerCase().trim()
  if (!text) return true
  return /\b(?:not\s+specified|not\s+reported|not\s+available|unknown|n\/a|na|none|null)\b/.test(text)
}

export function conditionMicrobarItems(record: RecordResponse, maxVisible: number = 4): ConditionMicrobarDisplay {
  const chips = detailedConditionChips(record)
    .slice()
    .sort((a, b) => (CONDITION_MICROBAR_PRIORITY[a.key] ?? 99) - (CONDITION_MICROBAR_PRIORITY[b.key] ?? 99))

  const allItems = chips.map((chip) => {
    const display = conditionChipDisplayParts(chip, undefined, record)
    return {
      key: chip.key,
      symbol: conditionMicrobarSymbol(chip, record),
      label: display.label,
      value: chip.shortcut && chip.key !== 'temperature' ? chip.shortcut : display.value,
      unit: chip.shortcut && chip.key !== 'temperature' ? '' : display.unit,
      full: chip.full,
      title: `${chip.label}: ${chip.full}`,
      tone: chip.tone,
      emphasis: conditionMicrobarEmphasis(chip, display),
    }
  }).filter((item) => Boolean(item.value || item.unit) && !isMissingConditionDisplay(item))

  const visibleCount = Math.max(0, Math.trunc(maxVisible))
  return {
    items: allItems.slice(0, visibleCount),
    overflow: Math.max(0, allItems.length - visibleCount),
    title: allItems.map((item) => item.title).join(' • '),
  }
}

function firstConditionByKey(
  items: ConditionMicrobarItem[],
  keys: string[],
  fallbackToFirst: boolean = true,
  predicate: (item: ConditionMicrobarItem) => boolean = () => true,
): ConditionMicrobarItem | null {
  for (const key of keys) {
    const item = items.find((candidate) => candidate.key === key && predicate(candidate))
    if (item) return item
  }
  return fallbackToFirst ? items.find(predicate) || null : null
}

export function conditionSealDisplay(record: RecordResponse): ConditionSealDisplay {
  const allItems = conditionMicrobarItems(record, 99).items
  const activeItem = (item: ConditionMicrobarItem) => item.emphasis !== 'muted'
  const primary = firstConditionByKey(allItems, ['load', 'potential', 'speed', 'shear_rate', 'temperature'], false, activeItem)
  const withoutPrimary = allItems.filter((item) => item.key !== primary?.key)
  const activeBadge = primary
    ? firstConditionByKey(withoutPrimary, ['potential', 'load', 'speed', 'shear_rate', 'temperature', 'water'], false, activeItem)
    : null
  const quietBadge = primary && !activeBadge
    ? firstConditionByKey(withoutPrimary, ['potential', 'temperature', 'water'], false)
    : null
  const badge = activeBadge || quietBadge
  const usedKeys = new Set([primary?.key, badge?.key].filter(Boolean))
  const remaining = allItems.filter((item) => !usedKeys.has(item.key))
  const meta = remaining.slice(0, 2)
  const overflowItems = remaining.slice(2)

  return {
    primary,
    badge,
    meta,
    overflowItems,
    overflow: overflowItems.length,
    title: allItems.map((item) => item.title).join(' • '),
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
  if (c >= 15 && c <= 35) return 'RT'
  return undefined
}

function potentialShortcut(text: string): string | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  if (/^[-+]?0+(?:\.0+)?\s*v?$/i.test(t)) return '0 V'
  if (/^0+(?:\.0+)?\s*v\s+vs\s+ocp$/i.test(t)) return 'OCP'
  if (t.includes('ocv') || t.includes('open circuit')) return 'OCV'
  return undefined
}

function waterShortcut(text: string): string | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  if (t.includes('anhydrous') || t === 'dry') return 'dry'
  if (/^0\s*%?$/.test(t)) return 'dry'
  if (/^<\s*1\s*%/.test(t)) return '<1%'
  return undefined
}

type FlexibleFieldEntry = {
  label?: string | null
  value?: string | number | null
  unit?: string | null
  category?: string | null
}

function flexibleFieldEntries(record: RecordResponse): Array<{ key: string, entry: FlexibleFieldEntry }> {
  const fieldMap = record.fieldEvidenceJson as Record<string, unknown> | null | undefined
  const flexible = fieldMap?._flexible_fields
  if (!flexible || typeof flexible !== 'object' || Array.isArray(flexible)) return []
  const out: Array<{ key: string, entry: FlexibleFieldEntry }> = []
  for (const [key, rawEntry] of Object.entries(flexible as Record<string, unknown>)) {
    const entries = Array.isArray(rawEntry) ? rawEntry : [rawEntry]
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      out.push({ key, entry: entry as FlexibleFieldEntry })
    }
  }
  return out
}

function flexibleConditionChips(record: RecordResponse): DetailedConditionChip[] {
  const supported = new Set(['current', 'current_density'])
  const chips: DetailedConditionChip[] = []
  for (const { key, entry } of flexibleFieldEntries(record)) {
    if (!supported.has(key)) continue
    if (String(entry.category || '').trim().toLowerCase() !== 'condition') continue
    const rawValue = String(entry.value ?? '').trim()
    if (!rawValue) continue
    const unit = String(entry.unit || '').trim()
    const full = normalizeTraceDisplayText(unit && !rawValue.toLowerCase().includes(unit.toLowerCase()) ? `${rawValue} ${unit}` : rawValue)
    chips.push({
      key,
      label: key === 'current_density' ? '电流密度' : '电流',
      full,
      tone: 'env',
      title: String(entry.label || (key === 'current_density' ? 'Current density' : 'Current')),
    })
  }
  return chips
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

  chips.push(...flexibleConditionChips(record))

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
  const geometry = recordTextField(record, 'probeGeometry', 'probe_geometry')
  const radius = recordTextField(record, 'probeRadius', 'probe_radius')
  const probeRoughness = recordTextField(record, 'probeRoughness', 'probe_roughness')
  if (geometry) pieces.push(geometry)
  if (radius) pieces.push(radius)
  if (probeRoughness) pieces.push(probeRoughness)
  return {
    probeDetails: pieces.join(' · '),
    filmThickness: recordTextField(record, 'filmThickness', 'film_thickness'),
  }
}

function normalizedContactKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—-]+/g, '_')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function recordTextField(record: RecordResponse, camelKey: keyof RecordResponse, snakeKey?: string): string {
  return String((record as any)[camelKey] ?? (snakeKey ? (record as any)[snakeKey] : '') ?? '').trim()
}

function contactSystemText(record: RecordResponse): string {
  const system = (record.tribologicalSystem || {}) as NonNullable<RecordResponse['tribologicalSystem']>
  const profile = (record.experimentProfile || {}) as NonNullable<RecordResponse['experimentProfile']>
  return [
    recordTextField(record, 'experimentMethod', 'experiment_method'),
    profile.method,
    profile.contact_geometry,
    profile.contactGeometry,
    system.method,
    system.contact_geometry,
    system.contactGeometry,
    system.instrument,
    system.profile,
    system.training_view,
    system.trainingView,
    system.raw_text,
    system.rawText,
    recordTextField(record, 'trainingView', 'training_view'),
    recordTextField(record, 'measurementType', 'measurement_type'),
    recordTextField(record, 'regime'),
    recordTextField(record, 'probeGeometry', 'probe_geometry'),
    recordTextField(record, 'loadValue', 'load_value'),
    recordTextField(record, 'loadRaw', 'load_raw'),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
}

function normalizedContactKeyHasAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text === token || text.includes(token))
}

function hasMacroContactCue(text: string): boolean {
  if (normalizedContactKeyHasAny(text, [
    'macro',
    'macro_performance',
    'ball_on',
    'ball_disk',
    'pin_on',
    'pin_disk',
    'four_ball',
    'block_on',
    'block_ring',
    'tribometer',
    'reciprocating',
    'wear_scar',
    'stroke',
  ])) {
    return true
  }

  const hasEngineeringLoad = /(?:^|_)\d+(?:_\d+)?_n(?:_|$)/.test(text)
  const hasMillimeterGeometry = /(?:^|_)(?:mm|cm)(?:_|$)/.test(text)
    && /(?:^|_)(?:ball|pin|disk|disc|plate|ring)(?:_|$)/.test(text)
  return hasEngineeringLoad || hasMillimeterGeometry
}

function hasNanoContactCue(text: string): boolean {
  return normalizedContactKeyHasAny(text, [
    'afm',
    'ffm',
    'sfb',
    'colloid',
    'tip_radius',
    'sharp_tip',
    'surface_force',
    'lateral_force',
  ])
}

function contactScale(record: RecordResponse): ContactDisplayMode {
  const system = (record.tribologicalSystem || {}) as NonNullable<RecordResponse['tribologicalSystem']>
  const profile = (record.experimentProfile || {}) as NonNullable<RecordResponse['experimentProfile']>
  const candidates = [
    recordTextField(record, 'experimentScale', 'experiment_scale'),
    profile.scale,
    system.scale,
    recordTextField(record, 'trainingView', 'training_view'),
    profile.training_view,
    profile.trainingView,
    system.training_view,
    system.trainingView,
  ]
  const canonicalSignals = candidates.map((candidate) => canonicalExperimentScaleValue(String(candidate || '')))
  const text = normalizedContactKey(contactSystemText(record))

  if (canonicalSignals.includes('macroscale')) return 'macro'
  if (hasMacroContactCue(text)) return 'macro'
  if (canonicalSignals.includes('nanoscale')) return 'nano'
  if (hasNanoContactCue(text)) return 'nano'
  return 'unknown'
}

function macroContactPattern(record: RecordResponse): ContactDisplayPattern {
  const text = normalizedContactKey(contactSystemText(record))
  if (/\bball_on_3_pins?\b|\bball_3_pins?\b/.test(text)) return 'ball_pins'
  if (/\bfour_ball\b|\b4_ball\b/.test(text)) return 'four_ball'
  if (/\bpin_on_disk\b|\bpin_disk\b/.test(text)) return 'pin_disk'
  if (/\bblock_on_ring\b|\bblock_ring\b/.test(text)) return 'block_ring'
  if (/\bball_on_disk\b|\bball_disk\b|\bball_on_flat\b/.test(text)) return 'ball_disk'
  const geometry = normalizedContactKey(recordTextField(record, 'probeGeometry', 'probe_geometry'))
  if (geometry.includes('pin')) return 'pin_disk'
  if (geometry.includes('ball') || geometry.includes('sphere')) return 'ball_disk'
  return 'counterface_specimen'
}

function uniqueDisplayItems(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const text = String(item || '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
  }
  return result
}

function isBareNumericText(value: string): boolean {
  return /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())
}

function hasRoughnessUnit(value: string): boolean {
  return /\b(?:pm|nm|um|μm|µm|mm|angstrom|angstroms)\b/i.test(value)
}

function hasRoughnessMetric(value: string): boolean {
  return /^(?:rms|rq|ra|roughness)\b/i.test(value.trim())
}

function leadingNumber(value: string): number | null {
  const match = value.match(/[-+]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function valuesLookEquivalent(a: string, b: string): boolean {
  const first = leadingNumber(a)
  const second = leadingNumber(b)
  if (first == null || second == null) return false
  return Math.abs(first - second) < 0.000001
}

function roughnessValueWithUnit(rawValue: string, fallbackValue?: string | null): string {
  const raw = normalizeTraceDisplayText(rawValue)
  if (!raw) return ''

  if (isBareNumericText(raw)) {
    const fallback = normalizeTraceDisplayText(fallbackValue || '')
    if (fallback && hasRoughnessUnit(fallback) && valuesLookEquivalent(raw, fallback)) {
      return hasRoughnessMetric(fallback) ? fallback : `Rq ${fallback}`
    }
    return `Rq ${raw} nm`
  }

  if (hasRoughnessUnit(raw) && !hasRoughnessMetric(raw)) return `Rq ${raw}`
  return raw
}

function contactRoughnessDetail(role: string, value: string | null | undefined, fallbackValue?: string | null): string {
  const formatted = roughnessValueWithUnit(String(value || ''), fallbackValue)
  return formatted ? `${role} ${formatted}` : ''
}

function macroRoles(pattern: ContactDisplayPattern): { primary: string, secondary: string, relation: string } {
  if (pattern === 'ball_disk') return { primary: 'Ball', secondary: 'Disk', relation: 'Ball <-> Disk' }
  if (pattern === 'pin_disk') return { primary: 'Pin', secondary: 'Disk', relation: 'Pin <-> Disk' }
  if (pattern === 'four_ball') return { primary: 'Upper ball', secondary: 'Lower balls', relation: 'Four-ball set' }
  if (pattern === 'ball_pins') return { primary: 'Ball', secondary: '3 pins', relation: 'Ball <-> 3 pins' }
  if (pattern === 'block_ring') return { primary: 'Block', secondary: 'Ring', relation: 'Block <-> Ring' }
  return { primary: 'Counterface', secondary: 'Specimen', relation: 'Counterface <-> Specimen' }
}

export function contactDisplayModel(record: RecordResponse): ContactDisplayModel {
  const mode = contactScale(record)
  const parts = tribopairParts(record)
  const extras = tribopairExtras(record)
  const probeGeometry = recordTextField(record, 'probeGeometry', 'probe_geometry')
  const probeRadius = recordTextField(record, 'probeRadius', 'probe_radius')
  const probeRoughness = recordTextField(record, 'probeRoughness', 'probe_roughness')
  const substrateRoughness = recordTextField(record, 'substrateRoughness', 'substrate_roughness')
  const surfaceRoughness = recordTextField(record, 'surfaceRoughness', 'surface_roughness')
  const filmThickness = recordTextField(record, 'filmThickness', 'film_thickness')

  if (mode === 'macro') {
    const pattern = macroContactPattern(record)
    const roles = macroRoles(pattern)
    const primaryLabel = parts.probe !== 'Probe N/A' ? parts.probe : `${roles.primary} N/A`
    const secondaryLabel = parts.substrate !== 'Substrate N/A' ? parts.substrate : `${roles.secondary} N/A`
    const detailBadges = uniqueDisplayItems([
      probeRadius,
      contactRoughnessDetail('Counterface', probeRoughness),
      parts.coating ? `Coat ${parts.coating}` : '',
      contactRoughnessDetail('Specimen', substrateRoughness, surfaceRoughness),
      filmThickness ? `Film ${filmThickness}` : '',
    ])
    return {
      mode: 'macro',
      pattern,
      primaryRole: roles.primary,
      secondaryRole: roles.secondary,
      primaryLabel,
      secondaryLabel,
      relationLabel: roles.relation,
      detailBadges,
      title: [
        `${roles.primary}: ${primaryLabel}`,
        `${roles.secondary}: ${secondaryLabel}`,
        detailBadges.length ? `Details: ${detailBadges.join(' · ')}` : '',
      ].filter(Boolean).join('\n'),
    }
  }

  if (mode === 'nano') {
    const detailBadges = uniqueDisplayItems([
      probeGeometry,
      probeRadius,
      contactRoughnessDetail('Probe', probeRoughness),
      parts.coating ? `Coat ${parts.coating}` : '',
      contactRoughnessDetail('Substrate', substrateRoughness, surfaceRoughness),
      extras.filmThickness ? `Film ${extras.filmThickness}` : '',
    ])
    return {
      mode: 'nano',
      pattern: 'probe_substrate',
      primaryRole: 'Probe',
      secondaryRole: 'Substrate',
      primaryLabel: parts.probe,
      secondaryLabel: parts.substrate,
      relationLabel: 'Probe -> Substrate',
      detailBadges,
      title: [
        `Probe: ${parts.probe}`,
        `Substrate: ${parts.substrate}`,
        detailBadges.length ? `Details: ${detailBadges.join(' · ')}` : '',
      ].filter(Boolean).join('\n'),
    }
  }

  const primaryLabel = parts.probe !== 'Probe N/A' ? parts.probe : 'Counterface N/A'
  const secondaryLabel = parts.substrate !== 'Substrate N/A' ? parts.substrate : 'Specimen N/A'
  const detailBadges = uniqueDisplayItems([
    probeGeometry,
    probeRadius,
    parts.coating ? `Coat ${parts.coating}` : '',
    filmThickness ? `Film ${filmThickness}` : '',
  ])
  return {
    mode: 'unknown',
    pattern: 'counterface_specimen',
    primaryRole: 'Counterface',
    secondaryRole: 'Specimen',
    primaryLabel,
    secondaryLabel,
    relationLabel: 'Counterface <-> Specimen',
    detailBadges,
    title: [
      `Counterface: ${primaryLabel}`,
      `Specimen: ${secondaryLabel}`,
      detailBadges.length ? `Details: ${detailBadges.join(' · ')}` : '',
    ].filter(Boolean).join('\n'),
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
  const probe = recordTextField(record, 'probeMaterial', 'probe_material')
  const substrate = recordTextField(record, 'substrateMaterial', 'substrate_material')
  const material = recordTextField(record, 'materialName', 'material_name')
  const legacyPair = !probe && !substrate ? parseLegacyTribopairLabel(material) : null
  return {
    probe: probe || legacyPair?.probe || 'Probe N/A',
    substrate: substrate || legacyPair?.substrate || material || 'Substrate N/A',
    coating: normalizeOptionalTagValue(recordTextField(record, 'substrateCoating', 'substrate_coating')),
  }
}

export function tribopairDisplay(record: RecordResponse): string {
  return formatTribopairLabel({
    probeMaterial: recordTextField(record, 'probeMaterial', 'probe_material'),
    substrateMaterial: recordTextField(record, 'substrateMaterial', 'substrate_material'),
    substrateCoating: recordTextField(record, 'substrateCoating', 'substrate_coating'),
    materialName: recordTextField(record, 'materialName', 'material_name'),
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

const COMMON_IONIC_LIQUID_LABELS: Record<string, string> = {
  ean: '[EA][NO3]',
  ethylammoniumnitrate: '[EA][NO3]',
  ethylammoniumnitrateean: '[EA][NO3]',
  pan: '[PA][NO3]',
  propylammoniumnitrate: '[PA][NO3]',
  propylammoniumnitratepan: '[PA][NO3]',
}

function commonIonicLiquidLabel(input: string): string {
  const compact = String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return COMMON_IONIC_LIQUID_LABELS[compact] || ''
}

function canonicalIonicLiquidLabel(input: string): string {
  const commonLabel = commonIonicLiquidLabel(input)
  if (commonLabel) return commonLabel
  return String(input || '')
    .replace(/\(\s*iC8\s*\)2PO2/g, 'i(C8)2PO2')
    .replace(/\[([PNpn]\d+)\]/g, (_match, token) => `[${canonicalIonToken(token)}]`)
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
  lig4: '[Li+].COCCOCCOCCOCCOC',
  mor11: 'C[N+]1(C)CCOCC1',
  bhpt: 'OCC[n+]1ccn(CCCCCn2cc[n+](CCO)c2)c1',
  bhpet: 'OCC[n+]1ccn(CCOCCOCCOCCOCCOCCn2cc[n+](CCO)c2)c1',
  c10c1im2: 'C[n+]1ccn(CCCCCCCCCCn2cc[n+](C)c2)c1',
  bupy: 'CCCC[n+]1ccccc1',
  c5py: 'CCCCC[n+]1ccccc1',
  hoc4py: 'OCCCC[n+]1ccccc1',
}

const ANION_STRUCTURE_SMILES: Record<string, string> = {
  pf6: 'F[P-](F)(F)(F)(F)F',
  bf4: 'F[B-](F)(F)F',
  tfsi: 'O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F',
  bob: '[B-]1(OC(=O)C(=O)O1)OC(=O)C(=O)O',
  bmb: '[B-]1(OC(=O)CC(=O)O1)OC(=O)CC(=O)O',
  a4bmb: '[B-]12(OC(=O)C(c3ccc(CCCC)cc3)O1)OC(=O)C(c4ccc(CCCC)cc4)O2',
  a8bmb: '[B-]12(OC(=O)C(c3ccc(CCCCCCCC)cc3)O1)OC(=O)C(c4ccc(CCCCCCCC)cc4)O2',
  a12bmb: '[B-]12(OC(=O)C(c3ccc(CCCCCCCCCCCC)cc3)O1)OC(=O)C(c4ccc(CCCCCCCCCCCC)cc4)O2',
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
  ic82po2: 'O=P([O-])(CC(C)CC(C)(C)C)CC(C)CC(C)(C)C',
  aot: 'CCCCC(CC)COC(=O)CC(C(=O)OCC(CCCC)CC)S([O-])(=O)=O',
  doc: 'CCCCC(CC)COC(=O)CC(C(=O)OCC(CCCC)CC)S([O-])(=O)=O',
  ds: 'CCCCCCCCCCCCOS([O-])(=O)=O',
  etso4: 'CCOS([O-])(=O)=O',
  oms: 'CS([O-])(=O)=O',
  f: '[F-]',
}

const COMPOUND_STRUCTURE_SMILES: Record<string, string> = {
  hexadecane: 'CCCCCCCCCCCCCCCC',
  cetane: 'CCCCCCCCCCCCCCCC',
  diethylsuccinate: 'CCOC(=O)CCC(=O)OCC',
  ch2co2et2: 'CCOC(=O)CCC(=O)OCC',
  degdbe: 'CCCCOCCOCCOCCCC',
  diethyleneglycoldibutylether: 'CCCCOCCOCCOCCCC',
}

const COMPOUND_STRUCTURE_ALIASES: Record<string, string> = {
  'ch2co2et2': 'diethylsuccinate',
  'ch2cooet2': 'diethylsuccinate',
  'co2etch22': 'diethylsuccinate',
  diethylbutanedioate: 'diethylsuccinate',
  ethylsuccinate: 'diethylsuccinate',
  degdbeoil: 'degdbe',
  dibutyldiglycol: 'degdbe',
  diethyleneglycoldibutylether: 'degdbe',
}

const CATION_STRUCTURE_ALIASES: Record<string, string> = {
  c2mim: 'emim',
  c4mim: 'bmim',
  c6mim: 'hmim',
  c8mim: 'omim',
  pentylpyridinium: 'c5py',
  'n-pentylpyridinium': 'c5py',
  npentylpyridinium: 'c5py',
  hydroxybutylpyridinium: 'hoc4py',
  n4hydroxybutylpyridinium: 'hoc4py',
  '4hydroxybutylpyridinium': 'hoc4py',
  hoc4pyridinium: 'hoc4py',
  bupy: 'bupy',
  butylpyridinium: 'bupy',
  nbutylpyridinium: 'bupy',
  'n-butylpyridinium': 'bupy',
  butylpyridiniumcation: 'bupy',
  bupyplus: 'bupy',
  p66614: 'p66614',
  p66614plus: 'p66614',
  ethylammonium: 'ea',
  ethylammoniumcation: 'ea',
  ethylammoniumplus: 'ea',
  propylammonium: 'pa',
  propylammoniumcation: 'pa',
  propylammoniumplus: 'pa',
  dimethylethylammonium: 'dmea',
  dimethylethylammoniumcation: 'dmea',
  li4g: 'lig4',
  lig4plus: 'lig4',
  lithiumtetraglymesolvate: 'lig4',
  bhpt: 'bhpt',
  bhpet: 'bhpet',
  c10c1im2: 'c10c1im2',
  c10mim2: 'c10c1im2',
  c10c1im22: 'c10c1im2',
  c10c1im22plus: 'c10c1im2',
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
  ic82po2: 'ic82po2',
  c82po2: 'ic82po2',
  '2po2': 'ic82po2',
  po2: 'ic82po2',
  bis244trimethylpentylphosphinate: 'ic82po2',
  aot: 'aot',
  dioctylsulfosuccinate: 'aot',
  nitrate: 'no3',
  nitrateanion: 'no3',
}

export type IonStructureRole = 'cation' | 'anion' | 'compound'

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
  kind: 'single' | 'shared-cation' | 'component-pairs' | 'compounds'
  ratioLabel: string
  pairs: LubricantStructurePair[]
  cation?: IonStructurePreviewItem
  anions?: IonStructurePreviewItem[]
  compounds?: IonStructurePreviewItem[]
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

function normalizeCompoundStructureKey(input: string): string {
  const key = normalizeStructureIonKey(String(input || '').replace(/\boil\b/gi, ''))
  return COMPOUND_STRUCTURE_ALIASES[key] || key
}

const CATION_STRUCTURE_DISPLAY_TOKENS: Record<string, string> = {
  ea: 'EA',
  pa: 'PA',
  dmea: 'DMEA',
}

const ANION_STRUCTURE_DISPLAY_TOKENS: Record<string, string> = {
  no3: 'NO3',
}

function displayCationToken(token: string, key = normalizeCationStructureKey(token)): string {
  return CATION_STRUCTURE_DISPLAY_TOKENS[key] || canonicalIonToken(token)
}

function displayAnionToken(token: string, key = normalizeAnionStructureKey(token)): string {
  return ANION_STRUCTURE_DISPLAY_TOKENS[key] || token
}

type CationAliasNoteInfo = {
  canonical: string
  fullName: string
  aliases: string[]
}

const CATION_ALIAS_NOTES: Record<string, CationAliasNoteInfo> = {
  emim: {
    canonical: 'EMIM',
    fullName: '1-ethyl-3-methylimidazolium',
    aliases: ['C2MIM', 'C2mim'],
  },
  bmim: {
    canonical: 'BMIM',
    fullName: '1-butyl-3-methylimidazolium',
    aliases: ['C4MIM', 'C4mim'],
  },
  hmim: {
    canonical: 'HMIM',
    fullName: '1-hexyl-3-methylimidazolium',
    aliases: ['C6MIM', 'C6mim'],
  },
  omim: {
    canonical: 'OMIM',
    fullName: '1-octyl-3-methylimidazolium',
    aliases: ['C8MIM', 'C8mim'],
  },
}

function escapeRegExp(input: string): string {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bracketedIonLabel(input: string): string {
  const trimmed = String(input || '').trim().replace(/^\[|\]$/g, '')
  return trimmed ? `[${trimmed}]` : ''
}

function recordCationAliasKey(record: RecordResponse): string {
  const explicitKey = recordCationKey(record)
  if (CATION_ALIAS_NOTES[explicitKey]) return explicitKey

  const candidates = [
    recordLubricantRaw(record),
    String(record.ionicLiquidDisplay ?? (record as any).ionic_liquid_display ?? '').trim(),
    lubricantDisplay(record),
  ]

  for (const candidate of candidates) {
    const match = canonicalIonicLiquidLabel(candidate).match(/\[([^\]]+)\]\s*\[[^\]]+\]/)
    const key = normalizeCationStructureKey(match?.[1] || '')
    if (CATION_ALIAS_NOTES[key]) return key
  }

  return ''
}

export function ionicLiquidCationAliasNote(record: RecordResponse, evidenceText: string | null | undefined): string {
  const aliasKey = recordCationAliasKey(record)
  const info = CATION_ALIAS_NOTES[aliasKey]
  if (!info) return ''

  const evidence = String(evidenceText || '')
  if (!evidence.trim()) return ''

  const canonicalToken = normalizeStructureIonKey(info.canonical)
  for (const alias of info.aliases) {
    if (normalizeStructureIonKey(alias) === canonicalToken) continue
    const match = evidence.match(new RegExp(`\\[?${escapeRegExp(alias)}\\]?`, 'i'))
    if (!match) continue

    const aliasLabel = bracketedIonLabel(match[0])
    const canonicalLabel = `[${info.canonical}]`
    if (!aliasLabel || aliasLabel.toLowerCase() === canonicalLabel.toLowerCase()) continue
    return `阳离子说明: ${aliasLabel} 是 ${canonicalLabel} 的文献写法，均指 ${info.fullName}.`
  }

  return ''
}

function resolveCompoundStructureSmiles(key: string): string | null {
  return COMPOUND_STRUCTURE_SMILES[key] || null
}

function compoundStructureItem(compound: string, index = 0): IonStructurePreviewItem | null {
  const label = canonicalIonicLiquidLabel(String(compound || '').trim())
  if (!label) return null
  const key = normalizeCompoundStructureKey(label)
  const smiles = resolveCompoundStructureSmiles(key)
  if (!smiles) return null
  return structureItem('compound', label, key || `compound-${index}`, label, smiles)
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
    cationLabel: `[${displayCationToken(cationToken)}]`,
    anionLabel: `[${displayAnionToken(anionToken)}]${anionCount}`,
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
  const units = Array.from(new Set(components.map((component) => String(component.unit || '').trim()).filter(Boolean)))
  if (units.some(isInternalDatasetFractionUnit)) return ''

  const fractions = components.map(componentFraction)
  if (!fractions.length || fractions.some((value) => value == null)) return ''
  const numericFractions = fractions.filter((value): value is number => value != null)
  if (numericFractions.filter((value) => value > 0).length < 2) return ''

  const ratioParts = approximateRatioParts(numericFractions)
  if (!ratioParts.length) return ''
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
  const common = ratioParts.reduce((acc, value) => gcd(acc, value), ratioParts[0] || 1) || 1
  const ratio = ratioParts.map((value) => String(value / common)).join(':')
  if (units.length !== 1) return ratio
  const unit = units[0] === 'wt%' ? 'wt' : units[0] === 'mol%' ? 'mol' : units[0]
  return `${ratio} ${unit}`.trim()
}

function isInternalDatasetFractionUnit(unit: string): boolean {
  const normalized = unit.toLowerCase().replace(/[\s_-]+/g, '')
  return normalized.includes('datasetxil') || normalized === 'xil'
}

function approximateRatioParts(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return []
  let bestParts: number[] = []
  let bestError = Number.POSITIVE_INFINITY
  let bestScore = Number.POSITIVE_INFINITY
  for (let totalParts = values.length; totalParts <= 1000; totalParts += 1) {
    const parts = values.map((value) => value <= 0 ? 0 : Math.max(1, Math.round(value / total * totalParts)))
    if (parts.reduce((sum, value) => sum + value, 0) !== totalParts) continue
    const error = parts.reduce((sum, part, index) => sum + Math.abs(part / totalParts - (values[index] ?? 0) / total), 0)
    const score = error + totalParts * 0.000001
    if (score < bestScore) {
      bestError = error
      bestScore = score
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
  return ['base_oil', 'oil', 'solvent'].includes(role) || compound.includes('oil') || ['degdbe', 'hexadecane', 'peg', 'pao'].includes(compound)
}

function isIonicLiquidComponent(component: LubricantComponent): boolean {
  return Boolean(parseIonicLiquidCompound(component.compound))
}

function componentFraction(component: LubricantComponent): number | null {
  if (component.fraction == null) return null
  const value = Number(component.fraction)
  return Number.isFinite(value) ? value : null
}

function compactMixtureLabel(components: LubricantComponent[]): string {
  if (components.length < 2) return ''
  const baseOilComponents = components.filter(isBaseOilComponent)
  const ionicComponents = components.filter((component) => !isBaseOilComponent(component))
  if (ionicComponents.length === 1 && baseOilComponents.length) {
    const ratio = componentRatioLabel(components)
    const ionicComponent = ionicComponents[0]
    const oilLabel = String(baseOilComponents[0]?.compound || 'base oil').trim()
    const label = `${canonicalIonicLiquidLabel(ionicComponent?.compound || '')} / ${oilLabel}`
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

function ratioDisplayLine(components: LubricantComponent[]): LubricantDisplayLine[] {
  const ratio = componentRatioLabel(components)
  return ratio ? [{ text: `(${ratio})`, kind: 'ratio', emphasis: 'secondary' }] : []
}

function compoundLine(text: string, emphasis: LubricantDisplayLine['emphasis'] = 'primary'): LubricantDisplayLine {
  return { text: canonicalIonicLiquidLabel(text), kind: 'compound', emphasis }
}

export function lubricantDisplayRows(record: RecordResponse): LubricantDisplayLine[] {
  const components = recordLubricantComponents(record)

  if (components.length <= 1) {
    const component = components[0]
    const label = component?.compound || recordLubricantRaw(record) || '--'
    return [compoundLine(label)]
  }

  const ionicComponents = components.filter(isIonicLiquidComponent)
  const baseOilComponents = components.filter(isBaseOilComponent)
  const nonIonicNonOilComponents = components.filter((component) => !isIonicLiquidComponent(component) && !isBaseOilComponent(component))

  if (ionicComponents.length === 1) {
    const lines = [compoundLine(ionicComponents[0]?.compound || recordLubricantRaw(record) || '--', 'primary')]
    lines.push(...baseOilComponents.map((component) => compoundLine(component.compound, 'secondary')))
    lines.push(...nonIonicNonOilComponents.map((component) => compoundLine(component.compound, 'secondary')))
    return [...lines, ...ratioDisplayLine(components)]
  }

  const displayComponents = ionicComponents.length ? ionicComponents : components
  const fractions = displayComponents.map(componentFraction).filter((value): value is number => value != null)
  const maxFraction = fractions.length ? Math.max(...fractions) : null
  const hasUnequalFractions = maxFraction != null && fractions.some((value) => Math.abs(value - maxFraction) > 1e-6)
  const lines = displayComponents.map((component) => {
    const fraction = componentFraction(component)
    const emphasis = hasUnequalFractions && fraction != null && maxFraction != null && fraction < maxFraction
      ? 'secondary'
      : 'primary'
    return compoundLine(component.compound, emphasis)
  })

  return [...lines, ...ratioDisplayLine(components)]
}

function componentDetailLabel(component: LubricantComponent): string {
  const fraction = componentFraction(component)
  const unit = String(component.unit || '').trim()
  const fractionLabel = fraction != null && unit && !isInternalDatasetFractionUnit(unit)
    ? `: ${fraction} ${unit}`
    : ''
  return `${canonicalIonicLiquidLabel(component.compound)}${fractionLabel}`
}

export function lubricantRecipeDisplay(record: RecordResponse): LubricantRecipeDisplay {
  const components = recordLubricantComponents(record)
  const rows = lubricantDisplayRows(record)
  const compounds = rows.filter((row) => row.kind === 'compound')
  const ratio = componentRatioLabel(components)

  if (compounds.length <= 1) {
    const primary = compounds[0]?.text || lubricantDisplay(record)
    return {
      kind: 'single',
      title: lubricantTooltip(record) || primary,
      primary,
      secondary: lubricantAliasDisplay(record),
      ratio: '',
      badge: 'IL',
    }
  }

  const primaryRow = compounds.find((row) => row.emphasis === 'primary') || compounds[0]
  const secondaryRows = compounds.filter((row) => row !== primaryRow)
  const secondary = secondaryRows.map((row) => row.text).join(' / ')
  const title = components.length
    ? components.map(componentDetailLabel).join('\n')
    : lubricantDisplay(record)

  return {
    kind: 'blend',
    title,
    primary: primaryRow?.text || lubricantDisplay(record),
    secondary,
    ratio,
    badge: 'BLEND',
  }
}

export function formatLiteratureBadge(literature?: RecordLiteratureDTO | null): { author: string, year: string, title: string, full: string } | null {
  if (!literature) return null
  const authors = String(literature.authors || '').trim()
  const year = literature.year ? String(literature.year) : ''
  const title = String(literature.title || '').trim()
  
  if (!authors && !year) return null

  let firstAuthor = 'Unknown'
  if (authors) {
    const firstPart = (authors.split(/[;,]/)[0] || '').trim()
    if (firstPart.includes(' ')) {
      const words = firstPart.split(' ')
      firstAuthor = words[words.length - 1] || firstAuthor
    } else {
      firstAuthor = firstPart
    }
  }
  
  return {
    author: firstAuthor,
    year: year ? `'${year.slice(-2)}` : '',
    title: title,
    full: `${authors ? firstAuthor + ' et al. ' : ''}${year}`.trim()
  }
}

export function lubricantDisplay(record: RecordResponse): string {
  const rows = lubricantDisplayRows(record)
  const compounds = rows.filter((row) => row.kind === 'compound').map((row) => row.text).filter(Boolean)
  const ratio = rows.find((row) => row.kind === 'ratio')?.text
  if (compounds.length) {
    return `${compounds.join(' / ')}${ratio ? ` ${ratio}` : ''}`.trim()
  }

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
  return lubricantDisplayRows(record).map((line) => line.text)
}

export function lubricantStructureLayout(record: RecordResponse): LubricantStructureLayout | null {
  const components = recordLubricantComponents(record)
  const parsedComponents = components
    .map((component) => parseIonicLiquidCompound(canonicalIonicLiquidLabel(component.compound)))
    .filter((component): component is NonNullable<typeof component> => Boolean(component))
  const ratioLabel = componentRatioLabel(components)
  const rawLabel = canonicalIonicLiquidLabel(recordLubricantRaw(record))

  const compoundItems = (components.length ? components.map((component) => component.compound) : [rawLabel || recordLubricantRaw(record)])
    .map((compound, index) => compoundStructureItem(compound, index))
    .filter((item): item is IonStructurePreviewItem => Boolean(item))

  if (components.length > 0 && parsedComponents.length === 0) {
    return compoundItems.length
      ? { kind: 'compounds', ratioLabel, pairs: [], compounds: compoundItems }
      : null
  }

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

  const rawPair = parseIonicLiquidCompound(rawLabel || recordLubricantRaw(record))
  const cationToken = rawPair?.cationToken || String(record.cation || '').replace(/^\[|\]$/g, '')
  const anionToken = rawPair?.anionToken || String(record.anion || '').replace(/^\[|\]$/g, '')
  const cationKey = rawPair?.cationKey || normalizeCationStructureKey(cationToken)
  const anionKey = rawPair?.anionKey || normalizeAnionStructureKey(anionToken)
  if (!cationToken && !anionToken && !record.cationSmiles && !record.anionSmiles) {
    return compoundItems.length
      ? { kind: 'compounds', ratioLabel: '', pairs: [], compounds: compoundItems }
      : null
  }

  const cationLabel = cationToken ? `[${displayCationToken(cationToken, cationKey)}]` : 'Cation'
  const anionLabel = anionToken ? `[${displayAnionToken(anionToken, anionKey)}]` : 'Anion'
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
  const items = layout.kind === 'compounds'
    ? (layout.compounds || [])
    : layout.kind === 'shared-cation'
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
    return `[${escapeHtml(String(aliasHead))}<sub>${escapeHtml(String(aliasDigits).replace(/,/g, ''))}</sub>]`
  })
  return withPhosphoniumAliases
    .replace(/\b([A-Za-z])([0-9]+(?:,[0-9]+)+)\b/g, (_match, head, digits) => {
      return `${escapeHtml(String(head))}<sub>${escapeHtml(String(digits).replace(/,/g, ''))}</sub>`
    })
    .replace(/([A-Za-z\]\)])(\d{1,2})(?!\d)/g, '$1<sub>$2</sub>')
    .replace(/(^|[\[\s])i(?=\()/g, '$1<sup>i</sup>')
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

// Review-queue triage helpers ───────────────────────────────────────────────
// A candidate is "weak" when it was admitted for review despite missing/low-
// confidence signals (see backend weak_candidate_service). Reviewers triage
// these first, so the queue exposes a strong/weak split plus missing-field chips.
export type CandidateTriageTier = 'weak' | 'strong'
export type CandidateEvidenceQuality = 'exact' | 'page_only' | 'text_only' | 'weak'

const MISSING_FIELD_LABELS: Record<string, string> = {
  ionic_liquid: 'Ionic liquid',
  material_name: 'Material',
  cof: 'COF',
  normal_load: 'Load',
  speed: 'Speed',
}

export function missingFieldLabel(field: string): string {
  const key = String(field || '').trim().toLowerCase()
  if (!key) return ''
  if (MISSING_FIELD_LABELS[key]) return MISSING_FIELD_LABELS[key]
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function candidateMissingFields(record: RecordResponse): string[] {
  const raw = (record as { missingFields?: unknown }).missingFields
  if (!Array.isArray(raw)) return []
  return raw.map((field) => String(field ?? '').trim().toLowerCase()).filter(Boolean)
}

export function candidateTriageTier(record: RecordResponse): CandidateTriageTier {
  const origin = String((record as { recordOrigin?: unknown }).recordOrigin ?? '').trim().toLowerCase()
  const tier = String((record as { confidenceTier?: unknown }).confidenceTier ?? '').trim().toLowerCase()
  if (origin === 'weak_candidate' || tier === 'low') return 'weak'
  return 'strong'
}

export function candidateEvidenceQuality(record: RecordResponse): CandidateEvidenceQuality {
  const hasText = hasEvidenceText(record.evidence)
  const hasPage = Boolean(record.evidencePage || record.sourcePage)
  const hasBbox = hasEvidenceBBox(record.evidenceBbox)
  if (hasText && hasPage && hasBbox) return 'exact'
  if (hasText && hasPage) return 'page_only'
  if (hasText) return 'text_only'
  return 'weak'
}

export function candidateEvidenceQualityLabel(quality: CandidateEvidenceQuality): string {
  if (quality === 'exact') return 'Quote + page located'
  if (quality === 'page_only') return 'Page located'
  if (quality === 'text_only') return 'Quote only'
  return 'Needs evidence check'
}

// Whole days elapsed since the candidate was extracted, or null when the
// payload carries no usable extractedAt timestamp. Drives the staleness triage.
export function candidateAgeDays(record: RecordResponse): number | null {
  const raw = (record as { extractedAt?: unknown }).extractedAt
  if (!raw) return null
  const timestamp = Date.parse(String(raw))
  if (Number.isNaN(timestamp)) return null
  const elapsedMs = Date.now() - timestamp
  if (elapsedMs <= 0) return 0
  return Math.floor(elapsedMs / 86_400_000)
}
