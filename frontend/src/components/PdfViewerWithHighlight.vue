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

function resolvePdfContentUrl(src: string): string {
  const normalized = String(src || '').trim()
  return normalized
}

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
const authenticatedPdfBlobUrl = ref('')

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

const highlightSignature = computed(() => {
  return (props.highlights || [])
    .map((item) => {
      const { id, page, coords } = item
      return [
        id,
        page,
        coords?.x,
        coords?.y,
        coords?.w,
        coords?.h,
      ].join(':')
    })
    .join('|')
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
  revokeAuthenticatedBlobUrl()
})

// Re-load when src changes
watch(() => props.src, () => {
  loadPdf()
})

function revokeAuthenticatedBlobUrl() {
  if (!authenticatedPdfBlobUrl.value) return
  URL.revokeObjectURL(authenticatedPdfBlobUrl.value)
  authenticatedPdfBlobUrl.value = ''
}

async function fetchPdfBytes(): Promise<Uint8Array> {
  if (typeof props.src !== 'string') {
    return props.src instanceof Uint8Array ? props.src : new Uint8Array(props.src)
  }

  const pdfContentPath = resolvePdfContentUrl(props.src)
  const resp = await authFetch(resolveApiUrl(pdfContentPath), { mode: 'cors' })

  if (resp.status === 401) {
    throw new Error('Not authenticated. Please sign in again.')
  }
  if (resp.status === 403) {
    throw new Error('You do not have access to this PDF.')
  }
  if (!resp.ok) {
    throw new Error(`PDF fetch failed: ${resp.status} ${resp.statusText}`)
  }

  let bytes: Uint8Array
  const contentType = String(resp.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('application/json')) {
    const payload = await resp.json()
    const dataB64 = String(payload?.data_b64 || '')
    if (!dataB64) {
      throw new Error('PDF content payload is empty.')
    }
    const binary = window.atob(dataB64)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
  } else {
    bytes = new Uint8Array(await resp.arrayBuffer())
  }
  if (!bytes.byteLength) {
    throw new Error('PDF content is empty.')
  }
  revokeAuthenticatedBlobUrl()
  const pdfBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(pdfBuffer).set(bytes)
  authenticatedPdfBlobUrl.value = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }))
  return bytes
}

async function openPdfInNewTab() {
  try {
    if (!authenticatedPdfBlobUrl.value) {
      await fetchPdfBytes()
    }
    if (authenticatedPdfBlobUrl.value) {
      window.open(authenticatedPdfBlobUrl.value, '_blank', 'noopener,noreferrer')
    }
  } catch (err: any) {
    errorMsg.value = err?.message || 'Failed to open PDF'
    emit('error', errorMsg.value)
  }
}

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
    const data = await fetchPdfBytes()
    const loadingTask = pdfjsLib.getDocument({ data })

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
      const outputScale = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1))

      // Get the canvas inside the page wrapper
      const pageEl = pagesRef.value?.[i - 1]
      if (!pageEl) continue

      const canvas = pageEl.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) continue

      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      // Set the wrapper size to match
      pageEl.style.width = `${viewport.width}px`
      pageEl.style.height = `${viewport.height}px`

      await page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      }).promise
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
  () => [props.activeId, highlightSignature.value, isLoading.value, pageCount.value] as const,
  async ([id, _signature, loading]) => {
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
        <div class="mt-2 text-xs">
          <button
            v-if="typeof props.src === 'string'"
            type="button"
            class="underline"
            @click="openPdfInNewTab"
          >Open PDF in new tab</button>
        </div>
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
