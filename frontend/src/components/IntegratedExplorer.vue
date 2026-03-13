<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  searchRecords,
  getFilterOptions,
  updateTribologyRecord,
  promoteTribologyRecordConfidence,
  deleteTribologyRecord,
  getRecordEvidence,
  type SearchFilter,
  type RecordResponse,
  type PaginatedRecordResponse,
  type EvidenceResult,
} from '@/lib/api'
import {
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Save,
  ExternalLink,
  Eye,
  Edit,
  Download,
  ShieldCheck,
  Flag,
  MinusCircle,
  PlusCircle,
  ArrowUp,
  ArrowDown
} from 'lucide-vue-next'
import Modal from '@/components/ui/Modal.vue'
import PdfViewerWithHighlight from '@/components/PdfViewerWithHighlight.vue'
import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { HighlightRect } from '@/types/pdf-highlight'

const props = defineProps<{
  initialDoi?: string
  sourceName?: string
  literatureMetadata?: any
  selectedFileId?: string | null
}>()

const emit = defineEmits<{
  'view-literature': []
  'clear-doi': []
}>()

const PAGE_SIZE = 10

const loading = ref(false)
const savingRowId = ref<number | null>(null)
const deletingRowId = ref<number | null>(null)

const result = ref<PaginatedRecordResponse>({
  total: 0,
  skip: 0,
  limit: PAGE_SIZE,
  items: [],
})

const filterOptions = ref<{ materials: string[]; lubricants: string[] }>({
  materials: [],
  lubricants: [],
})

const selectedLubricant = ref('')
const selectedMaterial = ref('')
const searchDoi = ref(props.initialDoi || '')
const cofMin = ref('')
const cofMax = ref('')

const currentPage = ref(1)
const expandedRowId = ref<number | null>(null)
const activeConfidencePopoverId = ref<number | null>(null)
const showExportMenu = ref(false)
const exporting = ref(false)
type ExportFormat = 'json' | 'csv' | 'ndjson'
type EditableRecordValues = {
  lubricant: string
  materialName: string
  temperature: string
  potential: string
  waterContent: string
  speedValue: string
  loadValue: string
  surfaceRoughness: string
  filmThickness: string
  cof: string
}

const editingValues = ref<Record<number, EditableRecordValues>>({})
const evidenceData = ref<Record<number, EvidenceResult | null>>({})
const evidenceLoading = ref<Record<number, boolean>>({})
const evidenceError = ref<Record<number, string | null>>({})
const confidenceSyncing = ref<Record<number, boolean>>({})
const imagePreview = ref<{
  open: boolean
  src: string
  title: string
  scale: number
}>({
  open: false,
  src: '',
  title: '',
  scale: 1,
})
const structurePreview = ref<{
  open: boolean
  rowId: number | null
  title: string
  cationSmiles: string | null
  anionSmiles: string | null
  cationLabel: string
  anionLabel: string
}>({
  open: false,
  rowId: null,
  title: '',
  cationSmiles: null,
  anionSmiles: null,
  cationLabel: 'Cation',
  anionLabel: 'Anion',
})
type EvidenceTermHit = {
  term: string
  page: number
  bbox: number[]
  matched_text?: string | null
  inferred?: boolean
}
type ConfidenceLineItem = {
  reason: string
  value: number
}
type ConfidenceDetailsView = {
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
const pdfLocate = ref<{
  open: boolean
  title: string
  pdfUrl: string
  highlights: HighlightRect[]
  activeHighlightId: string | null
  notice: string
}>({
  open: false,
  title: '',
  pdfUrl: '',
  highlights: [],
  activeHighlightId: null,
  notice: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / PAGE_SIZE)))

const rangeStart = computed(() => (result.value.total === 0 ? 0 : result.value.skip + 1))
const rangeEnd = computed(() => Math.min(result.value.skip + PAGE_SIZE, result.value.total))

function cofDisplay(record: RecordResponse): string {
  if (record.cofValue != null && !isNaN(Number(record.cofValue))) {
    return Number(record.cofValue).toFixed(4)
  }
  if (record.cofRaw) return record.cofRaw
  return '--'
}

function confidenceDisplay(conf: number | null | undefined): string {
  if (conf == null || Number.isNaN(Number(conf))) return '--'
  const pct = Math.max(0, Math.min(100, Number(conf) * 100))
  return `${pct.toFixed(1)}%`
}

function confidencePenaltyLabel(reason: string): string {
  const labels: Record<string, string> = {
    missing_lubricant: 'Missing ionic liquid',
    unknown_lubricant: 'Unresolved ionic liquid',
    missing_material: 'Missing surface',
    unknown_material: 'Unresolved surface',
    missing_cof: 'Missing COF value',
    cof_uncertain: 'Uncertain COF notation',
    cof_out_of_range: 'COF out of physical range',
    missing_source: 'Missing source label',
    missing_source_page: 'Missing page grounding',
    missing_evidence: 'Missing evidence quote or bbox',
    panel_mismatch: 'Figure panel mismatch',
    sparse_conditions: 'Sparse experiment conditions',
    model_inferred: 'Model-inferred condition',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

function confidencePenaltyValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return `-${(Number(value) * 100).toFixed(0)} pts`
}

function confidenceBoostLabel(reason: string): string {
  const labels: Record<string, string> = {
    source_labeled: 'Specific source label present',
    page_grounded: 'Page-level grounding',
    evidence_quote_present: 'Evidence quote present',
    grounded_bbox: 'Grounded bounding box',
    panel_level_grounding: 'Panel-level figure grounding',
    rich_conditions: 'Rich experiment conditions',
  }
  return labels[reason] || reason.replace(/_/g, ' ')
}

function confidenceBoostValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return `+${(Number(value) * 100).toFixed(0)} pts`
}

function confidencePercentNumber(conf: number | null | undefined): number {
  if (conf == null || Number.isNaN(Number(conf))) return 0
  return Math.max(0, Math.min(100, Number(conf) * 100))
}

function hasEvidenceText(value: string | null | undefined): boolean {
  return !!String(value || '').trim()
}

function hasEvidenceBBox(value: number[] | string | null | undefined): boolean {
  if (Array.isArray(value)) return value.length === 4
  return !!String(value || '').trim()
}

