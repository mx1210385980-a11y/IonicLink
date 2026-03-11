<template>
  <div class="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <!-- Sidebar Header -->
    <div class="shrink-0 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
      <div class="flex items-center gap-2">
        <BookOpen class="w-5 h-5 text-blue-600" />
        <h2 class="text-base font-bold text-slate-800 dark:text-slate-100">Literature Library</h2>
      </div>
    </div>

    <div class="flex flex-1 flex-col overflow-y-auto p-5 min-h-0">
      <!-- Upload Area -->
      <div
        class="relative mb-6 cursor-pointer rounded-2xl border-2 border-dashed bg-slate-50/50 p-6 text-center transition-all dark:bg-slate-900/60"
        :class="[
          isDragging 
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' 
            : 'border-slate-200 hover:border-blue-400 hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900 dark:hover:border-blue-400'
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
        />
        
        <div v-if="isUploading" class="flex flex-col items-center gap-2 py-2">
          <Spinner size="default" class="text-blue-500" />
          <span class="text-xs font-medium tracking-tight text-slate-500 dark:text-slate-400">Uploading...</span>
        </div>
        
        <template v-else>
          <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100/50 dark:bg-blue-500/12">
            <CloudUpload class="h-5 w-5 text-blue-600" />
          </div>
          <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Click or drag to upload</p>
          <p class="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Supports PDF, TXT, MD</p>
        </template>
      </div>
      
      <!-- Uploaded File List -->
      <div v-if="files.length > 0" class="flex-1 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4">
          <div class="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            Upload List ({{ files.length }})
          </div>
          <div class="flex items-center gap-3">
            <button 
              v-if="selectedIds.length > 0"
              @click="toggleAll"
              class="text-[11px] font-bold text-blue-500 hover:text-blue-600 uppercase tracking-widest transition-colors"
            >
              {{ selectedIds.length === files.length ? 'Deselect All' : 'Select All' }}
            </button>
            <button 
              @click="emit('clear')"
              class="text-[11px] font-bold text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Clear
            </button>
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
                : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700 dark:hover:bg-slate-900'
            ]"
            @click="emit('select', file.id)"
          >
            <div class="flex items-start gap-3">
              <!-- Checkbox -->
              <div 
                class="mt-1 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                :class="selectedIds.includes(file.id) ? 'bg-blue-500 border-blue-500' : 'bg-white border-slate-200 group-hover:border-blue-400 dark:bg-slate-950 dark:border-slate-700'"
                @click.stop="toggleSelect(file.id)"
              >
                <div v-if="selectedIds.includes(file.id)" class="w-2 h-2 bg-white rounded-full" />
              </div>

              <!-- PDF Icon -->
              <div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-rose-500/12">
                <FileText class="w-5 h-5 text-red-500" />
              </div>
              
              <div class="flex-1 min-w-0 pr-6">
                <p class="truncate text-sm font-bold leading-tight transition-colors" :class="activeId === file.id ? 'text-blue-900 dark:text-blue-200' : 'text-slate-600 dark:text-slate-200'">
                  {{ file.name }}
                </p>
                <div class="mt-1 flex items-center gap-2">
                  <span class="text-[10px] font-semibold text-slate-400 dark:text-slate-500">PDF Document</span>
                  <span
                    class="flex items-center gap-1 text-[10px] font-bold"
                    :class="statusTone(file)"
                  >
                    <CheckCircle v-if="file.status === 'success'" class="w-2.5 h-2.5" />
                    <span>{{ statusLabel(file) }}</span>
                  </span>
                </div>
                <p
                  v-if="file.progressMessage || file.errorMessage"
                  class="mt-1 truncate text-[11px]"
                  :class="file.status === 'error' ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'"
                >
                  {{ file.errorMessage || file.progressMessage }}
                </p>
              </div>

              <!-- Delete Button -->
              <button 
                class="absolute top-3 right-3 rounded-full border border-slate-100 bg-white p-1 text-slate-300 opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:text-red-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500"
                @click.stop="emit('remove', file.id)"
              >
                <X class="w-3 h-3" />
              </button>
            </div>

            <!-- Individual Extract Button (Hidden if in batch) -->
            <div v-if="activeId === file.id && file.status !== 'processing' && selectedIds.length <= 1" class="mt-3">
              <button 
                @click.stop="emit('extract', file.id)"
                :disabled="file.status === 'processing'"
                class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-blue-700/50 shadow-md disabled:opacity-50"
              >
                <Beaker v-if="file.status !== 'processing'" class="w-3.5 h-3.5" />
                <Spinner v-else size="sm" class="text-white" />
                Extract
              </button>
            </div>

            <!-- Progress Bar -->
            <div v-if="file.status === 'processing'" class="mt-3 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div class="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.5)]" :style="{ width: `${file.progress}%` }" />
            </div>
          </div>
        </div>
      </div>
      
      <!-- Empty State -->
      <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-300 opacity-40 dark:text-slate-600">
        <BookOpen class="w-12 h-12" />
        <p class="text-xs font-bold uppercase tracking-widest">No files uploaded</p>
      </div>

      <!-- Batch Extract Floating Footer -->
      <div v-if="selectedIds.length > 1" class="mt-auto border-t border-slate-100 pt-4 dark:border-slate-800">
        <button 
          @click="emit('batchExtract', selectedIds)"
          class="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500/10"
        >
          <Beaker class="w-4 h-4" />
          Batch Extract ({{ selectedIds.length }} files)
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { CloudUpload, FileText, X, BookOpen, CheckCircle, Beaker } from 'lucide-vue-next'
import Spinner from '@/components/ui/Spinner.vue'
import type { BatchFile } from '@/lib/api'

const emit = defineEmits<{
  'upload': [file: File]
  'batchUpload': [files: File[]]
  'extract': [fileId: string]
  'batchExtract': [fileIds: string[]]
  'select': [fileId: string]
  'clear': []
  'remove': [fileId: string]
}>()

const props = defineProps<{
  files: any[]
  activeId: string | null
}>()

const isDragging = ref(false)
const isUploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const selectedIds = ref<string[]>([])

// Auto-select the active file if no selection exists
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
    selectedIds.value = props.files.map(f => f.id)
  }
}

function statusLabel(file: BatchFile): string {
  if (file.status === 'success') {
    return file.records?.length ? `Extracted ${file.records.length}` : 'Completed'
  }
  if (file.status === 'processing') {
    return `${Math.max(1, Math.round(file.progress || 0))}% running`
  }
  if (file.status === 'error') {
    return 'Needs review'
  }
  return 'Ready'
}

function statusTone(file: BatchFile): string {
  if (file.status === 'success') return 'text-green-500'
  if (file.status === 'processing') return 'text-blue-500'
  if (file.status === 'error') return 'text-rose-500'
  return 'text-slate-400'
}

defineExpose({
  setUploading(value: boolean) {
    isUploading.value = value
  }
})

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    handleFiles(Array.from(files))
  }
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    handleFiles(Array.from(files))
  }
  target.value = ''
}

function handleFiles(files: File[]): void {
  const validTypes = ['application/pdf', 'text/plain', 'text/markdown']
  const validFiles = files.filter(file => validTypes.includes(file.type) || file.name.endsWith('.md'))
  if (validFiles.length === 0) {
    alert('Please upload PDF, TXT or MD files')
    return
  }
  isUploading.value = true
  emit('batchUpload', validFiles)
}

function triggerUpload() { fileInput.value?.click() }
</script>
