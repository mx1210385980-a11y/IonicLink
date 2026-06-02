<script setup lang="ts">
import { computed } from 'vue'

import ChemicalText from '@/components/ChemicalText.vue'
import type { RecordResponse } from '@/lib/api'
import { contactDisplayModel } from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
}>()

const emit = defineEmits<{
  openEvidence: [fieldKey: string, event: MouseEvent | KeyboardEvent]
}>()

const contact = computed(() => contactDisplayModel(props.record))
const primaryDetails = computed(() => contact.value.detailBadges.slice(0, 2).join(' · '))
const secondaryDetails = computed(() => contact.value.detailBadges.slice(2).join(' · '))
const hasCoating = computed(() => contact.value.detailBadges.some((item) => /^Coat\b/i.test(item)))
const primaryEvidenceFieldKey = computed(() => {
  const role = contact.value.primaryRole.toLowerCase()
  if (role.includes('probe') || role.includes('counterface') || role.includes('pin') || role.includes('ball')) {
    return 'probe_material'
  }
  return 'material'
})
const secondaryEvidenceFieldKey = computed(() => {
  const role = contact.value.secondaryRole.toLowerCase()
  if (role.includes('substrate') || role.includes('specimen') || role.includes('disk') || role.includes('plate')) {
    return props.record.substrateMaterial ? 'substrate_material' : 'material'
  }
  return 'substrate_material'
})
const primaryDetailEvidenceFieldKey = computed(() => {
  const text = primaryDetails.value.toLowerCase()
  if (text.includes('rough')) return 'probe_roughness'
  if (text.includes('radius') || /\b(?:nm|μm|um|mm)\b/i.test(text)) return 'probe_radius'
  return primaryEvidenceFieldKey.value
})
const secondaryDetailEvidenceFieldKey = computed(() => {
  const text = secondaryDetails.value.toLowerCase()
  if (text.includes('rough')) return 'substrate_roughness'
  if (text.includes('coat')) return 'substrate_coating'
  if (text.includes('film')) return 'film_thickness'
  return secondaryEvidenceFieldKey.value
})

function openFieldEvidence(fieldKey: string, event: MouseEvent | KeyboardEvent) {
  emit('openEvidence', fieldKey, event)
}
</script>

