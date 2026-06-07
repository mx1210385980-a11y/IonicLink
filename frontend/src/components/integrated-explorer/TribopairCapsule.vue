<script setup lang="ts">
import { computed } from 'vue'

import ChemicalText from '@/components/ChemicalText.vue'
import type { RecordResponse } from '@/lib/api'
import { contactDisplayModel } from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
  compact?: boolean
}>()

const emit = defineEmits<{
  openEvidence: [fieldKey: string, event: MouseEvent | KeyboardEvent]
}>()

const contact = computed(() => contactDisplayModel(props.record))
const primaryDetails = computed(() => contact.value.detailBadges.slice(0, 2).join(' · '))
const secondaryDetails = computed(() => contact.value.detailBadges.slice(2).join(' · '))
const hasCoating = computed(() => contact.value.detailBadges.some((item) => /^Coat\b/i.test(item)))
const macroCounterfaceClass = computed(() => {
  if (contact.value.pattern === 'pin_disk') return 'macro-rig__counterface--pin'
  if (contact.value.pattern === 'block_ring') return 'macro-rig__counterface--block'
  return 'macro-rig__counterface--ball'
})
const macroSpecimenClass = computed(() => {
  if (contact.value.pattern === 'four_ball') return 'macro-rig__specimen--balls'
  if (contact.value.pattern === 'block_ring') return 'macro-rig__specimen--ring'
  return 'macro-rig__specimen--flat'
})
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
    v-if="compact"
    class="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md border bg-white px-2 py-1 text-[11px] dark:bg-slate-950"
    :class="contact.mode === 'macro'
      ? 'border-orange-200 dark:border-orange-500/20'
      : 'border-slate-200 dark:border-slate-800'"
    :title="contact.title"
  >
    <span
      class="shrink-0 rounded-[4px] px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-[0.1em]"
      :class="contact.mode === 'macro'
        ? 'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300'
        : 'bg-[#e9fbf8] text-[#0f7c82] dark:bg-cyan-400/10 dark:text-cyan-300'"
    >{{ contact.primaryRole }}</span>
    <button
      type="button"
      class="min-w-0 truncate text-left font-bold leading-4 text-slate-800 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-slate-100 dark:hover:text-cyan-300"
      :aria-label="`Open ${contact.primaryRole} evidence`"
      @click.stop="openFieldEvidence(primaryEvidenceFieldKey, $event)"
      @keydown.enter.prevent.stop="openFieldEvidence(primaryEvidenceFieldKey, $event)"
    ><ChemicalText :text="contact.primaryLabel" /></button>
    <span class="shrink-0 text-slate-300 dark:text-slate-600">/</span>
    <span class="shrink-0 rounded-[4px] bg-slate-100 px-1 py-0.5 text-[8px] font-black uppercase leading-none tracking-[0.1em] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{{ contact.secondaryRole }}</span>
    <button
      type="button"
      class="min-w-0 truncate text-left font-semibold leading-4 text-slate-700 underline-offset-2 transition hover:text-[#0f7c82] hover:underline dark:text-slate-200 dark:hover:text-cyan-300"
      :aria-label="`Open ${contact.secondaryRole} evidence`"
      @click.stop="openFieldEvidence(secondaryEvidenceFieldKey, $event)"
      @keydown.enter.prevent.stop="openFieldEvidence(secondaryEvidenceFieldKey, $event)"
    ><ChemicalText :text="contact.secondaryLabel" /></button>
  </div>

  <div
    v-else
    class="tribopair-capsule group relative flex min-w-0 max-w-full items-stretch gap-2 overflow-hidden rounded-md border bg-white px-2 py-1.5 shadow-[0_8px_18px_-18px_rgba(15,23,42,0.55)] transition-colors dark:bg-slate-950"
    :class="contact.mode === 'macro'
      ? 'border-orange-200 hover:border-orange-300 hover:bg-orange-50/35 dark:border-orange-500/20 dark:hover:border-orange-400/35 dark:hover:bg-orange-500/10'
      : 'border-slate-200 hover:border-[#0f7c82]/40 hover:bg-[#fbfefe] dark:border-slate-800 dark:hover:border-cyan-400/30 dark:hover:bg-slate-900'"
    :title="contact.title"
  >
    <div
      v-if="contact.mode === 'macro'"
      class="macro-rig"
      :data-pattern="contact.pattern"
      aria-hidden="true"
    >
      <span class="macro-rig__motion" />
      <span class="macro-rig__counterface" :class="macroCounterfaceClass" />
      <span class="macro-rig__contact" />
      <span class="macro-rig__specimen" :class="macroSpecimenClass" />
    </div>

    <div v-else-if="contact.mode === 'nano'" class="nano-rig" aria-hidden="true">
      <span class="nano-rig__field" />
      <span class="nano-rig__scanline" />
      <div class="nano-rig__probe">
        <span
          class="nano-rig__probe-shape"
          :class="[
            /colloid|sphere/i.test(primaryDetails)
              ? 'nano-rig__probe-shape--sphere'
              : /surface pair/i.test(primaryDetails)
                ? 'nano-rig__probe-shape--plate'
                : 'nano-rig__probe-shape--tip'
          ]"
        />
      </div>
      <span v-if="hasCoating" class="nano-rig__film" />
      <span class="nano-rig__substrate" />
    </div>

    <div v-else class="relative flex w-5 shrink-0 flex-col items-center py-0.5" aria-hidden="true">
      <div class="relative z-10 flex h-4 w-4 items-center justify-center">
        <span class="block h-0 w-0 border-x-[5px] border-t-[10px] border-x-transparent border-slate-500 bg-transparent dark:border-slate-300" />
      </div>
      <div class="my-0.5 h-2.5 w-px bg-gradient-to-b from-slate-300 via-[#0f7c82] to-slate-300 dark:from-slate-700 dark:via-cyan-400 dark:to-slate-700" />
      <div v-if="hasCoating" class="mb-0.5 h-1 w-4 rounded-full bg-amber-300 shadow-[0_0_0_1px_rgba(217,119,6,0.18)] dark:bg-amber-400/80" />
      <div class="h-2 w-5 rounded-[3px] bg-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] dark:bg-slate-100" />
    </div>

    <div class="min-w-0 flex-1">
      <div
        v-if="contact.mode === 'macro'"
        class="mb-1 flex min-w-0 items-center gap-1.5"
      >
        <span class="rounded-[4px] bg-orange-100 px-1.5 py-0.5 text-[8px] font-black leading-none tracking-[0.12em] text-orange-700 dark:bg-orange-400/15 dark:text-orange-300">
          MACRO
        </span>
        <span class="min-w-0 truncate text-[9.5px] font-black uppercase leading-3 tracking-[0.08em] text-slate-500 dark:text-slate-400">
          {{ contact.relationLabel }}
        </span>
      </div>
      <div
        v-else-if="contact.mode === 'nano'"
        class="mb-1 flex min-w-0 items-center gap-1.5"
      >
        <span class="rounded-[4px] bg-cyan-50 px-1.5 py-0.5 text-[8px] font-black leading-none tracking-[0.12em] text-[#0f7c82] dark:bg-cyan-400/10 dark:text-cyan-300">
          NANO
        </span>
        <span class="min-w-0 truncate text-[9.5px] font-black uppercase leading-3 tracking-[0.08em] text-slate-500 dark:text-slate-400">
          {{ contact.relationLabel }}
        </span>
      </div>
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

