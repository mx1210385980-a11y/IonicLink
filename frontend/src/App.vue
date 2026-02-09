<script setup lang="ts">
import { ref } from 'vue'
import { Beaker, Moon, Sun, Github } from 'lucide-vue-next'
import FileUpload from '@/components/FileUpload.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import BatchDataPreview from '@/components/BatchDataPreview.vue'
import DataExplorer from '@/components/DataExplorer.vue'
import LiteratureList from '@/components/LiteratureList.vue'
import Button from '@/components/ui/Button.vue'
import { uploadFile, extractData, chat, syncData, syncBatchData, type TribologyData, type BatchFile } from '@/lib/api'

// 视图路由
const currentView = ref<'extraction' | 'explorer' | 'literature'>('extraction')


// 深色模式 - 默认浅色
const isDark = ref(false)

// 组件引用
const fileUploadRef = ref<InstanceType<typeof FileUpload>>()
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

// 状态
const batchFiles = ref<BatchFile[]>([])
const selectedFileId = ref<string | null>(null)
const isExtracting = ref(false)
const isChatting = ref(false)

// 检查记录是否包含缺失值
function hasWarnings(records: TribologyData[]): boolean {
  return records.some(r => !r.cof || r.cof === '-' || r.cof === 'null')
}

// 切换深色模式
function toggleDarkMode() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}

// 初始化深色模式
if (isDark.value) {
  document.documentElement.classList.add('dark')
}

// 处理清空文件
function handleClearFiles() {
  if (confirm('确定要清空所有文件吗？')) {
    batchFiles.value = []
    selectedFileId.value = null
  }
}

// 处理文件上传
async function handleUpload(file: File) {
  try {
    fileUploadRef.value?.setUploading(true)
    const response = await uploadFile(file)
    
    if (response.success) {
      // 创建 BatchFile 对象
      batchFiles.value.push({
        id: response.file_id,
        name: response.filename,
        status: 'uploaded',
        progress: 0,
        records: [],
        hasWarnings: false
      })
      
      // Auto-select
      if (!selectedFileId.value) {
        selectedFileId.value = response.file_id
      }
      
      chatPanelRef.value?.addMessage('assistant', 
        `✅ 文件 "${response.filename}" 上传成功！`
      )
    }
  } catch (error: any) {
    chatPanelRef.value?.addMessage('assistant', 
      `❌ 上传失败：${error.message || '未知错误'}`
    )
  } finally {
     fileUploadRef.value?.setUploading(false)
  }
}

// 处理批量上传
async function handleBatchUpload(files: File[]) {
  fileUploadRef.value?.setUploading(true)
  
  let successCount = 0
  let failCount = 0
  
  for (const file of files) {
    try {
      const response = await uploadFile(file)
      
      if (response.success) {
        batchFiles.value.push({
          id: response.file_id,
          name: response.filename,
          status: 'uploaded',
          progress: 0,
          records: [],
          hasWarnings: false
        })
        
        successCount++
      } else {
        failCount++
      }
    } catch (error: any) {
      failCount++
    }
  }
  
  fileUploadRef.value?.setUploading(false)
  
  chatPanelRef.value?.addMessage('assistant', 
    `📁 批量上传完成！成功 ${successCount} 个，失败 ${failCount} 个。`
  )
}

