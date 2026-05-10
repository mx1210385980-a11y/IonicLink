<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileText,
  LibraryBig,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
} from 'lucide-vue-next'

import LiteratureIntakeManager from '@/components/knowledge/LiteratureIntakeManager.vue'
import type { Literature } from '@/lib/api'

type JournalMeta = {
  shortName: string
  displayName: string
  publisher: string
  family: string
  accent: string
  accentSoft: string
  gradient: string
  initials: string
  coverImage?: string
  known: boolean
}

type SourceItem = {
  item: Literature
  journal: string
  publisher: string
  doiPrefix: string
  records: number
  candidates: number
  totalRecords: number
  year: number | null
  status: string
}

type SourceGroup = {
  key: string
  journal: string
  publisher: string
  meta: JournalMeta
  count: number
  records: number
  candidates: number
  extractedCount: number
  pendingCount: number
  years: number[]
  yearRange: string
  doiPrefixes: string[]
  items: SourceItem[]
}

const props = withDefaults(defineProps<{
  literatureItems: Literature[]
  loading?: boolean
  error?: string
  activeSourceId?: string | null
  activeScopeLabel?: string
}>(), {
  loading: false,
  error: '',
  activeSourceId: null,
  activeScopeLabel: 'Knowledge Library',
})

const emit = defineEmits<{
  selectSource: [literatureId: number | null]
  openReviewSource: [literatureId?: number | null]
  refreshLiterature: []
}>()

const searchQuery = ref('')
const selectedPublisher = ref<string | null>(null)
const selectedGroupKey = ref<string | null>(null)

const doiPublisherRules = [
  { prefix: '10.1021', publisher: 'ACS Publications', family: 'Chemistry' },
  { prefix: '10.1039', publisher: 'Royal Society of Chemistry', family: 'Chemistry' },
  { prefix: '10.1103', publisher: 'American Physical Society', family: 'Physics' },
  { prefix: '10.1007', publisher: 'Springer Nature', family: 'Materials' },
  { prefix: '10.1016', publisher: 'Elsevier', family: 'Engineering' },
  { prefix: '10.1038', publisher: 'Nature Portfolio', family: 'Science' },
  { prefix: '10.1088', publisher: 'IOP Publishing', family: 'Physics' },
  { prefix: '10.1080', publisher: 'Taylor & Francis', family: 'Engineering' },
  { prefix: '10.1111', publisher: 'Wiley', family: 'Science' },
  { prefix: '10.1149', publisher: 'Electrochemical Society', family: 'Electrochemistry' },
]

