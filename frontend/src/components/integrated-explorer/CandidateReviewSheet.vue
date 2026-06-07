<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowRight, Ban, Check, ChevronDown, Flag, FlagOff, Loader2, Maximize2, Pencil, X } from 'lucide-vue-next'

import {
  approveReviewCandidate,
  rejectReviewCandidate,
  confirmCandidateFieldEvidence,
  flagCandidateFieldEvidence,
  unflagCandidateFieldEvidence,
  getCandidateFieldEvidence,
  getPdfBboxPreview,
  getPdfFigurePreviews,
  updateReviewCandidateCofExtracted,
  updateReviewCandidateFields,
  updateReviewCandidateLoadConditions,
  updateReviewCandidateSpeedConditions,
  updateReviewCandidateTribologicalSystem,
  type CofExtracted,
  type FieldEvidenceEntry,
  type LoadConditions,
  type PdfFigurePreview,
  type RecordFieldEvidenceResponse,
  type RecordResponse,
  type SpeedConditions,
  type TribologicalSystem,
} from '@/lib/api'
import { lubricantDisplay, recordDisplayId } from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  show: boolean
  record: RecordResponse | null
  nextRecord?: RecordResponse | null
  hasNextCandidate?: boolean
}>()

const emit = defineEmits<{
  close: []
  'next-candidate': []
  'saved-and-approved': []
  rejected: []
}>()

type ReviewDraft = {
  materialName: string
  lubricant: string
  probeMaterial: string
  probeGeometry: string
  probeRadius: string
  probeRoughness: string
  substrateMaterial: string
  substrateCoating: string
  substrateRoughness: string
  cofRaw: string
  cofValue: string
  loadRaw: string
  loadValue: string
  potential: string
  speedRaw: string
  speedValue: string
  tribologyRaw: string
  contactGeometry: string
  scale: string
  method: string
  instrument: string
  measurementType: string
  frictionRegime: string
}

type EvidenceField = {
  key: string
  label: string
  keys: string[]
  readonly?: boolean
}

// Maps each evidence group to the raw field-evidence keys (and aliases) the
// backend may emit. Verify cards reference these groups to pull the best proof.
const evidenceFields: EvidenceField[] = [
  { key: 'lubricant', label: 'Ionic liquid', keys: ['ionic_liquid', 'lubricant', 'lubricant_alias', 'ionic_liquid_display', 'cation', 'anion'] },
  { key: 'probe_material', label: 'Probe', keys: ['probe_material', 'probe_geometry', 'probe_radius', 'probe_roughness'] },
  { key: 'substrate_material', label: 'Substrate', keys: ['substrate_material', 'substrate_coating', 'substrate_roughness', 'surface_roughness', 'material', 'material_name'] },
  { key: 'cof', label: 'COF', keys: ['cof', 'cof_extracted', 'friction_force', 'wear_rate'] },
  { key: 'load', label: 'Load', keys: ['load', 'load_raw', 'load_value', 'normal_load'] },
  { key: 'potential', label: 'Potential', keys: ['potential', 'voltage', 'surface_potential', 'applied_potential'] },
  { key: 'speed', label: 'Speed', keys: ['speed', 'speed_raw', 'speed_value', 'sliding_speed', 'shear_rate'] },
  { key: 'tribological_system', label: 'Setup', keys: ['tribological_system', 'contact_geometry', 'experiment_scale', 'experiment_method', 'measurement_type', 'regime'] },
]

// Evidence-first verify cards: each surfaces a key fact with its proof inline.
type ReviewCardKey = 'ionic_liquid' | 'cof' | 'tribopair' | 'conditions'
type ReviewCardDef = {
  key: ReviewCardKey
  label: string
  evidenceGroups: string[]
}
const reviewCards: ReviewCardDef[] = [
  { key: 'ionic_liquid', label: 'Ionic liquid', evidenceGroups: ['lubricant'] },
  { key: 'cof', label: 'COF', evidenceGroups: ['cof'] },
  { key: 'tribopair', label: 'Tribopair', evidenceGroups: ['probe_material', 'substrate_material'] },
  { key: 'conditions', label: 'Conditions', evidenceGroups: ['load', 'speed', 'potential'] },
]

const draft = ref<ReviewDraft>(emptyDraft())
const originalDraft = ref<ReviewDraft>(emptyDraft())
const evidence = ref<RecordFieldEvidenceResponse | null>(null)
const evidenceLoading = ref(false)
const evidenceError = ref('')
const saveError = ref('')
const approvalError = ref('')
const saving = ref(false)
const rejecting = ref(false)
const evidenceActionPending = ref('')
const evidenceActionError = ref('')
const evidenceCache = new Map<number, RecordFieldEvidenceResponse>()
const editingCards = ref<Set<ReviewCardKey>>(new Set())
const advancedOpen = ref(false)
const previewImageSrc = ref('')
const figurePreviewsByLiterature = ref<Record<number, PdfFigurePreview[]>>({})
const evidenceImageByKey = ref<Record<string, string | null>>({})
const evidenceImageLoading = ref<Record<string, boolean>>({})
const evidenceImageError = ref<Record<string, string | null>>({})

const candidateId = computed(() => {
  const raw = props.record?.entityId ?? props.record?.id
  const numeric = Number(raw)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
})

const fieldMap = computed<Record<string, FieldEvidenceEntry | undefined>>(() => evidence.value?.fields || {})

type ReviewCardModel = {
  key: ReviewCardKey
  label: string
  value: string
  subValues: { label: string, value: string }[]
  status: 'flagged' | 'confirmed' | 'grounded' | 'check'
  quote: string
  matchedText: string
  note: string
  page: number | null
  confidence: string
  imageSrc: string
  imageLoading: boolean
  hasEvidence: boolean
  actionKey: string
  isFlagged: boolean
  isConfirmed: boolean
}

