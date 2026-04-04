<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Filter,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Upload,
} from 'lucide-vue-next'

import type { AgentMessage, AgentWorkflow, BatchFile, ExtractionRunDetail } from '@/lib/api'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  queueSizeLabel: string
  operatorName: string
  runStateLabel: string
  selectedFileName: string
  selectedFile: BatchFile | null
  selectedFileId: string | null
  explorerDoi: string
  sessionScopeKey?: string | null
  files: BatchFile[]
  activeId: string | null
  bindFileUploadRef: (instance: any) => void
  bindChatPanelRef: (instance: any) => void
  sidebarTab: 'chat' | 'agents'
  isChatting: boolean
  latestAgentWorkflow: AgentWorkflow | null
  activeRun: ExtractionRunDetail | null
  activeFileName: string | null
}>()

const emit = defineEmits([
  'change-section',
  'select-file',
  'remove-file',
  'clear-files',
  'upload',
  'batch-upload',
  'extract',
  'batch-extract',
  'send-chat',
  'update-sidebar-tab',
  'open-review',
  'open-knowledge',
  'clear-doi',
])

type PipelineFilter = 'all' | 'processing' | 'error' | 'success'
type QueueItem = {
  id: string
  name: string
  status: string
  badge: string
  badgeClass: string
  meta: string
  sublabel: string
  progress: number
  progressClass: string
  isSelected: boolean
}

type InspectorStep = {
  id: string
  label: string
  state: 'complete' | 'active' | 'waiting' | 'error'
  meta: string
}

type InspectorLog = {
  id: string
  prefix: string
  message: string
  tone: 'info' | 'agent' | 'system'
}

const searchQuery = ref('')
const statusFilter = ref<PipelineFilter>('all')
const fileInput = ref<HTMLInputElement | null>(null)

const queueEyebrow = computed(() => {
  if (props.currentSection === 'batch') return 'BATCH SYNC & RETRIES'
  if (props.currentSection === 'upload') return 'UPLOAD QUEUE & STAGING'
  return 'ACTIVE QUEUE & RECENT'
})

const queueTitle = computed(() => {
  if (props.currentSection === 'batch') return 'Monitor grouped sync and retry work.'
  if (props.currentSection === 'upload') return 'Stage documents before extraction.'
  return 'Monitor extraction flow.'
})

const filteredFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return [...props.files]
    .filter((file) => {
      if (query && !String(file.name || '').toLowerCase().includes(query)) {
        return false
      }
      if (statusFilter.value !== 'all' && file.status !== statusFilter.value) {
        return false
      }
      return true
    })
    .sort((left, right) => queueWeight(right) - queueWeight(left))
})

const selectedQueueFile = computed<BatchFile | null>(() => {
  return props.files.find((file) => file.id === props.activeId)
    || props.selectedFile
    || filteredFiles.value[0]
    || props.files[0]
    || null
})

const activeInspectorRun = computed<ExtractionRunDetail | null>(() => {
  const selectedFile = selectedQueueFile.value
  const activeRun = props.activeRun
  if (!selectedFile || !activeRun) return null
  return String(activeRun.literature_id) === String(selectedFile.id) ? activeRun : null
})

const queueItems = computed<QueueItem[]>(() => filteredFiles.value.map((file) => ({
  id: file.id,
  name: file.name,
  status: file.status,
  badge: statusBadge(file.status),
  badgeClass: statusBadgeClass(file.status),
  meta: [
    `doc-${String(file.id || '').slice(0, 6)}`,
    file.scopeKey || props.operatorName || props.activeScopeLabel,
    file.status === 'processing' ? `${Math.max(1, Math.round(file.progress || 0))}% complete` : detailLabel(file),
  ].join('  •  '),
  sublabel: file.errorMessage || file.progressMessage || stageLabelFromFile(file),
  progress: progressForFile(file),
  progressClass: progressTone(file.status),
  isSelected: file.id === props.activeId || file.id === props.selectedFileId || file.id === selectedQueueFile.value?.id,
})))

const inspectorFileName = computed(() => props.activeFileName || selectedQueueFile.value?.name || 'No document selected')

const inspectorStatus = computed(() => {
  if (activeInspectorRun.value) return formatRunStatus(activeInspectorRun.value.status)
  if (selectedQueueFile.value) return statusBadge(selectedQueueFile.value.status)
  return 'IDLE'
})

