<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

import { Edit, Eye, Trash2 } from 'lucide-vue-next'
import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { EvidenceResult, RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  conditionGroupClass,
  conditionGroups,
  confidenceDisplay,
  confidenceValueFor,
  formatIonicLiquidPartHtml,
  ionicLiquidParts,
  surfaceRoughnessBadge,
  surfaceRoughnessBadgeClass,
  tribopairParts,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  loading: boolean
  records: RecordResponse[]
  deletingRowId: number | null
  evidenceData: Record<number, EvidenceResult | null>
  structurePreviewOpen: boolean
  structurePreviewRowId: number | null
  openEvidenceModal: (record: RecordResponse) => void
  openEditModal: (record: RecordResponse) => void
  removeRecord: (record: RecordResponse) => void
  openStructurePreview: (record: RecordResponse) => void
}>()

// Virtual scrolling configuration
const ROW_HEIGHT = 132 // Estimated row height in pixels
const OVERSCAN = 5     // Number of items to render outside visible area

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

function roughnessBadge(record: RecordResponse) {
  return surfaceRoughnessBadge(record)
}

// Expose scroll methods for external control
defineExpose({
  scrollToIndex: (index: number) => virtualizer.value.scrollToIndex(index),
  scrollToTop: () => virtualizer.value.scrollToOffset(0),
})
</script>

