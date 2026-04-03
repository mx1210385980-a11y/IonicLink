import { ref } from 'vue'

import {
  getRecordEvidence,
  promoteTribologyRecordConfidence,
  type EvidenceResult,
  type RecordResponse,
} from '@/lib/api'
import {
  applyLiveConfidence,
  confidenceDetailsFor,
} from '@/lib/integratedExplorerHelpers'

export function useEvidencePanel() {
  const evidenceModalRecord = ref<RecordResponse | null>(null)
  const evidenceData = ref<Record<number, EvidenceResult | null>>({})
  const evidenceLoading = ref<Record<number, boolean>>({})
  const evidenceError = ref<Record<number, string | null>>({})
  const confidenceSyncing = ref<Record<number, boolean>>({})

  function closeEvidenceModal() {
    evidenceModalRecord.value = null
  }

  async function persistPromotedConfidence(record: RecordResponse, previousStoredScore?: number) {
    const ev = evidenceData.value[record.id]
    if (!ev || confidenceSyncing.value[record.id]) return

    const liveDetails = confidenceDetailsFor(record, ev)
    const storedScore = Number(previousStoredScore ?? record.confidence ?? 0)
    if (Math.abs(liveDetails.score - storedScore) < 1e-6) return

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

  async function fetchEvidence(record: RecordResponse) {
    if (!record.literatureId || evidenceLoading.value[record.id]) return

    const cached = evidenceData.value[record.id]
    const hasUsefulCachedData =
      !!cached &&
      (cached.has_image ||
        !!cached.evidence_text ||
        !!cached.page ||
        !!cached.source)
    const hasTermHits = !!(cached && Array.isArray(cached.term_hits) && cached.term_hits.length > 0)

    if (hasUsefulCachedData && (!cached?.has_pdf || hasTermHits)) {
      const previousStoredScore = applyLiveConfidence(record, cached)
      await persistPromotedConfidence(record, previousStoredScore)
      return
    }

    evidenceLoading.value[record.id] = true
    evidenceError.value[record.id] = null

    try {
      const ev = await getRecordEvidence(record.literatureId, record.id)
      evidenceData.value[record.id] = ev
      const previousStoredScore = applyLiveConfidence(record, ev)
      await persistPromotedConfidence(record, previousStoredScore)
    } catch (err: any) {
      evidenceData.value[record.id] = null
      evidenceError.value[record.id] = err?.message || 'Failed to load evidence'
    } finally {
      evidenceLoading.value[record.id] = false
    }
  }

  function openEvidenceModal(record: RecordResponse) {
    evidenceModalRecord.value = record
    void fetchEvidence(record)
  }

  return {
    evidenceModalRecord,
    evidenceData,
    evidenceLoading,
    evidenceError,
    closeEvidenceModal,
    fetchEvidence,
    openEvidenceModal,
  }
}
