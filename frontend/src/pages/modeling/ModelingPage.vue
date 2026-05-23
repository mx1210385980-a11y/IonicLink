<script setup lang="ts">
import { computed } from 'vue'
import { FlaskConical, GraduationCap } from 'lucide-vue-next'
import ModelTrainingWorkbench from '@/components/ModelTrainingWorkbench.vue'
import NanofrictionModelingWorkbench from '@/components/NanofrictionModelingWorkbench.vue'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  preferredTrainingDatasetId: number | null
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-knowledge': []
  'inspect-record': [payload: {
    literatureId?: number | null
    recordId?: number | null
    rowIndex?: number | null
    source: 'val' | 'test' | 'external'
    actual: number
    predicted: number
    residual: number
    absResidual: number
  }]
}>()

const modelingModes = [
  {
    key: 'training',
    label: '通用训练',
    description: '清洗数据、比较算法并管理模型版本。',
    icon: FlaskConical,
  },
  {
    key: 'nanofriction',
    label: '纳米摩擦建模',
    description: '复现含膜厚数据下的论文模型成果。',
    icon: GraduationCap,
  },
] as const

const activeMode = computed(() => props.currentSection === 'nanofriction' ? 'nanofriction' : 'training')

void props.activeScopeLabel
void props.operatorName
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#f1f5f9]">
    <div class="shrink-0 border-b border-[#dbe4ea] bg-white/88 px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="mode in modelingModes"
          :key="mode.key"
          type="button"
          class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-left transition"
          :class="activeMode === mode.key
            ? 'border-[#122024] bg-[#122024] text-white shadow-[0_12px_28px_-22px_rgba(18,32,36,0.7)]'
            : 'border-[#d8e2e7] bg-white text-slate-600 hover:border-[#9fb3bc] hover:text-slate-950'"
          @click="emit('change-section', mode.key)"
        >
          <component :is="mode.icon" class="h-4 w-4 shrink-0" />
          <span>
            <span class="block text-[13px] font-bold leading-4">{{ mode.label }}</span>
            <span
              class="hidden text-[11px] leading-4 md:block"
              :class="activeMode === mode.key ? 'text-slate-300' : 'text-slate-400'"
            >
              {{ mode.description }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <NanofrictionModelingWorkbench
      v-if="activeMode === 'nanofriction'"
      :active-scope-label="activeScopeLabel"
      :operator-name="operatorName"
    />

    <ModelTrainingWorkbench
      v-else
      :key="scopeKey || 'modeling-training'"
      :preselected-cleaned-dataset-id="preferredTrainingDatasetId"
      @open-knowledge="$emit('open-knowledge')"
      @inspect-record="$emit('inspect-record', $event)"
    />
  </div>
</template>
