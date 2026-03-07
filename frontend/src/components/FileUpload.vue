<template>
  <div class="h-full flex flex-col bg-white">
    <!-- Sidebar Header -->
    <div class="px-6 py-4 border-b border-slate-100 flex-shrink-0">
      <div class="flex items-center gap-2">
        <BookOpen class="w-5 h-5 text-blue-600" />
        <h2 class="text-base font-bold text-slate-800">Literature Library</h2>
      </div>
    </div>

    <div class="p-5 flex-1 flex flex-col min-h-0 overflow-y-auto">
      <!-- Upload Area -->
      <div
        class="relative border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer bg-slate-50/50 mb-6"
        :class="[
          isDragging 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-slate-200 hover:border-blue-400 hover:bg-white'
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
          <span class="text-xs text-slate-500 font-medium tracking-tight">Uploading...</span>
        </div>
        
        <template v-else>
          <div class="mx-auto w-10 h-10 rounded-xl bg-blue-100/50 flex items-center justify-center mb-3">
            <CloudUpload class="h-5 w-5 text-blue-600" />
          </div>
          <p class="text-sm font-bold text-slate-700">Click or drag to upload</p>
          <p class="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">Supports PDF, TXT, MD</p>
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
            class="group relative flex flex-col p-3 rounded-2xl border transition-all cursor-pointer"
            :class="[
              activeId === file.id 
                ? 'bg-blue-50 border-blue-200 shadow-md shadow-blue-500/5 ring-1 ring-blue-50' 
                : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50/50'
            ]"
            @click="emit('select', file.id)"
          >
            <div class="flex items-start gap-3">
              <!-- Checkbox -->
              <div 
                class="mt-1 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                :class="selectedIds.includes(file.id) ? 'bg-blue-500 border-blue-500' : 'bg-white border-slate-200 group-hover:border-blue-400'"
                @click.stop="toggleSelect(file.id)"
              >
                <div v-if="selectedIds.includes(file.id)" class="w-2 h-2 bg-white rounded-full" />
              </div>

              <!-- PDF Icon -->
              <div class="w-10 h-10 rounded-xl bg-red-50 flex-shrink-0 flex items-center justify-center">
                <FileText class="w-5 h-5 text-red-500" />
              </div>
              
              <div class="flex-1 min-w-0 pr-6">
                <p class="text-sm font-bold truncate leading-tight transition-colors" :class="activeId === file.id ? 'text-blue-900' : 'text-slate-600'">
                  {{ file.name }}
                </p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-[10px] font-semibold text-slate-400">PDF Document</span>
                  <span v-if="file.status === 'success'" class="flex items-center gap-1 text-[10px] font-bold text-green-500">
                    <CheckCircle class="w-2.5 h-2.5" /> Extracted
                  </span>
                </div>
              </div>

              <!-- Delete Button -->
              <button 
                class="absolute top-3 right-3 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all bg-white rounded-full shadow-sm border border-slate-100"
                @click.stop="emit('remove', file.id)"
              >
                <X class="w-3 h-3" />
              </button>
            </div>

            <!-- Individual Extract Button (Hidden if in batch) -->
            <div v-if="activeId === file.id && file.status !== 'success' && selectedIds.length <= 1" class="mt-3">
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
            <div v-if="file.status === 'processing'" class="mt-3 h-1 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.5)]" :style="{ width: `${file.progress}%` }" />
            </div>
          </div>
        </div>
      </div>
      
      <!-- Empty State -->
      <div v-else class="flex-1 flex flex-col items-center justify-center text-slate-300 gap-3 opacity-40">
        <BookOpen class="w-12 h-12" />
        <p class="text-xs font-bold uppercase tracking-widest">No files uploaded</p>
      </div>

      <!-- Batch Extract Floating Footer -->
      <div v-if="selectedIds.length > 1" class="pt-4 border-t border-slate-100 mt-auto">
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
