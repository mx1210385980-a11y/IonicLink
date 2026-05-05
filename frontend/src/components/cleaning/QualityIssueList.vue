<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-vue-next'
import type { QualityIssueCard, QualitySeverity } from './useQualityIssues'

const props = defineProps<{
  cards: QualityIssueCard[]
}>()

const expandedKeys = ref<Set<string>>(new Set())
const showAllOk = ref(false)

const actionCards = computed(() => props.cards.filter((card) => card.severity === 'action'))
const watchCards = computed(() => props.cards.filter((card) => card.severity === 'watch'))
const okCards = computed(() => props.cards.filter((card) => card.severity === 'ok'))

function toggleExpanded(key: string) {
  if (expandedKeys.value.has(key)) expandedKeys.value.delete(key)
  else expandedKeys.value.add(key)
  expandedKeys.value = new Set(expandedKeys.value)
}

function isExpanded(card: QualityIssueCard) {
  if (card.severity === 'action') return true
  return expandedKeys.value.has(card.key)
}

function severityChip(severity: QualitySeverity) {
  if (severity === 'action') return { label: '需处理', class: 'bg-rose-600 text-white' }
  if (severity === 'watch') return { label: '需确认', class: 'bg-amber-100 text-amber-800' }
  return { label: '通过', class: 'bg-emerald-100 text-emerald-700' }
}

function severityBorder(severity: QualitySeverity) {
  if (severity === 'action') return 'border-rose-200 bg-rose-50/50'
  if (severity === 'watch') return 'border-amber-200 bg-white'
  return 'border-emerald-200 bg-white'
}

function severityIconClass(severity: QualitySeverity) {
  if (severity === 'action') return 'bg-rose-100 text-rose-700'
  if (severity === 'watch') return 'bg-amber-100 text-amber-700'
  return 'bg-emerald-100 text-emerald-700'
}
</script>

<template>
  <section class="space-y-3">
    <div v-if="actionCards.length" class="space-y-2.5">
      <article
        v-for="card in actionCards"
        :key="card.key"
        class="rounded-2xl border p-4"
        :class="severityBorder(card.severity)"
      >
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" :class="severityIconClass(card.severity)">
            <component :is="card.icon" class="h-4 w-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-slate-950">{{ card.title }}</h3>
              <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="severityChip(card.severity).class">
                {{ severityChip(card.severity).label }}
              </span>
            </div>
            <p class="mt-2 text-xl font-semibold tabular-nums text-slate-950">
              {{ card.value }}
              <span class="text-xs font-medium text-slate-500">{{ card.unit }}</span>
            </p>
            <p class="mt-1.5 text-xs font-semibold text-slate-700">{{ card.status }}</p>
            <p class="mt-1.5 text-xs leading-5 text-slate-600">{{ card.explanation }}</p>
            <p class="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-xs leading-5 text-slate-700 ring-1 ring-slate-200/70">
              <span class="font-semibold">怎么办:</span> {{ card.studentAction }}
            </p>
          </div>
        </div>
      </article>
    </div>

    <div v-if="watchCards.length" class="space-y-1.5">
      <button
        v-for="card in watchCards"
        :key="card.key"
        type="button"
        class="w-full rounded-2xl border px-4 py-3 text-left transition hover:border-amber-300"
        :class="severityBorder(card.severity)"
        @click="toggleExpanded(card.key)"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="severityIconClass(card.severity)">
            <component :is="card.icon" class="h-3.5 w-3.5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-semibold text-slate-950">{{ card.title }}</p>
              <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="severityChip(card.severity).class">
                {{ severityChip(card.severity).label }}
              </span>
              <span class="text-xs font-medium text-slate-500">{{ card.value }} {{ card.unit }}</span>
            </div>
            <p class="mt-0.5 truncate text-xs text-slate-500">{{ card.status }}</p>
          </div>
          <span class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400">
            <ChevronUp v-if="isExpanded(card)" class="h-4 w-4" />
            <ChevronDown v-else class="h-4 w-4" />
          </span>
        </div>
        <div v-if="isExpanded(card)" class="mt-3 ml-11 space-y-2 border-l-2 border-amber-200 pl-3">
          <p class="text-xs leading-5 text-slate-600">{{ card.explanation }}</p>
          <p class="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900">
            <span class="font-semibold">怎么办:</span> {{ card.studentAction }}
          </p>
        </div>
      </button>
    </div>

    <div v-if="okCards.length" class="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3">
      <button
        type="button"
        class="flex w-full items-center justify-between text-left"
        @click="showAllOk = !showAllOk"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle2 class="h-3.5 w-3.5" />
          </div>
          <div>
            <p class="text-sm font-semibold text-emerald-900">{{ okCards.length }} 项检查通过</p>
            <p class="text-xs text-emerald-700/80">{{ okCards.map((c) => c.title).join('、') }}</p>
          </div>
        </div>
        <span class="text-xs font-semibold text-emerald-700">
          {{ showAllOk ? '收起' : '查看' }}
        </span>
      </button>
      <ul v-if="showAllOk" class="mt-3 space-y-1.5 border-t border-emerald-200 pt-3">
        <li v-for="card in okCards" :key="card.key" class="flex items-center justify-between text-xs">
          <span class="text-emerald-900">{{ card.title }}</span>
          <span class="font-medium text-emerald-700">{{ card.status }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
