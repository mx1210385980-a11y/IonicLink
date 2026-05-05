<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronUp, FlaskConical, Settings2 } from 'lucide-vue-next'
import type { ModelCleaningOptions } from '@/lib/api'
import {
  SOURCE_MODE_OPTIONS,
  STARTER_PRESETS,
  TRAINING_VIEW_OPTIONS,
  type CleaningPresetKey,
} from './useCleaningPreview'

const props = defineProps<{
  form: ModelCleaningOptions
  activePresetKey: CleaningPresetKey | null
  outlierLabel: string
}>()

const emit = defineEmits<{
  (e: 'apply-preset', key: CleaningPresetKey): void
  (e: 'update-form'): void
}>()

const advancedOpen = ref(false)

function update<K extends keyof ModelCleaningOptions>(key: K, value: ModelCleaningOptions[K]) {
  props.form[key] = value
  emit('update-form')
}
</script>

<template>
  <aside class="space-y-3">
    <article class="rounded-3xl border border-slate-200 bg-white p-5">
      <div class="flex items-center gap-2">
        <FlaskConical class="h-4 w-4 text-indigo-600" />
        <h3 class="text-sm font-semibold text-slate-950">推荐设置</h3>
      </div>
      <p class="mt-1 text-xs leading-5 text-slate-500">先选一个模式快速生成,再按需调整。</p>

      <div class="mt-3 space-y-2">
        <button
          v-for="preset in STARTER_PRESETS"
          :key="preset.key"
          type="button"
          class="w-full rounded-2xl border px-3.5 py-3 text-left transition"
          :class="activePresetKey === preset.key
            ? 'border-indigo-300 bg-indigo-50/60'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
          @click="emit('apply-preset', preset.key)"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-slate-950">{{ preset.label }}</p>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              :class="activePresetKey === preset.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'"
            >
              {{ preset.badge }}
            </span>
          </div>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ preset.summary }}</p>
        </button>
      </div>
    </article>

    <article class="rounded-3xl border border-slate-200 bg-white">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
        @click="advancedOpen = !advancedOpen"
      >
        <div class="flex items-center gap-2">
          <Settings2 class="h-4 w-4 text-slate-500" />
          <span class="text-sm font-semibold text-slate-950">高级设置</span>
          <span v-if="!advancedOpen" class="text-xs text-slate-400">手动调整规则</span>
        </div>
        <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400">
          <ChevronUp v-if="advancedOpen" class="h-4 w-4" />
          <ChevronDown v-else class="h-4 w-4" />
        </span>
      </button>

      <div v-if="advancedOpen" class="space-y-4 border-t border-slate-200 px-5 py-4">
        <div class="space-y-2">
          <label class="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              :checked="form.drop_missing_target"
              @change="update('drop_missing_target', ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-slate-900">保留有 μ/COF 的样本</span>
              <span class="mt-0.5 block text-xs text-slate-500">训练模型必须开启。</span>
            </span>
          </label>
          <label class="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              :checked="form.require_dual_smiles"
              @change="update('require_dual_smiles', ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-slate-900">要求双离子 SMILES</span>
              <span class="mt-0.5 block text-xs text-slate-500">保证结构特征可计算。</span>
            </span>
          </label>
          <label class="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              :checked="form.remove_target_outliers"
              @change="update('remove_target_outliers', ($event.target as HTMLInputElement).checked)"
            />
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-slate-900">移除异常 μ/COF</span>
              <span class="mt-0.5 block text-xs text-slate-500">{{ outlierLabel }}</span>
            </span>
          </label>
        </div>

        <div>
          <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">样本来源</label>
          <select
            class="h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            :value="form.source_mode"
            @change="update('source_mode', ($event.target as HTMLSelectElement).value as ModelCleaningOptions['source_mode'])"
          >
            <option v-for="option in SOURCE_MODE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <p class="mt-1.5 text-xs leading-5 text-slate-500">{{ SOURCE_MODE_OPTIONS.find((opt) => opt.value === form.source_mode)?.detail }}</p>
        </div>

        <div>
          <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">训练视图</label>
          <select
            class="h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            :value="form.training_view"
            @change="update('training_view', ($event.target as HTMLSelectElement).value as ModelCleaningOptions['training_view'])"
          >
            <option v-for="option in TRAINING_VIEW_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <p class="mt-1.5 text-xs leading-5 text-slate-500">{{ TRAINING_VIEW_OPTIONS.find((opt) => opt.value === form.training_view)?.detail }}</p>
        </div>
      </div>
    </article>
  </aside>
</template>