const journalMetaRules: Array<{
  match: RegExp
  meta: Omit<JournalMeta, 'known'>
}> = [
  {
    match: /\bnanoscale\b/i,
    meta: {
      shortName: 'Nanoscale',
      displayName: 'Nanoscale',
      publisher: 'Royal Society of Chemistry',
      family: 'Nanoscience',
      accent: '#00a6a6',
      accentSoft: '#dffafa',
      gradient: 'linear-gradient(145deg, #042f2e 0%, #0f766e 48%, #67e8f9 100%)',
      initials: 'NS',
      coverImage: '/journal-covers/nanoscale.webp',
    },
  },
  {
    match: /\blangmuir\b/i,
    meta: {
      shortName: 'Langmuir',
      displayName: 'Langmuir',
      publisher: 'ACS Publications',
      family: 'Interfaces',
      accent: '#d97706',
      accentSoft: '#fff3d6',
      gradient: 'linear-gradient(145deg, #111827 0%, #1d4ed8 52%, #f59e0b 100%)',
      initials: 'LG',
    },
  },
  {
    match: /physical review letters|phys\.?\s*rev\.?\s*lett/i,
    meta: {
      shortName: 'PRL',
      displayName: 'Physical Review Letters',
      publisher: 'American Physical Society',
      family: 'Physics',
      accent: '#ef4444',
      accentSoft: '#ffe5e5',
      gradient: 'linear-gradient(145deg, #0f172a 0%, #1d4ed8 58%, #ef4444 100%)',
      initials: 'PRL',
    },
  },
  {
    match: /journal of physical chemistry c|j\.?\s*phys\.?\s*chem\.?\s*c/i,
    meta: {
      shortName: 'JPC C',
      displayName: 'The Journal of Physical Chemistry C',
      publisher: 'ACS Publications',
      family: 'Physical Chemistry',
      accent: '#2563eb',
      accentSoft: '#dbeafe',
      gradient: 'linear-gradient(145deg, #172554 0%, #2563eb 52%, #22d3ee 100%)',
      initials: 'JPC',
      coverImage: '/journal-covers/jpccck.2026.130.issue-18.xlargecover.jpg',
    },
  },
  {
    match: /phys\.?\s*chem\.?\s*chem\.?\s*phys|physical chemistry chemical physics/i,
    meta: {
      shortName: 'PCCP',
      displayName: 'Physical Chemistry Chemical Physics',
      publisher: 'Royal Society of Chemistry',
      family: 'Physical Chemistry',
      accent: '#0891b2',
      accentSoft: '#cffafe',
      gradient: 'linear-gradient(145deg, #0f172a 0%, #0e7490 48%, #a7f3d0 100%)',
      initials: 'PCCP',
      coverImage: '/journal-covers/pccp.webp',
    },
  },
  {
    match: /acs sustainable chemistry|sustainable chemistry/i,
    meta: {
      shortName: 'ACS Sustain.',
      displayName: 'ACS Sustainable Chemistry & Engineering',
      publisher: 'ACS Publications',
      family: 'Sustainability',
      accent: '#059669',
      accentSoft: '#d1fae5',
      gradient: 'linear-gradient(145deg, #052e16 0%, #059669 55%, #bef264 100%)',
      initials: 'ACS',
    },
  },
  {
    match: /tribology letters/i,
    meta: {
      shortName: 'Tribology Letters',
      displayName: 'Tribology Letters',
      publisher: 'Springer Nature',
      family: 'Tribology',
      accent: '#ea580c',
      accentSoft: '#ffedd5',
      gradient: 'linear-gradient(145deg, #1e293b 0%, #ea580c 56%, #facc15 100%)',
      initials: 'TL',
      coverImage: '/journal-covers/tribology-letters.webp',
    },
  },
  {
    match: /^friction$|\bfriction\b/i,
    meta: {
      shortName: 'Friction',
      displayName: 'Friction',
      publisher: 'Springer Nature',
      family: 'Tribology',
      accent: '#dc2626',
      accentSoft: '#fee2e2',
      gradient: 'linear-gradient(145deg, #450a0a 0%, #dc2626 52%, #fb923c 100%)',
      initials: 'FR',
      coverImage: '/journal-covers/friction.jpg',
    },
  },
  {
    match: /tribology international/i,
    meta: {
      shortName: 'Tribology Int.',
      displayName: 'Tribology International',
      publisher: 'Elsevier',
      family: 'Tribology',
      accent: '#0284c7',
      accentSoft: '#e0f2fe',
      gradient: 'linear-gradient(145deg, #082f49 0%, #0284c7 50%, #f59e0b 100%)',
      initials: 'TI',
      coverImage: '/journal-covers/tribology-international.jpg',
    },
  },
  {
    match: /^wear$|\bwear\b/i,
    meta: {
      shortName: 'Wear',
      displayName: 'Wear',
      publisher: 'Elsevier',
      family: 'Tribology',
      accent: '#64748b',
      accentSoft: '#f1f5f9',
      gradient: 'linear-gradient(145deg, #020617 0%, #334155 54%, #f97316 100%)',
      initials: 'WR',
      coverImage: '/journal-covers/wear.jpg',
    },
  },
  {
    match: /journal of molecular liquids/i,
    meta: {
      shortName: 'Mol. Liquids',
      displayName: 'Journal of Molecular Liquids',
      publisher: 'Elsevier',
      family: 'Liquids',
      accent: '#7c3aed',
      accentSoft: '#ede9fe',
      gradient: 'linear-gradient(145deg, #2e1065 0%, #7c3aed 52%, #22d3ee 100%)',
      initials: 'JML',
      coverImage: '/journal-covers/journal-of-molecular-liquids.jpg',
    },
  },
  {
    match: /colloids and surfaces/i,
    meta: {
      shortName: 'Colloids Surf.',
      displayName: 'Colloids and Surfaces A',
      publisher: 'Elsevier',
      family: 'Interfaces',
      accent: '#0ea5e9',
      accentSoft: '#e0f2fe',
      gradient: 'linear-gradient(145deg, #0c4a6e 0%, #0ea5e9 55%, #bae6fd 100%)',
      initials: 'CSA',
      coverImage: '/journal-covers/colloids-surfaces-a.jpg',
    },
  },
  {
    match: /^carbon$|\bcarbon\b/i,
    meta: {
      shortName: 'Carbon',
      displayName: 'Carbon',
      publisher: 'Elsevier',
      family: 'Materials',
      accent: '#475569',
      accentSoft: '#e2e8f0',
      gradient: 'linear-gradient(145deg, #020617 0%, #475569 58%, #cbd5e1 100%)',
      initials: 'CB',
      coverImage: '/journal-covers/carbon.jpg',
    },
  },
]

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '')
}

