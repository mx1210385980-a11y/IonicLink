<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { listLiterature, type Literature, type TribologyRecord } from '@/lib/api'
import { getLiteratureDetails, type LiteratureWithRecords } from '@/lib/api'
import { RefreshCw, Loader2, AlertCircle, CheckCircle2, FileText, ExternalLink } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal.vue'

// --- Column Definitions ---
// Each entry: { key: keyof TribologyRecord, label: string, format?: (v) => string }
interface ColumnDef {
  key: keyof TribologyRecord
  label: string
  format?: (val: any, rec: TribologyRecord) => string
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'materialName',          label: 'Material' },
  { key: 'lubricant',             label: 'Lubricant' },
  {
    key: 'cofValue',
    label: 'COF',
    format: (_, rec: TribologyRecord) => {
      if (rec.cofValue != null) return `${rec.cofOperator ?? ''}${rec.cofValue}`
      return rec.cofRaw ?? '-'
    }
  },
  { key: 'loadValue',    label: 'Load' },
  { key: 'speedValue',   label: 'Speed' },
  { key: 'temperature',  label: 'Temp' },
  { key: 'potential',         label: 'Potential' },
  { key: 'waterContent',      label: 'Water Content' },
  { key: 'surfaceRoughness',  label: 'Surface Roughness' },
  { key: 'residualFilmThicknessD', label: 'Film Thickness D' },
  { key: 'layerSpacingDelta',      label: 'Layer Spacing δ' },
  { key: 'filmThickness',          label: 'Film Thickness' },
  { key: 'molRatio',    label: 'Mol Ratio' },
  { key: 'cation',      label: 'Cation' },
  { key: 'anion',       label: 'Anion' },
  { key: 'cationSmiles', label: 'Cation SMILES' },
  { key: 'anionSmiles',  label: 'Anion SMILES' },
  { key: 'ilSmiles',     label: 'IL SMILES' },
  { key: 'ilInchikey',   label: 'InChIKey' },
  { key: 'alkylChainLength', label: 'Alkyl Chain' },
  { key: 'confidence',   label: 'Confidence', format: (v, _) => v != null ? `${(v * 100).toFixed(0)}%` : '-' },
]

// --- State ---
const loading = ref(false)
const literature = ref<Literature[]>([])
const notifications = ref<{ id: number; type: 'success' | 'error'; message: string }[]>([])
const selectedLiterature = ref<LiteratureWithRecords | null>(null)
const isModalOpen = ref(false)

// --- Computed: only columns that have at least one non-empty value across all records ---
const visibleColumns = computed<ColumnDef[]>(() => {
  const records = selectedLiterature.value?.tribologyData ?? []
  if (!records.length) return ALL_COLUMNS.slice(0, 6) // default fallback

  return ALL_COLUMNS.filter(col => {
    // COF column: show if any record has cofValue OR cofRaw
    if (col.key === 'cofValue') {
      return records.some(r => r.cofValue != null || r.cofRaw)
    }
    return records.some(r => {
      const val = r[col.key]
      return val != null && val !== '' && val !== 0
    })
  })
})

// --- Cell value helper ---
function cellValue(col: ColumnDef, rec: TribologyRecord): string {
  if (col.format) {
    return col.format(rec[col.key], rec)
  }
  const v = rec[col.key]
  if (v == null || v === '') return '-'
  return String(v)
}

// --- Methods ---
const loadLiterature = async () => {
  loading.value = true
  try {
    const data = await listLiterature(0, 100)
    literature.value = data
  } catch (error: any) {
    showNotification('error', `Failed to load literature: ${error.message}`)
  } finally {
    loading.value = false
  }
}

const showNotification = (type: 'success' | 'error', message: string) => {
  const id = Date.now()
  notifications.value.push({ id, type, message })
  setTimeout(() => {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }, 5000)
}

const removeNotification = (id: number) => {
  notifications.value = notifications.value.filter(n => n.id !== id)
}

const openDetails = async (lit: Literature) => {
  isModalOpen.value = true
  selectedLiterature.value = null
  try {
    const details = await getLiteratureDetails(lit.id)
    selectedLiterature.value = details
  } catch (error: any) {
    showNotification('error', `Failed to load details: ${error.message}`)
    isModalOpen.value = false
  }
}

const closeModal = () => {
  isModalOpen.value = false
  selectedLiterature.value = null
}

// --- Lifecycle ---
onMounted(() => {
  loadLiterature()
})
</script>