const cardModels = computed<ReviewCardModel[]>(() => reviewCards.map((card) => {
  const entries = cardEvidenceEntries(card)
  const best = cardBestEvidence(card)
  const bestEntry = best?.entry || null
  const flagged = entries.some(({ entry }) => clean(entry?.review_state).toLowerCase() === 'flagged')
  const reviewState = clean(bestEntry?.review_state).toLowerCase()
  const hasValue = cardHasValue(card)
  const hasEvidence = Boolean(bestEntry && evidenceEntryHasVisibleContent(bestEntry))

  let status: ReviewCardModel['status']
  if (flagged) status = 'flagged'
  else if (!hasValue) status = 'check'
  else if (reviewState === 'confirmed') status = 'confirmed'
  else if (hasEvidence) status = 'grounded'
  else status = 'check'

  const mediaKey = evidenceMediaKey(bestEntry)
  return {
    key: card.key,
    label: card.label,
    value: cardValueDisplay(card),
    subValues: cardSubValues(card),
    status,
    quote: evidenceQuote(bestEntry),
    matchedText: evidenceMatchedText(bestEntry),
    note: clean(bestEntry?.review_note),
    page: evidencePage(bestEntry),
    confidence: evidenceConfidence(bestEntry),
    imageSrc: mediaKey ? (evidenceImageByKey.value[mediaKey] || '') : '',
    imageLoading: mediaKey ? Boolean(evidenceImageLoading.value[mediaKey]) : false,
    hasEvidence,
    actionKey: best?.fieldKey || card.evidenceGroups[0] || card.key,
    isFlagged: reviewState === 'flagged',
    isConfirmed: reviewState === 'confirmed',
  }
}))

const localBlockers = computed(() => {
  const record = props.record
  if (!record) return ['No candidate selected']
  const blockers: string[] = []
  if (!clean(draft.value.lubricant) && !clean(record.ionicLiquidDisplay)) blockers.push('Missing ionic liquid')
  if (!clean(draft.value.cofRaw) && !clean(draft.value.cofValue)) blockers.push('Missing COF')
  if (!clean(draft.value.probeMaterial) && !clean(draft.value.substrateMaterial)) blockers.push('Missing tribopair material')
  const flagged = Object.entries(fieldMap.value)
    .filter(([, entry]) => clean(entry?.review_state).toLowerCase() === 'flagged')
    .map(([key]) => key)
  if (flagged.length) blockers.push(`Flagged evidence: ${flagged.slice(0, 3).join(', ')}`)
  return blockers
})

const readinessLabel = computed(() => (localBlockers.value.length ? 'Needs fix' : 'Ready'))
const readinessTone = computed(() =>
  localBlockers.value.length
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700',
)

const dirtyGroups = computed(() => ({
  scalar:
    draft.value.materialName !== originalDraft.value.materialName
    || draft.value.lubricant !== originalDraft.value.lubricant
    || draft.value.probeMaterial !== originalDraft.value.probeMaterial
    || draft.value.probeGeometry !== originalDraft.value.probeGeometry
    || draft.value.probeRadius !== originalDraft.value.probeRadius
    || draft.value.probeRoughness !== originalDraft.value.probeRoughness
    || draft.value.substrateMaterial !== originalDraft.value.substrateMaterial
    || draft.value.substrateCoating !== originalDraft.value.substrateCoating
    || draft.value.substrateRoughness !== originalDraft.value.substrateRoughness
    || draft.value.potential !== originalDraft.value.potential,
  cof: draft.value.cofRaw !== originalDraft.value.cofRaw || draft.value.cofValue !== originalDraft.value.cofValue,
  load: draft.value.loadRaw !== originalDraft.value.loadRaw || draft.value.loadValue !== originalDraft.value.loadValue,
  speed: draft.value.speedRaw !== originalDraft.value.speedRaw || draft.value.speedValue !== originalDraft.value.speedValue,
  system:
    draft.value.tribologyRaw !== originalDraft.value.tribologyRaw
    || draft.value.contactGeometry !== originalDraft.value.contactGeometry
    || draft.value.scale !== originalDraft.value.scale
    || draft.value.method !== originalDraft.value.method
    || draft.value.instrument !== originalDraft.value.instrument
    || draft.value.measurementType !== originalDraft.value.measurementType
    || draft.value.frictionRegime !== originalDraft.value.frictionRegime,
}))

watch(
  () => [props.show, props.record?.id, props.record?.entityId],
  () => {
    if (!props.show || !props.record) return
    resetDraft(props.record)
    void loadEvidence()
  },
  { immediate: true },
)

watch(
  () => props.show,
  (open) => {
    if (!open) previewImageSrc.value = ''
  },
)

function emptyDraft(): ReviewDraft {
  return {
    cofRaw: '',
    cofValue: '',
    loadRaw: '',
    loadValue: '',
    potential: '',
    speedRaw: '',
    speedValue: '',
    tribologyRaw: '',
    contactGeometry: '',
    scale: '',
    method: '',
    instrument: '',
    measurementType: '',
    frictionRegime: '',
    lubricant: '',
    materialName: '',
    probeGeometry: '',
    probeMaterial: '',
    probeRadius: '',
    probeRoughness: '',
    substrateCoating: '',
    substrateMaterial: '',
    substrateRoughness: '',
  }
}

