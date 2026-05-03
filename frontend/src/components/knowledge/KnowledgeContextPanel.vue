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
  return '下一步：检查数据质量'
})
const nextStepDescription = computed(() => {
  if (isCleaningSection.value) return '确认缺失和异常后，把可用记录划分为基础数据集和增强数据集。'
  if (isDatasetSection.value) return '保存数据集版本后，Modeling 会直接读取这个训练版本。'
  return '先进入质量检查，避免脏数据直接进入训练。'
})
const nextStepButton = computed(() => {
  if (isCleaningSection.value) return '生成训练数据集'
  if (isDatasetSection.value) return '打开 Modeling'
  return '进入质量检查'
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

const filteredLiterature = computed(() => {
  const query = literatureQuery.value.trim().toLowerCase()
  const items = props.literatureItems || []
  if (!query) return items.slice(0, 24)
  return items
    .filter((item) => {
      const haystack = [
        item.title,
        item.doi,
        item.authors,
        item.journal,
        item.year,
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice(0, 24)
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
  <aside class="flex min-h-0 flex-col gap-3">
    <!-- 下一步 -->
    <section class="rounded-[1.4rem] border border-[#cfd9ff] bg-gradient-to-br from-[#f5f7ff] to-[#eef0ff] p-4">
      <div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#4c4fdc]">
        <Microscope class="h-3.5 w-3.5" />
        {{ nextStepTitle }}
      </div>
      <p class="mt-2 text-xs leading-5 text-slate-500">
        {{ nextStepDescription }}
      </p>
      <button
        type="button"
        class="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[0.85rem] bg-[#4c4fdc] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3f42c8]"
        @click="handlePrimaryNext"
      >
        {{ nextStepButton }}
        <ArrowRight class="h-3.5 w-3.5" />
      </button>
    </section>

    <!-- 作用域与文献库 -->
    <section class="flex min-h-0 flex-col rounded-[1.4rem] border border-[#dce5ef] bg-white overflow-hidden flex-1">
      <div class="p-4 pb-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8ca0ba]">
            <LibraryBig class="h-3.5 w-3.5" />
            文献库范围
          </div>
          <button
            type="button"
            class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[#dce5ef] text-slate-400 transition hover:bg-[#f8fbff] hover:text-[#4c4fdc]"
            title="刷新当前 scope 文献库"
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
            class="h-7 w-full rounded-md border border-[#dce5ef] bg-[#f8fafc] pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#b8c1ff] focus:bg-white focus:ring-1 focus:ring-[#b8c1ff]"
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
          class="flex w-full items-center justify-between rounded-[0.5rem] px-2.5 py-1.5 text-left transition"
          :class="!props.activeSourceId
            ? 'bg-[#eff2ff] text-[#4c4fdc] font-semibold'
            : 'bg-transparent text-slate-600 hover:bg-[#f8fafc] hover:text-slate-900 font-medium'"
          @click="emit('selectSource', null)"
        >
          <span class="truncate text-[11.5px]">全库全部文献</span>
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
            class="group flex w-full flex-col rounded-[0.75rem] border px-2.5 py-2 text-left transition"
            :class="isActiveSource(item)
              ? 'border-[#b8c1ff] bg-[#f5f7ff] shadow-[0_10px_22px_-18px_rgba(76,79,220,0.5)]'
              : 'border-transparent bg-transparent hover:border-[#e2e8f0] hover:bg-[#f8fafc]'"
            @click="emit('selectSource', item.id)"
          >
            <div class="flex items-start gap-2">
              <p
                class="min-w-0 flex-1 line-clamp-2 text-[12px] font-black leading-[1.25]"
                :class="isActiveSource(item) ? 'text-[#4c4fdc]' : 'text-slate-900'"
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
                  class="rounded-md px-1.5 py-0.5 text-[9.5px] font-bold text-[#4c4fdc] opacity-0 transition hover:bg-[#eef0ff] group-hover:opacity-100"
                  @click.stop="emit('openReviewSource', item.id)"
                >
                  审核
                </button>
              </div>
            </div>
            
            <div class="mt-1 flex flex-col gap-1 pr-8">
              <div class="flex items-center gap-1.5 text-[10px]">
                <span
                  v-if="displayYear(item)"
                  class="shrink-0 rounded-[4px] bg-[#f1f5f9] px-1.5 py-0.5 font-bold text-slate-600 border border-[#e2e8f0]"
                >
                  {{ displayYear(item) }}
                </span>
                <span v-if="item.journal" class="truncate font-semibold text-slate-500" :title="item.journal">
                  {{ item.journal }}
                </span>
              </div>
              <div class="flex flex-col gap-0.5 text-[9.5px] text-[#8090aa]">
                <span v-if="authorsSummary(item)" class="line-clamp-2 font-medium leading-3.5" :title="authorsSummary(item)">
                  {{ authorsSummary(item) }}
                </span>
                <span v-if="!authorsSummary(item)" class="text-slate-400">作者未记录</span>
                <span v-if="displayDoi(item)" class="truncate font-mono text-[8.5px] text-slate-400" :title="displayDoi(item)">
                  {{ displayDoi(item) }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </section>

    <!-- 导出 -->
    <section class="rounded-[1.4rem] border border-[#dce5ef] bg-white p-4">
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
            class="inline-flex w-full items-center justify-center gap-2 rounded-[0.95rem] bg-[#101b29] px-3 py-3 text-sm font-semibold text-white transition hover:bg-[#172538]"
            @click="emit('exportData', 'csv')"
          >
            <FileText class="h-3.5 w-3.5" />
            CSV
          </button>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-[0.85rem] border border-[#dde6f1] px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
              @click="emit('exportData', 'json')"
            >
              <FileJson2 class="h-3.5 w-3.5" />
              JSON
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 rounded-[0.85rem] border border-[#dde6f1] px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
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
