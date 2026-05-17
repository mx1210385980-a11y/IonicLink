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
    return 'border-slate-900 bg-slate-900 text-white shadow-sm dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
  }
  if (priority === 'medium') {
    return 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900'
}
</script>

<template>
  <section class="shell-surface w-full max-w-[58rem] px-4 py-3.5">
    <div class="flex items-start justify-between gap-3">
      <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {{ isChinese ? 'Suggested Actions' : 'Suggested Actions' }}
      </p>
        <h2 class="mt-1 text-lg font-semibold tracking-normal text-slate-950 dark:text-white">
          {{ isChinese ? '下一步动作' : 'Next actions' }}
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
        class="group rounded-md border px-3.5 py-3.5 text-left transition"
        :class="priorityClasses(primaryAction.priority)"
        @click="emit('action', primaryAction)"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
              :class="primaryAction.priority === 'high'
                ? 'bg-white/10 text-white dark:bg-slate-950/10 dark:text-slate-950'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200'"
            >
              <component :is="iconFor(primaryAction.id)" class="h-4.5 w-4.5" />
            </div>

            <div class="min-w-0">
              <p
                class="text-[11px] font-semibold uppercase tracking-widest"
                :class="primaryAction.priority === 'high' ? 'text-white/70 dark:text-slate-950/60' : 'text-slate-500 dark:text-slate-400'"
              >
                {{ isChinese ? 'Primary Action' : 'Primary Action' }}
              </p>
              <h3 class="mt-1 text-base font-semibold leading-6 tracking-normal">{{ primaryAction.label }}</h3>
              <p
                class="mt-1 text-xs leading-5"
                :class="primaryAction.priority === 'high' ? 'text-white/75 dark:text-slate-950/70' : 'text-slate-500 dark:text-slate-400'"
              >
                {{ primaryAction.description }}
              </p>
            </div>
          </div>

          <ArrowRight
            class="mt-1 h-4.5 w-4.5 shrink-0 transition group-hover:translate-x-1"
            :class="primaryAction.priority === 'high' ? 'text-white/70 dark:text-slate-950/60' : 'text-slate-400'"
          />
        </div>
      </button>

      <div class="grid gap-2">
        <button
          v-for="action in secondaryActions"
          :key="action.id"
          type="button"
          class="group rounded-md border px-3 py-3 text-left transition"
          :class="priorityClasses(action.priority)"
          @click="emit('action', action)"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex h-8 w-8 items-center justify-center rounded-md bg-black/5 text-current dark:bg-white/10">
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
