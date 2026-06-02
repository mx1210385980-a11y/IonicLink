import { formatTribopairLabel, type RecordResponse, type TribologyData } from '@/lib/api'

export type GroupedCondition = {
  label: string
  value: string
}

export type GroupedTribologyRow = {
  id: string
  record: TribologyData
  cof: string
  wearRate: string
  sourceLabel: string
  reviewLabel: string
  needsReview: boolean
  weakCandidate: boolean
  confidenceTier: string
  missingFieldLabels: string[]
  conditions: GroupedCondition[]
}

export type GroupedTribologySystem = {
  key: string
  tribopairLabel: string
  rows: GroupedTribologyRow[]
  controlStrips: GroupedControlStrip<TribologyData>[]
  looseRows: GroupedTribologyRow[]
}

export type GroupedTribologyLiquid = {
  key: string
  label: string
  cation: string
  anion: string
  recordCount: number
  systemCount: number
  needsReviewCount: number
  weakCandidateCount: number
  records: TribologyData[]
  systems: GroupedTribologySystem[]
}

export type GroupedDatabaseRecordSystem = {
  key: string
  tribopairLabel: string
  records: RecordResponse[]
  controlStrips: GroupedControlStrip<RecordResponse>[]
  looseRecords: RecordResponse[]
}

export type GroupedDatabaseRecordLiquid = {
  key: string
  label: string
  cation: string
  anion: string
  literatureId: number | null
  literatureTitle: string
  literatureMeta: string
  recordCount: number
  systemCount: number
  systems: GroupedDatabaseRecordSystem[]
  records: RecordResponse[]
}

export type ControlVariableKey =
  | 'potential'
  | 'load'
  | 'speed'
  | 'shear'
  | 'temperature'
  | 'water'
  | 'concentration'
  | 'film'
  | 'layer'
  | 'duration'

export type ControlPointTone = 'low' | 'medium' | 'high' | 'unknown'

export type GroupedControlPoint<TRecord> = {
  key: string
  value: string
  label: string
  records: TRecord[]
  count: number
  responseLabel: string
  tone: ControlPointTone
}

export type GroupedControlStrip<TRecord> = {
  key: string
  variable: ControlVariableKey
  variableLabel: string
  systemLabel: string
  summaryLabel: string
  stableConditions: GroupedCondition[]
  points: GroupedControlPoint<TRecord>[]
  records: TRecord[]
}

type ControlAccessor<TRecord> = {
  key: ControlVariableKey
  label: string
  getValue: (record: TRecord) => string
  getResponse: (record: TRecord) => string
  getResponseNumber: (record: TRecord) => number | null
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/[^\w[\],()+-]+/g, '-')
}

function comparableValue(value: unknown) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ')
}

function asAnyRecord(record: unknown): Record<string, any> {
  return record && typeof record === 'object' ? record as Record<string, any> : {}
}

function firstClean(...values: unknown[]) {
  for (const value of values) {
    const cleaned = clean(value)
    if (cleaned) return cleaned
  }
  return ''
}

function responseTone(value: number | null): ControlPointTone {
  if (value == null || Number.isNaN(value)) return 'unknown'
  if (value < 0.1) return 'low'
  if (value < 0.3) return 'medium'
  return 'high'
}

function parseResponseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = clean(value)
  if (!text) return null
  const match = text.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function formatResponseNumber(value: number) {
  if (Math.abs(value) >= 1) return Number(value.toFixed(3)).toString()
  return value.toFixed(4)
}

function responseLabelForValues<TRecord>(records: TRecord[], accessor: ControlAccessor<TRecord>) {
  const numbers = records
    .map((record) => accessor.getResponseNumber(record))
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (numbers.length > 1) {
    const min = Math.min(...numbers)
    const max = Math.max(...numbers)
    if (Math.abs(max - min) > 0.000001) return `${formatResponseNumber(min)}-${formatResponseNumber(max)} · n=${records.length}`
  }
  const first = firstClean(records[0] ? accessor.getResponse(records[0]) : '')
  if (records.length > 1) return `${first || '--'} · n=${records.length}`
  return first || '--'
}

