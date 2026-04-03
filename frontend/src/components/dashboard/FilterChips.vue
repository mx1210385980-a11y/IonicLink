<script setup lang="ts">
import { computed } from 'vue'
import { X, Filter, ArrowRight, Sparkles, Search } from 'lucide-vue-next'
import { useDashboardFilters } from '@/composables/useDashboardFilters'

const emit = defineEmits<{
  explore: []
}>()

const {
  activeFilterCount,
  filterChips,
  queryParams,
  removeFilter,
  resetAll,
} = useDashboardFilters()

const selectionHeadline = computed(() => {
  if (activeFilterCount.value === 1) {
    const chip = filterChips.value[0]
    return chip ? `Focused on ${chip.value}` : 'Focused exploration'
  }
  if (activeFilterCount.value === 2) {
    return 'Cross-filter exploration is ready'
  }
  return `Multi-signal selection across ${activeFilterCount.value} linked filters`
})

const selectionDescription = computed(() => {
  if (!filterChips.value.length) {
    return 'Select chart elements to compose a linked query across the dashboard and workspace.'
  }

  const values = filterChips.value.slice(0, 3).map((chip) => `${chip.label}: ${chip.value}`)
  const suffix = filterChips.value.length > 3 ? ` +${filterChips.value.length - 3} more` : ''
  return `${values.join(' · ')}${suffix}`
})

const queryRuleCount = computed(() => Object.keys(queryParams.value).length)

const colorClasses: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-500/10',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-500/30',
    hover: 'hover:bg-purple-100 dark:hover:bg-purple-500/20',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-500/30',
    hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-500/30',
    hover: 'hover:bg-blue-100 dark:hover:bg-blue-500/20',
  },
  pink: {
    bg: 'bg-pink-50 dark:bg-pink-500/10',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-200 dark:border-pink-500/30',
    hover: 'hover:bg-pink-100 dark:hover:bg-pink-500/20',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-500/10',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-200 dark:border-cyan-500/30',
    hover: 'hover:bg-cyan-100 dark:hover:bg-cyan-500/20',
  },
  emerald: {
    bg: 'bg-teal-50 dark:bg-teal-500/10',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-500/30',
    hover: 'hover:bg-teal-100 dark:hover:bg-teal-500/20',
  },
}

function getColorClasses(color: string) {
  return colorClasses[color] || colorClasses['blue']!
}

function handleRemove(chip: (typeof filterChips.value)[0]) {
  if (chip.type === 'materials') {
    removeFilter('materials', chip.value)
  } else {
    removeFilter(chip.type)
  }
}
</script>

<template>
  <div
    class="filter-chips-bar overflow-hidden rounded-[26px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.16),_transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] px-5 py-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur-md dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.96),rgba(15,23,42,0.96))]"
  >
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <div class="min-w-0">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="inline-flex items-center gap-2 rounded-full border border-sky-200/80 bg-white/75 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700 shadow-sm dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
              <Sparkles class="h-3.5 w-3.5" />
              Linked Exploration
            </div>
            <div class="mt-3 flex items-center gap-3">
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-200 dark:bg-white dark:text-slate-950 dark:shadow-none">
                <Filter class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {{ selectionHeadline }}
                </div>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {{ selectionDescription }}
                </p>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-right shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
              <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                Active Filters
              </div>
              <div class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {{ activeFilterCount }}
              </div>
            </div>
            <div class="rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 text-right shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
              <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
                Query Rules
              </div>
              <div class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {{ queryRuleCount }}
              </div>
            </div>
          </div>
        </div>

        <TransitionGroup
          name="chip"
          tag="div"
          class="mt-4 flex flex-wrap items-center gap-2.5"
        >
          <div
            v-for="chip in filterChips"
            :key="chip.id"
            class="filter-chip group inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-sm transition-all"
            :class="[
              getColorClasses(chip.color).bg,
              getColorClasses(chip.color).text,
              getColorClasses(chip.color).border,
            ]"
          >
            <span class="shrink-0 text-[10px] font-bold uppercase tracking-wider opacity-60">
              {{ chip.label }}
            </span>
            <span class="max-w-[180px] truncate">{{ chip.value }}</span>
            <button
              type="button"
              class="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors"
              :class="getColorClasses(chip.color).hover"
              title="Remove filter"
              @click.stop="handleRemove(chip)"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        </TransitionGroup>

      </div>

      <div class="rounded-[22px] border border-slate-200/80 bg-white/82 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/72">
        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          <Search class="h-3.5 w-3.5" />
          Next Step
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Push this linked selection into the workspace to inspect records, relationship graph, and source-grounded evidence panel together.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            @click="emit('explore')"
          >
            Open Workspace
            <ArrowRight class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            @click="resetAll"
          >
            <X class="h-3 w-3" />
            Clear selection
          </button>
        </div>
        <div class="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
          Dashboard selections are shared with the workspace search. You can keep drilling here or jump straight into record-level evidence.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chip-enter-active,
.chip-leave-active {
  transition: all 0.2s ease;
}

.chip-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.chip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.chip-move {
  transition: transform 0.2s ease;
}

.filter-chip {
  animation: chip-pop 0.2s ease-out;
}

@keyframes chip-pop {
  0% {
    transform: scale(0.9);
    opacity: 0;
  }
  50% {
    transform: scale(1.02);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
