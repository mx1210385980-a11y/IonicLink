<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, Layers3 } from 'lucide-vue-next'
import { formatColumnLabel } from './formatters'
import type { BuilderSubsetSummary, DescriptorSummary, ScreeningSummary, SubsetKey } from './types'
import PrecleanFunnel from './reduction/PrecleanFunnel.vue'
import SensitivityRanking from './reduction/SensitivityRanking.vue'
import CorrelationHeatmapPager, { type ClusterBlock, type CorrelationPage } from './reduction/CorrelationHeatmapPager.vue'
import FeatureSelectionGrid from './reduction/FeatureSelectionGrid.vue'
import DescriptorAtlas from './reduction/DescriptorAtlas.vue'
import { resolveFeatureForAvailable, type SensitivityItem } from './reduction/featureSemantics'
import { computeRowwiseSensitivity, normalizeSensitivityItems } from './reduction/sensitivityComputations'
import { FALLBACK_SENSITIVITY_MAP } from './reduction/featureSemantics'

type SelectionPayload = {
  dataset: SubsetKey
  features: string[]
}

const props = defineProps<{
  descriptorSummary: DescriptorSummary | null
  screeningSummary: ScreeningSummary | null
  datasetASummary: BuilderSubsetSummary | null
  datasetBSummary: BuilderSubsetSummary | null
  selectedRepresentativeFeatures: Record<SubsetKey, string[]>
  recommendedRepresentativeFeatures: Record<SubsetKey, string[]>
}>()

const emit = defineEmits<{
  (e: 'update:selectedRepresentativeFeatures', payload: SelectionPayload): void
}>()

const correlationPages: CorrelationPage[] = [
  {
    key: 'dataset_a',
    title: 'Dataset-A 相关系数视图',
    shortTitle: 'Dataset-A',
    tag: '基础数据集',
    image: '/generated/dataset-a-correlation-heatmap.png',
    summary: '适合先确定通用特征骨架,再决定是否需要额外引入膜厚机制变量。',
    caption: '热图来自 no film dataset 0312.csv。',
    tagClass: 'bg-violet-100 text-violet-700',
  },
  {
    key: 'dataset_b',
    title: 'Dataset-B 相关系数视图',
    shortTitle: 'Dataset-B',
    tag: '增强数据集',
    image: '/generated/dataset-b-correlation-heatmap.png',
    summary: '适合检查含膜厚条件下哪些变量必须保留,哪些可以压缩为代表特征。',
    caption: '热图来自 film dataset0312.csv。',
    tagClass: 'bg-sky-100 text-sky-700',
  },
]

const currentPageIndex = ref(0)
const evidenceOpen = ref(false)
const atlasOpen = ref(false)
const atlasFeature = ref<string>('')

const currentPage = computed(() => correlationPages[currentPageIndex.value] ?? correlationPages[0]!)
const currentKey = computed(() => currentPage.value.key)
const currentSummary = computed(() => (currentKey.value === 'dataset_a' ? props.datasetASummary : props.datasetBSummary))
const currentAvailableColumns = computed(() => {
  const summary = currentSummary.value
  if (!summary) return []
  return summary.columns.filter((column) => column !== summary.target_column)
})
const currentAvailableSet = computed(() => new Set(currentAvailableColumns.value))
const currentSelectedFeatures = computed(() => props.selectedRepresentativeFeatures[currentKey.value] || [])
const currentRecommendedFeatures = computed(() => props.recommendedRepresentativeFeatures[currentKey.value] || [])
const targetLabel = computed(() => props.screeningSummary?.target_label || formatColumnLabel(currentSummary.value?.target_column || 'target'))

const precleanStats = computed(() => {
  const initial = (props.descriptorSummary?.descriptor_count || 0) + (props.descriptorSummary?.macro_feature_count || 0)
  const final = props.screeningSummary?.feature_count || currentAvailableColumns.value.length
  return {
    initial,
    final,
    removed: Math.max(0, initial - final),
    analyzableRows: props.screeningSummary?.analyzable_rows || currentSummary.value?.row_count || 0,
  }
})

const derivedSensitivity = computed<SensitivityItem[]>(() => {
  const summary = currentSummary.value
  if (!summary) return []
  const rows = summary.rows?.length ? summary.rows : (summary.preview_rows || [])
  return computeRowwiseSensitivity(rows, summary.target_column, currentAvailableColumns.value)
})