const inspectorSteps = computed<InspectorStep[]>(() => {
  const activeRun = activeInspectorRun.value
  const selectedFile = selectedQueueFile.value
  const failed = isFailedRun(activeRun?.status) || selectedFile?.status === 'error'
  const completed = isCompletedRun(activeRun?.status) || selectedFile?.status === 'success'
  const activeIndex = inferActiveStage(activeRun, selectedFile)

  const definitions = [
    { id: 'register', label: 'Document Registration' },
    { id: 'layout', label: 'Layout Analysis & Chunking' },
    { id: 'extract', label: 'LLM Agent Extraction' },
    { id: 'validate', label: 'Schema Validation' },
  ]

  return definitions.map((definition, index) => {
    let state: InspectorStep['state'] = 'waiting'
    if (completed || index < activeIndex) {
      state = 'complete'
    } else if (failed && index === activeIndex) {
      state = 'error'
    } else if (!completed && index === activeIndex) {
      state = 'active'
    }

    return {
      id: definition.id,
      label: definition.label,
      state,
      meta: stepMeta(definition.id, state, activeRun, selectedFile),
    }
  })
})

const inspectorLogs = computed<InspectorLog[]>(() => {
  if (activeInspectorRun.value?.progress_log?.length) {
    return activeInspectorRun.value.progress_log.slice(-8).map((item, index) => ({
      id: `${item.stage}-${index}`,
      prefix: stagePrefix(item.stage),
      message: item.message || formatStageLabel(item.stage),
      tone: item.stage.toLowerCase().includes('stage_e') ? 'agent' : item.stage.toLowerCase().includes('stage_d') ? 'system' : 'info',
    }))
  }

  if (props.latestAgentWorkflow?.messages?.length) {
    return props.latestAgentWorkflow.messages.slice(-8).map((message, index) => ({
      id: `${message.task_id}-${index}`,
      prefix: formatAgentPrefix(message),
      message: formatAgentMessage(message),
      tone: message.sender.toLowerCase().includes('agent') ? 'agent' : 'info',
    }))
  }

  if (selectedQueueFile.value?.errorMessage || selectedQueueFile.value?.progressMessage) {
    return [
      {
        id: 'file-message',
        prefix: selectedQueueFile.value.status === 'error' ? 'ISSUE' : 'INFO',
        message: selectedQueueFile.value.errorMessage || selectedQueueFile.value.progressMessage || 'Waiting for live logs.',
        tone: selectedQueueFile.value.status === 'error' ? 'system' : 'info',
      },
    ]
  }

  return [
    {
      id: 'empty',
      prefix: 'IDLE',
      message: 'Live agent logs will appear once a run starts processing.',
      tone: 'info',
    },
  ]
})

const inspectorSummary = computed(() => ({
  queue: props.queueSizeLabel,
  state: props.runStateLabel,
  scope: props.activeScopeLabel,
}))

function triggerUpload() {
  fileInput.value?.click()
}

function handleFileInput(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || []).filter((file) => /\.(pdf|txt|md)$/i.test(file.name))
  if (files.length === 1) {
    emit('upload', files[0])
  } else if (files.length > 1) {
    emit('batch-upload', files)
  }
  target.value = ''
}

function cycleFilter() {
  const filters: PipelineFilter[] = ['all', 'processing', 'error', 'success']
  const nextIndex = (filters.indexOf(statusFilter.value) + 1) % filters.length
  statusFilter.value = filters[nextIndex]!
}

function filterLabel() {
  if (statusFilter.value === 'processing') return 'Running'
  if (statusFilter.value === 'error') return 'Failed'
  if (statusFilter.value === 'success') return 'Success'
  return 'All'
}

function queueWeight(file: BatchFile) {
  if (file.id === props.activeId || file.id === props.selectedFileId) return 100
  if (file.status === 'processing') return 80
  if (file.status === 'error') return 60
  if (file.status === 'uploaded') return 40
  return 20
}

function progressForFile(file: BatchFile) {
  if (file.status === 'success') return 100
  if (file.status === 'error') return Math.max(18, Math.round(file.progress || 35))
  if (file.status === 'processing') return Math.max(12, Math.round(file.progress || 18))
  return 8
}

function detailLabel(file: BatchFile) {
  if (file.status === 'success') return `${file.records?.length || 0} records extracted`
  if (file.status === 'error') return 'Needs retry'
  return 'Ready to launch'
}

