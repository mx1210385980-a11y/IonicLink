<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { formatColumnLabel } from '../formatters'
import { SEMANTIC_MAP } from './featureSemantics'

const props = defineProps<{
  open: boolean
  feature: string
  contextLine: string
  quickJumpFeatures: string[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'jump', feature: string): void
}>()

const descriptor = computed(() => {
  const semantic = SEMANTIC_MAP[props.feature]
  return {
    name: props.feature,
    title: semantic?.title || formatColumnLabel(props.feature),
    meaning: semantic?.meaning || formatColumnLabel(props.feature),
    explanation: semantic?.explanation || '该字段来自当前构建流程,可作为下游模型的独立输入特征。',
    unit: semantic?.unit || '/',
    modelHint: semantic?.modelHint || '如果它不处在明显共线簇中,可以按业务解释价值决定是否保留。',
  }
})
</script>

<template>
  <Teleport to="body">
    <transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm" @click="emit('close')"></div>
    </transition>

    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="translate-x-full"
    >
      <aside
        v-if="open"
        class="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl"
      >
        <header class="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{{ descriptor.title }}</p>
            <h3 class="mt-1 truncate text-xl font-semibold tracking-tight text-slate-950">{{ descriptor.name || '--' }}</h3>
            <p class="mt-1 truncate text-xs text-slate-500">{{ descriptor.meaning }}</p>
          </div>
          <button
            type="button"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </header>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span class="text-xs font-semibold text-slate-500">单位</span>
            <span class="text-sm font-semibold text-slate-900">{{ descriptor.unit }}</span>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">含义</p>
            <p class="mt-1.5 text-sm leading-6 text-slate-700">{{ descriptor.explanation }}</p>
          </div>

          <div class="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-600">建模提示</p>
            <p class="mt-1.5 text-sm leading-6 text-slate-700">{{ descriptor.modelHint }}</p>
          </div>

          <div class="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-600">当前页上下文</p>
            <p class="mt-1.5 text-sm leading-6 text-slate-700">{{ contextLine }}</p>
          </div>

          <div v-if="quickJumpFeatures.length">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">快速跳转</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="next in quickJumpFeatures"
                :key="next"
                type="button"
                class="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                :class="next === feature && 'bg-slate-900 text-white border-slate-900'"
                @click="emit('jump', next)"
              >
                {{ next }}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </transition>
  </Teleport>
</template>