const heatmapSensitivity = computed<SensitivityItem[]>(() => {
  const heatmap = props.screeningSummary?.heatmap
  if (!heatmap?.features?.length || !heatmap.matrix?.length) return []
  const targetIndex = heatmap.features.findIndex((feature) => feature === currentSummary.value?.target_column)
  if (targetIndex < 0) return []

  return heatmap.features
    .map((feature, index) => {
      if (index === targetIndex) return null
      const resolved = resolveFeatureForAvailable(feature, currentAvailableSet.value, currentAvailableColumns.value) || feature
      const correlation = heatmap.matrix[targetIndex]?.[index]
      if (correlation == null) return null
      return {
        feature: resolved,
        correlation,
        abs_correlation: Math.abs(correlation),
      }
    })
    .filter((item): item is SensitivityItem => Boolean(item))
    .sort((left, right) => right.abs_correlation - left.abs_correlation)
    .slice(0, 5)
})

const measuredSensitivity = computed<SensitivityItem[]>(() => {
  if (derivedSensitivity.value.length) {
    return normalizeSensitivityItems(derivedSensitivity.value, currentAvailableSet.value, currentAvailableColumns.value)
  }

  const fromScreening = (props.screeningSummary?.strongest_to_target || [])
    .map((item) => {
      const resolved = resolveFeatureForAvailable(item.feature, currentAvailableSet.value, currentAvailableColumns.value)
      return resolved ? { ...item, feature: resolved } : null
    })
    .filter((item): item is SensitivityItem => Boolean(item))
  const mapped = normalizeSensitivityItems(fromScreening, currentAvailableSet.value, currentAvailableColumns.value)
  if (mapped.length) return mapped

  if (heatmapSensitivity.value.length) {
    return normalizeSensitivityItems(heatmapSensitivity.value, currentAvailableSet.value, currentAvailableColumns.value)
  }
  return []
})

const fallbackSensitivity = computed<SensitivityItem[]>(() => {
  return normalizeSensitivityItems(
    FALLBACK_SENSITIVITY_MAP[currentKey.value] || [],
    currentAvailableSet.value,
    currentAvailableColumns.value,
  )
})

const sensitivityIsMeasured = computed(() => measuredSensitivity.value.length > 0)
const sensitivityItems = computed(() => sensitivityIsMeasured.value ? measuredSensitivity.value : fallbackSensitivity.value)

const sensitivityAdvice = computed(() => {
  if (!sensitivityIsMeasured.value && sensitivityItems.value.length) {
    return '当前页暂无可稳定计算的 Pearson,已回退为离线分析的 Top 5,可作为参考再继续选择。'
  }

  const recommendation = props.screeningSummary?.nonlinear_recommendation
  const maxAbs = sensitivityItems.value.reduce((max, item) => Math.max(max, Math.abs(item.correlation)), 0)
  if (recommendation?.recommended) {
    const algorithms = recommendation.algorithms.length ? `,推荐尝试 ${recommendation.algorithms.join(' / ')}` : ''
    return `最高线性相关系数仅为 ${maxAbs.toFixed(2)},目标更可能由多因素非线性耦合决定${algorithms}。`
  }
  if (sensitivityItems.value.length) {
    return `最高线性相关系数约为 ${maxAbs.toFixed(2)},可优先保留这些高敏感字段,再结合共线簇压缩。`
  }
  return '当前页暂时没有足够的线性相关结果,建议检查可分析特征和样本覆盖。'
})

const clusterBlocks = computed<ClusterBlock[]>(() => {
  const ionicGroups = (props.screeningSummary?.ionic_collinearity_groups || [])
    .map((group) => ({
      title: group.label,
      features: group.features.filter((feature) => currentAvailableSet.value.has(feature)),
      correlation: `|r| max ${group.max_abs_correlation.toFixed(2)}`,
      tone: 'text-violet-700',
    }))
    .filter((group) => group.features.length > 1)

  const surfaceGroups = (props.screeningSummary?.surface_bias_alerts || [])
    .map((group) => ({
      title: '表面变量共线块',
      features: group.features.filter((feature) => currentAvailableSet.value.has(feature)),
      correlation: `|r| ${group.correlation.toFixed(2)}`,
      tone: 'text-amber-700',
    }))
    .filter((group) => group.features.length > 1)

  return [...ionicGroups, ...surfaceGroups].slice(0, 4)
})

const quickJumpFeatures = computed(() => {
  return sensitivityItems.value
    .map((item) => item.feature)
    .filter((feature) => currentAvailableSet.value.has(feature))
})

