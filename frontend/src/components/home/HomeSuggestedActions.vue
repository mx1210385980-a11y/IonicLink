<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Database, RotateCcw, ScanSearch, SplitSquareVertical } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'
import type { HomeSuggestedAction } from '@/composables/useHomeSummary'

const props = defineProps<{
  actions: HomeSuggestedAction[]
  loading?: boolean
}>()

const emit = defineEmits<{
  action: [action: HomeSuggestedAction]
}>()

const { isChinese } = useI18n()

const primaryAction = computed(() => props.actions[0] || null)
const secondaryActions = computed(() => props.actions.slice(1))

function iconFor(actionId: string) {
  if (actionId === 'retry-failed-run') return RotateCcw
  if (actionId === 'open-dataset-builder') return Database
  if (actionId === 'open-review-queue') return SplitSquareVertical
  return ScanSearch
}

function priorityClasses(priority: HomeSuggestedAction['priority']) {
  if (priority === 'high') {
    return 'border-[#23379a]/15 bg-[linear-gradient(135deg,#1b2b77_0%,#24389a_48%,#3f55c4_100%)] text-white shadow-[0_28px_70px_-42px_rgba(35,55,154,0.72)]'
  }
  if (priority === 'medium') {
    return 'border-black/8 bg-white/72 text-slate-900 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10'
  }
  return 'border-black/8 bg-slate-50/78 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.08]'
}
</script>

<template>
  <section class="shell-surface w-full max-w-[58rem] px-4 py-3.5 sm:px-4.5">
    <div class="flex items-start justify-between gap-3">
      <div>
      <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
        {{ isChinese ? 'Suggested Actions' : 'Suggested Actions' }}
      </p>
        <h2 class="mt-1 text-lg font-semibold tracking-[-0.04em] text-slate-950 dark:text-white">
          {{ isChinese ? '下一步动作。' : 'Next actions.' }}
      </h2>
      </div>
      <p class="hidden text-right text-[11px] leading-5 text-slate-500 dark:text-slate-400 xl:block">
        {{ isChinese ? '高优动作始终置顶。' : 'Highest-priority actions stay on top.' }}
      </p>
    </div>

    <div class="mt-3 grid gap-2">
      <button
        v-if="primaryAction"
        type="button"
        class="group rounded-[1.2rem] border px-3.5 py-3.5 text-left transition"
        :class="priorityClasses(primaryAction.priority)"
        @click="emit('action', primaryAction)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.9rem] bg-white/12 text-white dark:bg-white/10">
              <component :is="iconFor(primaryAction.id)" class="h-4.5 w-4.5" />
            </div>

            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/70">
                {{ isChinese ? 'Primary Action' : 'Primary Action' }}
              </p>
              <h3 class="mt-1 text-lg font-semibold tracking-[-0.04em]">{{ primaryAction.label }}</h3>
              <p class="mt-1 text-xs leading-5 text-white/78">{{ primaryAction.description }}</p>
            </div>
          </div>

          <ArrowRight class="mt-1 h-4.5 w-4.5 shrink-0 text-white/70 transition group-hover:translate-x-1" />
        </div>
      </button>

      <div class="grid gap-2">
        <button
          v-for="action in secondaryActions"
          :key="action.id"
          type="button"
          class="group rounded-[1.05rem] border px-3 py-3 text-left transition"
          :class="priorityClasses(action.priority)"
          @click="emit('action', action)"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex h-8 w-8 items-center justify-center rounded-[0.8rem] bg-black/5 text-current dark:bg-white/10">
                <component :is="iconFor(action.id)" class="h-3.5 w-3.5" />
              </div>
              <h4 class="mt-2.5 text-sm font-semibold leading-5">{{ action.label }}</h4>
              <p class="mt-1 text-[11px] leading-4 opacity-80">{{ action.description }}</p>
            </div>
            <ArrowRight class="mt-1 h-4 w-4 shrink-0 opacity-50 transition group-hover:translate-x-1 group-hover:opacity-100" />
          </div>
        </button>
      </div>

      <p
        v-if="loading"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ isChinese ? '正在用现有接口刷新 Home 摘要…' : 'Refreshing Home summary from the current APIs...' }}
      </p>
    </div>
  </section>
</template>
