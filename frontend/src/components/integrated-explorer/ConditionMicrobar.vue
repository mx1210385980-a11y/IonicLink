<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { Activity, Droplets, Gauge, Scale, Thermometer, Zap } from 'lucide-vue-next'

import type { RecordResponse } from '@/lib/api'
import { conditionSealDisplay, type ConditionMicrobarItem } from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
}>()

const emit = defineEmits<{
  openEvidence: [fieldKey: string, event: MouseEvent | KeyboardEvent]
}>()

const expanded = ref(false)
const seal = computed(() => conditionSealDisplay(props.record))
const satelliteItems = computed(() => [
  ...(seal.value.badge ? [seal.value.badge] : []),
  ...seal.value.meta,
].slice(0, 3))
const overflowItems = computed(() => seal.value.overflowItems)
const passiveItems = computed(() => [
  ...seal.value.meta,
  ...seal.value.overflowItems,
].slice(0, 3))
const passiveOverflowItems = computed(() => [
  ...seal.value.meta,
  ...seal.value.overflowItems,
].slice(3))

const conditionIcons: Record<string, Component> = {
  load: Scale,
  speed: Gauge,
  shear_rate: Activity,
  potential: Zap,
  temperature: Thermometer,
  water: Droplets,
}

watch(() => props.record.id, () => {
  expanded.value = false
})

function accentClass(item: ConditionMicrobarItem | null): string {
  if (!item) return 'border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-500'
  if (item.emphasis === 'muted') return 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'
  if (item.tone === 'dyn') return 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-200'
  if (item.emphasis === 'primary') return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
}

function tickToneClass(item: ConditionMicrobarItem | null): string {
  if (!item) return 'condition-tick--muted'
  if (item.emphasis === 'muted') return 'condition-tick--muted'
  if (item.tone === 'dyn') return 'condition-tick--dynamic'
  if (item.emphasis === 'primary') return 'condition-tick--primary'
  return 'condition-tick--secondary'
}

function formatConditionReadout(item: ConditionMicrobarItem | null): string {
  if (!item) return '--'
  return `${item.value || ''}${item.unit ? ` ${item.unit}` : ''}`.trim() || item.label || '--'
}

function formatCompactConditionReadout(item: ConditionMicrobarItem | null): string {
  if (!item) return '--'
  const value = String(item.value || '').trim()
  const unit = String(item.unit || '').trim()
  if (!value && !unit) return item.label || '--'
  if (!unit) return value
  return `${value}${unit}`
}

function conditionIcon(item: ConditionMicrobarItem | null): Component {
  return conditionIcons[item?.key || ''] || Activity
}

function openItemEvidence(item: ConditionMicrobarItem | null, event: MouseEvent | KeyboardEvent) {
  if (!item?.key) return
  const fieldKey = item.key === 'water' ? 'water_content' : item.key
  emit('openEvidence', fieldKey, event)
}
</script>