function doiPrefix(doi: unknown) {
  const match = cleanText(doi).match(/10\.\d{4,9}/i)
  return match?.[0] || ''
}

function publisherFromDoi(doi: unknown) {
  const normalized = cleanText(doi).toLowerCase()
  return doiPublisherRules.find((rule) => normalized.startsWith(rule.prefix)) || null
}

function hashNumber(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function initialsFor(value: string) {
  const words = cleanText(value).split(/\s+/).filter(Boolean)
  if (!words.length) return 'IL'
  const initials = words.slice(0, 3).map((word) => word[0]?.toUpperCase()).join('')
  return initials || 'IL'
}

function fallbackMeta(journal: string, publisherHint?: string): JournalMeta {
  const seed = hashNumber(journal || publisherHint || 'source')
  const hue = seed % 360
  const secondHue = (hue + 42) % 360
  const displayName = journal || publisherHint || '未识别来源'
  return {
    shortName: displayName.length > 18 ? `${displayName.slice(0, 17)}…` : displayName,
    displayName,
    publisher: publisherHint || 'Unknown source',
    family: 'Literature',
    accent: `hsl(${hue} 72% 42%)`,
    accentSoft: `hsl(${hue} 86% 93%)`,
    gradient: `linear-gradient(145deg, hsl(${hue} 72% 18%) 0%, hsl(${hue} 70% 42%) 52%, hsl(${secondHue} 88% 70%) 100%)`,
    initials: initialsFor(displayName),
    known: false,
  }
}

function journalMetaFor(journal: string, doi?: string): JournalMeta {
  const matched = journalMetaRules.find((rule) => rule.match.test(journal))
  if (matched) return { ...matched.meta, known: true }
  const publisherHint = publisherFromDoi(doi)?.publisher
  return fallbackMeta(journal, publisherHint)
}

function sourceGroupIdentity(source: SourceItem) {
  const meta = journalMetaFor(source.journal, source.item.doi)
  const canonicalName = meta.known ? meta.displayName : (source.journal || source.publisher || 'unknown')
  return {
    key: normalizeKey(`${meta.known ? 'journal' : 'source'}-${canonicalName}`),
    journal: canonicalName,
    publisher: meta.publisher || source.publisher,
    meta,
  }
}

function recordTotal(item: Literature) {
  return Number(item.recordCount || 0) + Number(item.candidateCount || 0)
}

function normalizedJournal(item: Literature) {
  const journal = cleanText(item.journal)
  if (journal) return journal
  const doiPublisher = publisherFromDoi(item.doi)
  if (doiPublisher) return `${doiPublisher.publisher} DOI 来源`
  return '未识别来源'
}

function yearNumber(value: unknown) {
  const year = Number(value)
  return Number.isFinite(year) && year > 1800 ? year : null
}

function formatYearRange(years: number[]) {
  if (!years.length) return '年份待补全'
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  return minYear === maxYear ? String(maxYear) : `${minYear}-${maxYear}`
}

function formatAuthors(authors: unknown) {
  const text = cleanText(authors)
  if (!text) return '作者待补全'
  const parts = text.split(/[,;，、]/).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return text
  if (parts.length === 1) return parts[0]!
  return `${parts[0]} et al.`
}

function literatureSubtitle(item: Literature) {
  const year = yearNumber(item.year)
  const journal = cleanText(item.journal)
  const doi = cleanText(item.doi)
  const authors = formatAuthors(item.authors)
  return [year || '', journal, doi, authors].filter(Boolean).join(' · ') || '元数据待补全'
}

function statusLabel(status: string, totalRecords: number) {
  if (totalRecords > 0) return '已入库'
  if (status === 'pending' || status === 'processing') return '处理中'
  if (status === 'no_data') return '无可用数据'
  return '待提取'
}

function selectGroup(group: SourceGroup) {
  selectedGroupKey.value = group.key
  const first = group.items[0]?.item
  emit('selectSource', first?.id ?? null)
}

function openGroup(group: SourceGroup) {
  const first = group.items[0]?.item
  emit('openReviewSource', first?.id ?? null)
}

const sourceItems = computed<SourceItem[]>(() => {
  return props.literatureItems.map((item) => {
    const prefix = doiPrefix(item.doi)
    const doiPublisher = publisherFromDoi(item.doi)
    const journal = normalizedJournal(item)
    const totalRecords = recordTotal(item)
    return {
      item,
      journal,
      publisher: cleanText(item.journal) ? (doiPublisher?.publisher || journalMetaFor(journal, item.doi).publisher) : (doiPublisher?.publisher || 'Unknown source'),
      doiPrefix: prefix,
      records: Number(item.recordCount || 0),
      candidates: Number(item.candidateCount || 0),
      totalRecords,
      year: yearNumber(item.year),
      status: cleanText(item.status).toLowerCase(),
    }
  })
})

const sourceGroups = computed<SourceGroup[]>(() => {
  const grouped = new Map<string, SourceGroup>()
  sourceItems.value.forEach((source) => {
    const identity = sourceGroupIdentity(source)
    const key = identity.key
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        journal: identity.journal,
        publisher: identity.publisher,
        meta: identity.meta,
        count: 0,
        records: 0,
        candidates: 0,
        extractedCount: 0,
        pendingCount: 0,
        years: [],
        yearRange: '',
        doiPrefixes: [],
        items: [],
      })
    }
    const group = grouped.get(key)!
    group.count += 1
    group.records += source.records
    group.candidates += source.candidates
    if (source.totalRecords > 0) group.extractedCount += 1
    else group.pendingCount += 1
    if (source.year) group.years.push(source.year)
    if (source.doiPrefix && !group.doiPrefixes.includes(source.doiPrefix)) group.doiPrefixes.push(source.doiPrefix)
    group.items.push(source)
  })

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      yearRange: formatYearRange(group.years),
      doiPrefixes: group.doiPrefixes.sort(),
      items: group.items.sort((a, b) => {
        if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0)
        return Number(b.item.id || 0) - Number(a.item.id || 0)
      }),
    }))
    .sort((a, b) => {
      if (b.records !== a.records) return b.records - a.records
      if (b.count !== a.count) return b.count - a.count
      return a.journal.localeCompare(b.journal)
    })
})

