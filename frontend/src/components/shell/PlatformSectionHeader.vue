<script setup lang="ts">
import { ArrowUpRight, Sparkles } from 'lucide-vue-next'

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
  <section class="shell-surface-strong overflow-hidden px-5 py-5 sm:px-6 lg:px-7 lg:py-6">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-end">
      <div>
        <div class="inline-flex items-center gap-2 rounded-full border border-[#d8c39a]/60 bg-[#f8eedb]/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9b6b17] dark:border-[#6b5221]/70 dark:bg-[#22190d]/70 dark:text-[#f1ca80]">
          <Sparkles class="h-3.5 w-3.5" />
          {{ eyebrow }}
        </div>
        <h2 class="mt-4 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
          {{ title }}
        </h2>
        <p class="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
          {{ description }}
        </p>

        <div v-if="tabs?.length" class="mt-5 flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition"
            :class="activeTab === tab.key
              ? 'border-transparent bg-[#101b29] text-[#f4d18f] shadow-[0_16px_34px_-24px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
              : 'border-black/8 bg-white/72 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-[#0d1825]/78 dark:text-slate-300 dark:hover:bg-[#132131] dark:hover:text-white'"
            @click="$emit('select-tab', tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div v-if="primaryActionLabel || secondaryActionLabel" class="mt-6 flex flex-wrap gap-3">
          <button
            v-if="primaryActionLabel"
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-3 text-sm font-semibold text-[#f7d496] transition hover:bg-[#1f2937] dark:bg-[#f1cc82] dark:text-[#111827] dark:hover:bg-[#f6d79d]"
            @click="$emit('primary-action')"
          >
            {{ primaryActionLabel }}
            <ArrowUpRight class="h-4 w-4" />
          </button>
          <button
            v-if="secondaryActionLabel"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/72 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-[#0e1826]/80 dark:text-slate-200 dark:hover:bg-[#132131]"
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
          class="border-l border-black/10 pl-4 dark:border-white/10"
        >
          <p class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ signal.label }}</p>
          <p class="mt-2 text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{{ signal.value }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
