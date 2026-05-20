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
const pdfjsWorkerSrc = `${pdfjsWorkerUrl}?v=mjs-worker-20260518`
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc

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
const renderedPages = ref<Set<number>>(new Set())
const renderingPages = ref<Set<number>>(new Set())
const pageRenderErrors = ref<Record<number, string>>({})
const renderTasks = new Map<number, Promise<void>>()
let pageObserver: IntersectionObserver | null = null
let loadGeneration = 0

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

function updatePageSet(target: typeof renderedPages, pageNum: number, include: boolean) {
  const next = new Set(target.value)
  if (include) next.add(pageNum)
  else next.delete(pageNum)
  target.value = next
}

function clampPage(pageNum: number): number {
  if (!Number.isFinite(pageNum) || pageCount.value < 1) return 1
  return Math.min(pageCount.value, Math.max(1, Math.trunc(pageNum)))
}

function pageForHighlight(id?: string | null): number | null {
  if (!id) return null
  const target = props.highlights.find((item) => item.id === id)
  return target?.page ? Number(target.page) : null
}

function preferredInitialPage(): number {
  return clampPage(pageForHighlight(props.activeId) ?? props.highlights[0]?.page ?? 1)
}

function scaleForMeta(meta: PageMeta): number {
  const explicitScale = Number(props.scale || 0)
  if (explicitScale > 0) return explicitScale
  const containerWidth = props.width || containerRef.value?.clientWidth || 0
  if (!containerWidth || !meta.width) return 1
  return Math.max(0.45, Math.min(2.1, (containerWidth - 28) / meta.width))
}

function pageSize(pageNum: number) {
  const meta = getPageMeta(pageNum)
  const scale = scaleForMeta(meta)
  return {
    width: Math.max(1, Math.floor(meta.width * scale)),
    height: Math.max(1, Math.floor(meta.height * scale)),
  }
}

function pageStyle(pageNum: number) {
  const size = pageSize(pageNum)
  return {
    width: `${size.width}px`,
    minHeight: `${size.height}px`,
  }
}

function isPageRendered(pageNum: number): boolean {
  return renderedPages.value.has(pageNum)
}

function isPageRendering(pageNum: number): boolean {
  return renderingPages.value.has(pageNum)
}

function pageError(pageNum: number): string {
  return pageRenderErrors.value[pageNum] || ''
}

function setPageRef(el: any, pageNum: number) {
  if (!el) return
  pagesRef.value[pageNum - 1] = el as HTMLDivElement
}

function teardownPageObserver() {
  pageObserver?.disconnect()
  pageObserver = null
}

function setupPageObserver() {
  teardownPageObserver()
  if (!containerRef.value || !pageCount.value) return

  if (typeof IntersectionObserver === 'undefined') {
    const initial = preferredInitialPage()
    ;[initial, 1, 2, 3].forEach((pageNum) => {
      if (pageNum >= 1 && pageNum <= pageCount.value) void renderPage(pageNum)
    })
    return
  }

  pageObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const pageNum = Number((entry.target as HTMLElement).dataset.page || 0)
        if (pageNum) void renderPage(pageNum)
      }
    },
    {
      root: containerRef.value,
      rootMargin: '900px 0px',
      threshold: 0.01,
    },
  )

  for (const pageEl of pagesRef.value) {
    if (pageEl) pageObserver.observe(pageEl)
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  loadPdf()
})

onBeforeUnmount(() => {
  loadGeneration += 1
  teardownPageObserver()
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

  const generation = loadGeneration + 1
  loadGeneration = generation
  isLoading.value = true
  errorMsg.value = ''
  pageRenderErrors.value = {}
  renderedPages.value = new Set()
  renderingPages.value = new Set()
  renderTasks.clear()
  pagesRef.value = []
  teardownPageObserver()

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
    if (generation !== loadGeneration) return
    const loadingTask = pdfjsLib.getDocument({ data })

    const pdf = await loadingTask.promise
    if (generation !== loadGeneration) {
      pdf.destroy?.()
      return
    }
    pdfDoc.value = pdf
    pageCount.value = pdf.numPages

    // Read the first page only for initial layout. Individual page metas are
    // refined lazily when each page is rendered.
    const firstPage = await pdf.getPage(1)
    const firstViewport = firstPage.getViewport({ scale: 1 })
    const firstMeta = { width: firstViewport.width, height: firstViewport.height }
    pageMetas.value = Array.from({ length: pdf.numPages }, () => ({ ...firstMeta }))
    currentScale.value = scaleForMeta(firstMeta)

    emit('loaded', pdf.numPages)

    await nextTick()
    setupPageObserver()
    const initialPage = preferredInitialPage()
    await renderPage(initialPage, generation)
    if (initialPage !== 1) void renderPage(1, generation)
    if (props.activeId) {
      await scrollToHighlightWhenReady(props.activeId)
    }
  } catch (err: any) {
    if (generation !== loadGeneration) return
    errorMsg.value = err?.message || 'Failed to load PDF'
    emit('error', errorMsg.value)
    console.error('[PdfViewer] Load error:', err)
  } finally {
    if (generation === loadGeneration) {
      isLoading.value = false
    }
  }
}

