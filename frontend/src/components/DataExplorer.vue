<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import {
  searchRecords,
  getFilterOptions,
  updateTribologyRecord,
  type SearchFilter,
  type RecordResponse,
  type PaginatedRecordResponse
} from '@/lib/api'
import {
  Search, Eye, Pencil, Trash2,
  ChevronLeft, ChevronRight,
  SlidersHorizontal, BookOpen,
  ExternalLink, CheckCircle,
  Download, BookMarked, Loader2
} from 'lucide-vue-next'
import { normalizePotentialDisplayText } from '@/lib/potential'

const props = defineProps<{
  initialDoi?: string
}>()

const emit = defineEmits<{
  'view-literature': []
  'clear-doi': []
}>()

const handleViewLiterature = () => {
  window.alert('DataExplorer: Literature Management clicked')
  console.log('[DataExplorer] Emitting view-literature')
  emit('view-literature')
}

// --- Constants ---
const PAGE_SIZE = 10

// --- State ---
const loading = ref(false)
const result = ref<PaginatedRecordResponse>({ total: 0, skip: 0, limit: PAGE_SIZE, items: [] })
const filterOptions = ref<{ materials: string[], lubricants: string[] }>({ materials: [], lubricants: [] })

const selectedLubricant = ref('')
const selectedMaterial = ref('')
const cofMin = ref('')
const cofMax = ref('')

const searchDoi = ref(props.initialDoi || '')

const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / PAGE_SIZE)))

const expandedRowId = ref<number | null>(null)
const editingValues = ref<Record<number, { cof: string }>>({})
const savingRowId = ref<number | null>(null)

// --- Methods ---

