export type ManualDiffusionCoefficientField = 'd_total' | 'd_cation' | 'd_anion'

export type ManualDiffusionEstimateForm = {
  systemName?: string
  ionicLiquid?: string
  diffusingIon?: string
  coefficientField: ManualDiffusionCoefficientField
  coefficientValue?: string
  dUnit?: string
  sourcePage?: string
  sourceFigure?: string
  evidence?: string
  temperatureValue?: string
  confinementScaleValue?: string
  confinementScaleUnit?: string
}

export type ManualDiffusionCandidatePayload = {
  systemName?: string
  ionicLiquid?: string
  diffusingIon?: string
  dTotal?: number
  dCation?: number
  dAnion?: number
  dUnit: string
  sourcePage?: number
  sourceFigure?: string
  evidence?: string
  temperatureValue?: number
  confinementScaleValue?: number
  confinementScaleUnit?: string
}

function clean(value: unknown) {
  return String(value ?? '').trim()
}

function parseRequiredNumber(value: string, label: string) {
  const normalized = clean(value).replace(/,/g, '')
  const parsed = Number(normalized)
  if (!normalized || !Number.isFinite(parsed)) {
    throw new Error(`${label}需要填写数字`)
  }
  return parsed
}

function parseOptionalNumber(value: string | undefined) {
  const normalized = clean(value).replace(/,/g, '')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalPage(value: string | undefined) {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return undefined
  return Math.max(1, Math.floor(parsed))
}

export function buildManualDiffusionCandidatePayload(form: ManualDiffusionEstimateForm): ManualDiffusionCandidatePayload {
  const coefficientValue = parseRequiredNumber(form.coefficientValue || '', '扩散值')
  const dUnit = clean(form.dUnit)
  if (!dUnit) {
    throw new Error('单位不能为空')
  }

  const payload: ManualDiffusionCandidatePayload = {
    dUnit,
  }
  const systemName = clean(form.systemName)
  const ionicLiquid = clean(form.ionicLiquid)
  const diffusingIon = clean(form.diffusingIon)
  const sourceFigure = clean(form.sourceFigure)
  const evidence = clean(form.evidence)
  const confinementScaleUnit = clean(form.confinementScaleUnit)
  const sourcePage = parseOptionalPage(form.sourcePage)
  const temperatureValue = parseOptionalNumber(form.temperatureValue)
  const confinementScaleValue = parseOptionalNumber(form.confinementScaleValue)

  if (systemName) payload.systemName = systemName
  if (ionicLiquid) payload.ionicLiquid = ionicLiquid
  if (diffusingIon) payload.diffusingIon = diffusingIon
  if (sourcePage !== undefined) payload.sourcePage = sourcePage
  if (sourceFigure) payload.sourceFigure = sourceFigure
  if (evidence) payload.evidence = evidence
  if (temperatureValue !== undefined) payload.temperatureValue = temperatureValue
  if (confinementScaleValue !== undefined) payload.confinementScaleValue = confinementScaleValue
  if (confinementScaleUnit) payload.confinementScaleUnit = confinementScaleUnit

  if (form.coefficientField === 'd_cation') {
    payload.dCation = coefficientValue
  } else if (form.coefficientField === 'd_anion') {
    payload.dAnion = coefficientValue
  } else {
    payload.dTotal = coefficientValue
  }

  return payload
}