<template>
  <div
    class="tribopair-capsule group relative flex min-w-0 max-w-full items-stretch gap-2 overflow-hidden rounded-md border bg-white px-2 py-1.5 shadow-[0_8px_18px_-18px_rgba(15,23,42,0.55)] transition-colors dark:bg-slate-950"
    :class="contact.mode === 'macro'
      ? 'border-orange-200 hover:border-orange-300 hover:bg-orange-50/35 dark:border-orange-500/20 dark:hover:border-orange-400/35 dark:hover:bg-orange-500/10'
      : 'border-slate-200 hover:border-[#0f7c82]/40 hover:bg-[#fbfefe] dark:border-slate-800 dark:hover:border-cyan-400/30 dark:hover:bg-slate-900'"
    :title="contact.title"
  >
    <div
      v-if="contact.mode === 'macro'"
      class="relative flex w-10 shrink-0 items-center justify-center py-0.5"
      aria-hidden="true"
    >
      <div class="flex w-full items-center">
        <span
          class="shrink-0 bg-white shadow-[inset_0_0_0_2px_rgba(234,88,12,0.75)] dark:bg-slate-950"
          :class="contact.pattern === 'pin_disk'
            ? 'h-4 w-1.5 rounded-[2px]'
            : contact.pattern === 'block_ring'
              ? 'h-3.5 w-4 rounded-[3px]'
              : 'h-4 w-4 rounded-full'"
        />
        <span class="h-px flex-1 bg-gradient-to-r from-orange-300 via-slate-300 to-orange-300 dark:from-orange-400/80 dark:via-slate-700 dark:to-orange-400/80" />
        <span
          class="shrink-0 bg-slate-800 dark:bg-slate-100"
          :class="contact.pattern === 'four_ball'
            ? 'h-4 w-4 rounded-full shadow-[6px_4px_0_-2px_rgba(15,23,42,0.85),6px_-4px_0_-2px_rgba(15,23,42,0.85)] dark:shadow-[6px_4px_0_-2px_rgba(241,245,249,0.85),6px_-4px_0_-2px_rgba(241,245,249,0.85)]'
            : contact.pattern === 'block_ring'
              ? 'h-4 w-4 rounded-full'
              : 'h-2 w-5 rounded-[3px]'"
        />
      </div>
    </div>

    <div v-else class="relative flex w-5 shrink-0 flex-col items-center py-0.5" aria-hidden="true">
      <div class="relative z-10 flex h-4 w-4 items-center justify-center">
        <span
          class="block border-slate-500 dark:border-slate-300"
          :class="[
            /colloid|sphere/i.test(primaryDetails)
              ? 'h-3 w-3 rounded-full border-2 bg-white dark:bg-slate-950'
              : /surface pair/i.test(primaryDetails)
                ? 'h-1.5 w-4 rounded-sm bg-slate-500 dark:bg-slate-300'
                : 'h-0 w-0 border-x-[5px] border-t-[10px] border-x-transparent bg-transparent'
          ]"
        />
      </div>
      <div class="my-0.5 h-2.5 w-px bg-gradient-to-b from-slate-300 via-[#0f7c82] to-slate-300 dark:from-slate-700 dark:via-cyan-400 dark:to-slate-700" />
      <div v-if="hasCoating" class="mb-0.5 h-1 w-4 rounded-full bg-amber-300 shadow-[0_0_0_1px_rgba(217,119,6,0.18)] dark:bg-amber-400/80" />
      <div class="h-2 w-5 rounded-[3px] bg-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] dark:bg-slate-100" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          class="shrink-0 rounded-[4px] px-1 py-0.5 text-[8.5px] font-black uppercase leading-none tracking-[0.12em]"
          :class="contact.mode === 'macro'
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300'
            : 'bg-[#e9fbf8] text-[#0f7c82] dark:bg-cyan-400/10 dark:text-cyan-300'"
        >
          {{ contact.primaryRole }}
        </span>
        <button
          type="button"
          class="min-w-0 truncate text-left text-[11.5px] font-bold leading-4 text-slate-800 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-slate-100 dark:hover:text-cyan-300"
          :aria-label="`Open ${contact.primaryRole} evidence`"
          @click.stop="openFieldEvidence(primaryEvidenceFieldKey, $event)"
          @keydown.enter.prevent.stop="openFieldEvidence(primaryEvidenceFieldKey, $event)"
        >
          <ChemicalText :text="contact.primaryLabel" />
        </button>
      </div>
      <button
        v-if="primaryDetails"
        type="button"
        class="mt-0.5 block min-w-0 truncate text-left text-[9.5px] font-semibold leading-3 text-slate-500 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-slate-400 dark:hover:text-cyan-300"
        aria-label="Open tribopair detail evidence"
        @click.stop="openFieldEvidence(primaryDetailEvidenceFieldKey, $event)"
        @keydown.enter.prevent.stop="openFieldEvidence(primaryDetailEvidenceFieldKey, $event)"
      >
        {{ primaryDetails }}
      </button>
      <div
        class="my-1 h-px w-full"
        :class="contact.mode === 'macro'
          ? 'bg-gradient-to-r from-transparent via-orange-200 to-transparent dark:via-orange-500/25'
          : 'bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-slate-700'"
      />
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          class="shrink-0 rounded-[4px] px-1 py-0.5 text-[8.5px] font-black uppercase leading-none tracking-[0.12em] text-slate-500"
          :class="contact.mode === 'macro' ? 'bg-slate-100 dark:bg-slate-800 dark:text-slate-300' : 'bg-slate-100 dark:bg-slate-800 dark:text-slate-400'"
        >
          {{ contact.secondaryRole }}
        </span>
        <button
          type="button"
          class="min-w-0 truncate text-left text-[11.5px] font-semibold leading-4 text-slate-700 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-slate-200 dark:hover:text-cyan-300"
          :aria-label="`Open ${contact.secondaryRole} evidence`"
          @click.stop="openFieldEvidence(secondaryEvidenceFieldKey, $event)"
          @keydown.enter.prevent.stop="openFieldEvidence(secondaryEvidenceFieldKey, $event)"
        >
          <ChemicalText :text="contact.secondaryLabel" />
        </button>
      </div>
      <button
        v-if="secondaryDetails"
        type="button"
        class="mt-0.5 block min-w-0 truncate text-left text-[9.5px] font-semibold leading-3 text-amber-700 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-amber-300 dark:hover:text-cyan-300"
        aria-label="Open substrate detail evidence"
        @click.stop="openFieldEvidence(secondaryDetailEvidenceFieldKey, $event)"
        @keydown.enter.prevent.stop="openFieldEvidence(secondaryDetailEvidenceFieldKey, $event)"
      >
        <ChemicalText :text="secondaryDetails" />
      </button>
    </div>
  </div>
</template>