function normalizeConfidenceDetails(details?: RecordResponse['confidenceDetails'] | null): ConfidenceDetailsView {
  const penalties = Array.isArray(details?.penalties) ? details!.penalties.map((p) => ({ reason: p.reason, value: Number(p.value) || 0 })) : []
  const boosts = Array.isArray(details?.boosts) ? details!.boosts.map((b) => ({ reason: b.reason, value: Number(b.value) || 0 })) : []
  const baseScore = Number(details?.base_score ?? 1)
  const penaltyTotal = penalties.reduce((sum, item) => sum + item.value, 0)
  const boostTotal = boosts.reduce((sum, item) => sum + item.value, 0)
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

function confidenceDetailsFor(record: RecordResponse): ConfidenceDetailsView {
  const base = normalizeConfidenceDetails(record.confidenceDetails)
  const ev = evidenceData.value[record.id]
  if (!ev) return base

  const hasSource = !!String(ev.source || record.source || record.sourceFigure || '').trim()
  const hasPage = !!(ev.page || record.sourcePage || record.evidencePage)
  const hasGroundedEvidence =
    hasEvidenceText(ev.text_snippet) ||
    hasEvidenceText(ev.evidence_text) ||
    hasEvidenceText(record.evidence) ||
    hasEvidenceBBox(ev.bbox) ||
    hasEvidenceBBox(record.evidenceBbox)

  const filteredPenalties = base.penalties.filter((penalty) => {
    if (penalty.reason === 'missing_source' && hasSource) return false
    if (penalty.reason === 'missing_source_page' && hasPage) return false
    if (penalty.reason === 'missing_evidence' && hasGroundedEvidence) return false
    return true
  })

  return normalizeConfidenceDetails({
    ...base,
    penalties: filteredPenalties,
    penalty_total: filteredPenalties.reduce((sum, item) => sum + item.value, 0),
    penalty_percent: filteredPenalties.reduce((sum, item) => sum + item.value, 0) * 100,
  })
}

function confidenceValueFor(record: RecordResponse): number {
  return confidenceDetailsFor(record).score
}

function confidenceDeltaPercent(record: RecordResponse): number {
  return Number(((confidenceValueFor(record) - Number(record.confidence || 0)) * 100).toFixed(1))
}

function promoteRecordConfidence(record: RecordResponse) {
  const liveDetails = confidenceDetailsFor(record)
  const storedScore = Number(record.confidence || 0)
  if (liveDetails.score > storedScore) {
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
  }
}

async function persistPromotedConfidence(record: RecordResponse, previousStoredScore?: number) {
  const ev = evidenceData.value[record.id]
  if (!ev || confidenceSyncing.value[record.id]) return

  const liveDetails = confidenceDetailsFor(record)
  const storedScore = Number(previousStoredScore ?? record.confidence ?? 0)
  if (liveDetails.score <= storedScore) return

  confidenceSyncing.value[record.id] = true
  try {
    const resp = await promoteTribologyRecordConfidence(record.id, {
      confidence: liveDetails.score,
      evidence: ev.text_snippet || ev.evidence_text || record.evidence,
      evidencePage: ev.page ?? record.evidencePage ?? record.sourcePage ?? null,
      evidenceBbox: ev.bbox?.length === 4 ? JSON.stringify(ev.bbox) : (record.evidenceBbox || null),
      source: ev.source || record.source,
      sourcePage: ev.page ?? record.sourcePage ?? null,
      sourceFigure: record.sourceFigure || (String(ev.source || '').match(/fig/i) ? String(ev.source) : null),
    })
    if (typeof resp?.confidence === 'number') {
      record.confidence = resp.confidence
    }
    if (resp?.confidenceDetails) {
      record.confidenceDetails = resp.confidenceDetails
    }
  } catch (err) {
    console.error('Failed to persist promoted confidence', err)
  } finally {
    confidenceSyncing.value[record.id] = false
  }
}

function conditionTags(record: RecordResponse): string[] {
  const tags: string[] = []
  if (record.potential) tags.push(`Potential: ${record.potential}`)
  if (record.waterContent) tags.push(`Water: ${record.waterContent}`)
  if (record.speedValue) tags.push(`Speed: ${record.speedValue}`)
  if (record.loadValue) tags.push(`Load: ${record.loadValue}`)
  if (record.surfaceRoughness) tags.push(`Roughness: ${record.surfaceRoughness}`)

  const filmRaw = String(record.filmThickness || '').trim()
  if (filmRaw) {
    const thicknessValue = filmRaw.replace(/\([A-Za-z0-9-]+\)/g, '').trim()
    if (thicknessValue) {
      tags.push(`Film: ${thicknessValue}`)
    } else {
      tags.push(`Film: ${filmRaw}`)
    }
  }

  return tags
}

function toggleRow(record: RecordResponse) {
  if (expandedRowId.value === record.id) {
    expandedRowId.value = null
    activeConfidencePopoverId.value = null
    return
  }
  expandedRowId.value = record.id
  activeConfidencePopoverId.value = null
  if (!editingValues.value[record.id]) {
    editingValues.value[record.id] = {
      lubricant: record.lubricant ?? '',
      materialName: record.materialName ?? '',
      temperature: record.temperature ?? '',
      potential: record.potential ?? '',
      waterContent: record.waterContent ?? '',
      speedValue: record.speedValue ?? '',
      loadValue: record.loadValue ?? '',
      surfaceRoughness: record.surfaceRoughness ?? '',
      filmThickness: record.filmThickness ?? '',
      cof: record.cofRaw ?? (record.cofValue != null ? String(record.cofValue) : ''),
    }
  }
  fetchEvidence(record)
}

function openStructurePreview(record: RecordResponse) {
  if (expandedRowId.value !== record.id) {
    toggleRow(record)
  }
  structurePreview.value = {
    open: true,
    rowId: record.id,
    title: record.lubricant || 'Chemical Structure',
    cationSmiles: record.cationSmiles || null,
    anionSmiles: record.anionSmiles || null,
    cationLabel: record.cation ? `Cation: ${record.cation}` : 'Cation',
    anionLabel: record.anion ? `Anion: ${record.anion}` : 'Anion',
  }
}

function closeStructurePreview() {
  structurePreview.value.open = false
  structurePreview.value.rowId = null
}

function updateEditingField(recordId: number, field: keyof EditableRecordValues, value: string) {
  const target = editingValues.value[recordId]
  if (!target) return
  target[field] = value
}

function toggleConfidencePopover(recordId: number) {
  activeConfidencePopoverId.value = activeConfidencePopoverId.value === recordId ? null : recordId
}

function evidenceImageSrc(recordId: number): string | null {
  const ev = evidenceData.value[recordId]
  if (!ev?.image_b64) return null
  return `data:image/png;base64,${ev.image_b64}`
}

function evidencePagePreviewSrc(recordId: number): string | null {
  const ev = evidenceData.value[recordId]
  if (!ev?.page_preview_b64) return null
  return `data:image/png;base64,${ev.page_preview_b64}`
}

function openImagePreview(src: string, title: string) {
  imagePreview.value = {
    open: true,
    src,
    title,
    scale: 1,
  }
}

function closeImagePreview() {
  imagePreview.value.open = false
}

function zoomInPreview() {
  imagePreview.value.scale = Math.min(4, Number((imagePreview.value.scale + 0.2).toFixed(2)))
}

function zoomOutPreview() {
  imagePreview.value.scale = Math.max(0.5, Number((imagePreview.value.scale - 0.2).toFixed(2)))
}

function resetPreviewZoom() {
  imagePreview.value.scale = 1
}

function onPreviewWheel(e: WheelEvent) {
  if (!imagePreview.value.open) return
  if (e.deltaY < 0) {
    zoomInPreview()
  } else {
    zoomOutPreview()
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showExportMenu.value) showExportMenu.value = false
  if (imagePreview.value.open) closeImagePreview()
  if (structurePreview.value.open) closeStructurePreview()
  if (pdfLocate.value.open) closePdfLocate()
  activeConfidencePopoverId.value = null
}

function onGlobalPointerdown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (target.closest('[data-confidence-popover-root="true"]')) return
  activeConfidencePopoverId.value = null
}

function normalizeTermKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u03bc\u00b5]/g, 'u')
    .replace(/μ/g, 'u')
    .replace(/[^a-z0-9]/g, '')
    .replace(/\s+/g, '')
    .replace(/[()=:,.;]/g, '')
}

function normalizeEvidenceChipKey(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u03bc\u00b5]/g, 'u')
    .replace(/μ/g, 'u')
    .replace(/[\[\]\(\)\{\},;:'"]/g, '')
    .replace(/\s+/g, '')
    .replace(/[+=/\\|]/g, '')
}

function normalizeIlCationToken(input: string): string {
  const token = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!token) return ''
  if (/^p\d+$/.test(token)) return token
  if (token === '1ethyl3methylimidazolium' || token === 'ethyl3methylimidazolium') return 'emim'
  if (token === '1butyl3methylimidazolium' || token === 'butyl3methylimidazolium') return 'bmim'
  if (token === '1hexyl3methylimidazolium' || token === 'hexyl3methylimidazolium') return 'hmim'
  if (token === 'tributylmethylphosphonium') return 'p4441'
  if (token === 'trihexyltetradecylphosphonium') return 'p66614'
  return token
}

function normalizeIlAnionToken(input: string): string {
  const token = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!token) return ''
  if (token === 'tfsi' || token === 'ntf2') return 'tfsi'
  if (token === 'fap' || token === 'tris(pentafluoroethyl)trifluorophosphate'.replace(/[^a-z0-9]/g, '')) return 'fap'
  if (
    token === 'bistrifluoromethanesulfonamide'
    || token === 'bistrifluoromethylsulfonylimide'
    || token === 'bistrifluoromethanesulfonylimide'
  ) {
    return 'tfsi'
  }
  return token
}

