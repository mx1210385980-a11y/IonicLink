import { describe, expect, it } from 'vitest'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  applyLiveConfidence,
  cofDisplay,
  conditionChipDisplayParts,
  conditionGroups,
  confidenceDetailsFor,
  detailedConditionChips,
  formatIonicLiquidPartHtml,
  formatIonicLiquidHtml,
  ionicLiquidParts,
  lubricantAliasDisplay,
  lubricantDisplay,
  lubricantDisplayLines,
  lubricantDisplayRows,
  lubricantStructureItems,
  lubricantStructureLayout,
  lubricantTooltip,
  normalizeConfidenceDetails,
  surfaceRoughnessBadge,
  tribopairParts,
} from '@/lib/integratedExplorerHelpers'
import { normalizePotentialDisplayText } from '@/lib/potential'

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
    shearRate: null,
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

  it('formats shear-rate and qualitative load chips without default units', () => {
    const chips = detailedConditionChips(createRecord({
      speedValue: null,
      shearRate: '195-1300 s^-1',
      loadValue: 'low load; n = 3 region up to ~10 μN',
    }))
    const shearRate = chips.find((chip) => chip.key === 'shear_rate')
    const load = chips.find((chip) => chip.key === 'load')

    expect(shearRate && conditionChipDisplayParts(shearRate)).toEqual({
      label: '剪切率',
      value: '195–1300',
      unit: 's^-1',
    })
    expect(load && conditionChipDisplayParts(load)).toEqual({
      label: '低载荷',
      value: '≤10',
      unit: 'μN',
    })
  })

  it('does not display bare legacy numeric molRatio values as concentration chips', () => {
    const legacy = detailedConditionChips(createRecord({ molRatio: '17.4' }))
    expect(legacy.some((chip) => chip.key === 'mol_ratio')).toBe(false)

    const molar = detailedConditionChips(createRecord({ molRatio: '1.6 M' }))
    expect(molar.find((chip) => chip.key === 'mol_ratio')?.full).toBe('1.6 M')

    const ratio = detailedConditionChips(createRecord({ molRatio: '1:70' }))
    expect(ratio.find((chip) => chip.key === 'mol_ratio')?.full).toBe('1:70')
  })

  it('keeps high-load squeeze-out conditions compact instead of inferring nN', () => {
    const chips = detailedConditionChips(createRecord({
      loadValue: 'high load after n = 3 squeeze-out',
    }))
    const load = chips.find((chip) => chip.key === 'load')

    expect(load && conditionChipDisplayParts(load)).toEqual({
      label: '高载荷',
      value: 'squeeze-out',
      unit: '',
    })
  })

  it('normalizes potential labels for OCP reference display', () => {
    expect(normalizePotentialDisplayText('-0.16 V (OCP)')).toBe('-0.16 V vs OCP')
    expect(normalizePotentialDisplayText('OCP')).toBe('0 V vs OCP')
    expect(normalizePotentialDisplayText('160 mV below OCP')).toBe('-0.16 V vs OCP')
    expect(normalizePotentialDisplayText('+250 mV vs Ag/AgCl')).toBe('+0.25 V vs Ag/AgCl')
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
    expect(formatIonicLiquidPartHtml('[P66614]')).toBe('[P<sub>6,6,6,14</sub>]')
    expect(formatIonicLiquidPartHtml('[P4,4,4,1]')).toBe('[P<sub>4,4,4,1</sub>]')
    expect(formatIonicLiquidPartHtml('[P6,6,6,14]')).toBe('[P<sub>6,6,6,14</sub>]')
    expect(formatIonicLiquidPartHtml('[i(C8)2PO2]')).toBe('[<sup>i</sup>(C<sub>8</sub>)<sub>2</sub>PO<sub>2</sub>]')
    expect(formatIonicLiquidPartHtml('[(iC8)2PO2]')).toBe('[<sup>i</sup>(C<sub>8</sub>)<sub>2</sub>PO<sub>2</sub>]')
    const ic8Layout = lubricantStructureLayout(createRecord({
      lubricant: '[P6,6,6,14][i(C8)2PO2]',
      cation: 'P6,6,6,14',
      anion: 'i(C8)2PO2',
    }))
    expect(ic8Layout?.pairs[0]?.anion.smiles).toContain('O=P([O-])')
    expect(ic8Layout?.pairs[0]?.anion.smiles).toContain('CC(C)CC(C)(C)C')
    const ratioHtml = formatIonicLiquidHtml('[P66614][BTA] (80 wt%)')
    expect(ratioHtml).toContain('[P<sub>6,6,6,14</sub>][BTA]')
    expect(ratioHtml).toContain('Ratio')
    expect(ratioHtml).toContain('80 wt%')
    expect(ionicLiquidParts('[P66614][TFSI]')).toEqual(['[P66614]', '[TFSI]'])
  })

  it('does not apply mixture display affordances to pure ionic liquids', () => {
    const pure = createRecord({
      lubricant: '[EMIM][EtSO4]',
      lubricantComponents: [],
      ionicLiquidDisplay: '[EMIM][EtSO4]',
    })

    expect(lubricantDisplay(pure)).toBe('[EMIM][EtSO4]')
    expect(lubricantTooltip(pure)).toBe('')
  })

  it('keeps literature aliases separate from standardized ionic liquid labels', () => {
    const aliased = createRecord({
      lubricant: '[EHIM][TFSI]',
      lubricantAlias: 'L-F206',
      ionicLiquidDisplay: '[EHIM][TFSI]',
    })

    expect(lubricantDisplay(aliased)).toBe('[EHIM][TFSI]')
    expect(lubricantAliasDisplay(aliased)).toBe('L-F206')
    expect(lubricantDisplayLines(aliased)).toEqual(['[EHIM][TFSI]'])
    expect(lubricantTooltip(aliased)).toContain('文献别名: L-F206')
  })

  it('keeps compact display and tooltip details for ionic liquid mixtures', () => {
    const mixture = createRecord({
      lubricant: '[P66614][BTA]:[P66614][Doc] = 4:1 mass ratio',
      lubricantComponents: [
        { compound: '[P66614][BTA]', fraction: 80, unit: 'wt%' },
        { compound: '[P66614][Doc]', fraction: 20, unit: 'wt%' },
      ],
    })

    expect(lubricantDisplay(mixture)).toBe('[P6,6,6,14][BTA] / [P6,6,6,14][Doc] (4:1 wt)')
    expect(lubricantDisplayLines(mixture)).toEqual([
      '[P6,6,6,14][BTA]',
      '[P6,6,6,14][Doc]',
      '(4:1 wt)',
    ])
    expect(lubricantDisplayRows(mixture).map((line) => [line.text, line.emphasis])).toEqual([
      ['[P6,6,6,14][BTA]', 'primary'],
      ['[P6,6,6,14][Doc]', 'secondary'],
      ['(4:1 wt)', 'secondary'],
    ])
    const layout = lubricantStructureLayout(mixture)
    expect(layout?.kind).toBe('shared-cation')
    expect(layout?.cation?.label).toBe('[P6,6,6,14]')
    expect(layout?.anions?.map((item) => item.label)).toEqual(['[BTA]', '[Doc]'])
    expect(layout?.cation?.smiles).toContain('[P+]')
    expect(layout?.anions?.every((item) => Boolean(item.smiles))).toBe(true)
    expect(lubricantStructureItems(mixture).map((item) => item.label)).toEqual([
      '[P6,6,6,14]',
      '[BTA]',
      '[Doc]',
    ])
    expect(lubricantTooltip(mixture)).toContain('[P6,6,6,14][BTA]: 80 wt%')
  })

  it('renders pyridinium cations used by pure and hydroxylated alkyl pyridinium ILs', () => {
    const c5py = lubricantStructureLayout(createRecord({
      lubricant: '[C5Py][BF4]',
      cation: 'C5Py',
      anion: 'BF4',
    }))
    expect(c5py?.pairs[0]?.cation.smiles).toBe('CCCCC[n+]1ccccc1')
    expect(c5py?.pairs[0]?.anion.smiles).toBe('F[B-](F)(F)F')

    const hoc4py = lubricantStructureLayout(createRecord({
      lubricant: '[HOC4Py][TFSI]',
      cation: 'HOC4Py',
      anion: 'TFSI',
    }))
    expect(hoc4py?.pairs[0]?.cation.smiles).toBe('OCCCC[n+]1ccccc1')
    expect(hoc4py?.pairs[0]?.anion.smiles).toContain('S(=O)(=O)')
  })

  it('shows base oils as secondary compound lines while keeping the ionic liquid primary', () => {
    const additiveBlend = createRecord({
      lubricant: '[P6,6,6,14][BScB]',
      lubricantComponents: [
        { compound: '[P6,6,6,14][BScB]', fraction: 1.4085, unit: 'mol%', role: 'additive' },
        { compound: 'DEGDBE oil', fraction: 98.5915, unit: 'mol%', role: 'base_oil' },
      ],
    })

    expect(lubricantDisplay(additiveBlend)).toBe('[P6,6,6,14][BScB] / DEGDBE oil (1:70 mol)')
    expect(lubricantDisplayLines(additiveBlend)).toEqual(['[P6,6,6,14][BScB]', 'DEGDBE oil', '(1:70 mol)'])
    expect(lubricantDisplayRows(additiveBlend).map((line) => [line.text, line.emphasis])).toEqual([
      ['[P6,6,6,14][BScB]', 'primary'],
      ['DEGDBE oil', 'secondary'],
      ['(1:70 mol)', 'secondary'],
    ])
    expect(lubricantTooltip(additiveBlend)).toContain('DEGDBE oil: 98.5915 mol%')

    const hexadecaneBlend = createRecord({
      lubricant: '[P6,6,6,14][i(C8)2PO2]',
      lubricantComponents: [
        { compound: '[P6,6,6,14][i(C8)2PO2]', fraction: 0.001, unit: 'mol%', role: 'ionic_liquid' },
        { compound: 'hexadecane', fraction: 99.999, unit: 'mol%', role: 'base_oil' },
      ],
    })
    expect(lubricantDisplayRows(hexadecaneBlend).map((line) => [line.text, line.emphasis])).toEqual([
      ['[P6,6,6,14][i(C8)2PO2]', 'primary'],
      ['hexadecane', 'secondary'],
      ['(1:99999 mol)', 'secondary'],
    ])
  })

  it('does not render internal x_IL dataset fractions as mixture ratios', () => {
    const legacyXil = createRecord({
      lubricant: '[P6,6,6,14][AOT]',
      cation: 'P6,6,6,14',
      anion: 'AOT',
      lubricantComponents: [
        { compound: '[P6,6,6,14][AOT]', fraction: 1.002, unit: 'dataset x_IL', role: 'ionic_liquid' },
        { compound: '(CH2CO2Et)2', role: 'solvent' },
      ],
    })

    expect(lubricantDisplayLines(legacyXil)).toEqual([
      '[P6,6,6,14][AOT]',
      '(CH2CO2Et)2',
    ])
    expect(lubricantDisplay(legacyXil)).toBe('[P6,6,6,14][AOT] / (CH2CO2Et)2')
  })

  it('renders normalized x_IL mol% mixtures and pure-solvent controls cleanly', () => {
    const normalizedXil = createRecord({
      lubricant: '[P6,6,6,14][AOT]',
      lubricantComponents: [
        { compound: '[P6,6,6,14][AOT]', fraction: 1.002, unit: 'mol%', role: 'ionic_liquid' },
        { compound: '(CH2CO2Et)2', fraction: 98.998, unit: 'mol%', role: 'solvent' },
      ],
    })
    expect(lubricantDisplayLines(normalizedXil)).toEqual([
      '[P6,6,6,14][AOT]',
      '(CH2CO2Et)2',
      '(1:99 mol)',
    ])

    const pureSolvent = createRecord({
      lubricant: '[P6,6,6,14][AOT]',
      cation: 'P6,6,6,14',
      anion: 'AOT',
      lubricantComponents: [
        { compound: '(CH2CO2Et)2', fraction: 100, unit: 'mol%', role: 'solvent' },
      ],
    })
    expect(lubricantDisplayLines(pureSolvent)).toEqual(['(CH2CO2Et)2'])
    expect(lubricantStructureItems(pureSolvent).map((item) => item.label)).toEqual(['(CH2CO2Et)2'])

    const pureBaseOil = createRecord({
      lubricant: 'hexadecane',
      lubricantComponents: [],
    })
    expect(lubricantStructureItems(pureBaseOil).map((item) => item.label)).toEqual(['hexadecane'])
  })
})
