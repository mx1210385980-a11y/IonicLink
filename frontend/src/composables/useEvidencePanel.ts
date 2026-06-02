import { ref } from 'vue'

import {
  getCandidateEvidence,
  getRecordEvidence,
  promoteTribologyRecordConfidence,
  type EvidenceResult,
  type RecordResponse,
} from '@/lib/api'
import {
  applyLiveConfidence,
  confidenceDetailsFor,
} from '@/lib/integratedExplorerHelpers'

type EvidencePanelOptions = {
  syncConfidence?: boolean
}

export function recordEvidenceCacheKey(record: Pick<RecordResponse, 'id' | 'entityType' | 'reviewEntityType' | 'entityId'>) {
  const entityType = String(record.reviewEntityType || record.entityType || 'record').trim().toLowerCase()
  const entityId = Number(record.entityId || record.id)
  return `${entityType === 'candidate' ? 'candidate' : 'record'}:${Number.isFinite(entityId) ? entityId : record.id}`
}

function isCandidateRecord(record: Pick<RecordResponse, 'entityType' | 'reviewEntityType'>) {
  return String(record.reviewEntityType || record.entityType || '').trim().toLowerCase() === 'candidate'
}

export function useEvidencePanel() {
  const evidenceModalRecord = ref<RecordResponse | null>(null)
  const evidenceData = ref<Record<string, EvidenceResult | null>>({})
  const evidenceLoading = ref<Record<string, boolean>>({})
  const evidenceError = ref<Record<string, string | null>>({})
  const confidenceSyncing = ref<Record<string, boolean>>({})

  function closeEvidenceModal() {
    evidenceModalRecord.value = null
  }

  async function persistPromotedConfidence(record: RecordResponse, previousStoredScore?: number) {
    if (isCandidateRecord(record)) return
    const cacheKey = recordEvidenceCacheKey(record)
    const ev = evidenceData.value[cacheKey]
    if (!ev || confidenceSyncing.value[cacheKey]) return

    const liveDetails = confidenceDetailsFor(record, ev)
    const storedScore = Number(previousStoredScore ?? record.confidence ?? 0)
    if (Math.abs(liveDetails.score - storedScore) < 1e-6) return

    confidenceSyncing.value[cacheKey] = true
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
      confidenceSyncing.value[cacheKey] = false
    }
  }

  async function fetchEvidence(record: RecordResponse, options: EvidencePanelOptions = {}) {
    const cacheKey = recordEvidenceCacheKey(record)
    if (!record.literatureId || evidenceLoading.value[cacheKey]) return
    const shouldSyncConfidence = options.syncConfidence !== false

    const cached = evidenceData.value[cacheKey]
    const hasUsefulCachedData =
      !!cached &&
      (cached.has_image ||
        !!cached.evidence_text ||
        !!cached.page ||
        !!cached.source)
    const hasTermHits = !!(cached && Array.isArray(cached.term_hits) && cached.term_hits.length > 0)

    if (hasUsefulCachedData && (!cached?.has_pdf || hasTermHits)) {
      if (!shouldSyncConfidence) return
      const previousStoredScore = applyLiveConfidence(record, cached)
      await persistPromotedConfidence(record, previousStoredScore)
      return
    }

    evidenceLoading.value[cacheKey] = true
    evidenceError.value[cacheKey] = null

    try {
      const entityId = Number(record.entityId || record.id)
      const ev = isCandidateRecord(record)
        ? await getCandidateEvidence(record.literatureId, entityId)
        : await getRecordEvidence(record.literatureId, entityId)
      evidenceData.value[cacheKey] = ev
      if (shouldSyncConfidence) {
        const previousStoredScore = applyLiveConfidence(record, ev)
        await persistPromotedConfidence(record, previousStoredScore)
      }
    } catch (err: any) {
      evidenceData.value[cacheKey] = null
      evidenceError.value[cacheKey] = err?.message || 'Failed to load evidence'
    } finally {
      evidenceLoading.value[cacheKey] = false
    }
  }

  function openEvidenceModal(record: RecordResponse, options: EvidencePanelOptions = {}) {
    evidenceModalRecord.value = record
    void fetchEvidence(record, options)
  }

  return {
    evidenceModalRecord,
    evidenceData,
    evidenceLoading,
    evidenceError,
    closeEvidenceModal,
    fetchEvidence,
    openEvidenceModal,
    recordEvidenceCacheKey,
  }
}
