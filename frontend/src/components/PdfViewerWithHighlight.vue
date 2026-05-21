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
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick, markRaw } from 'vue'
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
  (e: 'rendered'): void
  (e: 'highlight-click', id: string): void
  (e: 'error', message: string): void
}>()

// ─── Refs ────────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement>()
const pagesRef = ref<HTMLDivElement[]>([])

// PDF internal state
const pdfDoc = shallowRef<any>(null)
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

type PdfCropBox = [number, number, number, number]

type EvidenceCaptureRequest = {
  page?: number | null
  terms?: string[]
  fallbackId?: string | null
  padding?: number
  minWidth?: number
  minHeight?: number
}

type EvidenceCaptureResult = {
  imageUrl: string
  matchedText?: string
  precise: boolean
}

type TextBox = {
  text: string
  bbox: PdfCropBox
}

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
    pdfDoc.value = markRaw(pdf)
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
    emit('rendered')
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

      const canvas = pageEl?.querySelector('canvas') as HTMLCanvasElement | null
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

async function scrollToPage(pageNum: number, behavior: ScrollBehavior = 'smooth') {
  if (!Number.isFinite(pageNum) || pageCount.value < 1) return
  const targetPage = Math.min(pageCount.value, Math.max(1, Math.trunc(pageNum)))
  await nextTick()
  const pageEl = pagesRef.value?.[targetPage - 1]
    || containerRef.value?.querySelector(`[data-page="${targetPage}"]`) as HTMLElement | null
  if (pageEl) {
    pageEl.scrollIntoView({ behavior, block: 'start' })
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

function normalizeCaptureText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/\u00b5/g, 'μ')
    .replace(/[−–—]/g, '-')
    .replace(/[⁰₀]/g, '0')
    .replace(/[¹₁]/g, '1')
    .replace(/[²₂]/g, '2')
    .replace(/[³₃]/g, '3')
    .replace(/[⁴₄]/g, '4')
    .replace(/[⁵₅]/g, '5')
    .replace(/[⁶₆]/g, '6')
    .replace(/[⁷₇]/g, '7')
    .replace(/[⁸₈]/g, '8')
    .replace(/[⁹₉]/g, '9')
    .replace(/[⁻₋]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLooseCaptureText(value: string) {
  return normalizeCaptureText(value).replace(/[^a-z0-9.+-]+/g, '')
}

function captureTermMatches(text: string, term: string) {
  const normalizedText = normalizeCaptureText(text)
  const normalizedTerm = normalizeCaptureText(term)
  if (!normalizedText || !normalizedTerm) return false
  if (normalizedText.includes(normalizedTerm)) return true
  const looseTerm = normalizeLooseCaptureText(normalizedTerm)
  return looseTerm.length >= 2 && normalizeLooseCaptureText(normalizedText).includes(looseTerm)
}

function unionBoxes(boxes: PdfCropBox[]): PdfCropBox | null {
  if (!boxes.length) return null
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ]
}

function capturePageRegion(
  pageNum: number,
  bbox: PdfCropBox,
  options: {
    padding?: number
    minWidth?: number
    minHeight?: number
    precise?: boolean
    matchedText?: string
  } = {},
): EvidenceCaptureResult | null {
  const pageEl = pagesRef.value?.[pageNum - 1]
    || containerRef.value?.querySelector(`[data-page="${pageNum}"]`) as HTMLElement | null
  const canvas = pageEl?.querySelector('canvas') as HTMLCanvasElement | null
  if (!pageEl || !canvas || !canvas.width || !canvas.height) return null

  const meta = getPageMeta(pageNum)
  const [rawX0, rawY0, rawX1, rawY1] = bbox.map((value) => Number(value)) as PdfCropBox
  if (![rawX0, rawY0, rawX1, rawY1].every(Number.isFinite)) return null

  const targetX0 = Math.max(0, Math.min(rawX0, rawX1))
  const targetY0 = Math.max(0, Math.min(rawY0, rawY1))
  const targetW = Math.max(1, Math.abs(rawX1 - rawX0))
  const targetH = Math.max(1, Math.abs(rawY1 - rawY0))
  const padding = options.padding ?? 42
  const minWidth = options.minWidth ?? 190
  const minHeight = options.minHeight ?? 82
  const centerX = targetX0 + targetW / 2
  const centerY = targetY0 + targetH / 2
  const cropWpt = Math.min(meta.width, Math.max(targetW + padding * 2, minWidth))
  const cropHpt = Math.min(meta.height, Math.max(targetH + padding * 1.7, minHeight))
  const x0pt = Math.max(0, Math.min(Math.max(0, meta.width - cropWpt), centerX - cropWpt / 2))
  const y0pt = Math.max(0, Math.min(Math.max(0, meta.height - cropHpt), centerY - cropHpt / 2))
  const xScale = canvas.width / meta.width
  const yScale = canvas.height / meta.height
  const sx = Math.max(0, Math.floor(x0pt * xScale))
  const sy = Math.max(0, Math.floor(y0pt * yScale))
  const sw = Math.min(canvas.width - sx, Math.ceil(cropWpt * xScale))
  const sh = Math.min(canvas.height - sy, Math.ceil(cropHpt * yScale))
  if (sw < 2 || sh < 2) return null

  const output = document.createElement('canvas')
  output.width = sw
  output.height = sh
  const ctx = output.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)

  const hx = (targetX0 - x0pt) * xScale
  const hy = (targetY0 - y0pt) * yScale
  const hw = targetW * xScale
  const hh = targetH * yScale
  ctx.save()
  ctx.fillStyle = options.precise === false ? 'rgba(14, 165, 233, 0.10)' : 'rgba(20, 184, 166, 0.16)'
  ctx.strokeStyle = options.precise === false ? 'rgba(2, 132, 199, 0.62)' : 'rgba(13, 148, 136, 0.74)'
  ctx.lineWidth = Math.max(1.5, Math.min(3, output.width * 0.0038))
  ctx.setLineDash(options.precise === false ? [6, 5] : [])
  ctx.fillRect(hx, hy, hw, hh)
  ctx.strokeRect(hx, hy, hw, hh)
  ctx.restore()

  return {
    imageUrl: output.toDataURL('image/png'),
    matchedText: options.matchedText,
    precise: options.precise !== false,
  }
}