function inferIlAliasKeyFromName(input: string): string {
  const lower = String(input || '').toLowerCase()
  if (!lower) return ''

  let cation = ''
  if (lower.includes('imidazolium')) {
    if (/1?\s*[-]?\s*ethyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /ethyl\s*methylimidazolium/.test(lower)) cation = 'emim'
    if (/1?\s*[-]?\s*butyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /butyl\s*methylimidazolium/.test(lower)) cation = 'bmim'
    if (/1?\s*[-]?\s*hexyl\s*[-]?\s*3\s*[-]?\s*methyl/.test(lower) || /hexyl\s*methylimidazolium/.test(lower)) cation = 'hmim'
  }
  if (lower.includes('phosphonium')) {
    if (lower.includes('tributyl') && lower.includes('methyl')) cation = 'p4441'
    if (lower.includes('trihexyl') && lower.includes('tetradecyl')) cation = 'p66614'
  }

  let anion = ''
  if (lower.includes('tris(pentafluoroethyl)trifluorophosphate') || /\bfap\b/.test(lower)) {
    anion = 'fap'
  }
  if (
    lower.includes('ntf2')
    || (lower.includes('bis(trifluoromethane') && lower.includes('sulfonamide'))
    || (lower.includes('bis(trifluoromethylsulfonyl') && lower.includes('imide'))
  ) {
    anion = 'tfsi'
  }

  if (!cation || !anion) return ''
  return `${cation}|${anion}`
}

function normalizeIlAliasKey(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const bracketPair = raw.match(/\[([^\]]+)\]\s*\[([^\]]+)\]/i)
  if (bracketPair) {
    const cation = normalizeIlCationToken(bracketPair[1] || '')
    const anion = normalizeIlAnionToken(bracketPair[2] || '')
    if (cation && anion) return `${cation}|${anion}`
  }

  return inferIlAliasKeyFromName(raw)
}

function termsEquivalent(a: string, b: string): boolean {
  const ilA = normalizeIlAliasKey(a)
  const ilB = normalizeIlAliasKey(b)
  if (ilA && ilB && ilA === ilB) return true

  const aKey = normalizeTermKey(a)
  const bKey = normalizeTermKey(b)
  if (!aKey || !bKey) return false
  if (aKey === bKey) return true
  return aKey.includes(bKey) || bKey.includes(aKey)
}

function extractNumberTokens(input: string): string[] {
  return (String(input || '').match(/\d+(?:\.\d+)?/g) || []).map((v) => String(v))
}

function numericTokensConsistent(term: string, matched: string): boolean {
  const termNums = extractNumberTokens(term).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  if (!termNums.length) return true
  const matchedNums = extractNumberTokens(matched).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  if (!matchedNums.length) return false
  return termNums.every((tv) => {
    const tol = Math.max(1e-6, Math.abs(tv) * 0.01)
    return matchedNums.some((mv) => Math.abs(mv - tv) <= tol)
  })
}

function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i += 1
  return i
}

function looksLikeTemperatureTerm(input: string): boolean {
  const t = String(input || '').toLowerCase()
  return t.includes('k') || t.includes('c') || t.includes('temp') || t.includes('temperature')
}

function closePdfLocate() {
  pdfLocate.value.open = false
  pdfLocate.value.title = ''
  pdfLocate.value.pdfUrl = ''
  pdfLocate.value.highlights = []
  pdfLocate.value.activeHighlightId = null
  pdfLocate.value.notice = ''
}

function findBestTermHit(ev: EvidenceResult | null | undefined, term: string): EvidenceTermHit | null {
  const hits = Array.isArray(ev?.term_hits) ? (ev?.term_hits as EvidenceTermHit[]) : []
  if (!hits.length) return null

  const termRaw = String(term || '').trim()
  const termIlKey = normalizeIlAliasKey(termRaw)
  const key = normalizeTermKey(termRaw)
  const keyWithoutPrefix = key.replace(/^[a-z]+/, '')
  const termNums = extractNumberTokens(termRaw)

  if (termIlKey) {
    const ilExact = hits.find((h) => {
      const hk = normalizeIlAliasKey(h.term)
      const mk = normalizeIlAliasKey(h.matched_text || '')
      return hk === termIlKey || mk === termIlKey
    })
    if (ilExact && !ilExact.inferred) return ilExact
    if (ilExact) return ilExact
  }

  const exact = hits.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    return (hk === key || mk === key) && !h.inferred
  })
  if (exact) return exact

  const inferredExact = hits.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    return hk === key || mk === key
  })
  if (inferredExact) return inferredExact

  // Keep numeric consistency first; avoids speed/temperature drifting to unrelated values.
  const numericConsistent = hits.filter((h) => {
    if (!termNums.length) return true
    return numericTokensConsistent(termRaw, String(h.matched_text || ''))
  })
  if (numericConsistent.length === 1) return numericConsistent[0] || null

  const candidates = numericConsistent.length ? numericConsistent : hits
  const compact = candidates.find((h) => {
    const hk = normalizeTermKey(h.term)
    const mk = normalizeTermKey(h.matched_text || '')
    const best = hk.length >= mk.length ? hk : mk
    const short = hk.length < 4 && mk.length < 4
    if (!best || short) return false
    const prefix = commonPrefixLen(key, best)
    const prefixRatio = prefix / Math.max(1, Math.min(key.length, best.length))
    const contains =
      (best.length >= Math.max(5, Math.floor(key.length * 0.55)) && key.includes(best))
      || (key.length >= Math.max(5, Math.floor(best.length * 0.55)) && best.includes(key))
    return (prefixRatio >= 0.6 || contains) && !h.inferred
  })
  if (compact) return compact

  if (keyWithoutPrefix && keyWithoutPrefix !== key) {
    const fallback = hits.find((h) => {
      const hk = normalizeTermKey(h.term)
      if (!hk || hk.length < 4) return false
      return hk === keyWithoutPrefix
    })
    if (fallback) return fallback
  }

  return null
}

function buildHighlightRect(
  id: string,
  page: number,
  bbox: number[] | null | undefined,
  color?: string,
): HighlightRect | null {
  if (!bbox || bbox.length < 4) return null
  const a = Number(bbox[0])
  const b = Number(bbox[1])
  const c = Number(bbox[2])
  const d = Number(bbox[3])
  if (![a, b, c, d].every((v) => Number.isFinite(v))) return null

  const left = Math.min(a, c)
  const top = Math.min(b, d)
  const right = Math.max(a, c)
  const bottom = Math.max(b, d)
  const padX = 2
  const padY = 1.5
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: {
      x: Math.max(0, left - padX),
      y: Math.max(0, top - padY),
      w: Math.max(6, right - left + padX * 2),
      h: Math.max(6, bottom - top + padY * 2),
    },
  }
}