<template>
  <div class="virtual-table-container flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85 dark:shadow-[0_10px_30px_rgba(2,8,23,0.35)]">
    <!-- Fixed Header -->
    <div class="virtual-table-header shrink-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
      <div class="flex items-center">
        <div class="w-[60px] shrink-0 px-4 py-4 font-medium">ID</div>
        <div class="w-[260px] shrink-0 px-4 py-4 font-medium">IONIC LIQUID</div>
        <div class="w-[240px] shrink-0 px-4 py-4 font-medium">TRIBOPAIR</div>
        <div class="min-w-0 flex-1 px-4 py-4 font-medium">CONDITIONS</div>
        <div class="w-[100px] shrink-0 px-4 py-4 font-medium text-blue-600">COF</div>
        <div class="w-[120px] shrink-0 px-4 py-4 text-right font-medium">ACTIONS</div>
      </div>
    </div>

    <!-- Scrollable Body with Virtual Scrolling -->
    <div
      ref="parentRef"
      class="virtual-table-body flex-1 overflow-auto"
      style="height: calc(100vh - 420px); min-height: 300px; max-height: 600px;"
    >
      <!-- Empty State -->
      <div v-if="!loading && records.length === 0" class="flex h-full items-center justify-center py-16">
        <div class="text-center text-slate-400 dark:text-slate-500">
          No records found
        </div>
      </div>

      <!-- Virtual List Container -->
      <div
        v-else
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
                <div class="w-[60px] shrink-0">
                  <div class="h-4 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <!-- Ionic Liquid skeleton -->
                <div class="w-[220px] shrink-0">
                  <div class="flex items-center gap-2">
                    <div class="h-8 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                    <div class="h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- Tribopair skeleton -->
                <div class="w-[240px] shrink-0">
                  <div class="flex flex-col gap-1.5">
                    <div class="h-6 w-32 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-36 rounded-md bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- Conditions skeleton -->
                <div class="min-w-0 flex-1">
                  <div class="flex gap-1.5">
                    <div class="h-6 w-20 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-16 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-6 w-24 rounded-md bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                <!-- COF skeleton -->
                <div class="w-[100px] shrink-0">
                  <div class="h-5 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="mt-1 h-3 w-12 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <!-- Actions skeleton -->
                <div class="w-[120px] shrink-0">
                  <div class="flex justify-end gap-1.5">
                    <div class="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700" />
                    <div class="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700" />
                    <div class="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>

        <template v-else>
          <template v-for="{ virtualRow, record } in visibleRecordRows" :key="String(virtualRow.key)">
            <div
              class="virtual-record-row absolute left-0 top-0 flex w-full items-start border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70"
              :style="{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <!-- ID Column -->
              <div class="w-[60px] shrink-0 self-center px-4 py-4 text-slate-500 dark:text-slate-400">
                {{ record.id }}
              </div>

              <!-- Ionic Liquid Column -->
              <div class="w-[260px] shrink-0 px-4 py-4">
                <div class="flex items-start gap-2">
                  <div v-if="record.cationSmiles || record.anionSmiles" class="shrink-0 flex gap-1 pt-0.5">
                    <button
                      v-if="record.cationSmiles"
                      type="button"
                      class="rounded-md transition hover:scale-[1.02]"
                      :class="structurePreviewOpen && structurePreviewRowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                      title="Show chemical structures"
                      @click.stop="openStructurePreview(record)"
                    >
                      <MoleculeViewer
                        :smiles="record.cationSmiles"
                        size="thumbnail"
                        :width="40"
                        :height="30"
                      />
                    </button>
                    <button
                      v-if="record.anionSmiles"
                      type="button"
                      class="rounded-md transition hover:scale-[1.02]"
                      :class="structurePreviewOpen && structurePreviewRowId === record.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
                      title="Show chemical structures"
                      @click.stop="openStructurePreview(record)"
                    >
                      <MoleculeViewer
                        :smiles="record.anionSmiles"
                        size="thumbnail"
                        :width="40"
                        :height="30"
                      />
                    </button>
                  </div>
                  <div class="ionic-liquid-name min-w-0 flex-1 font-semibold leading-5 text-slate-800 dark:text-slate-100">
                    <span
                      v-for="(part, partIndex) in ionicLiquidParts(record.lubricant || '--')"
                      :key="`${record.id}-il-${partIndex}-${part}`"
                      class="block whitespace-normal break-words"
                      v-html="formatIonicLiquidPartHtml(part)"
                    />
                  </div>
                </div>
              </div>

              <!-- Tribopair Column -->
              <div class="w-[240px] shrink-0 px-4 py-3">
                <div class="flex flex-col gap-1.5">
                  <div
                    class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                    :title="'Probe: ' + tribopairParts(record).probe"
                  >
                    <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Probe</span>
                    <span class="min-w-0 truncate text-[11.5px] font-semibold text-slate-700 dark:text-slate-200">
                      {{ tribopairParts(record).probe }}
                    </span>
                  </div>
                  <div
                    class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md bg-slate-800 px-2 py-1 shadow-sm dark:bg-slate-100"
                    :title="'Substrate: ' + tribopairParts(record).substrate"
                  >
                    <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Sub</span>
                    <span class="min-w-0 truncate text-[11.5px] font-semibold text-white dark:text-slate-900">
                      {{ tribopairParts(record).substrate }}
                    </span>
                  </div>
                  <div
                    v-if="tribopairParts(record).coating"
                    class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                    :title="'Coating: ' + tribopairParts(record).coating"
                  >
                    <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-500/70">Coat</span>
                    <span class="min-w-0 truncate text-[11.5px] font-semibold text-amber-800 dark:text-amber-300">
                      {{ tribopairParts(record).coating }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Conditions Column -->
              <div class="min-w-0 flex-1 px-4 py-3">
                <div class="flex flex-wrap items-center gap-1.5">
                  <div
                    v-for="group in conditionGroups(record)"
                    :key="group.key"
                    :title="group.title + ': ' + group.summary"
                    class="condition-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-semibold shadow-sm"
                    :class="conditionGroupClass(group.key)"
                  >
                    <span class="shrink-0 tracking-[0.08em]">{{ group.label }}</span>
                    <span class="min-w-0 truncate border-l border-current/20 pl-1.5 tracking-normal opacity-90">{{ group.summary }}</span>
                  </div>
                  <div
                    v-if="roughnessBadge(record)"
                    :title="'Surface Roughness: ' + roughnessBadge(record)?.label"
                    class="condition-chip inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-semibold shadow-sm"
                    :class="roughnessBadge(record) ? surfaceRoughnessBadgeClass(roughnessBadge(record)!.tone) : ''"
                  >
                    <span class="shrink-0 tracking-[0.08em]">ROUGH</span>
                    <span class="min-w-0 truncate border-l border-current/20 pl-1.5 tracking-normal opacity-90">{{ roughnessBadge(record)?.label }}</span>
                  </div>
                </div>
              </div>

              <!-- COF Column -->
              <div class="w-[100px] shrink-0 self-center px-4 py-4">
                <div class="font-bold text-blue-600">{{ cofDisplay(record) }}</div>
                <div class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                  Conf: {{ confidenceDisplay(confidenceValueFor(record, evidenceData[record.id])) }}
                </div>
              </div>

              <!-- Actions Column -->
              <div class="w-[120px] shrink-0 self-center px-4 py-4">
                <div class="flex items-center justify-end gap-1.5" @click.stop>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
                    title="Open evidence workspace"
                    @click="openEvidenceModal(record)"
                  >
                    <Eye class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    title="Edit extracted parameters"
                    @click="openEditModal(record)"
                  >
                    <Edit class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 transition hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
                    :disabled="deletingRowId === record.id"
                    title="Delete record"
                    @click="removeRecord(record)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
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
