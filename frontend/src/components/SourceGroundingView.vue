<script setup lang="ts">
/**
 * SourceGroundingView — Source Grounding View
 *
 * Two-column layout:
 *   LEFT  → PdfViewerWithHighlight (PDF viewer with highlight overlays)
 *   RIGHT → Scrollable list of extracted data cards
 *
 * Clicking a card activates the corresponding highlight and scrolls the PDF.
 */
import { ref, computed } from 'vue'
import PdfViewerWithHighlight from './PdfViewerWithHighlight.vue'
import type { HighlightRect } from '@/types/pdf-highlight'
import { AlertCircle, ChevronRight, FileText, MapPin, Search, Sparkles } from 'lucide-vue-next'

// ─── Props ───────────────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  /** URL of the PDF to display */
  pdfUrl?: string
  /** Highlight data items with PDF-point coordinates */
  highlightData?: HighlightRect[]
}>(), {
  pdfUrl: '',
  highlightData: () => [],
})

// ─── State ───────────────────────────────────────────────────────────────────
const activeHighlightId = ref<string | null>(null)
const pdfPageCount = ref(0)

// ─── Methods ─────────────────────────────────────────────────────────────────
function selectCard(id: string) {
  activeHighlightId.value = activeHighlightId.value === id ? null : id
}

function onHighlightClicked(id: string) {
  activeHighlightId.value = id
}

function onPdfLoaded(pages: number) {
  pdfPageCount.value = pages
}

/** Group highlights by page number for the sidebar */
const groupedByPage = computed(() => {
  const groups: Record<number, HighlightRect[]> = {}
  for (const item of props.highlightData) {
    const page = item.page
    if (!groups[page]) groups[page] = []
    groups[page].push(item)
  }
  return groups
})

const sortedPageNumbers = computed(() =>
  Object.keys(groupedByPage.value)
    .map(Number)
    .sort((a, b) => a - b)
)

const highlightedPageCount = computed(() => sortedPageNumbers.value.length)

function evidenceLabel(item: HighlightRect) {
  return item.matchedText?.trim() || item.id
}

function evidenceMeta(item: HighlightRect) {
  return `Page ${item.page} · ${Math.round(item.coords.w)} x ${Math.round(item.coords.h)} pt`
}
</script>

<template>
  <div class="flex h-full bg-slate-50/70">
    <!-- ═══════════ LEFT: PDF Viewer ═══════════ -->
    <div class="min-w-0 flex-1 border-r border-slate-200 bg-white">
      <PdfViewerWithHighlight
        v-if="pdfUrl"
        ref="viewerRef"
        :src="pdfUrl"
        :highlights="highlightData"
        :active-id="activeHighlightId"
        @highlight-click="onHighlightClicked"
        @loaded="onPdfLoaded"
      />
      <!-- No PDF State -->
      <div
        v-else
        class="flex h-full flex-col items-center justify-center px-8 text-center"
      >
        <FileText class="mb-3 h-12 w-12 text-slate-300" />
        <p class="text-sm font-black text-slate-700">No PDF loaded</p>
        <p class="mt-1 max-w-sm text-xs font-semibold leading-5 text-slate-400">The source PDF is not available for this literature item.</p>
      </div>
    </div>

    <!-- ═══════════ RIGHT: Data Cards ═══════════ -->
    <aside class="flex w-[25rem] flex-shrink-0 flex-col overflow-hidden bg-white">
      <!-- Sidebar Header -->
      <div class="border-b border-slate-200 bg-white px-4 py-3">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-[#0f7c82] text-white">
            <Sparkles class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <h2 class="text-sm font-black text-slate-950">Evidence Workspace</h2>
            <p class="text-xs font-semibold text-slate-500">
              {{ highlightData.length }} source hit{{ highlightData.length !== 1 ? 's' : '' }} on {{ highlightedPageCount }} page{{ highlightedPageCount !== 1 ? 's' : '' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Data Cards Scrollable List -->
      <div class="flex-1 space-y-4 overflow-y-auto p-3">
        <template v-for="pageNum in sortedPageNumbers" :key="pageNum">
          <!-- Page Group Header -->
          <div class="flex items-center gap-2 px-1 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            <FileText class="h-3.5 w-3.5" />
            <span>Page {{ pageNum }}</span>
            <div class="flex-1 border-t border-dashed border-slate-200" />
          </div>

          <!-- Cards -->
	          <button
	            v-for="item in groupedByPage[pageNum]"
	            :key="item.id"
	            :aria-label="`Evidence on page ${item.page}: ${evidenceLabel(item)}`"
	            @click="selectCard(item.id)"
	            class="w-full text-left group"
	          >
            <div
              class="rounded-md border p-3 transition-all duration-200"
              :class="[
                item.id === activeHighlightId
                  ? 'border-teal-300 bg-teal-50 shadow-md shadow-teal-500/10 ring-1 ring-teal-300'
                  : 'border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/35'
              ]"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-1.5">
                    <MapPin
                      class="h-3.5 w-3.5 flex-shrink-0 transition-colors"
                      :class="item.id === activeHighlightId ? 'text-[#0f7c82]' : 'text-slate-400'"
                    />
                    <span
                      class="truncate text-sm font-black transition-colors"
                      :class="item.id === activeHighlightId ? 'text-[#0f7c82]' : 'text-slate-900'"
                    >
                      {{ evidenceLabel(item) }}
                    </span>
                  </div>
                  <div class="ml-5 text-xs font-semibold text-slate-500">
                    {{ evidenceMeta(item) }}
                  </div>
                  <p v-if="item.matchedText" class="mt-2 line-clamp-3 rounded-md bg-slate-50 px-2 py-1.5 text-xs font-medium leading-5 text-slate-600">
                    {{ item.matchedText }}
                  </p>
                </div>
                <ChevronRight
                  class="mt-0.5 h-4 w-4 flex-shrink-0 transition-all"
                  :class="[
                    item.id === activeHighlightId
                      ? 'translate-x-0.5 text-[#0f7c82]'
                      : 'text-slate-400 opacity-0 group-hover:opacity-100'
                  ]"
                />
              </div>
            </div>
          </button>
        </template>

        <!-- Empty State -->
        <div
          v-if="highlightData.length === 0"
          class="flex min-h-[20rem] flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-5 text-center"
        >
          <Search v-if="pdfUrl" class="mb-3 h-8 w-8 text-slate-300" />
          <AlertCircle v-else class="mb-3 h-8 w-8 text-slate-300" />
          <p class="text-sm font-black text-slate-700">
            {{ pdfUrl ? 'No page-level evidence located' : 'No source document available' }}
          </p>
          <p class="mt-2 max-w-xs text-xs font-semibold leading-5 text-slate-400">
            {{ pdfUrl ? 'This record can still have text evidence in the table preview, but no PDF highlight was saved for this source.' : 'The literature item does not expose a PDF for source grounding.' }}
          </p>
        </div>
      </div>
    </aside>
  </div>
</template>
