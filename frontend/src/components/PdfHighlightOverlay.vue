<script setup lang="ts">
/**
 * PdfHighlightOverlay.vue
 * ─────────────────────────────────────────────────────────────
 * Renders highlight boxes on top of a PDF page using CSS percentages
 * for zoom-resilient positioning.
 *
 * Handles:
 *  ✅ PDF Points → CSS % conversion
 *  ✅ Bottom-left origin (inverted Y) for PDFMiner-style coordinates
 *  ✅ Missing width/height with sensible defaults + console warning
 *  ✅ Custom colors per highlight
 *  ✅ Debug tooltip on hover showing raw coordinates
 */
import { computed } from 'vue'

// ─── Props ───────────────────────────────────────────────────────────────────
export interface HighlightItem {
  id: string
  x: number
  y: number
  w?: number   // defaults to 20 PDF points if missing
  h?: number   // defaults to 10 PDF points if missing
  color?: string // CSS color, defaults to yellow
}

const props = withDefaults(defineProps<{
  /** Original PDF page width in points (e.g. 595.28 for A4) */
  pageWidth: number
  /** Original PDF page height in points (e.g. 841.89 for A4) */
  pageHeight: number
  /** Array of highlight rectangles */
  highlights: HighlightItem[]
  /** Coordinate origin system from the backend */
  origin?: 'top-left' | 'bottom-left'
  /** Currently active/selected highlight ID */
  activeId?: string | null
}>(), {
  origin: 'top-left',
  activeId: null,
})

const emit = defineEmits<{
  (e: 'click', id: string): void
}>()

// ─── Default dimensions (PDF points) when backend omits w/h ─────────────────
const DEFAULT_W = 20
const DEFAULT_H = 10

// ─── Computed: map raw highlights → positioned style objects ─────────────────
const styledHighlights = computed(() => {
  return props.highlights.map((hl) => {
    // Resolve dimensions, warn if missing
    let w = hl.w
    let h = hl.h

    if (w == null || w <= 0) {
      console.warn(`[PdfHighlightOverlay] Highlight "${hl.id}" missing width — defaulting to ${DEFAULT_W}pt`)
      w = DEFAULT_W
    }
    if (h == null || h <= 0) {
      console.warn(`[PdfHighlightOverlay] Highlight "${hl.id}" missing height — defaulting to ${DEFAULT_H}pt`)
      h = DEFAULT_H
    }

    // ── Y-axis correction ──
    // PDF bottom-left origin: y increases upward → flip for CSS top-left origin
    let yCSS = hl.y
    if (props.origin === 'bottom-left') {
      yCSS = props.pageHeight - hl.y - h
    }

    // ── Convert PDF points → CSS % ──
    const left   = (hl.x / props.pageWidth)  * 100
    const top    = (yCSS / props.pageHeight)  * 100
    const width  = (w    / props.pageWidth)   * 100
    const height = (h    / props.pageHeight)  * 100

    // Resolve color
    const color = hl.color || 'rgba(250, 204, 21, 0.35)' // yellow-400/35
    const borderColor = hl.color
      ? hl.color.replace(/[\d.]+\)$/, '0.8)') // increase opacity for border
      : 'rgba(202, 138, 4, 0.7)' // yellow-600/70

    return {
      id: hl.id,
      style: {
        position: 'absolute' as const,
        left:   `${left}%`,
        top:    `${top}%`,
        width:  `${width}%`,
        height: `${height}%`,
        backgroundColor: color,
        border: `1.5px solid ${borderColor}`,
        borderRadius: '2px',
        cursor: 'pointer',
        pointerEvents: 'auto' as const,
        transition: 'all 0.25s ease',
      },
      title: `id: ${hl.id} | x: ${hl.x.toFixed(1)}, y: ${hl.y.toFixed(1)}, w: ${w.toFixed(1)}, h: ${h.toFixed(1)} | origin: ${props.origin}`,
      isActive: hl.id === props.activeId,
    }
  })
})
</script>

<template>
  <!-- Overlay container: stretches to fill the parent (which should be the PDF page wrapper) -->
  <div class="absolute inset-0 pointer-events-none z-10">
    <div
      v-for="hl in styledHighlights"
      :key="hl.id"
      :data-highlight-id="hl.id"
      :style="hl.style"
      :title="hl.title"
      :class="[
        hl.isActive
          ? 'ring-2 ring-yellow-500 shadow-lg shadow-yellow-500/30 animate-pulse-hl'
          : 'hover:brightness-110 hover:shadow-md'
      ]"
      @click="emit('click', hl.id)"
    />
  </div>
</template>

<style scoped>
@keyframes pulse-hl {
  0%, 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.4); }
  50%      { box-shadow: 0 0 10px 3px rgba(234, 179, 8, 0.25); }
}
.animate-pulse-hl {
  animation: pulse-hl 2s ease-in-out infinite;
}
</style>
