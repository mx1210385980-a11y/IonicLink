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
import { FileText, MapPin, ChevronRight, Sparkles } from 'lucide-vue-next'

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
</script>

<template>
  <div class="flex h-full">
    <!-- ═══════════ LEFT: PDF Viewer ═══════════ -->
    <div class="flex-1 min-w-0 border-r">
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
        class="flex flex-col items-center justify-center h-full text-center"
      >
        <FileText class="w-12 h-12 text-muted-foreground/30 mb-3" />
        <p class="text-sm text-muted-foreground">No PDF loaded</p>
        <p class="text-xs text-muted-foreground/70 mt-1">Upload and extract a PDF file first</p>
      </div>
    </div>

    <!-- ═══════════ RIGHT: Data Cards ═══════════ -->
    <aside class="w-96 flex-shrink-0 flex flex-col bg-card overflow-hidden">
      <!-- Sidebar Header -->
      <div class="px-4 py-3 border-b bg-card/80 backdrop-blur-sm">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <Sparkles class="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Extracted Data</h2>
            <p class="text-xs text-muted-foreground">
              {{ highlightData.length }} item{{ highlightData.length !== 1 ? 's' : '' }} found
            </p>
          </div>
        </div>
      </div>

      <!-- Data Cards Scrollable List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-4">
        <template v-for="pageNum in sortedPageNumbers" :key="pageNum">
          <!-- Page Group Header -->
          <div class="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium px-1">
            <FileText class="w-3.5 h-3.5" />
            <span>Page {{ pageNum }}</span>
            <div class="flex-1 border-t border-dashed" />
          </div>

          <!-- Cards -->
          <button
            v-for="item in groupedByPage[pageNum]"
            :key="item.id"
            @click="selectCard(item.id)"
            class="w-full text-left group"
          >
            <div
              class="rounded-lg border p-3 transition-all duration-200"
              :class="[
                item.id === activeHighlightId
                  ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/50'
                  : 'bg-card hover:bg-accent/50 hover:border-accent-foreground/20 border-border'
              ]"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 mb-1">
                    <MapPin
                      class="w-3.5 h-3.5 flex-shrink-0 transition-colors"
                      :class="item.id === activeHighlightId ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
                    />
                    <span
                      class="text-sm font-medium truncate transition-colors"
                      :class="item.id === activeHighlightId ? 'text-amber-800 dark:text-amber-200' : 'text-foreground'"
                    >
                      {{ item.id }}
                    </span>
                  </div>
                  <div class="ml-5 text-xs text-muted-foreground">
                    Page {{ item.page }} · ({{ item.coords.x.toFixed(0) }}, {{ item.coords.y.toFixed(0) }})
                  </div>
                </div>
                <ChevronRight
                  class="w-4 h-4 mt-0.5 flex-shrink-0 transition-all"
                  :class="[
                    item.id === activeHighlightId
                      ? 'text-amber-600 dark:text-amber-400 translate-x-0.5'
                      : 'text-muted-foreground opacity-0 group-hover:opacity-100'
                  ]"
                />
              </div>
            </div>
          </button>
        </template>

        <!-- Empty State -->
        <div
          v-if="highlightData.length === 0"
          class="flex flex-col items-center justify-center h-40 text-center"
        >
          <FileText class="w-8 h-8 text-muted-foreground/50 mb-2" />
          <p class="text-sm text-muted-foreground">No extracted data available</p>
          <p class="text-xs text-muted-foreground/70 mt-1">Upload a PDF and extract data first</p>
        </div>
      </div>
    </aside>
  </div>
</template>
