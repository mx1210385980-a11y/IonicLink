<script setup lang="ts">
import { computed } from 'vue'

import AgentStatusPanel from '@/components/AgentStatusPanel.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import FileUpload from '@/components/FileUpload.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  queueSizeLabel: string
  operatorName: string
  runStateLabel: string
  selectedFileName: string
  selectedFile: any | null
  selectedFileId: string | null
  explorerDoi: string
  sessionScopeKey?: string | null
  files: any[]
  activeId: string | null
  bindFileUploadRef: (instance: any) => void
  bindChatPanelRef: (instance: any) => void
  sidebarTab: 'chat' | 'agents'
  isChatting: boolean
  latestAgentWorkflow: any | null
  activeRun: any | null
  activeFileName: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'select-file': [fileId: string]
  'remove-file': [fileId: string]
  'clear-files': []
  upload: [file: File]
  'batch-upload': [files: File[]]
  extract: [fileId: string]
  'batch-extract': [fileIds: string[]]
  'send-chat': [message: string]
  'update-sidebar-tab': [value: 'chat' | 'agents']
  'open-review': []
  'open-knowledge': []
  'clear-doi': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'upload', label: isChinese.value ? '上传队列' : 'Upload Queue' },
  { key: 'runs', label: isChinese.value ? '抽取运行' : 'Extraction Runs' },
  { key: 'batch', label: isChinese.value ? '批处理中心' : 'Batch Center' },
])

const signals = computed(() => [
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'queue', label: isChinese.value ? '队列规模' : 'Queue Size', value: props.queueSizeLabel },
  { key: 'run', label: isChinese.value ? '运行状态' : 'Run State', value: props.runStateLabel },
])

