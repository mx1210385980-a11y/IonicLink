<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCheck,
  Flag,
  Pencil,
  Quote,
  Search,
} from 'lucide-vue-next'

import type { BatchFile, TribologyData } from '@/lib/api'
import type { HighlightRect } from '@/types/pdf-highlight'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  selectedFileName: string
  selectedFile: BatchFile | null
  files: BatchFile[]
  highlightCount: number
  pdfUrl: string
  highlightData: HighlightRect[]
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-pipeline': []
  'open-knowledge': []
  'select-file': [fileId: string]
}>()

type QueueItem = {
  id: string
  name: string
  entityCount: number
  status: 'pending' | 'in_progress' | 'confirmed'
  alert: boolean
  selected: boolean
}

type ReviewField = {
  id: string
  label: string
  value: string
  status: 'confirmed' | 'low_conf' | 'review'
  issue?: string
}

type EvidenceHit = {
  id: string
  label: string
  meta: string
}

const query = ref('')
const prioritizeLowConfidence = ref(true)
const activeFieldId = ref<string>('material')

const reviewTabs = computed(() => [
  { key: 'inbox', label: 'Inbox' },
  { key: 'record-review', label: 'Record Review' },
  { key: 'grounding', label: 'Grounding' },
  { key: 'queue', label: 'Queue' },
])

const selectedReviewFile = computed<BatchFile | null>(() => props.selectedFile || props.files[0] || null)
const activeDocumentName = computed(() => selectedReviewFile.value?.name || props.selectedFileName || 'No review document selected')
const primaryRecord = computed<TribologyData | null>(() => selectedReviewFile.value?.records?.[0] || null)

const queueItems = computed<QueueItem[]>(() => {
  const base = props.files.length
    ? props.files.map((file) => {
        const status: QueueItem['status'] = file.status === 'success'
          ? (file.hasWarnings ? 'pending' : 'confirmed')
          : file.status === 'processing'
              ? 'in_progress'
              : 'pending'

        return {
          id: file.id,
          name: file.name,
          entityCount: file.records?.length || 0,
          status,
          alert: Boolean(file.hasWarnings || file.status === 'error'),
          selected: file.id === selectedReviewFile.value?.id,
        }
      })
    : [{
        id: 'empty',
        name: activeDocumentName.value,
        entityCount: Math.max(props.highlightCount, 0),
        status: 'pending' as const,
        alert: false,
        selected: true,
      }]

  let rows = base
  if (prioritizeLowConfidence.value) {
    rows = [...rows].sort((left, right) => Number(right.alert) - Number(left.alert))
  }

  const q = query.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((item) => item.name.toLowerCase().includes(q))
})

const reviewFields = computed<ReviewField[]>(() => {
  const record = primaryRecord.value
  if (!record) {
    return [
      { id: 'source', label: 'Source Document', value: activeDocumentName.value, status: 'review', issue: 'No extracted record is attached to this file yet.' },
      { id: 'scope', label: 'Review Scope', value: props.activeScopeLabel, status: 'review' },
    ]
  }

  const items: ReviewField[] = [
    {
      id: 'material',
      label: 'Material',
      value: present(record.material_name),
      status: fieldState(record.material_name),
      issue: missingIssue('material', record.material_name),
    },
    {
      id: 'ionic-liquid',
      label: 'Ionic Liquid',
      value: present(record.ionic_liquid),
      status: fieldState(record.ionic_liquid),
      issue: missingIssue('ionic liquid', record.ionic_liquid),
    },
    {
      id: 'cof',
      label: 'COF',
      value: present(record.cof),
      status: fieldState(record.cof),
      issue: missingIssue('cof', record.cof),
    },
    {
      id: 'conditions',
      label: 'Test Conditions',
      value: summarizeConditions(record),
      status: summarizeConditions(record) === 'Not captured yet' ? 'low_conf' : 'review',
      issue: summarizeConditions(record) === 'Not captured yet' ? 'Load, speed, or temperature still need confirmation.' : undefined,
    },
    {
      id: 'source-page',
      label: 'Source Page',
      value: record.source_page ? `Page ${record.source_page}` : `${props.highlightData.length} grounded hits`,
      status: record.source_page || props.highlightData.length ? 'confirmed' : 'low_conf',
      issue: !(record.source_page || props.highlightData.length) ? 'No grounded page was attached to this record.' : undefined,
    },
  ]

  return items
})

