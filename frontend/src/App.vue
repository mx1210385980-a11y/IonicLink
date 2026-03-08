<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Beaker, Moon, Sun, Github } from 'lucide-vue-next'
import FileUpload from '@/components/FileUpload.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import Dashboard from '@/components/Dashboard.vue'
import LiteratureList from '@/components/LiteratureList.vue'
import SourceGroundingView from '@/components/SourceGroundingView.vue'
import Button from '@/components/ui/Button.vue'
import { uploadFile, extractData, chat, syncBatchData, getPdfHighlights, type TribologyData, type BatchFile } from '@/lib/api'
import type { HighlightRect } from '@/types/pdf-highlight'

// View routes
const currentView = ref<'dashboard' | 'workspace' | 'literature' | 'grounding'>('workspace')


// Dark mode - default light
const isDark = ref(false)

// Component references
const fileUploadRef = ref<InstanceType<typeof FileUpload>>()
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

// State
const batchFiles = ref<BatchFile[]>([])
const selectedFileId = ref<string | null>(null)
const explorerDoi = ref('')

// 鈹€鈹€鈹€ Source Grounding 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
/** PDF URL for the currently selected file (served by backend) */
const groundingPdfUrl = computed(() => {
  if (!selectedFileId.value) return ''
  return `/api/pdf/${selectedFileId.value}`
})

/** Real highlight coordinates fetched from backend text search */
const groundingHighlightData = ref<HighlightRect[]>([])

/** Fetch highlight coordinates when selectedFileId changes and grounding tab is active */
watch([() => selectedFileId.value, () => currentView.value], async ([fileId, view]) => {
  if (!fileId) {
    explorerDoi.value = ''
    return
  }
  
  // DOI Switching logic: When file selection changes, update the DOI to filter the IntegratedExplorer
  const batchFile = batchFiles.value.find(f => f.id === fileId)
  if (batchFile && batchFile.metadata?.doi) {
    explorerDoi.value = batchFile.metadata.doi
  } else if (batchFile && batchFile.status === 'success') {
    // If it's a success but metadata is missing, might be using temporary DOI
    explorerDoi.value = `temp-${fileId}`
  }

  if (view !== 'grounding') {
    groundingHighlightData.value = []
    return
  }
  try {
    const highlights = await getPdfHighlights(fileId)
    groundingHighlightData.value = highlights
      .filter(h => h.w > 0 && h.h > 0) // Skip unmatched (w=0, h=0)
      .map(h => ({
        id: h.id,
        page: h.page,
        coords: { x: h.x, y: h.y, w: h.w, h: h.h },
      }))
    console.log(`[Grounding] Loaded ${groundingHighlightData.value.length} highlights`)
  } catch (err) {
    console.warn('[Grounding] Failed to fetch highlights:', err)
    groundingHighlightData.value = []
  }
})
const isChatting = ref(false)

// Check if records contain missing values
function hasWarnings(records: TribologyData[]): boolean {
  return records.some(r => !r.cof || r.cof === '-' || r.cof === 'null')
}

// Toggle dark mode
function toggleDarkMode() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}

// Initialize dark mode
if (isDark.value) {
  document.documentElement.classList.add('dark')
}

// Handle clear files
function handleClearFiles() {
  if (confirm('Are you sure you want to clear all files?')) {
    batchFiles.value = []
    selectedFileId.value = null
  }
}

// Handle file upload
async function handleUpload(file: File) {
  try {
    fileUploadRef.value?.setUploading(true)
    const response = await uploadFile(file)
    
    if (response.success) {
      // Create BatchFile object
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
        `File "${response.filename}" uploaded successfully.`
      )
    }
  } catch (error: any) {
    chatPanelRef.value?.addMessage('assistant', 
      `Upload failed: ${error.message || 'Unknown error'}`
    )
  } finally {
     fileUploadRef.value?.setUploading(false)
  }
}

// Handle batch upload
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
    `Batch upload complete. Success: ${successCount}, Fail: ${failCount}.`
  )
}

