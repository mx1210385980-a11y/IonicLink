<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

import { Edit, Eye, Trash2 } from 'lucide-vue-next'
import LubricantStructurePreview from '@/components/integrated-explorer/LubricantStructurePreview.vue'
import type { EvidenceResult, RecordResponse } from '@/lib/api'
import { canonicalExperimentScaleValue, experimentScaleBadgeClass, experimentScaleLabel } from '@/lib/experimentScale'
import {
  cofDisplay,
  type DetailedConditionChip,
  type ConditionGroupTone,
  confidenceDisplay,
  confidenceValueFor,
  conditionChipDisplayParts,
  detailedConditionChips,
  formatIonicLiquidPartHtml,
  ionicLiquidParts,
  lubricantAliasDisplay,
  type LubricantDisplayLine,
  lubricantDisplayRows,
  lubricantTooltip,
  surfaceRoughnessBadge,
  tribopairExtras,
  tribopairParts,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  loading: boolean
  records: RecordResponse[]
  deletingRowId: number | null
  evidenceData: Record<number, EvidenceResult | null>
  structurePreviewOpen: boolean
  structurePreviewRowId: number | null
  focusRecordId?: number | null
  selectedIds?: Set<number>
  rowNumberStart?: number
  openEvidenceModal: (record: RecordResponse) => void
  openReviewRecord?: (record: RecordResponse) => void
  openEditModal: (record: RecordResponse) => void
  removeRecord: (record: RecordResponse) => void
  openStructurePreview: (record: RecordResponse) => void
}>()

const emit = defineEmits<{
  'toggle-select': [recordId: number]
  'toggle-select-page': [select: boolean]
}>()

function isSelected(recordId: number): boolean {
  return Boolean(props.selectedIds?.has(Number(recordId)))
}

function displayRowNumber(index: number): number {
  return Number(props.rowNumberStart || 1) + index
}

const allOnPageSelected = computed(() => {
  if (!props.records?.length || !props.selectedIds) return false
  return props.records.every((r) => props.selectedIds!.has(Number(r.id)))
})
const someOnPageSelected = computed(() => {
  if (!props.records?.length || !props.selectedIds) return false
  return props.records.some((r) => props.selectedIds!.has(Number(r.id))) && !allOnPageSelected.value
})

// Virtual scrolling configuration
// 行内会同时渲染长离子液体名、结构缩略图、文献卡片和多组条件芯片。
// 估算偏小会让绝对定位的虚拟行互相覆盖，看起来像重复记录。
const ROW_HEIGHT = 264 // Estimated row height in pixels
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

// 当 focusRecordId 出现在当前页时，自动滚动到该行
watch(
  [() => props.focusRecordId, () => props.records, () => props.loading],
  async ([id, records, isLoading]) => {
    if (id == null || isLoading) return
    const targetIndex = (records as RecordResponse[]).findIndex((r) => Number(r?.id) === Number(id))
    if (targetIndex < 0) return
    await nextTick()
    try {
      virtualizer.value.scrollToIndex(targetIndex, { align: 'center' })
    } catch {
      // 虚拟滚动还没初始化好，忽略
    }
  },
  { immediate: true },
)
const visibleRecordRows = computed(() =>
  virtualRows.value.flatMap((virtualRow) => {
    const record = props.records[virtualRow.index]
    return record ? [{ virtualRow, record }] : []
  }),
)

function roughnessBadge(record: RecordResponse) {
  return surfaceRoughnessBadge(record)
}

function lubricantLineClass(line: LubricantDisplayLine): string {
  if (line.kind === 'ratio') return 'mt-1'
  return line.emphasis === 'secondary'
    ? 'text-[12.5px] font-semibold leading-[1.12] text-slate-500 dark:text-slate-400'
    : 'text-[15px] font-bold leading-[1.16] text-slate-900 dark:text-slate-100'
}