async function findTextEvidenceBox(pageNum: number, rawTerms: string[]): Promise<{ bbox: PdfCropBox; matchedText: string } | null> {
  const page = await pdfDoc.value?.getPage?.(pageNum)
  if (!page) return null
  const terms = [...new Set(rawTerms.map((term) => String(term || '').trim()).filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length)
    .slice(0, 24)
  if (!terms.length) return null

  const viewport = page.getViewport({ scale: 1 })
  const textContent = await page.getTextContent()
  const items: TextBox[] = (textContent?.items || [])
    .map((item: any): TextBox | null => {
      const text = String(item?.str || '').trim()
      if (!text) return null
      const tx = (pdfjsLib as any).Util.transform(viewport.transform, item.transform)
      const x = Number(tx[4])
      const baselineY = Number(tx[5])
      const height = Math.max(
        5,
        Number(item.height || 0),
        Math.abs(Number(tx[3] || 0)),
        Math.abs(Number(tx[2] || 0)),
      )
      const width = Math.max(3, Number(item.width || 0), text.length * height * 0.42)
      if (![x, baselineY, height, width].every(Number.isFinite)) return null
      return {
        text,
        bbox: [x, Math.max(0, baselineY - height), x + width, baselineY + Math.max(2, height * 0.18)],
      }
    })
    .filter(Boolean) as TextBox[]

  for (const term of terms) {
    const item = items.find((entry) => captureTermMatches(entry.text, term))
    if (item) return { bbox: item.bbox, matchedText: item.text }
  }

  const sorted = [...items].sort((a, b) => {
    const dy = a.bbox[1] - b.bbox[1]
    return Math.abs(dy) > 3 ? dy : a.bbox[0] - b.bbox[0]
  })
  const lines: TextBox[] = []
  for (const item of sorted) {
    const centerY = (item.bbox[1] + item.bbox[3]) / 2
    const line = lines.find((candidate) => Math.abs(((candidate.bbox[1] + candidate.bbox[3]) / 2) - centerY) < 4)
    if (!line) {
      lines.push({ text: item.text, bbox: item.bbox })
      continue
    }
    line.text = `${line.text} ${item.text}`.trim()
    line.bbox = unionBoxes([line.bbox, item.bbox]) || line.bbox
  }

  for (const term of terms) {
    const line = lines.find((entry) => captureTermMatches(entry.text, term))
    if (line) return { bbox: line.bbox, matchedText: line.text }
  }

  return null
}

async function captureHighlight(id: string, padding = 42, minWidth = 190, minHeight = 82): Promise<string | null> {
  await nextTick()
  const highlight = (props.highlights || []).find((item) => item.id === id)
  if (!highlight) return null

  const meta = getPageMeta(highlight.page)
  const sourceX = Number(highlight.coords.x)
  const sourceY = Number(highlight.coords.y)
  const sourceW = Math.max(1, Number(highlight.coords.w))
  const sourceH = Math.max(1, Number(highlight.coords.h))
  if (![sourceX, sourceY, sourceW, sourceH].every(Number.isFinite)) return null

  const yTop = props.origin === 'bottom-left'
    ? meta.height - sourceY - sourceH
    : sourceY
  return capturePageRegion(
    highlight.page,
    [sourceX, yTop, sourceX + sourceW, yTop + sourceH],
    { padding, minWidth, minHeight, precise: false },
  )?.imageUrl || null
}

async function captureEvidenceTarget(request: EvidenceCaptureRequest): Promise<EvidenceCaptureResult | null> {
  await nextTick()
  const pageNum = Number(request.page || 0)
  if (Number.isFinite(pageNum) && pageNum > 0 && request.terms?.length) {
    const textHit = await findTextEvidenceBox(Math.trunc(pageNum), request.terms).catch((error) => {
      console.warn('[PdfViewer] text evidence lookup failed; falling back to bbox crop.', error)
      return null
    })
    if (textHit) {
      return capturePageRegion(Math.trunc(pageNum), textHit.bbox, {
        padding: request.padding ?? 62,
        minWidth: request.minWidth ?? 360,
        minHeight: request.minHeight ?? 150,
        precise: true,
        matchedText: textHit.matchedText,
      })
    }
  }

  if (request.fallbackId) {
    const imageUrl = await captureHighlight(
      request.fallbackId,
      request.padding ?? 62,
      request.minWidth ?? 360,
      request.minHeight ?? 150,
    )
    return imageUrl ? { imageUrl, precise: false } : null
  }

  return null
}

// ─── Highlight click handler ─────────────────────────────────────────────────
function onOverlayClick(id: string) {
  emit('highlight-click', id)
}

// ─── Expose for parent usage ─────────────────────────────────────────────────
defineExpose({ captureEvidenceTarget, captureHighlight, scrollToHighlight, scrollToPage })
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