// Handle batch extract
async function handleExtract(fileId: string, force: boolean = false) {
  try {
    // fileUploadRef.value?.updateFileStatus(fileId, 'extracting') -> Removed (Reactive)
    
    // Update BatchFile status
    const batchFile = batchFiles.value.find(f => f.id === fileId)
    if (batchFile) {
      batchFile.status = 'processing'
      batchFile.progress = 50
    }
    
    chatPanelRef.value?.addMessage('assistant', 
      force ? 'Forcing re-analysis of literature...' : 'Analyzing literature and extracting data...'
    )
    
    // Pass force parameter to API
    const response = await extractData(fileId, force)
    

    if (response.success) {
      // extractData() returns { success, metadata, data, message }
      // metadata and data are at the top level, not nested in response.data
      const metadata: any = response.metadata || {}
      const records = response.data || []
      const rawRecords = Array.isArray(records) ? records : []
      const safeMetadata: any = metadata || {}
      
      console.log('[Extract] API response metadata:', metadata)
      console.log('[Extract] API response records count:', rawRecords.length)

      // Inject unique ID and file association for each record
      const safeRecords = rawRecords.map((r: any, index: number) => ({
        ...r,
        id: r.id || `${fileId}-${index}-${Date.now()}`,  // Ensure unique ID
        fileId: fileId  // Associate with current file
      }))

      // Update BatchFile data
      if (batchFile) {
        batchFile.status = 'success'
        batchFile.progress = 100
        batchFile.records = safeRecords
        batchFile.metadata = safeMetadata
        batchFile.hasWarnings = hasWarnings(safeRecords)
        
        // Automatically save to DB after extraction
        // Guard clause: skip sync if no data extracted
        if (safeRecords.length === 0) {
          console.warn('[Sync] No data extracted, skipping sync')
          chatPanelRef.value?.addMessage('assistant', 
            'Extraction complete, but no valid records found. Not synced.'
          )
        } else {
          try {
            // Use metadata from API directly, use defaults only if completely missing
            console.log('[Sync] Using extracted metadata:', safeMetadata)
            
            // Use defaults only if safeMetadata is empty
            // Use defaults only if safeMetadata is empty
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
              pages: safeMetadata.pages || null
            } : {
              // Only use temporary values if no metadata at all
              doi: `temp-${fileId}`,
              title: 'Untitled',
              authors: '',
              journal: '',
              year: new Date().getFullYear()
            }
            
            console.log('[Sync] Sending to API:', metadataToSync)
            const syncResult = await syncBatchData(metadataToSync, safeRecords)
            
            // IMPORTANT: Update batchFile.id to the canonical literature_id returned by backend
            // This ensures the filter always uses the correct DB ID
            const canonicalLitId = syncResult?.literatureId ?? syncResult?.literature_id
            if (canonicalLitId && batchFile) {
              const canonicalId = String(canonicalLitId)
              if (batchFile.id !== canonicalId) {
                console.log(`[Sync] Updating file_id: ${batchFile.id} -> ${canonicalId}`)
                // Update batchFile id
                batchFile.id = canonicalId
                // Update selectedFileId if this was the selected file
                if (selectedFileId.value === fileId) {
                  selectedFileId.value = canonicalId
                }
              }
            }
            
            // Ensure we are in workspace view for the result to be visible
            currentView.value = 'workspace'
            if (metadataToSync.doi) {
              explorerDoi.value = metadataToSync.doi
            }
          } catch (error) {
            console.error('Initial sync failed:', error)
          }
        }

      }
      
      
      // fileUploadRef.value?.updateFileStatus(fileId, 'completed', safeRecords.length) -> Removed
      chatPanelRef.value?.addMessage('assistant', 
        `${response.message}\n\nExtracted data is now shown in the results panel.`
      )
    } else {
      if (batchFile) {
        batchFile.status = 'error'
        batchFile.errorMessage = response.message
      }
      
      // fileUploadRef.value?.updateFileStatus(fileId, 'error', undefined, response.message) -> Removed
      chatPanelRef.value?.addMessage('assistant', 
        `Extraction complete, but possible issues: ${response.message}`
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
      `Extraction failed: ${error.message || 'Unknown error'}`
    )
  }
}

