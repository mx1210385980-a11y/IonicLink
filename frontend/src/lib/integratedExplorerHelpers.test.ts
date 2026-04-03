import { describe, expect, it } from 'vitest'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  applyLiveConfidence,
  cofDisplay,
  conditionGroups,
  confidenceDetailsFor,
  formatIonicLiquidPartHtml,
  formatIonicLiquidHtml,
  ionicLiquidParts,
  normalizeConfidenceDetails,
  surfaceRoughnessBadge,
  tribopairParts,
} from '@/lib/integratedExplorerHelpers'

function createRecord(overrides: Partial<RecordResponse> = {}): RecordResponse {
  return {
    id: 1,
    materialName: 'Mica',
    lubricant: '[EMIM][BF4]',
    cofValue: 0.12345,
    cofOperator: null,
    cofRaw: null,
    loadValue: '15 nN',
    loadRaw: '15 nN',
    speedValue: '2 um/s',
    temperature: '298 K',
    potential: '1.0 V',
    waterContent: 'dry',
    probeMaterial: 'Steel',
    probeGeometry: 'Ball',
    probeRadius: null,
    probeRoughness: null,
    substrateMaterial: 'Mica',
    substrateCoating: 'DLC',
    substrateRoughness: null,
    tribopairLabel: null,
    surfaceRoughness: null,
    residualFilmThicknessD: null,
    layerSpacingDelta: null,
    filmThickness: null,
    molRatio: null,
    cation: null,
    anion: null,
    cationSmiles: null,
    anionSmiles: null,
    ilSmiles: null,
    ilInchikey: null,
    alkylChainLength: null,
    confidence: 0.55,
    confidenceDetails: {
      base_score: 0.8,
      base_percent: 80,
      score: 0.55,
      percent: 55,
      penalties: [
        { reason: 'missing_source', value: 0.1 },
        { reason: 'missing_source_page', value: 0.1 },
        { reason: 'missing_evidence', value: 0.05 },
      ],
      boosts: [],
      penalty_total: 0.25,
      penalty_percent: 25,
      boost_total: 0,
      boost_percent: 0,
    },
    literatureId: 11,
    literature: null,
    evidence: null,
    evidencePage: null,
    evidenceBbox: null,
    source: null,
    sourcePage: null,
    sourceFigure: null,
    ...overrides,
  }
}

describe('integratedExplorerHelpers', () => {
  it('formats COF values and falls back to raw text when needed', () => {
    expect(cofDisplay(createRecord())).toBe('0.1235')
    expect(cofDisplay(createRecord({ cofValue: null, cofRaw: '<0.05' }))).toBe('<0.05')
    expect(cofDisplay(createRecord({ cofValue: null, cofRaw: null }))).toBe('--')
  })

  it('normalizes confidence details and clamps the score floor', () => {
    const details = normalizeConfidenceDetails({
      base_score: 0.2,
      penalties: [{ reason: 'missing_evidence', value: 0.4 }],
      boosts: [],
      score: 0.2,
      percent: 20,
    })

    expect(details.score).toBe(0.05)
    expect(details.penalty_total).toBe(0.4)
    expect(details.percent).toBe(5)
  })

  it('drops missing penalties when live evidence fills the gaps', () => {
    const record = createRecord()
    const evidence: EvidenceResult = {
      record_id: 1,
      evidence_text: 'COF = 0.12',
      text_snippet: 'COF = 0.12',
      source: 'Figure 2',
      page: 4,
      bbox: [1, 2, 3, 4],
      image_b64: null,
      has_image: false,
      has_pdf: true,
    }

    const details = confidenceDetailsFor(record, evidence)

    expect(details.penalties).toEqual([])
    expect(details.score).toBe(0.8)
  })

  it('applies live confidence back onto the record and returns the previous value', () => {
    const record = createRecord()

    const previous = applyLiveConfidence(record, {
      record_id: 1,
      evidence_text: 'COF = 0.12',
      source: 'Table 1',
      page: 3,
      bbox: [1, 2, 3, 4],
      image_b64: null,
      has_image: false,
      has_pdf: true,
    })

    expect(previous).toBe(0.55)
    expect(record.confidence).toBe(0.8)
    expect(record.confidenceDetails?.penalties).toEqual([])
  })

  it('builds grouped condition chips from populated record fields', () => {
    const groups = conditionGroups(createRecord())

    expect(groups.map((group) => group.key)).toEqual(['env', 'dyn', 'surf'])
  })

  it('marks estimated surface roughness values separately', () => {
    expect(surfaceRoughnessBadge(createRecord({ surfaceRoughness: 'Atomically flat mica' }))).toEqual({
      label: 'Atomically flat mica',
      tone: 'estimated',
    })
  })

  it('extracts tribopair parts with a normalized optional coating', () => {
    expect(tribopairParts(createRecord())).toEqual({
      probe: 'Steel',
      substrate: 'Mica',
      coating: 'DLC',
    })
    expect(tribopairParts(createRecord({ substrateCoating: 'None' }))).toEqual({
      probe: 'Steel',
      substrate: 'Mica',
      coating: '',
    })
  })

  it('renders ionic liquids as escaped HTML with subscripts', () => {
    expect(formatIonicLiquidHtml('[C8MIM][BF4]')).toBe('[C<sub>8</sub>MIM][BF<sub>4</sub>]')
    expect(formatIonicLiquidHtml('<tag>')).toBe('&lt;tag&gt;')
  })

  it('renders phosphonium aliases with a full numeric subscript and exposes bracketed ionic liquid parts', () => {
    expect(formatIonicLiquidPartHtml('[P66614]')).toBe('[P<sub>66614</sub>]')
    expect(formatIonicLiquidPartHtml('[P4,4,4,1]')).toBe('[P<sub>4,4,4,1</sub>]')
    expect(formatIonicLiquidPartHtml('[P6,6,6,14]')).toBe('[P<sub>6,6,6,14</sub>]')
    expect(ionicLiquidParts('[P66614][TFSI]')).toEqual(['[P66614]', '[TFSI]'])
  })
})
