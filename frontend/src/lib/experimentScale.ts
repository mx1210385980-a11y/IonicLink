export type ExperimentScaleTone = 'macro' | 'nano' | 'micro' | 'unknown'

const MACRO_SCALE_ALIASES = new Set([
  'macro',
  'macroscopic',
  'macroscale',
  'macro_scale',
  'macro_performance',
])

const NANO_SCALE_ALIASES = new Set([
  'afm',
  'ffm',
  'nano',
  'nanoscopic',
  'nanoscale',
  'nano_scale',
  'nanotribology',
  'nanoscale_afm',
  'afm_surface_response',
])

const MICRO_SCALE_ALIASES = new Set([
  'micro',
  'microscopic',
  'microscale',
  'micro_scale',
])

function normalizeScaleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[‐‑‒–—-]+/g, '_')
    .replace(/\s+/g, '_')
}

export function canonicalExperimentScaleValue(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) return ''

  if (raw.includes('宏观')) return 'macroscale'
  if (raw.includes('纳米')) return 'nanoscale'
  if (raw.includes('微观')) return 'microscale'

  const key = normalizeScaleKey(raw)
  if (MACRO_SCALE_ALIASES.has(key)) return 'macroscale'
  if (NANO_SCALE_ALIASES.has(key)) return 'nanoscale'
  if (MICRO_SCALE_ALIASES.has(key)) return 'microscale'
  if (key === 'unknown' || key === 'unspecified') return 'unknown'

  return raw
}

export function experimentScaleTone(value: string | null | undefined): ExperimentScaleTone {
  const canonical = canonicalExperimentScaleValue(value)
  if (canonical === 'macroscale') return 'macro'
  if (canonical === 'nanoscale') return 'nano'
  if (canonical === 'microscale') return 'micro'
  return 'unknown'
}

export function experimentScaleLabel(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  const canonical = canonicalExperimentScaleValue(raw)
  if (canonical === 'macroscale') return '宏观摩擦'
  if (canonical === 'nanoscale') return '纳米摩擦'
  if (canonical === 'microscale') return '微观摩擦'
  if (canonical === 'unknown') return '未识别尺度'
  return raw || '未记录'
}

export function experimentScaleSearchText(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  const canonical = canonicalExperimentScaleValue(raw)
  return [raw, canonical, experimentScaleLabel(raw)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function experimentScaleBadgeClass(value: string | null | undefined): string {
  const tone = experimentScaleTone(value)
  if (tone === 'macro') {
    return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300'
  }
  if (tone === 'nano') {
    return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300'
  }
  if (tone === 'micro') {
    return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300'
  }
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
}