watch(
  reviewFields,
  (fields) => {
    if (!fields.find((field) => field.id === activeFieldId.value)) {
      activeFieldId.value = fields[0]?.id || 'material'
    }
  },
  { immediate: true },
)

const activeField = computed(() => reviewFields.value.find((field) => field.id === activeFieldId.value) || reviewFields.value[0] || null)

const evidenceExcerpt = computed(() => {
  const record = primaryRecord.value
  return record?.evidence
    || record?.notes
    || record?.source
    || 'Select a field on the left to inspect the exact source location in the document.'
})

const highlightedExcerpt = computed(() => {
  const fieldValue = activeField.value?.value && activeField.value.value !== 'Not captured yet'
    ? activeField.value.value
    : ''

  if (!fieldValue) return evidenceExcerpt.value

  const escaped = fieldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return evidenceExcerpt.value.replace(
    new RegExp(escaped, 'g'),
    `<mark class="rounded-[0.2rem] bg-[#e8ebff] px-0.5 text-[#2d43c6]">${fieldValue}</mark>`,
  )
})

const evidenceHits = computed<EvidenceHit[]>(() => {
  if (props.highlightData.length) {
    return props.highlightData.slice(0, 8).map((item, index) => ({
      id: item.id,
      label: `Highlight ${index + 1}`,
      meta: `Page ${item.page} • x ${Math.round(item.coords.x)}, y ${Math.round(item.coords.y)}`,
    }))
  }

  const record = primaryRecord.value
  if (record?.source_page) {
    return [{
      id: 'source-page',
      label: 'Source Page',
      meta: `Page ${record.source_page}`,
    }]
  }

  return []
})

const reviewTitle = computed(() => activeDocumentName.value)
const reviewKicker = computed(() => {
  if (!primaryRecord.value) return 'VERIFY EXTRACTED RECORDS AGAINST EVIDENCE.'
  return primaryRecord.value.validationStatus === 'verified'
    ? 'FIELD CONFIRMATION IS READY FOR FINAL REVIEW.'
    : 'VERIFY EXTRACTED RECORDS AGAINST EVIDENCE.'
})

function present(value: unknown) {
  const text = String(value ?? '').trim()
  return text || 'Not captured yet'
}

function fieldState(value: unknown): ReviewField['status'] {
  const text = String(value ?? '').trim()
  if (!text) return 'low_conf'
  if (text.length <= 5) return 'review'
  return 'confirmed'
}

function missingIssue(label: string, value: unknown) {
  return String(value ?? '').trim() ? undefined : `The ${label} field still needs grounding confirmation.`
}

function summarizeConditions(record: TribologyData) {
  const parts = [record.load, record.speed, record.temperature].map((item) => String(item || '').trim()).filter(Boolean)
  return parts.length ? parts.join(' • ') : 'Not captured yet'
}

function statusTone(status: QueueItem['status']) {
  if (status === 'confirmed') return 'bg-[#e8fff2] text-[#0b9d63]'
  if (status === 'in_progress') return 'bg-[#edf2ff] text-[#3d56d2]'
  return 'bg-[#f4f6fb] text-[#5d708e]'
}

function statusLabel(status: QueueItem['status']) {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'in_progress') return 'In Progress'
  return 'Pending'
}

function fieldTone(field: ReviewField) {
  if (field.id === activeFieldId.value) return 'border-[#aebdfc] bg-[#f7f9ff]'
  if (field.status === 'confirmed') return 'border-[#dcefe6] bg-white'
  if (field.status === 'low_conf') return 'border-[#ffd6a0] bg-white'
  return 'border-[#dbe4f2] bg-white'
}

