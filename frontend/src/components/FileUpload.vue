<template>
  <div class="flex h-full min-h-0 flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <div class="shrink-0 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      <div class="flex items-center gap-2">
        <BookOpen class="h-5 w-5 text-blue-600" />
        <h2 class="text-base font-bold text-slate-800 dark:text-slate-100">{{ t('fileupload.title') }}</h2>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div
        class="relative mb-6 cursor-pointer rounded-2xl border-2 border-dashed bg-slate-50/50 p-6 text-center transition-all dark:bg-slate-900/60"
        :class="[
          isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
            : 'border-slate-200 hover:border-blue-400 hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900 dark:hover:border-blue-400',
        ]"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
        @click="triggerUpload"
      >
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".pdf,.txt,.md"
          multiple
          @change="handleFileSelect"
        >

        <div v-if="isUploading" class="flex flex-col items-center gap-2 py-2">
          <Spinner size="default" class="text-blue-500" />
          <span class="text-xs font-medium tracking-tight text-slate-500 dark:text-slate-400">{{ t('fileupload.uploading') }}</span>
        </div>

        <template v-else>
          <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100/50 dark:bg-blue-500/12">
            <CloudUpload class="h-5 w-5 text-blue-600" />
          </div>
          <p class="text-sm font-bold text-slate-700 dark:text-slate-200">{{ t('fileupload.click_or_drag') }}</p>
          <p class="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{{ t('fileupload.supports_formats') }}</p>
        </template>
      </div>

      <div v-if="files.length > 0" class="flex min-h-0 flex-1 flex-col">
        <div class="mb-4">
          <div class="flex items-center justify-between">
            <div class="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {{ t('fileupload.upload_list') }} ({{ files.length }})
            </div>
            <div class="flex items-center gap-3">
              <button
                v-if="selectedIds.length > 0"
                class="text-[11px] font-bold uppercase tracking-widest text-blue-500 transition-colors hover:text-blue-600"
                @click="toggleAll"
              >
                {{ selectedIds.length === files.length ? t('fileupload.deselect_all') : t('fileupload.select_all') }}
              </button>
              <button
                class="text-[11px] font-bold uppercase tracking-widest text-slate-400 transition-colors hover:text-red-500"
                @click="emit('clear')"
              >
                {{ t('fileupload.clear') }}
              </button>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2">
            <div class="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{{ t('fileupload.stat_running') }}</div>
              <div class="mt-1 text-sm font-bold text-blue-600 dark:text-blue-400">{{ processingCount }}</div>
            </div>
            <div class="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{{ t('fileupload.stat_done') }}</div>
              <div class="mt-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">{{ successCount }}</div>
            </div>
            <div class="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
              <div class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{{ t('fileupload.stat_issues') }}</div>
              <div class="mt-1 text-sm font-bold text-rose-600 dark:text-rose-400">{{ errorCount }}</div>
            </div>
          </div>
        </div>

        <div class="space-y-3 pb-4">
          <div
            v-for="file in files"
            :key="file.id"
            class="group relative flex cursor-pointer flex-col rounded-2xl border p-3 transition-all"
            :class="[
              activeId === file.id
                ? 'border-blue-200 bg-blue-50 shadow-md shadow-blue-500/5 ring-1 ring-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10 dark:ring-blue-500/10'
                : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700 dark:hover:bg-slate-900',
            ]"
            @click="emit('select', file.id)"
          >
            <div class="flex items-start gap-3">
              <div
                class="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors"
                :class="selectedIds.includes(file.id) ? 'border-blue-500 bg-blue-500' : 'border-slate-200 bg-white group-hover:border-blue-400 dark:border-slate-700 dark:bg-slate-950'"
                @click.stop="toggleSelect(file.id)"
              >
                <div v-if="selectedIds.includes(file.id)" class="h-2 w-2 rounded-full bg-white" />
              </div>

              <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-rose-500/12">
                <FileText class="h-5 w-5 text-red-500" />
              </div>

              <div class="min-w-0 flex-1 pr-6">
                <p class="truncate text-sm font-bold leading-tight transition-colors" :class="activeId === file.id ? 'text-blue-900 dark:text-blue-200' : 'text-slate-600 dark:text-slate-200'">
                  {{ file.name }}
                </p>
                <div class="mt-1 flex items-center gap-2">
                  <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{{ t('fileupload.pdf_document') }}</span>
                  <span
                    class="flex items-center gap-1 text-[10px] font-bold"
                    :class="statusTone(file)"
                  >
                    <CheckCircle v-if="file.status === 'success'" class="h-2.5 w-2.5" />
                    <span>{{ statusLabel(file) }}</span>
                  </span>
                </div>
                <div
                  v-if="file.progressMessage || file.errorMessage"
                  class="mt-2 rounded-xl border px-2.5 py-2 text-[11px] leading-4"
                  :class="file.status === 'error'
                    ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                    : file.status === 'processing'
                      ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200'
                      : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'"
                >
                  {{ file.errorMessage || file.progressMessage }}
                </div>
              </div>

              <button
                class="absolute right-3 top-3 rounded-full border border-slate-100 bg-white p-1 text-slate-300 opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:text-red-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500"
                @click.stop="emit('remove', file.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>

            <div v-if="activeId === file.id && file.status !== 'processing' && selectedIds.length <= 1" class="mt-3">
              <button
                class="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-700/50 bg-blue-600 py-2 text-xs font-bold text-white transition-all shadow-md hover:bg-blue-700 disabled:opacity-50"
                @click.stop="emit('extract', file.id)"
              >
                <Beaker class="h-3.5 w-3.5" />
                {{ t('fileupload.extract_button') }}
              </button>
            </div>

            <div v-if="file.status === 'processing'" class="mt-3 rounded-2xl border border-blue-200/70 bg-blue-50/70 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
              <div class="mb-2 flex items-center justify-between text-[11px] font-semibold text-blue-700 dark:text-blue-200">
                <span>{{ t('fileupload.extraction_in_progress') }}</span>
                <span>{{ Math.max(1, Math.round(file.progress || 0)) }}%</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-white/80 dark:bg-slate-900/80">
                <div class="h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-300" :style="{ width: `${file.progress}%` }" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-300 opacity-40 dark:text-slate-600">
        <BookOpen class="h-12 w-12" />
        <p class="text-xs font-bold uppercase tracking-widest">{{ t('fileupload.no_files') }}</p>
      </div>

      <div v-if="selectedIds.length > 1" class="mt-auto border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          class="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/30 ring-2 ring-blue-500/10 transition-all hover:bg-blue-700"
          @click="emit('batchExtract', selectedIds)"
        >
          <Beaker class="h-4 w-4" />
          {{ t('fileupload.batch_extract', { count: selectedIds.length }) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import { CloudUpload, FileText, X, BookOpen, CheckCircle, Beaker } from 'lucide-vue-next'

import Spinner from '@/components/ui/Spinner.vue'
import { useI18n } from '@/composables/useI18n'
import type { BatchFile } from '@/lib/api'

const emit = defineEmits<{
  upload: [file: File]
  batchUpload: [files: File[]]
  extract: [fileId: string]
  batchExtract: [fileIds: string[]]
  select: [fileId: string]
  clear: []
  remove: [fileId: string]
}>()

const props = defineProps<{
  files: BatchFile[]
  activeId: string | null
}>()
const { files, activeId } = toRefs(props)

const isDragging = ref(false)
const isUploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const selectedIds = ref<string[]>([])
const { isChinese, t } = useI18n()

const processingCount = computed(() => props.files.filter((file) => file.status === 'processing').length)
const successCount = computed(() => props.files.filter((file) => file.status === 'success').length)
const errorCount = computed(() => props.files.filter((file) => file.status === 'error').length)

watch(() => props.activeId, (newId) => {
  if (newId && selectedIds.value.length === 0) {
    selectedIds.value = [newId]
  }
}, { immediate: true })

function toggleSelect(id: string) {
  const index = selectedIds.value.indexOf(id)
  if (index === -1) {
    selectedIds.value.push(id)
  } else {
    selectedIds.value.splice(index, 1)
  }
}

function toggleAll() {
  if (selectedIds.value.length === props.files.length) {
    selectedIds.value = []
  } else {
    selectedIds.value = props.files.map((file) => file.id)
  }
}

function statusLabel(file: BatchFile): string {
  if (file.status === 'success') {
    return file.records?.length ? t('progress.extracted_records', { count: file.records.length }) : t('status.completed')
  }
  if (file.status === 'processing') {
    return isChinese.value
      ? `${Math.max(1, Math.round(file.progress || 0))}% ${t('status.running')}`
      : `${Math.max(1, Math.round(file.progress || 0))}% ${t('status.running').toLowerCase()}`
  }
  if (file.status === 'error') {
    return t('progress.needs_review')
  }
  if (file.status === 'cancelled') {
    return isChinese.value ? '已停止' : 'Stopped'
  }
  return t('progress.ready')
}

function statusTone(file: BatchFile): string {
  if (file.status === 'success') return 'text-green-500'
  if (file.status === 'processing') return 'text-blue-500'
  if (file.status === 'error') return 'text-rose-500'
  if (file.status === 'cancelled') return 'text-amber-500'
  return 'text-slate-400'
}

defineExpose({
  setUploading(value: boolean) {
    isUploading.value = value
  },
})

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    handleFiles(Array.from(files))
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    handleFiles(Array.from(files))
  }
  target.value = ''
}

function handleFiles(files: File[]) {
  const validTypes = ['application/pdf', 'text/plain', 'text/markdown']
  const validFiles = files.filter((file) => validTypes.includes(file.type) || file.name.endsWith('.md'))
  if (validFiles.length === 0) {
    alert(t('fileupload.alert_invalid_types'))
    return
  }
  isUploading.value = true
  emit('batchUpload', validFiles)
}

function triggerUpload() {
  fileInput.value?.click()
}
</script>
