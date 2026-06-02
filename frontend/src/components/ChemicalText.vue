<script setup lang="ts">
type ChemicalSegment = {
  text: string
  subscript: boolean
}

const props = defineProps<{
  text: string | number | null | undefined
}>()

const chemicalLetters = new Set(['B', 'C', 'F', 'H', 'I', 'K', 'N', 'O', 'P', 'S', 'U', 'V', 'W', 'Y'])

function isDigit(char: string) {
  return /[0-9]/.test(char)
}

function tokenAround(value: string, index: number) {
  const left = value.slice(0, index).match(/[A-Za-z0-9]+$/)?.[0] || ''
  const current = value[index] || ''
  const right = value.slice(index + 1).match(/^[A-Za-z0-9]+/)?.[0] || ''
  return {
    start: index - left.length,
    token: `${left}${current}${right}`,
  }
}

function commaTokenAround(value: string, index: number) {
  const left = value.slice(0, index).match(/[A-Za-z0-9,]+$/)?.[0] || ''
  const current = value[index] || ''
  const right = value.slice(index + 1).match(/^[A-Za-z0-9,]+/)?.[0] || ''
  return `${left}${current}${right}`
}

function isIonChainToken(token: string) {
  return /^[A-Za-z][0-9]+(?:,[0-9]+)+$/.test(token)
}

function hasBorateAliasContext(value: string, index: number) {
  const start = Math.max(0, index - 220)
  const end = Math.min(value.length, index + 220)
  return /\b(BMB|borate|anion|cation|ionic\s+liquids?|ILs?)\b/i.test(value.slice(start, end))
}

function shouldSubscriptOutsideBracket(value: string, index: number) {
  const prev = value[index - 1] || ''
  const next = value[index + 1] || ''
  const { token, start } = tokenAround(value, index)
  const commaToken = commaTokenAround(value, index)
  if (isIonChainToken(commaToken)) {
    return true
  }
  if (/^A[0-9]+(?:BMB)?$/i.test(token) && hasBorateAliasContext(value, index)) {
    return true
  }
  if (!prev || (!/[A-Za-z)]/.test(prev) && !isDigit(prev))) return false
  const prefixInToken = value.slice(start, index)
  if (!/[A-Za-z)]/.test(prefixInToken)) return false
  if (/^[BCFHIKNOPSUVWY][A-Za-z0-9()]*\d[A-Za-z0-9()]*$/.test(token)) {
    return true
  }
  if (/[A-Za-z0-9]/.test(next)) return true
  const prefix = start >= 0 ? value.slice(start, index) : prev
  const lastLetter = prefix.match(/[A-Za-z]$/)?.[0]?.toUpperCase() || ''
  return chemicalLetters.has(lastLetter) && /(?:[A-Z][a-z]?|[A-Z]{2,})/.test(prefix)
}

function pushSegment(segments: ChemicalSegment[], text: string, subscript: boolean) {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last && last.subscript === subscript) {
    last.text += text
  } else {
    segments.push({ text, subscript })
  }
}

function formatChemicalText(value: unknown) {
  const text = String(value ?? '')
  const segments: ChemicalSegment[] = []
  let bracketDepth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] || ''
    if (char === '[') {
      bracketDepth += 1
      pushSegment(segments, char, false)
      continue
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      pushSegment(segments, char, false)
      continue
    }
    if (char === ',' && bracketDepth > 0) {
      continue
    }
    if (char === ',' && isIonChainToken(commaTokenAround(text, index))) {
      continue
    }
    const subscript = isDigit(char) && (bracketDepth > 0 || shouldSubscriptOutsideBracket(text, index))
    pushSegment(segments, char, subscript)
  }
  return segments
}
</script>

<template>
  <template v-for="(segment, index) in formatChemicalText(props.text)" :key="`${index}-${segment.text}`">
    <sub v-if="segment.subscript" class="align-sub text-[0.68em] leading-none">{{ segment.text }}</sub>
    <span v-else>{{ segment.text }}</span>
  </template>
</template>