// 处理批量上传
async function handleExtract(fileId: string, force: boolean = false) {
  try {
    // fileUploadRef.value?.updateFileStatus(fileId, 'extracting') -> Removed (Reactive)
    
    // 更新 BatchFile 状态
    const batchFile = batchFiles.value.find(f => f.id === fileId)
    if (batchFile) {
      batchFile.status = 'processing'
      batchFile.progress = 50
    }
    
    chatPanelRef.value?.addMessage('assistant', 
      force ? '🔄 正在强制重新分析文献...' : '🔍 正在分析文献并提取数据...'
    )
    
    // Pass force parameter to API
    const response = await extractData(fileId, force)
    

    if (response.success) {
      // extractData() 返回的是 { success, metadata, data, message }
      // metadata 和 data 在顶层，不是嵌套在 response.data 里
      const metadata: any = response.metadata || {}
      const records = response.data || []
      const rawRecords = Array.isArray(records) ? records : []
      const safeMetadata: any = metadata || {}
      
      console.log('[Extract] API response metadata:', metadata)
      console.log('[Extract] API response records count:', rawRecords.length)

      // 为每条记录注入唯一 ID 和文件关联
      const safeRecords = rawRecords.map((r: any, index: number) => ({
        ...r,
        id: r.id || `${fileId}-${index}-${Date.now()}`,  // 确保有唯一 ID
        fileId: fileId  // 关联到当前文件
      }))

      // 更新 BatchFile 数据
      if (batchFile) {
        batchFile.status = 'success'
        batchFile.progress = 100
        batchFile.records = safeRecords
        batchFile.metadata = safeMetadata
        batchFile.hasWarnings = hasWarnings(safeRecords)
        
        // 提取完成后自动保存到数据库
        // Guard clause: 如果没有提取到数据，跳过同步
        if (safeRecords.length === 0) {
          console.warn('[Sync] 未提取到数据，跳过自动同步')
          chatPanelRef.value?.addMessage('assistant', 
            '⚠️ 提取完成，但未找到有效数据记录，未同步到数据库。'
          )
        } else {
          try {
            // 直接使用API返回的元数据，只在完全缺失时使用默认值
            console.log('[Sync] Using extracted metadata:', safeMetadata)
            
            // 只在 safeMetadata 完全为空时才用默认值
            // 只在 safeMetadata 完全为空时才用默认值
            const hasValidMetadata = safeMetadata.title || safeMetadata.doi
            const metadataToSync = hasValidMetadata ? {
              doi: safeMetadata.doi || '',
              title: safeMetadata.title || '',
              authors: safeMetadata.authors || '',
              journal: safeMetadata.journal || '',
              year: safeMetadata.year || new Date().getFullYear(),
              issn: safeMetadata.issn || null,
              volume: safeMetadata.volume || null,
              issue: safeMetadata.issue || null,
              pages: safeMetadata.pages || null,
              file_hash: safeMetadata.file_hash || safeMetadata.fileHash || null  // Include file hash for caching
            } : {
              // 仅当完全没有元数据时才使用临时值
              doi: `temp-${fileId}`,
              title: 'Untitled',
              authors: '',
              journal: '',
              year: new Date().getFullYear(),
              file_hash: safeMetadata.file_hash || safeMetadata.fileHash || null  // Include file hash for caching
            }
            
            console.log('[Sync] Sending to API:', metadataToSync)
            await syncBatchData(metadataToSync, safeRecords)
          } catch (error) {
            console.error('Initial sync failed:', error)
          }
        }

      }
      
      
      // fileUploadRef.value?.updateFileStatus(fileId, 'completed', safeRecords.length) -> Removed
      chatPanelRef.value?.addMessage('assistant', 
        `✅ ${response.message}\n\n提取的数据已显示在右侧预览面板中。`
      )
    } else {
      if (batchFile) {
        batchFile.status = 'error'
        batchFile.errorMessage = response.message
      }
      
      // fileUploadRef.value?.updateFileStatus(fileId, 'error', undefined, response.message) -> Removed
      chatPanelRef.value?.addMessage('assistant', 
        `⚠️ 提取完成，但可能存在问题：${response.message}`
      )
    }
  } catch (error: any) {
    const batchFile = batchFiles.value.find(f => f.id === fileId)
    if (batchFile) {
      batchFile.status = 'error'
      batchFile.errorMessage = error.message
    }
    
    // fileUploadRef.value?.updateFileStatus(fileId, 'error', undefined, error.message) -> Removed
    chatPanelRef.value?.addMessage('assistant', 
      `❌ 数据提取失败：${error.message || '未知错误'}`
    )
  }
}

