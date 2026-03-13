<script setup lang="ts">
/**
 * PdfViewerWithHighlight.vue
 * ─────────────────────────────────────────────────────────────
 * PDF viewer that renders pages via pdfjs-dist and delegates
 * highlight rendering to PdfHighlightOverlay.vue.
 *
 * ✅  Uses pdfjs-dist v5 with a LOCAL Vite worker (no CDN)
 * ✅  Delegates highlighting to PdfHighlightOverlay (% based, zoom-resilient)
 * ✅  Supports bottom-left origin for PDFMiner-style backends
 * ✅  Exposes scrollToHighlight(id) for programmatic scroll
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import PdfHighlightOverlay from './PdfHighlightOverlay.vue'
import type { HighlightRect } from '@/types/pdf-highlight'
import type { HighlightItem } from './PdfHighlightOverlay.vue'
import { resolveApiUrl } from '@/lib/api'
import { authFetch } from '@/lib/session'

// ─── Worker (Vite-local, no CDN) ─────────────────────────────────────────────
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// ─── Props ───────────────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  /** PDF source: URL string, Uint8Array, or ArrayBuffer */
  src: string | Uint8Array | ArrayBuffer
  /** Highlight rectangles (coords in PDF points) */
  highlights?: HighlightRect[]
  /** ID of the currently active / focused highlight */
  activeId?: string | null
  /** Container width in px (0 = fill parent) */
  width?: number
  /** Manual scale override (0 = auto-fit) */
  scale?: number
  /** Coordinate origin from backend: 'top-left' (default) or 'bottom-left' (PDFMiner) */
  origin?: 'top-left' | 'bottom-left'
}>(), {
  highlights: () => [],
  activeId: null,
  width: 0,
  scale: 0,
  origin: 'top-left',
})

const emit = defineEmits<{
  (e: 'loaded', pageCount: number): void
  (e: 'highlight-click', id: string): void
  (e: 'error', message: string): void
}>()

// ─── Refs ────────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement>()
const pagesRef = ref<HTMLDivElement[]>([])

// PDF internal state
const pdfDoc = ref<any>(null)
const pageCount = ref(0)
const currentScale = ref(1)
const isLoading = ref(true)
const errorMsg = ref('')

// Per-page metadata: store each page's native size (in PDF points)
interface PageMeta {
  width: number   // in PDF points
  height: number  // in PDF points
}
const pageMetas = ref<PageMeta[]>([])

// ─── Computed: group highlights by page ──────────────────────────────────────
/** Group HighlightRect → HighlightItem[] per page for the overlay component */
const highlightsByPage = computed(() => {
  const map: Record<number, HighlightItem[]> = {}
  for (const h of props.highlights) {
    const item: HighlightItem = {
      id: h.id,
      x: h.coords.x,
      y: h.coords.y,
      w: h.coords.w,
      h: h.coords.h,
      color: h.color,
    }
    const arr = map[h.page] ?? (map[h.page] = [])
    arr.push(item)
  }
  return map
})

/** Helper to safely get page metadata */
function getPageMeta(pageNum: number): PageMeta {
  return pageMetas.value[pageNum - 1] ?? { width: 612, height: 792 }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  loadPdf()
})

onBeforeUnmount(() => {
  if (pdfDoc.value) {
    pdfDoc.value.destroy()
    pdfDoc.value = null
  }
})

// Re-load when src changes
watch(() => props.src, () => {
  loadPdf()
})

// ─── Core: Load PDF ──────────────────────────────────────────────────────────
async function loadPdf() {
  if (!props.src) return

  isLoading.value = true
  errorMsg.value = ''

  // Destroy previous doc
  if (pdfDoc.value) {
    pdfDoc.value.destroy()
    pdfDoc.value = null
  }

  try {
    // If the source is a URL string, fetch the bytes first.  This gives us
    // better control over errors (network/CORS) and avoids pdfjs attempting
    // to stream/parse an HTML error page and then blowing up with obscure
    // messages like “a.toHex is not a function”.
    let loadingTask: any
    if (typeof props.src === 'string') {
      const resp = await authFetch(resolveApiUrl(props.src), { mode: 'cors' })
      console.log('[PdfViewer] fetched URL', props.src, 'status', resp.status, 'headers', [...resp.headers.entries()])
      if (!resp.ok) {
        throw new Error(`PDF fetch failed: ${resp.status} ${resp.statusText}`)
      }
      const contentType = resp.headers.get('content-type')
      if (!contentType || !contentType.includes('pdf')) {
        console.warn('[PdfViewer] unexpected content-type', contentType)
      }
      const buf = await resp.arrayBuffer()
      const data = new Uint8Array(buf)
      loadingTask = pdfjsLib.getDocument({ data })
    } else {
      loadingTask = pdfjsLib.getDocument({ data: props.src })
    }

    const pdf = await loadingTask.promise
    pdfDoc.value = pdf
    pageCount.value = pdf.numPages

    // Collect page metas
    const metas: PageMeta[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: 1 })
      metas.push({ width: vp.width, height: vp.height })
    }
    pageMetas.value = metas

    emit('loaded', pdf.numPages)

    // Render all pages
    await nextTick()
    await renderAllPages(pdf)
    if (props.activeId) {
      await scrollToHighlightWhenReady(props.activeId)
    }
  } catch (err: any) {
    errorMsg.value = err?.message || 'Failed to load PDF'
    emit('error', errorMsg.value)
    console.error('[PdfViewer] Load error:', err)
  } finally {
    isLoading.value = false
  }
}

