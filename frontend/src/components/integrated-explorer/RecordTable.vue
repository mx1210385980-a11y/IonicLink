<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

import { Edit, Eye, Trash2 } from 'lucide-vue-next'
import LubricantStructurePreview from '@/components/integrated-explorer/LubricantStructurePreview.vue'
import type { EvidenceResult, RecordResponse } from '@/lib/api'
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
  lubricantDisplayLines,
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
// 密集记录可能同时包含温度/速度/载荷/含水和涂层卡片，虚拟行高需要给足安全余量。
const ROW_HEIGHT = 168 // Estimated row height in pixels
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
        <div class="px-3 py-4 font-medium">序号</div>
        <div class="min-w-0 px-3 py-4 font-medium">离子液体</div>
        <div class="min-w-0 px-2 py-4 font-medium">摩擦副</div>
        <div class="min-w-0 px-3 py-4 font-medium">实验条件</div>
        <div class="px-3 py-4 text-right font-bold text-blue-600">COF / 操作</div>
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
              <div class="metric-rail h-full px-3">
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
                    class="rounded-md bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
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
                      v-for="(line, lineIndex) in lubricantDisplayLines(record)"
                      :key="`${record.id}-il-line-${lineIndex}-${line}`"
                      class="block max-w-full break-words"
                      :class="line.startsWith('(') && line.endsWith(')') ? 'mt-1' : ''"
                    >
                      <template v-if="line.startsWith('(') && line.endsWith(')')">
                        <span class="inline-flex items-center gap-1.5 rounded-[0.25rem] bg-[#f8fafc] px-1.5 py-[2px] text-[9.5px] font-bold text-[#475569] shadow-[inset_0_0_0_1px_rgba(226,232,240,1)] dark:bg-slate-800 dark:text-slate-300 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,1)]">
                          <span class="text-[8.5px] font-black uppercase tracking-wider text-[#94a3b8] dark:text-slate-500">Ratio</span>
                          {{ line.slice(1, -1) }}
                        </span>
                      </template>
                      <template v-else>
                        <span
                          v-for="(part, partIndex) in ionicLiquidParts(line)"
                          :key="`${record.id}-il-${lineIndex}-${partIndex}-${part}`"
                          class="inline whitespace-normal break-words"
                          v-html="formatIonicLiquidPartHtml(part)"
                        />
                      </template>
                    </span>
                  </div>
                  <LubricantStructurePreview
                    :record="record"
                    :active="structurePreviewOpen && structurePreviewRowId === record.id"
                    @open="openStructurePreview"
                  />
                </div>
              </div>

              <!-- Tribopair Column -->
              <div class="min-w-0 px-2 py-3">
                <div class="flex flex-col gap-1.5">
                  <!-- 探针：主名 + 副信息（几何/半径/粗糙度）一起显示 -->
                  <div
                    v-if="tribopairParts(record).probe && tribopairParts(record).probe !== 'Probe N/A'"
                    class="rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-950"
                    :title="'探针：' + tribopairParts(record).probe + (tribopairExtras(record).probeDetails ? ' · ' + tribopairExtras(record).probeDetails : '')"
                  >
                    <div class="flex items-start gap-2">
                      <span class="shrink-0 pt-px text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">探针</span>
                      <span class="break-words text-[11.5px] font-semibold leading-snug text-slate-700 dark:text-slate-200">
                        {{ tribopairParts(record).probe }}
                      </span>
                    </div>
                    <p
                      v-if="tribopairExtras(record).probeDetails"
                      class="mt-0.5 ml-7 text-[10.5px] leading-snug text-slate-500"
                    >
                      {{ tribopairExtras(record).probeDetails }}
                    </p>
                  </div>

                  <!-- 基底：主名 + 粗糙度内联 -->
                  <div
                    v-if="tribopairParts(record).substrate && tribopairParts(record).substrate !== 'Substrate N/A'"
                    class="rounded-md bg-slate-800 px-2 py-1 shadow-sm dark:bg-slate-100"
                    :title="'基底：' + tribopairParts(record).substrate + (roughnessBadge(record) ? ' · ' + roughnessBadge(record)?.label : '')"
                  >
                    <div class="flex min-w-0 items-start gap-2">
                      <span class="shrink-0 pt-px text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">基底</span>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[11.5px] font-semibold leading-snug text-white dark:text-slate-900">
                          {{ tribopairParts(record).substrate }}
                        </div>
                        <div
                          v-if="roughnessBadge(record)"
                          class="mt-0.5 truncate text-[10.5px] leading-snug text-slate-300 dark:text-slate-500"
                        >
                          {{ roughnessBadge(record)?.label }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 涂层：单独胶囊 -->
                  <div
                    v-if="tribopairParts(record).coating"
                    class="inline-flex w-fit max-w-full items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                    :title="'涂层：' + tribopairParts(record).coating"
                  >
                    <span class="shrink-0 pt-px text-[10px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-500/70">涂层</span>
                    <span class="break-words text-[11.5px] font-semibold leading-snug text-amber-800 dark:text-amber-300">
                      {{ tribopairParts(record).coating }}
                    </span>
                  </div>

                  <!-- 膜厚（如果有）放在最末，作为环境层属性 -->
                  <p
                    v-if="tribopairExtras(record).filmThickness"
                    class="text-[10.5px] leading-snug text-slate-500"
                    :title="'膜厚：' + tribopairExtras(record).filmThickness"
                  >
                    膜厚 · {{ tribopairExtras(record).filmThickness }}
                  </p>

                  <span
                    v-if="(!tribopairParts(record).probe || tribopairParts(record).probe === 'Probe N/A')
                      && (!tribopairParts(record).substrate || tribopairParts(record).substrate === 'Substrate N/A')
                      && !tribopairParts(record).coating"
                    class="text-[11px] text-slate-400 italic"
                  >
                    未提取
                  </span>
                </div>
              </div>

              <!-- Conditions Column -->
              <div class="min-w-0 px-3 py-3">
                <div class="flex flex-col gap-1.5">
                  <!-- 主要条件 -->
                  <div
                    v-for="chip in notableConditionChips(record)"
                    :key="chip.key"
                    class="flex items-baseline gap-1.5 text-[11px] leading-snug"
                  >
                    <span class="shrink-0 font-bold uppercase tracking-wider" :class="conditionToneLabelClass(chip.tone)">
                      {{ conditionDisplayLabel(chip) }}:
                    </span>
                    <span class="text-slate-800 dark:text-slate-200 font-medium break-words">
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
                      class="flex items-baseline gap-1.5 text-[11px] leading-snug opacity-80"
                    >
                      <span class="shrink-0 font-bold uppercase tracking-wider text-slate-500">
                        {{ conditionDisplayLabel(chip, chip.shortcut) }}:
                      </span>
                      <span class="text-slate-700 dark:text-slate-300 font-medium break-words">
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
              <div class="metric-rail min-w-0 px-3 py-3">
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
    minmax(138px, 168px)
    minmax(112px, 148px)
    minmax(0, 1.55fr)
    138px;
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
      minmax(120px, 148px)
      minmax(104px, 132px)
      minmax(0, 1.45fr)
      130px;
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