// 处理批量提取
async function handleBatchExtract(fileIds: string[]) {
  chatPanelRef.value?.addMessage('assistant', 
    `🔄 开始批量提取 ${fileIds.length} 个文件...`
  )
  
  let successCount = 0
  let failCount = 0
  let totalRecords = 0
  

  for (const fileId of fileIds) {
    try {
      // fileUploadRef.value?.updateFileStatus(fileId, 'extracting') -> Removed
      
      const batchFile = batchFiles.value.find(f => f.id === fileId)
      if (batchFile) {
        batchFile.status = 'processing'
        batchFile.progress = 50
      }
      
      const response = await extractData(fileId)
      
      if (response.success) {
        // extractData() 返回的是 { success, metadata, data, message }
        const metadata: any = response.metadata || {}
        const records = response.data || []
        const rawRecords = Array.isArray(records) ? records : []
        const safeMetadata: any = metadata || {}

        // 为每条记录注入唯一 ID 和文件关联
        const safeRecords = rawRecords.map((r: any, index: number) => ({
          ...r,
          id: r.id || `${fileId}-${index}-${Date.now()}`,
          fileId: fileId
        }))

        if (batchFile) {
          batchFile.status = 'success'
          batchFile.progress = 100
          batchFile.records = safeRecords
          batchFile.metadata = safeMetadata
          batchFile.hasWarnings = hasWarnings(safeRecords)
          
          // 自动同步到数据库
          try {
            // 直接使用API返回的元数据
            const hasValidMetadata = safeMetadata.title || safeMetadata.doi
            const metadataToSync = hasValidMetadata ? {
              doi: safeMetadata.doi || '',
              title: safeMetadata.title || '',
              authors: safeMetadata.authors || '',
              journal: safeMetadata.journal || '',
              year: safeMetadata.year || new Date().getFullYear(),
              issn: safeMetadata.issn || null,
              volume: safeMetadata.volume || null,
              issue: safeMetadata.issue || null,
              pages: safeMetadata.pages || null,
              file_hash: safeMetadata.file_hash || safeMetadata.fileHash || null  // Include file hash for caching
            } : {
              doi: `temp-${fileId}`,
              title: 'Untitled',
              authors: '',
              journal: '',
              year: new Date().getFullYear(),
              file_hash: safeMetadata.file_hash || safeMetadata.fileHash || null  // Include file hash for caching
            }
            await syncBatchData(metadataToSync, safeRecords)
          } catch (e) {}

        }
        
        totalRecords += safeRecords.length
        // fileUploadRef.value?.updateFileStatus(fileId, 'completed', safeRecords.length) -> Removed
        successCount++
      } else {
        if (batchFile) {
          batchFile.status = 'error'
          batchFile.errorMessage = response.message
        }
        
        // fileUploadRef.value?.updateFileStatus(fileId, 'error', undefined, response.message) -> Removed
        failCount++
      }
    } catch (error: any) {
      const batchFile = batchFiles.value.find(f => f.id === fileId)
      if (batchFile) {
        batchFile.status = 'error'
        batchFile.errorMessage = error.message
      }
      
      // fileUploadRef.value?.updateFileStatus(fileId, 'error', undefined, error.message) -> Removed
      failCount++
    }
  }
  chatPanelRef.value?.addMessage('assistant', 
    `✅ 批量提取完成！成功 ${successCount} 个，失败 ${failCount} 个。\n\n共提取 ${totalRecords} 条数据。`
  )
}

// 处理聊天
async function handleChat(message: string) {
  chatPanelRef.value?.addMessage('user', message)
  
  try {
    isChatting.value = true
    const response = await chat(message)
    
    if (response.success) {
      chatPanelRef.value?.addMessage('assistant', response.response)
    }
  } catch (error: any) {
    chatPanelRef.value?.addMessage('assistant', 
      `❌ 请求失败：${error.message || '请检查后端服务是否运行'}`
    )
  } finally {
    isChatting.value = false
  }
}