<style scoped>
.macro-rig {
  position: relative;
  width: 2.75rem;
  min-width: 2.75rem;
  min-height: 3.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nano-rig {
  position: relative;
  width: 2.75rem;
  min-width: 2.75rem;
  min-height: 3.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.nano-rig__field {
  position: absolute;
  left: 0.62rem;
  right: 0.62rem;
  top: 1.1rem;
  bottom: 1.14rem;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(14, 165, 233, 0), rgba(15, 124, 130, 0.18), rgba(14, 165, 233, 0));
  box-shadow: 0 0 18px rgba(14, 165, 233, 0.18);
  animation: nano-field-pulse 2.2s ease-in-out infinite;
}

.nano-rig__scanline {
  position: absolute;
  left: 0.62rem;
  top: 2.1rem;
  z-index: 2;
  width: 1.55rem;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(34, 211, 238, 0), rgba(34, 211, 238, 0.9), rgba(34, 211, 238, 0));
  animation: nano-scan 1.9s ease-in-out infinite;
}

.nano-rig__probe {
  position: absolute;
  top: 0.5rem;
  z-index: 3;
  display: flex;
  width: 1.32rem;
  height: 1.35rem;
  align-items: center;
  justify-content: center;
  animation: nano-probe-hover 2.2s ease-in-out infinite;
}

.nano-rig__probe-shape {
  display: block;
  border-color: #64748b;
}

.nano-rig__probe-shape--tip {
  width: 0;
  height: 0;
  border-left: 0.36rem solid transparent;
  border-right: 0.36rem solid transparent;
  border-top: 0.82rem solid #64748b;
  filter: drop-shadow(0 4px 5px rgba(15, 23, 42, 0.14));
}

