<script setup lang="ts">
import { ref } from 'vue'
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Button from '@/components/ui/Button.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Badge from '@/components/ui/Badge.vue'

type FileStatus = 'uploading' | 'uploaded' | 'extracting' | 'completed' | 'error'

interface UploadedFile {
  id: string
  name: string
  preview: string
  status: FileStatus
  dataCount?: number
  error?: string
}

const emit = defineEmits<{
  'upload': [file: File]
  'batchUpload': [files: File[]]
  'extract': [fileId: string]
  'batchExtract': [fileIds: string[]]
}>()

const isDragging = ref(false)
const isUploading = ref(false)
const uploadedFiles = ref<UploadedFile[]>([])
const fileInput = ref<HTMLInputElement>()

defineExpose({
  addUploadedFile(file: UploadedFile) {
    uploadedFiles.value.push(file)
    isUploading.value = false
  },
  setUploading(value: boolean) {
    isUploading.value = value
  },
  updateFileStatus(fileId: string, status: FileStatus, dataCount?: number, error?: string) {
    const file = uploadedFiles.value.find(f => f.id === fileId)
    if (file) {
      file.status = status
      if (dataCount !== undefined) file.dataCount = dataCount
      if (error) file.error = error
    }
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
  // Reset input
  target.value = ''
}

function handleFiles(files: File[]) {
  const validTypes = ['application/pdf', 'text/plain', 'text/markdown']
  const validFiles = files.filter(file => {
    return validTypes.includes(file.type) || file.name.endsWith('.md')
  })
  
  if (validFiles.length === 0) {
    alert('请上传PDF、TXT或MD格式的文件')
    return
  }
  
  if (validFiles.length < files.length) {
    alert(`已过滤 ${files.length - validFiles.length} 个不支持的文件`)
  }
  
  isUploading.value = true
  emit('batchUpload', validFiles)
}

function removeFile(index: number) {
  uploadedFiles.value.splice(index, 1)
}

function triggerUpload() {
  fileInput.value?.click()
}

function extractData(fileId: string) {
  emit('extract', fileId)
}

function extractAllFiles() {
  const uploadedFileIds = uploadedFiles.value
    .filter(f => f.status === 'uploaded')
    .map(f => f.id)
  
  if (uploadedFileIds.length === 0) {
    alert('没有可提取的文件')
    return
  }
  
  emit('batchExtract', uploadedFileIds)
}

function clearAllFiles() {
  if (uploadedFiles.value.length === 0) return
  
  if (confirm(`确定要清空所有 ${uploadedFiles.value.length} 个文件吗？`)) {
    uploadedFiles.value = []
  }
}

function getStatusColor(status: FileStatus): string {
  switch (status) {
    case 'uploading': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
    case 'uploaded': return 'bg-green-500/10 text-green-600 border-green-500/20'
    case 'extracting': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    case 'completed': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    case 'error': return 'bg-red-500/10 text-red-600 border-red-500/20'
  }
}

function getStatusText(status: FileStatus): string {
  switch (status) {
    case 'uploading': return '上传中'
    case 'uploaded': return '已上传'
    case 'extracting': return '提取中'
    case 'completed': return '已完成'
    case 'error': return '失败'
  }
}
</script>

<template>
  <Card class="h-full">
    <CardContent class="p-4 h-full flex flex-col">
      <!-- 上传区域 -->
      <div
        class="relative border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer"
        :class="[
          isDragging 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
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
        
        <div v-if="isUploading" class="flex flex-col items-center gap-2">
          <Spinner size="lg" class="text-primary" />
          <span class="text-sm text-muted-foreground">上传中...</span>
        </div>
        
        <template v-else>
          <Upload class="mx-auto h-10 w-10 text-muted-foreground" />
          <p class="mt-2 text-sm font-medium">
            拖放文献文件到这里
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            支持 PDF、TXT、MD 格式 · 支持多文件
          </p>
        </template>
      </div>
      
      <!-- 已上传文件列表 -->
      <div v-if="uploadedFiles.length > 0" class="mt-4 flex-1 overflow-auto space-y-2">
        <!-- 批量操作按钮 -->
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-medium text-muted-foreground">
            已上传文件 ({{ uploadedFiles.length }})
          </div>
          <div class="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              @click="extractAllFiles"
              :disabled="!uploadedFiles.some(f => f.status === 'uploaded')"
            >
              全部提取
            </Button>
            <Button
              size="sm"
              variant="ghost"
              @click="clearAllFiles"
            >
              清空
            </Button>
          </div>
        </div>
        
        <div
          v-for="(file, index) in uploadedFiles"
          :key="file.id"
          class="flex items-center gap-3 p-3 rounded-lg bg-muted/50 group"
        >
          <!-- 状态图标 -->
          <div class="flex-shrink-0">
            <Loader2 v-if="file.status === 'uploading' || file.status === 'extracting'" class="h-5 w-5 text-blue-500 animate-spin" />
            <CheckCircle2 v-else-if="file.status === 'completed'" class="h-5 w-5 text-emerald-500" />
            <AlertCircle v-else-if="file.status === 'error'" class="h-5 w-5 text-red-500" />
            <FileText v-else class="h-5 w-5 text-primary" />
          </div>
          
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ file.name }}</p>
            <div class="flex items-center gap-2 mt-0.5">
              <Badge :class="getStatusColor(file.status)" class="text-xs">
                {{ getStatusText(file.status) }}
              </Badge>
              <span v-if="file.dataCount !== undefined" class="text-xs text-muted-foreground">
                · {{ file.dataCount }} 条数据
              </span>
              <span v-if="file.error" class="text-xs text-red-500 truncate">
                · {{ file.error }}
              </span>
            </div>
          </div>
          
          <div class="flex gap-1">
            <Button
              v-if="file.status === 'uploaded'"
              size="sm"
              variant="ghost"
              @click.stop="extractData(file.id)"
            >
              提取
            </Button>
            <Button
              size="icon"
              variant="ghost"
              class="h-8 w-8 opacity-0 group-hover:opacity-100"
              @click.stop="removeFile(index)"
              :disabled="file.status === 'uploading' || file.status === 'extracting'"
            >
              <X class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else class="flex-1 flex items-center justify-center">
        <p class="text-sm text-muted-foreground">
          暂无上传文件
        </p>
      </div>
    </CardContent>
  </Card>
</template>
