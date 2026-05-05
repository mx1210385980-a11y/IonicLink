<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Package,
  RotateCcw,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-vue-next'
import type { ModelCleaningMatrixRow } from '@/lib/api'
import type { BuilderSubsetSummary, SubsetCard, SubsetKey } from './dataset-builder/types'
import { formatDateTime } from './dataset-builder/formatters'
import { useCleaningPreview } from './cleaning/useCleaningPreview'
import { useQualityIssues } from './cleaning/useQualityIssues'

defineProps<{
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
  errorMessage,
  statusMessage,
  exportLoadingId,
  bundleName,
  lastSavedDatasetId,
  builder,
  descriptorSummary,
  screeningSummary,
  datasetASummary,
  datasetBSummary,
  selectedSourceMode,
  selectedTrainingView,
  initialize,
  applyStarterPreset,
  saveSubsetCardToWorkspace,
  exportSavedDataset,
} = useCleaningPreview()

const {
  qualityIssueCards,
  actionIssueCards,
  watchIssueCards,
  actionIssueCount,
  watchIssueCount,
  trainingReadyCount,
  rawRecordCount,
  qualityVerdict,
  nextStudentAction,
  readyRatio,
} = useQualityIssues({
  preview,
  form,
  selectedTrainingView,
  datasetASummary,
  datasetBSummary,
  savedDatasets,
})

const buildingState = ref<'idle' | 'building' | 'done' | 'error'>('idle')
const buildErrorMessage = ref('')
const showDetails = ref(false)

const availableFeatures = computed<Record<SubsetKey, string[]>>(() => ({
  dataset_a: datasetASummary.value?.columns.filter((c) => c !== datasetASummary.value?.target_column) || [],
  dataset_b: datasetBSummary.value?.columns.filter((c) => c !== datasetBSummary.value?.target_column) || [],
}))

const recommendedFeatures = computed<Record<SubsetKey, string[]>>(() => {
  const strongest = screeningSummary.value?.strongest_to_target || []
  const ionicGroups = screeningSummary.value?.ionic_collinearity_groups || []
  const surfaceAlerts = screeningSummary.value?.surface_bias_alerts || []
  const correlationMap = new Map(strongest.map((item) => [item.feature, item.abs_correlation]))

  const buildFor = (key: SubsetKey): string[] => {
    const available = new Set(availableFeatures.value[key])
    const picked: string[] = []
    const pickedSet = new Set<string>()
    const groupedSet = new Set<string>()

    const add = (feature: string) => {
      if (!available.has(feature) || pickedSet.has(feature)) return
      picked.push(feature)
      pickedSet.add(feature)
    }

    for (const group of ionicGroups) {
      const features = group.features.filter((f) => available.has(f))
      features.forEach((f) => groupedSet.add(f))
      const rep = [...features].sort((a, b) => (correlationMap.get(b) || 0) - (correlationMap.get(a) || 0))[0]
      if (rep) add(rep)
    }
    for (const alert of surfaceAlerts) {
      const features = alert.features.filter((f) => available.has(f))
      features.forEach((f) => groupedSet.add(f))
      const rep = [...features].sort((a, b) => (correlationMap.get(b) || 0) - (correlationMap.get(a) || 0))[0]
      if (rep) add(rep)
    }
    for (const item of strongest) {
      if (!available.has(item.feature) || groupedSet.has(item.feature)) continue
      add(item.feature)
      if (picked.length >= 10) break
    }
    if (key === 'dataset_b' && available.has('Film_Thickness')) add('Film_Thickness')
    return picked.length ? picked : [...availableFeatures.value[key]].slice(0, 10)
  }

  return { dataset_a: buildFor('dataset_a'), dataset_b: buildFor('dataset_b') }
})

const retainedFeatureColumns = computed(() => [
  ...recommendedFeatures.value.dataset_a,
  ...recommendedFeatures.value.dataset_b,
])

function filterSubsetSummary(key: SubsetKey, summary: BuilderSubsetSummary | null) {
  if (!summary) return null
  const selected = new Set(recommendedFeatures.value[key])
  const cols = summary.columns.filter((c) => c === summary.target_column || selected.has(c))
  const pickRow = (row: ModelCleaningMatrixRow) => Object.fromEntries(
    cols.map((c) => [c, row[c] ?? null]),
  ) as ModelCleaningMatrixRow
  return {
    ...summary,
    columns: cols,
    rows: summary.rows.map(pickRow),
    preview_rows: summary.preview_rows.map(pickRow),
    feature_count: Math.max(0, cols.length - 1),
  }
}

