<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { listLiterature, type Literature, type TribologyRecord } from '@/lib/api'
import { getLiteratureDetails, type LiteratureWithRecords } from '@/lib/api'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  ExternalLink,
  Search,
  Filter,
  Plus,
  Download,
  List,
  LayoutGrid,
  MoreHorizontal,
} from 'lucide-vue-next'
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
const activeTab = ref<'all' | 'recent' | 'favorites'>('all')
const searchText = ref('')
const listMode = ref<'list' | 'grid'>('list')
const favoriteIds = ref<number[]>([])

const recentLiterature = computed(() => {
  return [...literature.value]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 12)
})

const filteredLiterature = computed(() => {
  let rows = literature.value
  if (activeTab.value === 'recent') rows = recentLiterature.value
  if (activeTab.value === 'favorites') rows = rows.filter((r) => favoriteIds.value.includes(r.id))

  const q = searchText.value.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) =>
    [r.title, r.authors, r.journal, r.doi, String(r.year || '')]
      .join(' ')
      .toLowerCase()
      .includes(q)
  )
})

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

// --- Helper for Journal Colors ---
function getJournalColorClass(journal: string | null | undefined): string {
  if (!journal) return 'bg-slate-100 text-slate-600'
  const j = journal.toLowerCase();
  if (j.includes('physical chemistry') || j.includes('pccp') || j.includes('jpc')) {
    return 'bg-blue-100 text-blue-700'
  }
  if (j.includes('lubricant') || j.includes('tribology') || j.includes('wear')) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (j.includes('nature') || j.includes('science') || j.includes('advanced')) {
    return 'bg-purple-100 text-purple-700'
  }
  if (j.includes('journal of chemical information') || j.includes('jcim')) {
    return 'bg-amber-100 text-amber-700'
  }
  if (j.includes('acs') || j.includes('applied')) {
    return 'bg-rose-100 text-rose-700'
  }
  
  // Default fallback hash logic for stable colors
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-purple-100 text-purple-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700',
    'bg-indigo-100 text-indigo-700'
  ]
  let hash = 0;
  for (let i = 0; i < j.length; i++) {
    hash = j.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length] || colors[0]
}

// --- Lifecycle ---
onMounted(() => {
  loadLiterature()
})
</script>

