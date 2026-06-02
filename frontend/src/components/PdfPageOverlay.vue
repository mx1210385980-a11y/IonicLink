<script setup lang="ts">
import { computed } from 'vue'
import type { ExtractedData } from '@/types/pdf-highlight'

const props = defineProps<{
  highlights: ExtractedData[]
  activeHighlightId: string | null
  pageNumber: number
}>()

const emit = defineEmits<{
  highlightClicked: [id: string]
}>()

/** Filter highlights that belong to this page */
const pageHighlights = computed(() =>
  props.highlights.filter(h => h.position.pageNumber === props.pageNumber)
)

/**
 * Convert a highlight's bounding rect to CSS style using percentages.
 * The boundingRect x1/y1/x2/y2 are already in percentage (0–100) of page dims.
 */
function getHighlightStyle(highlight: ExtractedData): Record<string, string> {
  const { boundingRect, rects } = highlight.position

  // If multi-line rects exist, compute bounding box over all rects
  if (rects && rects.length > 0) {
    const minX = Math.min(...rects.map((r: any) => r.x1))
    const minY = Math.min(...rects.map((r: any) => r.y1))
    const maxX = Math.max(...rects.map((r: any) => r.x2))
    const maxY = Math.max(...rects.map((r: any) => r.y2))
    return {
      left: `${minX}%`,
      top: `${minY}%`,
      width: `${maxX - minX}%`,
      height: `${maxY - minY}%`,
    }
  }

  return {
    left: `${boundingRect.x1}%`,
    top: `${boundingRect.y1}%`,
    width: `${boundingRect.x2 - boundingRect.x1}%`,
    height: `${boundingRect.y2 - boundingRect.y1}%`,
  }
}

/** Get individual rect styles for multi-line highlights */
function getMultiLineRects(highlight: ExtractedData) {
  if (!highlight.position.rects || highlight.position.rects.length <= 1) return []
  return highlight.position.rects.map((rect: any) => ({
    left: `${rect.x1}%`,
    top: `${rect.y1}%`,
    width: `${rect.x2 - rect.x1}%`,
    height: `${rect.y2 - rect.y1}%`,
  }))
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none" style="z-index: 2;">
    <template v-for="highlight in pageHighlights" :key="highlight.id">
      <!-- Single-rect highlight (or bounding box fallback) -->
      <div
        v-if="!highlight.position.rects || highlight.position.rects.length <= 1"
        :data-highlight-id="highlight.id"
        :style="getHighlightStyle(highlight)"
        class="absolute pointer-events-auto cursor-pointer transition-all duration-300 rounded-sm"
        :class="[
          highlight.id === activeHighlightId
            ? 'bg-amber-400/40 border-2 border-amber-500 shadow-lg shadow-amber-500/25 highlight-active'
            : 'bg-amber-300/25 border border-amber-400/60 hover:bg-amber-400/35 hover:border-amber-500'
        ]"
        @click="emit('highlightClicked', highlight.id)"
      >
        <!-- Active indicator dot -->
        <div
          v-if="highlight.id === activeHighlightId"
          class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-500 rounded-full shadow-md animate-ping"
        />
      </div>

      <!-- Multi-line rects -->
      <template v-else>
        <!-- Invisible scroll target covering all rects -->
        <div
          :data-highlight-id="highlight.id"
          :style="getHighlightStyle(highlight)"
          class="absolute"
        />
        <!-- Individual line rects -->
        <div
          v-for="(rectStyle, idx) in getMultiLineRects(highlight)"
          :key="`${highlight.id}-rect-${idx}`"
          :style="rectStyle"
          class="absolute pointer-events-auto cursor-pointer transition-all duration-300 rounded-sm"
          :class="[
            highlight.id === activeHighlightId
              ? 'bg-amber-400/40 border-2 border-amber-500 shadow-lg shadow-amber-500/25 highlight-active'
              : 'bg-amber-300/25 border border-amber-400/60 hover:bg-amber-400/35 hover:border-amber-500'
          ]"
          @click="emit('highlightClicked', highlight.id)"
        />
      </template>
    </template>
  </div>
</template>