function resetDraft(record: RecordResponse) {
  const cof = record.cofExtracted || {}
  const load = record.loadConditions || {}
  const speed = record.speedConditions || {}
  const system = record.tribologicalSystem || {}
  const nextDraft: ReviewDraft = {
    materialName: clean(record.materialName),
    lubricant: clean(record.lubricant || record.ionicLiquidDisplay),
    probeMaterial: clean(record.probeMaterial),
    probeGeometry: clean(record.probeGeometry),
    probeRadius: clean(record.probeRadius),
    probeRoughness: clean(record.probeRoughness),
    substrateMaterial: clean(record.substrateMaterial),
    substrateCoating: clean(record.substrateCoating),
    substrateRoughness: clean(record.substrateRoughness),
    cofRaw: clean(cof.rawText ?? cof.raw_text ?? record.cofRaw),
    cofValue: clean(cof.cofAverage ?? cof.cof_average ?? record.cofValue),
    loadRaw: clean(load.rawText ?? load.raw_text ?? record.loadRaw),
    loadValue: clean(load.systemTotalLoadN ?? load.system_total_load_N ?? record.loadValue),
    potential: clean(record.potential),
    speedRaw: clean(speed.rawText ?? speed.raw_text ?? record.speedValue),
    speedValue: clean(speed.slidingVelocityUmS ?? speed.sliding_velocity_um_s ?? record.speedValue),
    tribologyRaw: clean(system.rawText ?? system.raw_text),
    contactGeometry: clean(system.contactGeometry ?? system.contact_geometry ?? record.probeGeometry),
    scale: clean(system.scale ?? record.experimentScale),
    method: clean(system.method ?? record.experimentMethod),
    instrument: clean(system.instrument),
    measurementType: clean(system.measurementType ?? system.measurement_type ?? record.measurementType),
    frictionRegime: clean(system.frictionRegime ?? system.friction_regime ?? record.regime),
  }
  draft.value = { ...nextDraft }
  originalDraft.value = { ...nextDraft }
  saveError.value = ''
  approvalError.value = ''
  evidenceActionError.value = ''
  advancedOpen.value = false
  previewImageSrc.value = ''
  // Guide reviewers straight to the gaps: auto-open edit on any card missing a value.
  const autoEdit = new Set<ReviewCardKey>()
  for (const card of reviewCards) {
    if (!cardHasValue(card)) autoEdit.add(card.key)
  }
  editingCards.value = autoEdit
}