<template>
  <div
    v-if="seal.primary"
    class="condition-seal condition-ruler relative min-h-[74px] w-fit min-w-[210px] max-w-[296px] overflow-visible rounded-[9px] border border-slate-200 bg-white px-2.5 py-2 shadow-[0_10px_18px_-18px_rgba(15,23,42,0.65)] dark:border-slate-800 dark:bg-slate-950"
    :title="seal.title || 'No experimental conditions'"
  >
    <button
      type="button"
      class="condition-main w-full text-left"
      :class="tickToneClass(seal.primary)"
      :aria-label="`Open ${seal.primary.label} evidence`"
      @click.stop="openItemEvidence(seal.primary, $event)"
      @keydown.enter.prevent.stop="openItemEvidence(seal.primary, $event)"
    >
      <span class="condition-main-glyph" aria-hidden="true">
        <component :is="conditionIcon(seal.primary)" class="condition-main-icon" />
      </span>
      <span class="condition-readout condition-main-readout">{{ formatConditionReadout(seal.primary) }}</span>
      <span class="condition-signal-label">SIGNAL</span>
    </button>

    <div class="condition-tick-rail">
      <button
        v-for="item in satelliteItems"
        :key="item.key"
        type="button"
        class="condition-tick"
        :class="tickToneClass(item)"
        :title="item.title"
        :aria-label="`Open ${item.label} evidence`"
        @click.stop="openItemEvidence(item, $event)"
        @keydown.enter.prevent.stop="openItemEvidence(item, $event)"
      >
        <span class="condition-tick-symbol">{{ item.symbol }}</span>
        <span class="condition-readout condition-readout--tick">{{ formatCompactConditionReadout(item) }}</span>
      </button>
      <button
        v-if="overflowItems.length"
        type="button"
        class="condition-tick condition-overflow-button"
        :title="seal.title"
        :aria-expanded="expanded"
        @click.stop="expanded = !expanded"
      >+{{ overflowItems.length }}</button>
    </div>

    <div
      v-if="overflowItems.length && expanded"
      class="condition-overflow-popover absolute left-2 right-2 top-[calc(100%+0.25rem)] z-30 grid gap-1 rounded-[8px] border border-slate-200 bg-white p-1.5 shadow-[0_16px_36px_-18px_rgba(15,23,42,0.6)] dark:border-slate-800 dark:bg-slate-950"
      @click.stop
    >
      <button
        v-for="item in overflowItems"
        :key="`overflow-${item.key}`"
        type="button"
        class="condition-detail-chip condition-detail-chip--wide inline-flex min-w-0 items-baseline gap-1 whitespace-normal break-words rounded-[6px] border px-1.5 py-1 text-[12px] font-extrabold leading-tight"
        :class="accentClass(item)"
        :title="item.title"
        :aria-label="`Open ${item.label} evidence`"
        @click.stop="openItemEvidence(item, $event)"
        @keydown.enter.prevent.stop="openItemEvidence(item, $event)"
      >
        <span class="shrink-0 text-[10px] font-black uppercase opacity-70">{{ item.symbol }}</span>
        <span class="min-w-0 break-words">{{ item.value }}</span>
        <span v-if="item.unit" class="shrink-0 whitespace-nowrap text-[10px] font-black opacity-70">{{ item.unit }}</span>
      </button>
    </div>
  </div>

  <div
    v-else-if="passiveItems.length"
    class="condition-strip relative inline-flex w-fit max-w-[296px] flex-wrap items-center justify-center gap-1.5"
    :title="seal.title"
  >
    <button
      v-for="item in passiveItems"
      :key="item.key"
      type="button"
      class="condition-tick"
      :class="tickToneClass(item)"
      :title="item.title"
      :aria-label="`Open ${item.label} evidence`"
      @click.stop="openItemEvidence(item, $event)"
      @keydown.enter.prevent.stop="openItemEvidence(item, $event)"
    >
      <span class="condition-tick-symbol">{{ item.symbol }}</span>
      <span class="condition-readout condition-readout--tick">{{ formatCompactConditionReadout(item) }}</span>
    </button>
    <button
      v-if="passiveOverflowItems.length"
      type="button"
      class="condition-tick condition-overflow-button"
      :title="seal.title"
      :aria-expanded="expanded"
      @click.stop="expanded = !expanded"
    >+{{ passiveOverflowItems.length }}</button>

    <div
      v-if="passiveOverflowItems.length && expanded"
      class="condition-overflow-popover absolute left-2 right-2 top-[calc(100%+0.25rem)] z-30 grid gap-1 rounded-[8px] border border-slate-200 bg-white p-1.5 shadow-[0_16px_36px_-18px_rgba(15,23,42,0.6)] dark:border-slate-800 dark:bg-slate-950"
      @click.stop
    >
        <button
          v-for="item in passiveOverflowItems"
          :key="`passive-overflow-${item.key}`"
          type="button"
          class="condition-detail-chip condition-detail-chip--wide inline-flex min-w-0 items-baseline gap-1 whitespace-normal break-words rounded-[6px] border px-1.5 py-1 text-[12px] font-extrabold leading-tight"
          :class="accentClass(item)"
          :title="item.title"
          :aria-label="`Open ${item.label} evidence`"
          @click.stop="openItemEvidence(item, $event)"
          @keydown.enter.prevent.stop="openItemEvidence(item, $event)"
        >
          <span class="shrink-0 text-[10px] font-black uppercase opacity-70">{{ item.symbol }}</span>
          <span class="min-w-0 break-words">{{ item.value }}</span>
          <span v-if="item.unit" class="shrink-0 whitespace-nowrap text-[10px] font-black opacity-70">{{ item.unit }}</span>
        </button>
    </div>
  </div>
  <span v-else class="inline-flex h-full items-center text-[11px] font-semibold text-slate-300 dark:text-slate-600">--</span>