function fieldBadge(status: ReviewField['status']) {
  if (status === 'confirmed') return { label: 'Confirmed', className: 'bg-[#e8fff2] text-[#0b9d63]' }
  if (status === 'low_conf') return { label: 'Low Conf', className: 'bg-[#fff4da] text-[#d38a11]' }
  return { label: 'Review', className: 'bg-[#f3f6fb] text-[#5c708d]' }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
    <section class="shell-surface px-4 py-3.5 sm:px-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="tab in reviewTabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition"
            :class="currentSection === tab.key
              ? 'border-transparent bg-[#101b29] text-white shadow-[0_16px_34px_-24px_rgba(15,23,42,0.9)]'
              : 'border-black/8 bg-white text-slate-600 hover:bg-[#f8fbff] hover:text-slate-900'"
            @click="emit('change-section', tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-black/8 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
            @click="emit('open-pipeline')"
          >
            Back To Pipeline
          </button>
          <button
            type="button"
            class="inline-flex items-center rounded-full border border-black/8 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
            @click="emit('open-knowledge')"
          >
            Open Knowledge
          </button>
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[21rem_minmax(0,1fr)_30rem]">
      <aside class="shell-surface min-h-0 overflow-hidden">
        <div class="border-b border-black/8 px-5 py-5">
          <div class="flex items-center justify-between gap-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">INBOX QUEUE</p>
            <span class="inline-flex h-7 min-w-7 items-center justify-center rounded-[0.6rem] bg-[#eef2ff] px-2 text-sm font-semibold text-[#5061d1]">
              {{ queueItems.length }}
            </span>
          </div>

          <div class="mt-3 relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model="query"
              type="text"
              class="h-10 w-full rounded-[0.85rem] border border-[#d9e2ef] bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#b7c6ef]"
              placeholder="Filter documents..."
            >
          </div>

          <label class="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input v-model="prioritizeLowConfidence" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-[#ef3958] focus:ring-[#ef3958]" >
            Prioritize Low Confidence
          </label>
        </div>

        <div class="min-h-0 space-y-2 overflow-y-auto px-4 py-4">
          <button
            v-for="item in queueItems"
            :key="item.id"
            type="button"
            class="w-full rounded-[1rem] border px-4 py-4 text-left transition"
            :class="item.selected
              ? 'border-[#aebdfc] bg-[#f7f9ff] shadow-[0_18px_42px_-34px_rgba(74,87,223,0.5)]'
              : 'border-transparent bg-white hover:border-[#dbe4f2] hover:bg-[#fbfcff]'"
            @click="item.id !== 'empty' && emit('select-file', item.id)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-[0.98rem] font-semibold tracking-[-0.03em] text-slate-950">{{ item.name }}</p>
                <p class="mt-3 text-sm text-slate-500">{{ item.entityCount }} entities</p>
              </div>
              <AlertTriangle v-if="item.alert" class="mt-1 h-4 w-4 shrink-0 text-[#f5a623]" />
            </div>

            <div class="mt-3 flex items-center justify-between gap-3">
              <span class="inline-flex rounded-[0.55rem] px-2.5 py-1 text-sm font-semibold" :class="statusTone(item.status)">
                {{ statusLabel(item.status) }}
              </span>
            </div>
          </button>
        </div>
      </aside>

      <section class="shell-surface min-h-0 overflow-hidden">
        <div class="border-b border-black/8 px-5 py-5">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="max-w-[18ch] text-[2rem] font-semibold leading-[1.05] tracking-[-0.06em] text-slate-950">
                {{ reviewTitle }}
              </h2>
              <p class="mt-3 text-[13px] font-medium uppercase tracking-[0.12em] text-[#6c84aa]">
                {{ reviewKicker }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <button type="button" class="inline-flex items-center gap-2 rounded-[0.9rem] border border-[#d9e2ef] bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-[#f8fbff]">
                <Flag class="h-4 w-4" />
                Escalate Document
              </button>
              <button type="button" class="inline-flex items-center gap-2 rounded-[0.9rem] bg-[linear-gradient(135deg,#5b56ea_0%,#4a57df_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_22px_44px_-28px_rgba(74,87,223,0.82)] transition hover:brightness-105">
                <CheckCheck class="h-4 w-4" />
                Approve All
              </button>
            </div>
          </div>
        </div>

        <div class="min-h-0 space-y-4 overflow-y-auto px-5 py-5">
          <article
            v-for="field in reviewFields"
            :key="field.id"
            class="cursor-pointer rounded-[1.2rem] border p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,0.22)] transition"
            :class="fieldTone(field)"
            @click="activeFieldId = field.id"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6c84aa]">{{ field.label }}</p>
                  <span class="inline-flex rounded-[0.55rem] px-2.5 py-1 text-xs font-semibold" :class="fieldBadge(field.status).className">
                    {{ fieldBadge(field.status).label }}
                  </span>
                </div>
                <p class="mt-4 text-[1.05rem] font-medium text-slate-950">{{ field.value }}</p>
              </div>

              <div class="flex shrink-0 items-center gap-2 text-slate-400">
                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-[#f3f6fb] transition hover:text-slate-700">
                  <Pencil class="h-4 w-4" />
                </button>
                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-[#f3f6fb] transition hover:text-slate-700">
                  <Flag class="h-4 w-4" />
                </button>
                <button type="button" class="inline-flex items-center rounded-[0.7rem] border border-[#d9e2ef] bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]">
                  Confirm
                </button>
              </div>
            </div>

            <div
              v-if="field.issue"
              class="mt-4 rounded-[0.85rem] border border-[#ffd4da] bg-[#fff5f6] px-3.5 py-3 text-sm text-[#ef3958]"
            >
              {{ field.issue }}
            </div>
          </article>
        </div>
      </section>

      <aside class="shell-surface min-h-0 overflow-hidden">
        <div class="border-b border-black/8 px-5 py-5">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <Quote class="h-4 w-4 text-[#8ea2c0]" />
              <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">EVIDENCE GROUNDING</p>
            </div>
            <Search class="h-4 w-4 text-slate-400" />
          </div>
        </div>

        <div class="min-h-0 overflow-y-auto px-5 py-6">
          <p class="max-w-[28rem] text-[13px] leading-7 text-[#7d8faf] italic">
            {{ activeField ? `Focus: ${activeField.label}` : 'Select a field on the left to inspect grounding evidence.' }}
          </p>

          <div class="mt-7 border-l border-[#e7ecf5] pl-5">
            <p class="font-serif text-[1.02rem] leading-10 text-[#1e2b45]" v-html="highlightedExcerpt" />
          </div>

          <div class="mt-8">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Evidence Hits</p>
            <div class="mt-3 space-y-2">
              <div
                v-for="hit in evidenceHits"
                :key="hit.id"
                class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600"
              >
                <p class="font-semibold text-slate-900">{{ hit.label }}</p>
                <p class="mt-1 text-sm text-slate-500">{{ hit.meta }}</p>
              </div>
              <div
                v-if="!evidenceHits.length"
                class="rounded-[0.95rem] border border-dashed border-[#dbe4f2] bg-[#fbfcff] px-3.5 py-3 text-sm text-slate-500"
              >
                No grounded page hits are attached to the current record yet.
              </div>
            </div>
          </div>

          <div class="mt-8 grid gap-2">
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Scope</span>
              {{ activeScopeLabel }}
            </div>
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Highlights</span>
              {{ highlightCount || highlightData.length }}
            </div>
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Source</span>
              {{ pdfUrl ? 'PDF linked' : 'Awaiting source PDF' }}
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