function stageLabelFromFile(file: BatchFile) {
  if (file.errorMessage) return file.errorMessage
  if (file.progressMessage) return file.progressMessage
  if (file.status === 'processing') return 'Agent extraction in progress'
  if (file.status === 'success') return 'Completed'
  if (file.status === 'error') return 'Execution failed'
  return 'Queued for extraction'
}

function statusBadge(status: string) {
  if (status === 'processing') return 'RUNNING'
  if (status === 'success') return 'SUCCESS'
  if (status === 'error') return 'FAILED'
  return 'QUEUED'
}

function statusBadgeClass(status: string) {
  if (status === 'processing') return 'border-[#cfd8ff] bg-[#eef2ff] text-[#3f55c4]'
  if (status === 'success') return 'border-[#b7efcf] bg-[#e9fff2] text-[#0f9f63]'
  if (status === 'error') return 'border-[#ffc9cf] bg-[#fff1f3] text-[#ef3958]'
  return 'border-[#d8e2ef] bg-[#f8fbff] text-[#7e91aa]'
}

function progressTone(status: string) {
  if (status === 'processing') return 'bg-[linear-gradient(90deg,#5a5de8_0%,#6674ff_100%)]'
  if (status === 'success') return 'bg-[linear-gradient(90deg,#1cc985_0%,#15b77a_100%)]'
  if (status === 'error') return 'bg-[linear-gradient(90deg,#ff5573_0%,#ef3958_100%)]'
  return 'bg-[linear-gradient(90deg,#c9d3e5_0%,#b9c6de_100%)]'
}

function inferActiveStage(activeRun: ExtractionRunDetail | null, file: BatchFile | null) {
  if (isCompletedRun(activeRun?.status) || file?.status === 'success') return 4
  if (isFailedRun(activeRun?.status) || file?.status === 'error') {
    const stage = String(activeRun?.summary?.current_stage || activeRun?.progress_log?.slice(-1)[0]?.stage || '').toLowerCase()
    if (stage.includes('stage_e') || stage.includes('validation')) return 3
    if (stage.includes('stage_c') || stage.includes('stage_d') || stage.includes('extract')) return 2
    if (stage.includes('stage_a') || stage.includes('stage_b') || stage.includes('layout')) return 1
    return 2
  }
  const progress = Math.max(activeRun ? mapRunProgress(activeRun) : 0, file ? progressForFile(file) : 0)
  if (progress >= 88) return 3
  if (progress >= 42) return 2
  if (progress >= 16) return 1
  return 0
}

function stepMeta(id: string, state: InspectorStep['state'], activeRun: ExtractionRunDetail | null, file: BatchFile | null) {
  if (state === 'complete') return 'done'
  if (state === 'error') return 'issue'
  if (state === 'waiting') return 'pending'

  if (id === 'extract' && activeRun) {
    return `${activeRun.candidate_count || 0} candidates`
  }
  if (id === 'validate' && activeRun) {
    return `${activeRun.final_count || 0} records`
  }
  if (id === 'layout') {
    return file?.status === 'processing' ? `${Math.max(1, Math.round(file.progress || 0))}%` : 'active'
  }
  return 'active'
}

function mapRunProgress(run: ExtractionRunDetail) {
  const stage = String(run.summary?.current_stage || run.progress_log?.slice(-1)[0]?.stage || '').toLowerCase()
  if (isCompletedRun(run.status)) return 100
  if (stage.includes('stage_e')) return 92
  if (stage.includes('stage_d') || stage.includes('extract')) return 70
  if (stage.includes('stage_c') || stage.includes('layout') || stage.includes('fallback_table')) return 38
  if (stage.includes('stage_a') || stage.includes('stage_b')) return 16
  return 10
}

function isCompletedRun(status?: string | null) {
  return ['completed', 'success'].includes(String(status || '').toLowerCase())
}

function isFailedRun(status?: string | null) {
  return ['failed', 'error', 'cancelled'].includes(String(status || '').toLowerCase())
}

function formatRunStatus(status?: string | null) {
  const normalized = String(status || '').toLowerCase()
  if (!normalized) return 'IDLE'
  if (normalized === 'completed') return 'SUCCESS'
  if (normalized === 'processing') return 'RUNNING'
  return normalized.toUpperCase()
}

function formatStageLabel(stage?: string | null) {
  const normalized = String(stage || '').trim().toLowerCase()
  if (!normalized) return 'Queued'
  if (normalized.includes('stage_a')) return 'Document registration'
  if (normalized.includes('stage_b')) return 'Layout analysis'
  if (normalized.includes('stage_c')) return 'Chunking and extraction'
  if (normalized.includes('stage_d')) return 'Candidate validation'
  if (normalized.includes('stage_e')) return 'Schema validation'
  return String(stage || '').replace(/[_\.]+/g, ' ')
}