// ─── Render pages to canvas ──────────────────────────────────────────────────
async function renderAllPages(pdf: any) {
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i)

      // Determine scale
      let scale = props.scale || 0
      if (scale <= 0 && containerRef.value) {
        const containerWidth = props.width || containerRef.value.clientWidth
        const vp1 = page.getViewport({ scale: 1 })
        scale = (containerWidth - 4) / vp1.width // slight padding
      }
      if (scale <= 0) scale = 1
      currentScale.value = scale

      const viewport = page.getViewport({ scale })

      // Get the canvas inside the page wrapper
      const pageEl = pagesRef.value?.[i - 1]
      if (!pageEl) continue

      const canvas = pageEl.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) continue

      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      // Set the wrapper size to match
      pageEl.style.width = `${viewport.width}px`
      pageEl.style.height = `${viewport.height}px`

      await page.render({ canvasContext: ctx, viewport }).promise
    } catch (e: any) {
      console.error(`[PdfViewer] failed to render page ${i}:`, e)
      // stop further rendering and show user-facing error
      errorMsg.value = `Page ${i}: ${e?.message || 'render failure'}`
      emit('error', errorMsg.value)
      break
    }
  }
}

async function scrollToHighlightWhenReady(id: string, retries = 12) {
  await nextTick()
  for (let i = 0; i < retries; i++) {
    const el = containerRef.value?.querySelector(`[data-highlight-id="${id}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
}

watch(
  () => [props.activeId, isLoading.value, pageCount.value] as const,
  async ([id, loading]) => {
    if (!id || loading || pageCount.value < 1) return
    await scrollToHighlightWhenReady(id)
  },
  { immediate: true },
)

// ─── Scroll to a specific highlight ──────────────────────────────────────────
function scrollToHighlight(id: string) {
  const el = containerRef.value?.querySelector(`[data-highlight-id="${id}"]`) as HTMLElement | null
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// ─── Highlight click handler ─────────────────────────────────────────────────
function onOverlayClick(id: string) {
  emit('highlight-click', id)
}

// ─── Expose for parent usage ─────────────────────────────────────────────────
defineExpose({ scrollToHighlight })
</script>

<template>
  <!-- Container with scroll -->
  <div
    ref="containerRef"
    class="relative w-full h-full overflow-auto bg-gray-100 dark:bg-gray-900"
  >
    <!-- Loading Spinner -->
    <div
      v-if="isLoading"
      class="absolute inset-0 flex items-center justify-center z-20 bg-background/80 backdrop-blur-sm"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
        <span class="text-sm text-muted-foreground">Loading PDF…</span>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-if="errorMsg && !isLoading"
      class="absolute inset-0 flex flex-col items-center justify-center z-20"
    >
      <div class="text-center p-6 rounded-lg bg-destructive/10 border border-destructive/30 max-w-md">
        <p class="text-sm font-medium text-destructive">{{ errorMsg }}</p>
        <p class="mt-2 text-xs">
          <a
            v-if="typeof props.src === 'string'"
            :href="props.src"
            target="_blank"
            rel="noopener noreferrer"
            class="underline"
          >Open PDF in new tab</a>
        </p>
      </div>
    </div>

    <!-- Pages -->
    <div class="flex flex-col items-center gap-2 py-4">
      <div
        v-for="pageNum in pageCount"
        :key="pageNum"
        :ref="(el: any) => { if (el) pagesRef[pageNum - 1] = el }"
        class="relative shadow-md bg-white"
        :data-page="pageNum"
      >
        <!-- PDF canvas -->
        <canvas />

        <!-- Highlight Overlay (delegated to PdfHighlightOverlay) -->
        <PdfHighlightOverlay
          v-if="highlightsByPage[pageNum] && pageMetas[pageNum - 1]"
          :page-width="getPageMeta(pageNum).width"
          :page-height="getPageMeta(pageNum).height"
          :highlights="highlightsByPage[pageNum] ?? []"
          :origin="origin"
          :active-id="activeId"
          @click="onOverlayClick"
        />
      </div>
    </div>
  </div>
</template>
