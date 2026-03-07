<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import PdfPageOverlay from './PdfPageOverlay.vue'
import type { ExtractedData } from '@/types/pdf-highlight'
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-vue-next'

// Configure the PDF.js worker from the CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

// ─── Props & Emits ───────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  pdfSource: string
  highlights?: ExtractedData[]
  activeHighlightId?: string | null
  scale?: number
}>(), {
  highlights: () => [],
  activeHighlightId: null,
  scale: 1.5,
})

const emit = defineEmits<{
  highlightClicked: [id: string]
  scaleChange: [scale: number]
  loaded: [pageCount: number]
}>()

// ─── State ───────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null)
const pdfDoc = ref<PDFDocumentProxy | null>(null)
const pageCount = ref(0)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const currentScale = ref(props.scale)
const renderedPages = ref<Set<number>>(new Set())

// Canvas refs — keyed by page number
const canvasRefs = ref<Record<number, HTMLCanvasElement | null>>({})
const pageContainerRefs = ref<Record<number, HTMLDivElement | null>>({})

// Track active render tasks so we can cancel on re-render
const activeRenderTasks = ref<Map<number, RenderTask>>(new Map())

// Page dimensions cache
const pageDimensions = ref<Record<number, { width: number; height: number }>>({})

// ─── Computed ────────────────────────────────────────────────────────────────
const pageNumbers = computed(() =>
  Array.from({ length: pageCount.value }, (_, i) => i + 1)
)

// ─── PDF Loading ─────────────────────────────────────────────────────────────
async function loadPdf() {
  isLoading.value = true
  loadError.value = null
  renderedPages.value.clear()
  pageDimensions.value = {}

  try {
    const loadingTask = pdfjsLib.getDocument(props.pdfSource)
    pdfDoc.value = await loadingTask.promise
    pageCount.value = pdfDoc.value.numPages
    emit('loaded', pageCount.value)

    await nextTick()
    renderAllPages()
  } catch (err: any) {
    console.error('Failed to load PDF:', err)
    loadError.value = err.message || 'Failed to load PDF document.'
  } finally {
    isLoading.value = false
  }
}

// ─── Page Rendering ──────────────────────────────────────────────────────────
async function renderPage(pageNum: number) {
  if (!pdfDoc.value) return

  const canvas = canvasRefs.value[pageNum]
  if (!canvas) return

  // Cancel any in-progress render for this page
  const existingTask = activeRenderTasks.value.get(pageNum)
  if (existingTask) {
    existingTask.cancel()
    activeRenderTasks.value.delete(pageNum)
  }

  try {
    const page: PDFPageProxy = await pdfDoc.value.getPage(pageNum)
    const viewport = page.getViewport({ scale: currentScale.value })

    // Set canvas dimensions
    canvas.width = viewport.width
    canvas.height = viewport.height

    // Store page dimensions for overlay
    pageDimensions.value[pageNum] = {
      width: viewport.width,
      height: viewport.height,
    }

    // Update page container size so the overlay can match
    const container = pageContainerRefs.value[pageNum]
    if (container) {
      container.style.width = `${viewport.width}px`
      container.style.height = `${viewport.height}px`
    }

    const renderTask = page.render({
      canvas,
      viewport,
    })

    activeRenderTasks.value.set(pageNum, renderTask)

    await renderTask.promise
    activeRenderTasks.value.delete(pageNum)
    renderedPages.value.add(pageNum)
  } catch (err: any) {
    if (err.name !== 'RenderingCancelledException') {
      console.error(`Error rendering page ${pageNum}:`, err)
    }
  }
}

async function renderAllPages() {
  renderedPages.value.clear()
  for (const pageNum of pageNumbers.value) {
    await renderPage(pageNum)
  }
}

// ─── Zoom Controls ───────────────────────────────────────────────────────────
function zoomIn() {
  currentScale.value = Math.min(currentScale.value + 0.25, 4.0)
  emit('scaleChange', currentScale.value)
}

function zoomOut() {
  currentScale.value = Math.max(currentScale.value - 0.25, 0.5)
  emit('scaleChange', currentScale.value)
}

function resetZoom() {
  currentScale.value = 1.5
  emit('scaleChange', currentScale.value)
}

