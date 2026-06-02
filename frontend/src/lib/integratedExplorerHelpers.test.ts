import { describe, expect, it } from 'vitest'

import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  applyLiveConfidence,
  cofDisplay,
  contactDisplayModel,
  conditionChipDisplayParts,
  conditionGroups,
  conditionMicrobarItems,
  conditionSealDisplay,
  compactRecordDisplayId,
  confidenceDetailsFor,
  detailedConditionChips,
  formatIonicLiquidPartHtml,
  formatIonicLiquidHtml,
  ionicLiquidParts,
  lubricantAliasDisplay,
  lubricantDisplay,
  lubricantDisplayLines,
  lubricantDisplayRows,
  lubricantRecipeDisplay,
  lubricantStructureItems,
  lubricantStructureLayout,
  lubricantTooltip,
  normalizeConfidenceDetails,
  normalizeTraceDisplayText,
  recordDisplayId,
  surfaceRoughnessBadge,
  tribopairExtras,
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
  it('uses the API display id instead of exposing the database primary key', () => {
    expect(recordDisplayId(createRecord({ id: 353, displayId: 'R-000002' }))).toBe('R-000002')
  })

  it('falls back to a padded display label for old cached payloads', () => {
    expect(recordDisplayId(createRecord({ id: 7, displayId: undefined }))).toBe('R-000007')
  })

  it('renders compact record labels for dense UI surfaces', () => {
    expect(compactRecordDisplayId(createRecord({ id: 353, displayId: 'R-000002' }))).toBe('#002')
    expect(compactRecordDisplayId(createRecord({ id: 7, displayId: undefined }))).toBe('#007')
  })

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

    expect(groups.map((group) => group.key)).toEqual(['env', 'dyn'])
  })

  it('keeps contact descriptors out of condition chips so tribopair owns them', () => {
    const groups = conditionGroups(createRecord({
      substrateCoating: 'DLC',
      filmThickness: '2.4 nm',
      substrateRoughness: 'Rq 0.5 nm',
      probeGeometry: 'Tip',
      probeRadius: '7 nm',
      probeRoughness: 'Rq 0.2 nm',
    }))

    expect(groups.some((group) => group.key === 'surf')).toBe(false)
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
      label: 'shear rate',
      value: '195–1300',
      unit: 's^-1',
    })
    expect(load && conditionChipDisplayParts(load)).toEqual({
      label: 'low load',
      value: '≤10',
      unit: 'μN',
    })
  })

  it('symbolizes up-to condition limits before rendering compact readouts', () => {
    const chips = detailedConditionChips(createRecord({
      loadValue: 'load up to 10 nN',
    }))
    const load = chips.find((chip) => chip.key === 'load')

    expect(load && conditionChipDisplayParts(load)).toMatchObject({
      label: 'load',
      value: '≤10',
      unit: 'nN',
    })
  })

  it('keeps molRatio values out of condition chips because composition belongs to ionic liquid', () => {
    const legacy = detailedConditionChips(createRecord({ molRatio: '17.4' }))
    expect(legacy.some((chip) => chip.key === 'mol_ratio')).toBe(false)

    const molar = detailedConditionChips(createRecord({ molRatio: '1.6 M' }))
    expect(molar.some((chip) => chip.key === 'mol_ratio')).toBe(false)

    const ratio = detailedConditionChips(createRecord({ molRatio: '1:70' }))
    expect(ratio.some((chip) => chip.key === 'mol_ratio')).toBe(false)
  })

  it('keeps mixture concentration out of condition chips because ionic liquid owns composition', () => {
    const microbar = conditionMicrobarItems(createRecord({
      molRatio: '1.6 mol% IL',
      speedValue: '6 μm/s',
      potential: 'OCP',
      temperature: '298 K',
      waterContent: '',
      loadValue: null,
    }), 6)

    expect(microbar.items.map((item) => item.key)).toEqual(['speed', 'potential', 'temperature'])
    expect(microbar.title).not.toContain('mol%')
  })

  it('keeps high-load squeeze-out conditions compact instead of inferring nN', () => {
    const chips = detailedConditionChips(createRecord({
      loadValue: 'high load after n = 3 squeeze-out',
    }))
    const load = chips.find((chip) => chip.key === 'load')

    expect(load && conditionChipDisplayParts(load)).toEqual({
      label: 'high load',
      value: 'squeeze-out',
      unit: '',
    })
  })

  it('builds a prioritized condition microbar without surface roughness', () => {
    const microbar = conditionMicrobarItems(createRecord({
      loadValue: '30 nN',
      speedValue: '5 μm/s',
      potential: '-0.16 V (OCP)',
      temperature: '298.15 K',
      waterContent: 'dry',
      substrateRoughness: '0.8',
      surfaceRoughness: '0.8 nm',
    }), 4)

    expect(microbar.items.map((item) => item.symbol)).toEqual(['F', 'V', 'ψ', 'T'])
    expect(microbar.items.map((item) => `${item.value} ${item.unit}`.trim())).toEqual([
      '30 nN',
      '5 μm/s',
      '-0.16 V',
      '298.15 K',
    ])
    expect(microbar.items[3]?.emphasis).toBe('muted')
    expect(microbar.overflow).toBe(1)
    expect(microbar.title).toContain('含水: dry')
    expect(microbar.title).not.toContain('0.8')
  })

  it('treats active potential and load as important while keeping open-circuit potential quiet', () => {
    const active = conditionMicrobarItems(createRecord({
      loadValue: '30 nN',
      speedValue: '6 μm/s',
      potential: '+1 V',
      temperature: '298 K',
      waterContent: '',
    }), 4)

    const load = active.items.find((item) => item.key === 'load')
    const potential = active.items.find((item) => item.key === 'potential')
    expect(load?.emphasis).toBe('primary')
    expect(potential?.value).toBe('+1')
    expect(potential?.unit).toBe('V')
    expect(potential?.emphasis).toBe('primary')

    const seal = conditionSealDisplay(createRecord({
      loadValue: '30 nN',
      speedValue: '6 μm/s',
      potential: '+1 V',
      temperature: '298 K',
      waterContent: '',
    }))
    expect(seal.primary?.key).toBe('load')
    expect(seal.badge?.key).toBe('potential')

    const openCircuit = conditionMicrobarItems(createRecord({
      loadValue: null,
      speedValue: '6 μm/s',
      potential: 'OCP',
      temperature: '298 K',
      waterContent: '',
    }), 4)
    const ocp = openCircuit.items.find((item) => item.key === 'potential')
    expect(ocp?.value).toBe('OCP')
    expect(ocp?.unit).toBe('')
    expect(ocp?.emphasis).toBe('muted')

    const zeroVolt = conditionMicrobarItems(createRecord({
      loadValue: null,
      speedValue: '6 μm/s',
      potential: '0 V',
      temperature: '298 K',
      waterContent: '',
    }), 4)
    expect(zeroVolt.items.find((item) => item.key === 'potential')?.emphasis).toBe('muted')
  })

  it('shows OCP without verbose no-applied-potential explanations', () => {
    const microbar = conditionMicrobarItems(createRecord({
      loadValue: null,
      speedValue: '6 μm/s',
      potential: 'OCP (no applied potential)',
      temperature: '298 K',
      waterContent: '',
    }), 4)
    const potential = microbar.items.find((item) => item.key === 'potential')

    expect(normalizePotentialDisplayText('OCP (no applied potential)')).toBe('0 V vs OCP')
    expect(potential?.value).toBe('OCP')
    expect(potential?.unit).toBe('')
    expect(potential?.full).toBe('0 V vs OCP')
    expect(`${potential?.value || ''} ${potential?.unit || ''}`).not.toContain('no applied')
  })

  it('highlights non-room temperature as a special condition instead of a quiet default', () => {
    const heated = conditionMicrobarItems(createRecord({
      loadValue: null,
      speedValue: null,
      shearRate: null,
      potential: null,
      temperature: '353 K',
      waterContent: '',
    }), 4)
    expect(heated.items.find((item) => item.key === 'temperature')).toMatchObject({
      value: '353',
      unit: 'K',
      emphasis: 'primary',
    })

    const seal = conditionSealDisplay(createRecord({
      loadValue: null,
      speedValue: null,
      shearRate: null,
      potential: null,
      temperature: '353 K',
      waterContent: '',
    }))
    expect(seal.primary?.key).toBe('temperature')

    const room = conditionMicrobarItems(createRecord({
      loadValue: null,
      speedValue: null,
      shearRate: null,
      potential: null,
      temperature: '298 K',
      waterContent: '',
    }), 4)
    expect(room.items.find((item) => item.key === 'temperature')?.emphasis).toBe('muted')
  })

  it('uses shear rate when speed is absent in the condition microbar', () => {
    const microbar = conditionMicrobarItems(createRecord({
      speedValue: null,
      shearRate: '195-1300 s^-1',
      loadValue: 'low load; n = 3 region up to ~10 μN',
      potential: null,
      waterContent: '',
    }), 3)

    expect(microbar.items.map((item) => [item.symbol, item.value, item.unit])).toEqual([
      ['F', '≤10', 'μN'],
      ['γ̇', '195–1300', 's^-1'],
      ['T', '298', 'K'],
    ])
    expect(microbar.overflow).toBe(0)
  })

  it('condenses conditions into a single seal with active potential promoted ahead of speed', () => {
    const seal = conditionSealDisplay(createRecord({
      loadValue: null,
      speedValue: '6 μm/s',
      potential: '-0.5 V vs OCP',
      temperature: '298 K',
      waterContent: 'dry',
    }))

    expect(seal.primary?.key).toBe('potential')
    expect(seal.primary?.symbol).toBe('ψ')
    expect(seal.primary?.value).toBe('-0.5')
    expect(seal.primary?.unit).toBe('V')
    expect(seal.badge?.key).toBe('speed')
    expect(seal.badge?.symbol).toBe('V')
    expect(seal.badge?.value).toBe('6')
    expect(seal.badge?.unit).toBe('μm/s')
    expect(seal.meta.map((item) => item.key)).toEqual(['temperature', 'water'])
    expect(seal.overflow).toBe(0)
    expect(seal.title).toContain('电势: -0.5 V vs OCP')
  })

  it('keeps extra seal conditions behind a compact overflow count', () => {
    const seal = conditionSealDisplay(createRecord({
      loadValue: '30 nN',
      speedValue: '6 μm/s',
      shearRate: '195-1300 s^-1',
      potential: 'OCP',
      temperature: '298 K',
      waterContent: 'dry',
      molRatio: '1.6 M',
    }))

    expect(seal.primary?.key).toBe('load')
    expect(seal.badge?.key).toBe('speed')
    expect(seal.meta.some((item) => item.key === 'potential' && item.emphasis === 'muted')).toBe(true)
    expect(seal.meta).toHaveLength(2)
    expect(seal.overflow).toBe(2)
  })

  it('keeps missing condition placeholders out of the seal primary reading', () => {
    const seal = conditionSealDisplay(createRecord({
      loadValue: 'Not specified',
      speedValue: null,
      shearRate: null,
      potential: null,
      temperature: '298.15 K',
      waterContent: '',
    }))

    expect(seal.primary).toBeNull()
    expect(seal.badge).toBeNull()
    expect(seal.meta.map((item) => [item.key, item.value, item.unit])).toEqual([
      ['temperature', '298.15', 'K'],
    ])
    expect(seal.title).not.toContain('Not specified')
  })

  it('uses macro speed semantics instead of displaying huge nanoscale velocities', () => {
    const microbar = conditionMicrobarItems(createRecord({
      experimentScale: 'macroscale',
      experimentMethod: 'ball_on_disk',
      probeGeometry: 'Ball',
      speedValue: '50000mum/s',
      loadValue: null,
      potential: null,
      temperature: '',
      waterContent: '',
    }), 4)
    const speed = microbar.items.find((item) => item.key === 'speed')

    expect(speed).toMatchObject({
      symbol: 'S',
      label: 'sliding speed',
      value: '50',
      unit: 'mm/s',
    })
    expect(`${speed?.value || ''}${speed?.unit || ''}`).not.toContain('50000')
    expect(normalizeTraceDisplayText('50000mum/s')).toBe('50000 μm/s')
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

  it('collects probe contact details for the tribopair capsule', () => {
    expect(tribopairExtras(createRecord({
      probeGeometry: 'Tip',
      probeRadius: '7 nm',
      probeRoughness: 'Rq 0.5 nm',
      filmThickness: '2.4 nm',
    }))).toEqual({
      probeDetails: 'Tip · 7 nm · Rq 0.5 nm',
      filmThickness: '2.4 nm',
    })
  })

  it('renders ball-on-disk records as a macro contact pair instead of probe/substrate', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: 'Steel',
      probeGeometry: 'Ball',
      probeRadius: '6 mm',
      substrateMaterial: 'Steel disk',
      substrateCoating: null,
      experimentScale: 'macroscale',
      experimentMethod: 'ball_on_disk',
      tribologicalSystem: {
        scale: 'macroscale',
        method: 'ball_on_disk',
        contact_geometry: 'ball_on_disk',
      },
    }))

    expect(model).toMatchObject({
      mode: 'macro',
      pattern: 'ball_disk',
      primaryRole: 'Ball',
      secondaryRole: 'Disk',
      primaryLabel: 'Steel',
      secondaryLabel: 'Steel disk',
      relationLabel: 'Ball <-> Disk',
    })
    expect(model.detailBadges).toContain('6 mm')
  })

  it('renders pin-on-disk records with macro engineering roles', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: 'Al2O3',
      probeGeometry: 'Pin',
      substrateMaterial: 'Ti6Al4V',
      experimentScale: 'macro_performance',
      experimentMethod: 'pin-on-disk',
    }))

    expect(model.mode).toBe('macro')
    expect(model.pattern).toBe('pin_disk')
    expect(model.primaryRole).toBe('Pin')
    expect(model.secondaryRole).toBe('Disk')
  })

  it('keeps AFM records in the nano probe/substrate contact language', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: 'Silicon nitride',
      probeGeometry: 'sharp AFM tip',
      probeRadius: '8 nm',
      substrateMaterial: 'Au(111)',
      experimentScale: 'nanoscale',
      experimentMethod: 'afm_sharp_tip',
      filmThickness: '2.4 nm',
    }))

    expect(model).toMatchObject({
      mode: 'nano',
      pattern: 'probe_substrate',
      primaryRole: 'Probe',
      secondaryRole: 'Substrate',
      primaryLabel: 'Silicon nitride',
      secondaryLabel: 'Au(111)',
    })
    expect(model.detailBadges).toEqual(expect.arrayContaining(['sharp AFM tip', '8 nm', 'Film 2.4 nm']))
  })

  it('labels unitless roughness values in the contact capsule as nanometer Rq details', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: 'AFM tip',
      probeGeometry: 'sharp AFM tip',
      probeRoughness: '0.2',
      substrateMaterial: 'stainless steel',
      substrateRoughness: '0.8',
      surfaceRoughness: '0.8 nm',
      experimentScale: 'nanoscale',
      experimentMethod: 'afm_sharp_tip',
    }))

    expect(model.detailBadges).toEqual(expect.arrayContaining([
      'Probe Rq 0.2 nm',
      'Substrate Rq 0.8 nm',
    ]))
    expect(model.detailBadges).not.toContain('0.8')
    expect(model.title).toContain('Substrate Rq 0.8 nm')
  })

  it('uses macro contact role names when formatting roughness details', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: 'Steel',
      probeGeometry: 'Ball',
      probeRoughness: '15 nm',
      substrateMaterial: 'Steel disk',
      substrateRoughness: '0.89',
      surfaceRoughness: '0.89 nm',
      experimentScale: 'macroscale',
      experimentMethod: 'ball_on_disk',
    }))

    expect(model.detailBadges).toEqual(expect.arrayContaining([
      'Counterface Rq 15 nm',
      'Specimen Rq 0.89 nm',
    ]))
  })

  it('falls back gracefully for unknown contact records', () => {
    const model = contactDisplayModel(createRecord({
      probeMaterial: '',
      substrateMaterial: '',
      materialName: 'Graphite',
      experimentScale: 'unknown',
      experimentMethod: '',
      tribologicalSystem: {},
    }))

    expect(model.mode).toBe('unknown')
    expect(model.primaryLabel).toBe('Counterface N/A')
    expect(model.secondaryLabel).toBe('Graphite')
    expect(model.relationLabel).toBe('Counterface <-> Specimen')
  })

  it('renders ionic liquids as escaped HTML with subscripts', () => {
    expect(formatIonicLiquidHtml('[C8MIM][BF4]')).toBe('[C<sub>8</sub>MIM][BF<sub>4</sub>]')
    expect(formatIonicLiquidHtml('<tag>')).toBe('&lt;tag&gt;')
  })

  it('renders phosphonium aliases with a full numeric subscript and exposes bracketed ionic liquid parts', () => {
    expect(formatIonicLiquidPartHtml('[P66614]')).toBe('[P<sub>66614</sub>]')
    expect(formatIonicLiquidPartHtml('[P4,4,4,1]')).toBe('[P<sub>4441</sub>]')
    expect(formatIonicLiquidPartHtml('[P6,6,6,14]')).toBe('[P<sub>66614</sub>]')
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
    expect(ratioHtml).toContain('[P<sub>66614</sub>][BTA]')
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

  it('normalizes common full-name protic ionic liquids into cation and anion form', () => {
    const ean = createRecord({
      lubricant: 'Ethylammonium nitrate',
      ionicLiquidDisplay: 'Ethylammonium nitrate',
      cation: null,
      anion: null,
    })

    expect(lubricantDisplay(ean)).toBe('[EA][NO3]')
    expect(lubricantStructureLayout(ean)?.pairs[0]?.cation.label).toBe('[EA]')
    expect(lubricantStructureLayout(ean)?.pairs[0]?.anion.label).toBe('[NO3]')
    expect(lubricantStructureItems(ean).map((item) => item.label)).toEqual(['[EA]', '[NO3]'])

    const splitFields = createRecord({
      lubricant: '',
      ionicLiquidDisplay: '',
      cation: 'Ethylammonium',
      anion: 'nitrate',
    })

    expect(lubricantStructureLayout(splitFields)?.pairs[0]?.cation.label).toBe('[EA]')
    expect(lubricantStructureLayout(splitFields)?.pairs[0]?.anion.label).toBe('[NO3]')
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
    const bupy = lubricantStructureLayout(createRecord({
      lubricant: '[BuPy][NTf2]',
      cation: 'BuPy',
      anion: 'NTf2',
    }))
    expect(bupy?.pairs[0]?.cation.smiles).toBe('CCCC[n+]1ccccc1')
    expect(bupy?.pairs[0]?.anion.smiles).toContain('S(=O)(=O)')

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

  it('renders special solvate and dicationic cations without backend smiles fallbacks', () => {
    const cases = [
      {
        record: createRecord({ lubricant: '[Li(G4)][TFSI]', cation: 'Li(G4)', anion: 'TFSI' }),
        expectedLabel: '[Li(G4)]',
        expectedSmiles: '[Li+].COCCOCCOCCOCCOC',
      },
      {
        record: createRecord({ lubricant: '[BHPT][TFSI]2', cation: 'BHPT', anion: 'TFSI' }),
        expectedLabel: '[BHPT]',
        expectedSmiles: 'OCC[n+]1ccn(CCCCCn2cc[n+](CCO)c2)c1',
      },
      {
        record: createRecord({ lubricant: '[BHPET][TFSI]2', cation: 'BHPET', anion: 'TFSI' }),
        expectedLabel: '[BHPET]',
        expectedSmiles: 'OCC[n+]1ccn(CCOCCOCCOCCOCCOCCn2cc[n+](CCO)c2)c1',
      },
      {
        record: createRecord({ lubricant: '[C10(C1Im)2][NTf2]2', cation: 'C10(C1Im)2', anion: 'NTf2' }),
        expectedLabel: '[C10(C1Im)2]',
        expectedSmiles: 'C[n+]1ccn(CCCCCCCCCCn2cc[n+](C)c2)c1',
      },
    ]

    for (const item of cases) {
      const structures = lubricantStructureItems(item.record)
      const cation = structures.find((structure) => structure.role === 'cation')
      const anions = structures.filter((structure) => structure.role === 'anion')

      expect(cation?.label).toBe(item.expectedLabel)
      expect(cation?.smiles).toBe(item.expectedSmiles)
      expect(anions[0]?.smiles).toContain('S(=O)(=O)')
    }
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

  it('builds a compact recipe display for ionic-liquid blends in the ionic liquid column', () => {
    const additiveBlend = createRecord({
      lubricant: '[P6,6,6,14][BScB]',
      lubricantComponents: [
        { compound: '[P6,6,6,14][BScB]', fraction: 1.4085, unit: 'mol%', role: 'ionic_liquid' },
        { compound: 'DEGDBE oil', fraction: 98.5915, unit: 'mol%', role: 'base_oil' },
      ],
    })

    expect(lubricantRecipeDisplay(additiveBlend)).toEqual({
      kind: 'blend',
      title: '[P6,6,6,14][BScB]: 1.4085 mol%\nDEGDBE oil: 98.5915 mol%',
      primary: '[P6,6,6,14][BScB]',
      secondary: 'DEGDBE oil',
      ratio: '1:70 mol',
      badge: 'BLEND',
    })
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
