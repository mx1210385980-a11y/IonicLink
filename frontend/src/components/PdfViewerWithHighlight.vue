<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MinusCircle,
  PlusCircle,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-vue-next'
import PdfHighlightOverlay from './PdfHighlightOverlay.vue'
import type { HighlightRect } from '@/types/pdf-highlight'
import type { HighlightItem } from './PdfHighlightOverlay.vue'
import { resolveApiUrl } from '@/lib/api'
import { authFetch } from '@/lib/session'

import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

function resolvePdfWorkerSrc(): string {
  if (typeof window === 'undefined') {
    return pdfjsWorkerUrl
  }
  const url = new URL(pdfjsWorkerUrl, window.location.origin)
  url.searchParams.set('pdfjs', pdfjsLib.version)
  return url.toString()
}

pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc()

function resolvePdfContentUrl(src: string): string {
  const normalized = String(src || '').trim()
  if (/\/api\/pdf\/\d+$/i.test(normalized)) {
    return `${normalized}/content`
  }
  return normalized
}

const props = withDefaults(defineProps<{
  src: string | Uint8Array | ArrayBuffer
  highlights?: HighlightRect[]
  activeId?: string | null
  width?: number
  scale?: number
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

interface PageMeta {
  width: number
  height: number
}

const containerRef = ref<HTMLDivElement>()
const stageRef = ref<HTMLDivElement>()
const pagesRef = ref<HTMLDivElement[]>([])
const pdfDoc = shallowRef<any>(null)
const pageCount = ref(0)
const currentScale = ref(1)
const currentPageNumber = ref(1)
const zoomScale = ref(1)
const isAutoScale = ref(true)
const isLoading = ref(true)
const errorMsg = ref('')
const authenticatedPdfBlobUrl = ref('')
const pdfFilename = ref('paper.pdf')
const pageMetas = ref<PageMeta[]>([])
const pageTexts = ref<Record<number, string>>({})
const searchOpen = ref(false)
const searchTerm = ref('')
const searchResults = ref<{ page: number; snippet: string; index: number }[]>([])
const activeSearchIndex = ref(0)

let renderRequestId = 0
let renderQueue = Promise.resolve()

function invalidateRenderQueue() {
  renderRequestId += 1
}

function queueRenderAllPages(pdf: any) {
  const requestId = ++renderRequestId
  renderQueue = renderQueue
    .catch(() => undefined)
    .then(async () => {
      if (requestId !== renderRequestId || pdfDoc.value !== pdf) return
      await renderAllPages(pdf, requestId)
    })
  return renderQueue
}

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

const zoomPercent = computed(() => Math.round(currentScale.value * 100))
const activeSearchResult = computed(() => searchResults.value[activeSearchIndex.value] ?? null)

function getPageMeta(pageNum: number): PageMeta {
  return pageMetas.value[pageNum - 1] ?? { width: 612, height: 792 }
}

onMounted(() => {
  loadPdf()
})

onBeforeUnmount(() => {
  invalidateRenderQueue()
  if (pdfDoc.value) {
    pdfDoc.value.destroy()
    pdfDoc.value = null
  }
  revokeAuthenticatedBlobUrl()
})

watch(() => props.src, () => {
  loadPdf()
})

watch(searchTerm, () => {
  rebuildSearchResults()
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

  const payload = await resp.json()
  pdfFilename.value = String(payload?.filename || payload?.name || 'paper.pdf')
  const dataB64 = String(payload?.data_b64 || '')
  if (!dataB64) {
    throw new Error('PDF content payload is empty.')
  }
  const binary = window.atob(dataB64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  revokeAuthenticatedBlobUrl()
  authenticatedPdfBlobUrl.value = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
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

async function downloadPdf() {
  try {
    if (!authenticatedPdfBlobUrl.value) {
      await fetchPdfBytes()
    }
    if (!authenticatedPdfBlobUrl.value) return
    const link = document.createElement('a')
    link.href = authenticatedPdfBlobUrl.value
    link.download = pdfFilename.value || 'paper.pdf'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } catch (err: any) {
    errorMsg.value = err?.message || 'Failed to download PDF'
    emit('error', errorMsg.value)
  }
}

async function loadPdf() {
  if (!props.src) return

  isLoading.value = true
  errorMsg.value = ''

  if (pdfDoc.value) {
    invalidateRenderQueue()
    pdfDoc.value.destroy()
    pdfDoc.value = null
  }

  try {
    const data = await fetchPdfBytes()
    const loadingTask = pdfjsLib.getDocument({ data })
    const pdf = await loadingTask.promise

    pdfDoc.value = markRaw(pdf)
    pageCount.value = pdf.numPages
    currentPageNumber.value = 1
    pagesRef.value = []

    const metas: PageMeta[] = []
    const textMap: Record<number, string> = {}
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      metas.push({ width: viewport.width, height: viewport.height })

      const textContent = await page.getTextContent().catch(() => null)
      if (textContent) {
        textMap[i] = textContent.items
          .map((item: any) => String(item?.str || ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
    }
    pageMetas.value = metas
    pageTexts.value = textMap
    rebuildSearchResults()

    emit('loaded', pdf.numPages)

    await nextTick()
    await queueRenderAllPages(pdfDoc.value)
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

async function renderAllPages(pdf: any, requestId = renderRequestId) {
  for (let i = 1; i <= pdf.numPages; i += 1) {
    if (requestId !== renderRequestId || pdfDoc.value !== pdf) return
    try {
      const page = await pdf.getPage(i)
      if (requestId !== renderRequestId || pdfDoc.value !== pdf) return
      const pageEl = pagesRef.value?.[i - 1]
      if (!pageEl) continue

      let scale = props.scale || 0
      if (scale <= 0 && isAutoScale.value && containerRef.value) {
        const stageWidth = stageRef.value ? stageRef.value.clientWidth : 0
        const containerWidth = props.width || stageWidth || containerRef.value.clientWidth
        const viewportAtOne = page.getViewport({ scale: 1 })
        scale = Math.min(1.35, Math.max(0.55, (containerWidth - 96) / viewportAtOne.width))
      }
      if (scale <= 0) scale = zoomScale.value
      currentScale.value = scale
      zoomScale.value = scale

      const viewport = page.getViewport({ scale })
      const canvas = pageEl.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) continue

      const ctx = canvas.getContext('2d')
      if (!ctx) continue

      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      pageEl.style.width = `${viewport.width}px`
      pageEl.style.height = `${viewport.height}px`

      await page.render({ canvasContext: ctx, viewport }).promise
      if (requestId !== renderRequestId || pdfDoc.value !== pdf) return
    } catch (err: any) {
      if (requestId !== renderRequestId || pdfDoc.value !== pdf) return
      console.error(`[PdfViewer] failed to render page ${i}:`, err)
      errorMsg.value = `Page ${i}: ${err?.message || 'render failure'}`
      emit('error', errorMsg.value)
      break
    }
  }
}

function clampPage(page: number) {
  return Math.min(Math.max(1, page), pageCount.value || 1)
}

function scrollElementIntoPdfView(el: HTMLElement, block: 'start' | 'center' = 'start') {
  const container = containerRef.value
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const targetRect = el.getBoundingClientRect()
  const centerOffset = (container.clientHeight - targetRect.height) / 2
  const offset = block === 'center' ? centerOffset : 12
  const top = container.scrollTop + targetRect.top - containerRect.top - offset

  container.scrollTo({
    top: Math.max(0, top),
    behavior: 'smooth',
  })
}

async function goToPage(page: number) {
  currentPageNumber.value = clampPage(page)
  await nextTick()
  const pageEl = pagesRef.value[currentPageNumber.value - 1]
  if (pageEl) scrollElementIntoPdfView(pageEl, 'start')
}

async function previousPage() {
  await goToPage(currentPageNumber.value - 1)
}

async function nextPage() {
  await goToPage(currentPageNumber.value + 1)
}

async function rerenderPdf() {
  if (!pdfDoc.value) return
  await nextTick()
  await queueRenderAllPages(pdfDoc.value)
}

async function zoomBy(delta: number) {
  isAutoScale.value = false
  zoomScale.value = Math.min(2.5, Math.max(0.55, currentScale.value + delta))
  await rerenderPdf()
  await goToPage(currentPageNumber.value)
}

async function setPageFromInput(event: Event) {
  const input = event.target as HTMLInputElement
  const page = Number(input.value)
  if (Number.isFinite(page)) {
    await goToPage(page)
  }
  input.value = String(currentPageNumber.value)
}

function updateCurrentPageFromScroll() {
  const container = containerRef.value
  if (!container || pagesRef.value.length < 1) return
  const containerTop = container.getBoundingClientRect().top
  let bestPage = currentPageNumber.value
  let bestDistance = Number.POSITIVE_INFINITY

  pagesRef.value.forEach((pageEl, index) => {
    if (!pageEl) return
    const distance = Math.abs(pageEl.getBoundingClientRect().top - containerTop - 24)
    if (distance < bestDistance) {
      bestDistance = distance
      bestPage = index + 1
    }
  })
  currentPageNumber.value = bestPage
}

function rebuildSearchResults() {
  const query = searchTerm.value.trim().toLowerCase()
  if (!query) {
    searchResults.value = []
    activeSearchIndex.value = 0
    return
  }

  const results: { page: number; snippet: string; index: number }[] = []
  for (const [pageKey, text] of Object.entries(pageTexts.value)) {
    const haystack = text.toLowerCase()
    let index = haystack.indexOf(query)
    let guard = 0
    while (index >= 0 && guard < 50) {
      const start = Math.max(0, index - 72)
      const end = Math.min(text.length, index + query.length + 96)
      results.push({
        page: Number(pageKey),
        snippet: text.slice(start, end).trim(),
        index,
      })
      index = haystack.indexOf(query, index + query.length)
      guard += 1
    }
  }
  searchResults.value = results.slice(0, 500)
  activeSearchIndex.value = 0
}

async function submitSearch() {
  rebuildSearchResults()
  if (searchResults.value[0]) {
    await goToPage(searchResults.value[0].page)
  }
}

async function stepSearch(delta: number) {
  if (!searchResults.value.length) return
  activeSearchIndex.value = (activeSearchIndex.value + delta + searchResults.value.length) % searchResults.value.length
  const result = searchResults.value[activeSearchIndex.value]
  if (result) {
    await goToPage(result.page)
  }
}

function clearSearch() {
  searchTerm.value = ''
  searchResults.value = []
  activeSearchIndex.value = 0
}

async function scrollToHighlightWhenReady(id: string, retries = 12) {
  await nextTick()
  for (let i = 0; i < retries; i += 1) {
    const el = containerRef.value?.querySelector(`[data-highlight-id="${id}"]`) as HTMLElement | null
    if (el) {
      scrollElementIntoPdfView(el, 'center')
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

function scrollToHighlight(id: string) {
  const el = containerRef.value?.querySelector(`[data-highlight-id="${id}"]`) as HTMLElement | null
  if (el) {
    scrollElementIntoPdfView(el, 'center')
  }
}

function onOverlayClick(id: string) {
  emit('highlight-click', id)
}

defineExpose({ scrollToHighlight })
</script>

<template>
  <div class="grid h-full w-full grid-rows-[3.75rem_minmax(0,1fr)] bg-slate-100 text-slate-900">
    <div
      data-testid="pdf-toolbar"
      class="z-30 border-b border-slate-200 bg-white/95 px-5 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
    >
      <div class="mx-auto grid h-full w-full max-w-[58rem] grid-cols-[auto_minmax(2rem,1fr)_auto_minmax(2rem,1fr)_auto] items-center">
        <div
          data-testid="pdf-page-controls"
          class="flex items-center justify-start gap-3"
        >
          <button
            type="button"
            data-testid="pdf-page-prev"
            class="grid h-9 w-9 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
            :disabled="currentPageNumber <= 1"
            @click="previousPage"
          >
            <ChevronLeft class="h-5 w-5" />
          </button>
          <input
            data-testid="pdf-page-current"
            class="h-9 w-11 rounded-md border border-slate-200 bg-white text-center text-sm font-semibold text-slate-900 shadow-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
            :value="currentPageNumber"
            inputmode="numeric"
            @change="setPageFromInput"
            @keyup.enter="setPageFromInput"
          >
          <span class="min-w-6 text-sm font-medium text-slate-600">{{ pageCount || 0 }}</span>
          <button
            type="button"
            data-testid="pdf-page-next"
            class="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
            :disabled="currentPageNumber >= pageCount"
            @click="nextPage"
          >
            <ChevronRight class="h-5 w-5" />
          </button>
        </div>

        <div />

        <div
          data-testid="pdf-zoom-controls"
          class="flex justify-center"
        >
          <div class="flex h-9 items-center gap-3 rounded-md bg-slate-100 px-3 text-sm font-semibold text-slate-700">
            <span class="w-14 text-center">{{ zoomPercent }} %</span>
            <button
              type="button"
              data-testid="pdf-zoom-out"
              class="text-slate-500 transition hover:text-slate-900"
              @click="zoomBy(-0.12)"
            >
              <MinusCircle class="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid="pdf-zoom-in"
              class="text-slate-500 transition hover:text-slate-900"
              @click="zoomBy(0.12)"
            >
              <PlusCircle class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div />

        <div
          data-testid="pdf-toolbar-actions"
          class="flex items-center justify-end gap-3"
        >
          <button
            type="button"
            data-testid="pdf-search-toggle"
            class="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:border-slate-500"
            :class="searchOpen ? 'border-slate-700 ring-2 ring-slate-200' : ''"
            @click="searchOpen = !searchOpen"
          >
            <Search class="h-5 w-5" />
          </button>
          <button
            type="button"
            data-testid="pdf-download"
            class="grid h-10 w-10 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            @click="downloadPdf"
          >
            <Download class="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>

    <div
      ref="stageRef"
      data-testid="pdf-stage"
      class="grid min-h-0"
      :class="searchOpen ? 'grid-cols-[minmax(0,1fr)_24rem]' : 'grid-cols-[minmax(0,1fr)]'"
    >
      <div
        ref="containerRef"
        data-testid="pdf-scroll-region"
        class="relative h-full min-h-0 overflow-auto bg-slate-100"
        @scroll.passive="updateCurrentPageFromScroll"
      >
        <div
          v-if="isLoading"
          class="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur-sm"
        >
          <div class="flex flex-col items-center gap-3">
            <div class="h-8 w-8 animate-spin rounded-full border-4 border-teal-100 border-t-teal-700" />
            <span class="text-sm text-slate-500">Loading PDF...</span>
          </div>
        </div>

        <div
          v-if="errorMsg && !isLoading"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center"
        >
          <div class="max-w-md rounded-lg border border-amber-200 bg-white p-6 text-center shadow-sm">
            <p class="text-sm font-medium text-slate-900">{{ errorMsg }}</p>
            <div class="mt-3 text-sm">
              <button
                v-if="typeof props.src === 'string'"
                type="button"
                class="font-semibold text-teal-700 underline"
                @click="openPdfInNewTab"
              >Open PDF in new tab</button>
            </div>
          </div>
        </div>

        <div class="flex flex-col items-center gap-3 py-2">
          <div
            v-for="pageNum in pageCount"
            :key="pageNum"
            :ref="(el: any) => { if (el) pagesRef[pageNum - 1] = el }"
            class="relative bg-white shadow-md ring-1 ring-slate-200"
            :data-page="pageNum"
          >
            <canvas />

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

      <aside
        v-if="searchOpen"
        data-testid="pdf-search-panel"
        class="min-h-0 overflow-auto border-l border-slate-200 bg-white px-5 py-4"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-300 px-3 focus-within:border-slate-700">
            <Search class="h-4 w-4 flex-none text-slate-400" />
            <input
              v-model="searchTerm"
              class="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Search"
              @keyup.enter="submitSearch"
            >
            <button
              v-if="searchTerm"
              type="button"
              class="text-slate-400 hover:text-slate-700"
              @click="clearSearch"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            class="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <SlidersHorizontal class="h-4 w-4" />
          </button>
        </div>

        <div class="mt-5 border-t border-slate-200 pt-5">
          <div class="flex items-center justify-between">
            <p class="text-sm text-slate-600">
              <template v-if="searchTerm">{{ searchResults.length }} results found</template>
              <template v-else>Search within this paper</template>
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                :disabled="!searchResults.length"
                @click="stepSearch(-1)"
              >
                <ChevronLeft class="h-5 w-5" />
              </button>
              <button
                type="button"
                class="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                :disabled="!searchResults.length"
                @click="stepSearch(1)"
              >
                <ChevronRight class="h-5 w-5" />
              </button>
            </div>
          </div>

          <div v-if="activeSearchResult" class="mt-4 text-sm font-medium text-slate-500">
            Page {{ activeSearchResult.page }}
          </div>

          <div class="mt-3 space-y-3">
            <button
              v-for="(result, index) in searchResults"
              :key="`${result.page}-${result.index}`"
              type="button"
              class="w-full rounded-md border bg-white p-3 text-left text-sm leading-relaxed text-slate-700 shadow-sm transition hover:border-slate-500"
              :class="index === activeSearchIndex ? 'border-slate-700 bg-slate-50' : 'border-slate-200'"
              @click="activeSearchIndex = index; goToPage(result.page)"
            >
              {{ result.snippet }}
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
