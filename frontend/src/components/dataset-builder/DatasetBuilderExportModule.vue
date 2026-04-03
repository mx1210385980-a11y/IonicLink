<script setup lang="ts">
import { ArrowRightLeft, Download, Upload } from 'lucide-vue-next'
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

function subsetPreviewColumns(columns: string[]) {
  return columns.slice(0, Math.min(8, columns.length))
}
</script>

<template>
  <div class="space-y-6">
    <section class="rounded-[28px] border border-slate-200 bg-white p-6">
      <div class="grid gap-6 xl:grid-cols-[1fr_320px] xl:items-start">
        <div>
          <h2 class="text-xl font-semibold tracking-tight text-slate-950">分流与导出</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">把最终矩阵拆成通用池和机理池，再导出或保存到工作区给训练模块直接使用。这里会直接继承第二步选中的代表特征。</p>
        </div>

        <div class="space-y-3">
          <input
            :value="bundleName"
            type="text"
            class="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
            placeholder="输入导出包名称"
            @input="emit('update:bundleName', ($event.target as HTMLInputElement).value)"
          />
          <button type="button" class="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="emit('open-training', undefined)">
            <ArrowRightLeft class="h-4 w-4" />
            打开 Model Studio
          </button>
          <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            当前将保留 {{ retainedFeatureColumns.length }} 个代表特征进入导出数据集。
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-6 xl:grid-cols-2">
      <article
        v-for="card in subsetCards"
        :key="card.key"
        class="rounded-[28px] border border-slate-200 bg-white p-6"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em]" :class="card.accent === 'sky' ? 'text-sky-700' : 'text-emerald-700'">
              {{ card.label }}
            </p>
            <h3 class="mt-2 text-xl font-semibold tracking-tight text-slate-950">{{ card.title }}</h3>
            <p class="mt-2 text-sm leading-6 text-slate-600">{{ card.description }}</p>
          </div>
          <div class="text-right">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">样本数</p>
            <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{{ card.summary?.row_count }}</p>
          </div>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-2xl bg-slate-50 px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">特征数</p>
            <p class="mt-2 text-xl font-semibold tracking-tight text-slate-950">{{ card.summary?.feature_count }}</p>
          </div>
          <div class="rounded-2xl bg-slate-50 px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">目标列</p>
            <p class="mt-2 text-sm font-semibold text-slate-950">{{ formatColumnLabel(card.summary?.target_column || '') }}</p>
          </div>
          <div class="rounded-2xl bg-slate-50 px-4 py-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">总列数</p>
            <p class="mt-2 text-xl font-semibold tracking-tight text-slate-950">{{ card.summary?.columns.length }}</p>
          </div>
        </div>

        <div class="mt-5 flex flex-col gap-3 sm:flex-row">
          <button type="button" class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800" @click="emit('download', card.key)">
            <Download class="h-4 w-4" />
            导出 CSV
          </button>
          <button
            type="button"
            class="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            :disabled="subsetSavingKey === card.key"
            @click="emit('save', card.key)"
          >
            <Upload class="h-4 w-4" />
            {{ subsetSavingKey === card.key ? '保存中...' : '保存到工作区' }}
          </button>
        </div>

        <div class="mt-5 overflow-x-auto rounded-2xl bg-slate-50">
          <table class="min-w-full text-left text-sm">
            <thead>
              <tr class="border-b border-slate-200 text-xs uppercase tracking-[0.16em] text-slate-400">
                <th v-for="column in subsetPreviewColumns(card.summary?.columns || [])" :key="`${card.key}-${column}`" class="px-3 py-3 font-semibold">
                  {{ formatColumnLabel(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in card.summary?.preview_rows || []" :key="`${card.key}-${rowIndex}`" class="border-b border-slate-200/70">
                <td v-for="column in subsetPreviewColumns(card.summary?.columns || [])" :key="`${card.key}-${rowIndex}-${column}`" class="px-3 py-3 text-slate-700">
                  {{ formatMetric(row[column], 4) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="rounded-[28px] border border-slate-200 bg-white p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h3 class="text-lg font-semibold tracking-tight text-slate-950">已保存数据集</h3>
          <p class="mt-1 text-sm leading-6 text-slate-600">这里会显示刚刚保存的 Dataset-A、Dataset-B，以及之前已经入库的数据矩阵。</p>
        </div>
        <span class="text-sm font-medium text-slate-500">共 {{ savedDatasets.length }} 个</span>
      </div>

      <div v-if="savedDatasets.length === 0" class="mt-5 rounded-2xl bg-slate-50 px-4 py-8 text-sm text-slate-500">
        当前作用域还没有保存的数据集。
      </div>

      <div v-else class="mt-5 space-y-3">
        <div v-for="dataset in savedDatasets" :key="dataset.id" class="flex flex-col gap-4 rounded-2xl bg-slate-50 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-sm font-semibold text-slate-950">{{ dataset.name }}</p>
              <span v-if="dataset.dataset_kind === 'imported_csv'" class="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">导入 CSV</span>
            </div>
            <p class="mt-2 text-xs leading-5 text-slate-500">
              {{ dataset.row_count }} 行 · {{ dataset.feature_columns.length }} 个特征 · {{ formatDateTime(dataset.created_at) }}
            </p>
            <p v-if="dataset.description" class="mt-2 text-xs leading-5 text-slate-500">{{ dataset.description }}</p>
          </div>

          <div class="flex items-center gap-2">
            <button type="button" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100" @click="emit('open-training', dataset.id)">
              训练
            </button>
            <button
              type="button"
              class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              :disabled="exportLoadingId === dataset.id"
              @click="emit('export-saved', dataset)"
            >
              {{ exportLoadingId === dataset.id ? '导出中...' : '导出 CSV' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