const publisherGroups = computed(() => {
  const grouped = new Map<string, {
    publisher: string
    family: string
    count: number
    records: number
    journals: Set<string>
    accent: string
  }>()

  sourceGroups.value.forEach((group) => {
    const publisher = group.publisher || 'Unknown source'
    if (!grouped.has(publisher)) {
      grouped.set(publisher, {
        publisher,
        family: group.meta.family,
        count: 0,
        records: 0,
        journals: new Set<string>(),
        accent: group.meta.accent,
      })
    }
    const item = grouped.get(publisher)!
    item.count += group.count
    item.records += group.records
    item.journals.add(group.journal)
  })

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      journalCount: group.journals.size,
      share: props.literatureItems.length ? Math.round((group.count / props.literatureItems.length) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.records !== a.records) return b.records - a.records
      return b.count - a.count
    })
})

const publisherFilters = computed(() => publisherGroups.value.slice(0, 7).map((group) => group.publisher))

const filteredGroups = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return sourceGroups.value.filter((group) => {
    const publisherMatched = !selectedPublisher.value || group.publisher === selectedPublisher.value
    if (!publisherMatched) return false
    if (!query) return true
    return [
      group.journal,
      group.publisher,
      group.meta.family,
      ...group.doiPrefixes,
      ...group.items.map((source) => source.item.title),
    ].some((value) => cleanText(value).toLowerCase().includes(query))
  })
})

const coverGroups = computed(() => {
  const selected = new Map<string, SourceGroup>()
  sourceGroups.value
    .filter((group) => group.meta.known)
    .slice(0, 8)
    .forEach((group) => selected.set(group.key, group))
  sourceGroups.value
    .slice(0, 8)
    .forEach((group) => {
      if (selected.size < 8) selected.set(group.key, group)
    })
  return Array.from(selected.values())
})

const activeGroupKey = computed(() => {
  const selectedId = String(props.activeSourceId || '')
  if (!selectedId) return selectedGroupKey.value
  const matched = sourceGroups.value.find((group) => group.items.some((source) => String(source.item.id) === selectedId))
  return matched?.key || selectedGroupKey.value
})

const activeGroup = computed(() => {
  return sourceGroups.value.find((group) => group.key === activeGroupKey.value)
    || filteredGroups.value[0]
    || sourceGroups.value[0]
    || null
})

const stats = computed(() => {
  const items = sourceItems.value
  const extractedCount = items.filter((item) => item.totalRecords > 0).length
  const years = items.map((item) => item.year).filter((year): year is number => Boolean(year))
  return {
    totalLiterature: items.length,
    extractedCount,
    pendingCount: Math.max(items.length - extractedCount, 0),
    journalCount: sourceGroups.value.length,
    publisherCount: publisherGroups.value.length,
    recordCount: items.reduce((sum, item) => sum + item.totalRecords, 0),
    yearRange: formatYearRange(years),
  }
})
</script>

