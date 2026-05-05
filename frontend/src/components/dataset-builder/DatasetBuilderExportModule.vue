<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, ArrowRightLeft, ChevronDown, ChevronUp, Download, FileText, Save, Upload } from 'lucide-vue-next'
import { formatColumnLabel, formatDateTime, formatMetric } from './formatters'
import type { SavedDatasetSummary, SubsetCard, SubsetKey } from './types'

defineProps<{
  subsetCards: SubsetCard[]
  bundleName: string
  subsetSavingKey: SubsetKey | null
  savedDatasets: SavedDatasetSummary[]
  exportLoadingId: number | null
  retainedFeatureColumns: string[]
}>()

const emit = defineEmits<{
  (e: 'update:bundleName', value: string): void
  (e: 'download', key: SubsetKey): void
  (e: 'save', key: SubsetKey): void
  (e: 'open-training', datasetId?: number | null): void
  (e: 'export-saved', dataset: SavedDatasetSummary): void
}>()

const expandedPreviewKeys = ref<Set<SubsetKey>>(new Set())

function togglePreview(key: SubsetKey) {
  if (expandedPreviewKeys.value.has(key)) expandedPreviewKeys.value.delete(key)
  else expandedPreviewKeys.value.add(key)
  expandedPreviewKeys.value = new Set(expandedPreviewKeys.value)
}

function isPreviewOpen(key: SubsetKey) {
  return expandedPreviewKeys.value.has(key)
}

function subsetPreviewColumns(columns: string[]) {
  return columns.slice(0, Math.min(8, columns.length))
}

function formatMatrixCell(value: number | string | null | undefined) {
  if (typeof value === 'number') return formatMetric(value, 4)
  return value == null || value === '' ? '--' : String(value)
}
</script>

<template>
  <div class="space-y-4">
    <section class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Save class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold tracking-tight text-slate-950">命名并保存训练数据集</h2>
          <p class="mt-0.5 text-xs text-slate-500">保存后会出现在 Modeling 页,无需手动搬 CSV。当前保留 {{ retainedFeatureColumns.length }} 个代表特征。</p>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2.5">
        <input
          :value="bundleName"
          type="text"
          class="h-11 min-w-[280px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
          placeholder="输入数据集版本名称"
          @input="emit('update:bundleName', ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          @click="emit('open-training', undefined)"
        >
          <ArrowRightLeft class="h-4 w-4" />
          打开 Modeling
        </button>
      </div>
    </section>

    <section class="grid gap-4 xl:grid-cols-2">
      <article
        v-for="card in subsetCards"
        :key="card.key"
        class="rounded-3xl border border-slate-200 bg-white p-5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em]" :class="card.accent === 'sky' ? 'text-sky-700' : 'text-emerald-700'">
              {{ card.label }}
            </p>
            <h3 class="mt-1 text-lg font-semibold tracking-tight text-slate-950">{{ card.title }}</h3>
            <p class="mt-1 text-xs leading-5 text-slate-500">{{ card.description }}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">样本数</p>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ card.summary?.row_count ?? '--' }}</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-slate-50 px-2 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">特征数</p>
            <p class="mt-0.5 text-base font-semibold tabular-nums text-slate-950">{{ card.summary?.feature_count ?? '--' }}</p>
          </div>
          <div class="rounded-xl bg-slate-50 px-2 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">目标列</p>
            <p class="mt-0.5 truncate text-xs font-semibold text-slate-950">{{ formatColumnLabel(card.summary?.target_column || '') }}</p>
          </div>
          <div class="rounded-xl bg-slate-50 px-2 py-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">总列数</p>
            <p class="mt-0.5 text-base font-semibold tabular-nums text-slate-950">{{ card.summary?.columns.length ?? '--' }}</p>
          </div>
        </div>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            class="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
            :disabled="subsetSavingKey === card.key"
            @click="emit('save', card.key)"
          >
            <Upload class="h-4 w-4" />
            {{ subsetSavingKey === card.key ? '保存中...' : '保存到工作区' }}
          </button>
          <button
            type="button"
            class="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            @click="emit('download', card.key)"
          >
            <Download class="h-4 w-4" />
            导出 CSV
          </button>
        </div>

        <button
          type="button"
          class="mt-3 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
          @click="togglePreview(card.key)"
        >
          <span class="flex items-center gap-1.5">
            <FileText class="h-3.5 w-3.5" />
            数据预览 ({{ card.summary?.preview_rows.length ?? 0 }} 行)
          </span>
          <ChevronUp v-if="isPreviewOpen(card.key)" class="h-3.5 w-3.5" />
          <ChevronDown v-else class="h-3.5 w-3.5" />
        </button>

        <div v-if="isPreviewOpen(card.key)" class="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
          <table class="min-w-full text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                <th v-for="column in subsetPreviewColumns(card.summary?.columns || [])" :key="`${card.key}-${column}`" class="px-2.5 py-2 font-semibold">
                  {{ formatColumnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in card.summary?.preview_rows || []" :key="`${card.key}-${rowIndex}`" class="border-b border-slate-200/70">
                <td v-for="column in subsetPreviewColumns(card.summary?.columns || [])" :key="`${card.key}-${rowIndex}-${column}`" class="px-2.5 py-2 text-slate-700">
                  {{ formatMatrixCell(row[column]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h3 class="text-base font-semibold tracking-tight text-slate-950">已保存训练版本</h3>
          <p class="mt-0.5 text-xs text-slate-500">直接送 Modeling 训练,或在需要时导出 CSV。</p>
        </div>
        <span class="text-xs font-medium text-slate-500">共 {{ savedDatasets.length }} 个</span>
      </div>

      <div v-if="savedDatasets.length === 0" class="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        当前作用域还没有保存的数据集。
      </div>

      <ul v-else class="mt-4 space-y-2">
        <li
          v-for="dataset in savedDatasets"
          :key="dataset.id"
          class="flex flex-col gap-3 rounded-xl bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-sm font-semibold text-slate-950">{{ dataset.name }}</p>
              <span v-if="dataset.dataset_kind === 'imported_csv'" class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                导入 CSV
              </span>
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ dataset.row_count }} 行 · {{ dataset.feature_columns.length }} 个特征 · {{ formatDateTime(dataset.created_at) }}
            </p>
            <p v-if="dataset.description" class="mt-1 line-clamp-1 text-xs text-slate-500">{{ dataset.description }}</p>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              @click="emit('open-training', dataset.id)"
            >
              去 Modeling
              <ArrowRight class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              :disabled="exportLoadingId === dataset.id"
              @click="emit('export-saved', dataset)"
            >
              {{ exportLoadingId === dataset.id ? '导出中...' : '导出 CSV' }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