.nano-rig__probe-shape--sphere {
  width: 0.86rem;
  height: 0.86rem;
  border-radius: 999px;
  border: 2px solid #0f7c82;
  background: #ecfeff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 10px -8px rgba(15, 23, 42, 0.9);
}

.nano-rig__probe-shape--plate {
  width: 1.15rem;
  height: 0.34rem;
  border-radius: 0.18rem;
  background: #64748b;
  box-shadow: 0 4px 10px -8px rgba(15, 23, 42, 0.9);
}

.nano-rig__film {
  position: absolute;
  top: 2.34rem;
  z-index: 2;
  width: 1.72rem;
  height: 0.22rem;
  border-radius: 999px;
  background: #fbbf24;
  box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.12), 0 -5px 12px -10px rgba(217, 119, 6, 0.9);
}

.nano-rig__substrate {
  position: absolute;
  top: 2.52rem;
  z-index: 1;
  width: 2rem;
  height: 0.46rem;
  border-radius: 0.2rem;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0 10%, transparent 10% 20%),
    #1e293b;
  background-size: 0.42rem 100%, auto;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 8px 14px -12px rgba(15, 23, 42, 0.95);
}

.macro-rig__motion {
  position: absolute;
  left: 0.35rem;
  right: 0.35rem;
  top: 1.25rem;
  height: 0.35rem;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(251, 146, 60, 0), rgba(251, 146, 60, 0.7), rgba(251, 146, 60, 0));
  animation: macro-motion 1.8s ease-in-out infinite;
}

.macro-rig__counterface {
  position: absolute;
  top: 0.58rem;
  z-index: 2;
  background: #fff7ed;
  border: 2px solid #f97316;
  box-shadow: 0 5px 12px -8px rgba(194, 65, 12, 0.9);
  animation: macro-contact 1.8s ease-in-out infinite;
}

.macro-rig__counterface--ball {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 999px;
}

.macro-rig__counterface--pin {
  width: 0.45rem;
  height: 1.1rem;
  border-radius: 0.2rem;
}

.macro-rig__counterface--block {
  width: 1.1rem;
  height: 0.75rem;
  border-radius: 0.25rem;
}

.macro-rig__contact {
  position: absolute;
  top: 1.52rem;
  z-index: 1;
  width: 0.34rem;
  height: 0.34rem;
  border-radius: 999px;
  background: #ea580c;
  box-shadow: 0 0 0 0.35rem rgba(251, 146, 60, 0.16);
  animation: macro-contact-pulse 1.8s ease-in-out infinite;
}

.macro-rig__specimen {
  position: absolute;
  top: 1.72rem;
  z-index: 1;
  background: #1e293b;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 8px 14px -12px rgba(15, 23, 42, 0.95);
}

.macro-rig__specimen--flat {
  width: 1.85rem;
  height: 0.42rem;
  border-radius: 0.18rem;
}

.macro-rig__specimen--ring {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: radial-gradient(circle, transparent 38%, #1e293b 40%);
}

.macro-rig__specimen--balls {
  width: 0.86rem;
  height: 0.86rem;
  border-radius: 999px;
  box-shadow:
    -0.45rem 0.28rem 0 -0.08rem #1e293b,
    0.45rem 0.28rem 0 -0.08rem #1e293b,
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

@keyframes macro-contact {
  0%, 100% {
    transform: translateX(-0.18rem);
  }
  50% {
    transform: translateX(0.18rem);
  }
}

@keyframes macro-motion {
  0%, 100% {
    opacity: 0.45;
    transform: scaleX(0.78);
  }
  50% {
    opacity: 1;
    transform: scaleX(1);
  }
}

@keyframes macro-contact-pulse {
  0%, 100% {
    opacity: 0.6;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes nano-probe-hover {
  0%, 100% {
    transform: translateY(-0.08rem);
  }
  50% {
    transform: translateY(0.14rem);
  }
}

@keyframes nano-scan {
  0%, 100% {
    opacity: 0.35;
    transform: translateX(-0.28rem) scaleX(0.76);
  }
  50% {
    opacity: 1;
    transform: translateX(0.28rem) scaleX(1);
  }
}

@keyframes nano-field-pulse {
  0%, 100% {
    opacity: 0.45;
    transform: scaleY(0.78);
  }
  50% {
    opacity: 1;
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .macro-rig__motion,
  .macro-rig__counterface,
  .macro-rig__contact,
  .nano-rig__field,
  .nano-rig__scanline,
  .nano-rig__probe {
    animation: none;
  }
}
</style>