const buildableSubsets = computed<SubsetCard[]>(() => {
  if (!builder.value) return []
  return [
    {
      key: 'dataset_a',
      label: 'Dataset-A',
      title: '基础版',
      summary: filterSubsetSummary('dataset_a', datasetASummary.value),
      accent: 'sky',
      description: '覆盖优先,不要求膜厚,适合先训练一个稳定的基线模型。',
    },
    {
      key: 'dataset_b',
      label: 'Dataset-B',
      title: '增强版',
      summary: filterSubsetSummary('dataset_b', datasetBSummary.value),
      accent: 'emerald',
      description: '加入膜厚 h,适合分析界面结构与摩擦的关系。',
    },
  ]
})

const isBlocked = computed(() => {
  if (loading.value) return false
  if (rawRecordCount.value === 0) return true
  if (trainingReadyCount.value < 10) return true
  if (actionIssueCount.value > 0) return true
  return false
})

const canBuild = computed(() => !isBlocked.value && buildableSubsets.value.length > 0)

const droppedCount = computed(() => {
  const dropped = preview.value?.summary?.dropped_by_reason
  if (!dropped) return 0
  return Object.values(dropped).reduce((sum, v) => sum + Number(v || 0), 0)
})

const datasetAPersonal = computed(() => filterSubsetSummary('dataset_a', datasetASummary.value))
const datasetBPersonal = computed(() => filterSubsetSummary('dataset_b', datasetBSummary.value))

async function autoBuild() {
  if (!canBuild.value || buildingState.value === 'building') return

  applyStarterPreset('balanced')
  buildingState.value = 'building'
  buildErrorMessage.value = ''

  try {
    for (const card of buildableSubsets.value) {
      if (!card.summary) continue
      await saveSubsetCardToWorkspace(card)
      if (errorMessage.value) {
        throw new Error(errorMessage.value)
      }
    }
    buildingState.value = 'done'
  } catch (error: any) {
    buildingState.value = 'error'
    buildErrorMessage.value = error?.message || '生成失败,请重试。'
  }
}

function goReview() {
  emit('open-review')
}

function goExplorer() {
  emit('change-section', 'explorer')
}

function goTraining(datasetId: number | null = lastSavedDatasetId.value) {
  emit('open-training', datasetId)
}

const verdictTone = computed(() => {
  if (loading.value) return 'loading'
  if (rawRecordCount.value === 0) return 'empty'
  if (trainingReadyCount.value < 10) return 'blocked'
  if (actionIssueCount.value > 0) return 'blocked'
  if (watchIssueCount.value > 0) return 'caution'
  return 'ready'
})

const verdictView = computed(() => {
  if (verdictTone.value === 'loading') {
    return { icon: Loader2, headline: '正在分析...', subtext: '系统正在读取数据并做体检。' }
  }
  if (verdictTone.value === 'empty') {
    return {
      icon: AlertTriangle,
      headline: '还没有可用的记录',
      subtext: '先回到数据浏览,选择本次想要训练的文献。',
    }
  }
  if (verdictTone.value === 'blocked') {
    if (rawRecordCount.value > 0 && trainingReadyCount.value < 10) {
      return {
        icon: XCircle,
        headline: `只有 ${trainingReadyCount.value} 条数据能用,太少了`,
        subtext: '少于 10 条时模型很不稳定。先去补更多文献,或回到 Review 把缺失字段补齐。',
      }
    }
    return {
      icon: XCircle,
      headline: `${actionIssueCount.value} 项关键问题需要先修`,
      subtext: '这些问题会直接影响训练质量,先回 Review 处理这些记录,再回来生成数据集。',
    }
  }
  if (verdictTone.value === 'caution') {
    return {
      icon: AlertTriangle,
      headline: `${trainingReadyCount.value} 条数据可用,但有 ${watchIssueCount.value} 项建议复核`,
      subtext: '可以直接生成数据集,后续也可以回 Review 进一步打磨。',
    }
  }
  return {
    icon: CheckCircle2,
    headline: `${trainingReadyCount.value} 条数据通过检查,可以生成训练集`,
    subtext: '点击下面的按钮即可生成。',
  }
})

const verdictBgClass = computed(() => {
  if (verdictTone.value === 'ready') return 'border-emerald-200 bg-emerald-50/60'
  if (verdictTone.value === 'caution') return 'border-amber-200 bg-amber-50/60'
  if (verdictTone.value === 'loading') return 'border-slate-200 bg-slate-50/60'
  return 'border-rose-200 bg-rose-50/60'
})

