<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AlertTriangle, Sparkles } from 'lucide-vue-next'
import DatasetBuilderDescriptorModule from './dataset-builder/DatasetBuilderDescriptorModule.vue'
import DatasetBuilderExportModule from './dataset-builder/DatasetBuilderExportModule.vue'
import DatasetBuilderReductionStudio from './dataset-builder/DatasetBuilderReductionStudio.vue'
import type { BuilderSubsetSummary, SubsetCard, SubsetKey } from './dataset-builder/types'
import type { ModelCleaningMatrixRow } from '@/lib/api'
import CleaningHero from './cleaning/CleaningHero.vue'
import CleaningStepper, { type StepperStep } from './cleaning/CleaningStepper.vue'
import CleaningRulesPanel from './cleaning/CleaningRulesPanel.vue'
import QualityIssueList from './cleaning/QualityIssueList.vue'
import { useCleaningPreview } from './cleaning/useCleaningPreview'
import { useQualityIssues } from './cleaning/useQualityIssues'

type BuilderModuleKey = 'quality' | 'descriptor' | 'reduction' | 'export'
type RepresentativeFeatureSelection = Record<SubsetKey, string[]>

const props = defineProps<{
  currentSection?: string
}>()

const emit = defineEmits<{
  (e: 'open-training', datasetId: number | null): void
  (e: 'change-section', section: string): void
  (e: 'open-review'): void
}>()

const {
  form,
  preview,
  savedDatasets,
  loading,
  previewLoading,
  errorMessage,
  statusMessage,
  exportLoadingId,
  subsetSavingKey,
  bundleName,
  lastSavedDatasetId,
  builder,
  descriptorSummary,
  screeningSummary,
  datasetASummary,
  datasetBSummary,
  selectedSourceMode,
  selectedTrainingView,
  rdkitStatusLabel,
  outlierLabel,
  activePresetKey,
  initialize,
  applyStarterPreset,
  applyRecommendedAndRebuild,
  downloadSubsetFromCard,
  saveSubsetCardToWorkspace,
  exportSavedDataset,
} = useCleaningPreview()

const {
  qualityIssueCards,
  actionIssueCount,
  trainingReadyCount,
  qualityScore,
  qualityVerdict,
  cleaningStageLabel,
  nextStudentAction,
  cleaningProgressItems,
} = useQualityIssues({
  preview,
  form,
  selectedTrainingView,
  datasetASummary,
  datasetBSummary,
  savedDatasets,
})

const activeModule = ref<BuilderModuleKey>(props.currentSection === 'datasets' ? 'descriptor' : 'quality')
const selectedRepresentativeFeatures = ref<RepresentativeFeatureSelection>({
  dataset_a: [],
  dataset_b: [],
})
const representativeSelectionDirty = ref<Record<SubsetKey, boolean>>({
  dataset_a: false,
  dataset_b: false,
})

const availableRepresentativeFeatures = computed<Record<SubsetKey, string[]>>(() => ({
  dataset_a: datasetASummary.value?.columns.filter((column) => column !== datasetASummary.value?.target_column) || [],
  dataset_b: datasetBSummary.value?.columns.filter((column) => column !== datasetBSummary.value?.target_column) || [],
}))

const recommendedRepresentativeFeatures = computed<RepresentativeFeatureSelection>(() => {
  const strongest = screeningSummary.value?.strongest_to_target || []
  const ionicGroups = screeningSummary.value?.ionic_collinearity_groups || []
  const surfaceAlerts = screeningSummary.value?.surface_bias_alerts || []
  const correlationMap = new Map(strongest.map((item) => [item.feature, item.abs_correlation]))

  const buildFor = (key: SubsetKey) => {
    const available = new Set(availableRepresentativeFeatures.value[key])
    const picked: string[] = []
    const pickedSet = new Set<string>()
    const groupedSet = new Set<string>()

    const add = (feature: string) => {
      if (!available.has(feature) || pickedSet.has(feature)) return
      picked.push(feature)
      pickedSet.add(feature)
    }

    for (const group of ionicGroups) {
      const features = group.features.filter((feature) => available.has(feature))
      features.forEach((feature) => groupedSet.add(feature))
      const representative = [...features].sort((left, right) => (correlationMap.get(right) || 0) - (correlationMap.get(left) || 0))[0]
      if (representative) add(representative)
    }

    for (const alert of surfaceAlerts) {
      const features = alert.features.filter((feature) => available.has(feature))
      features.forEach((feature) => groupedSet.add(feature))
      const representative = [...features].sort((left, right) => (correlationMap.get(right) || 0) - (correlationMap.get(left) || 0))[0]
      if (representative) add(representative)
    }

    for (const item of strongest) {
      if (!available.has(item.feature) || groupedSet.has(item.feature)) continue
      add(item.feature)
      if (picked.length >= 10) break
    }

    if (key === 'dataset_b' && available.has('Film_Thickness')) {
      add('Film_Thickness')
    }

    return picked.length ? picked : [...availableRepresentativeFeatures.value[key]].slice(0, 10)
  }

  return {
    dataset_a: buildFor('dataset_a'),
    dataset_b: buildFor('dataset_b'),
  }
})

