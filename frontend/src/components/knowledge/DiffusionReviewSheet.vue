<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, ArrowRight, Ban, Check, Flag, FlagOff, Loader2, Maximize2, X } from 'lucide-vue-next'

import {
  approveDiffusionReviewCandidate,
  rejectDiffusionReviewCandidate,
  confirmDiffusionCandidateFieldEvidence,
  flagDiffusionCandidateFieldEvidence,
  unflagDiffusionCandidateFieldEvidence,
  getDiffusionCandidateFieldEvidence,
  getPdfBboxPreview,
  getPdfFigurePreviews,
  type DiffusionLibraryRecord,
  type FieldEvidenceEntry,
  type PdfFigurePreview,
  type RecordFieldEvidenceResponse,
} from '@/lib/api'

const props = defineProps<{
  show: boolean
  record: DiffusionLibraryRecord | null
  nextRecord?: DiffusionLibraryRecord | null
  hasNextCandidate?: boolean
}>()

const emit = defineEmits<{
  close: []
  'next-candidate': []
  approved: []
  rejected: []
}>()

type EvidenceField = { key: string, label: string, keys: string[] }

// Evidence-first verify cards adapted for diffusion facts.
type DiffusionCardKey = 'ionic_liquid' | 'diffusion_coefficient' | 'system' | 'conditions'
type DiffusionCardDef = { key: DiffusionCardKey, label: string, evidenceKeys: string[] }
const diffusionCards: DiffusionCardDef[] = [
  { key: 'ionic_liquid', label: 'Ionic liquid', evidenceKeys: ['ionic_liquid', 'lubricant', 'cation', 'anion', 'diffusing_ion'] },
  { key: 'diffusion_coefficient', label: 'Diffusion coefficient', evidenceKeys: ['diffusion_coefficient', 'd_total', 'd_cation', 'd_anion', 'd_unit'] },
  { key: 'system', label: 'Confinement system', evidenceKeys: ['system_name', 'confinement_material_class', 'confinement_geometry_class', 'confinement_dimensionality', 'confinement_scale_value', 'confinement_scale_unit'] },
  { key: 'conditions', label: 'Conditions', evidenceKeys: ['temperature', 'temperature_value'] },
]

const evidence = ref<RecordFieldEvidenceResponse | null>(null)
const evidenceLoading = ref(false)
const evidenceError = ref('')
const approvalError = ref('')
const approving = ref(false)
const rejecting = ref(false)
const evidenceActionPending = ref('')
const evidenceActionError = ref('')
const previewImageSrc = ref('')
const evidenceCache = new Map<number, RecordFieldEvidenceResponse>()
const figurePreviewsByLiterature = ref<Record<number, PdfFigurePreview[]>>({})
const evidenceImageByKey = ref<Record<string, string | null>>({})
const evidenceImageLoading = ref<Record<string, boolean>>({})
const evidenceImageError = ref<Record<string, string | null>>({})

function candidateIdForRecord(record: DiffusionLibraryRecord | null | undefined) {
  if (!record) return null
  const direct = Number(record.id)
  if (Number.isFinite(direct) && direct > 0) return direct
  const fromLibrary = Number(String(record.libraryId || record.library_id || '').split(':').pop())
  return Number.isFinite(fromLibrary) && fromLibrary > 0 ? fromLibrary : null
}

const candidateId = computed(() => candidateIdForRecord(props.record))
const literatureId = computed(() => {
  const record = props.record as any
  const value = Number(record?.literatureId ?? record?.literature_id ?? record?.literature?.id)
  return Number.isFinite(value) && value > 0 ? value : null
})

const fieldMap = computed<Record<string, FieldEvidenceEntry | undefined>>(() => evidence.value?.fields || {})

type DiffusionCardModel = {
  key: DiffusionCardKey
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

const cardModels = computed<DiffusionCardModel[]>(() => diffusionCards.map((card) => {
  const entries = cardEvidenceEntries(card)
  const best = cardBestEvidence(card)
  const bestEntry = best?.entry || null
  const flagged = entries.some(({ entry }) => clean(entry?.review_state).toLowerCase() === 'flagged')
  const reviewState = clean(bestEntry?.review_state).toLowerCase()
  const hasValue = cardHasValue(card)
  const hasEvidence = Boolean(bestEntry && evidenceEntryHasVisibleContent(bestEntry))

  let status: DiffusionCardModel['status']
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
    actionKey: best?.fieldKey || card.evidenceKeys[0] || card.key,
    isFlagged: reviewState === 'flagged',
    isConfirmed: reviewState === 'confirmed',
  }
}))