<template>
  <div class="flex flex-col h-full p-6 gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Literature Database</h1>
        <p class="text-sm text-muted-foreground">
          Manage and reprocess existing literature records
        </p>
      </div>
      <Button @click="loadLiterature" :disabled="loading">
        <RefreshCw :class="{ 'animate-spin': loading }" class="w-4 h-4 mr-2" />
        Refresh
      </Button>
    </div>

    <!-- Notifications -->
    <div class="fixed top-20 right-4 z-50 space-y-2">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        class="flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg border max-w-md"
        :class="notification.type === 'success'
          ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200'
          : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200'"
      >
        <CheckCircle2 v-if="notification.type === 'success'" class="w-5 h-5" />
        <AlertCircle v-else class="w-5 h-5" />
        <span class="flex-1 text-sm">{{ notification.message }}</span>
        <button
          @click="removeNotification(notification.id)"
          class="text-current opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && literature.length === 0" class="flex items-center justify-center h-64">
      <Loader2 class="w-8 h-8 animate-spin text-primary" />
    </div>

    <!-- Literature List -->
    <div v-else-if="literature.length > 0" class="flex-1 overflow-auto">
      <div class="border rounded-lg">
        <table class="w-full">
          <thead class="bg-muted/50 border-b">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-medium">Title</th>
              <th class="px-4 py-3 text-left text-sm font-medium">Authors</th>
              <th class="px-4 py-3 text-left text-sm font-medium">Journal</th>
              <th class="px-4 py-3 text-left text-sm font-medium">Year</th>
              <th class="px-4 py-3 text-left text-sm font-medium">DOI</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="lit in literature"
              :key="lit.id"
              class="hover:bg-muted/30 transition-colors"
            >
              <td class="px-4 py-3 text-sm">
                <div class="flex items-start gap-2">
                  <FileText class="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <span
                    @click="openDetails(lit)"
                    class="text-left font-medium hover:text-primary hover:underline transition-colors line-clamp-2 cursor-pointer"
                    role="button"
                    tabindex="0"
                  >
                    {{ lit.title }}
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-muted-foreground">
                <span class="line-clamp-1">{{ lit.authors }}</span>
              </td>
              <td class="px-4 py-3 text-sm text-muted-foreground">
                <span class="line-clamp-1">{{ lit.journal }}</span>
              </td>
              <td class="px-4 py-3 text-sm text-muted-foreground">
                {{ lit.year }}
              </td>
              <td class="px-4 py-3 text-sm">
                <div v-if="lit.doi" class="flex items-center gap-2">
                  <a
                    :href="`https://doi.org/${lit.doi}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-1 hover:text-primary transition-colors group"
                    title="View Paper via DOI"
                  >
                    <code class="text-xs bg-muted px-2 py-1 rounded group-hover:bg-primary/10 transition-colors">{{ lit.doi }}</code>
                    <ExternalLink class="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                  </a>
                </div>
                <span v-else class="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">N/A</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center h-64 text-center">
      <FileText class="w-16 h-16 text-muted-foreground mb-4" />
      <h3 class="text-lg font-medium mb-2">No Literature Found</h3>
      <p class="text-sm text-muted-foreground">
        Upload and extract files to populate the literature database
      </p>
    </div>

    <!-- Details Modal (single instance) -->
    <Modal :show="isModalOpen" :title="selectedLiterature?.title || 'Literature Details'" maxWidth="5xl" @close="closeModal">
      <div v-if="selectedLiterature" class="space-y-6">
        <!-- Metadata -->
        <div class="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
          <div>
            <span class="font-medium text-muted-foreground">Authors:</span>
            <p>{{ selectedLiterature.authors }}</p>
          </div>
          <div>
            <span class="font-medium text-muted-foreground">Journal:</span>
            <p>{{ selectedLiterature.journal }} ({{ selectedLiterature.year }})</p>
          </div>
          <div v-if="selectedLiterature.doi">
            <span class="font-medium text-muted-foreground">DOI:</span>
            <p class="font-mono">{{ selectedLiterature.doi }}</p>
          </div>
        </div>

        <!-- Tribology Data Table -->
        <div>
          <h4 class="font-semibold mb-3 flex items-center gap-2">
            Extracted Data Points
            <span class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {{ selectedLiterature.tribologyData?.length || 0 }}
            </span>
            <span v-if="selectedLiterature.tribologyData?.length" class="text-xs text-muted-foreground font-normal ml-1">
              · {{ visibleColumns.length }} columns with data
            </span>
          </h4>

          <div class="border rounded-lg overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-muted/50 border-b">
                <tr>
                  <th
                    v-for="col in visibleColumns"
                    :key="col.key"
                    class="px-3 py-2 text-left font-medium whitespace-nowrap"
                  >
                    {{ col.label }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="record in selectedLiterature.tribologyData"
                  :key="record.id"
                  class="hover:bg-muted/20"
                >
                  <td
                    v-for="col in visibleColumns"
                    :key="col.key"
                    class="px-3 py-2 font-mono text-xs whitespace-nowrap"
                    :class="col.key === 'materialName' || col.key === 'lubricant' ? 'font-sans text-sm font-medium' : ''"
                  >
                    {{ cellValue(col, record) }}
                  </td>
                </tr>
                <tr v-if="!selectedLiterature.tribologyData?.length">
                  <td :colspan="visibleColumns.length" class="px-3 py-8 text-center text-muted-foreground">
                    No data points extracted for this record.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-else class="flex items-center justify-center p-12">
        <Loader2 class="w-8 h-8 animate-spin text-primary" />
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="closeModal">Close</Button>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