function candidateIdForRecord(record: RecordResponse | null | undefined) {
  const raw = record?.entityId ?? record?.id
  const numeric = Number(raw)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

async function fetchEvidenceForRecord(record: RecordResponse | null | undefined) {
  const id = candidateIdForRecord(record)
  if (!id) return null
  const cached = evidenceCache.get(id)
  if (cached) return cached
  const response = await getCandidateFieldEvidence(id, record?.literatureId)
  evidenceCache.set(id, response)
  return response
}

function prefetchNextEvidence() {
  const next = props.nextRecord
  const id = candidateIdForRecord(next)
  if (!id || evidenceCache.has(id)) return
  void fetchEvidenceForRecord(next).catch(() => {})
}

async function loadEvidence() {
  if (!candidateId.value) return
  evidenceLoading.value = true
  evidenceError.value = ''
  try {
    evidence.value = await fetchEvidenceForRecord(props.record)
    void hydrateCardImages()
    prefetchNextEvidence()
  } catch (err: any) {
    evidenceError.value = String(err?.response?.data?.detail || err?.message || 'Evidence could not be loaded.')
  } finally {
    evidenceLoading.value = false
  }
}

async function loadFigurePreviews(literatureId: number) {
  if (figurePreviewsByLiterature.value[literatureId]) return figurePreviewsByLiterature.value[literatureId]
  const response = await getPdfFigurePreviews(literatureId)
  figurePreviewsByLiterature.value[literatureId] = response.items || []
  return figurePreviewsByLiterature.value[literatureId]
}

async function hydrateCardImages() {
  for (const card of reviewCards) {
    const best = cardBestEvidence(card)
    if (best) await hydrateEvidenceImage(best.entry)
  }
}

async function hydrateEvidenceImage(entry: FieldEvidenceEntry | null) {
  const record = props.record
  const key = evidenceMediaKey(entry)
  if (!record?.literatureId || !entry || !key || evidenceImageByKey.value[key] || evidenceImageLoading.value[key]) return

  const page = evidencePage(entry)
  const bbox = parseEvidenceBbox(entry.evidence?.bbox)
  const hasTextMatch = evidenceHasTextMatch(entry)
  // A value located in selectable PDF text is text-grounded — show a tight,
  // highlighted crop of that exact region, NOT the whole figure it may mention.
  // Only fall back to the composed figure preview for genuinely figure-sourced
  // values that have no text location to point at.
  if (!page && !bbox && !entryIsFigureSourced(entry)) return

  evidenceImageLoading.value[key] = true
  evidenceImageError.value[key] = null
  try {
    if (page && bbox) {
      const context = hasTextMatch ? 'normal' : 'wide'
      const response = await getPdfBboxPreview(record.literatureId, page, bbox, 'region', context)
      evidenceImageByKey.value[key] = `data:image/png;base64,${response.image_b64}`
      return
    }

    // No precise region: only figure-sourced values fall back to the figure preview.
    if (entryIsFigureSourced(entry) && !hasTextMatch) {
      const previews = await loadFigurePreviews(record.literatureId)
      const matched = previews.find((preview) => figurePreviewMatchesEvidence(preview, entry))
      if (matched?.image_b64) {
        evidenceImageByKey.value[key] = `data:image/png;base64,${matched.image_b64}`
        return
      }
    }
    evidenceImageByKey.value[key] = null
  } catch (err: any) {
    evidenceImageByKey.value[key] = null
    evidenceImageError.value[key] = String(err?.response?.data?.detail || err?.message || 'Source image could not be rendered.')
  } finally {
    evidenceImageLoading.value[key] = false
  }
}

function openImagePreview(src: string) {
  if (!src) return
  previewImageSrc.value = src
}

function isCardEditing(key: ReviewCardKey) {
  return editingCards.value.has(key)
}

function toggleCardEditing(key: ReviewCardKey) {
  const next = new Set(editingCards.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  editingCards.value = next
}

async function saveAndApprove() {
  if (!candidateId.value || saving.value) return
  const currentCandidateId = candidateId.value
  saving.value = true
  saveError.value = ''
  approvalError.value = ''
  try {
    if (dirtyGroups.value.cof) {
      await updateReviewCandidateCofExtracted(candidateId.value, buildCofPayload())
    }
    if (dirtyGroups.value.scalar) {
      const scalarCorrections = buildScalarCorrections()
      await updateReviewCandidateFields(candidateId.value, scalarCorrections)
    }
    if (dirtyGroups.value.load) {
      await updateReviewCandidateLoadConditions(candidateId.value, buildLoadPayload())
    }
    if (dirtyGroups.value.speed) {
      await updateReviewCandidateSpeedConditions(candidateId.value, buildSpeedPayload())
    }
    if (dirtyGroups.value.system) {
      await updateReviewCandidateTribologicalSystem(candidateId.value, buildSystemPayload())
    }
  } catch (err: any) {
    saveError.value = String(err?.response?.data?.detail || err?.message || 'Corrections could not be saved.')
    saving.value = false
    return
  }

  try {
    await approveReviewCandidate(candidateId.value)
    originalDraft.value = { ...draft.value }
    emit('saved-and-approved')
  } catch (err: any) {
    approvalError.value = String(err?.response?.data?.detail || err?.message || 'Candidate could not be approved.')
  } finally {
    if (candidateId.value === currentCandidateId) saving.value = false
  }
}

async function rejectCandidate() {
  if (!candidateId.value || saving.value || rejecting.value) return
  rejecting.value = true
  saveError.value = ''
  approvalError.value = ''
  try {
    await rejectReviewCandidate(candidateId.value, 'Rejected during review')
    emit('rejected')
  } catch (err: any) {
    approvalError.value = String(err?.response?.data?.detail || err?.message || 'Candidate could not be rejected.')
  } finally {
    rejecting.value = false
  }
}

async function runEvidenceAction(action: 'confirm' | 'flag' | 'unflag', fieldKey: string) {
  if (!candidateId.value || !fieldKey || evidenceActionPending.value) return
  evidenceActionPending.value = `${action}:${fieldKey}`
  evidenceActionError.value = ''
  try {
    const apiCall = action === 'confirm'
      ? confirmCandidateFieldEvidence
      : action === 'flag'
        ? flagCandidateFieldEvidence
        : unflagCandidateFieldEvidence
    const response = await apiCall(candidateId.value, fieldKey)
    evidence.value = response
    evidenceCache.set(candidateId.value, response)
    void hydrateCardImages()
  } catch (err: any) {
    evidenceActionError.value = String(err?.response?.data?.detail || err?.message || 'Evidence action could not be saved.')
  } finally {
    evidenceActionPending.value = ''
  }
}

function isEvidencePending(action: 'confirm' | 'flag' | 'unflag', fieldKey: string) {
  return evidenceActionPending.value === `${action}:${fieldKey}`
}

function handleReviewKeydown(event: KeyboardEvent) {
  if (!props.show || !props.record) return
  const target = event.target as HTMLElement | null
  const typing = Boolean(
    target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
  )
  if (event.key === 'Escape') {
    if (previewImageSrc.value) {
      previewImageSrc.value = ''
      return
    }
    emit('close')
    return
  }
  if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey)) || (event.altKey && event.key.toLowerCase() === 's')) {
    event.preventDefault()
    void saveAndApprove()
    return
  }
  if (event.key === 'ArrowRight' && !typing && props.hasNextCandidate) {
    event.preventDefault()
    emit('next-candidate')
  }
}

onMounted(() => window.addEventListener('keydown', handleReviewKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleReviewKeydown))

function buildCofPayload(): CofExtracted {
  const numeric = numberOrNull(draft.value.cofValue)
  return {
    rawText: draft.value.cofRaw || null,
    raw_text: draft.value.cofRaw || null,
    valueType: numeric == null ? 'conditional' : 'single',
    value_type: numeric == null ? 'conditional' : 'single',
    cofAverage: numeric,
    cof_average: numeric,
  }
}

function buildScalarCorrections(): Record<string, string | number | null> {
  return {
    material_name: draft.value.materialName || null,
    lubricant: draft.value.lubricant || null,
    probe_material: draft.value.probeMaterial || null,
    probe_geometry: draft.value.probeGeometry || null,
    probe_radius: draft.value.probeRadius || null,
    probe_roughness: draft.value.probeRoughness || null,
    substrate_material: draft.value.substrateMaterial || null,
    substrate_coating: draft.value.substrateCoating || null,
    substrate_roughness: draft.value.substrateRoughness || null,
    potential: draft.value.potential || null,
  }
}

function buildLoadPayload(): LoadConditions {
  const numeric = numberOrNull(draft.value.loadValue)
  return {
    rawText: draft.value.loadRaw || null,
    raw_text: draft.value.loadRaw || null,
    valueType: numeric == null ? 'unstated' : 'single',
    value_type: numeric == null ? 'unstated' : 'single',
    systemTotalLoadN: numeric,
    system_total_load_N: numeric,
  }
}

function buildSpeedPayload(): SpeedConditions {
  const numeric = numberOrNull(draft.value.speedValue)
  return {
    rawText: draft.value.speedRaw || null,
    raw_text: draft.value.speedRaw || null,
    valueType: numeric == null ? 'unknown' : 'linear',
    value_type: numeric == null ? 'unknown' : 'linear',
    slidingVelocityUmS: numeric,
    sliding_velocity_um_s: numeric,
  }
}

