import { describe, expect, it } from 'vitest'

import type { RecordResponse, TribologyData } from '@/lib/api'
import {
  groupDatabaseRecordsByLiteratureLiquid,
  groupTribologyRecordsByIonicLiquid,
} from '@/lib/tribologyGrouping'

function record(overrides: Partial<TribologyData>): TribologyData {
  return {
    id: 'row',
    material_name: 'Mica',
    ionic_liquid: '[BMIM][BF4]',
    cof: '0.10',
    ...overrides,
  }
}

function databaseRecord(overrides: Partial<RecordResponse>): RecordResponse {
  return {
    id: 1,
    materialName: 'Mica',
    lubricant: '[BMIM][BF4]',
    cofValue: 0.1,
    cofOperator: null,
    cofRaw: null,
    loadValue: null,
    loadRaw: null,
    speedValue: null,
    shearRate: null,
    temperature: null,
    potential: null,
    waterContent: null,
    probeMaterial: null,
    probeGeometry: null,
    probeRadius: null,
    probeRoughness: null,
    substrateMaterial: null,
    substrateCoating: null,
    substrateRoughness: null,
    tribopairLabel: null,
    surfaceRoughness: null,
    filmThickness: null,
    confidence: 0.8,
    reviewStatus: 'approved',
    literatureId: 2022,
    literature: { id: 2022, doi: '10.example/ionic-surfaces', title: 'Ionic liquids on uncharged and charged surfaces', year: 2022, journal: 'In situ' },
    evidence: null,
    evidencePage: null,
    evidenceBbox: null,
    source: null,
    sourcePage: null,
    sourceFigure: null,
    ...overrides,
  }
}