// 跟踪哪些行展开了"常规条件"（室温/0V等默认折叠的芯片）
const expandedCommonRows = ref<Set<number>>(new Set())
function isCommonExpanded(recordId: number | null | undefined): boolean {
  if (recordId == null) return false
  return expandedCommonRows.value.has(Number(recordId))
}
function toggleCommonExpand(recordId: number | null | undefined) {
  if (recordId == null) return
  const id = Number(recordId)
  const next = new Set(expandedCommonRows.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedCommonRows.value = next
}

function notableConditionChips(record: RecordResponse) {
  return detailedConditionChips(record).filter((chip) => !chip.shortcut)
}
function commonConditionChips(record: RecordResponse) {
  return detailedConditionChips(record).filter((chip) => Boolean(chip.shortcut))
}

function conditionToneLabelClass(tone: ConditionGroupTone): string {
  const classes: Record<ConditionGroupTone, string> = {
    env: 'text-sky-700 dark:text-sky-300',
    dyn: 'text-violet-700 dark:text-violet-300',
    surf: 'text-emerald-700 dark:text-emerald-300',
  }
  return classes[tone]
}

function conditionDisplayValue(chip: DetailedConditionChip, fallback?: string): string {
  return conditionChipDisplayParts(chip, fallback).value
}

function conditionDisplayUnit(chip: DetailedConditionChip, fallback?: string): string {
  return conditionChipDisplayParts(chip, fallback).unit
}

function conditionDisplayLabel(chip: DetailedConditionChip, fallback?: string): string {
  return conditionChipDisplayParts(chip, fallback).label
}

function recordExperimentScaleValue(record: RecordResponse): string {
  return canonicalExperimentScaleValue(
    record.experimentScale
    || record.experimentProfile?.scale
    || record.tribologicalSystem?.scale,
  )
}

function recordExperimentScaleLabel(record: RecordResponse): string {
  const value = recordExperimentScaleValue(record)
  return value ? experimentScaleLabel(value) : ''
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
    <div class="virtual-table-header shrink-0 border-b border-slate-100 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div class="record-table-grid items-center">
        <div class="flex items-center justify-center px-2 py-4">
          <input
            type="checkbox"
            class="h-4 w-4 cursor-pointer rounded border-slate-300 text-[#5b56ea] focus:ring-[#5b56ea]"
            :checked="allOnPageSelected"
            :indeterminate.prop="someOnPageSelected"
            :disabled="!records.length"
            title="全选 / 取消本页全部"
            @change="(e: any) => emit('toggle-select-page', !!e.target.checked)"
          >
        </div>
        <div class="whitespace-nowrap px-3 py-4 font-medium">序号</div>
        <div class="min-w-0 whitespace-nowrap px-3 py-4 font-medium">离子液体</div>
        <div class="min-w-0 whitespace-nowrap px-2 py-4 font-medium">摩擦副</div>
        <div class="min-w-0 whitespace-nowrap px-3 py-4 font-medium">实验条件</div>
        <div class="cof-sticky-header whitespace-nowrap px-3 py-4 text-right font-bold text-blue-600">COF / 操作</div>
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
          暂无符合条件的记录
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
              class="virtual-skeleton-row record-table-grid absolute left-0 top-0 w-full items-center border-b border-slate-100 dark:border-slate-800"
              :style="{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <div class="flex justify-center px-2">
                <div class="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div class="px-3">
                <div class="h-4 w-10 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div class="min-w-0 px-3">
                <div class="flex animate-pulse flex-col gap-2">
                  <div class="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="flex gap-1.5">
                    <div class="h-7 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                    <div class="h-7 w-10 rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                  <div class="h-8 w-full rounded-md bg-slate-200/80 dark:bg-slate-700/80" />
                </div>
              </div>
              <div class="min-w-0 px-2">
                <div class="flex animate-pulse flex-col gap-1.5">
                  <div class="h-6 w-full max-w-28 rounded-md bg-slate-200 dark:bg-slate-700" />
                  <div class="h-6 w-full max-w-32 rounded-md bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
              <div class="min-w-0 px-3">
                <div class="flex animate-pulse flex-wrap gap-2">
                  <div class="h-8 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  <div class="h-8 w-28 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  <div class="h-8 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
              <div class="metric-rail cof-sticky-rail h-full px-3">
                <div class="flex h-full animate-pulse flex-col items-end justify-center gap-2">
                  <div class="h-5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="h-3 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="flex justify-end gap-1">
                    <div class="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-700" />
                    <div class="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>

        <template v-else>
          <template v-for="{ virtualRow, record } in visibleRecordRows" :key="String(virtualRow.key)">
            <div
              class="virtual-record-row record-table-grid absolute left-0 top-0 w-full items-stretch border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/70"
              :class="[
                focusRecordId != null && Number(record.id) === Number(focusRecordId) ? 'ring-2 ring-amber-400 bg-amber-50/70 dark:bg-amber-900/20' : '',
                isSelected(record.id) ? 'bg-[#f5f7ff] hover:bg-[#eef0ff] dark:bg-[#5b56ea]/10' : '',
              ]"
              :style="{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <!-- Selection Column -->
              <div class="flex min-w-0 items-center justify-center px-2 py-4">
                <input
                  type="checkbox"
                  class="h-4 w-4 cursor-pointer rounded border-slate-300 text-[#5b56ea] focus:ring-[#5b56ea]"
                  :checked="isSelected(record.id)"
                  @change="emit('toggle-select', Number(record.id))"
                  @click.stop
                >
              </div>
              <!-- ID Column -->
              <div class="flex min-w-0 items-center px-3 py-4 text-slate-500 dark:text-slate-400">
                <span class="flex flex-col items-start gap-0.5">
                  {{ displayRowNumber(virtualRow.index) }}
                  <span
                    v-if="focusRecordId != null && Number(record.id) === Number(focusRecordId)"
                    class="rounded-md bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm"
                  >已定位</span>
                </span>
              </div>

              <!-- Ionic Liquid Column -->
              <div class="min-w-0 px-3 py-3.5">
                <div class="flex min-w-0 flex-col gap-2">
                  <div
                    class="ionic-liquid-name flex min-w-0 flex-col gap-0.5 text-[15px] font-semibold leading-[1.2] text-slate-800 dark:text-slate-100"
                    :title="lubricantTooltip(record)"
                  >
                    <span
                      v-for="(line, lineIndex) in lubricantDisplayRows(record)"
                      :key="`${record.id}-il-line-${lineIndex}-${line.text}`"
                      class="block max-w-full break-words"
                      :class="lubricantLineClass(line)"
                    >
                      <template v-if="line.kind === 'ratio'">
                        <span class="inline-flex items-center gap-1.5 rounded-[0.25rem] bg-[#f8fafc] px-1.5 py-[2px] text-[9.5px] font-bold text-[#475569] shadow-[inset_0_0_0_1px_rgba(226,232,240,1)] dark:bg-slate-800 dark:text-slate-300 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,1)]">
                          <span class="text-[8.5px] font-black uppercase tracking-wider text-[#94a3b8] dark:text-slate-500">Ratio</span>
                          {{ line.text.slice(1, -1) }}
                        </span>
                      </template>
                      <template v-else>
                        <span
                          v-for="(part, partIndex) in ionicLiquidParts(line.text)"
                          :key="`${record.id}-il-${lineIndex}-${partIndex}-${part}`"
                          class="inline whitespace-normal break-words"
                          v-html="formatIonicLiquidPartHtml(part)"
                        />
                      </template>
                    </span>
                    <span
                      v-if="lubricantAliasDisplay(record)"
                      class="mt-1 inline-flex w-fit max-w-full items-center gap-1.5 rounded-[0.25rem] border border-amber-200 bg-amber-50 px-1.5 py-[2px] text-[9.5px] font-bold leading-none text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      <span class="shrink-0 text-[8.5px] font-black uppercase tracking-wider text-amber-600/80 dark:text-amber-300/80">Alias</span>
                      <span class="min-w-0 truncate">{{ lubricantAliasDisplay(record) }}</span>
                    </span>
                  </div>
                  <LubricantStructurePreview
                    :record="record"
                    :active="structurePreviewOpen && structurePreviewRowId === record.id"
                    @open="openStructurePreview"
                  />
                  <button
                    v-if="record.literature"
                    type="button"
                    class="literature-inline-card text-left"
                    :title="record.literature.title || undefined"
                    @click.stop="openReviewRecord ? openReviewRecord(record) : openEvidenceModal(record)"
                  >
                    <span class="literature-inline-card__eyebrow">文献</span>
                    <span class="literature-inline-card__title">{{ record.literature.title || '标题待补全' }}</span>
                    <span class="literature-inline-card__meta">
                      <span class="min-w-0 truncate">{{ record.literature.journal || '期刊待补全' }}</span>
                      <span v-if="record.literature.year" class="shrink-0 tabular-nums">{{ record.literature.year }}</span>
                    </span>
                  </button>
                </div>
              </div>

              <!-- Tribopair Column -->
              <div class="min-w-0 px-2 py-3">
                <div class="tribopair-stack">
                  <div
                    v-if="(tribopairParts(record).probe && tribopairParts(record).probe !== 'Probe N/A') || tribopairExtras(record).probeDetails"
                    class="tribopair-pill tribopair-pill--probe"
                    :title="'探针：' + tribopairParts(record).probe + (tribopairExtras(record).probeDetails ? ' · ' + tribopairExtras(record).probeDetails : '')"
                  >
                    <span class="tribopair-pill__label">探针</span>
                    <span class="tribopair-pill__value">
                      {{ tribopairParts(record).probe && tribopairParts(record).probe !== 'Probe N/A' ? tribopairParts(record).probe : '未记录' }}
                    </span>
                    <span v-if="tribopairExtras(record).probeDetails" class="tribopair-pill__meta">
                      {{ tribopairExtras(record).probeDetails }}
                    </span>
                  </div>

                  <div
                    v-if="tribopairParts(record).substrate && tribopairParts(record).substrate !== 'Substrate N/A'"
                    class="tribopair-pill tribopair-pill--substrate"
                    :title="'基底：' + tribopairParts(record).substrate + (roughnessBadge(record) ? ' · ' + roughnessBadge(record)?.label : '')"
                  >
                    <span class="tribopair-pill__label">基底</span>
                    <span class="tribopair-pill__value">{{ tribopairParts(record).substrate }}</span>
                    <span v-if="roughnessBadge(record)" class="tribopair-pill__meta">
                      {{ roughnessBadge(record)?.label }}
                    </span>
                  </div>

                  <div
                    v-if="tribopairParts(record).coating"
                    class="tribopair-pill tribopair-pill--coating"
                    :title="'涂层：' + tribopairParts(record).coating"
                  >
                    <span class="tribopair-pill__label">涂层</span>
                    <span class="tribopair-pill__value">{{ tribopairParts(record).coating }}</span>
                  </div>

                  <p
                    v-if="tribopairExtras(record).filmThickness"
                    class="tribopair-film"
                    :title="'膜厚：' + tribopairExtras(record).filmThickness"
                  >
                    膜厚 · {{ tribopairExtras(record).filmThickness }}
                  </p>

                  <span
                    v-if="(!tribopairParts(record).probe || tribopairParts(record).probe === 'Probe N/A')
                      && (!tribopairParts(record).substrate || tribopairParts(record).substrate === 'Substrate N/A')
                      && !tribopairParts(record).coating"
                    class="text-[11px] italic text-slate-400"
                  >
                    未提取
                  </span>
                </div>
              </div>

              <!-- Conditions Column -->
              <div class="min-w-0 px-3 py-3">
                <div class="flex flex-col gap-1.5">
                  <span
                    v-if="recordExperimentScaleLabel(record)"
                    class="mb-0.5 inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold"
                    :class="experimentScaleBadgeClass(recordExperimentScaleValue(record))"
                    :title="recordExperimentScaleValue(record)"
                  >
                    <span class="uppercase tracking-wider opacity-70">尺度</span>
                    <span>{{ recordExperimentScaleLabel(record) }}</span>
                  </span>

                  <!-- 主要条件 -->
                  <div
                    v-for="chip in notableConditionChips(record)"
                    :key="chip.key"
                    class="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-snug"
                  >
                    <span class="shrink-0 font-bold uppercase tracking-wider" :class="conditionToneLabelClass(chip.tone)">
                      {{ conditionDisplayLabel(chip) }}:
                    </span>
                    <span class="min-w-0 font-medium text-slate-800 dark:text-slate-200">
                      {{ conditionDisplayValue(chip) }}
                      <span
                        v-if="conditionDisplayUnit(chip)"
                        class="text-[10px] font-normal text-slate-500 ml-0.5"
                      >{{ conditionDisplayUnit(chip) }}</span>
                    </span>
                  </div>

                  <span
                    v-if="!notableConditionChips(record).length && !commonConditionChips(record).length"
                    class="text-[11px] text-slate-400 italic"
                  >
                    未提取
                  </span>

                  <!-- 常规条件 -->
                  <button
                    v-if="commonConditionChips(record).length && !isCommonExpanded(record.id)"
                    type="button"
                    class="mt-0.5 inline-flex w-fit items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-100 dark:border-slate-700/50 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800"
                    :title="'常规条件已折叠：点击展开查看'"
                    @click.stop="toggleCommonExpand(record.id)"
                  >
                    <span class="h-1.5 w-1.5 rounded-full bg-slate-400/60" />
                    <span>常规 ({{ commonConditionChips(record).length }})</span>
                  </button>
                  <template v-else-if="commonConditionChips(record).length && isCommonExpanded(record.id)">
                    <div
                      v-for="chip in commonConditionChips(record)"
                      :key="chip.key"
                      class="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-snug opacity-80"
                    >
                      <span class="shrink-0 font-bold uppercase tracking-wider text-slate-500">
                        {{ conditionDisplayLabel(chip, chip.shortcut) }}:
                      </span>
                      <span class="min-w-0 font-medium text-slate-700 dark:text-slate-300">
                        {{ conditionDisplayValue(chip, chip.shortcut) }}
                        <span
                          v-if="conditionDisplayUnit(chip, chip.shortcut)"
                          class="text-[10px] font-normal text-slate-400 ml-0.5"
                        >{{ conditionDisplayUnit(chip, chip.shortcut) }}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      class="mt-0.5 w-fit text-[10px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2"
                      title="收起常规条件"
                      @click.stop="toggleCommonExpand(record.id)"
                    >
                      收起
                    </button>
                  </template>
                </div>
              </div>

              <!-- COF + Actions Rail -->
              <div class="metric-rail cof-sticky-rail min-w-0 px-3 py-3">
                <div class="flex h-full flex-col items-end justify-center gap-2">
                  <div class="text-right">
                    <div class="whitespace-nowrap text-lg font-black tabular-nums tracking-tight text-blue-600 dark:text-blue-400">{{ cofDisplay(record) }}</div>
                    <div class="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                      Conf: {{ confidenceDisplay(confidenceValueFor(record, evidenceData[record.id])) }}
                    </div>
                  </div>
                  <div class="flex items-center justify-end gap-1" @click.stop>
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-300 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15"
                      title="进入审核"
                      @click="openReviewRecord ? openReviewRecord(record) : openEvidenceModal(record)"
                    >
                      <Eye class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      title="编辑数据"
                      @click="openEditModal(record)"
                    >
                      <Edit class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition hover:border-red-300 hover:bg-red-100 hover:text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
                      :disabled="deletingRowId === record.id"
                      title="删除记录"
                      @click="removeRecord(record)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
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

.record-table-grid {
  display: grid;
  grid-template-columns:
    36px
    52px
    minmax(164px, 0.82fr)
    minmax(190px, 1fr)
    minmax(168px, 0.92fr)
    minmax(118px, 126px);
  width: 100%;
  min-width: 0;
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

.literature-inline-card {
  display: grid;
  gap: 0.15rem;
  width: 100%;
  max-width: 100%;
  border-radius: 0.75rem;
  border: 1px solid rgba(199, 210, 254, 0.88);
  background:
    linear-gradient(135deg, rgba(238, 242, 255, 0.92), rgba(255, 255, 255, 0.96));
  padding: 0.45rem 0.55rem;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  color: #1e293b;
  transition:
    border-color 150ms ease,
    transform 150ms ease,
    box-shadow 150ms ease;
}

.literature-inline-card:hover {
  border-color: rgba(99, 102, 241, 0.42);
  box-shadow: 0 10px 24px -20px rgba(79, 70, 229, 0.45);
  transform: translateY(-1px);
}

.literature-inline-card__eyebrow {
  color: #6366f1;
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.literature-inline-card__title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.25;
}

.literature-inline-card__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
  color: #64748b;
  font-size: 0.62rem;
  font-weight: 700;
}

:global(.dark) .literature-inline-card {
  border-color: rgba(99, 102, 241, 0.25);
  background:
    linear-gradient(135deg, rgba(49, 46, 129, 0.26), rgba(15, 23, 42, 0.72));
  color: #e2e8f0;
}

.tribopair-stack {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.tribopair-pill {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: 0.5rem;
  row-gap: 0.08rem;
  min-width: 0;
  border-radius: 0.62rem;
  padding: 0.42rem 0.55rem;
  box-shadow: 0 10px 18px -18px rgba(15, 23, 42, 0.5);
}

.tribopair-pill__label {
  color: #94a3b8;
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  white-space: nowrap;
}

.tribopair-pill__value {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: 0.78rem;
  font-weight: 850;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tribopair-pill__meta {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  color: currentColor;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1.18;
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tribopair-pill--probe {
  border: 1px solid rgba(203, 213, 225, 0.95);
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
}

.tribopair-pill--substrate {
  background: #172235;
  color: #fff;
}

.tribopair-pill--coating {
  border: 1px solid rgba(251, 191, 36, 0.55);
  background: linear-gradient(135deg, #fff7ed, #fffbeb);
  color: #92400e;
}

.tribopair-film {
  min-width: 0;
  overflow: hidden;
  color: #64748b;
  font-size: 0.66rem;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .tribopair-pill--probe {
  border-color: rgba(51, 65, 85, 0.9);
  background: rgba(2, 6, 23, 0.72);
  color: #e2e8f0;
}

:global(.dark) .tribopair-pill--substrate {
  background: #e2e8f0;
  color: #0f172a;
}

:global(.dark) .tribopair-pill--coating {
  border-color: rgba(245, 158, 11, 0.34);
  background: rgba(245, 158, 11, 0.12);
  color: #fcd34d;
}

.condition-token {
  max-width: 100%;
}

.condition-stack {
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
}

.metric-rail {
  border-left: 1px solid rgba(226, 232, 240, 0.78);
  background:
    linear-gradient(90deg, rgba(248, 250, 252, 0.42), rgba(255, 255, 255, 0.92));
}

.cof-sticky-header,
.cof-sticky-rail {
  position: sticky;
  right: 0;
  z-index: 8;
}

.cof-sticky-header {
  z-index: 18;
  background:
    linear-gradient(90deg, rgba(248, 250, 252, 0.62), #f8fafc 24%, #f8fafc);
}

.cof-sticky-rail {
  box-shadow: -14px 0 22px -24px rgba(15, 23, 42, 0.45);
}

:global(.dark) .metric-rail {
  border-left-color: rgba(51, 65, 85, 0.82);
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.35), rgba(2, 6, 23, 0.72));
}

@media (max-width: 1280px) {
  .record-table-grid {
    grid-template-columns:
      32px
      48px
      minmax(150px, 0.78fr)
      minmax(174px, 1fr)
      minmax(156px, 0.9fr)
      minmax(112px, 120px);
    min-width: 0;
  }
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
