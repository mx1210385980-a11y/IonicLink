<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Database,
  ExternalLink,
  FileCheck2,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-vue-next'

import {
  importLiteratureByDoi,
  type ExtractorType,
  type Literature,
  type LiteratureDoiImportItem,
  type LiteratureDoiImportResponse,
} from '@/lib/api'

type BatchStatus = 'running' | 'completed' | 'attention' | 'failed'

type IntakeBatchItem = LiteratureDoiImportItem & {
  literatureId?: number | null
  title?: string | null
  journal?: string | null
  year?: number | null
}

type IntakeBatch = {
  id: string
  name: string
  createdAt: string
  extractorType: ExtractorType | string
  status: BatchStatus
  total: number
  created: number
  existing: number
  failed: number
  items: IntakeBatchItem[]
}

const props = defineProps<{
  literatureItems: Literature[]
  loading?: boolean
}>()

const emit = defineEmits<{
  refreshLiterature: []
  selectSource: [literatureId: number | null]
  openReviewSource: [literatureId?: number | null]
}>()

const STORAGE_KEY = 'ioniclink.literature-intake-batches.v1'
const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi

const doiInput = ref('')
const batchName = ref('')
const extractorType = ref<ExtractorType>('tribology')
const importing = ref(false)
const importError = ref('')
const batches = ref<IntakeBatch[]>([])
const activeBatchId = ref<string | null>(null)

function normalizeDoi(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;:)]+$/g, '')
    .toLowerCase()
}

function parseDoiEntries(value = doiInput.value) {
  const matches = String(value || '').match(DOI_PATTERN) || []
  const normalized = matches.map(normalizeDoi).filter((doi) => doi.startsWith('10.'))
  return Array.from(new Set(normalized))
}

function literatureTotal(item: Literature | null | undefined) {
  return Number(item?.recordCount || 0) + Number(item?.candidateCount || 0)
}

function compactTitle(value: unknown, fallback: string) {
  return String(value || '').trim() || fallback
}

function batchStatusFromResponse(response: LiteratureDoiImportResponse): BatchStatus {
  if (!response.total) return 'failed'
  if (response.failed === response.total) return 'failed'
  if (response.failed > 0) return 'attention'
  return 'completed'
}

function mapResponseToBatch(response: LiteratureDoiImportResponse): IntakeBatch {
  return {
    id: response.batchId || `doi-${Date.now()}`,
    name: response.batchName || batchName.value || 'DOI Import Batch',
    createdAt: new Date().toISOString(),
    extractorType: response.extractorType || extractorType.value,
    status: batchStatusFromResponse(response),
    total: response.total,
    created: response.created,
    existing: response.existing,
    failed: response.failed,
    items: response.items.map((item) => ({
      ...item,
      literatureId: item.literature?.id ?? null,
      title: item.literature?.title ?? null,
      journal: item.literature?.journal ?? null,
      year: item.literature?.year ?? null,
    })),
  }
}

function loadBatches() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      batches.value = parsed.slice(0, 16)
      activeBatchId.value = batches.value[0]?.id || null
    }
  } catch (error) {
    console.warn('[LiteratureIntake] Failed to load batches:', error)
  }
}

function saveBatches() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(batches.value.slice(0, 16)))
  } catch (error) {
    console.warn('[LiteratureIntake] Failed to save batches:', error)
  }
}

async function submitDoiImport() {
  const dois = parseDoiEntries()
  importError.value = ''
  if (!dois.length) {
    importError.value = '请粘贴至少一个有效 DOI，例如 10.1007/s40544-024-0890-7'
    return
  }

  importing.value = true
  try {
    const response = await importLiteratureByDoi({
      dois,
      batchName: batchName.value.trim() || undefined,
      extractorType: extractorType.value,
    })
    const batch = mapResponseToBatch(response)
    batches.value = [batch, ...batches.value.filter((item) => item.id !== batch.id)].slice(0, 16)
    activeBatchId.value = batch.id
    doiInput.value = ''
    batchName.value = ''
    emit('refreshLiterature')
  } catch (error: any) {
    importError.value = error?.response?.data?.detail || error?.message || 'DOI 导入失败'
  } finally {
    importing.value = false
  }
}

