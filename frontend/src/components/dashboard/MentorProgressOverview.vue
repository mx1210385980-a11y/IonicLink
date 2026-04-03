<script setup lang="ts">
defineProps<{
  stages?: Array<{
    key: string
    label?: string
    total?: number
    delta_count?: number
    last_updated_at?: string | null
  }>
  loading?: boolean
  error?: string
}>()
</script>

<template>
  <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div class="flex items-center justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Mentor Progress</p>
        <h3 class="mt-2 text-lg font-semibold text-slate-900 dark:text-white">Progress Overview</h3>
      </div>
      <span v-if="loading" class="text-sm text-slate-500 dark:text-slate-400">Loading...</span>
    </div>

    <p v-if="error" class="mt-3 text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>

    <div class="mt-4 grid gap-3 md:grid-cols-2">
      <div
        v-for="stage in stages || []"
        :key="stage.key"
        class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
      >
        <p class="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{{ stage.label || stage.key }}</p>
        <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">{{ stage.total || 0 }}</p>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">7 days delta: {{ stage.delta_count || 0 }}</p>
      </div>
    </div>
  </section>
</template>