function buildSystemPayload(): TribologicalSystem {
  return {
    rawText: draft.value.tribologyRaw || null,
    raw_text: draft.value.tribologyRaw || null,
    contactGeometry: draft.value.contactGeometry || null,
    contact_geometry: draft.value.contactGeometry || null,
    scale: draft.value.scale || null,
    method: draft.value.method || null,
    instrument: draft.value.instrument || null,
    measurementType: draft.value.measurementType || null,
    measurement_type: draft.value.measurementType || null,
    frictionRegime: draft.value.frictionRegime || null,
    friction_regime: draft.value.frictionRegime || null,
  }
}

function numberOrNull(value: string) {
  const normalized = value.trim()
  if (!normalized) return null
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : null
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Render the evidence quote with the exact matched phrase highlighted, so the
// supporting words pop at a glance. HTML is escaped first to stay injection-safe.
function highlightQuote(quote: string, matchedText: string) {
  const escapedQuote = escapeHtml(quote)
  const needle = clean(matchedText)
  if (!needle) return escapedQuote
  const escapedNeedle = escapeHtml(needle)
  const index = escapedQuote.toLowerCase().indexOf(escapedNeedle.toLowerCase())
  if (index < 0) return escapedQuote
  const before = escapedQuote.slice(0, index)
  const hit = escapedQuote.slice(index, index + escapedNeedle.length)
  const after = escapedQuote.slice(index + escapedNeedle.length)
  return `${before}<mark class="rounded bg-[#cdf3ef] px-0.5 font-black text-[#0b6870]">${hit}</mark>${after}`
}

// Card value/derivation helpers ──────────────────────────────────────────────
function cardValueDisplay(card: ReviewCardDef) {
  if (card.key === 'ionic_liquid') return clean(draft.value.lubricant) || clean(lubricantDisplay(props.record as RecordResponse)) || '—'
  if (card.key === 'cof') return clean(draft.value.cofValue) || clean(draft.value.cofRaw) || '—'
  if (card.key === 'tribopair') {
    const probe = clean(draft.value.probeMaterial) || '—'
    const substrate = clean(draft.value.substrateMaterial) || '—'
    return `${probe} / ${substrate}`
  }
  return ''
}

function cardSubValues(card: ReviewCardDef) {
  if (card.key !== 'conditions') return []
  return [
    { label: 'Load', value: clean(draft.value.loadValue) || clean(draft.value.loadRaw) || '—' },
    { label: 'Speed', value: clean(draft.value.speedValue) || clean(draft.value.speedRaw) || '—' },
    { label: 'Potential', value: clean(draft.value.potential) || '—' },
  ]
}

function cardHasValue(card: ReviewCardDef) {
  if (card.key === 'ionic_liquid') return Boolean(clean(draft.value.lubricant) || clean(lubricantDisplay(props.record as RecordResponse)))
  if (card.key === 'cof') return Boolean(clean(draft.value.cofValue) || clean(draft.value.cofRaw))
  if (card.key === 'tribopair') return Boolean(clean(draft.value.probeMaterial) || clean(draft.value.substrateMaterial))
  return Boolean(
    clean(draft.value.loadValue) || clean(draft.value.loadRaw)
    || clean(draft.value.speedValue) || clean(draft.value.speedRaw)
    || clean(draft.value.potential),
  )
}

function evidenceFieldByKey(key: string) {
  return evidenceFields.find((field) => field.key === key) || null
}

function cardEvidenceEntries(card: ReviewCardDef) {
  const entries: { fieldKey: string, entry: FieldEvidenceEntry }[] = []
  for (const groupKey of card.evidenceGroups) {
    const field = evidenceFieldByKey(groupKey)
    if (!field) continue
    entries.push(...evidenceEntriesForField(field))
  }
  return entries
}

function cardBestEvidence(card: ReviewCardDef) {
  const entries = cardEvidenceEntries(card).filter(({ entry }) => evidenceEntryHasVisibleContent(entry))
  if (!entries.length) return null
  return [...entries].sort((left, right) =>
    evidenceEntryQualityScore(right.fieldKey, right.entry) - evidenceEntryQualityScore(left.fieldKey, left.entry),
  )[0] || null
}

function evidenceEntriesForField(field: EvidenceField) {
  return field.keys
    .map((fieldKey) => ({ fieldKey, entry: fieldMap.value[fieldKey] }))
    .filter((item): item is { fieldKey: string, entry: FieldEvidenceEntry } => Boolean(item.entry))
}

function evidenceEntryIsMissing(entry: FieldEvidenceEntry | null | undefined) {
  const state = clean(entry?.status || entry?.review_state || entry?.grounding_mode).toLowerCase()
  return state === 'missing'
}

function evidenceEntryHasVisibleContent(entry: FieldEvidenceEntry | null | undefined) {
  if (!entry || evidenceEntryIsMissing(entry)) return false
  const evidence = entry.evidence || {}
  return Boolean(
    evidenceQuote(entry)
    || evidencePage(entry) != null
    || parseEvidenceBbox(evidence.bbox)
    || entry.confidence != null
    || clean(evidence.source_label)
    || clean(evidence.source_type),
  )
}

function evidenceEntryQualityScore(fieldKey: string, entry: FieldEvidenceEntry) {
  const evidence = entry.evidence || {}
  let score = 0
  if (clean(evidence.quote)) score += 8
  if (clean(evidence.matchedText || evidence.matched_text)) score += 5
  if (typeof evidence.page === 'number' && Number.isFinite(evidence.page)) score += 2
  if (Array.isArray(evidence.bbox) && evidence.bbox.length >= 4) score += 2
  if (clean(entry.grounding_note || entry.review_note)) score += 2
  if (clean(entry.value)) score += 1
  if (fieldKey.includes('alias') || fieldKey === 'lubricant') score -= 1
  return score
}

function evidenceQuote(entry: FieldEvidenceEntry | null) {
  const evidence = entry?.evidence || {}
  return clean(evidence.context || evidence.quote || evidence.matchedText || evidence.matched_text || entry?.value)
}

function evidencePage(entry: FieldEvidenceEntry | null) {
  return entry?.evidence?.page ?? null
}

function evidenceConfidence(entry: FieldEvidenceEntry | null) {
  if (entry?.confidence == null) return ''
  return `${Math.round(Number(entry.confidence) * 100)}%`
}

function parseEvidenceBbox(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const values = raw.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    return values.length >= 4 ? values.slice(0, 4) : null
  }
  if (typeof raw === 'string') {
    try {
      return parseEvidenceBbox(JSON.parse(raw))
    } catch {
      const values = raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value))
      return values.length >= 4 ? values.slice(0, 4) : null
    }
  }
  return null
}