function removeBatch(batchId: string) {
  batches.value = batches.value.filter((batch) => batch.id !== batchId)
  if (activeBatchId.value === batchId) {
    activeBatchId.value = batches.value[0]?.id || null
  }
}

function clearAllBatches() {
  batches.value = []
  activeBatchId.value = null
}

const parsedDois = computed(() => parseDoiEntries())

const literatureById = computed(() => {
  const map = new Map<number, Literature>()
  props.literatureItems.forEach((item) => map.set(item.id, item))
  return map
})

const literatureByDoi = computed(() => {
  const map = new Map<string, Literature>()
  props.literatureItems.forEach((item) => {
    const doi = normalizeDoi(item.doi)
    if (doi) map.set(doi, item)
  })
  return map
})

const activeBatch = computed(() => {
  return batches.value.find((batch) => batch.id === activeBatchId.value) || batches.value[0] || null
})

const intakeStats = computed(() => {
  const pendingPdf = props.literatureItems.filter((item) => !item.hasPdf && literatureTotal(item) === 0).length
  const extractingReady = props.literatureItems.filter((item) => item.hasPdf && literatureTotal(item) === 0).length
  const extracted = props.literatureItems.filter((item) => literatureTotal(item) > 0).length
  const failed = props.literatureItems.filter((item) => ['failed', 'error', 'no_data'].includes(String(item.status || '').toLowerCase())).length
  return { pendingPdf, extractingReady, extracted, failed }
})

function statusForBatchItem(item: IntakeBatchItem) {
  const literature = (item.literatureId ? literatureById.value.get(item.literatureId) : null)
    || (item.doi ? literatureByDoi.value.get(normalizeDoi(item.doi)) : null)

  if (item.status === 'failed') {
    return {
      label: '导入失败',
      detail: item.message,
      className: 'bg-rose-50 text-rose-700 border-rose-100',
      icon: AlertCircle,
      literature,
    }
  }
  if (item.status === 'duplicate') {
    return {
      label: '批次重复',
      detail: item.message,
      className: 'bg-slate-50 text-slate-600 border-slate-200',
      icon: ClipboardList,
      literature,
    }
  }
  if (!literature) {
    return {
      label: '待同步',
      detail: item.message || '等待刷新文献库状态',
      className: 'bg-amber-50 text-amber-700 border-amber-100',
      icon: RefreshCw,
      literature,
    }
  }

  const total = literatureTotal(literature)
  const status = String(literature.status || '').toLowerCase()
  if (total > 0) {
    return {
      label: Number(literature.candidateCount || 0) > 0 ? '待审核' : '已入库',
      detail: `${total} 条记录`,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: CheckCircle2,
      literature,
    }
  }
  if (literature.hasPdf) {
    return {
      label: 'PDF 已有',
      detail: '等待提取',
      className: 'bg-sky-50 text-sky-700 border-sky-100',
      icon: FileCheck2,
      literature,
    }
  }
  if (['failed', 'error', 'no_data'].includes(status)) {
    return {
      label: status === 'no_data' ? '无数据' : '处理异常',
      detail: literature.errorMessage || item.message || '需要人工检查',
      className: 'bg-rose-50 text-rose-700 border-rose-100',
      icon: AlertCircle,
      literature,
    }
  }
  return {
    label: '待 PDF',
    detail: '已建档，等待上传全文',
    className: 'bg-amber-50 text-amber-700 border-amber-100',
    icon: Inbox,
    literature,
  }
}

function batchStatusLabel(status: BatchStatus) {
  if (status === 'failed') return '全部失败'
  if (status === 'attention') return '需关注'
  if (status === 'running') return '导入中'
  return '已完成'
}