<template>
  <div class="source-atlas h-full min-h-0 overflow-y-auto bg-[#f6f9fd]">
    <div class="mx-auto flex max-w-[90rem] flex-col gap-4 p-4 2xl:p-5">
      <section class="relative overflow-hidden rounded-[2rem] border border-[#d7e2ef] bg-[#07111f] p-5 text-white shadow-[0_30px_80px_-52px_rgba(15,23,42,0.68)]">
        <div class="source-atlas__halo source-atlas__halo--one" />
        <div class="source-atlas__halo source-atlas__halo--two" />
        <div class="relative grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div class="min-w-0">
            <div class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#bcd4ee]">
              <LibraryBig class="h-3.5 w-3.5 text-[#7dd3fc]" />
              Literature Source Atlas
            </div>
            <h2 class="mt-4 max-w-3xl text-[2rem] font-semibold leading-tight tracking-[-0.055em] text-white xl:text-[2.4rem]">
              入库文献来源，一眼看清。
            </h2>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-[#b8c7d9]">
              汇总当前 {{ activeScopeLabel }} 的期刊、出版社、DOI 前缀与入库记录数；重要期刊以封面风格卡片呈现，帮助学生、老师和企业合作方快速理解数据来源的可信度与分布。
            </p>
          </div>

          <div class="grid min-w-[20rem] grid-cols-2 gap-2">
            <div class="rounded-[1.1rem] border border-white/10 bg-white/[0.08] p-3">
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#94a9c3]">Literature</p>
              <p class="mt-2 text-2xl font-semibold tabular-nums">{{ stats.totalLiterature }}</p>
              <p class="mt-1 text-xs text-[#9fb0c6]">已提取 {{ stats.extractedCount }} 篇</p>
            </div>
            <div class="rounded-[1.1rem] border border-white/10 bg-white/[0.08] p-3">
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#94a9c3]">Journals</p>
              <p class="mt-2 text-2xl font-semibold tabular-nums">{{ stats.journalCount }}</p>
              <p class="mt-1 text-xs text-[#9fb0c6]">{{ stats.publisherCount }} 个来源机构</p>
            </div>
            <div class="rounded-[1.1rem] border border-white/10 bg-white/[0.08] p-3">
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#94a9c3]">Records</p>
              <p class="mt-2 text-2xl font-semibold tabular-nums">{{ stats.recordCount }}</p>
              <p class="mt-1 text-xs text-[#9fb0c6]">候选与确认记录合计</p>
            </div>
            <div class="rounded-[1.1rem] border border-white/10 bg-white/[0.08] p-3">
              <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#94a9c3]">Years</p>
              <p class="mt-2 text-2xl font-semibold tabular-nums">{{ stats.yearRange }}</p>
              <p class="mt-1 text-xs text-[#9fb0c6]">文献时间跨度</p>
            </div>
          </div>
        </div>
      </section>

      <section class="grid min-h-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div class="min-w-0 space-y-4">
          <div class="rounded-[1.5rem] border border-[#dbe5f0] bg-white/95 p-3 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.35)]">
            <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 flex-1 items-center gap-2 rounded-[1rem] border border-[#dbe5f0] bg-[#f8fbff] px-3 py-2">
                <Search class="h-4 w-4 shrink-0 text-[#8aa0bb]" />
                <input
                  v-model="searchQuery"
                  type="search"
                  class="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-[#8aa0bb]"
                  placeholder="搜索期刊、出版社、DOI 或文献标题..."
                >
              </div>

              <div class="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                  :class="!selectedPublisher ? 'border-[#0f172a] bg-[#0f172a] text-white' : 'border-[#d9e3ef] bg-white text-slate-600 hover:border-[#b9c7d8]'"
                  @click="selectedPublisher = null"
                >
                  全部来源
                </button>
                <button
                  v-for="publisher in publisherFilters"
                  :key="publisher"
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                  :class="selectedPublisher === publisher ? 'border-[#0f172a] bg-[#0f172a] text-white' : 'border-[#d9e3ef] bg-white text-slate-600 hover:border-[#b9c7d8]'"
                  @click="selectedPublisher = selectedPublisher === publisher ? null : publisher"
                >
                  {{ publisher }}
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-full border border-[#d9e3ef] bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#b9c7d8]"
                  @click="emit('refreshLiterature')"
                >
                  <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" />
                  刷新
                </button>
              </div>
            </div>

            <div v-if="error" class="mt-3 rounded-[1rem] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {{ error }}
            </div>
          </div>

          <LiteratureIntakeManager
            :literature-items="literatureItems"
            :loading="loading"
            @refresh-literature="emit('refreshLiterature')"
            @select-source="emit('selectSource', $event)"
            @open-review-source="emit('openReviewSource', $event)"
          />

          <section class="rounded-[1.8rem] border border-[#dbe5f0] bg-white p-4 shadow-[0_24px_56px_-46px_rgba(15,23,42,0.35)]">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8aa0bb]">
                  <Sparkles class="h-3.5 w-3.5 text-[#0ea5e9]" />
                  Important Journals
                </p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">重要期刊封面墙</h3>
              </div>
              <span class="rounded-full bg-[#eef6ff] px-3 py-1 text-xs font-semibold text-[#2563eb]">真实封面优先 / 自动回退</span>
            </div>

            <div v-if="coverGroups.length" class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              <button
                v-for="group in coverGroups"
                :key="group.key"
                type="button"
                class="source-cover group text-left"
                :class="{ 'source-cover--active': activeGroupKey === group.key }"
                :style="{ '--cover-gradient': group.meta.gradient, '--cover-accent': group.meta.accent, '--cover-soft': group.meta.accentSoft }"
                @click="selectGroup(group)"
              >
                <div class="source-cover__art" :class="{ 'source-cover__art--image': group.meta.coverImage }">
                  <img
                    v-if="group.meta.coverImage"
                    :src="group.meta.coverImage"
                    :alt="`${group.meta.displayName} journal cover`"
                    class="source-cover__image"
                    loading="lazy"
                  >
                  <template v-else>
                    <span class="source-cover__initials">{{ group.meta.initials }}</span>
                    <span class="source-cover__family">{{ group.meta.family }}</span>
                    <span class="source-cover__line source-cover__line--one" />
                    <span class="source-cover__line source-cover__line--two" />
                  </template>
                </div>
                <div class="source-cover__body">
                  <p class="source-cover__publisher">{{ group.publisher }}</p>
                  <h4 class="source-cover__title" :title="group.meta.displayName">{{ group.meta.displayName }}</h4>
                  <div class="source-cover__meta">
                    <span class="rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums" :style="{ background: group.meta.accentSoft, color: group.meta.accent }">
                      {{ group.count }} 篇
                    </span>
                    <span class="text-xs font-semibold text-slate-500">{{ group.records }} records</span>
                  </div>
                </div>
              </button>
            </div>

            <div v-else class="mt-4 rounded-[1.3rem] border border-dashed border-[#cfd9e8] bg-[#f8fbff] p-6 text-center text-sm text-slate-500">
              暂无入库文献。上传并完成提取后，这里会自动生成来源封面墙。
            </div>
          </section>

          <section class="rounded-[1.8rem] border border-[#dbe5f0] bg-white p-4 shadow-[0_24px_56px_-46px_rgba(15,23,42,0.35)]">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8aa0bb]">
                  <Database class="h-3.5 w-3.5 text-[#4f46e5]" />
                  Source Inventory
                </p>
                <h3 class="mt-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">来源期刊清单</h3>
              </div>
              <span class="text-xs font-semibold text-slate-500">显示 {{ filteredGroups.length }} / {{ sourceGroups.length }} 个来源</span>
            </div>

            <div class="mt-4 space-y-2">
              <article
                v-for="group in filteredGroups"
                :key="group.key"
                class="source-row"
                :class="{ 'source-row--active': activeGroupKey === group.key }"
                @click="selectGroup(group)"
              >
                <div class="source-row__mark" :style="{ background: group.meta.gradient }">
                  {{ group.meta.initials }}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h4 class="truncate text-base font-semibold text-slate-950">{{ group.journal }}</h4>
                    <span v-if="group.meta.known" class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">重要期刊</span>
                    <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{{ group.yearRange }}</span>
                  </div>
                  <p class="mt-1 truncate text-sm text-[#73849b]">{{ group.publisher }} · {{ group.doiPrefixes.join(', ') || 'DOI 待补全' }}</p>
                </div>
                <div class="hidden items-center gap-2 lg:flex">
                  <span class="source-row__metric"><FileText class="h-3.5 w-3.5" />{{ group.count }} 篇</span>
                  <span class="source-row__metric"><CheckCircle2 class="h-3.5 w-3.5" />{{ group.extractedCount }} 已入库</span>
                  <span class="source-row__metric"><Database class="h-3.5 w-3.5" />{{ group.records }} 条</span>
                </div>
                <button
                  type="button"
                  class="rounded-full border border-[#dbe5f0] bg-white p-2 text-slate-500 transition hover:border-[#b8c7d9] hover:text-slate-950"
                  @click.stop="openGroup(group)"
                >
                  <ChevronRight class="h-4 w-4" />
                </button>
              </article>
            </div>
          </section>
        </div>

        <aside class="space-y-4">
          <section class="rounded-[1.8rem] border border-[#dbe5f0] bg-white p-4 shadow-[0_24px_56px_-46px_rgba(15,23,42,0.35)]">
            <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8aa0bb]">
              <Building2 class="h-3.5 w-3.5 text-[#0f766e]" />
              Publishers
            </p>
            <h3 class="mt-2 text-lg font-semibold tracking-[-0.035em] text-slate-950">出版社 / DOI 来源</h3>
            <div class="mt-4 space-y-3">
              <button
                v-for="publisher in publisherGroups"
                :key="publisher.publisher"
                type="button"
                class="w-full text-left"
                @click="selectedPublisher = selectedPublisher === publisher.publisher ? null : publisher.publisher"
              >
                <div class="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span class="truncate font-semibold text-slate-800">{{ publisher.publisher }}</span>
                  <span class="text-xs font-semibold tabular-nums text-slate-500">{{ publisher.share }}%</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-[#eef3f8]">
                  <div
                    class="h-full rounded-full"
                    :style="{ width: `${publisher.share}%`, background: publisher.accent }"
                  />
                </div>
                <p class="mt-1 text-xs text-slate-500">{{ publisher.count }} 篇 · {{ publisher.journalCount }} 种期刊 · {{ publisher.records }} 条记录</p>
              </button>
            </div>
          </section>

          <section v-if="activeGroup" class="rounded-[1.8rem] border border-[#dbe5f0] bg-white p-4 shadow-[0_24px_56px_-46px_rgba(15,23,42,0.35)]">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8aa0bb]">
                  <BookOpen class="h-3.5 w-3.5 text-[#4f46e5]" />
                  Selected Source
                </p>
                <h3 class="mt-2 text-lg font-semibold leading-snug tracking-[-0.035em] text-slate-950">{{ activeGroup.journal }}</h3>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" :style="{ background: activeGroup.meta.accentSoft, color: activeGroup.meta.accent }">
                {{ activeGroup.count }} 篇
              </span>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-2">
              <div class="rounded-[1rem] bg-[#f6f9fc] p-3">
                <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"><CalendarDays class="h-3 w-3" /> Years</p>
                <p class="mt-1 text-sm font-semibold text-slate-800">{{ activeGroup.yearRange }}</p>
              </div>
              <div class="rounded-[1rem] bg-[#f6f9fc] p-3">
                <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"><Tag class="h-3 w-3" /> DOI</p>
                <p class="mt-1 truncate text-sm font-semibold text-slate-800">{{ activeGroup.doiPrefixes.join(', ') || '待补全' }}</p>
              </div>
            </div>

            <div class="mt-4 space-y-2">
              <button
                v-for="source in activeGroup.items.slice(0, 6)"
                :key="source.item.id"
                type="button"
                class="w-full rounded-[1rem] border border-[#e1e9f2] bg-[#fbfdff] p-3 text-left transition hover:border-[#b7c7da] hover:bg-white"
                @click="emit('openReviewSource', source.item.id)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="line-clamp-2 text-sm font-semibold leading-snug text-slate-950">{{ cleanText(source.item.title) || `Literature ${source.item.id}` }}</p>
                    <p class="mt-1 line-clamp-2 text-xs leading-5 text-[#7c8da5]">{{ literatureSubtitle(source.item) }}</p>
                  </div>
                  <span
                    class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    :class="source.totalRecords > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
                  >
                    {{ statusLabel(source.status, source.totalRecords) }}
                  </span>
                </div>
              </button>
            </div>
          </section>

          <section class="rounded-[1.8rem] border border-[#dbe5f0] bg-[#0f172a] p-4 text-white shadow-[0_24px_56px_-46px_rgba(15,23,42,0.55)]">
            <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9fb0c6]">
              <Clock class="h-3.5 w-3.5 text-[#67e8f9]" />
              Curation Hint
            </p>
            <h3 class="mt-2 text-lg font-semibold tracking-[-0.035em]">下一步可以做什么？</h3>
            <p class="mt-2 text-sm leading-6 text-[#cbd5e1]">
              若某些来源显示“DOI 待补全”或“年份待补全”，建议先运行元数据补全；若重要期刊来源过少，则优先补充该方向的代表性文献。
            </p>
          </section>
        </aside>
      </section>
    </div>
  </div>