const statusSummary = computed(() => {
  const counts = {
    uploaded: 0,
    processing: 0,
    success: 0,
    error: 0,
  }

  for (const file of props.files) {
    const status = String(file?.status || '').toLowerCase()
    if (status in counts) {
      counts[status as keyof typeof counts] += 1
    }
  }

  return counts
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Pipeline' : 'Pipeline'"
      :title="isChinese ? '把上传、抽取和运行追踪收束到同一条处理流水线。' : 'Keep upload, extraction, and run tracking on one operational line.'"
      :description="isChinese
        ? '这一层只服务文献进入系统后的自动处理，不再承担平台级知识探索和帮助中心的混合职责。'
        : 'This surface is for documents entering the system and being processed, not for mixed knowledge browsing or help content.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '进入审阅层' : 'Open Review'"
      :secondary-action-label="isChinese ? '查看知识层' : 'Open Knowledge'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-review')"
      @secondary-action="emit('open-knowledge')"
    />

    <div v-if="currentSection === 'runs'" class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <aside class="shell-surface min-h-[22rem] overflow-hidden xl:min-h-0">
        <FileUpload
          :ref="bindFileUploadRef"
          :files="files"
          :active-id="activeId"
          @select="emit('select-file', $event)"
          @remove="emit('remove-file', $event)"
          @clear="emit('clear-files')"
          @upload="emit('upload', $event)"
          @batch-upload="emit('batch-upload', $event)"
          @extract="emit('extract', $event)"
          @batch-extract="emit('batch-extract', $event)"
        />
      </aside>

      <section class="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="shell-surface min-h-[28rem] overflow-hidden">
          <AgentStatusPanel
            class="h-full"
            :workflow="latestAgentWorkflow"
            :active-run="activeRun"
            :active-file-name="activeFileName"
          />
        </div>

        <div class="shell-surface px-5 py-5 sm:px-6">
          <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
            {{ isChinese ? '运行摘要' : 'Run Summary' }}
          </p>
          <div class="mt-4 space-y-4">
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '当前文件' : 'Active File' }}</p>
              <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{{ activeFileName || selectedFileName }}</p>
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '待抽取' : 'Uploaded' }}</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{{ statusSummary.uploaded }}</p>
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '处理中' : 'Processing' }}</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{{ statusSummary.processing }}</p>
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '已完成' : 'Completed' }}</p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{{ statusSummary.success }}</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="currentSection === 'batch'" class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[22rem_minmax(0,1fr)_22rem]">
      <aside class="shell-surface min-h-[22rem] overflow-hidden xl:min-h-0">
        <FileUpload
          :ref="bindFileUploadRef"
          :files="files"
          :active-id="activeId"
          @select="emit('select-file', $event)"
          @remove="emit('remove-file', $event)"
          @clear="emit('clear-files')"
          @upload="emit('upload', $event)"
          @batch-upload="emit('batch-upload', $event)"
          @extract="emit('extract', $event)"
          @batch-extract="emit('batch-extract', $event)"
        />
      </aside>

      <section class="shell-surface min-h-[28rem] overflow-hidden px-5 py-5 sm:px-6">
        <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          {{ isChinese ? '批处理重构方向' : 'Batch Center Direction' }}
        </p>
        <div class="mt-5 grid gap-4 md:grid-cols-2">
          <div class="rounded-[1.6rem] border border-black/8 bg-white/60 px-4 py-4 dark:border-white/10 dark:bg-white/5">
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '上传与运行解耦' : 'Separate upload from run tracking' }}</p>
            <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {{ isChinese ? '批处理中心只关心队列和吞吐，不把知识浏览继续塞进同一块画布。' : 'The batch center should care about queue health and throughput instead of mixing in knowledge browsing.' }}
            </p>
          </div>
          <div class="rounded-[1.6rem] border border-black/8 bg-white/60 px-4 py-4 dark:border-white/10 dark:bg-white/5">
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '失败重跑入口集中' : 'Consolidate retry controls' }}</p>
            <p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">
              {{ isChinese ? '后续这里会承接失败重跑、批量同步和优先级排序。' : 'This is where retries, bulk sync, and prioritization should land next.' }}
            </p>
          </div>
          <div class="rounded-[1.6rem] border border-black/8 bg-white/60 px-4 py-4 dark:border-white/10 dark:bg-white/5">
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '成功记录' : 'Successful Files' }}</p>
            <p class="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{{ statusSummary.success }}</p>
          </div>
          <div class="rounded-[1.6rem] border border-black/8 bg-white/60 px-4 py-4 dark:border-white/10 dark:bg-white/5">
            <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ isChinese ? '异常文件' : 'Files With Issues' }}</p>
            <p class="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{{ statusSummary.error }}</p>
          </div>
        </div>
      </section>

      <aside class="shell-surface min-h-[22rem] overflow-hidden xl:min-h-0">
        <AgentStatusPanel
          class="h-full"
          :workflow="latestAgentWorkflow"
          :active-run="activeRun"
          :active-file-name="activeFileName"
        />
      </aside>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto xl:flex-row xl:overflow-hidden">
      <aside class="shell-surface min-h-[22rem] w-full overflow-hidden xl:min-h-0 xl:w-[21rem]">
        <FileUpload
          :ref="bindFileUploadRef"
          :files="files"
          :active-id="activeId"
          @select="emit('select-file', $event)"
          @remove="emit('remove-file', $event)"
          @clear="emit('clear-files')"
          @upload="emit('upload', $event)"
          @batch-upload="emit('batch-upload', $event)"
          @extract="emit('extract', $event)"
          @batch-extract="emit('batch-extract', $event)"
        />
      </aside>

      <main class="shell-surface min-h-[32rem] min-w-0 flex-1 overflow-hidden xl:min-h-0">
        <IntegratedExplorer
          :key="sessionScopeKey || 'pipeline-explorer'"
          :initial-doi="explorerDoi"
          :selected-file-id="selectedFileId"
          :source-name="selectedFile?.name"
          :literature-metadata="selectedFile?.metadata"
          @view-literature="emit('open-review')"
          @clear-doi="emit('clear-doi')"
        />
      </main>

      <aside class="shell-surface min-h-[24rem] w-full overflow-hidden xl:min-h-0 xl:w-[24rem]">
        <div class="border-b border-black/8 p-2 dark:border-white/10">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="rounded-full px-3 py-2 text-sm font-semibold transition"
              :class="sidebarTab === 'chat'
                ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_14px_28px_-20px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
                : 'bg-transparent text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
              @click="emit('update-sidebar-tab', 'chat')"
            >
              {{ isChinese ? '协助' : 'Assistant' }}
            </button>
            <button
              type="button"
              class="rounded-full px-3 py-2 text-sm font-semibold transition"
              :class="sidebarTab === 'agents'
                ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_14px_28px_-20px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
                : 'bg-transparent text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
              @click="emit('update-sidebar-tab', 'agents')"
            >
              {{ isChinese ? '协同运行' : 'Runs' }}
            </button>
          </div>
        </div>

        <div class="relative min-h-0 flex-1 bg-white/35 dark:bg-[#050c14]/60">
          <ChatPanel
            v-show="sidebarTab === 'chat'"
            :ref="bindChatPanelRef"
            class="absolute inset-0"
            :loading="isChatting"
            @send="emit('send-chat', $event)"
          />
          <AgentStatusPanel
            v-show="sidebarTab === 'agents'"
            class="absolute inset-0"
            :workflow="latestAgentWorkflow"
            :active-run="activeRun"
            :active-file-name="activeFileName"
          />
        </div>
      </aside>
    </div>
  </div>
</template>