const loadOptions = async () => {
  try {
    filterOptions.value = await getFilterOptions()
  } catch (e) {
    console.error('Failed to load options', e)
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    const f: SearchFilter = {
      materials: selectedMaterial.value ? [selectedMaterial.value] : [],
      lubricants: selectedLubricant.value ? [selectedLubricant.value] : [],
      cof_min: cofMin.value !== '' ? parseFloat(cofMin.value) : undefined,
      cof_max: cofMax.value !== '' ? parseFloat(cofMax.value) : undefined,
      doi: searchDoi.value || undefined
    }
    const skip = (currentPage.value - 1) * PAGE_SIZE
    result.value = await searchRecords(f, skip, PAGE_SIZE)
    if (result.value.items.length > 0) {
      console.log("Got items:", result.value.items[0])
    }
  } catch (e) {
    console.error('Failed to search records', e)
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  fetchData()
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  fetchData()
}

const toggleRow = (record: RecordResponse) => {
  if (expandedRowId.value === record.id) {
    expandedRowId.value = null
  } else {
    expandedRowId.value = record.id
    if (!editingValues.value[record.id]) {
      editingValues.value[record.id] = {
        cof: record.cofRaw ?? (record.cofValue != null ? String(record.cofValue) : ''),
      }
    }
  }
}

const cancelEdit = (record: RecordResponse) => {
  editingValues.value[record.id] = {
    cof: record.cofRaw ?? (record.cofValue != null ? String(record.cofValue) : ''),
  }
}

const saveRecord = async (record: RecordResponse) => {
  const vals = editingValues.value[record.id]
  if (!vals) return
  savingRowId.value = record.id
  try {
    await updateTribologyRecord(record.id, {
      cofRaw: vals.cof,
      cofValue: vals.cof ? parseFloat(vals.cof.replace(/[<>≤≥~]/g, '')) : undefined,
    })
    record.cofRaw = vals.cof
    const parsed = parseFloat(vals.cof.replace(/[<>≤≥~]/g, ''))
    record.cofValue = isNaN(parsed) ? record.cofValue : parsed
    expandedRowId.value = null
  } catch (e) {
    console.error('Failed to save record', e)
  } finally {
    savingRowId.value = null
  }
}

const conditionText = (record: RecordResponse): string | null => {
  const parts: string[] = []
  
  if (record.temperature != null) parts.push(`T: ${record.temperature}`)
  
  if (record.loadRaw) parts.push(`Load: ${record.loadRaw}`)
  else if (record.loadValue != null) parts.push(`Load: ${record.loadValue}N`)
  
  if (record.speedValue != null) parts.push(`Speed: ${record.speedValue}mm/s`)
  
  if (record.potential) parts.push(`Potential: ${normalizePotentialDisplayText(record.potential)}`)
  
  if (record.waterContent) {
    const wc = record.waterContent.toLowerCase().includes('dry')
      ? `Dry (0% RH)`
      : record.waterContent
    parts.push(`WC: ${wc}`)
  }
  
  if (record.surfaceRoughness) parts.push(`SR: ${record.surfaceRoughness}`)
  
  return parts.length > 0 ? parts.join(', ') : null
}

const cofDisplay = (record: RecordResponse): string => {
  if (record.cofValue != null && !isNaN(Number(record.cofValue))) {
    return Number(record.cofValue).toFixed(4)
  }
  if (record.cofRaw) return record.cofRaw
  return '—'
}


const visiblePages = computed(() => {
  const total = totalPages.value
  const cur = currentPage.value
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const start = Math.max(1, cur - 1)
  const end = Math.min(total, cur + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

const rangeStart = computed(() =>
  result.value.total === 0 ? 0 : result.value.skip + 1
)
const rangeEnd = computed(() =>
  Math.min(result.value.skip + PAGE_SIZE, result.value.total)
)

onMounted(() => {
  loadOptions()
  fetchData()
})

watch(() => props.initialDoi, (newDoi) => {
  if (newDoi) {
    searchDoi.value = newDoi
    handleSearch()
  }
})

const clearDoiFilter = () => {
  searchDoi.value = ''
  emit('clear-doi')
  handleSearch()
}
</script>

<template>
  <div class="flex flex-col h-full bg-[#f5f6fa] overflow-hidden">

    <!-- HEADER -->
    <div class="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded bg-blue-50 flex items-center justify-center">
          <BookMarked class="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h1 class="text-lg font-bold text-gray-900 leading-tight">IonicLink Sourcing</h1>
          <p class="text-xs text-gray-500">Automatically locate source data and verify extraction accuracy.</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div v-if="searchDoi" class="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-md">
          <span class="text-xs font-medium text-blue-700">DOI: {{ searchDoi }}</span>
          <button @click="clearDoiFilter" class="text-blue-500 hover:text-blue-700">
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
        <button 
          @click="handleViewLiterature"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <BookOpen class="w-4 h-4" />
          Literature Mgmt
        </button>
        <button class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium">
          <Download class="w-4 h-4" />
          Export Verified Data
        </button>
      </div>
    </div>

    <!-- FILTER BAR -->
    <div class="px-6 pt-4 pb-3 bg-white border-b border-gray-200 flex-shrink-0">
      <div class="flex items-center gap-2 mb-3">
        <SlidersHorizontal class="w-4 h-4 text-blue-600" />
        <span class="text-sm font-semibold text-gray-800">
          Advanced Search
        </span>
      </div>
      <div class="flex items-end gap-4 flex-wrap">

        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">Ionic Liquid</label>
          <select
            v-model="selectedLubricant"
            class="h-9 px-2.5 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
          >
            <option value="">All</option>
            <option v-for="l in filterOptions.lubricants" :key="l" :value="l">{{ l }}</option>
          </select>
        </div>

        <!-- Surface Type -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">Surface Type</label>
          <select
            v-model="selectedMaterial"
            class="h-9 px-2.5 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
          >
            <option value="">All</option>
            <option v-for="m in filterOptions.materials" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <!-- COF Range -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500">COF Range</label>
          <div class="flex items-center gap-2">
            <input
              type="number" v-model="cofMin" placeholder="Min" step="0.0001"
              class="h-9 w-24 px-2.5 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span class="text-gray-400 text-sm">-</span>
            <input
              type="number" v-model="cofMax" placeholder="Max" step="0.0001"
              class="h-9 w-24 px-2.5 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              @click="handleSearch" :disabled="loading"
              class="h-9 w-9 flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
              <Search v-else class="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>

    <!-- TABLE AREA -->
    <div class="flex-1 overflow-y-auto px-6 py-4">
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">

        <!-- Table header -->
        <div class="grid grid-cols-[60px_180px_150px_1fr_120px_100px] text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>ID</div>
          <div>IONIC LIQUID</div>
          <div>SURFACE</div>
          <div>CONDITION</div>
          <div>COF</div>
          <div class="text-right">ACTIONS</div>
        </div>

        <!-- Loading / empty -->
        <div v-if="loading && result.items.length === 0" class="flex items-center justify-center h-40">
          <Loader2 class="w-8 h-8 animate-spin text-blue-500" />
        </div>
        <div v-else-if="!loading && result.items.length === 0" class="flex flex-col items-center justify-center h-40 text-gray-400">
          <BookOpen class="w-10 h-10 mb-2 opacity-40" />
          <p class="text-sm">No data found</p>
        </div>

        <!-- Data rows -->
        <template v-for="record in result.items" :key="record.id">

          <!-- Main row -->
          <div
            class="grid grid-cols-[60px_180px_150px_1fr_120px_100px] items-center px-4 py-3.5 border-b border-gray-100 hover:bg-blue-50/50 transition-colors cursor-pointer"
            :class="expandedRowId === record.id ? 'bg-blue-50' : ''"
            @click="toggleRow(record)"
          >
            <div class="text-sm text-gray-400">{{ record.id }}</div>
            <div class="text-sm font-semibold text-gray-900 pr-3 truncate">{{ record.lubricant || '—' }}</div>
            <div class="text-sm text-gray-700 truncate">{{ record.materialName || '—' }}</div>
            <div>
              <span v-if="conditionText(record)"
                class="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600 font-mono"
              >{{ conditionText(record) }}</span>
              <span v-else class="text-sm text-gray-400">—</span>
            </div>
            <div class="text-base font-bold text-blue-600">{{ cofDisplay(record) }}</div>

            <!-- Action buttons -->
            <div class="flex items-center gap-1.5 justify-end" @click.stop>
              <button
                @click="toggleRow(record)"
                class="p-1.5 rounded-md transition-colors"
                :class="expandedRowId === record.id ? 'text-blue-600 bg-blue-100' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'"
                title="View Details"
              >
                <Eye class="w-4 h-4" />
              </button>
              <button class="p-1.5 rounded-md text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Edit">
                <Pencil class="w-4 h-4" />
              </button>
              <button class="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Expanded 3-panel detail row -->
          <div v-if="expandedRowId === record.id" class="grid grid-cols-3 border-b border-gray-200">

            <!-- LEFT: Reference Details -->
            <div class="p-5 border-r border-gray-200 bg-white">
              <div class="flex items-center gap-2 mb-3">
                <div class="w-5 h-5 rounded border border-gray-300 flex items-center justify-center">
                  <BookOpen class="w-3 h-3 text-gray-500" />
                </div>
                <span class="text-xs font-semibold text-gray-600 uppercase tracking-wide">Reference Details</span>
              </div>
              <div v-if="record.literature" class="space-y-2.5">
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Title</p>
                  <p class="text-sm text-gray-800 leading-snug">{{ record.literature.title }}</p>
                </div>
                <div class="flex gap-4">
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Authors</p>
                    <p class="text-xs text-gray-500 truncate">{{ record.literature.authors || '—' }}</p>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Journal</p>
                    <p class="text-xs text-gray-500 truncate">
                      {{ record.literature.journal }}<span v-if="record.literature.year">, {{ record.literature.year }}</span>
                    </p>
                  </div>
                </div>
                <div v-if="record.literature.doi">
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">DOI</p>
                  <a
                    :href="`https://doi.org/${record.literature.doi}`"
                    target="_blank"
                    class="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >{{ record.literature.doi }} <ExternalLink class="w-2.5 h-2.5" /></a>
                </div>
              </div>
              <div v-else class="text-xs text-gray-400 italic">No literature info available</div>
            </div>

            <!-- CENTER: Extracted Data (editable) -->
            <div class="p-5 border-r border-gray-200 bg-white">
              <div class="flex items-center gap-2 mb-3">
                <div class="w-5 h-5 rounded border border-blue-400 bg-blue-50 flex items-center justify-center">
                  <Pencil class="w-2.5 h-2.5 text-blue-600" />
                </div>
                <span class="text-xs font-semibold text-blue-600 uppercase tracking-wide">Extracted Data Verification</span>
              </div>
              <div class="grid grid-cols-2 gap-x-6 gap-y-3 mb-4">
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Cation/Anion</p>
                  <p class="text-sm text-gray-800">{{ record.lubricant || '—' }}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Surface</p>
                  <p class="text-sm text-gray-800">{{ record.materialName || '—' }}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Temperature</p>
                  <p class="text-sm text-gray-800">{{ record.temperature || '—' }}</p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Specific Condition</p>
                  <p class="text-sm text-gray-800">{{ conditionText(record) || '—' }}</p>
                </div>
              </div>
              <div class="mb-4">
                <p class="text-xs font-semibold text-blue-600 mb-1.5">Friction Coefficient (COF)</p>
                <input
                  :value="editingValues[record.id]?.cof ?? ''"
                  @input="(e: Event) => { const v = editingValues[record.id]; if (v) v.cof = (e.target as HTMLInputElement).value }"
                  type="text"
                  class="w-full h-9 px-3 text-sm border-2 border-blue-400 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
                  placeholder="e.g. 0.001"
                  @click.stop
                />
              </div>
              <div class="flex gap-2 justify-end">
                <button
                  @click.stop="cancelEdit(record)"
                  class="px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 transition-colors"
                >Cancel</button>
                <button
                  @click.stop="saveRecord(record)"
                  :disabled="savingRowId === record.id"
                  class="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors font-medium flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Loader2 v-if="savingRowId === record.id" class="w-3 h-3 animate-spin" />
                  <CheckCircle v-else class="w-3 h-3" />
                  Verify & Save
                </button>
              </div>
            </div>

            <!-- RIGHT: Source Evidence (intentionally dark, per screenshot) -->
            <div class="p-5 bg-[#1a2235] text-white">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-red-500"></div>
                  <span class="text-xs font-semibold text-gray-200 uppercase tracking-wide">Source Evidence</span>
                </div>
                <button class="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 transition-colors">
                  <ExternalLink class="w-3 h-3" />View Source
                </button>
              </div>
              <div v-if="record.literature" class="mb-3">
                <p class="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">Location</p>
                <p class="text-xs text-gray-300 leading-relaxed">
                  {{ record.literature.title
                    ? record.literature.title.slice(0, 55) + (record.literature.title.length > 55 ? '...' : '')
                    : '—' }}
                </p>
              </div>
              <div class="rounded-lg border border-gray-600 bg-[#243050] flex items-center justify-center min-h-[130px]">
                <div class="flex flex-col items-center gap-2 text-gray-500">
                  <BookOpen class="w-8 h-8 opacity-30" />
                  <p class="text-xs text-center opacity-50">PDF Source Image<br/>(Source Figure)</p>
                </div>
              </div>
              <p class="mt-2 text-[10px] text-center text-gray-500 italic">* Source evidence requires PDF with grounding data</p>
            </div>

          </div>
        </template>
      </div>
    </div>

    <!-- PAGINATION FOOTER -->
    <div class="flex items-center justify-between px-6 py-3 bg-white border-t border-gray-200 flex-shrink-0">
      <p class="text-sm text-gray-500">
        <template v-if="result.total > 0">
          Showing {{ rangeStart }} to {{ rangeEnd }} (Total {{ result.total }} records)
        </template>
        <template v-else>No records found</template>
      </p>
      <div class="flex items-center gap-1">
        <button
          @click="goToPage(currentPage - 1)" :disabled="currentPage === 1"
          class="px-2.5 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          <ChevronLeft class="w-3.5 h-3.5" /> Previous
        </button>
        <button
          v-for="page in visiblePages" :key="page"
          @click="goToPage(page)"
          class="w-8 h-8 text-sm rounded-md border transition-colors"
          :class="page === currentPage
            ? 'bg-blue-600 text-white border-blue-600 font-semibold'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'"
        >{{ page }}</button>
        <button
          @click="goToPage(currentPage + 1)" :disabled="currentPage >= totalPages"
          class="px-2.5 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
        >
          Next <ChevronRight class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

  </div>
</template>