</template>

<style scoped>
.source-atlas__halo {
  position: absolute;
  border-radius: 999px;
  opacity: 0.55;
  filter: blur(8px);
  pointer-events: none;
}

.source-atlas__halo--one {
  right: 8%;
  top: -4rem;
  width: 18rem;
  height: 18rem;
  background: radial-gradient(circle, rgba(45, 212, 191, 0.34), transparent 68%);
}

.source-atlas__halo--two {
  left: 28%;
  bottom: -7rem;
  width: 24rem;
  height: 16rem;
  background: radial-gradient(circle, rgba(96, 165, 250, 0.22), transparent 70%);
}

.source-cover {
  position: relative;
  display: grid;
  min-height: 14.75rem;
  grid-template-rows: 7.35rem minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid #dbe5f0;
  border-radius: 1.25rem;
  background: #fff;
  box-shadow: 0 20px 42px -36px rgba(15, 23, 42, 0.5);
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.source-cover:hover,
.source-cover--active {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--cover-accent) 58%, #dbe5f0);
  box-shadow: 0 26px 50px -34px color-mix(in srgb, var(--cover-accent) 45%, rgba(15, 23, 42, 0.36));
}

.source-cover__art {
  position: relative;
  min-height: 7.35rem;
  overflow: hidden;
  background: var(--cover-gradient);
}

