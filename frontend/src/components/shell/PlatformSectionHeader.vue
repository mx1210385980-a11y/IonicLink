<script setup lang="ts">
import { ArrowUpRight } from 'lucide-vue-next'

type HeaderTab = {
  key: string
  label: string
}

type HeaderSignal = {
  key: string
  label: string
  value: string
}

defineProps<{
  eyebrow: string
  title: string
  description: string
  tabs?: HeaderTab[]
  activeTab?: string
  signals?: HeaderSignal[]
  primaryActionLabel?: string
  secondaryActionLabel?: string
}>()

defineEmits<{
  'select-tab': [key: string]
  'primary-action': []
  'secondary-action': []
}>()
</script>

<template>
  <section class="shell-surface-strong overflow-hidden px-5 py-5 sm:px-6">
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-end">
      <div>
        <div class="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          {{ eyebrow }}
        </div>
        <h2 class="mt-3 max-w-4xl text-2xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-3xl">
          {{ title }}
        </h2>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          {{ description }}
        </p>

        <div v-if="tabs?.length" class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold transition"
            :class="activeTab === tab.key
              ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'"
            @click="$emit('select-tab', tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div v-if="primaryActionLabel || secondaryActionLabel" class="mt-5 flex flex-wrap gap-2">
          <button
            v-if="primaryActionLabel"
            type="button"
            class="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            @click="$emit('primary-action')"
          >
            {{ primaryActionLabel }}
            <ArrowUpRight class="h-4 w-4" />
          </button>
          <button
            v-if="secondaryActionLabel"
            type="button"
            class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="$emit('secondary-action')"
          >
            {{ secondaryActionLabel }}
          </button>
        </div>
      </div>

      <div v-if="signals?.length" class="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        <div
          v-for="signal in signals"
          :key="signal.key"
          class="border-l border-slate-200 pl-4 dark:border-slate-800"
        >
          <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{{ signal.label }}</p>
          <p class="mt-1 text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{{ signal.value }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