describe('groupTribologyRecordsByIonicLiquid', () => {
  it('groups one ionic liquid across different tribological systems in the same literature', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: '1',
        ionic_liquid: '[BMIM][BF4]',
        probe_material: 'Silica',
        substrate_material: 'Mica',
        cof: '0.08',
        source_page: 2,
      }),
      record({
        id: '2',
        ionic_liquid: '[BMIM][BF4]',
        probe_material: 'Steel',
        substrate_material: 'Titania',
        substrate_coating: 'None',
        load: '10 mN',
        cof: '0.15',
        source_figure: 'Fig. 4',
      }),
      record({
        id: '3',
        ionic_liquid: '[EMIM][TFSI]',
        probe_material: 'Gold',
        substrate_material: 'HOPG',
        cof: '0.03',
      }),
    ])

    expect(groups.map((group) => group.label)).toEqual(['[BMIM][BF4]', '[EMIM][TFSI]'])
    const bmim = groups[0]!
    expect(bmim.recordCount).toBe(2)
    expect(bmim.systemCount).toBe(2)
    expect(bmim.systems.map((system) => system.tribopairLabel)).toEqual([
      'Silica vs. Mica',
      'Steel vs. Titania',
    ])
    expect(bmim.systems[1]!.rows[0]!.conditions).toContainEqual({ label: 'Load', value: '10 mN' })
    expect(bmim.systems[1]!.rows[0]!.sourceLabel).toBe('Fig. 4')
  })

  it('counts weak candidates and rows needing review without splitting them from final rows', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'candidate-1',
        ionic_liquid: '[BMIM][BF4]',
        record_origin: 'weak_candidate',
        review_status: 'needs_review',
        confidence_tier: 'low',
        missing_fields: ['load', 'speed'],
        cof: '0.08',
      }),
      record({
        id: 'record-1',
        ionic_liquid: '[BMIM][BF4]',
        review_status: 'approved',
        cof: '0.09',
      }),
    ])

    expect(groups).toHaveLength(1)
    const bmim = groups[0]!
    expect(bmim).toMatchObject({
      label: '[BMIM][BF4]',
      recordCount: 2,
      weakCandidateCount: 1,
      needsReviewCount: 1,
    })
    expect(bmim.systems[0]!.rows.map((row) => row.reviewLabel)).toEqual([
      'Needs review',
      'Approved',
    ])
    expect(bmim.systems[0]!.rows[0]!.missingFieldLabels).toEqual(['load', 'speed'])
  })

  it('keeps unknown ionic-liquid rows visible in a dedicated group', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'unknown-1',
        ionic_liquid: '',
        lubricant_alias: null,
        cof: '0.20',
      }),
    ])

    expect(groups).toHaveLength(1)
    const unknown = groups[0]!
    expect(unknown.key).toBe('unknown-il')
    expect(unknown.label).toBe('Unknown IL')
    expect(unknown.recordCount).toBe(1)
  })

  it('collapses preview rows into a control strip when only potential varies', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'potential-1',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '-1 V',
        load: '10 nN',
        cof: '0.12',
      }),
      record({
        id: 'potential-2',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '+1 V',
        load: '10 nN',
        cof: '0.35',
      }),
    ])

    const strip = groups[0]!.systems[0]!.controlStrips[0]!
    expect(strip.variable).toBe('potential')
    expect(strip.summaryLabel).toBe('Potential response · 2 points')
    expect(strip.stableConditions).toContainEqual({ label: 'Load', value: '10 nN' })
    expect(strip.points.map((point) => [point.label, point.responseLabel])).toEqual([
      ['-1 V', '0.12'],
      ['+1 V', '0.35'],
    ])
    expect(groups[0]!.systems[0]!.looseRows).toHaveLength(0)
  })

  it('keeps preview rows loose when more than one control variable varies', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'multi-1',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '-1 V',
        load: '10 nN',
        cof: '0.12',
      }),
      record({
        id: 'multi-2',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '+1 V',
        load: '20 nN',
        cof: '0.35',
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips).toHaveLength(0)
    expect(groups[0]!.systems[0]!.looseRows).toHaveLength(2)
  })

  it('does not collapse preview rows when a secondary condition such as shear also varies', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'shear-multi-1',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '-1 V',
        shear_rate: '100 s-1',
        cof: '0.12',
      }),
      record({
        id: 'shear-multi-2',
        probe_material: 'Silica',
        substrate_material: 'Au(111)',
        potential: '+1 V',
        shear_rate: '500 s-1',
        cof: '0.35',
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips).toHaveLength(0)
    expect(groups[0]!.systems[0]!.looseRows).toHaveLength(2)
  })

  it('collapses preview rows into a shear control strip when shear is the only variable', () => {
    const groups = groupTribologyRecordsByIonicLiquid([
      record({
        id: 'shear-1',
        probe_material: 'Silica',
        substrate_material: 'Mica',
        shear_rate: '100 s-1',
        cof: '0.08',
      }),
      record({
        id: 'shear-2',
        probe_material: 'Silica',
        substrate_material: 'Mica',
        shear_rate: '500 s-1',
        cof: '0.15',
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips[0]!.variable).toBe('shear')
  })
})

describe('groupDatabaseRecordsByLiteratureLiquid', () => {
  it('merges the same ionic liquid inside one literature while keeping systems comparable', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 11,
        literatureId: 2022,
        lubricant: '[BMIM][BF4]',
        probeMaterial: 'Silica',
        substrateMaterial: 'Mica',
        cofValue: 0.04,
      }),
      databaseRecord({
        id: 12,
        literatureId: 2022,
        lubricant: '[BMIM][BF4]',
        probeMaterial: 'AFM tip',
        substrateMaterial: 'Gold',
        potential: '+0.5 V',
        cofValue: 0.2,
      }),
      databaseRecord({
        id: 13,
        literatureId: 2023,
        lubricant: '[BMIM][BF4]',
        probeMaterial: 'Steel',
        substrateMaterial: 'Disk',
        cofValue: 0.12,
      }),
    ])

    expect(groups).toHaveLength(2)
    const currentPaper = groups.find((group) => group.literatureId === 2022)!
    expect(currentPaper.label).toBe('[BMIM][BF4]')
    expect(currentPaper.recordCount).toBe(2)
    expect(currentPaper.systemCount).toBe(2)
    expect(currentPaper.systems.map((system) => system.tribopairLabel)).toEqual([
      'Silica vs. Mica',
      'AFM tip vs. Gold',
    ])
  })

  it('does not merge same-IL records when the top-level literature id is missing', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 21,
        literatureId: Number.NaN,
        literature: { id: 21, doi: '10.example/a', title: 'Paper A', journal: 'Journal', year: 2024 },
        lubricant: '[BMIM][BF4]',
      }),
      databaseRecord({
        id: 22,
        literatureId: Number.NaN,
        literature: { id: 22, doi: '10.example/b', title: 'Paper B', journal: 'Journal', year: 2025 },
        lubricant: '[BMIM][BF4]',
      }),
      databaseRecord({
        id: 23,
        literatureId: Number.NaN,
        literature: null,
        lubricant: '[BMIM][BF4]',
      }),
    ])

    expect(groups).toHaveLength(3)
    expect(groups.map((group) => group.recordCount)).toEqual([1, 1, 1])
  })

  it('collapses database records into a potential control strip when only potential varies', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 31,
        lubricant: '[EMIM][FAP]',
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '-1 V',
        loadValue: '10 nN',
        cofValue: 0.12,
      }),
      databaseRecord({
        id: 32,
        lubricant: '[EMIM][FAP]',
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '0 V',
        loadValue: '10 nN',
        cofValue: 0.23,
      }),
      databaseRecord({
        id: 33,
        lubricant: '[EMIM][FAP]',
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '+1 V',
        loadValue: '10 nN',
        cofValue: 0.35,
      }),
    ])

    const system = groups[0]!.systems[0]!
    expect(system.controlStrips).toHaveLength(1)
    expect(system.looseRecords).toHaveLength(0)
    expect(system.controlStrips[0]!.variable).toBe('potential')
    expect(system.controlStrips[0]!.points.map((point) => [point.label, point.responseLabel])).toEqual([
      ['-1 V', '0.1200'],
      ['0 V', '0.2300'],
      ['+1 V', '0.3500'],
    ])
  })

  it('collapses database records into non-potential control strips such as load and water', () => {
    const loadGroups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 41,
        probeMaterial: 'Steel',
        substrateMaterial: 'Disk',
        loadValue: '5 N',
        speedValue: '10 mm/s',
        cofValue: 0.08,
      }),
      databaseRecord({
        id: 42,
        probeMaterial: 'Steel',
        substrateMaterial: 'Disk',
        loadValue: '10 N',
        speedValue: '10 mm/s',
        cofValue: 0.11,
      }),
    ])
    const waterGroups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 51,
        probeMaterial: 'Silica',
        substrateMaterial: 'Mica',
        waterContent: 'dry',
        cofValue: 0.04,
      }),
      databaseRecord({
        id: 52,
        probeMaterial: 'Silica',
        substrateMaterial: 'Mica',
        waterContent: '50 ppm',
        cofValue: 0.09,
      }),
    ])

    expect(loadGroups[0]!.systems[0]!.controlStrips[0]!.variable).toBe('load')
    expect(waterGroups[0]!.systems[0]!.controlStrips[0]!.variable).toBe('water')
  })

  it('keeps database records as loose rows when multiple control variables vary', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 61,
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '-1 V',
        loadValue: '10 nN',
        cofValue: 0.12,
      }),
      databaseRecord({
        id: 62,
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '+1 V',
        loadValue: '20 nN',
        cofValue: 0.35,
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips).toHaveLength(0)
    expect(groups[0]!.systems[0]!.looseRecords).toHaveLength(2)
  })

  it('does not collapse database records when potential and shear both vary', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 71,
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '-1 V',
        shearRate: '100 s-1',
        cofValue: 0.12,
      }),
      databaseRecord({
        id: 72,
        probeMaterial: 'Silica',
        substrateMaterial: 'Au(111)',
        potential: '+1 V',
        shearRate: '500 s-1',
        cofValue: 0.35,
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips).toHaveLength(0)
    expect(groups[0]!.systems[0]!.looseRecords).toHaveLength(2)
  })

  it('collapses database records into a shear control strip when shear is the only variable', () => {
    const groups = groupDatabaseRecordsByLiteratureLiquid([
      databaseRecord({
        id: 81,
        probeMaterial: 'Silica',
        substrateMaterial: 'Mica',
        shearRate: '100 s-1',
        cofValue: 0.08,
      }),
      databaseRecord({
        id: 82,
        probeMaterial: 'Silica',
        substrateMaterial: 'Mica',
        shearRate: '500 s-1',
        cofValue: 0.15,
      }),
    ])

    expect(groups[0]!.systems[0]!.controlStrips[0]!.variable).toBe('shear')
  })
})