<template>
  <div class="flex flex-col h-full p-6 gap-4 bg-[#f5f7fb]">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Literature Database</h1>
        <p class="mt-2 text-sm text-slate-500">Manage, search, and reprocess existing ionic liquid literature records</p>
      </div>
      <div class="flex items-center gap-3">
        <button class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          <Download class="h-4 w-4" />
          Export Data
        </button>
        <button class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
          <Plus class="h-4 w-4" />
          Add Literature
        </button>
      </div>
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

    <div class="flex-1 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div class="flex items-center justify-between border-b border-slate-100 px-6 pt-4 pb-0">
        <div class="flex items-center gap-8 text-[15px]">
          <button
            class="relative pb-4 font-medium transition-colors"
            :class="activeTab === 'all' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'"
            @click="activeTab = 'all'"
          >
            All Literature
            <span class="ml-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="activeTab === 'all' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'">{{ literature.length }}</span>
            <span v-if="activeTab === 'all'" class="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 rounded-t-full"></span>
          </button>
          <button
            class="relative pb-4 font-medium transition-colors"
            :class="activeTab === 'recent' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'"
            @click="activeTab = 'recent'"
          >
            Recently Added
            <span class="ml-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="activeTab === 'recent' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'">{{ recentLiterature.length }}</span>
            <span v-if="activeTab === 'recent'" class="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 rounded-t-full"></span>
          </button>
          <button
            class="relative pb-4 font-medium transition-colors"
            :class="activeTab === 'favorites' ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'"
            @click="activeTab = 'favorites'"
          >
            Favorites
            <span class="ml-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="activeTab === 'favorites' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'">{{ favoriteIds.length }}</span>
            <span v-if="activeTab === 'favorites'" class="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 rounded-t-full"></span>
          </button>
        </div>

        <div class="flex items-center gap-3 pb-3">
          <div class="flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
            <Search class="mr-2 h-4 w-4" />
            <input
              v-model="searchText"
              type="text"
              placeholder="Search in current view..."
              class="w-64 bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <button class="inline-flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50">
            <Filter class="h-4 w-4 text-slate-400" />
            Filter
          </button>
          <div class="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm h-[38px]">
            <button
              class="inline-flex h-full w-8 items-center justify-center rounded-md text-slate-500 hover:text-slate-900 transition-colors"
              :class="listMode === 'list' ? 'bg-slate-100 text-slate-900 shadow-sm' : ''"
              @click="listMode = 'list'"
            >
              <List class="h-4 w-4" />
            </button>
            <button
              class="inline-flex h-full w-8 items-center justify-center rounded-md text-slate-500 hover:text-slate-900 transition-colors"
              :class="listMode === 'grid' ? 'bg-slate-100 text-slate-900 shadow-sm' : ''"
              @click="listMode = 'grid'"
            >
              <LayoutGrid class="h-4 w-4" />
            </button>
          </div>
          <button class="inline-flex h-[38px] w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" @click="loadLiterature">
            <RefreshCw :class="{ 'animate-spin': loading }" class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading && filteredLiterature.length === 0" class="flex h-64 items-center justify-center">
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
      </div>

      <!-- Literature table -->
      <div v-else-if="filteredLiterature.length > 0" class="h-[calc(100%-64px)] overflow-auto">
        <table class="w-full text-left">
          <thead class="border-b border-slate-100 bg-white text-xs font-semibold text-slate-400">
            <tr>
              <th class="w-12 pl-6 py-4"><input type="checkbox" class="h-4 w-4 rounded border-slate-300" /></th>
              <th class="px-4 py-4 uppercase tracking-wider">TITLE</th>
              <th class="px-4 py-4 uppercase tracking-wider">AUTHORS</th>
              <th class="px-4 py-4 uppercase tracking-wider">JOURNAL</th>
              <th class="px-4 py-4 uppercase tracking-wider">YEAR</th>
              <th class="px-6 py-4 text-right uppercase tracking-wider border-l border-transparent">DOI / ACTIONS</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="lit in filteredLiterature" :key="lit.id" class="hover:bg-slate-50/50 group transition-colors">
              <td class="pl-6 py-5 align-top">
                <input type="checkbox" class="h-4 w-4 rounded border-slate-300 mt-1" />
              </td>
              <td class="px-4 py-5 align-top">
                <div class="flex gap-3">
                  <FileText class="mt-0.5 h-5 w-5 text-slate-300 shrink-0" />
                  <div>
                    <button
                      class="text-left text-[15px] font-bold leading-snug text-slate-800 hover:text-blue-600 transition-colors"
                      @click="openDetails(lit)"
                    >
                      {{ lit.title }}
                    </button>
                    <div class="mt-2.5 flex flex-wrap gap-2">
                      <span
                        v-for="tag in lit.title.split(/[\s,:-]+/).filter(t => t.length > 4).slice(0, 2)"
                        :key="`${lit.id}-${tag}`"
                        class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm"
                      >
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-5 align-top">
                <div class="text-[13px] leading-relaxed text-slate-500 max-w-[200px]">{{ lit.authors }}</div>
              </td>
              <td class="px-4 py-5 align-top">
                <span class="inline-flex rounded-full px-3 py-1 text-[13px] font-medium" :class="getJournalColorClass(lit.journal)">
                  {{ lit.journal || 'Unknown Journal' }}
                </span>
              </td>
              <td class="px-4 py-5 align-top text-[13px] text-slate-600 font-medium">{{ lit.year || '--' }}</td>
              <td class="px-6 py-5 align-top text-right">
                <div class="inline-flex items-center gap-3">
                  <a
                    v-if="lit.doi"
                    :href="`https://doi.org/${lit.doi}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    {{ lit.doi }}
                    <ExternalLink class="h-3.5 w-3.5 opacity-60" />
                  </a>
                  <button class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700 transition-all">
                    <MoreHorizontal class="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Empty State -->
      <div v-else class="flex h-64 flex-col items-center justify-center text-center">
        <FileText class="mb-4 h-16 w-16 text-muted-foreground" />
        <h3 class="mb-2 text-lg font-medium">No Literature Found</h3>
        <p class="text-sm text-muted-foreground">
          Upload and extract files to populate the literature database
        </p>
      </div>
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