function batchStatusClass(status: BatchStatus) {
  if (status === 'failed') return 'bg-rose-50 text-rose-700'
  if (status === 'attention') return 'bg-amber-50 text-amber-700'
  if (status === 'running') return 'bg-sky-50 text-sky-700'
  return 'bg-emerald-50 text-emerald-700'
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function openLiterature(literatureId?: number | null) {
  if (!literatureId) return
  emit('openReviewSource', literatureId)
}

function selectLiterature(literatureId?: number | null) {
  if (!literatureId) return
  emit('selectSource', literatureId)
}

onMounted(loadBatches)
watch(batches, saveBatches, { deep: true })
</script>

<template>
  <section class="literature-intake overflow-hidden rounded-[1.8rem] border border-[#dbe5f0] bg-white shadow-[0_24px_56px_-46px_rgba(15,23,42,0.35)]">
    <div class="grid gap-0 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div class="border-b border-[#e2eaf3] p-4 xl:border-b-0 xl:border-r">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8aa0bb]">
              <Upload class="h-3.5 w-3.5 text-[#2563eb]" />
              Literature Intake
            </p>
            <h3 class="mt-2 text-xl font-semibold tracking-[-0.035em] text-slate-950">DOI 批量导入</h3>
            <p class="mt-1 text-sm leading-6 text-slate-500">粘贴 DOI 列表，系统会解析元数据、查重并生成待处理文献批次。</p>
          </div>
          <span class="rounded-full bg-[#eef6ff] px-3 py-1 text-xs font-semibold text-[#2563eb]">{{ parsedDois.length }} DOI</span>
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <input
            v-model="batchName"
            class="rounded-[0.9rem] border border-[#dbe5f0] bg-[#f8fbff] px-3 py-2 text-sm font-medium text-slate-800 outline-none transition placeholder:text-[#8aa0bb] focus:border-[#93b4ff] focus:bg-white"
            placeholder="批次名，例如 AFM reviews May"
          >
          <select
            v-model="extractorType"
            class="rounded-[0.9rem] border border-[#dbe5f0] bg-[#f8fbff] px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#93b4ff] focus:bg-white"
          >
            <option value="tribology">Tribology</option>
            <option value="diffusion">Diffusion</option>
          </select>
        </div>

        <textarea
          v-model="doiInput"
          class="mt-3 min-h-[8.8rem] w-full resize-none rounded-[1.1rem] border border-[#dbe5f0] bg-[#f8fbff] px-3 py-3 font-mono text-sm leading-6 text-slate-800 outline-none transition placeholder:font-sans placeholder:text-[#8aa0bb] focus:border-[#93b4ff] focus:bg-white"
          placeholder="每行一个 DOI，或直接粘贴含 DOI 的文本：&#10;10.1007/s40544-024-0890-7&#10;https://doi.org/10.1021/acs.langmuir.2c00000"
        />

        <div v-if="importError" class="mt-3 rounded-[1rem] border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {{ importError }}
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-[#0f172a] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_28px_-20px_rgba(15,23,42,0.65)] transition hover:bg-[#172033] disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="importing || !parsedDois.length"
            @click="submitDoiImport"
          >
            <Loader2 v-if="importing" class="h-4 w-4 animate-spin" />
            <Upload v-else class="h-4 w-4" />
            {{ importing ? '导入中...' : '导入 DOI 批次' }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-[#dbe5f0] bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-[#b8c7d9]"
            @click="emit('refreshLiterature')"
          >
            <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': props.loading }" />
            刷新状态
          </button>
        </div>
      </div>

      <div class="min-w-0 p-4">
        <div class="grid gap-2 sm:grid-cols-4">
          <div class="rounded-[1rem] bg-[#f7fbff] p-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8aa0bb]">待 PDF</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ intakeStats.pendingPdf }}</p>
          </div>
          <div class="rounded-[1rem] bg-[#f7fbff] p-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8aa0bb]">待提取</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-slate-950">{{ intakeStats.extractingReady }}</p>
          </div>
          <div class="rounded-[1rem] bg-[#f7fbff] p-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8aa0bb]">已入库</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{{ intakeStats.extracted }}</p>
          </div>
          <div class="rounded-[1rem] bg-[#f7fbff] p-3">
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8aa0bb]">异常</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-rose-700">{{ intakeStats.failed }}</p>
          </div>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <div>
            <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8aa0bb]">
              <ClipboardList class="h-3.5 w-3.5 text-[#4f46e5]" />
              Batches
            </p>
            <h4 class="mt-1 text-base font-semibold text-slate-950">批次管理与状态追踪</h4>
          </div>
          <button
            v-if="batches.length"
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border border-[#e2eaf3] px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
            @click="clearAllBatches"
          >
            <Trash2 class="h-3.5 w-3.5" />
            清空历史
          </button>
        </div>

        <div v-if="batches.length" class="mt-3 grid gap-2 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <div class="space-y-2">
            <button
              v-for="batch in batches"
              :key="batch.id"
              type="button"
              class="w-full rounded-[1rem] border p-3 text-left transition"
              :class="activeBatch?.id === batch.id ? 'border-[#b8c7ff] bg-[#f5f7ff]' : 'border-[#e2eaf3] bg-white hover:border-[#b8c7d9]'"
              @click="activeBatchId = batch.id"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="line-clamp-2 text-sm font-semibold leading-snug text-slate-950">{{ batch.name }}</p>
                <button
                  type="button"
                  class="rounded-full p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                  @click.stop="removeBatch(batch.id)"
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="batchStatusClass(batch.status)">
                  {{ batchStatusLabel(batch.status) }}
                </span>
                <span class="text-[10px] font-semibold text-slate-400">{{ formatTime(batch.createdAt) }}</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eaf0f7]">
                <div
                  class="h-full rounded-full bg-[#4f46e5]"
                  :style="{ width: `${batch.total ? Math.round(((batch.created + batch.existing) / batch.total) * 100) : 0}%` }"
                />
              </div>
            </button>
          </div>

          <div class="min-w-0 rounded-[1.2rem] border border-[#e2eaf3] bg-[#fbfdff] p-3">
            <div v-if="activeBatch" class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-950">{{ activeBatch.name }}</p>
                <p class="mt-0.5 text-xs text-slate-500">
                  {{ activeBatch.total }} DOI · 新增 {{ activeBatch.created }} · 已存在 {{ activeBatch.existing }} · 失败 {{ activeBatch.failed }}
                </p>
              </div>
              <span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="batchStatusClass(activeBatch.status)">
                {{ batchStatusLabel(activeBatch.status) }}
              </span>
            </div>

            <div v-if="activeBatch" class="mt-3 max-h-[21rem] space-y-2 overflow-y-auto pr-1">
              <article
                v-for="item in activeBatch.items"
                :key="`${activeBatch.id}-${item.input}`"
                class="rounded-[1rem] border border-[#e3ebf4] bg-white p-3"
              >
                <div class="flex items-start gap-3">
                  <component
                    :is="statusForBatchItem(item).icon"
                    class="mt-0.5 h-4 w-4 shrink-0"
                    :class="statusForBatchItem(item).className.includes('rose') ? 'text-rose-500' : statusForBatchItem(item).className.includes('emerald') ? 'text-emerald-600' : 'text-slate-500'"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-slate-500">{{ item.doi || item.input }}</p>
                      <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold" :class="statusForBatchItem(item).className">
                        {{ statusForBatchItem(item).label }}
                      </span>
                    </div>
                    <p class="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-950">
                      {{ compactTitle(statusForBatchItem(item).literature?.title || item.title, item.doi || item.input) }}
                    </p>
                    <p class="mt-1 truncate text-xs text-slate-500">
                      {{ statusForBatchItem(item).literature?.journal || item.journal || '期刊待解析' }}
                      <template v-if="statusForBatchItem(item).literature?.year || item.year">
                        · {{ statusForBatchItem(item).literature?.year || item.year }}
                      </template>
                      · {{ statusForBatchItem(item).detail }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="rounded-full border border-[#dbe5f0] bg-white p-1.5 text-slate-500 transition hover:border-[#b8c7d9] hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!statusForBatchItem(item).literature"
                      title="在来源图谱中定位"
                      @click="selectLiterature(statusForBatchItem(item).literature?.id)"
                    >
                      <Search class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="rounded-full border border-[#dbe5f0] bg-white p-1.5 text-slate-500 transition hover:border-[#b8c7d9] hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="!statusForBatchItem(item).literature"
                      title="打开审核"
                      @click="openLiterature(statusForBatchItem(item).literature?.id)"
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>

        <div v-else class="mt-3 rounded-[1.2rem] border border-dashed border-[#cfd9e8] bg-[#fbfdff] p-5 text-center">
          <Database class="mx-auto h-6 w-6 text-[#8aa0bb]" />
          <p class="mt-2 text-sm font-semibold text-slate-800">还没有 DOI 批次</p>
          <p class="mt-1 text-xs leading-5 text-slate-500">导入后会在这里追踪“已建档、待 PDF、待提取、待审核、已入库”等状态。</p>
        </div>
      </div>
    </div>
  </section>
</template>