function buildPageAnchorHighlight(id: string, page: number, color?: string): HighlightRect {
  return {
    id,
    page: Math.max(1, Math.floor(Number(page) || 1)),
    color,
    coords: {
      x: 8,
      y: 8,
      w: 8,
      h: 8,
    },
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderChemicalDigitsAsSubscriptHtml(input: string): string {
  // Subscript digits only inside chemical-looking tokens.
  // This preserves normal prose like "30 wt.% water" while still formatting
  // PF6, H2O, C8mim, [P6,6,6,14], [N1,8,8,8], etc.
  return input.replace(/(\[[A-Za-z][A-Za-z0-9,+\-\s]*\]|[A-Za-z][A-Za-z0-9,+\-\[\]\(\)]*)/g, (token) => {
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) {
      return token
    }

    // Skip plain measurement/value phrases that only start with digits or are not chemical tokens.
    if (/^\d/.test(token)) {
      return token
    }

    return token.replace(/(\d+)/g, '<sub>$1</sub>')
  })
}

function formatIonicLiquidHtml(input: string | null | undefined): string {
  const value = String(input || '').trim()
  if (!value) return '--'
  return renderChemicalDigitsAsSubscriptHtml(escapeHtml(value))
}

function formatEvidenceChipTermHtml(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const safe = escapeHtml(raw)
  if (!normalizeIlAliasKey(raw)) return safe
  return renderChemicalDigitsAsSubscriptHtml(safe)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

type EvidenceTermSpec = {
  term: string
  colorClass: string
  pdfColor: string
  aliases?: string[]
}

function buildEvidenceTermSpecs(record: RecordResponse): EvidenceTermSpec[] {
  const ev = evidenceData.value[record.id]
  const specs: EvidenceTermSpec[] = []
  const seen = new Set<string>()
  const keyToIndex = new Map<string, number>()
  const lubricantDisplay = String(record.lubricant || '').trim()
  const lubricantKey = normalizeTermKey(lubricantDisplay)
  const lubricantIlKey = normalizeIlAliasKey(lubricantDisplay)

  const push = (term: string | null | undefined, colorClass: string, pdfColor: string) => {
    const raw = String(term || '').trim()
    if (raw.length < 2) return

    const normalizedKey = normalizeTermKey(raw)
    if (!normalizedKey) return
    const ilKey = normalizeIlAliasKey(raw)

    // Keep only the current row's ionic liquid term; drop other IL names from evidence terms.
    if (ilKey) {
      if (lubricantIlKey) {
        if (ilKey !== lubricantIlKey) return
      } else if (!termsEquivalent(raw, lubricantDisplay)) {
        return
      }
    }

    // Keep IL aliases consistent with the IONIC LIQUID field display.
    const display = (
      (ilKey && lubricantIlKey && ilKey === lubricantIlKey)
      || (lubricantDisplay && lubricantKey && normalizedKey === lubricantKey)
    )
      ? lubricantDisplay
      : raw

    const displayIlKey = normalizeIlAliasKey(display)
    const key = displayIlKey ? `il:${displayIlKey}` : `txt:${normalizeEvidenceChipKey(display)}`
    if (!key) return

    if (seen.has(key)) {
      const existingIndex = keyToIndex.get(key)
      if (existingIndex == null) return
      const existing = specs[existingIndex]
      if (!existing) return
      if (!termsEquivalent(existing.term, raw)) {
        const aliases = new Set(existing.aliases || [])
        aliases.add(raw)
        existing.aliases = Array.from(aliases)
      }
      return
    }

    seen.add(key)
    keyToIndex.set(key, specs.length)
    const aliases = termsEquivalent(display, raw) ? [] : [raw]
    specs.push({ term: display, colorClass, pdfColor, aliases })
  }

  push(record.cofRaw || (record.cofValue != null ? String(record.cofValue) : ''), 'bg-yellow-200/90', 'rgba(250, 204, 21, 0.35)')
  push(record.lubricant, 'bg-cyan-200/90', 'rgba(103, 232, 249, 0.35)')
  push(record.materialName, 'bg-emerald-200/90', 'rgba(110, 231, 183, 0.35)')

  // Condition-related fields in distinct colors
  push(record.temperature, 'bg-orange-200/90', 'rgba(253, 186, 116, 0.35)')
  push(record.potential, 'bg-violet-200/90', 'rgba(196, 181, 253, 0.35)')
  push(record.waterContent, 'bg-sky-200/90', 'rgba(125, 211, 252, 0.35)')
  push(record.speedValue, 'bg-lime-200/90', 'rgba(190, 242, 100, 0.35)')
  push(record.loadValue, 'bg-rose-200/90', 'rgba(254, 205, 211, 0.35)')
  push(record.surfaceRoughness, 'bg-amber-200/90', 'rgba(253, 230, 138, 0.35)')
  push(record.filmThickness, 'bg-fuchsia-200/90', 'rgba(245, 208, 254, 0.35)')

  // Include any backend-provided highlight terms not already covered
  for (const term of ev?.highlight_terms || []) {
    push(term, 'bg-slate-200/90', 'rgba(226, 232, 240, 0.35)')
  }

  return specs
}

function evidenceTermChips(record: RecordResponse): EvidenceTermSpec[] {
  return buildEvidenceTermSpecs(record).slice(0, 14)
}

function isVisualEvidenceSource(ev: EvidenceResult | null | undefined): boolean {
  const sourceType = String(ev?.source_type || '').trim().toLowerCase()
  if (sourceType === 'visual') return true
  if (sourceType === 'text') return false

  const source = String(ev?.source || '').trim().toLowerCase()
  if (!source) return false
  return (
    source.startsWith('fig')
    || source.startsWith('table')
    || source.startsWith('image')
    || source.startsWith('plot')
  )
}

function isTextEvidence(recordId: number): boolean {
  return !isVisualEvidenceSource(evidenceData.value[recordId])
}

function evidenceSnippet(record: RecordResponse): string {
  const ev = evidenceData.value[record.id]
  const snippet = ev?.text_snippet || ev?.evidence_text || record.evidence || ''
  return String(snippet).trim()
}

function highlightEvidenceHtml(record: RecordResponse): string {
  const raw = evidenceSnippet(record)
  if (!raw) return 'No quote text available.'

  const specs = buildEvidenceTermSpecs(record)
  let html = escapeHtml(raw)
  const tokens: Record<string, string> = {}
  let tokenCounter = 0

  const entries = specs
    .flatMap((spec) => {
      const allTerms = [spec.term, ...(spec.aliases || [])]
      const seenTerms = new Set<string>()
      const uniqueTerms: string[] = []
      for (const t of allTerms) {
        const normalized = normalizeTermKey(t)
        if (!normalized || seenTerms.has(normalized)) continue
        seenTerms.add(normalized)
        uniqueTerms.push(t)
      }
      return uniqueTerms.map((matchTerm) => ({ spec, matchTerm }))
    })
    .sort((a, b) => b.matchTerm.length - a.matchTerm.length)

  for (const entry of entries) {
    const safeTerm = escapeHtml(entry.matchTerm)
    const pattern = new RegExp(escapeRegExp(safeTerm), 'gi')
    html = html.replace(pattern, (matched) => {
      const token = `__EVIDENCE_HL_${tokenCounter++}__`
      tokens[token] =
        `<mark data-term="${escapeHtml(entry.spec.term)}" class="cursor-pointer rounded px-0.5 text-slate-900 ${entry.spec.colorClass}" title="Click to locate in PDF">${matched}</mark>`
      return token
    })
  }

  for (const [token, markup] of Object.entries(tokens)) {
    html = html.split(token).join(markup)
  }
  return html
}

async function openTermInPdf(record: RecordResponse, term: string) {
  if (!record.literatureId) return
  let ev = evidenceData.value[record.id]
  try {
    const fresh = await getRecordEvidence(record.literatureId, record.id)
    evidenceData.value[record.id] = fresh
    ev = fresh
  } catch {
    // Use cached evidence if refresh fails.
  }
  const hit = findBestTermHit(ev, term)
  const specs = buildEvidenceTermSpecs(record)
  const termKey = normalizeTermKey(term)
  const spec = specs.find((s) => termsEquivalent(s.term, term) || (s.aliases || []).some((a) => termsEquivalent(a, term)))
    || specs.find((s) => {
      const k = normalizeTermKey(s.term)
      return k.includes(termKey) || termKey.includes(k)
    })
  const pdfColor = spec?.pdfColor || 'rgba(250, 204, 21, 0.35)'
  const isVisualSource = isVisualEvidenceSource(ev)
  let targetPage = hit?.page || ev?.page || 1
  const previewSrc = evidenceImageSrc(record.id) || evidencePagePreviewSrc(record.id)

  // If backend has no PDF available, fall back to image preview mode.
  if (isVisualSource && !ev?.has_pdf && previewSrc) {
    targetPage = ev?.page || record.sourcePage || targetPage
    openImagePreview(
      previewSrc,
      `${ev?.source || 'Figure Evidence'} · Page ${targetPage}`,
    )
    return
  }

  let highlight: HighlightRect
  if (isVisualSource) {
    targetPage = hit?.page || ev?.page || record.sourcePage || 1
    highlight =
      buildHighlightRect(`${record.id}-visual-term-${Date.now()}`, hit?.page || 0, hit?.bbox, pdfColor) ||
      buildHighlightRect(`${record.id}-visual-${Date.now()}`, ev?.page || 0, ev?.bbox, pdfColor) ||
      buildPageAnchorHighlight(`${record.id}-visual-page-${targetPage}-${Date.now()}`, targetPage, pdfColor)
  } else {
    // Important: do not fallback to record-level bbox when a text term has no own hit.
    // Otherwise unrelated fields (e.g. speed) can be highlighted as COF bbox.
    highlight =
      buildHighlightRect(`${record.id}-${Date.now()}`, hit?.page || 0, hit?.bbox, pdfColor) ||
      buildPageAnchorHighlight(`${record.id}-p-${targetPage}-${Date.now()}`, targetPage, pdfColor)
  }

  pdfLocate.value.open = true
  pdfLocate.value.title = isVisualSource
    ? `Source Locator · Figure Page ${targetPage}`
    : `Source Locator · Page ${targetPage}`
  pdfLocate.value.pdfUrl = `/api/pdf/${record.literatureId}`
  pdfLocate.value.highlights = [highlight]
  pdfLocate.value.activeHighlightId = highlight.id
  pdfLocate.value.notice = ''

  if (isVisualSource) {
    if (hit?.bbox && hit?.bbox.length === 4) {
      pdfLocate.value.notice = `Visual evidence detected (${ev?.source || 'Figure'}). Positioned using "${term}" in the grounded region.`
    } else if (ev?.bbox && ev?.bbox.length === 4) {
      pdfLocate.value.notice = `Visual evidence detected (${ev?.source || 'Figure'}). Positioned to the source image region.`
    } else {
      pdfLocate.value.notice = `Visual evidence detected (${ev?.source || 'Figure'}), but no exact figure bbox was found. Positioned to page ${targetPage}.`
    }
    return
  }

  const snippet = (ev?.text_snippet || ev?.evidence_text || '').toLowerCase()
  const roomTempMentioned = snippet.includes('room temperature') || snippet.includes('ambient temperature')
  if (hit?.inferred || (looksLikeTemperatureTerm(term) && roomTempMentioned && !hit)) {
    pdfLocate.value.notice =
      `This value may be model-inferred. Located evidence matched "${hit?.matched_text || 'room temperature'}" rather than exact "${term}".`
  } else if (!hit) {
    pdfLocate.value.notice =
      `No exact text hit found for "${term}". Positioned to page ${targetPage}; please verify manually.`
  }
}

function openRecordPdf(record: RecordResponse) {
  if (!record.literatureId) return
  const ev = evidenceData.value[record.id]
  if (isVisualEvidenceSource(ev)) {
    const previewSrc = evidenceImageSrc(record.id) || evidencePagePreviewSrc(record.id)
    if (previewSrc) {
      openImagePreview(
        previewSrc,
        `${ev?.source || 'Figure Evidence'} · Page ${ev?.page || record.sourcePage || '--'}`,
      )
      return
    }
  }
  const targetPage = ev?.page || 1
  const highlight =
    buildHighlightRect(`${record.id}-ev-${Date.now()}`, ev?.page || 0, ev?.bbox, 'rgba(250, 204, 21, 0.35)') ||
    buildPageAnchorHighlight(`${record.id}-page-${targetPage}-${Date.now()}`, targetPage, 'rgba(250, 204, 21, 0.35)')

  pdfLocate.value.open = true
  pdfLocate.value.title = `Source Locator · Page ${targetPage}`
  pdfLocate.value.pdfUrl = `/api/pdf/${record.literatureId}`
  pdfLocate.value.highlights = [highlight]
  pdfLocate.value.activeHighlightId = highlight.id
  pdfLocate.value.notice = ''
}

function onEvidenceSnippetClick(e: Event, record: RecordResponse) {
  const target = e.target as HTMLElement | null
  if (!target) return
  const mark = target.closest('mark[data-term]') as HTMLElement | null
  const term = mark?.dataset?.term?.trim()
  if (!term) return
  openTermInPdf(record, term)
}

function onPdfLocateHighlightClick(id: string) {
  pdfLocate.value.activeHighlightId = id
}

async function fetchEvidence(record: RecordResponse) {
  if (!record.literatureId) return
  if (evidenceLoading.value[record.id]) return
  const cached = evidenceData.value[record.id]
  const hasUsefulCachedData =
    !!cached &&
    (cached.has_image ||
      !!cached.evidence_text ||
      !!cached.page ||
      !!cached.source)
  const hasTermHits = !!(cached && Array.isArray(cached.term_hits) && cached.term_hits.length > 0)
  if (hasUsefulCachedData && (!cached?.has_pdf || hasTermHits)) {
    const previousStoredScore = Number(record.confidence || 0)
    promoteRecordConfidence(record)
    await persistPromotedConfidence(record, previousStoredScore)
    return
  }

  evidenceLoading.value[record.id] = true
  evidenceError.value[record.id] = null

  try {
    const ev = await getRecordEvidence(record.literatureId, record.id)
    evidenceData.value[record.id] = ev
    const previousStoredScore = Number(record.confidence || 0)
    promoteRecordConfidence(record)
    await persistPromotedConfidence(record, previousStoredScore)
  } catch (err: any) {
    evidenceData.value[record.id] = null
    evidenceError.value[record.id] = err?.message || 'Failed to load evidence'
  } finally {
    evidenceLoading.value[record.id] = false
  }
}

async function loadOptions() {
  try {
    filterOptions.value = await getFilterOptions()
  } catch (err) {
    console.error('Failed to load filter options', err)
  }
}

function buildCurrentFilter(): SearchFilter {
  return {
    materials: selectedMaterial.value ? [selectedMaterial.value] : [],
    lubricants: selectedLubricant.value ? [selectedLubricant.value] : [],
    cof_min: cofMin.value ? parseFloat(cofMin.value) : undefined,
    cof_max: cofMax.value ? parseFloat(cofMax.value) : undefined,
    doi: searchDoi.value || undefined,
    fileId: props.selectedFileId || undefined,
  }
}

function exportFilename(ext: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const doiPart = searchDoi.value ? searchDoi.value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) : 'all'
  return `verified_data_${doiPart}_${stamp}.${ext}`
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '')
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(records: RecordResponse[]): string {
  const headers = [
    'id',
    'literatureId',
    'doi',
    'title',
    'lubricant',
    'materialName',
    'temperature',
    'potential',
    'waterContent',
    'speedValue',
    'loadValue',
    'surfaceRoughness',
    'filmThickness',
    'cofRaw',
    'cofValue',
    'source',
    'evidence',
    'evidencePage',
  ]
  const rows = records.map((r) => [
    r.id,
    r.literatureId,
    r.literature?.doi || '',
    r.literature?.title || '',
    r.lubricant || '',
    r.materialName || '',
    r.temperature || '',
    r.potential || '',
    r.waterContent || '',
    r.speedValue || '',
    r.loadValue || '',
    r.surfaceRoughness || '',
    r.filmThickness || '',
    r.cofRaw || '',
    r.cofValue ?? '',
    r.source || '',
    r.evidence || '',
    r.evidencePage ?? '',
  ])
  return [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n')
}

async function fetchAllFilteredRecords(): Promise<RecordResponse[]> {
  const filter = buildCurrentFilter()
  const pageSize = 200
  let skip = 0
  const all: RecordResponse[] = []
  while (true) {
    const page = await searchRecords(filter, skip, pageSize)
    all.push(...(page.items || []))
    skip += page.items.length
    if (!page.items.length || skip >= page.total) break
  }
  return all
}

async function exportVerifiedData(format: ExportFormat) {
  showExportMenu.value = false
  if (exporting.value) return
  exporting.value = true
  try {
    const records = await fetchAllFilteredRecords()
    if (!records.length) {
      alert('No records to export under current filters.')
      return
    }

    if (format === 'json') {
      const payload = {
        exportedAt: new Date().toISOString(),
        total: records.length,
        filter: buildCurrentFilter(),
        records,
      }
      triggerDownload(exportFilename('json'), JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
      return
    }

    if (format === 'csv') {
      triggerDownload(exportFilename('csv'), toCsv(records), 'text/csv;charset=utf-8')
      return
    }

    const ndjson = records.map((r) => JSON.stringify(r)).join('\n')
    triggerDownload(exportFilename('ndjson'), ndjson, 'application/x-ndjson;charset=utf-8')
  } catch (err) {
    console.error('Export failed', err)
    alert('Export failed. Please try again.')
  } finally {
    exporting.value = false
  }
}

async function fetchData() {
  loading.value = true
  try {
    const filter = buildCurrentFilter()

    const skip = (currentPage.value - 1) * PAGE_SIZE
    result.value = await searchRecords(filter, skip, PAGE_SIZE)
  } catch (err) {
    console.error('Failed to fetch records', err)
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  currentPage.value = 1
  fetchData()
}

function goToPage(page: number) {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  fetchData()
}

function clearDoiFilter() {
  searchDoi.value = ''
  emit('clear-doi')
  handleSearch()
}

async function saveRecord(record: RecordResponse) {
  const vals = editingValues.value[record.id]
  if (!vals) return

  savingRowId.value = record.id
  try {
    const cofRaw = vals.cof.trim()
    const parsed = cofRaw ? parseFloat(cofRaw.replace(/[<>~=]/g, '')) : undefined
    const lubricant = vals.lubricant.trim()
    const materialName = vals.materialName.trim()
    const temperature = vals.temperature.trim()
    const potential = vals.potential.trim()
    const waterContent = vals.waterContent.trim()
    const speedValue = vals.speedValue.trim()
    const loadValue = vals.loadValue.trim()
    const surfaceRoughness = vals.surfaceRoughness.trim()
    const filmThickness = vals.filmThickness.trim()

    const updated = await updateTribologyRecord(record.id, {
      lubricant,
      materialName,
      temperature,
      potential,
      waterContent,
      speedValue,
      loadValue,
      surfaceRoughness,
      filmThickness,
      cofRaw,
      cofValue: isNaN(parsed as number) ? undefined : parsed,
    })

    record.lubricant = lubricant
    record.materialName = materialName
    record.temperature = temperature
    record.potential = potential
    record.waterContent = waterContent
    record.speedValue = speedValue
    record.loadValue = loadValue
    record.surfaceRoughness = surfaceRoughness
    record.filmThickness = filmThickness
    record.cofRaw = cofRaw
    if (!isNaN(parsed as number)) {
      record.cofValue = parsed as number
    }
    if (typeof updated?.confidence === 'number') {
      record.confidence = updated.confidence
    }
    if (updated?.confidenceDetails) {
      record.confidenceDetails = updated.confidenceDetails
    }
    if (evidenceData.value[record.id]) {
      promoteRecordConfidence(record)
    }
    expandedRowId.value = null
  } catch (err) {
    console.error('Failed to save record', err)
    alert('Save failed')
  } finally {
    savingRowId.value = null
  }
}

async function removeRecord(record: RecordResponse) {
  if (!confirm(`Delete record ${record.id}?`)) return

  deletingRowId.value = record.id
  try {
    const resp = await deleteTribologyRecord(record.id)
    if (resp?.success) {
      result.value.items = result.value.items.filter((r) => r.id !== record.id)
      result.value.total = Math.max(0, result.value.total - 1)
      if (expandedRowId.value === record.id) expandedRowId.value = null
    }
  } catch (err) {
    console.error('Failed to delete record', err)
    alert('Delete failed')
  } finally {
    deletingRowId.value = null
  }
}

onMounted(async () => {
  await loadOptions()
  await fetchData()
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('pointerdown', onGlobalPointerdown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointerdown', onGlobalPointerdown)
})

watch(
  () => props.initialDoi,
  (newDoi) => {
    searchDoi.value = newDoi || ''
    handleSearch()
  }
)

watch(
  () => props.selectedFileId,
  () => {
    currentPage.value = 1
    fetchData()
  }
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-slate-50 dark:bg-[#07111d] dark:text-slate-100">
    <div class="border-b bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-950/80">
      <div class="mb-6 flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2">
            <BookOpen class="h-6 w-6 text-blue-600" />
            <h1 class="text-xl font-bold text-slate-900 dark:text-slate-100">IonicLink Sourcing</h1>
          </div>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Automatically locate data sources; dual verification ensures extraction precision.</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            @click="emit('view-literature')"
          >
            <BookOpen class="h-4 w-4" /> Literature Mgmt
          </button>
          <div class="relative">
            <button
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              :disabled="exporting"
              @click="showExportMenu = !showExportMenu"
            >
              <Download class="h-4 w-4" />
              {{ exporting ? 'Exporting...' : 'Export Verified Data' }}
            </button>
            <div
              v-if="showExportMenu"
              class="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('json')"
              >
                Export as JSON
              </button>
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('csv')"
              >
                Export as CSV
              </button>
              <button
                type="button"
                class="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="exportVerifiedData('ndjson')"
              >
                Export as NDJSON
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span v-if="props.selectedFileId && props.sourceName" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
          Source: {{ props.sourceName }}
        </span>
        <span v-else class="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Showing all data
        </span>

        <div class="relative flex w-64 items-center">
          <input
            v-model="searchDoi"
            type="text"
            placeholder="Search by Literature DOI..."
            class="w-full rounded-full border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
            @keydown.enter="handleSearch"
          />
          <button
            v-if="searchDoi"
            class="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            @click="clearDoiFilter"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div class="mb-2 flex items-center gap-2">
        <svg class="h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h2 class="text-sm font-bold text-slate-800 dark:text-slate-200">Advanced Search</h2>
      </div>

      <div class="flex flex-wrap items-end gap-4">
        <div class="w-48">
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">Ionic Liquid</label>
          <select v-model="selectedLubricant" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" @change="handleSearch">
            <option value="">All</option>
            <option v-for="l in filterOptions.lubricants" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>

        <div class="w-48">
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">Surface Type</label>
          <select v-model="selectedMaterial" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" @change="handleSearch">
            <option value="">All</option>
            <option v-for="m in filterOptions.materials" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <div>
          <label class="mb-1.5 block text-xs text-slate-400 dark:text-slate-500">COF Range</label>
          <div class="flex items-center gap-2">
            <input v-model="cofMin" type="text" placeholder="Min" class="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500" />
            <span class="text-slate-300 dark:text-slate-600">-</span>
            <input v-model="cofMax" type="text" placeholder="Max" class="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500" />
          </div>
        </div>

        <button class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" @click="handleSearch">
          <Search class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto px-6 py-4">
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85 dark:shadow-[0_10px_30px_rgba(2,8,23,0.35)]">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">ID</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">IONIC LIQUID</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">SURFACE</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">TEMPERATURE (K)</th>
              <th class="px-4 py-4 font-medium text-slate-500 dark:text-slate-400">CONDITION</th>
              <th class="px-4 py-4 font-medium text-blue-600">COF</th>
              <th class="px-4 py-4 text-right font-medium text-slate-500 dark:text-slate-400">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500">Loading...</td>
            </tr>
            <template v-else-if="result.items.length">
              <template v-for="record in result.items" :key="record.id">
                <tr class="cursor-pointer border-t border-slate-100 hover:bg-blue-50/20 dark:border-slate-800 dark:hover:bg-blue-500/6" @click="toggleRow(record)">
                  <td class="px-4 py-4 text-slate-500 dark:text-slate-400">{{ record.id }}</td>
                  <td class="px-4 py-4">
                    <div class="flex items-center gap-2">
                      <div v-if="record.cationSmiles || record.anionSmiles" class="flex gap-1 shrink-0">
                        <button
                          v-if="record.cationSmiles"
                          type="button"
                          class="rounded-md transition hover:scale-[1.02]"
                          :class="structurePreview.open && structurePreview.rowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                          title="Show chemical structures"
                          @click.stop="openStructurePreview(record)"
                        >
                          <MoleculeViewer
                            :smiles="record.cationSmiles"
                            size="thumbnail"
                            :width="40"
                            :height="30"
                          />
                        </button>
                        <button
                          v-if="record.anionSmiles"
                          type="button"
                          class="rounded-md transition hover:scale-[1.02]"
                          :class="structurePreview.open && structurePreview.rowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                          title="Show chemical structures"
                          @click.stop="openStructurePreview(record)"
                        >
                          <MoleculeViewer
                            :smiles="record.anionSmiles"
                            size="thumbnail"
                            :width="40"
                            :height="30"
                          />
                        </button>
                      </div>
                      <div class="font-semibold text-slate-800 dark:text-slate-100" v-html="formatIonicLiquidHtml(record.lubricant || '--')"></div>
                    </div>
                  </td>
                  <td class="px-4 py-4 text-slate-600 dark:text-slate-300">{{ record.materialName || '--' }}</td>
                  <td class="px-4 py-4 text-slate-600 dark:text-slate-300">{{ record.temperature || '--' }}</td>
                  <td class="px-4 py-4">
                    <div class="flex flex-wrap gap-1.5">
                      <span v-for="tag in conditionTags(record)" :key="tag" class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {{ tag }}
                      </span>
                      <span v-if="!conditionTags(record).length" class="text-slate-400 dark:text-slate-500">--</span>
                    </div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="font-bold text-blue-600">{{ cofDisplay(record) }}</div>
                    <div class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">Conf: {{ confidenceDisplay(confidenceValueFor(record)) }}</div>
                  </td>
                  <td class="px-4 py-4">
                    <div class="flex items-center justify-end gap-1.5" @click.stop>
                      <button
                        class="inline-flex h-7 w-7 items-center justify-center rounded text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10"
                        @click="toggleRow(record)"
                      >
                        <Eye class="h-4 w-4" />
                      </button>
                      <button
                        class="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                        @click="toggleRow(record)"
                      >
                        <Edit class="h-4 w-4" />
                      </button>
                      <button
                        class="inline-flex h-7 w-7 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        :disabled="deletingRowId === record.id"
                        @click="removeRecord(record)"
                      >
                        <Trash2 class="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>

                <tr v-if="expandedRowId === record.id" class="border-t bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/50">
                  <td colspan="7" class="px-4 py-4">
                    <div class="grid gap-4 lg:grid-cols-3">
                      <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                        <div class="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          <BookOpen class="h-4 w-4" /> Reference Details
                        </div>

                        <div class="mb-4">
                          <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Title</div>
                          <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{{ record.literature?.title || '--' }}</div>
                        </div>

                        <div class="mb-4 grid grid-cols-2 gap-4">
                          <div>
                            <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Authors</div>
                            <div class="text-sm text-slate-900 dark:text-slate-200">{{ record.literature?.authors || '--' }}</div>
                          </div>
                          <div>
                            <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">Journal</div>
                            <div class="text-sm text-slate-900 dark:text-slate-200">
                              {{ record.literature?.journal || '--' }}
                            </div>
                          </div>
                        </div>

                        <div>
                          <div class="mb-1 text-xs text-slate-400 dark:text-slate-500">DOI</div>
                          <div class="text-sm text-blue-600">
                            <a
                              v-if="record.literature?.doi"
                              :href="`https://doi.org/${record.literature.doi}`"
                              target="_blank"
                              class="inline-flex items-center gap-1 hover:underline cursor-pointer"
                            >
                              {{ record.literature.doi }}
                              <ExternalLink class="h-3.5 w-3.5" />
                            </a>
                            <span v-else class="text-slate-900 dark:text-slate-200">--</span>
                          </div>
                        </div>

                      </div>

                      <div class="relative rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950" @click.stop>
                        <div class="mb-2 flex items-center justify-between">
                          <p class="text-xs font-semibold uppercase tracking-wide text-blue-700">Data Verification</p>
                          <div class="relative" data-confidence-popover-root="true">
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20 dark:hover:bg-emerald-500/15"
                              @click.stop="toggleConfidencePopover(record.id)"
                            >
                              <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              Confidence {{ confidenceDisplay(confidenceValueFor(record)) }}
                            </button>

                            <div
                              v-if="activeConfidencePopoverId === record.id"
                              class="absolute right-0 z-20 mt-2 w-[340px] overflow-hidden rounded-2xl border border-emerald-50 bg-[linear-gradient(135deg,#ffffff_0%,#e8fcf5_100%)] shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:border-emerald-500/20 dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(8,65,54,0.82)_100%)]"
                            >
                              <div class="px-5 py-5">
                                <!-- Header -->
                                <div class="mb-4 flex items-center gap-2">
                                  <ShieldCheck class="h-5 w-5 text-emerald-600" />
                                  <span class="text-sm font-bold text-slate-800 dark:text-slate-100">AI Confidence Score</span>
                                </div>

                                <!-- Big Score & Delta -->
                                <div class="mb-5 flex items-end gap-3">
                                  <div class="flex items-baseline text-emerald-600">
                                    <span class="text-6xl font-black tracking-tighter leading-none">{{ confidencePercentNumber(confidenceValueFor(record)).toFixed(0) }}</span>
                                    <span class="text-3xl font-bold leading-none">%</span>
                                  </div>
                                  <div class="pb-1">
                                    <div class="text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                                      {{ confidencePercentNumber(confidenceValueFor(record)) >= 80 ? 'High Confidence' : confidencePercentNumber(confidenceValueFor(record)) >= 50 ? 'Medium Confidence' : 'Low Confidence' }}
                                    </div>
                                    <div class="mt-1">
                                      <div
                                        v-if="confidenceDeltaPercent(record) > 0"
                                        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-100/60"
                                      >
                                        <ArrowUp class="h-3 w-3" /> Up from {{ confidencePercentNumber(record.confidence).toFixed(0) }}% (Stored)
                                      </div>
                                      <div
                                        v-else-if="confidenceDeltaPercent(record) < 0"
                                        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-rose-700 bg-rose-100/60"
                                      >
                                        <ArrowDown class="h-3 w-3" /> Down from {{ confidencePercentNumber(record.confidence).toFixed(0) }}% (Stored)
                                      </div>
                                      <div
                                        v-else
                                        class="inline-flex items-center gap-0.5 rounded bg-slate-100/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"
                                      >
                                        Synced with stored confidence
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <!-- Box Breakdown -->
                                <div class="rounded-xl bg-white/70 p-1 ring-1 ring-slate-100/50 backdrop-blur-sm dark:bg-slate-950/50 dark:ring-slate-700/70">
                                  <div class="flex flex-col gap-0.5">
                                    <div class="flex items-center justify-between px-3 py-2">
                                      <div class="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                        <Flag class="h-4 w-4 text-slate-400 dark:text-slate-500" />
                                        <span class="text-[13px] font-medium">Base Score</span>
                                      </div>
                                      <span class="text-[14px] font-bold text-slate-700 dark:text-slate-200">{{ confidenceDetailsFor(record).base_percent.toFixed(0) }}</span>
                                    </div>

                                    <div class="mx-3 h-px bg-slate-100 dark:bg-slate-800"></div>

                                    <template v-if="confidenceDetailsFor(record).penalties?.length">
                                      <div
                                        v-for="(penalty, idx) in confidenceDetailsFor(record).penalties"
                                        :key="`pen-${idx}`"
                                        class="flex flex-col"
                                      >
                                        <div class="flex items-center justify-between px-3 py-2 text-rose-500">
                                          <div class="flex items-center gap-2 max-w-[200px]">
                                            <MinusCircle class="h-4 w-4 shrink-0" />
                                            <span class="text-[13px] truncate">{{ confidencePenaltyLabel(penalty.reason) }}</span>
                                          </div>
                                          <span class="text-[14px] font-bold shrink-0">{{ confidencePenaltyValue(penalty.value) }}</span>
                                        </div>
                                      </div>
                                    </template>
                                    <template v-else>
                                      <div class="flex items-center justify-between px-3 py-2 text-rose-500/50">
                                        <div class="flex items-center gap-2">
                                          <MinusCircle class="h-4 w-4" />
                                          <span class="text-[13px]">No penalties applied</span>
                                        </div>
                                        <span class="text-[14px] font-bold">-0</span>
                                      </div>
                                    </template>

                                    <template v-if="confidenceDetailsFor(record).boosts?.length">
                                      <div
                                        v-for="(boost, idx) in confidenceDetailsFor(record).boosts"
                                        :key="`bst-${idx}`"
                                        class="flex flex-col"
                                      >
                                        <div class="flex items-center justify-between px-3 py-2 text-emerald-400">
                                          <div class="flex items-center gap-2 max-w-[200px]">
                                            <PlusCircle class="h-4 w-4 shrink-0" />
                                            <span class="text-[13px] truncate">{{ confidenceBoostLabel(boost.reason) }}</span>
                                          </div>
                                          <span class="text-[14px] font-bold shrink-0">{{ confidenceBoostValue(boost.value) }}</span>
                                        </div>
                                      </div>
                                    </template>
                                    <template v-else>
                                      <div class="flex items-center justify-between px-3 py-2 text-emerald-400">
                                        <div class="flex items-center gap-2">
                                          <PlusCircle class="h-4 w-4" />
                                          <span class="text-[13px]">No boosts applied</span>
                                        </div>
                                        <span class="text-[14px] font-bold">+0</span>
                                      </div>
                                    </template>
                                  </div>
                                </div>
                              </div>

                              <div class="px-5 pb-5">
                                <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    class="h-full rounded-full bg-emerald-500 transition-all"
                                    :style="{ width: `${confidencePercentNumber(confidenceValueFor(record))}%` }"
                                  ></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="grid grid-cols-1 gap-2">
                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">IONIC LIQUID</label>
                              <input
                                :value="editingValues[record.id]?.lubricant ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'lubricant', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="Ionic liquid"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">SURFACE</label>
                              <input
                                :value="editingValues[record.id]?.materialName ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'materialName', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="Surface"
                              />
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Temperature</label>
                              <input
                                :value="editingValues[record.id]?.temperature ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'temperature', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 298.15 K"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Potential</label>
                              <input
                                :value="editingValues[record.id]?.potential ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'potential', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. +1.5 V / OCP"
                              />
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Water</label>
                              <input
                                :value="editingValues[record.id]?.waterContent ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'waterContent', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 50 ppm"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Speed</label>
                              <input
                                :value="editingValues[record.id]?.speedValue ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'speedValue', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 1 μm/s"
                              />
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Load</label>
                              <input
                                :value="editingValues[record.id]?.loadValue ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'loadValue', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. 25 nN"
                              />
                            </div>
                            <div>
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Surface Roughness</label>
                              <input
                                :value="editingValues[record.id]?.surfaceRoughness ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'surfaceRoughness', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                                placeholder="e.g. RMS 4.9 nm"
                              />
                            </div>
                          </div>

                          <div>
                            <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COND · Roughness (Film)</label>
                            <input
                              :value="editingValues[record.id]?.filmThickness ?? ''"
                              @input="(e: Event) => updateEditingField(record.id, 'filmThickness', (e.target as HTMLInputElement).value)"
                              type="text"
                              class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                              placeholder='e.g. RMS 4.9 nm (BB5-1-M)'
                            />
                          </div>

                          <div class="flex items-end gap-2">
                            <div class="flex-1">
                              <label class="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">COF</label>
                              <input
                                :value="editingValues[record.id]?.cof ?? ''"
                                @input="(e: Event) => updateEditingField(record.id, 'cof', (e.target as HTMLInputElement).value)"
                                type="text"
                                class="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                                placeholder="COF raw value"
                              />
                            </div>
                            <button
                              class="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                              :disabled="savingRowId === record.id"
                              @click="saveRecord(record)"
                            >
                              <Save class="h-4 w-4" /> Save
                            </button>
                          </div>
                        </div>
                      </div>

                      <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950" @click.stop>
                        <div class="mb-2 flex items-center justify-between">
                          <p class="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Source Evidence</p>
                          <button
                            v-if="record.literatureId"
                            type="button"
                            class="text-xs text-blue-600 hover:underline dark:text-blue-300"
                            @click="openRecordPdf(record)"
                          >
                            Open PDF
                          </button>
                        </div>

                        <p v-if="evidenceLoading[record.id]" class="text-xs text-slate-400 dark:text-slate-500">Locating evidence...</p>
                        <p v-else-if="evidenceError[record.id]" class="text-xs text-red-500">{{ evidenceError[record.id] }}</p>
                        <template v-else-if="evidenceData[record.id]">
                          <p v-if="evidenceData[record.id] && !evidenceData[record.id]?.has_pdf" class="mb-2 text-xs text-amber-600 dark:text-amber-300">
                            PDF file not found on backend disk; evidence image cannot be generated.
                          </p>
                          <div class="mb-2 text-xs text-slate-600 dark:text-slate-300">
                            <div><span class="font-semibold">Type:</span> {{ isTextEvidence(record.id) ? 'text snippet' : (evidenceData[record.id]?.has_image ? 'image region' : 'text only') }}</div>
                            <div><span class="font-semibold">Source:</span> {{ evidenceData[record.id]?.source || '--' }}</div>
                            <div><span class="font-semibold">Page:</span> {{ evidenceData[record.id]?.page ?? '--' }}</div>
                          </div>

                          <div
                            class="mb-2 max-h-40 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            @click="(e) => onEvidenceSnippetClick(e, record)"
                          >
                            <p class="whitespace-pre-wrap" v-html="highlightEvidenceHtml(record)"></p>
                          </div>

                          <div class="mb-2 flex flex-wrap gap-1">
                            <button
                              v-for="chip in evidenceTermChips(record)"
                              :key="`${record.id}-${chip.term}`"
                              class="rounded px-1.5 py-0.5 text-[10px] text-slate-800 hover:opacity-80 dark:text-slate-900"
                              :class="chip.colorClass"
                              :title="`Locate '${chip.term}' in PDF`"
                              @click="openTermInPdf(record, chip.term)"
                            >
                              <span v-html="formatEvidenceChipTermHtml(chip.term)"></span>
                            </button>
                          </div>

                          <div v-if="evidencePagePreviewSrc(record.id)" class="max-h-80 overflow-auto rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                            <img
                              :src="evidencePagePreviewSrc(record.id) as string"
                              alt="Evidence page preview"
                              class="w-full cursor-zoom-in object-contain"
                              @click="openImagePreview(evidencePagePreviewSrc(record.id) as string, `Page ${evidenceData[record.id]?.page ?? '--'}`)"
                            />
                          </div>
                          <img
                            v-else-if="evidenceImageSrc(record.id)"
                            :src="evidenceImageSrc(record.id) as string"
                            alt="Evidence crop"
                            class="max-h-48 w-full cursor-zoom-in rounded border border-slate-200 object-contain dark:border-slate-700 dark:bg-slate-900"
                            @click="openImagePreview(evidenceImageSrc(record.id) as string, `Evidence Crop · Page ${evidenceData[record.id]?.page ?? '--'}`)"
                          />
                          <div v-else class="flex h-24 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                            No evidence image available
                          </div>
                        </template>
                        <p v-else class="text-xs text-slate-400 dark:text-slate-500">No evidence available</p>
                      </div>
                    </div>

                  </td>
                </tr>
              </template>
            </template>
            <tr v-else>
              <td colspan="7" class="px-4 py-8 text-center text-slate-400 dark:text-slate-500">No matching data</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex items-center justify-between border-t bg-white px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400">
      <div>
        <template v-if="result.total > 0">
          Showing {{ rangeStart }} to {{ rangeEnd }} (Total {{ result.total }})
        </template>
        <template v-else>
          No records found
        </template>
      </div>
      <div class="flex items-center gap-1">
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage === 1"
          @click="goToPage(currentPage - 1)"
        >
          <ChevronLeft class="h-4 w-4" /> Prev
        </button>
        <span class="px-2">{{ currentPage }} / {{ totalPages }}</span>
        <button
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          Next <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </div>

    <Modal :show="pdfLocate.open" max-width="full" @close="closePdfLocate">
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <span class="text-base font-semibold text-slate-900 dark:text-slate-100">{{ pdfLocate.title || 'Source Locator' }}</span>
        </div>
      </template>

      <div class="h-[78vh] min-h-[520px]">
        <div v-if="pdfLocate.notice" class="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          {{ pdfLocate.notice }}
        </div>
        <PdfViewerWithHighlight
          v-if="pdfLocate.pdfUrl"
          :src="pdfLocate.pdfUrl"
          :highlights="pdfLocate.highlights"
          :active-id="pdfLocate.activeHighlightId"
          @highlight-click="onPdfLocateHighlightClick"
        />
      </div>
    </Modal>

    <Modal :show="structurePreview.open" max-width="4xl" @close="closeStructurePreview">
      <template #header>
        <div class="flex items-center justify-between gap-4">
          <span class="text-base font-semibold text-slate-900 dark:text-slate-100">
            Chemical Structure · {{ structurePreview.title || 'Preview' }}
          </span>
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <div v-if="structurePreview.cationSmiles">
          <MoleculeViewer
            :smiles="structurePreview.cationSmiles"
            :label="structurePreview.cationLabel"
            size="full"
          />
        </div>
        <div v-if="structurePreview.anionSmiles">
          <MoleculeViewer
            :smiles="structurePreview.anionSmiles"
            :label="structurePreview.anionLabel"
            size="full"
          />
        </div>
      </div>
    </Modal>

    <div v-if="imagePreview.open" class="fixed inset-0 z-50 bg-black/70 p-6 dark:bg-slate-950/85" @click.self="closeImagePreview">
      <div class="mx-auto flex h-full max-w-6xl flex-col rounded-lg bg-white shadow-2xl dark:border dark:border-slate-800 dark:bg-slate-950">
        <div class="flex items-center justify-between border-b px-4 py-3 dark:border-slate-800">
          <div class="text-sm font-medium text-slate-700 dark:text-slate-200">{{ imagePreview.title }}</div>
          <div class="flex items-center gap-2 text-xs">
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="zoomOutPreview">-</button>
            <span class="w-12 text-center">{{ Math.round(imagePreview.scale * 100) }}%</span>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="zoomInPreview">+</button>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="resetPreviewZoom">Reset</button>
            <button class="rounded border px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" @click="closeImagePreview">Close</button>
          </div>
        </div>
        <div class="flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-900" @wheel.prevent="onPreviewWheel">
          <div class="mx-auto w-fit">
            <img
              :src="imagePreview.src"
              alt="Evidence preview"
              class="block max-w-none rounded border border-slate-300 bg-white shadow dark:border-slate-700 dark:bg-slate-950"
              :style="{ transform: `scale(${imagePreview.scale})`, transformOrigin: 'top center' }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
