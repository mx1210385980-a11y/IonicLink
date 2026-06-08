<script setup lang="ts">
import { computed } from 'vue'

import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { RecordResponse } from '@/lib/api'
import {
  formatIonicLiquidHtml,
  type IonStructurePreviewItem,
  lubricantRecipeDisplay,
  lubricantStructureItems,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
  active?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  openStructure: [record: RecordResponse]
  openEvidence: [fieldKey: string, event: MouseEvent | KeyboardEvent]
}>()

type IonPairDisplay = {
  cation: string
  anion: string
  fallback: string
}

const recipe = computed(() => lubricantRecipeDisplay(props.record))
const allStructureItems = computed(() => lubricantStructureItems(props.record))
const cationStructure = computed(() => allStructureItems.value.find((item) => item.role === 'cation') || null)
const anionStructure = computed(() => allStructureItems.value.find((item) => item.role === 'anion') || null)
const compoundStructure = computed(() => allStructureItems.value.find((item) => item.role === 'compound') || null)
const primaryIonPair = computed(() => splitIonPair(recipe.value.primary))
const cationDisplay = computed(() => primaryIonPair.value.cation)
const anionDisplay = computed(() => primaryIonPair.value.anion)
const visibleStructureCards = computed(() => {
  const cards = [
    cationStructure.value ? { key: 'cation', item: cationStructure.value, label: 'CATION', className: 'ion-structure-card--cation' } : null,
    anionStructure.value ? { key: 'anion', item: anionStructure.value, label: 'ANION', className: 'ion-structure-card--anion' } : null,
  ].filter((card): card is { key: string, item: IonStructurePreviewItem, label: string, className: string } => Boolean(card))
  if (cards.length) return cards
  return compoundStructure.value
    ? [{ key: 'compound', item: compoundStructure.value, label: 'STRUCT', className: 'ion-structure-card--compound' }]
    : []
})

function splitIonPair(value: string): IonPairDisplay {
  const text = String(value || '').trim()
  const match = text.match(/^(\[[^\]]+\])(\[[^\]]+\]\d*)(.*)$/)
  if (!match) {
    return { cation: '', anion: '', fallback: text || '--' }
  }
  return {
    cation: match[1] || '',
    anion: `${match[2] || ''}${String(match[3] || '').trim()}`,
    fallback: text,
  }
}

function openStructure(item: IonStructurePreviewItem | null) {
  if (!item?.smiles) return
  emit('openStructure', props.record)
}

function openEvidence(fieldKey: string, event: MouseEvent | KeyboardEvent) {
  emit('openEvidence', fieldKey, event)
}
</script>

