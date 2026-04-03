<script setup lang="ts">
defineProps<{
  deltas?: Array<{
    key: string
    label?: string
    delta_count?: number
    total?: number
  }>
}>()
</script>

<template>
  <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Mentor Deltas</p>
    <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div
        v-for="delta in deltas || []"
        :key="delta.key"
        class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
      >
        <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ delta.label || delta.key }}</p>
        <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{{ delta.delta_count || 0 }}</p>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Total {{ delta.total || 0 }}</p>
      </div>
    </div>
  </section>
</template>
