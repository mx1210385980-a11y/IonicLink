<script setup lang="ts">
import { computed } from 'vue'

import ExtractionStageStepper from './ExtractionStageStepper.vue'
import { Badge, Button, Spinner } from '@/components/ui'
import type { ExtractionProcess } from '@/composables/useExtractionProcess'

const props = defineProps<{ process: ExtractionProcess }>()

const p = props.process

const statusTone = computed(() => {
  const s = p.status.value
  if (s === 'completed') return 'bg-emerald-100 text-emerald-700'
  if (s === 'no_data') return 'bg-amber-100 text-amber-700'
  if (s === 'failed' || s === 'error') return 'bg-rose-100 text-rose-700'
  if (s === 'cancelled') return 'bg-slate-200 text-slate-600'
  return 'bg-sky-100 text-sky-700'
})

const statusLabel = computed(() => p.status.value || 'not started')
const failed = computed(() => ['failed', 'error'].includes(p.status.value))

const elapsedLabel = computed(() => {
  const ms = p.elapsedMs.value
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
})

function fmt(n: number): string {
  return n.toLocaleString()
}
</script>

<template>
  <div class="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" :class="statusTone">
          {{ statusLabel }}
        </span>
        <Badge v-if="p.pipeline.value" class="bg-slate-100 text-slate-600">{{ p.pipeline.value }}</Badge>
        <span v-if="p.isActive.value" class="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Spinner /> {{ p.currentMessage.value || 'working…' }}
        </span>
        <span v-else-if="p.currentMessage.value" class="text-xs text-muted-foreground">
          {{ p.currentMessage.value }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="elapsedLabel" class="text-xs text-muted-foreground">{{ elapsedLabel }}</span>
        <Button
          v-if="p.isActive.value"
          size="sm"
          variant="outline"
          @click="p.cancel()"
        >Cancel</Button>
      </div>
    </div>

    <div class="space-y-1">
      <ExtractionStageStepper :stage-index="p.stageIndex.value" :terminal="p.isTerminal.value" :failed="failed" />
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div class="h-full rounded-full bg-primary transition-all" :style="{ width: `${p.progressPercent.value}%` }" />
      </div>
    </div>

    <div v-if="p.error.value" class="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
      {{ p.error.value }}
    </div>

    <!-- Claude capture stats -->
    <div v-if="p.isClaudePdf.value && p.claudePdf.value" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span v-if="p.claudePdf.value.model"><span class="font-medium text-foreground">model</span> {{ p.claudePdf.value.model }}</span>
      <span v-if="p.claudePdf.value.page_count != null"><span class="font-medium text-foreground">pages</span> {{ p.claudePdf.value.page_count }}</span>
      <span v-if="p.claudePdf.value.document_source"><span class="font-medium text-foreground">source</span> {{ p.claudePdf.value.document_source }}</span>
      <span v-if="p.tokenUsage.value.input"><span class="font-medium text-foreground">tokens</span> {{ fmt(p.tokenUsage.value.input) }} in / {{ fmt(p.tokenUsage.value.output) }} out</span>
      <span v-if="p.claudePdf.value.stop_reason"><span class="font-medium text-foreground">stop</span> {{ p.claudePdf.value.stop_reason }}</span>
    </div>
  </div>
</template>
