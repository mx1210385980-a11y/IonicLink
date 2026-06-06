import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'CandidateReviewSheet.vue'), 'utf-8')

describe('CandidateReviewSheet structure', () => {
  it('saves editable candidate review groups through existing review APIs before approval', () => {
    expect(source).toContain('getCandidateFieldEvidence')
    expect(source).toContain('updateReviewCandidateCofExtracted')
    expect(source).toContain('updateReviewCandidateFields')
    expect(source).toContain('updateReviewCandidateLoadConditions')
    expect(source).toContain('updateReviewCandidateSpeedConditions')
    expect(source).toContain('updateReviewCandidateTribologicalSystem')
    expect(source).toContain('approveReviewCandidate')
    expect(source).toContain('async function saveAndApprove()')
    expect(source).toContain('await updateReviewCandidateCofExtracted(candidateId.value,')
    expect(source).toContain('await updateReviewCandidateFields(candidateId.value, scalarCorrections)')
    expect(source).toContain('await updateReviewCandidateLoadConditions(candidateId.value,')
    expect(source).toContain('await updateReviewCandidateSpeedConditions(candidateId.value,')
    expect(source).toContain('await updateReviewCandidateTribologicalSystem(candidateId.value,')
    expect(source).toContain('await approveReviewCandidate(candidateId.value)')
    expect(source).toContain("emit('saved-and-approved')")
    expect(source).toContain('potential: draft.value.potential || null')
  })

  it('presents an evidence-first verify-card layout instead of a flat form + rail', () => {
    expect(source).toContain('Candidate Review')
    expect(source).toContain('const reviewCards: ReviewCardDef[]')
    expect(source).toContain("key: 'ionic_liquid', label: 'Ionic liquid'")
    expect(source).toContain("key: 'cof', label: 'COF'")
    expect(source).toContain("key: 'tribopair', label: 'Tribopair'")
    expect(source).toContain("key: 'conditions', label: 'Conditions'")
    expect(source).toContain('const cardModels = computed')
    expect(source).toContain('v-for="card in cardModels"')
    expect(source).toContain(':data-card="card.key"')
    // status chips drive the "needs attention" signal
    expect(source).toContain("status: 'flagged' | 'confirmed' | 'grounded' | 'check'")
    expect(source).toContain('Needs your attention:')
    // the old form/rail split is gone
    expect(source).not.toContain('Editable review fields')
    expect(source).not.toContain('Evidence rail')
    expect(source).not.toContain('Identity & tribopair correction')
    expect(source).not.toContain('selectedEvidenceFieldKey')
  })

  it('defaults each card to read-only with an inline edit toggle, secondary fields collapsed', () => {
    expect(source).toContain('const editingCards = ref<Set<ReviewCardKey>>')
    expect(source).toContain('function toggleCardEditing(key: ReviewCardKey)')
    expect(source).toContain('function isCardEditing(key: ReviewCardKey)')
    expect(source).toContain('@click="toggleCardEditing(card.key)"')
    expect(source).toContain('v-if="!isCardEditing(card.key)"')
    // missing-value cards auto-open so reviewers land on the gaps
    expect(source).toContain('if (!cardHasValue(card)) autoEdit.add(card.key)')
    // advanced section collapses the secondary fields
    expect(source).toContain('const advancedOpen = ref(false)')
    expect(source).toContain('Advanced details')
    expect(source).toContain('@click="advancedOpen = !advancedOpen"')
  })

  it('couples each card to its strongest evidence inline (quote + source image)', () => {
    expect(source).toContain('function cardBestEvidence')
    expect(source).toContain('function cardEvidenceEntries')
    expect(source).toContain('evidenceEntryQualityScore')
    expect(source).toContain('async function hydrateCardImages()')
    expect(source).toContain('async function hydrateEvidenceImage(entry: FieldEvidenceEntry | null)')
    expect(source).toContain('getPdfFigurePreviews')
    expect(source).toContain('getPdfBboxPreview')
    expect(source).toContain('figurePreviewMatchesEvidence')
    expect(source).toContain('card.imageSrc')
    expect(source).toContain('card.quote')
    expect(source).toContain('@click="openImagePreview(card.imageSrc)"')
    expect(source).toContain('Source image preview')
  })

  it('renders a tight text-region crop for text-grounded values, not the whole figure', () => {
    expect(source).toContain('function evidenceHasTextMatch')
    expect(source).toContain('function entryIsFigureSourced')
    // image selection keys off explicit source_type, not a figure mention in source_label
    expect(source).toContain("['figure', 'visual', 'image', 'table'].includes(sourceType)")
    expect(source).not.toContain('/\\b(?:fig|figure|table|plot)\\.?\\s*\\d*/.test(sourceLabel)')
    // a value with a matched phrase + bbox is cropped tight; figure preview is fallback-only
    expect(source).toContain('const hasTextMatch = evidenceHasTextMatch(entry)')
    expect(source).toContain("const context = hasTextMatch ? 'normal' : 'wide'")
    expect(source).toContain('if (entryIsFigureSourced(entry) && !hasTextMatch)')
  })

  it('highlights the matched phrase inside the quote for at-a-glance judging', () => {
    expect(source).toContain('function highlightQuote(quote: string, matchedText: string)')
    expect(source).toContain('function escapeHtml(value: string)')
    expect(source).toContain('matchedText: evidenceMatchedText(bestEntry)')
    expect(source).toContain('v-html="highlightQuote(card.quote, card.matchedText)"')
    expect(source).toContain('<mark')
  })

  it('lets reviewers confirm or flag each card evidence inline and refreshes from the response', () => {
    expect(source).toContain('confirmCandidateFieldEvidence')
    expect(source).toContain('flagCandidateFieldEvidence')
    expect(source).toContain('unflagCandidateFieldEvidence')
    expect(source).toContain("async function runEvidenceAction(action: 'confirm' | 'flag' | 'unflag', fieldKey: string)")
    expect(source).toContain('evidence.value = response')
    expect(source).toContain('evidenceCache.set(candidateId.value, response)')
    expect(source).toContain("@click=\"runEvidenceAction('confirm', card.actionKey)\"")
    expect(source).toContain("@click=\"runEvidenceAction('flag', card.actionKey)\"")
    expect(source).toContain("@click=\"runEvidenceAction('unflag', card.actionKey)\"")
  })

  it('keeps queue navigation, prefetch, reject, and keyboard shortcuts', () => {
    expect(source).toContain('hasNextCandidate?: boolean')
    expect(source).toContain("'next-candidate': []")
    expect(source).toContain('Next candidate')
    expect(source).toContain('nextRecord?: RecordResponse | null')
    expect(source).toContain('function prefetchNextEvidence')
    expect(source).toContain('prefetchNextEvidence()')
    expect(source).toContain('rejected: []')
    expect(source).toContain('async function rejectCandidate()')
    expect(source).toContain("emit('rejected')")
    expect(source).toContain('@click="rejectCandidate"')
    expect(source).toContain('function handleReviewKeydown')
    expect(source).toContain("window.addEventListener('keydown', handleReviewKeydown)")
    expect(source).toContain("window.removeEventListener('keydown', handleReviewKeydown)")
    expect(source).toContain('Approve')
    expect(source).toContain('Reject')
  })

  it('surfaces readiness and keeps the local blockers guidance', () => {
    expect(source).toContain('readinessLabel')
    expect(source).toContain('Ready')
    expect(source).toContain('Needs fix')
    expect(source).toContain('localBlockers')
    expect(source).toContain('approvalError')
    expect(source).toContain('saveError')
  })
})
