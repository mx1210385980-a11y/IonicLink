<script setup lang="ts">
import { computed, ref } from 'vue'

import ExtractionRollupBar from './ExtractionRollupBar.vue'
import RawCandidateCard from './RawCandidateCard.vue'
import { Spinner } from '@/components/ui'
import type { RawCandidatesRollup } from '@/lib/api'
import type { ExtractionPhase, PageGroup } from '@/composables/useExtractionProcess'

const props = defineProps<{
  groups: PageGroup[]
  rollup: RawCandidatesRollup | null
  loading: boolean
  phase: ExtractionPhase
}>()

type Filter = 'all' | 'kept' | 'dropped'
const filter = ref<Filter>('all')
const collapsed = ref<Set<string>>(new Set())

function groupKey(group: PageGroup): string {
  return group.page == null ? 'unknown' : String(group.page)
}

function toggle(group: PageGroup): void {
  const key = groupKey(group)
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

const filteredGroups = computed(() =>
  props.groups
    .map((group) => ({
      ...group,
      visibleItems:
        filter.value === 'all'
          ? group.items
          : group.items.filter((it) =>
              filter.value === 'kept' ? it.drop_reason == null : it.drop_reason != null,
            ),
    }))
    .filter((group) => group.visibleItems.length > 0),
)

const totalVisible = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.visibleItems.length, 0),
)

const isTerminal = computed(() => props.phase === 'terminal')
const hasAny = computed(() => props.groups.length > 0)

const tabs: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'kept', label: 'Kept' },
  { id: 'dropped', label: 'Dropped' },
]

function tabCount(id: Filter): number {
  if (!props.rollup) return 0
  if (id === 'kept') return props.rollup.kept
  if (id === 'dropped') return props.rollup.dropped
  return props.rollup.kept + props.rollup.dropped
}
</script>

<template>
  <div class="space-y-3">
    <ExtractionRollupBar
      v-if="rollup"
      :kept="rollup.kept"
      :dropped="rollup.dropped"
      :dropped-by-reason="rollup.dropped_by_reason"
    />

    <div class="flex items-center gap-1 border-b">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors"
        :class="filter === tab.id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="filter = tab.id"
      >
        {{ tab.label }}
        <span class="ml-1 text-xs text-muted-foreground">{{ tabCount(tab.id) }}</span>
      </button>
    </div>

    <!-- Loading / not-yet-terminal states -->
    <div v-if="loading && !hasAny" class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Spinner /> Loading raw model output…
    </div>
    <div
      v-else-if="!hasAny && !isTerminal"
      class="rounded-md border border-dashed bg-slate-50 px-4 py-8 text-center text-sm text-muted-foreground"
    >
      Claude is reading the full PDF. The raw rows it returns — and what was kept vs dropped —
      appear here as soon as the run finishes.
    </div>
    <div
      v-else-if="!hasAny && isTerminal"
      class="rounded-md border border-dashed bg-slate-50 px-4 py-8 text-center text-sm text-muted-foreground"
    >
      No raw candidates were recorded for this run.
    </div>
    <div
      v-else-if="totalVisible === 0"
      class="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-muted-foreground"
    >
      No {{ filter }} rows.
    </div>

    <!-- Per-page groups -->
    <div v-else class="space-y-3">
      <section v-for="group in filteredGroups" :key="groupKey(group)" class="rounded-lg border">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          @click="toggle(group)"
        >
          <span class="flex items-center gap-2 text-sm font-semibold">
            <span class="text-muted-foreground">{{ collapsed.has(groupKey(group)) ? '▸' : '▾' }}</span>
            {{ group.label }}
          </span>
          <span class="text-xs text-muted-foreground">
            <span class="text-emerald-600">{{ group.kept }} kept</span>
            ·
            <span class="text-rose-600">{{ group.dropped }} dropped</span>
          </span>
        </button>
        <div v-if="!collapsed.has(groupKey(group))" class="space-y-1.5 px-3 pb-3">
          <RawCandidateCard v-for="item in group.visibleItems" :key="item.id" :item="item" />
        </div>
      </section>
    </div>
  </div>
</template>
