import type { ModelCleaningMatrixRow } from '@/lib/api'
import type { SensitivityItem } from './featureSemantics'
import { resolveFeatureForAvailable } from './featureSemantics'

export function numericValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function pairwisePearson(
  values: Array<number | null>,
  targetValues: Array<number | null>,
): number | null {
  const pairs: Array<[number, number]> = []
  for (let index = 0; index < values.length; index += 1) {
    const left = values[index]
    const right = targetValues[index]
    if (left == null || right == null) continue
    pairs.push([left, right])
  }

  if (pairs.length < 3) return null

  const xs = pairs.map((pair) => pair[0])
  const ys = pairs.map((pair) => pair[1])
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length

  let numerator = 0
  let sumSquareX = 0
  let sumSquareY = 0
  for (let index = 0; index < pairs.length; index += 1) {
    const dx = xs[index]! - meanX
    const dy = ys[index]! - meanY
    numerator += dx * dy
    sumSquareX += dx * dx
    sumSquareY += dy * dy
  }

  if (sumSquareX === 0 || sumSquareY === 0) return null
  return numerator / Math.sqrt(sumSquareX * sumSquareY)
}

export function normalizeSensitivityItems(
  items: SensitivityItem[],
  availableSet: Set<string>,
  availableColumns: string[],
): SensitivityItem[] {
  const seen = new Set<string>()
  return items
    .map((item) => {
      const resolvedFeature = resolveFeatureForAvailable(item.feature, availableSet, availableColumns) || item.feature
      return {
        ...item,
        feature: resolvedFeature,
        abs_correlation: Number(Math.abs(item.correlation).toFixed(4)),
      }
    })
    .filter((item) => {
      if (!item.feature || seen.has(item.feature)) return false
      seen.add(item.feature)
      return true
    })
    .slice(0, 5)
}

export function computeRowwiseSensitivity(
  rows: ModelCleaningMatrixRow[],
  targetColumn: string,
  availableColumns: string[],
): SensitivityItem[] {
  if (!rows.length || !targetColumn) return []
  const targetValues = rows.map((row) => numericValue(row[targetColumn]))
  return availableColumns
    .map((feature) => {
      const featureValues = rows.map((row) => numericValue(row[feature]))
      const correlation = pairwisePearson(featureValues, targetValues)
      if (correlation == null) return null
      return {
        feature,
        correlation: Number(correlation.toFixed(4)),
        abs_correlation: Number(Math.abs(correlation).toFixed(4)),
      }
    })
    .filter((item): item is SensitivityItem => Boolean(item))
    .sort((left, right) => right.abs_correlation - left.abs_correlation)
    .slice(0, 5)
}

export function formatMetricCompact(value: number, digits = 3) {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}