// Handle batch extract
async function handleBatchExtract(fileIds: string[]) {
  chatPanelRef.value?.addMessage('assistant', 
    `Starting batch extraction of ${fileIds.length} files...`
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
        // extractData() returns { success, metadata, data, message }
        const metadata: any = response.metadata || {}
        const records = response.data || []
        const rawRecords = Array.isArray(records) ? records : []
        const safeMetadata: any = metadata || {}

        // Inject unique ID and file association for each record
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
          
          // Auto sync to DB
          try {
            // Directly use API metadata
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
            const syncResult = await syncBatchData(metadataToSync, safeRecords)

            // IMPORTANT: Update batchFile.id to the canonical literature_id returned by backend
            const canonicalLitId = syncResult?.literatureId ?? syncResult?.literature_id
            if (canonicalLitId && batchFile) {
              const canonicalId = String(canonicalLitId)
              if (batchFile.id !== canonicalId) {
                console.log(`[Sync Batch] Updating file_id: ${batchFile.id} -> ${canonicalId}`)
                batchFile.id = canonicalId
                // Update selectedFileId if this was the selected file
                if (selectedFileId.value === fileId) {
                  selectedFileId.value = canonicalId
                }
              }
            }
            
            // Redirection to Data Explorer (for the last processed file in batch)
            if (metadataToSync.doi) {
              explorerDoi.value = metadataToSync.doi
            }
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
  
  // After batch extraction, ensure we are in workspace view
  currentView.value = 'workspace'

  chatPanelRef.value?.addMessage('assistant', 
    `Batch extraction complete. Success: ${successCount}, Fail: ${failCount}.\n\nTotal records extracted: ${totalRecords}`
  )
}

// Handle chat
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
      `Request failed: ${error.message || 'Please check if backend is running'}`
    )
  } finally {
    isChatting.value = false
  }
}

// Export file data
// handleExportFile, convertRecordsToCsv removed as preview list is gone

function handleLiteratureView() {
  console.log('[App] Switching to literature view')
  currentView.value = 'literature'
}
</script>

<template>
  <div class="min-h-screen bg-background flex flex-col">
    <!-- Header -->
    <header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="flex h-14 items-center px-4">
        <!-- Header -->
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <Beaker class="w-5 h-5 text-white" />
          </div>
            <label class="text-[11px] font-bold text-slate-400 uppercase">IonicLink</label>
        </div>
        
        <!-- Navigation -->
        <nav class="hidden md:flex items-center gap-6 ml-6">
            <button 
                @click="currentView = 'workspace'"
                class="text-sm font-medium transition-colors hover:text-primary"
                :class="currentView === 'workspace' ? 'text-primary' : 'text-muted-foreground'"
            >
                Workspace
            </button>
            <button 
                @click="currentView = 'dashboard'"
                class="text-sm font-medium transition-colors hover:text-primary"
                :class="currentView === 'dashboard' ? 'text-primary' : 'text-muted-foreground'"
            >
                Overview
            </button>
        </nav>

        <!-- Right actions -->
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
    
    <!-- Main content area - Full-width Dashboard layout -->
    <main class="flex-1 overflow-hidden">
      <!-- Dashboard View -->
      <div v-if="currentView === 'dashboard'" class="h-[calc(100vh-56px)]">
        <Dashboard @open-library="currentView = 'literature'" />
      </div>

      <!-- Workspace View (Integrated 3-column) -->
      <div v-if="currentView === 'workspace'" class="flex h-[calc(100vh-56px)]">
        <!-- Uploaded File List -->
        <aside class="w-80 flex-shrink-0 border-r bg-white flex flex-col overflow-hidden">
          <FileUpload
            ref="fileUploadRef"
            :files="batchFiles"
            :active-id="selectedFileId"
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
        </aside>

        <!-- Middle: Extraction Results & Library -->
        <main class="flex-1 overflow-hidden">
          <IntegratedExplorer
            :initial-doi="explorerDoi"
            :selected-file-id="selectedFileId"
            :source-name="batchFiles.find(f => f.id === selectedFileId)?.name"
            :literature-metadata="batchFiles.find(f => f.id === selectedFileId)?.metadata"
            @view-literature="handleLiteratureView"
            @clear-doi="explorerDoi = ''"
          />
        </main>

        <!-- Right: AI Assistant -->
        <aside class="w-80 flex-shrink-0 border-l bg-white flex flex-col overflow-hidden">
          <ChatPanel
            ref="chatPanelRef"
            :loading="isChatting"
            @send="handleChat"
          />
        </aside>
      </div>

      <!-- Literature Management View -->
      <div v-else-if="currentView === 'literature'" class="h-[calc(100vh-88px)]">
        <LiteratureList />
      </div>

      <!-- Source Grounding View -->
      <div v-else-if="currentView === 'grounding'" class="h-[calc(100vh-56px)]">
        <SourceGroundingView
          :pdf-url="groundingPdfUrl"
          :highlight-data="groundingHighlightData"
        />
      </div>

      <!-- Source Grounding View moved out of extraction -->
    </main>
  </div>
</template>