// ─── Auto-Scroll to Active Highlight ─────────────────────────────────────────
function scrollToHighlight(highlightId: string) {
  nextTick(() => {
    const el = containerRef.value?.querySelector(
      `[data-highlight-id="${highlightId}"]`
    )
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

// ─── Canvas Ref Setter ───────────────────────────────────────────────────────
function setCanvasRef(pageNum: number, el: any) {
  canvasRefs.value[pageNum] = el as HTMLCanvasElement | null
}

function setPageContainerRef(pageNum: number, el: any) {
  pageContainerRefs.value[pageNum] = el as HTMLDivElement | null
}

// ─── Watchers ────────────────────────────────────────────────────────────────
watch(() => props.pdfSource, () => {
  loadPdf()
})

watch(() => props.activeHighlightId, (newId) => {
  if (newId) {
    scrollToHighlight(newId)
  }
})

watch(currentScale, () => {
  if (pdfDoc.value) {
    renderAllPages()
  }
})

// ─── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  loadPdf()
})

onUnmounted(() => {
  // Cancel all active render tasks
  for (const task of activeRenderTasks.value.values()) {
    task.cancel()
  }
  activeRenderTasks.value.clear()

  // Destroy the PDF document
  if (pdfDoc.value) {
    pdfDoc.value.destroy()
  }
})
</script>

<template>
  <div class="flex flex-col h-full bg-muted/30">
    <!-- Toolbar -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b bg-card/80 backdrop-blur-sm"
    >
      <div class="flex items-center gap-1.5">
        <button
          @click="zoomOut"
          class="inline-flex items-center justify-center rounded-md w-8 h-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Zoom Out"
        >
          <ZoomOut class="w-4 h-4" />
        </button>
        <span
          class="text-sm font-medium text-muted-foreground min-w-[4rem] text-center tabular-nums"
        >
          {{ Math.round(currentScale * 100) }}%
        </span>
        <button
          @click="zoomIn"
          class="inline-flex items-center justify-center rounded-md w-8 h-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Zoom In"
        >
          <ZoomIn class="w-4 h-4" />
        </button>
        <div class="w-px h-5 bg-border mx-1" />
        <button
          @click="resetZoom"
          class="inline-flex items-center justify-center rounded-md w-8 h-8 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Reset Zoom"
        >
          <RotateCcw class="w-4 h-4" />
        </button>
      </div>

      <div v-if="pageCount > 0" class="text-sm text-muted-foreground">
        {{ pageCount }} page{{ pageCount !== 1 ? 's' : '' }}
      </div>
    </div>

    <!-- PDF Content Area -->
    <div
      ref="containerRef"
      class="flex-1 overflow-auto scroll-smooth"
    >
      <!-- Loading State -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 class="w-8 h-8 animate-spin text-primary" />
        <p class="text-sm text-muted-foreground">Loading PDF document…</p>
      </div>

      <!-- Error State -->
      <div v-else-if="loadError" class="flex flex-col items-center justify-center h-full gap-3 p-8">
        <div class="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <span class="text-destructive text-lg font-bold">!</span>
        </div>
        <p class="text-sm text-destructive font-medium">Failed to load PDF</p>
        <p class="text-xs text-muted-foreground text-center max-w-sm">{{ loadError }}</p>
        <button
          @click="loadPdf"
          class="mt-2 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>

      <!-- Rendered Pages -->
      <div v-else class="flex flex-col items-center gap-4 py-4 px-2">
        <div
          v-for="pageNum in pageNumbers"
          :key="pageNum"
          :ref="(el: any) => setPageContainerRef(pageNum, el)"
          class="relative bg-white shadow-md border border-border/40"
        >
          <!-- Canvas Layer -->
          <canvas
            :ref="(el: any) => setCanvasRef(pageNum, el)"
            class="block"
          />

          <!-- Page Loading Skeleton (before rendered) -->
          <div
            v-if="!renderedPages.has(pageNum)"
            class="absolute inset-0 bg-muted/50 flex items-center justify-center"
          >
            <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
          </div>

          <!-- Highlight Overlay Layer -->
          <PdfPageOverlay
            :highlights="highlights"
            :active-highlight-id="activeHighlightId ?? null"
            :page-number="pageNum"
            @highlight-clicked="emit('highlightClicked', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