.source-cover__art--image {
  display: grid;
  min-height: 7.35rem;
  place-items: center;
  background:
    radial-gradient(circle at 50% 28%, rgba(59, 130, 246, 0.24), transparent 38%),
    #07111f;
}

.source-cover__art::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(115deg, rgba(255, 255, 255, 0.18) 0 1px, transparent 1px 26px),
    radial-gradient(circle at 78% 24%, rgba(255, 255, 255, 0.34), transparent 22%),
    radial-gradient(circle at 18% 82%, rgba(255, 255, 255, 0.18), transparent 28%);
  opacity: 0.85;
}

.source-cover__art--image::before {
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0) 62%, rgba(15, 23, 42, 0.38) 100%),
    linear-gradient(90deg, rgba(15, 23, 42, 0.18), transparent 18%, transparent 82%, rgba(15, 23, 42, 0.18));
  opacity: 1;
}

.source-cover__image {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
  object-position: center top;
  transition: transform 220ms ease;
}

.source-cover:hover .source-cover__image {
  transform: scale(1.025);
}

.source-cover__initials {
  position: absolute;
  left: 1rem;
  top: 1rem;
  z-index: 1;
  color: #fff;
  font-size: 1.9rem;
  font-weight: 800;
  letter-spacing: -0.08em;
}