// 导出文件数据
function handleExportFile(fileId: string) {
  const file = batchFiles.value.find(f => f.id === fileId)
  if (!file) return
  
  const jsonData = JSON.stringify(file.records, null, 2)
  const blob = new Blob([jsonData], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${file.name.replace('.pdf', '')}_data_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 重试提取 (Force Re-extract)
function handleRetryFile(fileId: string) {
  handleExtract(fileId, true)
}

// 处理记录更新
async function handleUpdateRecord(fileId: string, recordId: string, record: TribologyData) {
  const file = batchFiles.value.find(f => f.id === fileId)
  if (!file) return
  
  const recordIndex = file.records.findIndex(r => r.id === recordId)
  if (recordIndex !== -1) {
    // Update the record in place
    file.records[recordIndex] = record
    
    // Update hasWarnings
    file.hasWarnings = hasWarnings(file.records)

    // 同步到后端数据库
    try {
      await syncData(fileId, file.records)
      console.log(`Synced records for file ${fileId}`)
    } catch (error) {
      console.error('Failed to sync data:', error)
    }
  }
}

// 处理文件更新 (比如全部确认)
async function handleUpdateFile(fileId: string) {
  const file = batchFiles.value.find(f => f.id === fileId)
  if (file) {
    // Recalculate hasWarnings
    file.hasWarnings = hasWarnings(file.records)

    // 同步到后端数据库
    try {
      await syncData(fileId, file.records)
      console.log(`Synced all records for file ${fileId}`)
    } catch (error) {
      console.error('Failed to sync data:', error)
    }
  }
}

// 处理手动同步保存
async function handleSaveSync(fileId: string) {
  const file = batchFiles.value.find(f => f.id === fileId)
  if (!file || !file.metadata) return

  try {
    chatPanelRef.value?.addMessage('assistant', '💾 正在同步数据到数据库...')
    await syncBatchData(file.metadata, file.records)
    chatPanelRef.value?.addMessage('assistant', '✅ 数据同步成功！')
  } catch (error: any) {
    console.error('Manual sync failed:', error)
    chatPanelRef.value?.addMessage('assistant', `❌ 同步失败：${error.message || '未知错误'}`)
  }
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- 顶部导航 -->
    <header class="sticky top-0 z-50 w-full border-b glass">
      <div class="container flex h-14 items-center px-4 mx-auto max-w-7xl">
        <!-- Logo -->
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <Beaker class="w-5 h-5 text-white" />
          </div>
          <span class="font-bold text-lg gradient-text">IonicLink</span>
        </div>
        
        <!-- 描述 -->
        <span class="hidden md:block ml-4 text-sm text-muted-foreground">
          离子液体润滑文献数据提取助手
        </span>
        
        <!-- 中间导航 -->
        <nav class="hidden md:flex items-center gap-6 mx-6">
            <button 
                @click="currentView = 'extraction'"
                class="text-sm font-medium transition-colors hover:text-primary"
                :class="currentView === 'extraction' ? 'text-primary' : 'text-muted-foreground'"
            >
                Extraction
            </button>
            <button 
                @click="currentView = 'explorer'"
                class="text-sm font-medium transition-colors hover:text-primary"
                :class="currentView === 'explorer' ? 'text-primary' : 'text-muted-foreground'"
            >
                Data Explorer
            </button>
            <button 
                @click="currentView = 'literature'"
                class="text-sm font-medium transition-colors hover:text-primary"
                :class="currentView === 'literature' ? 'text-primary' : 'text-muted-foreground'"
            >
                Literature
            </button>
        </nav>

        <!-- 右侧操作 -->
        <div class="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            @click="toggleDarkMode"
          >
            <Sun v-if="isDark" class="h-5 w-5" />
            <Moon v-else class="h-5 w-5" />
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            as="a"
            href="https://github.com"
            target="_blank"
          >
            <Github class="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
    
    <!-- 主内容区 -->
    <main class="container mx-auto max-w-7xl p-4">
      <!-- Data Explorer View -->
      <div v-if="currentView === 'explorer'" class="h-[calc(100vh-88px)]">
        <DataExplorer />
      </div>

      <!-- Literature Management View -->
      <div v-else-if="currentView === 'literature'" class="h-[calc(100vh-88px)]">
        <LiteratureList />
      </div>

      <!-- Extraction View -->
      <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-88px)]">
        <!-- 左侧：Sidebar (Unified) -->
        <div class="lg:col-span-4 flex flex-col gap-4 min-h-0">
          <!-- 1. 文件操作区 (Upload + File List) -->
          <div class="flex-1 min-h-0 flex flex-col">
            <FileUpload
              ref="fileUploadRef"
              :files="batchFiles"
              :selected-id="selectedFileId"
              @select="(id) => selectedFileId = id"
              @remove="(id) => {
                 const idx = batchFiles.findIndex(f => f.id === id)
                 if (idx !== -1) batchFiles.splice(idx, 1)
                 if (selectedFileId === id) selectedFileId = null
              }"
              @clear="handleClearFiles"
              @upload="handleUpload"
              @batch-upload="handleBatchUpload"
              @extract="handleExtract"
              @batch-extract="handleBatchExtract"
            />
          </div>
          
          <!-- 2. 聊天面板 (Fixed Height) -->
          <div class="h-1/3 min-h-[200px] shrink-0">
            <ChatPanel
              ref="chatPanelRef"
              :loading="isChatting"
              @send="handleChat"
            />
          </div>
        </div>
        
        <!-- 右侧：数据预览 -->
        <div class="lg:col-span-8 min-h-0">
          <BatchDataPreview
            :files="batchFiles"
            :selected-id="selectedFileId"
            :loading="isExtracting"
            @export="handleExportFile"
            @retry="handleRetryFile"
            @update:record="handleUpdateRecord"
            @update:file="handleUpdateFile"
            @save="handleSaveSync"
          />
        </div>
      </div>
    </main>
  </div>
</template>
