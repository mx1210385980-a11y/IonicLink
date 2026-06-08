<script setup lang="ts">
import { computed } from 'vue'

import { Badge } from '@/components/ui'

const props = defineProps<{
  kept: number
  dropped: number
  droppedByReason?: Record<string, number>
}>()

const total = computed(() => Math.max(0, props.kept) + Math.max(0, props.dropped))
const keptPct = computed(() => (total.value ? Math.round((props.kept / total.value) * 100) : 0))

const reasons = computed(() =>
  Object.entries(props.droppedByReason || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]),
)
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>
        <span class="font-semibold text-emerald-600">{{ kept }} kept</span>
        ·
        <span class="font-semibold text-rose-600">{{ dropped }} dropped</span>
        <span v-if="total"> · {{ total }} total</span>
      </span>
      <span v-if="total">{{ keptPct }}% kept</span>
    </div>
    <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div class="h-full bg-emerald-400" :style="{ width: `${keptPct}%` }" />
      <div class="h-full bg-rose-400" :style="{ width: `${100 - keptPct}%` }" />
    </div>
    <div v-if="reasons.length" class="flex flex-wrap gap-1.5 pt-0.5">
      <Badge v-for="[reason, count] in reasons" :key="reason" class="bg-rose-50 text-rose-700">
        {{ reason }} · {{ count }}
      </Badge>
    </div>
  </div>
</template>
