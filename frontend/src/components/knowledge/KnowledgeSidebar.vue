<script setup lang="ts">
import { ArrowUpRight, BookOpen, Database, FolderKanban, GitBranch, LibraryBig, Sparkles, Table2 } from 'lucide-vue-next'

type KnowledgeMode = {
  key: string
  label: string
  count?: number | null
}

const props = defineProps<{
  currentSection: string
  modes: KnowledgeMode[]
  selectedRecordCount: number
}>()

const emit = defineEmits<{
  select: [section: string]
  openReview: []
}>()



function isModeActive(mode: KnowledgeMode) {
  if (mode.key === props.currentSection) return true
  return mode.key === 'datasets' && props.currentSection === 'cleaning'
}

function iconFor(section: string) {
  if (section === 'snapshots') return Table2
  if (section === 'insights') return Sparkles
  if (section === 'sources') return LibraryBig
  if (section === 'graph') return GitBranch
  if (section === 'cleaning') return Sparkles
  if (section === 'datasets') return FolderKanban
  return Database
}

function labelZh(label: string) {
  switch (label) {
    case 'Data Grid': return '数据浏览'
    case 'Data Snapshot': return '数据快照'
    case 'Pattern Discovery': return '规律发现'
    case 'Graph View': return '关系图'
    case 'Data Cleaning': return '数据清洗'
    case 'Dataset Builder': return '训练数据集'
    case 'Dataset Workflow': return '数据准备'
    case 'Source Atlas': return '来源图谱'
    default: return label
  }
}

function descriptionFor(section: string) {
  if (section === 'sources') return '期刊封面 / 来源分布'
  if (section === 'snapshots') return 'approved 索引表'
  if (section === 'insights') return '图表统计 / 文字稿'
  if (section === 'graph') return '阳/阴离子对热图'
  if (section === 'cleaning') return '清洗缺失 / 异常'
  if (section === 'datasets') return '质量检查 / 训练版本'
  return '查看全部记录'
}

function statusFor(mode: KnowledgeMode) {
  if (mode.key === 'explorer') return props.selectedRecordCount > 0 ? `${props.selectedRecordCount} 条` : '待选择'
  if (mode.key === 'snapshots') return '可查看'
  if (mode.key === 'insights') return '已生成'
  if (mode.key === 'sources') return mode.count ? `${mode.count} 篇` : '待入库'
  if (mode.key === 'cleaning') return mode.count ? `待处理 ${mode.count}` : '可继续'
  if (mode.key === 'datasets') {
    if (mode.count) return `待清洗 ${mode.count}`
    return props.selectedRecordCount > 0 ? '可生成' : '待数据'
  }
  if (mode.key === 'graph') return '可查看'
  return ''
}

function statusClass(mode: KnowledgeMode) {
  if (isModeActive(mode)) return 'bg-white text-indigo-700 dark:bg-white/10 dark:text-indigo-200'
  if (mode.key === 'sources' && mode.count) return 'bg-sky-50 text-sky-700 dark:bg-sky-500/12 dark:text-sky-300'
  if (mode.key === 'cleaning' && mode.count) return 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300'
  if (mode.key === 'datasets' && mode.count) return 'bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300'
  if (mode.key === 'datasets' && props.selectedRecordCount > 0) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300'
  return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
}


</script>

<template>
  <aside class="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900">
    <div class="px-1.5 pb-1 pt-1">
      <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">视图</p>
    </div>
    <div class="space-y-1">
      <button
        v-for="mode in props.modes"
        :key="mode.key"
        type="button"
        class="flex w-full items-center justify-between gap-1.5 rounded-md border px-2 py-2 text-left transition"
        :class="isModeActive(mode)
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/12 dark:text-indigo-200'
          : 'border-transparent bg-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-800 dark:hover:bg-slate-800/60'"
        @click="emit('select', mode.key)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <component :is="iconFor(mode.key)" class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0">
            <span class="block truncate text-[13px] font-semibold leading-4">{{ labelZh(mode.label) }}</span>
            <span class="mt-0.5 block truncate text-[10px] font-normal leading-3 text-slate-500 dark:text-slate-500">{{ descriptionFor(mode.key) }}</span>
          </span>
        </span>
        <span
          class="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
          :class="statusClass(mode)"
        >
          {{ statusFor(mode) }}
        </span>
      </button>
    </div>



    <div class="mt-auto pt-3">
      <button
        type="button"
        class="inline-flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-[13px] transition hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-800"
        @click="emit('openReview')"
      >
        <span class="flex min-w-0 items-center gap-2">
          <BookOpen class="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span class="font-semibold text-slate-800 dark:text-slate-200">返回审核</span>
        </span>
        <ArrowUpRight class="h-3.5 w-3.5 text-slate-400" />
      </button>
    </div>
  </aside>
</template>
