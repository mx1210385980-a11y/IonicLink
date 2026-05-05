<script setup lang="ts">
import { Check } from 'lucide-vue-next'

export type StepperStep = {
  key: string
  title: string
  hint: string
  metric?: string | number
  metricLabel?: string
}

defineProps<{
  steps: StepperStep[]
  activeKey: string
  completedKeys?: string[]
}>()

const emit = defineEmits<{
  (e: 'select', key: string): void
}>()

function isCompleted(stepKey: string, completedKeys: string[] = []) {
  return completedKeys.includes(stepKey)
}
</script>

<template>
  <nav class="rounded-2xl border border-slate-200 bg-white p-1.5">
    <ol class="grid grid-cols-2 gap-1 md:grid-cols-4">
      <li v-for="(step, index) in steps" :key="step.key">
        <button
          type="button"
          class="group flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition"
          :class="activeKey === step.key
            ? 'border-indigo-300 bg-indigo-50/70'
            : 'border-transparent hover:border-slate-200 hover:bg-slate-50'"
          @click="emit('select', step.key)"
        >
          <span
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums"
            :class="activeKey === step.key
              ? 'bg-indigo-600 text-white'
              : isCompleted(step.key, completedKeys)
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-500'"
          >
            <Check v-if="isCompleted(step.key, completedKeys) && activeKey !== step.key" class="h-3 w-3" />
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-semibold text-slate-950">{{ step.title }}</span>
            <span class="block truncate text-[10px] leading-4 text-slate-500">{{ step.hint }}</span>
          </span>
          <span
            v-if="step.metric != null"
            class="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600 ring-1 ring-slate-200"
          >
            {{ step.metric }}<span v-if="step.metricLabel" class="ml-0.5 font-normal text-slate-400">{{ step.metricLabel }}</span>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