<template>
  <div class="lubricant-recipe-cell ion-pair-signature min-w-0" :title="recipe.title">
    <div class="ion-pair-header min-w-0">
      <div
        class="ion-pair-lines min-w-0 rounded-[9px] border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.9)] dark:border-slate-800 dark:bg-slate-950"
        :class="recipe.kind === 'blend' ? 'ion-pair-lines--blend' : ''"
      >
        <div class="ion-charge-orbit">
          <button
            type="button"
            class="ion-charge-node ion-charge-node--positive"
            :class="[active && cationStructure ? 'ring-2 ring-sky-400/80 ring-offset-1 ring-offset-white dark:ring-offset-slate-950' : '', !cationStructure ? 'ion-charge-node--muted' : '']"
            :disabled="!cationStructure"
            :title="cationStructure ? `Show ${cationStructure.label} structure` : 'Cation'"
            aria-label="Show cation structure"
            @click.stop="openStructure(cationStructure)"
          >
            +
          </button>
          <button
            type="button"
            class="ion-charge-node ion-charge-node--negative"
            :class="[active && anionStructure ? 'ring-2 ring-emerald-400/80 ring-offset-1 ring-offset-white dark:ring-offset-slate-950' : '', !anionStructure ? 'ion-charge-node--muted' : '']"
            :disabled="!anionStructure"
            :title="anionStructure ? `Show ${anionStructure.label} structure` : 'Anion'"
            aria-label="Show anion structure"
            @click.stop="openStructure(anionStructure)"
          >
            -
          </button>
        </div>

        <div class="flex min-w-0 items-center gap-1.5">
          <span class="ion-row-label ion-row-label--cation">cation</span>
          <button
            v-if="cationDisplay"
            type="button"
            class="ion-row-value ion-row-value--primary text-left underline-offset-2 transition hover:text-[#0f7c82] hover:underline"
            aria-label="Open cation evidence"
            @click.stop="openEvidence('cation', $event)"
            @keydown.enter.prevent.stop="openEvidence('cation', $event)"
            v-html="formatIonicLiquidHtml(cationDisplay)"
          ></button>
          <span
            v-if="recipe.ratio"
            class="recipe-ratio-chip ml-auto shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8.5px] font-black leading-none text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            {{ recipe.ratio }}
          </span>
        </div>
        <div v-if="anionDisplay" class="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span class="ion-row-label ion-row-label--anion">anion</span>
          <button
            type="button"
            class="ion-row-value text-left underline-offset-2 transition hover:text-[#0f7c82] hover:underline"
            aria-label="Open anion evidence"
            @click.stop="openEvidence('anion', $event)"
            @keydown.enter.prevent.stop="openEvidence('anion', $event)"
            v-html="formatIonicLiquidHtml(anionDisplay)"
          ></button>
        </div>
        <button
          v-else
          type="button"
          class="ion-row-value ion-row-value--primary"
          aria-label="Open ionic liquid evidence"
          @click.stop="openEvidence('ionic_liquid', $event)"
          @keydown.enter.prevent.stop="openEvidence('ionic_liquid', $event)"
          v-html="formatIonicLiquidHtml(primaryIonPair.fallback)"
        ></button>
        <div
          v-if="recipe.secondary"
          class="mt-1 flex min-w-0 items-center gap-1.5 border-t border-slate-100 pt-1 text-[10.5px] font-extrabold leading-4 text-slate-500 dark:border-slate-800 dark:text-slate-400"
        >
          <span class="secondary-plus">mix</span>
          <button
            type="button"
            class="min-w-0 truncate text-left underline-offset-2 transition hover:text-[#0f7c82] hover:underline"
            aria-label="Open mixture component evidence"
            @click.stop="openEvidence('ionic_liquid', $event)"
            @keydown.enter.prevent.stop="openEvidence('ionic_liquid', $event)"
            v-html="formatIonicLiquidHtml(recipe.secondary)"
          ></button>
        </div>
      </div>
    </div>

    <div v-if="visibleStructureCards.length && !compact" class="ion-structure-spread">
      <button
        v-for="card in visibleStructureCards"
        :key="card.key"
        type="button"
        class="ion-structure-card"
        :class="[card.className, active ? 'ring-2 ring-blue-500/80 ring-offset-1 ring-offset-white dark:ring-offset-slate-950' : '']"
        :title="`Show ${card.item.label} structure`"
        @click.stop="openStructure(card.item)"
      >
        <span class="ion-structure-label">{{ card.label }}</span>
        <MoleculeViewer :smiles="card.item.smiles" size="thumbnail" :width="96" :height="42" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.ion-pair-lines {
  position: relative;
  overflow: visible;
}

.ion-pair-lines::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.6) 0 48%, rgba(15, 23, 42, 0.12) 48% 52%, rgba(16, 185, 129, 0.62) 52% 100%);
}

.ion-pair-lines--blend::after {
  content: "";
  position: absolute;
  inset: auto 0 0 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(15, 124, 130, 0.65), rgba(16, 185, 129, 0.1));
}

.ion-charge-orbit {
  position: absolute;
  left: -10px;
  top: 50%;
  z-index: 2;
  display: grid;
  gap: 5px;
  transform: translateY(-50%);
}