const localBlockers = computed(() => {
  const record = props.record
  if (!record) return ['No candidate selected']
  const blockers: string[] = []
  const requiredCards: Array<{ key: DiffusionCardKey, message: string }> = [
    { key: 'ionic_liquid', message: 'Missing ionic liquid' },
    { key: 'diffusion_coefficient', message: 'Missing diffusion coefficient' },
    { key: 'system', message: 'Missing confinement system' },
  ]
  for (const required of requiredCards) {
    const card = diffusionCards.find((item) => item.key === required.key)
    if (card && !cardHasValue(card)) blockers.push(required.message)
  }
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

watch(
  () => [props.show, props.record?.id, (props.record as any)?.libraryId],
  () => {
    if (!props.show || !props.record) return
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

async function fetchEvidenceForRecord(record: DiffusionLibraryRecord | null | undefined) {
  const id = candidateIdForRecord(record)
  if (!id) return null
  const cached = evidenceCache.get(id)
  if (cached) return cached
  const response = await getDiffusionCandidateFieldEvidence(id)
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
  approvalError.value = ''
  evidenceActionError.value = ''
  previewImageSrc.value = ''
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

async function loadFigurePreviews(litId: number) {
  if (figurePreviewsByLiterature.value[litId]) return figurePreviewsByLiterature.value[litId]
  const response = await getPdfFigurePreviews(litId)
  figurePreviewsByLiterature.value[litId] = response.items || []
  return figurePreviewsByLiterature.value[litId]
}

async function hydrateCardImages() {
  for (const card of diffusionCards) {
    const best = cardBestEvidence(card)
    if (best) await hydrateEvidenceImage(best.entry)
  }
}

async function hydrateEvidenceImage(entry: FieldEvidenceEntry | null) {
  const litId = literatureId.value
  const key = evidenceMediaKey(entry)
  if (!litId || !entry || !key || evidenceImageByKey.value[key] || evidenceImageLoading.value[key]) return
  const page = evidencePage(entry)
  const bbox = parseEvidenceBbox(entry.evidence?.bbox)
  const hasTextMatch = evidenceHasTextMatch(entry)
  if (!page && !bbox && !entryIsFigureSourced(entry)) return

  evidenceImageLoading.value[key] = true
  evidenceImageError.value[key] = null
  try {
    // Text-grounded values get a tight highlighted crop, not the whole figure.
    if (page && bbox) {
      const context = hasTextMatch ? 'normal' : 'wide'
      const response = await getPdfBboxPreview(litId, page, bbox, 'region', context)
      evidenceImageByKey.value[key] = `data:image/png;base64,${response.image_b64}`
      return
    }
    if (entryIsFigureSourced(entry) && !hasTextMatch) {
      const previews = await loadFigurePreviews(litId)
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

async function approveCandidate() {
  if (!candidateId.value || approving.value || rejecting.value) return
  approving.value = true
  approvalError.value = ''
  try {
    await approveDiffusionReviewCandidate(candidateId.value)
    emit('approved')
  } catch (err: any) {
    approvalError.value = String(err?.response?.data?.detail || err?.message || 'Candidate could not be approved.')
  } finally {
    approving.value = false
  }
}

async function rejectCandidate() {
  if (!candidateId.value || approving.value || rejecting.value) return
  rejecting.value = true
  approvalError.value = ''
  try {
    await rejectDiffusionReviewCandidate(candidateId.value, 'Rejected during review')
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
      ? confirmDiffusionCandidateFieldEvidence
      : action === 'flag'
        ? flagDiffusionCandidateFieldEvidence
        : unflagDiffusionCandidateFieldEvidence
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
  const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
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
    void approveCandidate()
    return
  }
  if (event.key === 'ArrowRight' && !typing && props.hasNextCandidate) {
    event.preventDefault()
    emit('next-candidate')
  }
}

onMounted(() => window.addEventListener('keydown', handleReviewKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleReviewKeydown))

// Value/derivation helpers ────────────────────────────────────────────────────
function clean(value: unknown) {
  return String(value ?? '').trim()
}

function readField(key: string) {
  return clean((props.record as any)?.[key])
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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

function diffusionUnit() {
  return readField('d_unit') || readField('dUnit') || '×10⁻¹² m²/s'
}

function cardValueDisplay(card: DiffusionCardDef) {
  if (card.key === 'ionic_liquid') return readField('ionic_liquid') || readField('lubricant') || '—'
  if (card.key === 'diffusion_coefficient') {
    const total = readField('d_total')
    if (total) return `${total} ${diffusionUnit()}`
    const cation = readField('d_cation')
    const anion = readField('d_anion')
    if (cation || anion) return `${cation || '—'} / ${anion || '—'} ${diffusionUnit()}`
    return '—'
  }
  if (card.key === 'system') {
    return readField('system_name') || readField('confinement_material_class') || '—'
  }
  return ''
}

function cardSubValues(card: DiffusionCardDef) {
  if (card.key === 'diffusion_coefficient') {
    const items = [
      { label: 'D total', value: readField('d_total') },
      { label: 'D cation', value: readField('d_cation') },
      { label: 'D anion', value: readField('d_anion') },
    ].filter((item) => item.value)
    return items.length ? items : []
  }
  if (card.key === 'system') {
    return [
      { label: 'Material', value: readField('confinement_material_class') },
      { label: 'Geometry', value: readField('confinement_geometry_class') },
      { label: 'Scale', value: [readField('confinement_scale_value'), readField('confinement_scale_unit')].filter(Boolean).join(' ') },
    ].filter((item) => item.value)
  }
  if (card.key === 'conditions') {
    const temp = readField('temperature_value') || readField('temperature')
    return temp ? [{ label: 'Temperature', value: `${temp} K` }] : []
  }
  return []
}

function cardHasValue(card: DiffusionCardDef) {
  if (card.key === 'ionic_liquid') return Boolean(readField('ionic_liquid') || readField('lubricant'))
  if (card.key === 'diffusion_coefficient') return Boolean(readField('d_total') || readField('d_cation') || readField('d_anion'))
  if (card.key === 'system') return Boolean(readField('system_name') || readField('confinement_material_class'))
  return Boolean(readField('temperature_value') || readField('temperature'))
}

function evidenceFieldFor(card: DiffusionCardDef): EvidenceField {
  return { key: card.key, label: card.label, keys: card.evidenceKeys }
}

function cardEvidenceEntries(card: DiffusionCardDef) {
  return evidenceEntriesForField(evidenceFieldFor(card))
}

function cardBestEvidence(card: DiffusionCardDef) {
  const entries = cardEvidenceEntries(card).filter(({ entry }) => evidenceEntryHasVisibleContent(entry))
  if (!entries.length) return null
  return [...entries].sort((left, right) =>
    evidenceEntryQualityScore(right.fieldKey, right.entry) - evidenceEntryQualityScore(left.fieldKey, left.entry),
  )[0] || null
}

// Evidence helpers (shared shape with the tribology review sheet) ──────────────
function evidenceEntriesForField(field: EvidenceField) {
  return field.keys
    .map((fieldKey) => ({ fieldKey, entry: fieldMap.value[fieldKey] }))
    .filter((item): item is { fieldKey: string, entry: FieldEvidenceEntry } => Boolean(item.entry))
}

function evidenceMatchedText(entry: FieldEvidenceEntry | null) {
  const ev = entry?.evidence || {}
  return clean(ev.matchedText || ev.matched_text)
}

function evidenceHasTextMatch(entry: FieldEvidenceEntry | null) {
  return Boolean(evidenceMatchedText(entry))
}

function entryIsFigureSourced(entry: FieldEvidenceEntry | null) {
  const sourceType = clean(entry?.evidence?.source_type).toLowerCase()
  return ['figure', 'visual', 'image', 'table'].includes(sourceType)
}

function evidenceEntryIsMissing(entry: FieldEvidenceEntry | null | undefined) {
  const state = clean(entry?.status || entry?.review_state || entry?.grounding_mode).toLowerCase()
  return state === 'missing'
}

function evidenceEntryHasVisibleContent(entry: FieldEvidenceEntry | null | undefined) {
  if (!entry || evidenceEntryIsMissing(entry)) return false
  const ev = entry.evidence || {}
  return Boolean(
    evidenceQuote(entry)
    || evidencePage(entry) != null
    || parseEvidenceBbox(ev.bbox)
    || entry.confidence != null
    || clean(ev.source_label)
    || clean(ev.source_type),
  )
}

function evidenceEntryQualityScore(fieldKey: string, entry: FieldEvidenceEntry) {
  const ev = entry.evidence || {}
  let score = 0
  if (clean(ev.quote)) score += 8
  if (clean(ev.matchedText || ev.matched_text)) score += 5
  if (typeof ev.page === 'number' && Number.isFinite(ev.page)) score += 2
  if (Array.isArray(ev.bbox) && ev.bbox.length >= 4) score += 2
  if (clean(entry.grounding_note || entry.review_note)) score += 2
  if (clean(entry.value)) score += 1
  if (fieldKey === 'd_unit') score -= 2
  return score
}

function evidenceQuote(entry: FieldEvidenceEntry | null) {
  const ev = entry?.evidence || {}
  return clean(ev.context || ev.quote || ev.matchedText || ev.matched_text || entry?.value)
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

function evidenceMediaKey(entry: FieldEvidenceEntry | null) {
  const page = evidencePage(entry)
  const bbox = parseEvidenceBbox(entry?.evidence?.bbox)
  const label = clean(entry?.evidence?.source_label)
  if (!page && !bbox && !label) return ''
  return [
    literatureId.value || 'no-lit',
    page || 'no-page',
    normalizeFigureLabel(label) || 'no-label',
    bbox ? bbox.map((value) => Number(value).toFixed(1)).join(',') : 'no-bbox',
  ].join(':')
}

function normalizeFigureLabel(value: unknown) {
  return clean(value).toLowerCase().replace(/^(?:fig(?:ure)?|table)/, '').replace(/[^a-z0-9]+/g, '')
}

function extractFigureLabelsFromEvidenceText(value: unknown) {
  const text = clean(value)
  if (!text) return []
  return Array.from(text.matchAll(/\b(?:fig(?:ure)?|table)\.?\s*[a-z]?\d+[a-z]?\b/gi)).map((match) => match[0])
}

function evidenceFigureLabelCandidates(entry: FieldEvidenceEntry) {
  const candidates = new Set<string>()
  const sourceLabel = normalizeFigureLabel(entry.evidence?.source_label)
  if (sourceLabel) candidates.add(sourceLabel)
  ;[entry.evidence?.quote, entry.evidence?.matched_text, entry.evidence?.matchedText, entry.evidence?.context, entry.value]
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
    evidenceLabel === previewLabel || evidenceLabel.startsWith(previewLabel) || previewLabel.startsWith(evidenceLabel),
  )
}

function diffusionTitle() {
  return readField('ionic_liquid') || readField('system_name') || `Candidate ${candidateId.value || '--'}`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show && record" class="fixed inset-0 z-[80] flex justify-end bg-slate-950/20 backdrop-blur-[2px]">
      <button type="button" class="absolute inset-0 cursor-default" aria-label="Close diffusion review sheet" @click="emit('close')" />

      <aside class="relative flex h-full w-full max-w-[760px] flex-col border-l border-slate-200 bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.7)]">
        <header class="shrink-0 border-b border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbfc_100%)] px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-[11px] font-black uppercase tracking-[0.22em] text-[#0f7c82]">Diffusion Review</p>
              <h2 class="mt-1 truncate text-2xl font-black leading-tight text-slate-950">{{ diffusionTitle() }}</h2>
              <p class="mt-1 truncate text-sm font-semibold text-slate-500">
                {{ (record as any).literature?.title || (record as any).literatureTitle || `Literature ${literatureId || '--'}` }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span class="inline-flex h-8 items-center rounded-full border px-3 text-xs font-black" :class="readinessTone">{{ readinessLabel }}</span>
              <button
                v-if="hasNextCandidate"
                type="button"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-[#8fe5e7] hover:text-[#0f7c82]"
                @click="emit('next-candidate')"
              >
                Next candidate
                <ArrowRight class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close review sheet"
                @click="emit('close')"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div v-if="localBlockers.length" class="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span><span class="font-black">Needs your attention:</span> {{ localBlockers.join(' · ') }}</span>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto bg-[#fbfdfd] px-5 py-4">
          <div v-if="evidenceLoading" class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-500">
            <Loader2 class="h-4 w-4 animate-spin" />
            Loading evidence...
          </div>
          <div v-else-if="evidenceError" class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-700">
            {{ evidenceError }}
          </div>

          <div v-else class="grid gap-3">
            <section
              v-for="card in cardModels"
              :key="card.key"
              class="rounded-xl border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              :class="card.status === 'flagged' ? 'border-rose-200' : card.status === 'check' ? 'border-amber-200' : 'border-slate-200'"
              :data-card="card.key"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2">
                  <h3 class="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{{ card.label }}</h3>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]"
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
              </div>

              <div class="mt-2">
                <p v-if="card.value" class="truncate text-xl font-black text-slate-950">{{ card.value }}</p>
                <div v-if="card.subValues.length" class="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                  <span v-for="sv in card.subValues" :key="sv.label" class="text-sm font-bold text-slate-800">
                    <span class="text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">{{ sv.label }}</span>
                    <span class="ml-1.5">{{ sv.value }}</span>
                  </span>
                </div>
              </div>

              <div v-if="card.hasEvidence" class="mt-3 rounded-lg border border-slate-100 bg-[#f6fbfc] p-3">
                <button
                  v-if="card.imageSrc"
                  type="button"
                  class="group relative mb-2 block w-full cursor-zoom-in overflow-hidden rounded-md border border-emerald-100 bg-white outline-none transition hover:border-emerald-200 focus-visible:ring-4 focus-visible:ring-[#d8fbfb]"
                  aria-label="Open source image preview"
                  @click="openImagePreview(card.imageSrc)"
                >
                  <img :src="card.imageSrc" :alt="`Evidence for ${card.label}`" class="max-h-56 w-full object-contain">
                  <span class="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Maximize2 class="h-3.5 w-3.5" />
                  </span>
                </button>
                <div v-else-if="card.imageLoading" class="mb-2 rounded-md border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-[11px] font-bold text-slate-400">
                  Rendering source image...
                </div>
                <blockquote
                  v-if="card.quote"
                  class="rounded-md border-l-[3px] border-[#0f7c82] bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700"
                  v-html="highlightQuote(card.quote, card.matchedText)"
                />
                <p v-if="card.note" class="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">{{ card.note }}</p>
                <div class="mt-2 flex items-center justify-between gap-2">
                  <span class="text-[11px] font-black uppercase tracking-[0.1em] text-slate-400">
                    <template v-if="card.page != null">p.{{ card.page }}</template>
                    <template v-if="card.confidence"> · {{ card.confidence }}</template>
                  </span>
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      class="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-55"
                      :class="card.isConfirmed ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'"
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
                      class="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-black text-slate-600 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-55"
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
                      class="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-black text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
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
        </div>

        <footer class="shrink-0 border-t border-slate-100 bg-white px-5 py-4">
          <p v-if="approvalError" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{{ approvalError }}</p>
          <p v-if="evidenceActionError" class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{{ evidenceActionError }}</p>
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-semibold text-slate-500">
              Shortcuts: <kbd class="rounded bg-slate-100 px-1 font-bold">Alt+S</kbd> approve ·
              <kbd class="rounded bg-slate-100 px-1 font-bold">→</kbd> next ·
              <kbd class="rounded bg-slate-100 px-1 font-bold">Esc</kbd> close
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="approving || rejecting"
                @click="rejectCandidate"
              >
                <Loader2 v-if="rejecting" class="h-4 w-4 animate-spin" />
                <Ban v-else class="h-4 w-4 stroke-[3]" />
                Reject
              </button>
              <button
                type="button"
                class="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0f7c82] px-4 text-sm font-black text-white transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
                :disabled="approving || rejecting"
                @click="approveCandidate"
              >
                <Loader2 v-if="approving" class="h-4 w-4 animate-spin" />
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
      <section class="max-h-full max-w-[min(1180px,96vw)] cursor-default overflow-hidden rounded-lg border border-white/10 bg-white shadow-[0_32px_120px_-28px_rgba(0,0,0,0.8)]" role="dialog" aria-modal="true" aria-label="Source image preview" @click.stop>
        <header class="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <h3 class="text-sm font-black uppercase tracking-[0.16em] text-slate-600">Source image preview</h3>
          <button type="button" class="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-950" aria-label="Close source image preview" @click="previewImageSrc = ''">
            <X class="h-4 w-4" />
          </button>
        </header>
        <div class="grid max-h-[calc(100vh-7rem)] place-items-center overflow-auto bg-slate-50 p-4">
          <img :src="previewImageSrc" alt="Enlarged candidate evidence image" class="max-h-[calc(100vh-9rem)] max-w-full object-contain">
        </div>
      </section>
    </div>
  </Teleport>
</template>