function evidenceMatchedText(entry: FieldEvidenceEntry | null) {
  const evidence = entry?.evidence || {}
  return clean(evidence.matchedText || evidence.matched_text)
}

function evidenceHasTextMatch(entry: FieldEvidenceEntry | null) {
  return Boolean(evidenceMatchedText(entry))
}

// Whether the value genuinely originates from a figure/table image. We rely on
// the explicit source_type only — a source_label that merely *mentions* a figure
// (e.g. a text sentence that cites "Fig. 2") must NOT be treated as figure-sourced,
// otherwise text-grounded values get rendered as a whole, unhelpful figure crop.
function entryIsFigureSourced(entry: FieldEvidenceEntry | null) {
  const sourceType = clean(entry?.evidence?.source_type).toLowerCase()
  return ['figure', 'visual', 'image', 'table'].includes(sourceType)
}

function evidenceMediaKey(entry: FieldEvidenceEntry | null) {
  const page = evidencePage(entry)
  const bbox = parseEvidenceBbox(entry?.evidence?.bbox)
  const label = clean(entry?.evidence?.source_label)
  if (!page && !bbox && !label) return ''
  return [
    props.record?.literatureId || 'no-lit',
    page || 'no-page',
    normalizeFigureLabel(label) || 'no-label',
    bbox ? bbox.map((value) => Number(value).toFixed(1)).join(',') : 'no-bbox',
  ].join(':')
}

function normalizeFigureLabel(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^(?:fig(?:ure)?|table)/, '')
    .replace(/[^a-z0-9]+/g, '')
}

function extractFigureLabelsFromEvidenceText(value: unknown) {
  const text = clean(value)
  if (!text) return []
  return Array.from(text.matchAll(/\b(?:fig(?:ure)?|table)\.?\s*[a-z]?\d+[a-z]?\b/gi))
    .map((match) => match[0])
}

function evidenceFigureLabelCandidates(entry: FieldEvidenceEntry) {
  const candidates = new Set<string>()
  const sourceLabel = normalizeFigureLabel(entry.evidence?.source_label)
  if (sourceLabel) candidates.add(sourceLabel)
  const textValues = [
    entry.evidence?.quote,
    entry.evidence?.matched_text,
    entry.evidence?.matchedText,
    entry.evidence?.context,
    entry.value,
  ]
  textValues
    .flatMap((value) => extractFigureLabelsFromEvidenceText(value))
    .map((value) => normalizeFigureLabel(value))
    .filter(Boolean)
    .forEach((value) => candidates.add(value))
  return [...candidates]
}

