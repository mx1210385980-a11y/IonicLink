<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

import { BookOpen, Check } from 'lucide-vue-next'
import ConditionMicrobar from '@/components/integrated-explorer/ConditionMicrobar.vue'
import LubricantRecipeCell from '@/components/integrated-explorer/LubricantRecipeCell.vue'
import TribopairCapsule from '@/components/integrated-explorer/TribopairCapsule.vue'
import type { RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  compactRecordDisplayId,
  recordDisplayId,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  loading: boolean
  records: RecordResponse[]
  rowNumberStart?: number
  focusRecordId?: number | null
  focusEntityType?: 'record' | 'candidate' | null
  deletingRowId: number | null
  structurePreviewOpen: boolean
  structurePreviewRowId: number | null
  selectedIds: Set<number>
  openEvidenceModal: (
    record: RecordResponse,
    field?: 'ionic-liquid' | 'tribopair' | 'conditions' | 'cof',
    event?: MouseEvent | KeyboardEvent,
    fieldKey?: string,
  ) => void
  openLiterature?: (record: RecordResponse) => void
  openStructurePreview: (record: RecordResponse) => void
}>()

const emit = defineEmits<{
  'toggle-select': [recordId: number]
  'toggle-select-page': [select: boolean]
}>()

// Virtual scrolling configuration
const ROW_HEIGHT = 160 // Estimated row height in pixels
const OVERSCAN = 5     // Number of items to render outside visible area
const COL_SELECT = 'w-[48px]'
const COL_ID = 'w-[56px]'
const COL_IONIC = 'w-[280px]'
const COL_TRIBOPAIR = 'w-[240px]'
const COL_CONDITIONS = 'w-[304px]'
const COL_COF = 'w-[126px]'
const COL_LITERATURE = 'w-[210px]'

const parentRef = ref<HTMLElement | null>(null)

// Create virtualizer instance
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.loading ? 8 : props.records.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index: number) => {
      if (props.loading) return `skeleton-${index}`
      return props.records[index]?.id ?? index
    },
  })),
)

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())
const visibleRecordRows = computed(() =>
  virtualRows.value.flatMap((virtualRow) => {
    const record = props.records[virtualRow.index]
    return record ? [{ virtualRow, record }] : []
  }),
)
function isCandidateRecord(record: RecordResponse) {
  return String(record.reviewEntityType || record.entityType || '').trim().toLowerCase() === 'candidate'
}
function recordEntityType(record: RecordResponse) {
  return String(record.reviewEntityType || record.entityType || 'record').trim().toLowerCase()
}
function recordMatchesFocusEntity(record: RecordResponse) {
  const targetEntityType = String(props.focusEntityType || '').trim().toLowerCase()
  return !targetEntityType || recordEntityType(record) === targetEntityType
}
const focusedRecordIndex = computed(() => {
  if (props.focusRecordId == null) return -1
  return props.records.findIndex((record) => Number(record.id) === Number(props.focusRecordId) && recordMatchesFocusEntity(record))
})
const pageRecordIds = computed(() =>
  props.records
    .filter((record) => !isCandidateRecord(record))
    .map((record) => Number(record.id))
    .filter((id) => Number.isFinite(id)),
)
const pageScrollKey = computed(() => pageRecordIds.value.join('|'))
const selectedOnPageCount = computed(() =>
  pageRecordIds.value.filter((id) => props.selectedIds.has(id)).length,
)
const allPageSelected = computed(() =>
  pageRecordIds.value.length > 0 && selectedOnPageCount.value === pageRecordIds.value.length,
)
const somePageSelected = computed(() =>
  selectedOnPageCount.value > 0 && !allPageSelected.value,
)
function isFocusedRecord(record: RecordResponse) {
  return props.focusRecordId != null && Number(record.id) === Number(props.focusRecordId) && recordMatchesFocusEntity(record)
}

watch(
  focusedRecordIndex,
  async (focusedIndex) => {
    if (focusedIndex < 0) return
    await nextTick()
    virtualizer.value.scrollToIndex(focusedIndex)
  },
  { immediate: true },
)

watch(
  pageScrollKey,
  async () => {
    if (props.loading || focusedRecordIndex.value >= 0) return
    await nextTick()
    virtualizer.value.scrollToOffset(0)
  },
)

function literatureTitle(record: RecordResponse) {
  return record.literature?.title || `Literature ${record.literatureId || '--'}`
}