// ─── Render pages to canvas ──────────────────────────────────────────────────
async function renderPage(pageNum: number, generation = loadGeneration) {
  const targetPage = clampPage(pageNum)
  if (!pdfDoc.value || !targetPage || renderedPages.value.has(targetPage)) return
  const existingTask = renderTasks.get(targetPage)
  if (existingTask) return existingTask

  const task = (async () => {
    updatePageSet(renderingPages, targetPage, true)
    try {
      const pdf = pdfDoc.value
      if (!pdf || generation !== loadGeneration) return

      const page = await pdf.getPage(targetPage)
      if (generation !== loadGeneration) return

      const nativeViewport = page.getViewport({ scale: 1 })
      const meta = { width: nativeViewport.width, height: nativeViewport.height }
      pageMetas.value[targetPage - 1] = meta

      const scale = scaleForMeta(meta)
      currentScale.value = scale
      const viewport = page.getViewport({ scale })
      const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))

      await nextTick()
      const pageEl = pagesRef.value?.[targetPage - 1]
      const canvas = pageEl?.querySelector('canvas') as HTMLCanvasElement | null
      const ctx = canvas?.getContext('2d')
      if (!pageEl || !canvas || !ctx) return

      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      pageEl.style.width = `${viewport.width}px`
      pageEl.style.minHeight = `${viewport.height}px`

      await page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      }).promise

      if (generation !== loadGeneration) return
      updatePageSet(renderedPages, targetPage, true)
      const nextErrors = { ...pageRenderErrors.value }
      delete nextErrors[targetPage]
      pageRenderErrors.value = nextErrors
    } catch (e: any) {
      if (generation !== loadGeneration) return
      const message = e?.message || 'render failure'
      console.error(`[PdfViewer] failed to render page ${targetPage}:`, e)
      pageRenderErrors.value = { ...pageRenderErrors.value, [targetPage]: message }
      emit('error', `Page ${targetPage}: ${message}`)
    } finally {
      updatePageSet(renderingPages, targetPage, false)
      renderTasks.delete(targetPage)
    }
  })()

  renderTasks.set(targetPage, task)
  return task
}

async function scrollToHighlightWhenReady(id: string, retries = 12) {
  const targetPage = pageForHighlight(id)
  if (targetPage) {
    await scrollToPage(targetPage, 'auto')
    await renderPage(targetPage)
  }
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

async function scrollToPage(pageNum: number, behavior: ScrollBehavior = 'smooth') {
  if (!Number.isFinite(pageNum) || pageCount.value < 1) return
  const targetPage = clampPage(pageNum)
  await nextTick()
  const pageEl = pagesRef.value?.[targetPage - 1]
    || containerRef.value?.querySelector(`[data-page="${targetPage}"]`) as HTMLElement | null
  if (pageEl) {
    pageEl.scrollIntoView({ behavior, block: 'start' })
  }
  void renderPage(targetPage)
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
  const targetPage = pageForHighlight(id)
  if (targetPage) {
    void scrollToHighlightWhenReady(id)
    return
  }
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
defineExpose({ scrollToHighlight, scrollToPage })
</script>

<template>
  <!-- Container with scroll -->
  <div
    ref="containerRef"
    class="relative h-full w-full overflow-auto bg-slate-100 dark:bg-slate-950"
  >
    <!-- Loading Spinner -->
    <div
      v-if="isLoading"
      class="absolute inset-0 z-20 flex items-center justify-center bg-white/78 backdrop-blur-sm dark:bg-slate-950/78"
    >
      <div class="flex flex-col items-center gap-3">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
        <span class="text-sm font-medium text-slate-500 dark:text-slate-400">Loading PDF…</span>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-if="errorMsg && !isLoading"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center"
    >
      <div class="max-w-md rounded-md border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
        <p class="text-sm font-semibold text-rose-700 dark:text-rose-300">{{ errorMsg }}</p>
        <div class="mt-2 text-xs">
          <button
            v-if="typeof props.src === 'string'"
            type="button"
            class="font-semibold text-slate-700 underline underline-offset-4 dark:text-slate-200"
            @click="openPdfInNewTab"
          >Open PDF in new tab</button>
        </div>
      </div>
    </div>

    <!-- Pages -->
    <div class="flex flex-col items-center gap-3 py-4">
      <div
        v-for="pageNum in pageCount"
        :key="pageNum"
        :ref="(el: any) => setPageRef(el, pageNum)"
        class="relative overflow-hidden rounded-sm bg-white shadow-[0_12px_34px_-26px_rgba(15,23,42,0.58)] ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800"
        :data-page="pageNum"
        :style="pageStyle(pageNum)"
      >
        <!-- PDF canvas -->
        <canvas
          class="block transition-opacity duration-200"
          :class="isPageRendered(pageNum) ? 'opacity-100' : 'opacity-0'"
        />

        <div
          v-if="!isPageRendered(pageNum)"
          class="absolute inset-0 flex items-center justify-center bg-white text-xs font-semibold text-slate-400 dark:bg-slate-900 dark:text-slate-500"
        >
          <div class="flex items-center gap-2">
            <span
              v-if="isPageRendering(pageNum) && !pageError(pageNum)"
              class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500 dark:border-slate-700 dark:border-t-slate-300"
            />
            <span>{{ pageError(pageNum) ? `Page ${pageNum}: ${pageError(pageNum)}` : `Page ${pageNum}` }}</span>
          </div>
        </div>

        <!-- Highlight Overlay (delegated to PdfHighlightOverlay) -->
        <PdfHighlightOverlay
          v-if="isPageRendered(pageNum) && highlightsByPage[pageNum] && pageMetas[pageNum - 1]"
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