function stagePrefix(stage?: string | null) {
  const normalized = String(stage || '').trim().toLowerCase()
  if (normalized.includes('stage_e')) return 'VALIDATOR'
  if (normalized.includes('stage_d')) return 'QUERY'
  if (normalized.includes('stage_c')) return 'AGENT'
  if (normalized.includes('stage_a') || normalized.includes('stage_b')) return 'SYSTEM'
  return 'INFO'
}

function formatAgentPrefix(message: AgentMessage) {
  return `${message.sender.toUpperCase()}`
}

function formatAgentMessage(message: AgentMessage) {
  const payloadText = typeof message.payload?.message === 'string'
    ? message.payload.message
    : typeof message.payload?.detail === 'string'
      ? message.payload.detail
      : `${message.sender} -> ${message.receiver}`

  return payloadText
}

function logToneClass(tone: InspectorLog['tone']) {
  if (tone === 'agent') return 'text-[#7df5d8]'
  if (tone === 'system') return 'text-[#9cb7ff]'
  return 'text-[#d5def1]'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      accept=".pdf,.txt,.md"
      multiple
      @change="handleFileInput"
    >

    <section class="shell-surface px-4 py-4 sm:px-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-[0.95rem] bg-[linear-gradient(135deg,#5b56ea_0%,#4a57df_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_22px_44px_-28px_rgba(74,87,223,0.82)] transition hover:brightness-105"
            @click="triggerUpload"
          >
            <Upload class="h-4 w-4" />
            Upload Document
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-[0.95rem] border px-5 py-3 text-sm font-medium transition"
            :class="currentSection === 'batch'
              ? 'border-[#d6def4] bg-[#f8fbff] text-slate-900'
              : 'border-[#d9e2ef] bg-white text-slate-700 hover:bg-[#f8fbff]'"
            @click="emit('change-section', currentSection === 'batch' ? 'runs' : 'batch')"
          >
            <Bot class="h-4 w-4" />
            Batch Sync
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-[16rem] flex-1 lg:w-[17rem] lg:flex-none">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model="searchQuery"
              type="text"
              class="h-11 w-full rounded-[0.95rem] border border-[#d9e2ef] bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#b7c6ef]"
              placeholder="Search runs..."
            >
          </div>

          <button
            type="button"
            class="inline-flex h-11 items-center gap-2 rounded-[0.95rem] border border-[#d9e2ef] bg-white px-3.5 text-sm font-medium text-slate-600 transition hover:bg-[#f8fbff]"
            :title="`Filter: ${filterLabel()}`"
            @click="cycleFilter"
          >
            <Filter class="h-4 w-4" />
            <span class="hidden sm:inline">{{ filterLabel() }}</span>
          </button>
        </div>
      </div>
    </section>

    <div class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <section class="shell-surface flex min-h-0 flex-col overflow-hidden">
        <div class="flex items-start justify-between gap-3 border-b border-black/8 px-5 py-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">{{ queueEyebrow }}</p>
            <h2 class="mt-1 text-[1.05rem] font-semibold tracking-[-0.04em] text-slate-950">
              {{ queueTitle }}
            </h2>
          </div>
          <div class="inline-flex items-center gap-2 text-sm text-slate-500">
            <Clock3 class="h-4 w-4" />
            Auto-refreshing
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div v-if="queueItems.length" class="space-y-3">
            <button
              v-for="item in queueItems"
              :key="item.id"
              type="button"
              class="w-full rounded-[1.2rem] border px-4 py-3.5 text-left transition"
              :class="item.isSelected
                ? 'border-[#aebdfc] bg-[#f7f9ff] shadow-[0_18px_42px_-34px_rgba(74,87,223,0.5)]'
                : 'border-black/8 bg-white hover:border-[#d5ddf2] hover:bg-[#fbfcff]'"
              @click="emit('select-file', item.id)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.9rem] bg-[#f3f6fb] text-[#7e91aa]">
                    <FileText class="h-5 w-5" />
                  </div>

                  <div class="min-w-0">
                    <p class="truncate text-[0.98rem] font-semibold tracking-[-0.03em] text-slate-950">
                      {{ item.name }}
                    </p>
                    <p class="mt-1 truncate text-sm text-slate-500">{{ item.meta }}</p>
                  </div>
                </div>

                <div class="inline-flex shrink-0 items-center rounded-[0.7rem] border px-2.5 py-1 text-sm font-semibold" :class="item.badgeClass">
                  {{ item.badge }}
                </div>
              </div>

              <div class="mt-4">
                <div class="h-1.5 overflow-hidden rounded-full bg-[#e8edf5]">
                  <div class="h-full rounded-full transition-all duration-300" :class="item.progressClass" :style="{ width: `${item.progress}%` }" />
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between gap-3 text-sm">
                <p class="min-w-0 truncate text-slate-500">{{ item.sublabel }}</p>
                <div class="inline-flex shrink-0 items-center gap-1 text-slate-500">
                  <span>{{ item.status === 'processing' ? 'Agent: Extraction' : item.status === 'error' ? 'Needs retry' : item.status === 'success' ? 'Completed' : 'Queued' }}</span>
                  <ChevronRight class="h-4 w-4" />
                </div>
              </div>
            </button>
          </div>

          <div
            v-else
            class="flex h-full min-h-[18rem] items-center justify-center rounded-[1.2rem] border border-dashed border-black/10 bg-white/55 px-6 text-center text-sm text-slate-500"
          >
            No pipeline runs match the current search and filter.
          </div>
        </div>
      </section>

      <aside class="shell-surface flex min-h-0 flex-col overflow-hidden">
        <div class="border-b border-black/8 px-5 py-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">RUN INSPECTOR</p>
              <h2 class="mt-2 truncate text-[1rem] font-semibold tracking-[-0.04em] text-slate-950">
                {{ inspectorFileName }}
              </h2>
            </div>
            <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.04] hover:text-slate-600">
              <MoreHorizontal class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">Execution Stages</p>
            <div class="mt-4 space-y-4">
              <div
                v-for="step in inspectorSteps"
                :key="step.id"
                class="flex items-center justify-between gap-3"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <div
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                    :class="step.state === 'complete'
                      ? 'border-[#17bf79] bg-[#edfff5] text-[#17bf79]'
                      : step.state === 'active'
                        ? 'border-[#7f92ff] bg-[#eef2ff] text-[#5865f2]'
                        : step.state === 'error'
                          ? 'border-[#ffb9c4] bg-[#fff1f3] text-[#ef3958]'
                          : 'border-[#d9e2ef] bg-white text-[#d0d9e7]'"
                  >
                    <CheckCircle2 v-if="step.state === 'complete'" class="h-3.5 w-3.5" />
                    <LoaderCircle v-else-if="step.state === 'active'" class="h-3.5 w-3.5 animate-spin" />
                    <CircleAlert v-else-if="step.state === 'error'" class="h-3.5 w-3.5" />
                  </div>
                  <span
                    class="truncate text-[0.98rem]"
                    :class="step.state === 'waiting' ? 'text-[#a7b3c6]' : 'text-slate-900'"
                  >
                    {{ step.label }}
                  </span>
                </div>
                <span class="shrink-0 text-sm text-[#8ea2c0]">{{ step.meta }}</span>
              </div>
            </div>
          </div>

          <div class="mt-8">
            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8ea2c0]">Live Agent Logs</p>
            <div class="mt-3 rounded-[1rem] bg-[#121a2d] px-4 py-4 text-[12px] leading-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div v-for="entry in inspectorLogs" :key="entry.id" class="flex items-start gap-3">
                <span class="text-[#50607d]">&gt;</span>
                <p class="font-mono" :class="logToneClass(entry.tone)">
                  <span class="mr-2 text-[#7da1ff]">[{{ entry.prefix }}]</span>{{ entry.message }}
                </p>
              </div>
            </div>
          </div>

          <div class="mt-8 grid gap-2">
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Queue</span>
              {{ inspectorSummary.queue }}
            </div>
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Run State</span>
              {{ inspectorStatus }} / {{ inspectorSummary.state }}
            </div>
            <div class="rounded-[0.95rem] border border-black/8 bg-white/70 px-3.5 py-3 text-sm text-slate-600">
              <span class="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ea2c0]">Scope</span>
              {{ inspectorSummary.scope }}
            </div>
          </div>

          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-[0.95rem] bg-[#111827] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1f2937]"
              @click="emit('open-review')"
            >
              Open Review
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-[0.95rem] border border-[#d9e2ef] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f8fbff]"
              @click="emit('open-knowledge')"
            >
              Open Knowledge
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
