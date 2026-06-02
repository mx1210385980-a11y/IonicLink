import type { ExtractorType, TribologyData } from './api'

export type CandidatePublishTarget = {
    entityType: 'candidate' | 'record'
    entityId: number
    extractorType: ExtractorType
}

export function reviewPublishTargetKey(target: CandidatePublishTarget): string {
    return `${target.extractorType}:${target.entityType}:${target.entityId}`
}

function normalizeExtractorType(value: unknown): ExtractorType {
    return String(value || '').trim().toLowerCase() === 'diffusion' ? 'diffusion' : 'tribology'
}

function reviewEntityType(row: Partial<TribologyData>): string {
    return String(
        row.review_entity_type
        || row.reviewEntityType
        || '',
    ).trim().toLowerCase()
}

function reviewEntityId(row: Partial<TribologyData>): number {
    const id = Number(row.entity_id ?? row.entityId ?? row.id ?? 0)
    return Number.isFinite(id) && id > 0 ? id : 0
}

export function resolveCandidatePublishTarget(
    row: Partial<TribologyData>,
    fallbackExtractorType: ExtractorType = 'tribology',
): CandidatePublishTarget | null {
    const rowLike = row as Partial<TribologyData> & { extractorType?: unknown }
    const entityType = reviewEntityType(row) === 'record' ? 'record' : 'candidate'

    const entityId = reviewEntityId(row)
    if (!entityId) {
        return null
    }

    return {
        entityType,
        entityId,
        extractorType: normalizeExtractorType(row.extractor_type || rowLike.extractorType || fallbackExtractorType),
    }
}
