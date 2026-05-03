type IonicLiquidAliasEntry = {
  canonical: string
  searchTerms: string[]
}

type IonicLiquidEvidenceParts = {
  raw: string
  cationRaw: string
  anionRaw: string
  cationKey: string
  anionKey: string
}

const IONIC_LIQUID_CATION_MEMORY: Record<string, IonicLiquidAliasEntry> = {
  ea: {
    canonical: 'ethylammonium',
    searchTerms: ['ethylammonium', 'ethyl ammonium'],
  },
  bmim: {
    canonical: '1-butyl-3-methylimidazolium',
    searchTerms: ['BMIM', '1-butyl-3-methylimidazolium', 'butylmethylimidazolium'],
  },
  pa: {
    canonical: 'propylammonium',
    searchTerms: ['propylammonium', 'propyl ammonium'],
  },
  emim: {
    canonical: '1-ethyl-3-methylimidazolium',
    searchTerms: ['EMIM', '1-ethyl-3-methylimidazolium', 'ethylmethylimidazolium'],
  },
  hmim: {
    canonical: '1-hexyl-3-methylimidazolium',
    searchTerms: ['HMIM', '1-hexyl-3-methylimidazolium', 'hexylmethylimidazolium'],
  },
  pyr14: {
    canonical: 'N-methyl-N-butylpyrrolidinium',
    searchTerms: [
      'Pyr14',
      'Py14',
      'Py1,4',
      'Py1;4',
      'P14',
      'N-methyl-N-butylpyrrolidinium',
      '1-butyl-1-methylpyrrolidinium',
    ],
  },
  py14: {
    canonical: 'N-methyl-N-butylpyrrolidinium',
    searchTerms: ['Pyr14', 'Py14', 'Py1,4', 'Py1;4', 'P14'],
  },
}

const IONIC_LIQUID_ANION_MEMORY: Record<string, IonicLiquidAliasEntry> = {
  ac: {
    canonical: 'acetate',
    searchTerms: ['acetate', 'acetic acid', 'ethanoate', '\u918b\u9178\u6839', '\u4e59\u9178\u6839'],
  },
  bf4: {
    canonical: 'tetrafluoroborate',
    searchTerms: ['BF4', 'tetrafluoroborate', 'fluoroborate'],
  },
  no3: {
    canonical: 'nitrate',
    searchTerms: ['NO3', 'nitrate', '\u785d\u9178\u6839'],
  },
  pf6: {
    canonical: 'hexafluorophosphate',
    searchTerms: ['PF6', 'hexafluorophosphate', '\u516d\u6c1f\u78f7\u9178\u6839'],
  },
  tfsi: {
    canonical: 'bis(trifluoromethanesulfonyl)imide',
    searchTerms: ['TFSI', 'NTf2', 'bis(trifluoromethanesulfonyl)imide'],
  },
  fap: {
    canonical: 'tris(pentafluoroethyl)trifluorophosphate',
    searchTerms: ['FAP', 'tris(pentafluoroethyl)trifluorophosphate', 'triﬂuorophosphate'],
  },
}

function normalizeIonToken(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function parseBracketIonicLiquid(input: string) {
  const match = String(input || '').match(/\[([^\]]+)\]\s*\[([^\]]+)\]/i)
  if (!match) return null
  return {
    raw: String(input || '').trim(),
    cationRaw: match[1] || '',
    anionRaw: match[2] || '',
    cationKey: normalizeIonToken(match[1] || ''),
    anionKey: normalizeIonToken(match[2] || ''),
  }
}

function uniqueTerms(input: string[]) {
  const seen = new Set<string>()
  return input.filter((term) => {
    const cleaned = String(term || '').trim()
    if (!cleaned) return false
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getIonicLiquidEvidenceTerms(rawValue: string) {
  const value = String(rawValue || '').trim()
  if (!value) return []

  const pair = parseBracketIonicLiquid(value)
  if (!pair) return [value]

  const cationMemory = IONIC_LIQUID_CATION_MEMORY[pair.cationKey]
  const anionMemory = IONIC_LIQUID_ANION_MEMORY[pair.anionKey]

  const terms = [
    ...(anionMemory?.searchTerms || []),
    value,
    `[${pair.cationRaw}] [${pair.anionRaw}]`,
    `[${pair.cationRaw}]-[${pair.anionRaw}]`,
    ...(cationMemory && anionMemory
      ? cationMemory.searchTerms.flatMap((cationTerm) =>
          anionMemory.searchTerms.flatMap((anionTerm) => [
            `${cationTerm} ${anionTerm}`,
            `${cationTerm}${anionTerm}`,
            `[${cationTerm}]${anionTerm}`,
            `[${cationTerm}][${anionTerm}]`,
          ]),
        )
      : []),
  ]

  return uniqueTerms(terms)
}

export function getIonicLiquidEvidenceParts(rawValue: string): IonicLiquidEvidenceParts | null {
  return parseBracketIonicLiquid(rawValue)
}
