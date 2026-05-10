<script setup lang="ts">
import { computed } from 'vue'

import MoleculeViewer from '@/components/MoleculeViewer.vue'
import type { RecordResponse } from '@/lib/api'
import {
  formatIonicLiquidPartHtml,
  lubricantStructureLayout,
  type IonStructurePreviewItem,
  type LubricantStructurePair,
} from '@/lib/integratedExplorerHelpers'

const props = defineProps<{
  record: RecordResponse
  active: boolean
}>()

const emit = defineEmits<{
  open: [record: RecordResponse]
}>()

const layout = computed(() => lubricantStructureLayout(props.record))
const hasRenderableStructure = computed(() => {
  const current = layout.value
  if (!current) return false
  if (current.kind === 'compounds') return Boolean(current.compounds?.some((item) => item.smiles))
  return current.pairs.some((pair) => pair.cation.smiles || pair.anion.smiles)
})

function openPreview() {
  emit('open', props.record)
}

function titleFor(item: IonStructurePreviewItem) {
  if (item.role === 'compound') return `纯物质 ${item.label}`
  return `${item.role === 'cation' ? '阳离子' : '阴离子'} ${item.label}`
}

function pairItems(pair: LubricantStructurePair): IonStructurePreviewItem[] {
  return [pair.cation, pair.anion]
}
</script>

<template>
  <div v-if="layout && hasRenderableStructure" class="flex min-w-0 items-center gap-1.5">
    <template v-if="layout.kind === 'compounds'">
      <button
        v-for="compound in layout.compounds || []"
        :key="compound.key"
        type="button"
        class="rounded-md border border-slate-200 bg-white/80 transition hover:scale-[1.02] dark:border-slate-700 dark:bg-slate-950/80"
        :class="active ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
        :title="titleFor(compound)"
        @click.stop="openPreview"
      >
        <MoleculeViewer
          v-if="compound.smiles"
          :smiles="compound.smiles"
          size="thumbnail"
          :width="96"
          :height="52"
        />
        <span
          v-else
          class="flex h-[52px] min-w-20 items-center justify-center px-2 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
          v-html="formatIonicLiquidPartHtml(compound.label)"
        />
      </button>
    </template>

    <template v-else-if="layout.kind === 'shared-cation' && layout.cation">
      <button
        v-if="layout.cation.smiles"
        type="button"
        class="rounded-md border border-slate-200 bg-white/80 transition hover:scale-[1.02] dark:border-slate-700 dark:bg-slate-950/80"
        :class="active ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
        :title="titleFor(layout.cation)"
        @click.stop="openPreview"
      >
        <MoleculeViewer
          :smiles="layout.cation.smiles"
          size="thumbnail"
          :width="54"
          :height="52"
        />
      </button>
      <div
        v-else
        class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        v-html="formatIonicLiquidPartHtml(layout.cation.label)"
      />

      <span class="-mx-0.5 select-none text-4xl font-light leading-none text-slate-400 dark:text-slate-500">{</span>

      <div class="flex flex-col gap-1">
        <button
          v-for="(anion, anionIndex) in layout.anions || []"
          :key="`${anion.key}-${anionIndex}`"
          type="button"
          class="rounded-md border border-slate-200 bg-white/80 transition hover:scale-[1.02] dark:border-slate-700 dark:bg-slate-950/80"
          :class="active ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
          :title="titleFor(anion)"
          @click.stop="openPreview"
        >
          <MoleculeViewer
            v-if="anion.smiles"
            :smiles="anion.smiles"
            size="thumbnail"
            :width="48"
            :height="28"
          />
          <span
            v-else
            class="flex h-7 min-w-12 items-center justify-center px-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
            v-html="formatIonicLiquidPartHtml(anion.label)"
          />
        </button>
      </div>
    </template>

    <template v-else>
      <div
        v-for="pair in layout.pairs"
        :key="pair.key"
        class="flex items-center gap-1"
        :title="pair.label"
      >
        <button
          v-for="item in pairItems(pair)"
          :key="item.key"
          type="button"
          class="rounded-md border border-slate-200 bg-white/80 transition hover:scale-[1.02] dark:border-slate-700 dark:bg-slate-950/80"
          :class="active ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-950' : ''"
          :title="titleFor(item)"
          @click.stop="openPreview"
        >
          <MoleculeViewer
            v-if="item.smiles"
            :smiles="item.smiles"
            size="thumbnail"
            :width="48"
            :height="34"
          />
          <span
            v-else
            class="flex h-[34px] min-w-12 items-center justify-center px-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-200"
            v-html="formatIonicLiquidPartHtml(item.label)"
          />
        </button>
      </div>
    </template>
  </div>
</template>