const retainedFeatureColumns = computed(() => [
  ...selectedRepresentativeFeatures.value.dataset_a,
  ...selectedRepresentativeFeatures.value.dataset_b,
])

function filterSubsetSummary(key: SubsetKey, summary: BuilderSubsetSummary | null) {
  if (!summary) return null
  const selectedSet = new Set(selectedRepresentativeFeatures.value[key])
  const filteredColumns = summary.columns.filter((column) => column === summary.target_column || selectedSet.has(column))
  const pickRow = (row: ModelCleaningMatrixRow) => Object.fromEntries(
    filteredColumns.map((column) => [column, row[column] ?? null]),
  ) as ModelCleaningMatrixRow

  return {
    ...summary,
    columns: filteredColumns,
    rows: summary.rows.map((row) => pickRow(row)),
    preview_rows: summary.preview_rows.map((row) => pickRow(row)),
    feature_count: Math.max(0, filteredColumns.length - 1),
  }
}

const subsetCards = computed<SubsetCard[]>(() => {
  if (!builder.value) return []
  return [
    {
      key: 'dataset_a',
      label: 'Dataset-A',
      title: '基础数据集',
      summary: filterSubsetSummary('dataset_a', datasetASummary.value),
      accent: 'sky',
      description: '覆盖优先,不强制要求膜厚,适合先训练一个稳定的基线模型。',
    },
    {
      key: 'dataset_b',
      label: 'Dataset-B',
      title: '增强数据集',
      summary: filterSubsetSummary('dataset_b', datasetBSummary.value),
      accent: 'emerald',
      description: '在基础特征上加入膜厚 h,适合探索界面结构与性能的关系。',
    },
  ]
})

const stepperSteps = computed<StepperStep[]>(() => [
  {
    key: 'quality',
    title: '看看数据有没有问题',
    hint: '挑出不能用的记录',
    metric: actionIssueCount.value,
    metricLabel: '需修',
  },
  {
    key: 'descriptor',
    title: '把数据分成两份',
    hint: '基础版 + 含膜厚版',
    metric: 2,
    metricLabel: '份',
  },
  {
    key: 'reduction',
    title: '挑出关键特征',
    hint: '保留对预测有帮助的',
    metric: retainedFeatureColumns.value.length,
    metricLabel: '已选',
  },
  {
    key: 'export',
    title: '保存,送去训练',
    hint: '让 Modeling 页能读到',
    metric: (datasetASummary.value?.row_count ?? 0) + (datasetBSummary.value?.row_count ?? 0),
    metricLabel: '样本',
  },
])

const completedKeys = computed(() => {
  const completed: string[] = []
  if (trainingReadyCount.value > 0) completed.push('quality')
  if (datasetASummary.value && datasetBSummary.value) completed.push('descriptor')
  if (retainedFeatureColumns.value.length > 0) completed.push('reduction')
  if (savedDatasets.value.length > 0) completed.push('export')
  return completed
})

function selectStep(key: string) {
  activeModule.value = key as BuilderModuleKey
  if (key === 'quality') emit('change-section', 'cleaning')
  else emit('change-section', 'datasets')
}

function openTraining(datasetId: number | null = lastSavedDatasetId.value) {
  emit('open-training', datasetId)
}

function handlePrimaryCleaningAction() {
  const target = nextStudentAction.value.target
  if (target === 'review') {
    emit('open-review')
    return
  }
  if (target === 'explorer') {
    emit('change-section', 'explorer')
    return
  }
  if (target === 'training') {
    openTraining()
    return
  }
  activeModule.value = 'descriptor'
  emit('change-section', 'datasets')
}

function handleDownload(key: SubsetKey) {
  const card = subsetCards.value.find((c) => c.key === key)
  if (card) downloadSubsetFromCard(card)
}

function handleSave(key: SubsetKey) {
  const card = subsetCards.value.find((c) => c.key === key)
  if (card) void saveSubsetCardToWorkspace(card)
}

watch(
  () => props.currentSection,
  (section) => {
    if (section === 'cleaning') {
      activeModule.value = 'quality'
      return
    }
    if (section === 'datasets' && activeModule.value === 'quality') {
      activeModule.value = 'descriptor'
    }
  },
)