const atlasContext = computed(() => {
  const feature = atlasFeature.value
  if (!feature) return '当前页暂无可解释的特征。'

  const cluster = clusterBlocks.value.find((block) => block.features.includes(feature))
  if (cluster) return `当前页中它位于“${cluster.title}”这一共线块。`

  const sensitivity = sensitivityItems.value.find((item) => item.feature === feature)
  if (sensitivity) {
    const sign = sensitivity.correlation >= 0 ? '+' : ''
    return `当前页里它进入了目标敏感性前列,相关系数约为 ${sign}${sensitivity.correlation.toFixed(4)}。`
  }
  return '当前页里它不是最突出的敏感字段,更适合作为补充背景变量。'
})

function goPrev() {
  currentPageIndex.value = (currentPageIndex.value - 1 + correlationPages.length) % correlationPages.length
}

function goNext() {
  currentPageIndex.value = (currentPageIndex.value + 1) % correlationPages.length
}

function updateSelection(features: string[]) {
  emit('update:selectedRepresentativeFeatures', { dataset: currentKey.value, features })
}

function focusFeature(feature: string) {
  atlasFeature.value = feature
  atlasOpen.value = true
}

function closeAtlas() {
  atlasOpen.value = false
}
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-2xl border border-amber-100 bg-amber-50/50 p-3.5">
      <div class="flex items-start gap-2.5">
        <span class="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-amber-200/70 px-2 text-[10px] font-bold text-amber-900">第 3 步</span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-slate-900">从所有字段里挑出对预测最有帮助的几个。</p>
          <p class="mt-1 text-xs leading-5 text-slate-600">为什么:特征不是越多越好。重复或没用的特征会让模型学得更慢、更不准。系统已经帮你标了"推荐"的字段,直接点"应用推荐"就够用;想自己微调,可以在下面勾选;想看证据(相关性、共线性),展开"分析依据"。</p>
        </div>
      </div>
    </div>

    <section class="rounded-3xl border border-slate-200 bg-white p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Layers3 class="h-5 w-5" />
          </div>
          <div>
            <h2 class="text-2xl font-semibold tracking-tight text-slate-950">选择保留特征</h2>
            <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
              先点"应用推荐"快速完成,再按需调整。所选字段会传到下一步导出。
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="rounded-xl bg-slate-50 px-3 py-2 text-right">
            <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">数据集</p>
            <p class="text-sm font-semibold text-slate-950">{{ currentPage.shortTitle }}<span class="ml-1 text-xs font-normal text-slate-500">{{ currentSummary?.row_count ?? 0 }} 行</span></p>
          </div>
          <button type="button" class="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="goPrev">
            ← 上一个
          </button>
          <button type="button" class="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="goNext">
            下一个 →
          </button>
        </div>
      </div>
    </section>

    <FeatureSelectionGrid
      :short-title="currentPage.shortTitle"
      :available-columns="currentAvailableColumns"
      :selected-features="currentSelectedFeatures"
      :recommended-features="currentRecommendedFeatures"
      @update="updateSelection"
      @focus="focusFeature"
    />

    <section class="rounded-3xl border border-slate-200 bg-white">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition hover:bg-slate-50"
        @click="evidenceOpen = !evidenceOpen"
      >
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">第 2 步 · 分析依据(可选)</p>
          <p class="mt-1 text-sm font-semibold text-slate-950">查看预清洗、敏感度排行与相关系数热图</p>
        </div>
        <span class="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
          <ChevronDown v-if="!evidenceOpen" class="h-4 w-4" />
          <ChevronUp v-else class="h-4 w-4" />
        </span>
      </button>

      <div v-if="evidenceOpen" class="border-t border-slate-200 bg-slate-50 p-5">
        <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <PrecleanFunnel
            :initial="precleanStats.initial"
            :removed="precleanStats.removed"
            :final="precleanStats.final"
            :analyzable-rows="precleanStats.analyzableRows"
          />
          <SensitivityRanking
            :items="sensitivityItems"
            :measured="sensitivityIsMeasured"
            :target-label="targetLabel"
            :advice="sensitivityAdvice"
            @focus="focusFeature"
          />
          <CorrelationHeatmapPager
            :page="currentPage"
            :clusters="clusterBlocks"
            @prev="goPrev"
            @next="goNext"
            @focus-feature="focusFeature"
          />
        </div>
      </div>
    </section>

    <DescriptorAtlas
      :open="atlasOpen"
      :feature="atlasFeature"
      :context-line="atlasContext"
      :quick-jump-features="quickJumpFeatures"
      @close="closeAtlas"
      @jump="focusFeature"
    />
  </div>
</template>