.ion-charge-orbit::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 4px;
  bottom: 4px;
  width: 1px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.22), rgba(15, 124, 130, 0.4), rgba(16, 185, 129, 0.24));
  box-shadow: 0 0 10px rgba(15, 124, 130, 0.18);
}

.ion-charge-node {
  position: relative;
  display: inline-flex;
  height: 15px;
  width: 15px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 10px;
  font-weight: 950;
  line-height: 1;
  box-shadow: 0 8px 18px -12px rgba(15, 23, 42, 0.8);
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
  animation: ionChargePulse 2.6s ease-in-out infinite;
}

.ion-charge-node:not(:disabled):hover {
  transform: translateY(-1px) scale(1.08);
}

.ion-charge-node--positive {
  border-color: rgba(56, 189, 248, 0.46);
  background: radial-gradient(circle at 35% 30%, #ffffff 0 22%, #dff8ff 23% 62%, #b8eefb 100%);
  color: #036780;
}

.ion-charge-node--negative {
  animation-delay: 1.15s;
  border-color: rgba(52, 211, 153, 0.46);
  background: radial-gradient(circle at 35% 30%, #ffffff 0 22%, #dcfce7 23% 62%, #b8f7d9 100%);
  color: #047857;
}

.ion-charge-node--muted {
  cursor: default;
  opacity: 0.42;
  animation: none;
}

@keyframes ionChargePulse {
  0%, 100% {
    box-shadow: 0 8px 18px -12px rgba(15, 23, 42, 0.8), 0 0 0 0 rgba(15, 124, 130, 0);
  }
  45% {
    box-shadow: 0 10px 20px -13px rgba(15, 23, 42, 0.78), 0 0 0 4px rgba(15, 124, 130, 0.08);
  }
  60% {
    transform: translateX(1px);
  }
}

.ion-row-label {
  display: inline-flex;
  width: 43px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 2px 0;
  font-size: 7.5px;
  font-weight: 950;
  letter-spacing: 0.11em;
  line-height: 1;
  text-transform: uppercase;
}

.ion-row-label--cation {
  background: rgba(236, 254, 255, 0.96);
  color: #036780;
}

.ion-row-label--anion {
  background: rgba(236, 253, 245, 0.96);
  color: #047857;
}

.ion-row-value {
  border: 0;
  background: transparent;
  padding: 0;
  display: block;
  min-width: 0;
  overflow: hidden;
  color: #334155;
  font-size: 12.5px;
  font-weight: 850;
  line-height: 1.18;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ion-row-value--primary {
  color: #0f172a;
  font-size: 13px;
  font-weight: 950;
}

.secondary-plus {
  flex-shrink: 0;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
  padding: 2px 4px;
  font-size: 7.5px;
  font-weight: 950;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.ion-structure-spread {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.ion-structure-card {
  position: relative;
  display: flex;
  height: 48px;
  min-width: 0;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(203, 213, 225, 0.86);
  background: rgba(255, 255, 255, 0.96);
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.ion-structure-card:hover {
  transform: translateY(-1px);
  border-color: rgba(15, 124, 130, 0.34);
  box-shadow: 0 14px 26px -26px rgba(15, 23, 42, 0.7);
}

.ion-structure-card--cation {
  background: linear-gradient(180deg, rgba(236, 254, 255, 0.98), rgba(255, 255, 255, 0.96));
}

.ion-structure-card--anion {
  background: linear-gradient(180deg, rgba(236, 253, 245, 0.98), rgba(255, 255, 255, 0.96));
}

.ion-structure-card--compound {
  grid-column: 1 / -1;
}

.ion-structure-label {
  position: absolute;
  left: 0.35rem;
  top: 0.25rem;
  z-index: 1;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #64748b;
  padding: 1px 4px;
  font-size: 7px;
  font-weight: 950;
  letter-spacing: 0.12em;
  line-height: 1.25;
}

.ion-row-value :deep(sub) {
  font-size: 0.68em;
}
</style>
