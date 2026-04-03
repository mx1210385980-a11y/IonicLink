export function formatColumnLabel(column: string) {
  return column
    .split('_')
    .filter(Boolean)
    .map((token) => {
      if (token.toUpperCase() === 'COF') return 'COF'
      if (token.toUpperCase() === 'MU') return 'μ'
      if (token.toUpperCase() === 'TPSA') return 'TPSA'
      if (token.toUpperCase() === 'MOLLOGP') return 'MolLogP'
      return token.charAt(0).toUpperCase() + token.slice(1)
    })
    .join(' ')
}

export function formatMetric(value: number | null | undefined, digits = 4) {
  if (value == null || Number.isNaN(Number(value))) return '--'
  return Number(value).toFixed(digits).replace(/\.?0+$/, '')
}

export function formatCoverage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}

export function correlationCellStyle(value: number | null) {
  if (value == null) {
    return {
      backgroundColor: 'rgba(226,232,240,0.55)',
      color: '#64748b',
    }
  }

  const strength = Math.min(Math.abs(value), 1)
  if (value >= 0) {
    return {
      backgroundColor: `rgba(239,68,68,${0.14 + strength * 0.55})`,
      color: strength > 0.5 ? '#ffffff' : '#7f1d1d',
    }
  }

  return {
    backgroundColor: `rgba(59,130,246,${0.14 + strength * 0.55})`,
    color: strength > 0.5 ? '#ffffff' : '#1d4ed8',
  }
}
