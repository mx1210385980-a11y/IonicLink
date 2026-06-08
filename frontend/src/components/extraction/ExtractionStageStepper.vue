<script setup lang="ts">
import { computed } from 'vue'

import { STAGE_BANDS } from '@/lib/extractionStages'

const props = defineProps<{
  /** Active band index (0..4), -1 when unknown. */
  stageIndex: number
  terminal: boolean
  failed?: boolean
}>()

function state(idx: number): 'done' | 'active' | 'pending' {
  if (props.terminal) return props.failed ? 'pending' : 'done'
  if (props.stageIndex < 0) return 'pending'
  if (idx < props.stageIndex) return 'done'
  if (idx === props.stageIndex) return 'active'
  return 'pending'
}

const bands = computed(() => STAGE_BANDS.map((b, i) => ({ ...b, state: state(i) })))
</script>

<template>
  <ol class="flex items-center gap-1">
    <li v-for="(band, i) in bands" :key="band.id" class="flex flex-1 items-center gap-1">
      <div class="flex flex-col items-center gap-1">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
          :class="{
            'bg-emerald-500 text-white': band.state === 'done',
            'bg-primary text-primary-foreground ring-2 ring-primary/30': band.state === 'active',
            'bg-slate-200 text-slate-500': band.state === 'pending',
          }"
        >
          <span v-if="band.state === 'done'">✓</span>
          <span v-else>{{ i + 1 }}</span>
        </span>
        <span
          class="text-[10px] font-medium"
          :class="band.state === 'pending' ? 'text-muted-foreground' : 'text-foreground'"
        >{{ band.label }}</span>
      </div>
      <div
        v-if="i < bands.length - 1"
        class="h-0.5 flex-1 rounded"
        :class="band.state === 'done' ? 'bg-emerald-400' : 'bg-slate-200'"
      />
    </li>
  </ol>
</template>
