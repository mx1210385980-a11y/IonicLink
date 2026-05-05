<script setup lang="ts">
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-vue-next'
import type { SubsetKey } from '../types'

export type CorrelationPage = {
  key: SubsetKey
  title: string
  shortTitle: string
  tag: string
  image: string
  summary: string
  caption: string
  tagClass: string
}

export type ClusterBlock = {
  title: string
  features: string[]
  correlation: string
  tone: string
}

defineProps<{
  page: CorrelationPage
  clusters: ClusterBlock[]
}>()

const emit = defineEmits<{
  (e: 'prev'): void
  (e: 'next'): void
  (e: 'focus-feature', feature: string): void
}>()
</script>

<template>
  <article class="rounded-3xl border border-slate-200 bg-white p-5">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <ImageIcon class="h-4 w-4" />
        </div>
        <div>
          <p class="text-sm font-semibold text-slate-950">相关系数热图</p>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ page.summary }}</p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <button type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50" @click="emit('prev')">
          <ChevronLeft class="h-4 w-4" />
        </button>
        <button type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50" @click="emit('next')">
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="mt-4 flex items-center gap-2">
      <span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="page.tagClass">{{ page.tag }}</span>
      <p class="text-sm font-semibold text-slate-950">{{ page.title }}</p>
    </div>

    <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
      <img :src="page.image" :alt="page.title" class="w-full rounded-xl bg-white object-contain" />
    </div>

    <p class="mt-2 text-[11px] leading-5 text-slate-400">{{ page.caption }}</p>

    <div v-if="clusters.length" class="mt-4 space-y-2">
      <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">共线变量簇</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <div
          v-for="block in clusters"
          :key="`${block.title}-${block.features.join('-')}`"
          class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-slate-950">{{ block.title }}</p>
            <span class="text-xs font-semibold tabular-nums" :class="block.tone">{{ block.correlation }}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="feature in block.features"
              :key="feature"
              type="button"
              class="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              @click="emit('focus-feature', feature)"
            >
              {{ feature }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
