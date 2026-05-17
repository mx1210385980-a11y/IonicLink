<script setup lang="ts">
import { Languages } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

const { locale, setLocale, t } = useI18n()
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 text-sm dark:border-slate-800 dark:bg-slate-900"
    :aria-label="t('common.language_switcher')"
  >
    <span class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 dark:text-slate-500">
      <Languages class="h-3.5 w-3.5" />
    </span>
    <button
      type="button"
      class="rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition"
      :class="locale === 'zh-CN'
        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'"
      @click="setLocale('zh-CN')"
    >
      中
    </button>
    <button
      type="button"
      class="rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition"
      :class="locale === 'en'
        ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'"
      @click="setLocale('en')"
    >
      EN
    </button>
  </div>
</template>