function figurePreviewMatchesEvidence(preview: PdfFigurePreview, entry: FieldEvidenceEntry) {
  const page = evidencePage(entry)
  if (page && preview.page !== page) return false
  const evidenceLabels = evidenceFigureLabelCandidates(entry)
  const previewLabel = normalizeFigureLabel(preview.label)
  if (!evidenceLabels.length || !previewLabel) return false
  return evidenceLabels.some((evidenceLabel) =>
    evidenceLabel === previewLabel
    || evidenceLabel.startsWith(previewLabel)
    || previewLabel.startsWith(evidenceLabel),
  )
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show && record" class="fixed inset-0 z-[80] flex justify-end bg-slate-950/20 backdrop-blur-[2px]">
      <button
        type="button"
        class="absolute inset-0 cursor-default"
        aria-label="Close candidate review sheet"
        @click="emit('close')"
      />

      <aside class="relative flex h-full w-full max-w-[680px] flex-col border-l border-slate-200 bg-white shadow-[0_20px_64px_-30px_rgba(15,23,42,0.62)]">
        <header class="shrink-0 border-b border-slate-100 bg-white px-4 py-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#0f7c82]">Candidate Review</p>
              <h2 class="mt-1 truncate text-[1.05rem] font-semibold leading-tight text-slate-950">
                {{ lubricantDisplay(record) || recordDisplayId(record) }}
              </h2>
              <p class="mt-0.5 truncate text-xs font-medium text-slate-500">
                {{ record.literature?.title || `Literature ${record.literatureId || '--'}` }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold" :class="readinessTone">
                {{ readinessLabel }}
              </span>
              <button
                v-if="hasNextCandidate"
                type="button"
                class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-[#8fe5e7] hover:text-[#0f7c82]"
                @click="emit('next-candidate')"
              >
                Next candidate
                <ArrowRight class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-[8px] border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close review sheet"
                @click="emit('close')"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div
            v-if="localBlockers.length"
            class="mt-2 flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
          >
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span><span class="font-black">Needs your attention:</span> {{ localBlockers.join(' · ') }}</span>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto bg-[#fbfdfd] px-4 py-3">
          <div v-if="evidenceLoading" class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-500">
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading evidence...
          </div>
          <div v-else-if="evidenceError" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-700">
            {{ evidenceError }}
          </div>

          <template v-else>
            <div class="grid gap-2">
              <section
                v-for="card in cardModels"
                :key="card.key"
                data-testid="review-evidence-card"
                class="rounded-[9px] border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)] transition"
                :class="card.status === 'flagged'
                  ? 'border-rose-200'
                  : card.status === 'check'
                    ? 'border-amber-200'
                    : 'border-slate-200'"
                :data-card="card.key"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-2">
                    <h3 class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{{ card.label }}</h3>
                    <span
                      class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
                      :class="card.status === 'confirmed'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : card.status === 'grounded'
                          ? 'border-teal-200 bg-teal-50 text-[#0f7c82]'
                          : card.status === 'flagged'
                            ? 'border-rose-200 bg-rose-50 text-rose-600'
                            : 'border-amber-200 bg-amber-50 text-amber-700'"
                    >
                      <Check v-if="card.status === 'confirmed' || card.status === 'grounded'" class="h-3 w-3 stroke-[3]" />
                      <Flag v-else-if="card.status === 'flagged'" class="h-3 w-3" />
                      <AlertTriangle v-else class="h-3 w-3" />
                      {{ card.status === 'confirmed' ? 'Confirmed' : card.status === 'grounded' ? 'Grounded' : card.status === 'flagged' ? 'Flagged' : 'Check' }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border px-2.5 text-xs font-semibold transition"
                    :class="isCardEditing(card.key)
                      ? 'border-[#8fe5e7] bg-[#eefafa] text-[#0f7c82]'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-[#8fe5e7] hover:text-[#0f7c82]'"
                    @click="toggleCardEditing(card.key)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                    {{ isCardEditing(card.key) ? 'Done' : 'Edit' }}
                  </button>
                </div>

                <!-- Read view -->
                <div v-if="!isCardEditing(card.key)" class="mt-2">
                  <p v-if="card.value" class="truncate text-[1.05rem] font-semibold text-slate-950">{{ card.value }}</p>
                  <div v-if="card.subValues.length" class="flex flex-wrap gap-x-4 gap-y-1">
                    <span v-for="sv in card.subValues" :key="sv.label" class="text-sm font-semibold text-slate-800">
                      <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{{ sv.label }}</span>
                      <span class="ml-1.5">{{ sv.value }}</span>
                    </span>
                  </div>
                </div>

                <!-- Edit view -->
                <div v-else class="mt-3 grid gap-2" :class="card.key === 'ionic_liquid' ? '' : 'md:grid-cols-2'">
                  <template v-if="card.key === 'ionic_liquid'">
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Ionic liquid
                      <input v-model="draft.lubricant" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="[BMIM][BF4]">
                    </label>
                  </template>
                  <template v-else-if="card.key === 'cof'">
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      COF value
                      <input v-model="draft.cofValue" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="0.08">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      COF raw
                      <input v-model="draft.cofRaw" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="e.g. 0.08">
                    </label>
                  </template>
                  <template v-else-if="card.key === 'tribopair'">
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Probe material
                      <input v-model="draft.probeMaterial" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="Si3N4 tip">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Substrate material
                      <input v-model="draft.substrateMaterial" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="mica">
                    </label>
                  </template>
                  <template v-else>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Load value (N)
                      <input v-model="draft.loadValue" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="numeric">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Load raw
                      <input v-model="draft.loadRaw" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="e.g. 2 nN">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Speed value (um/s)
                      <input v-model="draft.speedValue" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="numeric">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                      Speed raw
                      <input v-model="draft.speedRaw" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="e.g. 10 um/s">
                    </label>
                    <label class="grid gap-1.5 text-sm font-bold text-slate-700 md:col-span-2">
                      Potential
                      <input v-model="draft.potential" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="+0.5 V">
                    </label>
                  </template>
                </div>

                <!-- Evidence inline -->
                <div v-if="card.hasEvidence" class="mt-2 rounded-[8px] border border-slate-100 bg-[#f6fbfc] p-2.5">
                  <button
                    v-if="card.imageSrc"
                    type="button"
                    class="group relative mb-2 block w-full cursor-pointer overflow-hidden rounded-md border border-emerald-100 bg-white outline-none transition hover:border-emerald-200 focus-visible:ring-4 focus-visible:ring-[#d8fbfb]"
                    aria-label="Open source image preview"
                    @click="openImagePreview(card.imageSrc)"
                  >
                    <img :src="card.imageSrc" :alt="`Evidence for ${card.label}`" class="max-h-36 w-full object-contain">
                    <span class="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-slate-950/70 text-white opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Maximize2 class="h-3.5 w-3.5" />
                    </span>
                  </button>
                  <div
                    v-else-if="card.imageLoading"
                    class="mb-2 rounded-md border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-[11px] font-bold text-slate-400"
                  >
                    Rendering source image...
                  </div>
                  <blockquote
                    v-if="card.quote"
                    class="rounded-md border-l-[3px] border-[#0f7c82] bg-white px-3 py-2 text-sm font-medium leading-6 text-slate-700"
                    v-html="highlightQuote(card.quote, card.matchedText)"
                  />
                  <p v-if="card.note" class="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                    {{ card.note }}
                  </p>
                  <div class="mt-2 flex items-center justify-between gap-2">
                    <span class="text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
                      <template v-if="card.page != null">p.{{ card.page }}</template>
                      <template v-if="card.confidence"> · {{ card.confidence }}</template>
                    </span>
                    <div class="flex items-center gap-1.5">
                      <button
                        type="button"
                        class="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55"
                        :class="card.isConfirmed
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'"
                        :disabled="Boolean(evidenceActionPending) || card.isConfirmed"
                        @click="runEvidenceAction('confirm', card.actionKey)"
                      >
                        <Loader2 v-if="isEvidencePending('confirm', card.actionKey)" class="h-3 w-3 animate-spin" />
                        <Check v-else class="h-3 w-3 stroke-[3]" />
                        {{ card.isConfirmed ? 'Confirmed' : 'Confirm' }}
                      </button>
                      <button
                        v-if="!card.isFlagged"
                        type="button"
                        class="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-55"
                        :disabled="Boolean(evidenceActionPending)"
                        @click="runEvidenceAction('flag', card.actionKey)"
                      >
                        <Loader2 v-if="isEvidencePending('flag', card.actionKey)" class="h-3 w-3 animate-spin" />
                        <Flag v-else class="h-3 w-3" />
                        Flag
                      </button>
                      <button
                        v-else
                        type="button"
                        class="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
                        :disabled="Boolean(evidenceActionPending)"
                        @click="runEvidenceAction('unflag', card.actionKey)"
                      >
                        <Loader2 v-if="isEvidencePending('unflag', card.actionKey)" class="h-3 w-3 animate-spin" />
                        <FlagOff v-else class="h-3 w-3" />
                        Clear flag
                      </button>
                    </div>
                  </div>
                </div>
                <p v-else class="mt-3 text-xs font-semibold text-slate-400">
                  No stored evidence for this field — verify manually before approving.
                </p>
              </section>
            </div>

            <!-- Advanced details -->
            <section class="mt-3 overflow-hidden rounded-[9px] border border-slate-200 bg-white">
              <button
                type="button"
                class="flex w-full items-center justify-between px-4 py-3 text-left"
                :aria-expanded="advancedOpen"
                @click="advancedOpen = !advancedOpen"
              >
                <span class="text-sm font-semibold text-slate-700">Advanced details</span>
                <ChevronDown class="h-4 w-4 text-slate-400 transition" :class="advancedOpen ? 'rotate-180' : ''" />
              </button>
              <div v-if="advancedOpen" class="grid gap-3 border-t border-slate-100 px-4 py-4 md:grid-cols-2">
                <label class="grid gap-1.5 text-sm font-bold text-slate-700 md:col-span-2">
                  Lubrication raw text
                  <input v-model="draft.tribologyRaw" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="raw method or system description">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Contact geometry
                  <input v-model="draft.contactGeometry" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="AFM tip, ball-on-disk...">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Scale
                  <input v-model="draft.scale" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="nanoscale / macroscale">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Method
                  <input v-model="draft.method" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="AFM, SFA, tribometer...">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Instrument
                  <input v-model="draft.instrument" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="instrument">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Regime
                  <input v-model="draft.frictionRegime" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="boundary, EHL...">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Probe geometry
                  <input v-model="draft.probeGeometry" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="AFM tip, ball...">
                </label>
                <label class="grid gap-1.5 text-sm font-bold text-slate-700">
                  Substrate coating
                  <input v-model="draft.substrateCoating" class="h-10 rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-[#7ddfe3] focus:ring-4 focus:ring-[#e0fbfb]" placeholder="oxide, coating, none">
                </label>
              </div>
            </section>
          </template>
        </div>

        <footer class="shrink-0 border-t border-slate-100 bg-white px-4 py-3">
          <p v-if="saveError" class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
            {{ saveError }}
          </p>
          <p v-if="approvalError" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
            {{ approvalError }}
          </p>
          <p v-if="evidenceActionError" class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
            {{ evidenceActionError }}
          </p>
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-semibold text-slate-500">
              Shortcuts: <kbd class="rounded bg-slate-100 px-1 font-bold">Alt+S</kbd> approve ·
              <kbd class="rounded bg-slate-100 px-1 font-bold">→</kbd> next ·
              <kbd class="rounded bg-slate-100 px-1 font-bold">Esc</kbd> close
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="saving || rejecting"
                @click="rejectCandidate"
              >
                <Loader2 v-if="rejecting" class="h-4 w-4 animate-spin" />
                <Ban v-else class="h-4 w-4 stroke-[3]" />
                Reject
              </button>
              <button
                type="button"
                class="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#0f7c82] px-3 text-sm font-semibold text-white transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="saving || rejecting"
                @click="saveAndApprove"
              >
                <Loader2 v-if="saving" class="h-4 w-4 animate-spin" />
                <Check v-else class="h-4 w-4 stroke-[3]" />
                Approve
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </div>

    <div
      v-if="previewImageSrc"
      class="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-slate-950/85 px-4 py-6 backdrop-blur-sm"
      @click="previewImageSrc = ''"
    >
      <section
        class="max-h-full max-w-[min(1180px,96vw)] cursor-default overflow-hidden rounded-lg border border-white/10 bg-white shadow-[0_32px_120px_-28px_rgba(0,0,0,0.8)]"
        role="dialog"
        aria-modal="true"
        aria-label="Source image preview"
        @click.stop
      >
        <header class="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <h3 class="text-sm font-black uppercase tracking-[0.16em] text-slate-600">Source image preview</h3>
          <button
            type="button"
            class="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
            aria-label="Close source image preview"
            @click="previewImageSrc = ''"
          >
            <X class="h-4 w-4" />
          </button>
        </header>
        <div class="grid max-h-[calc(100vh-7rem)] place-items-center overflow-auto bg-slate-50 p-4">
          <img
            :src="previewImageSrc"
            alt="Enlarged candidate evidence image"
            class="max-h-[calc(100vh-9rem)] max-w-full object-contain"
          >
        </div>
      </section>
    </div>
  </Teleport>
</template>