.source-cover__family {
  position: absolute;
  left: 1rem;
  bottom: 1rem;
  z-index: 1;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  padding: 0.35rem 0.7rem;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.72rem;
  font-weight: 700;
  backdrop-filter: blur(10px);
}

.source-cover__line {
  position: absolute;
  z-index: 1;
  right: 1rem;
  height: 2px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
}

.source-cover__line--one {
  bottom: 2.9rem;
  width: 4.5rem;
}

.source-cover__line--two {
  bottom: 2.35rem;
  width: 2.8rem;
}

.source-cover__body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 0.9rem 1rem 1rem;
}

.source-cover__publisher {
  display: -webkit-box;
  overflow: hidden;
  color: #94a3b8;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  line-height: 1.3;
  text-transform: uppercase;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.source-cover__title {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 0.35rem;
  color: #020617;
  font-size: 0.98rem;
  font-weight: 800;
  letter-spacing: -0.035em;
  line-height: 1.18;
  text-wrap: balance;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.source-cover__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.85rem;
}

.source-row {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 0.8rem;
  border: 1px solid #e2eaf3;
  border-radius: 1.1rem;
  background: #fff;
  padding: 0.85rem;
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.source-row:hover,
.source-row--active {
  border-color: #b8c7d9;
  background: #fbfdff;
  box-shadow: 0 20px 42px -36px rgba(15, 23, 42, 0.48);
}

.source-row__mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: none;
  place-items: center;
  border-radius: 1rem;
  color: #fff;
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: -0.06em;
}

.source-row__metric {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  background: #f3f7fb;
  padding: 0.35rem 0.6rem;
  color: #65758b;
  font-size: 0.73rem;
  font-weight: 700;
  white-space: nowrap;
}
</style>
