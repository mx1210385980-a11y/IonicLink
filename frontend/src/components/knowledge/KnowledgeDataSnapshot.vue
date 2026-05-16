<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, ExternalLink, RefreshCw, Search, ShieldCheck } from 'lucide-vue-next'

import { searchRecords, type RecordResponse } from '@/lib/api'
import {
  cofDisplay,
  formatIonicLiquidPartHtml,
  ionicLiquidParts,
  lubricantAliasDisplay,
  type LubricantDisplayLine,
  lubricantDisplayRows,
  lubricantTooltip,
} from '@/lib/integratedExplorerHelpers'

const ULTRA_LOW_COF_MAX = 0.02
const PAGE_LIMIT = 200

const emit = defineEmits<{
  openRecord: [payload: { literatureId?: number | null, recordId?: number | null }]
}>()

const loading = ref(false)
const error = ref('')
const records = ref<RecordResponse[]>([])
const total = ref(0)
const query = ref('')

const filteredRecords = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return records.value
  return records.value.filter((record) => {
    return [
      record.id,
      record.ionicLiquidDisplay,
      record.lubricant,
      record.cation,
      record.anion,
      record.substrateMaterial,
      record.materialName,
      record.potential,
      record.literature?.title,
      record.literature?.journal,
      record.literature?.year,
    ].join(' ').toLowerCase().includes(text)
  })
})

const minCof = computed(() => {
  const values = records.value
    .map((record) => Number(record.cofValue))
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.min(...values) : null
})

const literatureCount = computed(() => new Set(records.value.map((record) => record.literatureId).filter(Boolean)).size)
const ionicLiquidCount = computed(() => new Set(records.value.map((record) => ionicLiquidLabel(record)).filter(Boolean)).size)

function isApproved(record: RecordResponse) {
  const status = String(record.reviewStatus || (record as any).review_status || '').trim().toLowerCase()
  return status === 'approved' || status === 'accepted' || status === 'verified'
}

