<script setup lang="ts">
import { Languages } from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

const { locale, setLocale, t } = useI18n()
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-full border border-black/8 bg-white/75 p-1 text-sm shadow-[0_10px_24px_-24px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#0d1825]/85"
    :aria-label="t('common.language_switcher')"
  >
    <span class="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 dark:text-slate-500">
      <Languages class="h-3.5 w-3.5" />
    </span>
    <button
      type="button"
      class="rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition"
      :class="locale === 'zh-CN'
        ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
        : 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
      @click="setLocale('zh-CN')"
    >
      中
    </button>
    <button
      type="button"
      class="rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition"
      :class="locale === 'en'
        ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
        : 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
      @click="setLocale('en')"
    >
      EN
    </button>
  </div>
</template>
