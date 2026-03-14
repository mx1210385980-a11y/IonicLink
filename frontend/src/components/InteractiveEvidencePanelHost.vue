<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import InteractiveEvidencePanel, {
  type EvidenceSnippet,
  type EvidenceTagType,
  type RowData,
} from '@/components/InteractiveEvidencePanel'

const props = withDefaults(defineProps<{
  row: RowData
  className?: string
  title?: string
  pdfUrl?: string
  hoverDelay?: number
}>(), {
  className: '',
  title: undefined,
  pdfUrl: '',
  hoverDelay: 150,
})

const emit = defineEmits<{
  'open-pdf': [payload: {
    page: number
    snippet: EvidenceSnippet
    activeTag: EvidenceTagType
  }]
}>()

const mountEl = ref<HTMLDivElement | null>(null)
let root: Root | null = null

function renderPanel() {
  if (!root) return

  root.render(
    createElement(InteractiveEvidencePanel, {
      row: props.row,
      className: props.className,
      title: props.title,
      pdfUrl: props.pdfUrl,
      hoverDelay: props.hoverDelay,
      onOpenPdf: (page: number, snippet: EvidenceSnippet, activeTag: EvidenceTagType) => {
        emit('open-pdf', { page, snippet, activeTag })
      },
    }),
  )
}

onMounted(() => {
  if (!mountEl.value) return
  root = createRoot(mountEl.value)
  renderPanel()
})

watch(
  () => [props.row, props.className, props.title, props.pdfUrl, props.hoverDelay],
  () => {
    renderPanel()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  root?.unmount()
  root = null
})
</script>

<template>
  <div ref="mountEl" class="w-full" />
</template>