function numericSortValue(value: string) {
  if (/ocp/i.test(value)) return 0
  const match = value.match(/[+-]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function sortControlLabels(left: string, right: string) {
  const leftNumber = numericSortValue(left)
  const rightNumber = numericSortValue(right)
  if (leftNumber != null && rightNumber != null && leftNumber !== rightNumber) return leftNumber - rightNumber
  return left.localeCompare(right, undefined, { numeric: true })
}

function liquidLabel(record: TribologyData) {
  return clean(record.ionic_liquid_display)
    || clean(record.ionic_liquid)
    || clean(record.lubricant_alias)
    || 'Unknown IL'
}

function liquidKey(label: string) {
  if (!label || label.toLowerCase() === 'unknown il') return 'unknown-il'
  return normalizeKey(label)
}

function recordLiquidLabel(record: RecordResponse) {
  return clean(record.ionicLiquidDisplay)
    || clean(record.lubricant)
    || clean(record.lubricantAlias)
    || 'Unknown IL'
}

function recordLiteratureTitle(record: RecordResponse) {
  return clean(record.literature?.title) || `Literature ${record.literatureId || '--'}`
}

function recordLiteratureMeta(record: RecordResponse) {
  const journal = clean(record.literature?.journal)
  const year = record.literature?.year ? clean(record.literature.year) : ''
  if (journal && year) return `${journal} (${year})`
  return journal || year || 'Open in library'
}

function recordLiteratureKey(record: RecordResponse) {
  const directId = Number(record.literatureId)
  if (Number.isFinite(directId) && directId > 0) return `id:${Math.trunc(directId)}`
  const nestedId = Number(record.literature?.id)
  if (Number.isFinite(nestedId) && nestedId > 0) return `id:${Math.trunc(nestedId)}`
  const doi = clean(record.literature?.doi)
  if (doi) return `doi:${normalizeKey(doi)}`
  const title = clean(record.literature?.title)
  if (title) return `title:${normalizeKey(title)}`
  return `record:${record.id}`
}

function recordTribopairLabel(record: RecordResponse) {
  return clean(record.tribopairLabel) || formatTribopairLabel({
    probeMaterial: record.probeMaterial,
    substrateMaterial: record.substrateMaterial,
    substrateCoating: record.substrateCoating,
    materialName: record.materialName,
  })
}

export function recordNeedsGroupedReview(record: TribologyData) {
  const reviewStatus = clean(record.review_status).toLowerCase()
  const origin = clean(record.record_origin).toLowerCase()
  const confidenceTier = clean(record.confidence_tier || record.confidenceTier).toLowerCase()
  const missingFields = record.missing_fields || record.missingFields || []

  return (
    reviewStatus === 'needs_review'
    || reviewStatus === 'flagged'
    || origin === 'weak_candidate'
    || confidenceTier === 'low'
    || missingFields.length > 0
  )
}

export function reviewLabelForRecord(record: TribologyData) {
  const status = clean(record.review_status).toLowerCase()
  if (status === 'approved' || status === 'published') return 'Approved'
  if (status === 'flagged') return 'Flagged'
  if (recordNeedsGroupedReview(record)) return 'Needs review'
  return 'Ready'
}

export function comparisonConditionsForRecord(record: TribologyData): GroupedCondition[] {
  const pairs: Array<[string, unknown]> = [
    ['Load', record.load || record.normal_load],
    ['Speed', record.speed],
    ['Shear', record.shear_rate],
    ['Temp', record.temperature],
    ['Potential', record.potential],
    ['Water', record.water_content],
    ['Conc.', record.concentration],
    ['Film', record.film_thickness],
    ['Layer', record.layer_spacing_delta],
    ['Duration', record.test_duration],
  ]

  return pairs
    .map(([label, value]) => ({ label, value: clean(value) }))
    .filter((item) => item.value)
}

function previewControlAccessors(): ControlAccessor<TribologyData>[] {
  return [
    { key: 'potential', label: 'Potential', getValue: (record) => clean(record.potential), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'load', label: 'Load', getValue: (record) => firstClean(record.load, record.normal_load), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'speed', label: 'Speed', getValue: (record) => clean(record.speed), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'shear', label: 'Shear', getValue: (record) => clean(record.shear_rate), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'temperature', label: 'Temperature', getValue: (record) => clean(record.temperature), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'water', label: 'Water', getValue: (record) => clean(record.water_content), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'concentration', label: 'Concentration', getValue: (record) => firstClean(record.concentration, record.mol_ratio), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'film', label: 'Film', getValue: (record) => firstClean(record.film_thickness, record.residual_film_thickness_d), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'layer', label: 'Layer', getValue: (record) => clean(record.layer_spacing_delta), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
    { key: 'duration', label: 'Duration', getValue: (record) => clean(record.test_duration), getResponse: (record) => clean(record.cof), getResponseNumber: (record) => parseResponseNumber(record.cof) },
  ]
}

function databaseResponseLabel(record: RecordResponse) {
  return clean(record.cofRaw) || (record.cofValue != null ? Number(record.cofValue).toFixed(4) : '')
}

function databaseControlAccessors(): ControlAccessor<RecordResponse>[] {
  return [
    { key: 'potential', label: 'Potential', getValue: (record) => clean(record.potential), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'load', label: 'Load', getValue: (record) => firstClean(record.loadValue, record.loadRaw), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'speed', label: 'Speed', getValue: (record) => clean(record.speedValue), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'shear', label: 'Shear', getValue: (record) => clean(record.shearRate), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'temperature', label: 'Temperature', getValue: (record) => clean(record.temperature), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'water', label: 'Water', getValue: (record) => clean(record.waterContent), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'concentration', label: 'Concentration', getValue: (record) => firstClean(asAnyRecord(record).concentration, record.molRatio), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'film', label: 'Film', getValue: (record) => firstClean(record.filmThickness, record.residualFilmThicknessD), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'layer', label: 'Layer', getValue: (record) => clean(record.layerSpacingDelta), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
    { key: 'duration', label: 'Duration', getValue: (record) => firstClean(asAnyRecord(record).testDuration, asAnyRecord(record).test_duration), getResponse: databaseResponseLabel, getResponseNumber: (record) => parseResponseNumber(record.cofValue ?? record.cofRaw) },
  ]
}

function buildStableConditions<TRecord>(records: TRecord[], accessors: ControlAccessor<TRecord>[], activeKey: ControlVariableKey): GroupedCondition[] {
  const first = records[0]
  if (!first) return []
  return accessors
    .filter((accessor) => accessor.key !== activeKey)
    .map((accessor) => {
      const value = accessor.getValue(first)
      const stable = value && records.every((record) => comparableValue(accessor.getValue(record)) === comparableValue(value))
      return stable ? { label: accessor.label, value } : null
    })
    .filter((item): item is GroupedCondition => Boolean(item))
}

function controlSignature<TRecord>(record: TRecord, accessors: ControlAccessor<TRecord>[], activeKey: ControlVariableKey) {
  return accessors
    .filter((accessor) => accessor.key !== activeKey)
    .map((accessor) => `${accessor.key}:${comparableValue(accessor.getValue(record))}`)
    .join('|')
}

function buildControlStrips<TRecord>(
  records: TRecord[],
  accessors: ControlAccessor<TRecord>[],
  systemLabel: string,
): { controlStrips: GroupedControlStrip<TRecord>[], looseRecords: TRecord[] } {
  const used = new Set<TRecord>()
  const controlStrips: GroupedControlStrip<TRecord>[] = []

  for (const accessor of accessors) {
    const buckets = new Map<string, TRecord[]>()
    for (const record of records) {
      if (used.has(record)) continue
      const value = accessor.getValue(record)
      if (!value) continue
      const signature = controlSignature(record, accessors, accessor.key)
      const bucket = buckets.get(signature) || []
      bucket.push(record)
      buckets.set(signature, bucket)
    }

    const candidateBuckets = Array.from(buckets.values()).sort((left, right) => right.length - left.length)
    for (const bucket of candidateBuckets) {
      const values = Array.from(new Set(bucket.map((record) => comparableValue(accessor.getValue(record))).filter(Boolean)))
      if (bucket.length < 2 || values.length < 2) continue

      const pointMap = new Map<string, TRecord[]>()
      for (const record of bucket) {
        const label = accessor.getValue(record)
        const key = comparableValue(label)
        const pointRecords = pointMap.get(key) || []
        pointRecords.push(record)
        pointMap.set(key, pointRecords)
      }

      const points = Array.from(pointMap.entries())
        .map(([key, pointRecords]) => {
          const value = accessor.getValue(pointRecords[0]!)
          const numbers = pointRecords
            .map((record) => accessor.getResponseNumber(record))
            .filter((item): item is number => item != null)
          const toneValue = numbers.length ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length : null
          return {
            key,
            value,
            label: value,
            records: pointRecords,
            count: pointRecords.length,
            responseLabel: responseLabelForValues(pointRecords, accessor),
            tone: responseTone(toneValue),
          }
        })
        .sort((left, right) => sortControlLabels(left.label, right.label))

      const stripRecords = points.flatMap((point) => point.records)
      stripRecords.forEach((record) => used.add(record))
      controlStrips.push({
        key: `${accessor.key}:${controlStrips.length}:${points.map((point) => point.key).join(',')}`,
        variable: accessor.key,
        variableLabel: accessor.label,
        systemLabel,
        summaryLabel: `${accessor.label} response · ${points.length} points`,
        stableConditions: buildStableConditions(bucket, accessors, accessor.key),
        points,
        records: stripRecords,
      })
    }
  }

  return {
    controlStrips,
    looseRecords: records.filter((record) => !used.has(record)),
  }
}

export function systemKeyForRecord(record: TribologyData) {
  return [
    formatTribopairLabel({
      probeMaterial: record.probe_material,
      substrateMaterial: record.substrate_material,
      substrateCoating: record.substrate_coating,
      materialName: record.material_name,
    }),
    clean(record.base_oil),
    clean(record.contact_type),
    clean(record.experiment_scale),
    clean(record.experiment_method),
    clean(record.measurement_type),
    clean(record.regime),
  ].map(normalizeKey).join('|')
}

function sourceLabelForRecord(record: TribologyData) {
  const figure = clean(record.source_figure)
  if (figure) return figure
  const source = clean(record.source)
  if (source) return source
  if (record.source_page) return `Page ${record.source_page}`
  return '--'
}

function groupedRow(record: TribologyData, index: number): GroupedTribologyRow {
  return {
    id: clean(record.id) || `row-${index + 1}`,
    record,
    cof: clean(record.cof) || '--',
    wearRate: clean(record.wear_rate) || '--',
    sourceLabel: sourceLabelForRecord(record),
    reviewLabel: reviewLabelForRecord(record),
    needsReview: recordNeedsGroupedReview(record),
    weakCandidate: clean(record.record_origin).toLowerCase() === 'weak_candidate',
    confidenceTier: clean(record.confidence_tier || record.confidenceTier),
    missingFieldLabels: record.missing_fields || record.missingFields || [],
    conditions: comparisonConditionsForRecord(record),
  }
}

export function groupTribologyRecordsByIonicLiquid(records: TribologyData[]): GroupedTribologyLiquid[] {
  const groupMap = new Map<string, GroupedTribologyLiquid>()

  records.forEach((record, index) => {
    const label = liquidLabel(record)
    const key = liquidKey(label)
    const group = groupMap.get(key) || {
      key,
      label,
      cation: clean(record.cation),
      anion: clean(record.anion),
      recordCount: 0,
      systemCount: 0,
      needsReviewCount: 0,
      weakCandidateCount: 0,
      records: [],
      systems: [],
    }

    group.records.push(record)
    group.recordCount += 1
    if (recordNeedsGroupedReview(record)) group.needsReviewCount += 1
    if (clean(record.record_origin).toLowerCase() === 'weak_candidate') group.weakCandidateCount += 1
    if (!group.cation && record.cation) group.cation = clean(record.cation)
    if (!group.anion && record.anion) group.anion = clean(record.anion)

    const systemKey = systemKeyForRecord(record)
    let system = group.systems.find((item) => item.key === systemKey)
    if (!system) {
      system = {
        key: systemKey,
        tribopairLabel: formatTribopairLabel({
          probeMaterial: record.probe_material,
          substrateMaterial: record.substrate_material,
          substrateCoating: record.substrate_coating,
          materialName: record.material_name,
        }),
        rows: [],
        controlStrips: [],
        looseRows: [],
      }
      group.systems.push(system)
    }
    system.rows.push(groupedRow(record, index))
    group.systemCount = group.systems.length
    groupMap.set(key, group)
  })

  const groups = Array.from(groupMap.values())
  for (const group of groups) {
    for (const system of group.systems) {
      const stripResult = buildControlStrips(system.rows.map((row) => row.record), previewControlAccessors(), system.tribopairLabel)
      system.controlStrips = stripResult.controlStrips
      const looseRecords = new Set(stripResult.looseRecords)
      system.looseRows = system.rows.filter((row) => looseRecords.has(row.record))
    }
  }

  return groups.sort((left, right) => {
    if (left.key === 'unknown-il') return 1
    if (right.key === 'unknown-il') return -1
    return right.recordCount - left.recordCount || left.label.localeCompare(right.label)
  })
}

function databaseSystemKeyForRecord(record: RecordResponse) {
  return [
    recordTribopairLabel(record),
    clean(record.experimentScale),
    clean(record.experimentMethod),
    clean(record.measurementType),
    clean(record.regime),
  ].map(normalizeKey).join('|')
}

export function groupDatabaseRecordsByLiteratureLiquid(records: RecordResponse[]): GroupedDatabaseRecordLiquid[] {
  const groupMap = new Map<string, GroupedDatabaseRecordLiquid>()

  for (const record of records) {
    const label = recordLiquidLabel(record)
    const literatureId = Number.isFinite(Number(record.literatureId)) ? Number(record.literatureId) : null
    const key = `${recordLiteratureKey(record)}|${liquidKey(label)}`
    const group = groupMap.get(key) || {
      key,
      label,
      cation: clean(record.cation),
      anion: clean(record.anion),
      literatureId,
      literatureTitle: recordLiteratureTitle(record),
      literatureMeta: recordLiteratureMeta(record),
      recordCount: 0,
      systemCount: 0,
      systems: [],
      records: [],
    }

    group.records.push(record)
    group.recordCount += 1
    if (!group.cation && record.cation) group.cation = clean(record.cation)
    if (!group.anion && record.anion) group.anion = clean(record.anion)

    const systemKey = databaseSystemKeyForRecord(record)
    let system = group.systems.find((item) => item.key === systemKey)
    if (!system) {
      system = {
        key: systemKey,
        tribopairLabel: recordTribopairLabel(record),
        records: [],
        controlStrips: [],
        looseRecords: [],
      }
      group.systems.push(system)
    }
    system.records.push(record)
    group.systemCount = group.systems.length
    groupMap.set(key, group)
  }

  const groups = Array.from(groupMap.values())
  for (const group of groups) {
    for (const system of group.systems) {
      const stripResult = buildControlStrips(system.records, databaseControlAccessors(), system.tribopairLabel)
      system.controlStrips = stripResult.controlStrips
      system.looseRecords = stripResult.looseRecords
    }
  }

  return groups.sort((left, right) => {
    const literatureOrder = recordLiteratureTitle(left.records[0]!).localeCompare(recordLiteratureTitle(right.records[0]!))
    return literatureOrder || right.recordCount - left.recordCount || left.label.localeCompare(right.label)
  })
}