const verdictIconClass = computed(() => {
  if (verdictTone.value === 'ready') return 'text-emerald-600'
  if (verdictTone.value === 'caution') return 'text-amber-600'
  if (verdictTone.value === 'loading') return 'text-slate-500 animate-spin'
  return 'text-rose-600'
})

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="min-h-full bg-[#f5f7fb]">
    <div class="mx-auto w-full max-w-[1080px] space-y-3 px-4 py-6 sm:px-6">

      <section class="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
        <div class="flex items-start gap-3">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Target class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">目标</p>
            <h1 class="mt-0.5 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
              训练一个能预测摩擦系数 (μ/COF) 的模型
            </h1>
            <p class="mt-1.5 text-sm leading-6 text-slate-600">
              下面会自动整理你选好的文献数据,做成模型可以直接学习的训练集。整个过程系统会替你决定大部分细节,你只需要确认。
            </p>
          </div>
        </div>
      </section>

      <section v-if="errorMessage" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <div class="flex items-center gap-2">
          <AlertTriangle class="h-4 w-4 shrink-0" />
          <span>{{ errorMessage }}</span>
        </div>
      </section>

      <section v-if="statusMessage && buildingState === 'done'" class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <div class="flex items-center gap-2">
          <Sparkles class="h-4 w-4 shrink-0" />
          <span>{{ statusMessage }}</span>
        </div>
      </section>

      <section v-if="loading && !preview" class="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <Loader2 class="mx-auto h-7 w-7 animate-spin text-slate-400" />
        <p class="mt-3 text-sm font-medium text-slate-600">正在分析你的数据...</p>
        <p class="mt-1 text-xs text-slate-400">通常只需要几秒钟</p>
      </section>

      <template v-else-if="preview && builder">

        <section class="grid grid-cols-3 gap-2">
          <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <BookOpen class="h-3.5 w-3.5" />
              原始记录
            </div>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{{ rawRecordCount }}</p>
            <p class="mt-0.5 text-[11px] leading-4 text-slate-500">来自当前文献库</p>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <CheckCircle2 class="h-3.5 w-3.5" :class="trainingReadyCount >= 10 ? 'text-emerald-600' : 'text-rose-500'" />
              可训练
            </div>
            <p class="mt-1 text-2xl font-semibold tabular-nums" :class="trainingReadyCount >= 10 ? 'text-emerald-700' : 'text-rose-600'">
              {{ trainingReadyCount }}
            </p>
            <p class="mt-0.5 text-[11px] leading-4 text-slate-500">{{ Math.round(readyRatio * 100) }}% 通过体检</p>
          </div>
          <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <XCircle class="h-3.5 w-3.5" :class="droppedCount > 0 ? 'text-slate-500' : 'text-emerald-600'" />
              已自动排除
            </div>
            <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-700">{{ droppedCount }}</p>
            <p class="mt-0.5 text-[11px] leading-4 text-slate-500">缺关键字段或异常</p>
          </div>
        </section>

        <section class="rounded-2xl border p-5" :class="verdictBgClass">
          <div class="flex items-start gap-3">
            <component :is="verdictView.icon" class="mt-0.5 h-6 w-6 shrink-0" :class="verdictIconClass" />
            <div class="min-w-0 flex-1">
              <p class="text-base font-semibold tracking-tight text-slate-950">{{ verdictView.headline }}</p>
              <p class="mt-1 text-sm leading-6 text-slate-700">{{ verdictView.subtext }}</p>

              <ul v-if="verdictTone === 'blocked' && actionIssueCards.length" class="mt-3 space-y-1.5">
                <li
                  v-for="card in actionIssueCards.slice(0, 3)"
                  :key="card.key"
                  class="flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm ring-1 ring-rose-100"
                >
                  <component :is="card.icon" class="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                  <div class="min-w-0">
                    <span class="font-medium text-slate-900">{{ card.title }}</span>
                    <span class="ml-1 text-slate-500">— {{ card.value }} {{ card.unit }}</span>
                  </div>
                </li>
                <li v-if="actionIssueCards.length > 3" class="px-3 py-1 text-xs text-slate-500">
                  还有 {{ actionIssueCards.length - 3 }} 项,在 Review 页可以一起处理。
                </li>
              </ul>

              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  v-if="verdictTone === 'empty' || (verdictTone === 'blocked' && trainingReadyCount < 10)"
                  type="button"
                  class="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                  @click="goExplorer"
                >
                  去数据浏览选记录
                  <ArrowRight class="h-4 w-4" />
                </button>
                <button
                  v-if="verdictTone === 'blocked' && trainingReadyCount >= 10"
                  type="button"
                  class="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                  @click="goReview"
                >
                  去 Review 修问题
                  <ArrowRight class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="canBuild && buildingState !== 'done'" class="rounded-2xl border border-slate-200 bg-white p-5">
          <div class="flex items-center gap-2">
            <Package class="h-4 w-4 text-indigo-600" />
            <h2 class="text-base font-semibold tracking-tight text-slate-950">生成训练数据集</h2>
          </div>
          <p class="mt-1.5 text-sm leading-6 text-slate-600">
            系统会自动整理出两份训练集。基础版样本多、能跑通模型;增强版加入了膜厚字段,适合分析机制。
          </p>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <article class="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <p class="text-[11px] font-bold uppercase tracking-wider text-violet-700">基础版 · Dataset-A</p>
              <p class="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{{ datasetAPersonal?.row_count ?? 0 }}</p>
              <p class="mt-0.5 text-xs text-slate-500">行 · {{ datasetAPersonal?.feature_count ?? 0 }} 个特征</p>
              <p class="mt-2 text-xs leading-5 text-slate-600">先用这个版本训练第一个模型,理解输入和摩擦的关系。</p>
            </article>
            <article class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p class="text-[11px] font-bold uppercase tracking-wider text-emerald-700">增强版 · Dataset-B</p>
              <p class="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{{ datasetBPersonal?.row_count ?? 0 }}</p>
              <p class="mt-0.5 text-xs text-slate-500">行 · {{ datasetBPersonal?.feature_count ?? 0 }} 个特征</p>
              <p class="mt-2 text-xs leading-5 text-slate-600">在基础上加入膜厚 h,适合后续分析机制。</p>
            </article>
          </div>

          <button
            type="button"
            class="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-base font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="buildingState === 'building'"
            @click="autoBuild"
          >
            <Loader2 v-if="buildingState === 'building'" class="h-4 w-4 animate-spin" />
            <Sparkles v-else class="h-4 w-4" />
            {{ buildingState === 'building' ? '正在生成...' : '一键生成两份训练集' }}
          </button>
          <p v-if="buildErrorMessage" class="mt-2 text-xs text-rose-600">{{ buildErrorMessage }}</p>
          <p class="mt-3 text-[11px] leading-5 text-slate-400">
            生成后会保存到工作区,Modeling 页可直接读取。如果想改设置,可以稍后再生成新版本。
          </p>
        </section>

        <section v-if="savedDatasets.length > 0" class="rounded-2xl border border-emerald-200 bg-white p-5">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div class="flex items-center gap-2">
              <CheckCircle2 class="h-4 w-4 text-emerald-600" />
              <h2 class="text-base font-semibold tracking-tight text-slate-950">已保存的训练数据集</h2>
            </div>
            <span class="text-xs font-medium text-slate-500">{{ savedDatasets.length }} 个版本</span>
          </div>

          <ul class="mt-3 space-y-2">
            <li
              v-for="dataset in savedDatasets"
              :key="dataset.id"
              class="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-slate-950">{{ dataset.name }}</p>
                <p class="mt-1 text-xs text-slate-500">
                  {{ dataset.row_count }} 行 · {{ dataset.feature_columns.length }} 个特征 · {{ formatDateTime(dataset.created_at) }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  @click="goTraining(dataset.id)"
                >
                  去 Modeling
                  <ChevronRight class="h-3 w-3" />
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                  :disabled="exportLoadingId === dataset.id"
                  @click="exportSavedDataset(dataset)"
                >
                  {{ exportLoadingId === dataset.id ? '导出中...' : '导出 CSV' }}
                </button>
              </div>
            </li>
          </ul>

          <button
            type="button"
            class="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white transition hover:bg-emerald-500"
            @click="goTraining()"
          >
            去 Modeling 训练模型
            <ArrowRight class="h-4 w-4" />
          </button>
        </section>

        <details
          class="rounded-2xl border border-slate-200 bg-slate-50/50 p-4"
          :open="showDetails"
          @toggle="showDetails = ($event.target as HTMLDetailsElement).open"
        >
          <summary class="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
            <span class="flex items-center gap-2">
              <RotateCcw class="h-3.5 w-3.5" />
              查看系统做了什么
            </span>
            <span class="text-xs font-normal text-slate-400">展开看细节</span>
          </summary>
          <div class="mt-3 space-y-2 border-t border-slate-200 pt-3 text-xs leading-6 text-slate-600">
            <p>· 应用了「平衡模式」预设:覆盖与质量兼顾,要求双离子 SMILES,不主动剔除异常值。</p>
            <p>· 样本来源:{{ selectedSourceMode }}。</p>
            <p>· 自动选择了 {{ retainedFeatureColumns.length }} 个对预测最有帮助的特征(去掉了重复或共线的字段)。</p>
            <p>· 已检查 {{ qualityIssueCards.length }} 类质量问题,排除了 {{ droppedCount }} 条不完整的记录。</p>
            <p v-if="descriptorSummary?.rdkit_enabled">· 已用 RDKit 自动生成离子结构描述符。</p>
            <p v-else>· RDKit 未启用,目前仅使用宏观字段。</p>
          </div>
        </details>

      </template>
    </div>
  </div>
</template>