</template>

<style scoped>
.condition-ruler {
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
}

.condition-main {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  background: rgba(248, 250, 252, 0.7);
  padding: 0.45rem 0.58rem;
}

.condition-main-glyph {
  position: relative;
  display: inline-flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.96) 0 38%, transparent 39%),
    conic-gradient(from 180deg, currentColor 0 22%, transparent 22% 55%, currentColor 55% 78%, transparent 78%);
  opacity: 0.95;
}

.condition-main-glyph::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: inherit;
  background: white;
}

.condition-main-icon {
  position: relative;
  z-index: 1;
  height: 16px;
  width: 16px;
  stroke-width: 2.8;
  line-height: 1;
}

.condition-main-readout {
  color: #0f172a;
  font-size: clamp(18px, 0.92rem + 0.3vw, 21px);
  font-weight: 950;
}

.condition-signal-label {
  color: #94a3b8;
  font-size: 8.5px;
  font-weight: 950;
  letter-spacing: 0.16em;
  line-height: 1;
}

.condition-tick-rail {
  display: flex;
  min-width: 0;
  flex-wrap: nowrap;
  gap: 0.34rem;
  margin-top: 0.48rem;
}

.condition-tick-rail--solo {
  margin-top: 0;
}

.condition-tick {
  display: inline-flex;
  max-width: 100%;
  align-items: baseline;
  gap: 0.28rem;
  min-width: 0;
  min-height: 25px;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  background: rgba(248, 250, 252, 0.78);
  padding: 0.33rem 0.48rem;
}

.condition-tick-symbol {
  flex: 0 0 auto;
  font-size: clamp(11px, 0.62rem + 0.12vw, 12.5px);
  font-weight: 950;
  line-height: 1;
  text-transform: uppercase;
}

.condition-readout {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: clamp(12.5px, 0.7rem + 0.16vw, 14.5px);
  font-weight: 900;
  line-height: 1;
}

.condition-readout--tick {
  overflow: visible;
  text-overflow: clip;
}

.condition-tick--dynamic {
  border-color: rgba(103, 232, 249, 0.78);
  background: rgba(236, 254, 255, 0.92);
  color: #0e7490;
}

.condition-tick--primary {
  border-color: rgba(110, 231, 183, 0.78);
  background: rgba(236, 253, 245, 0.94);
  color: #047857;
}

.condition-tick--secondary {
  border-color: rgba(203, 213, 225, 0.95);
  background: rgba(248, 250, 252, 0.92);
  color: #475569;
}

.condition-tick--muted {
  border-color: rgba(226, 232, 240, 0.9);
  background: rgba(248, 250, 252, 0.62);
  color: #94a3b8;
}

.condition-overflow-button {
  cursor: pointer;
  display: inline-flex;
  justify-content: center;
  color: #64748b;
  font-size: 10px;
  font-weight: 950;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.condition-overflow-button:hover {
  border-color: rgba(103, 232, 249, 0.7);
  background: rgba(236, 254, 255, 0.9);
  color: #0e7490;
}
</style>
