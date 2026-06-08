<script setup lang="ts">
import { computed, ref } from 'vue'

import { Badge } from '@/components/ui'
import type { RawCandidateItem } from '@/lib/api'

const props = defineProps<{ item: RawCandidateItem }>()

const expanded = ref(false)

const kept = computed(() => props.item.drop_reason == null)

function pretty(value: unknown): string {
  if (value == null) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const rawJson = computed(() => pretty(props.item.raw))
const normalizedJson = computed(() => pretty(props.item.normalized))

// A compact one-line summary of the most meaningful raw fields, for the collapsed state.
const headline = computed(() => {
  const raw = (props.item.raw ?? {}) as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['material_name', 'ionic_liquid', 'cof', 'cof_delta', 'normal_load', 'load', 'speed', 'temperature', 'wear_rate']) {
    const v = raw[key]
    if (v != null && String(v).trim() !== '') parts.push(`${key}=${String(v)}`)
    if (parts.length >= 4) break
  }
  return parts.join('  ·  ') || '(no scalar fields)'
})
</script>

<template>
  <div
    class="rounded-md border bg-card text-card-foreground"
    :class="kept ? 'border-emerald-200' : 'border-rose-200'"
  >
    <button
      type="button"
      class="flex w-full items-start gap-3 px-3 py-2 text-left"
      @click="expanded = !expanded"
    >
      <span
        class="mt-0.5 inline-flex h-5 min-w-[2.75rem] items-center justify-center rounded-full px-2 text-[11px] font-semibold"
        :class="kept ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'"
      >
        {{ kept ? 'KEPT' : 'DROP' }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-mono text-xs text-foreground">{{ headline }}</span>
        <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Badge v-if="item.page != null" class="bg-slate-100 text-slate-600">p.{{ item.page }}</Badge>
          <Badge v-if="item.source_figure" class="bg-slate-100 text-slate-600">{{ item.source_figure }}</Badge>
          <Badge v-if="item.modality" class="bg-slate-100 text-slate-600">{{ item.modality }}</Badge>
          <Badge v-if="item.drop_reason" class="bg-rose-100 text-rose-700">{{ item.drop_reason }}</Badge>
          <Badge v-if="item.merged_into" class="bg-amber-100 text-amber-700">merged → {{ item.merged_into }}</Badge>
        </span>
      </span>
      <span class="mt-0.5 text-xs text-muted-foreground">{{ expanded ? '▾' : '▸' }}</span>
    </button>

    <div v-if="expanded" class="border-t px-3 py-2">
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Raw model output</div>
          <pre class="max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">{{ rawJson }}</pre>
        </div>
        <div>
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Normalized</div>
          <pre class="max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">{{ normalizedJson }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
