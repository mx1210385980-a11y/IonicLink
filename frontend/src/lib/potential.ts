function formatVoltage(value: number, explicitPlus = false): string {
  const formatted = Number.isInteger(value)
    ? String(value)
    : Number(value.toPrecision(6)).toString()
  return `${explicitPlus && value > 0 ? '+' : ''}${formatted} V`
}

function normalizeReference(reference: string): string {
  const ref = String(reference || '').trim().replace(/^[([{]+/, '').replace(/[\])}.,;:]+$/, '')
  const lower = ref.toLowerCase()
  if (!ref) return ''
  if (/\b(ocp|ocv|open[-\s]*circuit(?:\s+potential)?)\b/i.test(ref)) return 'OCP'
  if (/^ag\s*\/\s*agcl$/i.test(ref)) return 'Ag/AgCl'
  if (lower === 'sce') return 'SCE'
  if (lower === 'she') return 'SHE'
  if (lower === 'pt') return 'Pt'
  return ref
}

function extractPotentialReference(text: string): { reference: string; explicitOcp: boolean } {
  const explicitOcp = /\b(ocp|ocv|open[-\s]*circuit(?:\s+potential)?)\b/i.test(text)
  const refMatch = text.match(
    /(?:vs\.?|versus|relative\s+to|with\s+respect\s+to)\s+(OCP|OCV|open[-\s]*circuit(?:\s+potential)?|Ag\s*\/\s*AgCl|SCE|SHE|Pt|[A-Za-z][A-Za-z0-9/+.-]{1,18})/i,
  )
  if (refMatch?.[1]) {
    return { reference: normalizeReference(refMatch[1]), explicitOcp }
  }

  const parenMatch = text.match(/\((OCP|OCV|open[-\s]*circuit(?:\s+potential)?|Ag\s*\/\s*AgCl|SCE|SHE|Pt)\)/i)
  if (parenMatch?.[1]) {
    return { reference: normalizeReference(parenMatch[1]), explicitOcp }
  }

  if (explicitOcp) return { reference: 'OCP', explicitOcp: true }
  return { reference: '', explicitOcp: false }
}

export function normalizePotentialDisplayText(input: string | number | null | undefined): string {
  if (input == null) return ''

  if (typeof input === 'number') {
    return Number.isFinite(input) ? formatVoltage(input) : ''
  }

  let text = String(input)
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/＋/g, '+')
    .replace(/\s+/g, ' ')

  if (!text) return ''

  if (/^(?:at\s+(?:the\s+)?)?(?:OCP|OCV|open[-\s]*circuit(?:\s+potential)?)$/i.test(text)) {
    return '0 V vs OCP'
  }

  const offsetMatch = text.match(
    /([+-]?\d+(?:\.\d+)?)\s*mV\s*(below|above)\s+(?:the\s+)?(?:OCP|OCV|open[-\s]*circuit(?:\s+potential)?)/i,
  )
  if (offsetMatch?.[1] && offsetMatch[2]) {
    const magnitude = Number(offsetMatch[1]) / 1000
    const signed = offsetMatch[2].toLowerCase() === 'below' ? -Math.abs(magnitude) : Math.abs(magnitude)
    return `${formatVoltage(signed, signed > 0)} vs OCP`
  }

  const { reference, explicitOcp } = extractPotentialReference(text)
  const voltageMatch = text.match(/([+-]?\d+(?:[\.:]\d+)?)\s*(mV|millivolts?|V|volts?)\b/i)
  if (voltageMatch?.[1] && voltageMatch[2]) {
    const rawNumber = voltageMatch[1].replace(':', '.')
    let numeric = Number(rawNumber)
    if (/^(mv|milli)/i.test(voltageMatch[2])) {
      numeric /= 1000
    }
    const potential = formatVoltage(numeric, rawNumber.startsWith('+'))
    if (reference) {
      const ocpSuffix = explicitOcp && reference !== 'OCP' ? ' (OCP)' : ''
      return `${potential} vs ${reference}${ocpSuffix}`
    }
    return potential
  }

  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    return formatVoltage(Number(text), text.startsWith('+'))
  }

  text = text.replace(/\s*\((OCP|OCV)\)\s*$/i, ' vs OCP')
  return text
}