function cofNumber(record: RecordResponse) {
  const value = Number(record.cofValue)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

async function loadSnapshot() {
  loading.value = true
  error.value = ''
  try {
    const response = await searchRecords(
      {
        cof_max: ULTRA_LOW_COF_MAX,
        reviewStatuses: ['approved', 'accepted', 'verified'],
      },
      0,
      PAGE_LIMIT,
    )
    total.value = response.total
    records.value = response.items
      .filter(isApproved)
      .sort((a, b) => cofNumber(a) - cofNumber(b) || Number(a.id) - Number(b.id))
  } catch (err: any) {
    error.value = err?.message || '加载超低摩擦索引失败'
  } finally {
    loading.value = false
  }
}

function ionicLiquidLabel(record: RecordResponse) {
  return String(record.ionicLiquidDisplay || record.lubricant || '').trim()
}

function baseLabel(record: RecordResponse) {
  const substrate = String(record.substrateMaterial || '').trim()
  const coating = String(record.substrateCoating || '').trim()
  const material = String(record.materialName || '').trim()
  if (substrate && coating) return `${substrate} / ${coating}`
  return substrate || material || '—'
}

function potentialLabel(record: RecordResponse) {
  const value = String(record.potential || '').trim()
  const compact = value.replace(/\s+/g, ' ')
  if (/^[+−-]?0(?:\.0+)?\s*V?\s*(?:(?:vs\.?|versus)\s*OCP)?$/i.test(compact)) return '0 V'
  const potentialMatch = compact.match(/^([+−-]?\d+(?:\.\d+)?)\s*V?(?:\s*(?:(?:vs\.?|versus)\s*OCP))?$/i)
  if (potentialMatch) return `${potentialMatch[1]} V`
  return compact || '—'
}

function lubricantLineClass(line: LubricantDisplayLine): string {
  if (line.kind === 'ratio') return 'mt-1'
  return line.emphasis === 'secondary' ? 'text-[13px] text-slate-600' : ''
}

function sourceTitle(record: RecordResponse) {
  return String(record.literature?.title || `Literature ${record.literatureId || record.id}`).trim()
}

function journalLabel(record: RecordResponse) {
  return String(record.literature?.journal || '').trim()
}

function yearLabel(record: RecordResponse) {
  return record.literature?.year ? String(record.literature.year) : '—'
}

function openRecord(record: RecordResponse) {
  emit('openRecord', {
    literatureId: record.literatureId,
    recordId: record.id,
  })
}

onMounted(loadSnapshot)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#fbfdff]">
    <header class="shrink-0 border-b border-[#e5edf6] bg-white px-6 py-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="inline-flex items-center gap-2 rounded-full bg-[#ecfeff] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#0f766e] ring-1 ring-[#bae6fd]">
            <ShieldCheck class="h-3.5 w-3.5" />
            Data Snapshot
          </div>
          <h2 class="mt-3 text-2xl font-black tracking-[-0.05em] text-slate-950">
            表 3-1 超低摩擦 approved 记录索引
          </h2>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            与图 3-10 对应，自动筛选库中已确认且 COF ≤ {{ ULTRA_LOW_COF_MAX.toFixed(3) }} 的代表性案例，可直接作为论文分析索引。
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model="query"
              type="search"
              placeholder="搜索离子液体 / 基底 / 来源"
              class="h-10 w-64 rounded-xl border border-[#dce5ef] bg-[#f8fafc] pl-9 pr-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#7dd3fc] focus:bg-white focus:ring-4 focus:ring-[#bae6fd]/30"
            >
          </div>
          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dce5ef] bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-[#7dd3fc] hover:text-[#0369a1]"
            :disabled="loading"
            @click="loadSnapshot"
          >
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
            刷新
          </button>
        </div>
      </div>

      <div class="mt-5 grid gap-3 sm:grid-cols-4">
        <div class="rounded-2xl border border-[#dce5ef] bg-[#f8fafc] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ca0ba]">Approved Index</p>
          <p class="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950 tabular-nums">{{ records.length }}</p>
        </div>
        <div class="rounded-2xl border border-[#dce5ef] bg-[#f8fafc] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ca0ba]">Min COF</p>
          <p class="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950 tabular-nums">{{ minCof == null ? '—' : minCof.toFixed(4) }}</p>
        </div>
        <div class="rounded-2xl border border-[#dce5ef] bg-[#f8fafc] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ca0ba]">Literature</p>
          <p class="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950 tabular-nums">{{ literatureCount }}</p>
        </div>
        <div class="rounded-2xl border border-[#dce5ef] bg-[#f8fafc] px-4 py-3">
          <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8ca0ba]">Ionic Liquids</p>
          <p class="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950 tabular-nums">{{ ionicLiquidCount }}</p>
        </div>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden p-5">
      <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[#dce5ef] bg-white shadow-[0_24px_58px_-46px_rgba(15,23,42,0.32)]">
        <div v-if="error" class="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {{ error }}
        </div>

        <div v-else-if="loading" class="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
          <RefreshCw class="mr-2 h-4 w-4 animate-spin" />
          正在生成库中数据快照...
        </div>

        <div v-else-if="!filteredRecords.length" class="flex h-full flex-col items-center justify-center px-6 text-center">
          <CheckCircle2 class="h-10 w-10 text-slate-300" />
          <p class="mt-3 text-base font-semibold text-slate-900">暂未找到符合条件的 approved 超低摩擦记录</p>
          <p class="mt-1 text-sm text-slate-500">确认 Review 中记录已通过审核，且 COF ≤ {{ ULTRA_LOW_COF_MAX.toFixed(3) }}。</p>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-auto custom-scrollbar">
          <table class="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead class="sticky top-0 z-10 bg-[#f8fafc] text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th class="w-14 border-b border-[#e5edf6] px-4 py-3">#</th>
                <th class="w-24 border-b border-[#e5edf6] px-3 py-3">COF</th>
                <th class="min-w-[280px] border-b border-[#e5edf6] px-3 py-3">离子液体</th>
                <th class="w-48 border-b border-[#e5edf6] px-3 py-3">基底</th>
                <th class="w-36 border-b border-[#e5edf6] px-3 py-3">电位</th>
                <th class="w-24 border-b border-[#e5edf6] px-3 py-3">年份</th>
                <th class="min-w-[420px] border-b border-[#e5edf6] px-3 py-3">来源</th>
                <th class="w-24 border-b border-[#e5edf6] px-3 py-3 text-right">定位</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(record, index) in filteredRecords"
                :key="record.id"
                class="group border-b border-[#eef2f7] transition hover:bg-[#f8fbff]"
              >
                <td class="border-b border-[#eef2f7] px-4 py-3 text-slate-500 tabular-nums">{{ index + 1 }}</td>
                <td class="border-b border-[#eef2f7] px-3 py-3">
                  <span class="font-black text-[#0f766e] tabular-nums">{{ cofDisplay(record) }}</span>
                </td>
                <td class="border-b border-[#eef2f7] px-3 py-3">
                  <div
                    class="flex min-w-0 flex-col gap-0.5 text-[15px] font-semibold leading-[1.2] text-slate-900"
                    :title="lubricantTooltip(record)"
                  >
                    <span
                      v-for="(line, lineIndex) in lubricantDisplayRows(record)"
                      :key="`${record.id}-snapshot-il-line-${lineIndex}-${line.text}`"
                      class="block max-w-full break-words"
                      :class="lubricantLineClass(line)"
                    >
                      <template v-if="line.kind === 'ratio'">
                        <span class="inline-flex items-center gap-1.5 rounded-[0.25rem] bg-[#f8fafc] px-1.5 py-[2px] text-[9.5px] font-bold text-[#475569] shadow-[inset_0_0_0_1px_rgba(226,232,240,1)]">
                          <span class="text-[8.5px] font-black uppercase tracking-wider text-[#94a3b8]">Ratio</span>
                          {{ line.text.slice(1, -1) }}
                        </span>
                      </template>
                      <template v-else>
                        <span
                          v-for="(part, partIndex) in ionicLiquidParts(line.text)"
                          :key="`${record.id}-snapshot-il-${lineIndex}-${partIndex}-${part}`"
                          class="inline whitespace-normal break-words"
                          v-html="formatIonicLiquidPartHtml(part)"
                        />
                      </template>
                    </span>
                    <span
                      v-if="lubricantAliasDisplay(record)"
                      class="mt-1 inline-flex w-fit max-w-full items-center gap-1.5 rounded-[0.25rem] border border-amber-200 bg-amber-50 px-1.5 py-[2px] text-[9.5px] font-bold leading-none text-amber-800"
                    >
                      <span class="shrink-0 text-[8.5px] font-black uppercase tracking-wider text-amber-600/80">Alias</span>
                      <span class="min-w-0 truncate">{{ lubricantAliasDisplay(record) }}</span>
                    </span>
                  </div>
                  <p class="mt-0.5 text-xs text-slate-400">索引 #{{ index + 1 }}</p>
                </td>
                <td class="border-b border-[#eef2f7] px-3 py-3 font-semibold text-slate-800">{{ baseLabel(record) }}</td>
                <td class="border-b border-[#eef2f7] px-3 py-3 text-slate-700">
                  <span class="inline-flex whitespace-nowrap rounded-lg bg-[#f8fafc] px-2.5 py-1 text-xs font-bold tabular-nums text-slate-700 ring-1 ring-[#e2e8f0]">
                    {{ potentialLabel(record) }}
                  </span>
                </td>
                <td class="border-b border-[#eef2f7] px-3 py-3 text-slate-700 tabular-nums">{{ yearLabel(record) }}</td>
                <td class="border-b border-[#eef2f7] px-3 py-3">
                  <p class="line-clamp-1 font-semibold text-slate-900" :title="sourceTitle(record)">{{ sourceTitle(record) }}</p>
                  <p class="mt-0.5 line-clamp-1 text-xs text-slate-500">
                    <span v-if="journalLabel(record)" class="font-semibold text-[#4f46e5]">{{ journalLabel(record) }}</span>
                    <span v-if="record.literature?.doi" class="ml-2">{{ record.literature.doi }}</span>
                  </p>
                </td>
                <td class="border-b border-[#eef2f7] px-3 py-3 text-right">
                  <button
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#cfd9ff] bg-white px-2.5 text-xs font-semibold text-[#4c4fdc] transition hover:bg-[#eef0ff]"
                    @click="openRecord(record)"
                  >
                    查看
                    <ExternalLink class="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer v-if="!loading && !error && filteredRecords.length" class="shrink-0 border-t border-[#e5edf6] bg-[#fbfdff] px-5 py-3 text-xs text-slate-500">
          当前显示 {{ filteredRecords.length }} 条；接口总命中 {{ total }} 条，表内按 COF 从低到高排序。
        </footer>
      </div>
    </main>
  </div>
</template>