function literatureMeta(record: RecordResponse) {
  const journal = String(record.literature?.journal || '').trim()
  const year = record.literature?.year ? String(record.literature.year) : ''
  if (journal && year) return `${journal} (${year})`
  return journal || year || 'Open in library'
}

// Expose scroll methods for external control
defineExpose({
  scrollToIndex: (index: number) => virtualizer.value.scrollToIndex(index),
  scrollToTop: () => virtualizer.value.scrollToOffset(0),
})
</script>

<template>
  <div class="virtual-table-container database-record-table flex flex-col overflow-x-auto overflow-y-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85 dark:shadow-[0_10px_30px_rgba(2,8,23,0.35)]">
    <!-- Fixed Header -->
    <div class="virtual-table-header min-w-[1264px] shrink-0 border-b border-slate-200 bg-[linear-gradient(180deg,#fcfeff_0%,#f7fafc_100%)] text-[0.68rem] font-black uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      <div class="flex items-center">
        <div :class="COL_SELECT" class="shrink-0 px-3 py-3.5">
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md border text-slate-400 transition hover:border-[#0f7c82] hover:bg-[#eefafa] hover:text-[#0f7c82]"
            :class="allPageSelected || somePageSelected ? 'border-[#0f7c82] bg-[#eefafa] text-[#0f7c82]' : 'border-slate-300 bg-white'"
            aria-label="Select all records on this page"
            :aria-pressed="allPageSelected"
            @click="emit('toggle-select-page', !allPageSelected)"
          >
            <Check v-if="allPageSelected" class="h-4 w-4 stroke-[3]" />
            <span v-else-if="somePageSelected" class="h-1.5 w-1.5 rounded-full bg-current" />
          </button>
        </div>
        <div :class="COL_ID" class="shrink-0 px-3 py-3.5 text-center"><span class="column-ruler-label justify-center"><span class="column-ruler-mark" />#</span></div>
        <div :class="COL_IONIC" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />IONIC LIQUID</span></div>
        <div :class="COL_TRIBOPAIR" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />TRIBOPAIR</span></div>
        <div :class="COL_CONDITIONS" class="shrink-0 px-3 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />CONDITIONS</span></div>
        <div :class="COL_COF" class="shrink-0 px-4 py-3.5 text-[#0f7c82]"><span class="column-ruler-label column-ruler-label--metric"><span class="column-ruler-mark" />COF</span></div>
        <div :class="COL_LITERATURE" class="shrink-0 px-4 py-3.5"><span class="column-ruler-label"><span class="column-ruler-mark" />LITERATURE</span></div>
      </div>
    </div>

    <!-- Scrollable Body with Virtual Scrolling -->
    <div
      ref="parentRef"
      class="virtual-table-body min-w-[1264px] flex-1 overflow-y-auto overflow-x-hidden"
      style="height: calc(100vh - 420px); min-height: 300px; max-height: 600px;"
    >
      <!-- Empty State -->
      <div v-if="!loading && records.length === 0" class="flex h-full items-center justify-center py-16">
        <div class="text-center text-slate-400 dark:text-slate-500">
          No records found
        </div>
      </div>

      <div
        class="virtual-table-list relative w-full"
        :style="{ height: `${totalSize}px` }"
      >
        <template v-if="loading">
          <template v-for="virtualRow in virtualRows" :key="String(virtualRow.key)">
            <div
              class="virtual-skeleton-row absolute left-0 top-0 flex w-full items-center border-b border-slate-100 px-4 dark:border-slate-800"
              :style="{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <div class="flex w-full animate-pulse items-center gap-4">
                <!-- ID skeleton -->
                <div :class="COL_SELECT" class="shrink-0">
                  <div class="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-700" />
                </div>
                <div :class="COL_ID" class="shrink-0">
                  <div class="h-4 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <!-- Ionic Liquid skeleton -->
                <div :class="COL_IONIC" class="shrink-0">
                  <div class="flex items-center gap-2">
                    <div class="h-8 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                    <div class="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- Tribopair skeleton -->
                <div :class="COL_TRIBOPAIR" class="shrink-0">
                  <div class="flex flex-col gap-1.5">
                    <div class="h-6 w-32 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-36 rounded-md bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- Conditions skeleton -->
                <div :class="COL_CONDITIONS" class="shrink-0">
                  <div class="flex gap-1.5">
                    <div class="h-6 w-20 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-16 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-24 rounded-md bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- COF skeleton -->
                <div :class="COL_COF" class="shrink-0">
                  <div class="h-5 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <!-- Literature skeleton -->
                <div :class="COL_LITERATURE" class="shrink-0">
                  <div class="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="mt-2 h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            </div>
          </template>
        </template>

        <template v-else>
          <template v-for="{ virtualRow, record } in visibleRecordRows" :key="String(virtualRow.key)">
            <div
              class="virtual-record-row group absolute left-0 top-0 flex w-full items-start border-b border-slate-100 transition-colors hover:bg-[#f8fcfd] dark:border-slate-800 dark:hover:bg-slate-900/70"
              :class="isFocusedRecord(record) ? 'database-focus-record bg-amber-50/80 ring-2 ring-amber-300/70 ring-inset dark:bg-amber-400/10 dark:ring-amber-300/35' : ''"
              :aria-current="isFocusedRecord(record) ? 'true' : undefined"
              :style="{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <!-- Selection Column -->
              <div :class="COL_SELECT" class="shrink-0 self-center px-3 py-4">
                <button
                  type="button"
                  class="inline-flex h-7 w-7 items-center justify-center rounded-md border transition hover:border-[#0f7c82] hover:bg-[#eefafa] hover:text-[#0f7c82]"
                  :class="selectedIds.has(Number(record.id)) ? 'border-[#0f7c82] bg-[#0f7c82] text-white shadow-sm' : 'border-slate-300 bg-white text-transparent'"
                  aria-label="Select record"
                  :aria-pressed="selectedIds.has(Number(record.id))"
                  :disabled="isCandidateRecord(record)"
                  :title="isCandidateRecord(record) ? 'Review candidates before batch deletion' : 'Select record'"
                  @click.stop="emit('toggle-select', Number(record.id))"
                  @dblclick.stop
                >
                  <Check class="h-4 w-4 stroke-[3]" />
                </button>
              </div>

              <!-- ID Column -->
              <div :class="COL_ID" class="shrink-0 self-center px-2 py-4 text-center">
                <span
                  class="inline-flex h-6 min-w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[12px] font-bold leading-none text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
                  :title="recordDisplayId(record)"
                >
                  {{ compactRecordDisplayId(record) }}
                </span>
                <span
                  v-if="isCandidateRecord(record)"
                  class="mt-1 inline-flex max-w-full items-center justify-center rounded border border-amber-200 bg-amber-50 px-1 text-[9px] font-black uppercase leading-4 text-amber-700"
                  title="Candidate row, not yet promoted to library record"
                >
                  Candidate
                </span>
              </div>

              <!-- Ionic Liquid Column -->
              <div :class="COL_IONIC" class="shrink-0 px-4 py-4">
                <div
                  class="workspace-card cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
                  tabindex="0"
                  aria-label="Open ionic liquid evidence"
                  title="Open field evidence"
                  @click.stop="openEvidenceModal(record, 'ionic-liquid', $event)"
                  @keydown.enter.prevent.stop="openEvidenceModal(record, 'ionic-liquid', $event)"
                >
                  <LubricantRecipeCell
                    :record="record"
                    :active="structurePreviewOpen && structurePreviewRowId === record.id"
                    @open-structure="openStructurePreview"
                    @open-evidence="(fieldKey, event) => openEvidenceModal(record, 'ionic-liquid', event, fieldKey)"
                  />
                </div>
              </div>

              <!-- Tribopair Column -->
              <div :class="COL_TRIBOPAIR" class="shrink-0 px-4 py-3">
                <div
                  class="workspace-card cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
                  tabindex="0"
                  aria-label="Open tribopair evidence"
                  title="Open field evidence"
                  @click.stop="openEvidenceModal(record, 'tribopair', $event)"
                  @keydown.enter.prevent.stop="openEvidenceModal(record, 'tribopair', $event)"
                >
                  <TribopairCapsule
                    :record="record"
                    @open-evidence="(fieldKey, event) => openEvidenceModal(record, 'tribopair', event, fieldKey)"
                  />
                </div>
              </div>

              <!-- Conditions Column -->
              <div :class="COL_CONDITIONS" class="flex shrink-0 justify-center px-3 py-3">
                <div
                  class="workspace-card block w-fit max-w-[296px] cursor-pointer rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
                  tabindex="0"
                  aria-label="Open conditions evidence"
                  title="Open field evidence"
                  @click.stop="openEvidenceModal(record, 'conditions', $event)"
                  @keydown.enter.prevent.stop="openEvidenceModal(record, 'conditions', $event)"
                >
                  <ConditionMicrobar
                    :record="record"
                    @open-evidence="(fieldKey, event) => openEvidenceModal(record, 'conditions', event, fieldKey)"
                  />
                </div>
              </div>

              <!-- COF Column -->
              <div :class="COL_COF" class="shrink-0 self-center px-4 py-4">
                <div
                  class="workspace-card cursor-pointer rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f7c82]/35"
                  tabindex="0"
                  aria-label="Open COF evidence"
                  title="Open field evidence"
                  @click.stop="openEvidenceModal(record, 'cof', $event)"
                  @keydown.enter.prevent.stop="openEvidenceModal(record, 'cof', $event)"
                >
                  <div class="text-[clamp(1.05rem,0.95rem+0.28vw,1.28rem)] font-extrabold leading-none text-blue-600">{{ cofDisplay(record) }}</div>
                </div>
              </div>

              <!-- Literature Column -->
              <div :class="COL_LITERATURE" class="shrink-0 self-center px-4 py-3">
                <button
                  type="button"
                  class="group flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-[#0f7c82]/35 hover:bg-[#f3fbfc] dark:border-slate-700 dark:bg-slate-950 dark:hover:border-[#0f7c82]/40 dark:hover:bg-slate-900"
                  :title="literatureTitle(record)"
                  aria-label="Open literature"
                  @click.stop="openLiterature?.(record)"
                >
                  <BookOpen class="h-4 w-4 shrink-0 text-[#0f7c82]" />
                  <span class="min-w-0">
                    <span class="block truncate text-[13px] font-extrabold leading-4 text-slate-800 group-hover:text-[#0f7c82] dark:text-slate-100">{{ literatureTitle(record) }}</span>
                    <span class="block truncate text-[11.5px] font-semibold leading-4 text-slate-500 dark:text-slate-400">{{ literatureMeta(record) }}</span>
                  </span>
                </button>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Virtual Scroll Indicator (optional visual feedback) -->
    <div
      v-if="!loading && records.length > 10"
      class="shrink-0 border-t border-slate-100 bg-slate-50/80 px-4 py-2 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-500"
    >
      Showing {{ Math.min(virtualRows.length, records.length) }} of {{ records.length }} records (virtual scroll enabled)
    </div>
  </div>
</template>

<style scoped>
.virtual-table-container {
  min-height: 0;
}

.database-record-table {
  font-size: clamp(14px, 13px + 0.18vw, 16px);
}

.database-record-table .virtual-table-header {
  font-size: clamp(0.72rem, 0.68rem + 0.16vw, 0.84rem);
}

.virtual-table-body {
  will-change: scroll-position;
  -webkit-overflow-scrolling: touch;
}

.virtual-table-list {
  contain: layout;
}

.virtual-record-row,
.virtual-skeleton-row {
  contain: layout style;
  box-sizing: border-box;
}

.ionic-liquid-name :deep(sub) {
  font-size: 0.72em;
}

.condition-chip {
  max-width: 100%;
}

.workspace-card {
  transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.workspace-card:hover {
  transform: translateY(-1px);
}

.column-ruler-label {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  min-height: 1.25rem;
  color: #64748b;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.75);
  position: relative;
}

.column-ruler-label::after {
  content: "";
  position: absolute;
  left: 1rem;
  right: 0;
  bottom: -0.42rem;
  height: 1px;
  background: linear-gradient(90deg, rgba(15, 124, 130, 0.34), rgba(148, 163, 184, 0.08));
}

.column-ruler-mark {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: #0f7c82;
  box-shadow: 0 0 0 3px rgba(15, 124, 130, 0.1);
}

.column-ruler-label--metric {
  color: #0f7c82;
}

/* Smooth scrolling behavior */
.virtual-table-body {
  scroll-behavior: smooth;
}

/* Hide scrollbar on Windows but keep functionality */
.virtual-table-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.virtual-table-body::-webkit-scrollbar-track {
  background: transparent;
}

.virtual-table-body::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.4);
  border-radius: 4px;
}

.virtual-table-body::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.6);
}

/* Dark mode scrollbar */
:global(.dark) .virtual-table-body::-webkit-scrollbar-thumb {
  background-color: rgba(100, 116, 139, 0.4);
}

:global(.dark) .virtual-table-body::-webkit-scrollbar-thumb:hover {
  background-color: rgba(100, 116, 139, 0.6);
}
</style>