watch(
  [availableRepresentativeFeatures, recommendedRepresentativeFeatures],
  ([available, recommended]) => {
    ;(['dataset_a', 'dataset_b'] as SubsetKey[]).forEach((key) => {
      const availableSet = new Set(available[key])
      const current = selectedRepresentativeFeatures.value[key].filter((feature) => availableSet.has(feature))
      if (!representativeSelectionDirty.value[key] || current.length === 0) {
        selectedRepresentativeFeatures.value[key] = [...recommended[key]]
        representativeSelectionDirty.value[key] = false
      } else {
        selectedRepresentativeFeatures.value[key] = current
      }
    })
  },
  { immediate: true },
)

function updateSelectedRepresentativeFeatures(payload: { dataset: SubsetKey; features: string[] }) {
  const availableSet = new Set(availableRepresentativeFeatures.value[payload.dataset])
  selectedRepresentativeFeatures.value[payload.dataset] = payload.features.filter((feature) => availableSet.has(feature))
  representativeSelectionDirty.value[payload.dataset] = true
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-[#f5f7fb] text-slate-900">
    <div class="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4">
      <section v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        <div class="flex items-center gap-2 font-semibold">
          <AlertTriangle class="h-4 w-4" />
          {{ errorMessage }}
        </div>
      </section>

      <section v-if="statusMessage" class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <div class="flex items-center gap-2 font-semibold">
          <Sparkles class="h-4 w-4" />
          {{ statusMessage }}
        </div>
      </section>

      <section v-if="loading && !preview" class="rounded-2xl border border-slate-200 bg-white px-5 py-6">
        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">加载中</p>
        <h2 class="mt-2 text-xl font-semibold tracking-tight text-slate-950">正在生成数据集构建预览</h2>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-500">系统正在拉取样本、计算分子描述符并准备当前构建流程。</p>
      </section>

      <template v-else-if="preview && builder">
        <CleaningHero
          :stage-label="cleaningStageLabel"
          :progress-items="cleaningProgressItems"
          :verdict="qualityVerdict"
          :next-action="nextStudentAction"
          :rebuilding="previewLoading"
          @primary-action="handlePrimaryCleaningAction"
          @rebuild-recommended="applyRecommendedAndRebuild"
        />

        <CleaningStepper
          :steps="stepperSteps"
          :active-key="activeModule"
          :completed-keys="completedKeys"
          @select="selectStep"
        />

        <section v-if="activeModule === 'quality'" class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div class="min-w-0 space-y-3">
            <div class="rounded-2xl border border-amber-100 bg-amber-50/50 p-3.5">
              <div class="flex items-start gap-2.5">
                <span class="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-amber-200/70 px-2 text-[10px] font-bold text-amber-900">第 1 步</span>
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-slate-900">看看每条数据能不能给模型用。</p>
                  <p class="mt-1 text-xs leading-5 text-slate-600">为什么:模型从你提供的数据中学习,如果数据缺关键字段或有错误,模型也学不准。下面红色的"需处理"必须先修;黄色的"需确认"可以先做基线再回头看。</p>
                </div>
              </div>
            </div>
            <div class="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div class="mb-3 flex items-center justify-between gap-3">
                <h2 class="text-base font-semibold tracking-tight text-slate-950">数据问题清单</h2>
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  清洗分 {{ qualityScore }}
                </span>
              </div>
              <QualityIssueList :cards="qualityIssueCards" />
            </div>
          </div>

          <CleaningRulesPanel
            :form="form"
            :active-preset-key="activePresetKey"
            :outlier-label="outlierLabel"
            @apply-preset="applyStarterPreset"
            @update-form="() => {}"
          />
        </section>

        <section v-else>
          <DatasetBuilderDescriptorModule
            v-if="activeModule === 'descriptor'"
            :descriptor-summary="descriptorSummary"
            :dataset-a-summary="datasetASummary"
            :dataset-b-summary="datasetBSummary"
            :selected-source-mode="selectedSourceMode"
            :rdkit-status-label="rdkitStatusLabel"
            :outlier-label="outlierLabel"
          />

          <DatasetBuilderReductionStudio
            v-else-if="activeModule === 'reduction'"
            :descriptor-summary="descriptorSummary"
            :screening-summary="screeningSummary"
            :dataset-a-summary="datasetASummary"
            :dataset-b-summary="datasetBSummary"
            :selected-representative-features="selectedRepresentativeFeatures"
            :recommended-representative-features="recommendedRepresentativeFeatures"
            @update:selected-representative-features="updateSelectedRepresentativeFeatures"
          />

          <DatasetBuilderExportModule
            v-else
            :subset-cards="subsetCards"
            :bundle-name="bundleName"
            :subset-saving-key="subsetSavingKey"
            :saved-datasets="savedDatasets"
            :export-loading-id="exportLoadingId"
            :retained-feature-columns="retainedFeatureColumns"
            @update:bundle-name="bundleName = $event"
            @download="handleDownload"
            @save="handleSave"
            @open-training="openTraining"
            @export-saved="exportSavedDataset"
          />
        </section>
      </template>
    </div>
  </div>
</template>
