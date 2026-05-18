<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowRight, Download, FileCode2, FileJson2, FileText, Microscope, RefreshCw, Search, X, Check, LibraryBig } from 'lucide-vue-next'
import type { Literature } from '@/lib/api'

const props = defineProps<{
  currentSection: string
  modeLabel: string
  selectedSourceName: string
  activeScopeLabel: string
  selectedRecordCount: number
  explorerDoi: string
  extractorType?: 'tribology' | 'diffusion'
  activeSourceId?: string | null
  literatureItems?: Literature[]
  literatureLoading?: boolean
  literatureError?: string
}>()

const emit = defineEmits<{
  openTraining: []
  openReview: []
  changeSection: [section: string]
  exportData: [format: 'json' | 'csv' | 'ndjson']
  selectSource: [literatureId: number | null]
  refreshLiterature: []
  openReviewSource: [literatureId?: number | null]
}>()

const sourceLine = computed(() => props.explorerDoi || '所有可见文献')
const isCleaningSection = computed(() => props.currentSection === 'cleaning')
const isDatasetSection = computed(() => props.currentSection === 'datasets')
const nextStepTitle = computed(() => {
  if (isCleaningSection.value) return '下一步：生成训练数据集'
  if (isDatasetSection.value) return '下一步：训练模型'
  return '下一步：数据清洗'
})
const nextStepDescription = computed(() => {
  if (isCleaningSection.value) return '确认缺失和异常后，把可用记录划分为基础数据集和增强数据集。'
  if (isDatasetSection.value) return '保存数据集版本后，Modeling 会直接读取这个训练版本。'
  return '先进入数据清洗，避免脏数据直接进入训练。'
})
const nextStepButton = computed(() => {
  if (isCleaningSection.value) return '生成训练数据集'
  if (isDatasetSection.value) return '打开 Modeling'
  return '进入数据清洗'
})

function shortcutHint(section: string) {
  if (section === 'cleaning') return '清洗后再导出，避免脏数据进入训练'
  if (section === 'datasets') return '导出后到 Modeling 页选这个数据集训练'
  if (section === 'graph') return '关系图便于发现共现稀疏的离子对'
  return '筛好后用下面按钮把当前结果导出'
}

function handlePrimaryNext() {
  if (isCleaningSection.value) {
    emit('changeSection', 'datasets')
    return
  }
  if (isDatasetSection.value) {
    emit('openTraining')
    return
  }
  emit('changeSection', 'cleaning')
}

const literatureQuery = ref('')

function isNoDataLiterature(item: Literature) {
  return String(item.status || '').trim().toLowerCase() === 'no_data'
}

function sortLiteratureForList(items: Literature[]) {
  return [...items].sort((a, b) => {
    const aNoData = isNoDataLiterature(a) ? 1 : 0
    const bNoData = isNoDataLiterature(b) ? 1 : 0
    if (aNoData !== bNoData) return aNoData - bNoData
    return Number(b.id || 0) - Number(a.id || 0)
  })
}

