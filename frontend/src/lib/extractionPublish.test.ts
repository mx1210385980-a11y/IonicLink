import { describe, expect, it } from 'vitest'

import { resolveCandidatePublishTarget, reviewPublishTargetKey } from './extractionPublish'

describe('resolveCandidatePublishTarget', () => {
  it('routes diffusion candidates to the diffusion approval endpoint', () => {
    expect(resolveCandidatePublishTarget({
      id: '42',
      extractor_type: 'diffusion',
      review_entity_type: 'candidate',
    })).toEqual({
      entityType: 'candidate',
      entityId: 42,
      extractorType: 'diffusion',
    })
  })

  it('routes tribology candidates to the tribology approval endpoint by default', () => {
    expect(resolveCandidatePublishTarget({
      id: '17',
      review_entity_type: 'candidate',
    })).toEqual({
      entityType: 'candidate',
      entityId: 17,
      extractorType: 'tribology',
    })
  })

  it('uses the active preset when the row does not include extractor type', () => {
    expect(resolveCandidatePublishTarget({
      id: '25',
      review_entity_type: 'candidate',
    }, 'diffusion')).toEqual({
      entityType: 'candidate',
      entityId: 25,
      extractorType: 'diffusion',
    })
  })

  it('routes ready final records to record approval endpoints', () => {
    expect(resolveCandidatePublishTarget({
      id: '19',
      extractor_type: 'diffusion',
      review_entity_type: 'record',
    })).toEqual({
      entityType: 'record',
      entityId: 19,
      extractorType: 'diffusion',
    })
  })

  it('uses the explicit review entity id before the display row id', () => {
    expect(resolveCandidatePublishTarget({
      id: '999',
      entity_id: 42,
      extractor_type: 'tribology',
      review_entity_type: 'candidate',
    })).toEqual({
      entityType: 'candidate',
      entityId: 42,
      extractorType: 'tribology',
    })

    expect(resolveCandidatePublishTarget({
      id: '1000',
      entityId: 77,
      extractor_type: 'diffusion',
      review_entity_type: 'record',
    })).toEqual({
      entityType: 'record',
      entityId: 77,
      extractorType: 'diffusion',
    })
  })

  it('keeps published candidate and record states isolated even when ids collide', () => {
    expect(reviewPublishTargetKey({
      entityType: 'candidate',
      entityId: 7,
      extractorType: 'tribology',
    })).toBe('tribology:candidate:7')

    expect(reviewPublishTargetKey({
      entityType: 'record',
      entityId: 7,
      extractorType: 'tribology',
    })).toBe('tribology:record:7')
  })
})