const filteredLiterature = computed(() => {
  const query = literatureQuery.value.trim().toLowerCase()
  const items = sortLiteratureForList(props.literatureItems || [])
  if (!query) return items
  return items
    .filter((item) => {
      const haystack = [
        item.title,
        item.doi,
        item.authors,
        item.journal,
        item.year,
        item.errorMessage,
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
})

function isActiveSource(item: Literature) {
  return String(item.id) === String(props.activeSourceId || '')
}

function literatureTitle(item: Literature) {
  return String(item.title || item.doi || `Literature ${item.id}`).trim()
}

function isTemporaryIdentifier(value: string) {
  return /^temp[-_]/i.test(value.trim()) || /^temporary[-_]/i.test(value.trim())
}

function displayDoi(item: Literature) {
  const doi = String(item.doi || '').trim()
  return doi && !isTemporaryIdentifier(doi) ? doi : ''
}

function displayYear(item: Literature) {
  if (item.year) return String(item.year)
  return literatureTitle(item).match(/\b(19|20)\d{2}\b/)?.[0] || ''
}

function authorsSummary(item: Literature) {
  const authors = String(item.authors || '').trim()
  if (!authors) return ''
  return authors
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
}

function noDataReason(item: Literature) {
  if (!isNoDataLiterature(item)) return ''
  const message = String(item.errorMessage || '').trim()
  const normalized = message.toLowerCase().replace(/[。.]$/, '')
  if (!message || ['no tribology data found', 'no extractable records found', 'no extractable diffusion records found'].includes(normalized)) {
    return '未找到可抽取的离子液体摩擦/磨损结构化数据。'
  }
  return message
}

function showBibliographyMeta(item: Literature) {
  return !isNoDataLiterature(item)
}


function literatureCountLabel(item: Literature) {
  const recordCount = Number(item.recordCount || 0)
  const candidateCount = Number(item.candidateCount || 0)
  if (recordCount > 0) return `${recordCount} 条`
  if (candidateCount > 0) return `${candidateCount} 待审`
  const status = String(item.status || '').trim()
  return status ? status : '无数据'
}
</script>

<template>
  <aside class="flex min-h-0 flex-col gap-2">
    <!-- 下一步 -->
    <section class="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-500/25 dark:bg-indigo-500/10">
      <div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
        <Microscope class="h-3.5 w-3.5" />
        {{ nextStepTitle }}
      </div>
      <p class="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
        {{ nextStepDescription }}
      </p>
      <button
        type="button"
        class="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
        @click="handlePrimaryNext"
      >
        {{ nextStepButton }}
        <ArrowRight class="h-3.5 w-3.5" />
      </button>
    </section>

    <!-- 课题组文献库 -->
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="p-3 pb-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <LibraryBig class="h-3.5 w-3.5" />
            <span class="truncate">{{ props.activeScopeLabel }}</span>
          </div>
          <button
            type="button"
            class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 text-slate-400 transition hover:bg-slate-50 hover:text-indigo-600 dark:border-slate-800 dark:hover:bg-slate-800"
            title="刷新课题组文献库"
            @click="emit('refreshLiterature')"
          >
            <RefreshCw class="h-3 w-3" :class="props.literatureLoading ? 'animate-spin' : ''" />
          </button>
        </div>
        
        <dl class="mt-3 space-y-2.5 text-xs">
          <div class="flex items-start justify-between gap-2">
            <dt class="text-slate-500">已选记录</dt>
            <dd class="text-right font-semibold text-slate-800 tabular-nums">{{ props.selectedRecordCount }} 条</dd>
          </div>
          <div class="flex items-start justify-between gap-2">
            <dt class="shrink-0 text-slate-500">DOI 过滤</dt>
            <dd class="min-w-0 text-right">
              <span class="block break-all text-[11px] font-medium text-slate-600">{{ sourceLine }}</span>
            </dd>
          </div>
        </dl>
        
        <div class="relative mt-3">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            v-model="literatureQuery"
            type="search"
            placeholder="搜索文献 / DOI"
            class="h-7 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:focus:border-indigo-500/50"
          >
          <button
            v-if="literatureQuery"
            type="button"
            class="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            @click="literatureQuery = ''"
          >
            <X class="h-3 w-3" />
          </button>
        </div>
      </div>
      
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 pt-1">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition"
          :class="!props.activeSourceId
            ? 'bg-indigo-50 text-indigo-700 font-semibold dark:bg-indigo-500/12 dark:text-indigo-200'
            : 'bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'"
          @click="emit('selectSource', null)"
        >
          <span class="truncate text-[11.5px]">{{ props.activeScopeLabel }}</span>
          <Check v-if="!props.activeSourceId" class="h-3.5 w-3.5 shrink-0" />
        </button>

        <div class="mt-1 space-y-1">
          <p v-if="props.literatureError" class="rounded-md border border-[#fecdd3] bg-[#fff5f6] px-2 py-1.5 text-[10px] text-[#cf334f]">
            {{ props.literatureError }}
          </p>
          <p v-else-if="props.literatureLoading && (!props.literatureItems || !props.literatureItems.length)" class="px-2 py-2 text-center text-[10px] text-slate-500">
            正在加载...
          </p>
          <p v-else-if="!filteredLiterature.length" class="px-2 py-2 text-center text-[10px] text-slate-500">
            暂无匹配文献
          </p>

          <button
            v-for="item in filteredLiterature"
            :key="item.id"
            type="button"
            class="group flex w-full flex-col rounded-lg border px-2.5 py-2 text-left transition"
            :class="isActiveSource(item)
              ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/25 dark:bg-indigo-500/10'
              : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-800/60'"
            @click="emit('selectSource', item.id)"
          >
            <div class="flex items-start gap-2">
              <p
                class="min-w-0 flex-1 line-clamp-2 text-[12px] font-black leading-[1.25]"
                :class="isActiveSource(item) ? 'text-indigo-700 dark:text-indigo-200' : 'text-slate-900 dark:text-slate-100'"
                :title="literatureTitle(item)"
              >
                {{ literatureTitle(item) }}
              </p>
              <div class="flex flex-col items-end gap-1 shrink-0">
                <span
                  class="rounded-md border px-1.5 py-0.5 text-[9.5px] font-black tabular-nums leading-none"
                  :class="Number(item.recordCount || 0) > 0 ? 'bg-[#e8f8f1] border-[#bbf7d0] text-[#047857]' : 'bg-[#fff4da] border-[#fed7aa] text-[#a05a00]'"
                >
                  {{ literatureCountLabel(item) }}
                </span>
                <button
                  type="button"
                  class="rounded-md px-1.5 py-0.5 text-[9.5px] font-bold text-indigo-600 opacity-0 transition hover:bg-indigo-50 group-hover:opacity-100 dark:text-indigo-300 dark:hover:bg-indigo-500/12"
                  @click.stop="emit('openReviewSource', item.id)"
                >
                  审核
                </button>
              </div>
            </div>
            
            <div
              class="mt-1 flex flex-col"
              :class="isNoDataLiterature(item) ? 'gap-1.5' : 'gap-1 pr-8'"
            >
              <div v-if="showBibliographyMeta(item)" class="flex items-center gap-1.5 text-[10px]">
                <span
                  v-if="displayYear(item)"
                  class="shrink-0 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
                >
                  {{ displayYear(item) }}
                </span>
                <span v-if="item.journal" class="truncate font-semibold text-slate-500" :title="item.journal">
                  {{ item.journal }}
                </span>
              </div>
              <div v-if="showBibliographyMeta(item)" class="flex flex-col gap-0.5 text-[9.5px] text-[#8090aa]">
                <span v-if="authorsSummary(item)" class="line-clamp-2 font-medium leading-3.5" :title="authorsSummary(item)">
                  {{ authorsSummary(item) }}
                </span>
                <span v-if="!authorsSummary(item)" class="text-slate-400">作者未记录</span>
                <span v-if="displayDoi(item)" class="truncate font-mono text-[8.5px] text-slate-400" :title="displayDoi(item)">
                  {{ displayDoi(item) }}
                </span>
              </div>
              <p
                v-if="noDataReason(item)"
                class="line-clamp-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold leading-[1.45] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
                :title="noDataReason(item)"
              >
                {{ noDataReason(item) }}
              </p>
            </div>
          </button>
        </div>
      </div>
    </section>

    <!-- 导出 -->
    <section class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <details>
        <summary class="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8ca0ba]">
          <Download class="h-3.5 w-3.5" />
          高级导出
        </summary>
        <p class="mt-2 text-xs leading-5 text-slate-500">
          {{ shortcutHint(props.currentSection) }}
        </p>

        <div class="mt-3 grid gap-2">
          <button
            type="button"
            class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            @click="emit('exportData', 'csv')"
          >
            <FileText class="h-3.5 w-3.5" />
            CSV
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="emit('exportData', 'json')"
            >
              <FileJson2 class="h-3.5 w-3.5" />
              JSON
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="emit('exportData', 'ndjson')"
            >
              <FileCode2 class="h-3.5 w-3.5" />
              NDJSON
            </button>
          </div>
        </div>
      </details>
    </section>
  </aside>
</template>
