<script setup lang="ts">
import { computed, ref } from 'vue'
import { BarChart3, Check, ChevronLeft, ChevronRight, Filter, ImageIcon, Layers3, TriangleAlert } from 'lucide-vue-next'
import { formatColumnLabel } from './formatters'
import type { BuilderSubsetSummary, DescriptorSummary, ScreeningSummary, SubsetKey } from './types'

type ColumnSemantic = {
  title: string
  meaning: string
  explanation: string
  unit: string
  modelHint: string
}

type CorrelationPage = {
  key: SubsetKey
  title: string
  shortTitle: string
  tag: string
  image: string
  summary: string
  caption: string
  frameClass: string
  tagClass: string
}

type SelectionPayload = {
  dataset: SubsetKey
  features: string[]
}

type SensitivityItem = {
  feature: string
  correlation: number
  abs_correlation: number
}

const FEATURE_ALIASES: Record<string, string[]> = {
  MW_cat: ['Cation_MolWt'],
  logP_cat: ['Cation_MolLogP'],
  N_rot_cat: ['Cation_NumRotatableBonds'],
  Bertz_cat: ['Cation_BertzCT'],
  BalJ_cat: ['Cation_BalabanJ'],
  TPSA_cat: ['Cation_TPSA'],
  N_HA_cat: ['Cation_NumHAcceptors'],
  N_HD_cat: ['Cation_NumHDonors'],
  MW_an: ['Anion_MolWt'],
  logP_an: ['Anion_MolLogP'],
  Bertz_an: ['Anion_BertzCT'],
  TPSA_an: ['Anion_TPSA'],
  BalJ_an: ['Anion_BalabanJ'],
  theta_s: ['θ_s'],
  Rq: ['Surface_Roughness'],
  velocity: ['Speed'],
  T: ['Temperature'],
  I_H2O: ['Water_Content'],
  h: ['Film_Thickness'],
  Cation_MolWt: ['MW_cat'],
  Cation_MolLogP: ['logP_cat'],
  Cation_NumRotatableBonds: ['N_rot_cat'],
  Cation_BertzCT: ['Bertz_cat'],
  Cation_BalabanJ: ['BalJ_cat'],
  Cation_TPSA: ['TPSA_cat'],
  Cation_NumHAcceptors: ['N_HA_cat'],
  Cation_NumHDonors: ['N_HD_cat'],
  Anion_MolWt: ['MW_an'],
  Anion_MolLogP: ['logP_an'],
  Anion_BertzCT: ['Bertz_an'],
  Anion_TPSA: ['TPSA_an'],
  Anion_BalabanJ: ['BalJ_an'],
  θ_s: ['theta_s'],
  Surface_Roughness: ['Rq'],
  Speed: ['velocity'],
  Temperature: ['T'],
  Water_Content: ['I_H2O'],
  Film_Thickness: ['h'],
}

const FALLBACK_SENSITIVITY_MAP: Record<SubsetKey, SensitivityItem[]> = {
  dataset_a: [
    { feature: 'N_HD_cat', correlation: 0.4996, abs_correlation: 0.4996 },
    { feature: 'TPSA_cat', correlation: 0.4401, abs_correlation: 0.4401 },
    { feature: 'theta_s', correlation: -0.2722, abs_correlation: 0.2722 },
    { feature: 'Bertz_an', correlation: -0.2641, abs_correlation: 0.2641 },
    { feature: 'I_H2O', correlation: 0.237, abs_correlation: 0.237 },
  ],
  dataset_b: [
    { feature: 'N_qN_cat', correlation: 0.4335, abs_correlation: 0.4335 },
    { feature: 'Bertz_cat', correlation: -0.408, abs_correlation: 0.408 },
    { feature: 'Rq', correlation: -0.3637, abs_correlation: 0.3637 },
    { feature: 'logP_an', correlation: -0.3634, abs_correlation: 0.3634 },
    { feature: 'velocity', correlation: 0.3583, abs_correlation: 0.3583 },
  ],
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

const currentPageIndex = ref(0)
const activeDescriptorName = ref('')

const correlationPages: CorrelationPage[] = [
  {
    key: 'dataset_a',
    title: 'Dataset-A 相关系数视图',
    shortTitle: 'Dataset-A',
    tag: '无膜厚',
    image: '/generated/dataset-a-correlation-heatmap.png',
    summary: '适合先确定通用特征骨架，再决定是否需要额外引入膜厚机制变量。',
    caption: '热图来自 no film dataset 0312.csv。',
    frameClass: 'from-violet-500/14 via-fuchsia-500/8 to-white',
    tagClass: 'bg-violet-100 text-violet-700',
  },
  {
    key: 'dataset_b',
    title: 'Dataset-B 相关系数视图',
    shortTitle: 'Dataset-B',
    tag: '含膜厚',
    image: '/generated/dataset-b-correlation-heatmap.png',
    summary: '适合检查含膜厚条件下哪些变量必须保留，哪些可以压缩为代表特征。',
    caption: '热图来自 film dataset0312.csv。',
    frameClass: 'from-sky-500/14 via-cyan-500/8 to-white',
    tagClass: 'bg-sky-100 text-sky-700',
  },
]

const semanticMap: Record<string, ColumnSemantic> = {
  r_cat: {
    title: '阳离子半径',
    meaning: 'Cation effective radius',
    explanation: '反映阳离子在界面中的空间尺寸和堆积能力。',
    unit: 'Å',
    modelHint: '常与分子量、可旋转键和疏水性形成尺寸共线块。',
  },
  logP_cat: {
    title: '阳离子 LogP',
    meaning: 'Cation MolLogP',
    explanation: '表征阳离子的疏水性或亲油性。',
    unit: '/',
    modelHint: '适合在尺寸簇中代表疏水性差异。',
  },
  MW_cat: {
    title: '阳离子分子量',
    meaning: 'Cation molecular weight',
    explanation: '反映阳离子整体质量与尺寸。',
    unit: 'g/mol',
    modelHint: '若已经保留半径或柔性指标，通常不必整簇重复保留。',
  },
  N_rot_cat: {
    title: '阳离子可旋转键',
    meaning: 'Cation rotatable bond count',
    explanation: '反映阳离子的柔性与构象自由度。',
    unit: '/',
    modelHint: '适合补充“柔性”信息，但要注意与分子量耦合。',
  },
  Bertz_cat: {
    title: '阳离子复杂度',
    meaning: 'Cation Bertz complexity index',
    explanation: '衡量阳离子拓扑结构复杂程度。',
    unit: '/',
    modelHint: '更适合作为结构复杂性的代表项。',
  },
  N_qN_cat: {
    title: '季铵氮数',
    meaning: 'Cation quaternary nitrogen count',
    explanation: '反映带正电中心的数量。',
    unit: '/',
    modelHint: '对界面吸附解释价值较强。',
  },
  TPSA_cat: {
    title: '阳离子 TPSA',
    meaning: 'Cation topological polar surface area',
    explanation: '反映极性位点暴露程度与潜在界面作用能力。',
    unit: 'Å²',
    modelHint: '适合代表极性维度。',
  },
  BalJ_cat: {
    title: '阳离子 Balaban J',
    meaning: 'Cation Balaban J index',
    explanation: '用于补充分子图拓扑和分支信息。',
    unit: '/',
    modelHint: '更适合作为补充特征，而不是首选代表项。',
  },
  N_HA_cat: {
    title: '阳离子受氢位点',
    meaning: 'Cation H-bond acceptor count',
    explanation: '表示可接受氢键的位点数。',
    unit: '/',
    modelHint: '可与 TPSA 联合判断极性是否真正重要。',
  },
  N_HD_cat: {
    title: '阳离子供氢位点',
    meaning: 'Cation H-bond donor count',
    explanation: '表示可提供氢键的位点数。',
    unit: '/',
    modelHint: '如果进入高敏感列表，通常值得优先保留。',
  },
  r_an: {
    title: '阴离子半径',
    meaning: 'Anion effective radius',
    explanation: '反映阴离子的空间尺寸与界面排布特征。',
    unit: 'Å',
    modelHint: '常与极性和疏水性共同构成阴离子共线簇。',
  },
  logP_an: {
    title: '阴离子 LogP',
    meaning: 'Anion MolLogP',
    explanation: '表征阴离子的疏水性或亲油性。',
    unit: '/',
    modelHint: '在含膜厚数据集中通常值得优先关注。',
  },
  MW_an: {
    title: '阴离子分子量',
    meaning: 'Anion molecular weight',
    explanation: '区分小阴离子与体积更大的有机阴离子。',
    unit: 'g/mol',
    modelHint: '若已保留疏水性或复杂度指标，可评估是否重复。',
  },
  Bertz_an: {
    title: '阴离子复杂度',
    meaning: 'Anion Bertz complexity index',
    explanation: '反映阴离子拓扑结构复杂程度。',
    unit: '/',
    modelHint: '适合代表结构复杂性。',
  },
  TPSA_an: {
    title: '阴离子 TPSA',
    meaning: 'Anion topological polar surface area',
    explanation: '体现阴离子极性区域大小和潜在界面作用能力。',
    unit: 'Å²',
    modelHint: '适合代表阴离子的极性维度。',
  },
  BalJ_an: {
    title: '阴离子 Balaban J',
    meaning: 'Anion Balaban J index',
    explanation: '用于补充分子图拓扑信息。',
    unit: '/',
    modelHint: '一般作为补充而非主代表特征。',
  },
  Y_s: {
    title: '表面自由能',
    meaning: 'Solid surface free energy',
    explanation: '反映固体表面对润湿和吸附的热力学倾向。',
    unit: 'J/m²',
    modelHint: '表面变量往往彼此共线，保留一个即可承载主要信息。',
  },
  σ_s: {
    title: '表面电荷密度',
    meaning: 'Solid surface charge density',
    explanation: '影响离子在界面的静电吸附和排布。',
    unit: 'C/m²',
    modelHint: '解释电场相关机制时价值更高。',
  },
  θ_s: {
    title: '接触角',
    meaning: 'Static contact angle',
    explanation: '用于表征表面的润湿性。',
    unit: '°',
    modelHint: '常与自由能、粗糙度形成表面信息簇。',
  },
  Rq: {
    title: '表面粗糙度',
    meaning: 'RMS surface roughness',
    explanation: '反映固体表面的微观起伏程度。',
    unit: 'nm',
    modelHint: '若对摩擦响应敏感，通常值得单独保留。',
  },
  I_ss: {
    title: '不锈钢基底指示',
    meaning: 'Stainless-steel substrate indicator',
    explanation: '表示样本是否来自不锈钢基底。',
    unit: '/',
    modelHint: '属于类别背景变量，适合保留为上下文特征。',
  },
  velocity: {
    title: '滑动速度',
    meaning: 'Sliding velocity',
    explanation: '直接影响摩擦测试的剪切条件。',
    unit: 'μm/s',
    modelHint: '属于工况变量，通常建议保留。',
  },
  Potential: {
    title: '偏压',
    meaning: 'Applied potential',
    explanation: '改变界面电场和离子排布。',
    unit: 'V',
    modelHint: '如果实验中存在电压变化，通常应保留。',
  },
  I_H2O: {
    title: '含水指示',
    meaning: 'Water-presence indicator',
    explanation: '表征体系中是否存在水或含水状态差异。',
    unit: '/',
    modelHint: '适合作为状态变量保留。',
  },
  x_IL: {
    title: '离子液体摩尔分数',
    meaning: 'Ionic-liquid molar fraction',
    explanation: '表征混合体系中离子液体的占比。',
    unit: '%',
    modelHint: '混合体系建模时通常不建议省略。',
  },
  Film_Thickness: {
    title: '膜厚 h',
    meaning: 'Interfacial film thickness',
    explanation: '描述受限液膜厚度，是含膜厚数据集中的关键机制变量。',
    unit: 'nm',
    modelHint: '如果目标是解释成膜机制，通常不建议删除。',
  },
  Cation_MolWt: {
    title: '阳离子分子量',
    meaning: 'Cation molecular weight',
    explanation: '反映阳离子整体尺寸与质量。',
    unit: 'g/mol',
    modelHint: '常与其他尺寸类特征共线。',
  },
  Cation_MolLogP: {
    title: '阳离子 LogP',
    meaning: 'Cation MolLogP',
    explanation: '表征阳离子疏水性。',
    unit: '/',
    modelHint: '适合代表疏水性维度。',
  },
  Cation_TPSA: {
    title: '阳离子 TPSA',
    meaning: 'Cation topological polar surface area',
    explanation: '反映极性暴露程度。',
    unit: 'Å²',
    modelHint: '适合代表极性维度。',
  },
  Cation_NumHDonors: {
    title: '阳离子供氢位点',
    meaning: 'Cation hydrogen bond donor count',
    explanation: '表示阳离子供氢位点数量。',
    unit: '/',
    modelHint: '解释界面相互作用时常有价值。',
  },
  Cation_NumHAcceptors: {
    title: '阳离子受氢位点',
    meaning: 'Cation hydrogen bond acceptor count',
    explanation: '表示阳离子受氢位点数量。',
    unit: '/',
    modelHint: '可与 TPSA 一起判断极性是否重要。',
  },
  Anion_MolWt: {
    title: '阴离子分子量',
    meaning: 'Anion molecular weight',
    explanation: '反映阴离子整体尺寸与质量。',
    unit: 'g/mol',
    modelHint: '可与疏水性代表项二选一。',
  },
  Anion_MolLogP: {
    title: '阴离子 LogP',
    meaning: 'Anion MolLogP',
    explanation: '表征阴离子疏水性。',
    unit: '/',
    modelHint: '含膜厚数据集里通常值得优先保留。',
  },
  Anion_TPSA: {
    title: '阴离子 TPSA',
    meaning: 'Anion topological polar surface area',
    explanation: '反映阴离子极性区域大小。',
    unit: 'Å²',
    modelHint: '适合代表阴离子极性。',
  },
  Surface_Roughness: {
    title: '表面粗糙度',
    meaning: 'Surface roughness',
    explanation: '反映固体表面的微观起伏程度。',
    unit: 'nm',
    modelHint: '若目标对表面形貌敏感，通常建议保留。',
  },
}

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
const currentSelectedSet = computed(() => new Set(currentSelectedFeatures.value))
const targetLabel = computed(() => props.screeningSummary?.target_label || formatColumnLabel(currentSummary.value?.target_column || 'target'))

const precleanFunnelStats = computed(() => {
  const initial = (props.descriptorSummary?.descriptor_count || 0) + (props.descriptorSummary?.macro_feature_count || 0)
  const final = props.screeningSummary?.feature_count || currentAvailableColumns.value.length
  const removed = Math.max(0, initial - final)
  return {
    initial,
    removed,
    final,
    analyzableRows: props.screeningSummary?.analyzable_rows || currentSummary.value?.row_count || 0,
  }
})

const precleanRetentionRatio = computed(() => {
  if (precleanFunnelStats.value.initial <= 0) return 0
  return precleanFunnelStats.value.final / precleanFunnelStats.value.initial
})

const precleanRemovedLabel = computed(() => {
  if (precleanFunnelStats.value.removed <= 0) return '本轮没有识别出需要自动剔除的字段'
  return `已自动剔除 ${precleanFunnelStats.value.removed} 列不可分析字段`
})

const precleanSampleStatus = computed(() => {
  if (precleanFunnelStats.value.analyzableRows > 0) {
    return `${precleanFunnelStats.value.analyzableRows} 行样本可直接参与相关性计算`
  }
  return '当前预览没有返回可直接计算相关性的样本，下面的敏感度排行会回退到离线分析结果'
})

function canonicalFeatureKey(feature: string) {
  return feature
    .toLowerCase()
    .replace(/^cation_/, 'cat_')
    .replace(/^anion_/, 'an_')
    .replace(/molwt/g, 'mw')
    .replace(/mollogp/g, 'logp')
    .replace(/numrotatablebonds/g, 'nrot')
    .replace(/bertzct/g, 'bertz')
    .replace(/balabanj/g, 'balj')
    .replace(/numhacceptors/g, 'nha')
    .replace(/numhdonors/g, 'nhd')
    .replace(/topologicalpolarsurfacearea/g, 'tpsa')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('-')
}

function resolveFeatureForCurrent(feature: string) {
  if (currentAvailableSet.value.has(feature)) return feature

  const aliases = FEATURE_ALIASES[feature] || []
  const aliased = currentAvailableColumns.value.find((column) => aliases.includes(column))
  if (aliased) return aliased

  const canonical = canonicalFeatureKey(feature)
  return currentAvailableColumns.value.find((column) => canonicalFeatureKey(column) === canonical) || null
}

const globalStrongestFeatures = computed(() => (props.screeningSummary?.strongest_to_target || []).slice(0, 5))
const fallbackStrongestFeatures = computed(() => FALLBACK_SENSITIVITY_MAP[currentKey.value] || [])

function normalizeSensitivityItems(items: SensitivityItem[]) {
  const seen = new Set<string>()
  return items
    .map((item) => {
      const resolvedFeature = resolveFeatureForCurrent(item.feature) || item.feature
      return {
        ...item,
        feature: resolvedFeature,
        abs_correlation: Number(Math.abs(item.correlation).toFixed(4)),
      }
    })
    .filter((item) => {
      if (!item.feature || seen.has(item.feature)) return false
      seen.add(item.feature)
      return true
    })
    .slice(0, 5)
}

const heatmapStrongestFeatures = computed(() => {
  const heatmap = props.screeningSummary?.heatmap
  if (!heatmap?.features?.length || !heatmap.matrix?.length) return []

  const targetIndex = heatmap.features.findIndex((feature) => feature === currentSummary.value?.target_column)
  if (targetIndex < 0) return []

  return heatmap.features
    .map((feature, index) => {
      if (index === targetIndex) return null
      const resolvedFeature = resolveFeatureForCurrent(feature) || feature
      const correlation = heatmap.matrix[targetIndex]?.[index]
      if (correlation == null) return null
      return {
        feature: resolvedFeature,
        correlation,
        abs_correlation: Math.abs(correlation),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.abs_correlation - left.abs_correlation)
    .slice(0, 5)
})

function numericValue(value: unknown) {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function pairwisePearson(values: Array<number | null>, targetValues: Array<number | null>) {
  const pairs: Array<[number, number]> = []
  for (let index = 0; index < values.length; index += 1) {
    const left = values[index]
    const right = targetValues[index]
    if (left == null || right == null) continue
    pairs.push([left, right])
  }

  if (pairs.length < 3) return null

  const xs = pairs.map((pair) => pair[0])
  const ys = pairs.map((pair) => pair[1])
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length

  let numerator = 0
  let sumSquareX = 0
  let sumSquareY = 0
  for (let index = 0; index < pairs.length; index += 1) {
    const dx = xs[index]! - meanX
    const dy = ys[index]! - meanY
    numerator += dx * dy
    sumSquareX += dx * dx
    sumSquareY += dy * dy
  }

  if (sumSquareX === 0 || sumSquareY === 0) return null
  return numerator / Math.sqrt(sumSquareX * sumSquareY)
}

const derivedCurrentStrongestFeatures = computed(() => {
  const summary = currentSummary.value
  const targetColumn = summary?.target_column
  const candidateRows = summary?.rows?.length ? summary.rows : (summary?.preview_rows || [])
  if (!candidateRows.length || !targetColumn) return []

  const targetValues = candidateRows.map((row) => numericValue(row[targetColumn]))
  return currentAvailableColumns.value
    .map((feature) => {
      const featureValues = candidateRows.map((row) => numericValue(row[feature]))
      const correlation = pairwisePearson(featureValues, targetValues)
      if (correlation == null) return null
      return {
        feature,
        correlation: Number(correlation.toFixed(4)),
        abs_correlation: Number(Math.abs(correlation).toFixed(4)),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.abs_correlation - left.abs_correlation)
    .slice(0, 5)
})

const measuredStrongestFeatures = computed(() => {
  if (derivedCurrentStrongestFeatures.value.length) {
    return normalizeSensitivityItems(derivedCurrentStrongestFeatures.value)
  }

  const mapped = normalizeSensitivityItems((props.screeningSummary?.strongest_to_target || [])
    .map((item) => {
      const resolvedFeature = resolveFeatureForCurrent(item.feature)
      return resolvedFeature ? { ...item, feature: resolvedFeature } : null
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
  )

  if (mapped.length) return mapped
  if (heatmapStrongestFeatures.value.length) return normalizeSensitivityItems(heatmapStrongestFeatures.value)
  if (globalStrongestFeatures.value.length) return normalizeSensitivityItems(globalStrongestFeatures.value)
  return []
})

const suggestedStrongestFeatures = computed(() => {
  const fromFallback = normalizeSensitivityItems(fallbackStrongestFeatures.value)
  if (fromFallback.length) return fromFallback

  const fallbackByFeature = new Map(fromFallback.map((item) => [item.feature, item]))

  const fromRecommended = normalizeSensitivityItems(
    currentRecommendedFeatures.value.map((feature, index) => {
      const resolvedFeature = resolveFeatureForCurrent(feature) || feature
      const matchedFallback = fallbackByFeature.get(resolvedFeature)
      const placeholder = Number(Math.max(0.18, 0.38 - index * 0.04).toFixed(4))
      return matchedFallback || {
        feature: resolvedFeature,
        correlation: placeholder,
        abs_correlation: placeholder,
      }
    }),
  )
  if (fromRecommended.length) return fromRecommended

  return normalizeSensitivityItems(
    currentAvailableColumns.value.slice(0, 5).map((feature, index) => {
      const placeholder = Number(Math.max(0.18, 0.38 - index * 0.04).toFixed(4))
      return {
        feature,
        correlation: placeholder,
        abs_correlation: placeholder,
      }
    }),
  )
})

const hasMeasuredStrongestFeatures = computed(() => measuredStrongestFeatures.value.length > 0)

const currentStrongestFeatures = computed(() => {
  if (hasMeasuredStrongestFeatures.value) {
    return measuredStrongestFeatures.value
  }
  return suggestedStrongestFeatures.value
})

const currentMaxAbsCorrelation = computed(() => {
  return currentStrongestFeatures.value.reduce((max, item) => Math.max(max, Math.abs(item.correlation)), 0)
})

const sensitivityAdvice = computed(() => {
  if (!hasMeasuredStrongestFeatures.value && currentStrongestFeatures.value.length) {
    return '当前页暂无可稳定计算的 Pearson 结果，已回退为 0312 CSV 离线分析得到的目标敏感度 Top 5。可以先参考这份排序手动保留，再继续进入导出。'
  }

  const recommendation = props.screeningSummary?.nonlinear_recommendation
  if (recommendation?.recommended) {
    const algorithms = recommendation.algorithms.length ? `，推荐优先尝试 ${recommendation.algorithms.join(' / ')}` : ''
    return `当前最高线性相关系数仅为 ${currentMaxAbsCorrelation.value.toFixed(2)}，说明目标更可能由多因素非线性耦合决定${algorithms}。`
  }

  if (currentStrongestFeatures.value.length) {
    return `当前页最高线性相关系数约为 ${currentMaxAbsCorrelation.value.toFixed(2)}，可以先保留这些高敏感特征，再结合共线簇进行压缩。`
  }

  return '当前页暂时没有足够的线性相关结果，建议先检查可分析特征和样本覆盖。'
})

const currentClusterBlocks = computed(() => {
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

const currentDescriptor = computed(() => {
  const fallback = currentAvailableColumns.value[0] || ''
  const name = activeDescriptorName.value && (currentAvailableSet.value.has(activeDescriptorName.value) || Boolean(semanticMap[activeDescriptorName.value]))
    ? activeDescriptorName.value
    : fallback

  if (name && name !== activeDescriptorName.value) {
    activeDescriptorName.value = name
  }

  const semantic = semanticMap[name]
  return {
    name,
    title: semantic?.title || formatColumnLabel(name),
    meaning: semantic?.meaning || formatColumnLabel(name),
    explanation: semantic?.explanation || '该字段来自当前数据集构建流程，可作为下游模型的独立输入特征。',
    unit: semantic?.unit || '/',
    modelHint: semantic?.modelHint || '如果它不处在明显共线簇中，可以按业务解释价值决定是否保留。',
  }
})

const currentDescriptorContext = computed(() => {
  const descriptorName = currentDescriptor.value.name
  if (!descriptorName) return '当前页暂无可解释的特征。'

  const cluster = currentClusterBlocks.value.find((block) => block.features.includes(descriptorName))
  if (cluster) return `当前页中它位于“${cluster.title}”这一共线块。`

  const sensitivity = currentStrongestFeatures.value.find((item) => item.feature === descriptorName)
  if (sensitivity) {
    return `当前页里它进入了目标敏感性前列，相关系数约为 ${sensitivity.correlation >= 0 ? '+' : ''}${sensitivity.correlation.toFixed(4)}。`
  }

  return '当前页里它不是最突出的敏感字段，更适合作为补充背景变量。'
})

const quickJumpFeatures = computed(() => {
  return currentStrongestFeatures.value
    .map((item) => item.feature)
    .filter((feature) => currentAvailableSet.value.has(feature))
})

function formatMetric(value: number, digits = 3) {
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

function strengthBarWidth(value: number) {
  const max = Math.max(...currentStrongestFeatures.value.map((item) => Math.abs(item.correlation)), 0.001)
  return `${(Math.abs(value) / max) * 100}%`
}

function suggestedBarWidth(index: number) {
  return `${Math.max(36, 100 - index * 14)}%`
}

function goPrev() {
  currentPageIndex.value = (currentPageIndex.value - 1 + correlationPages.length) % correlationPages.length
}

function goNext() {
  currentPageIndex.value = (currentPageIndex.value + 1) % correlationPages.length
}

function updateCurrentSelection(features: string[]) {
  emit('update:selectedRepresentativeFeatures', {
    dataset: currentKey.value,
    features,
  })
}

function toggleFeature(feature: string) {
  const next = new Set(currentSelectedFeatures.value)
  if (next.has(feature)) {
    next.delete(feature)
  } else {
    next.add(feature)
  }
  updateCurrentSelection(Array.from(next))
}

function applyRecommendedForCurrent() {
  updateCurrentSelection([...currentRecommendedFeatures.value])
}

function selectAllForCurrent() {
  updateCurrentSelection([...currentAvailableColumns.value])
}

function clearCurrentSelection() {
  updateCurrentSelection([])
}

function focusDescriptor(feature: string) {
  activeDescriptorName.value = feature
}
</script>

<template>
  <div class="space-y-6">
    <section class="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_28%),linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-7">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="max-w-4xl">
          <div class="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600">
            <Layers3 class="h-3.5 w-3.5" />
            Representative Feature Retention
          </div>
          <h2 class="mt-4 text-[2.4rem] font-black tracking-[-0.04em] text-slate-950">代表特征保留台</h2>
          <p class="mt-3 max-w-3xl text-base leading-8 text-slate-600">
            第二步不再只是看热图。你可以直接决定当前数据集下一步真正保留哪些代表特征，这个选择会继续传递到导出和保存。
          </p>
        </div>

        <div class="grid min-w-[300px] gap-3 sm:grid-cols-2">
          <div class="rounded-[24px] border border-slate-200 bg-white/90 px-5 py-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">当前数据集</p>
            <p class="mt-2 text-3xl font-black tracking-tight text-slate-950">{{ currentPage.shortTitle }}</p>
            <p class="mt-1 text-xs leading-5 text-slate-500">{{ currentSummary?.row_count ?? 0 }} 行样本</p>
          </div>
          <div class="rounded-[24px] border border-slate-200 bg-slate-950 px-5 py-4 text-white">
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">当前已保留</p>
            <p class="mt-2 text-3xl font-black tracking-tight">{{ currentSelectedFeatures.length }}</p>
            <p class="mt-1 text-xs leading-5 text-white/70">下一步只会导出这些特征列。</p>
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)_320px]">
      <div class="space-y-6">
        <article class="rounded-[30px] border border-slate-200 bg-white p-6">
          <div class="flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Filter class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-950">1. 自动预清洗漏斗</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">恢复预清洗视角，先看特征如何从原始描述符池进入相关性分析池。</p>
            </div>
          </div>

          <div class="mt-6 space-y-3">
            <div class="rounded-2xl bg-indigo-50/80 px-4 py-4">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm font-semibold text-slate-950">初始描述符提取（RDKit + 物理量）</p>
                  <p class="mt-1 text-xs text-slate-500">来自当前构建流程的完整候选特征池</p>
                </div>
                <div class="text-right">
                  <p class="text-3xl font-black tracking-tight text-slate-950">{{ precleanFunnelStats.initial }}</p>
                  <p class="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">候选特征</p>
                </div>
              </div>

              <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/80">
                <div class="h-full rounded-full bg-indigo-500" :style="{ width: `${Math.max(8, precleanRetentionRatio * 100)}%` }"></div>
              </div>

              <div class="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-500">
                <span>保留比例</span>
                <span>{{ Math.round(precleanRetentionRatio * 100) }}%</span>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <div>
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-sm font-semibold text-slate-950">自动剔除不可分析字段</p>
                    <p class="mt-1 text-xs text-slate-500">合并常量列、缺失过高列和无法稳定计算相关性的字段</p>
                  </div>
                  <div class="text-right">
                    <p class="text-2xl font-black tracking-tight" :class="precleanFunnelStats.removed > 0 ? 'text-rose-500' : 'text-emerald-600'">
                      {{ precleanFunnelStats.removed }}
                    </p>
                    <p class="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">已剔除</p>
                  </div>
                </div>
                <p class="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{{ precleanRemovedLabel }}</p>
              </div>
            </div>

            <div class="rounded-2xl bg-slate-950 px-4 py-4 text-white">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm font-semibold">进入相关性分析池</p>
                  <p class="mt-1 text-xs text-white/70">当前可进入相关性筛查的特征列</p>
                </div>
                <div class="text-right">
                  <p class="text-3xl font-black tracking-tight">{{ precleanFunnelStats.final }}</p>
                  <p class="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">保留特征</p>
                </div>
              </div>

              <div class="mt-4 rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">样本状态</p>
                <p class="mt-2 text-xs leading-5 text-white/80">{{ precleanSampleStatus }}</p>
              </div>
            </div>
          </div>
        </article>

        <article class="rounded-[30px] border border-slate-200 bg-white p-6">
          <div class="flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <BarChart3 class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-950">2. 目标敏感度排行（TOP 5）</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">展示当前页可分析特征里，与 {{ targetLabel }} 的 Pearson 线性相关性最显著的变量。</p>
            </div>
          </div>

          <div v-if="currentStrongestFeatures.length" class="mt-6 space-y-3">
            <div v-if="!hasMeasuredStrongestFeatures" class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              当前页没有足够样本计算 Pearson，下面改为展示 0312 CSV 离线分析得到的目标敏感度 Top 5。
            </div>

            <div v-for="(item, index) in currentStrongestFeatures" :key="item.feature" class="rounded-2xl bg-slate-50 px-4 py-3">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <button type="button" class="text-left text-sm font-semibold text-slate-950 transition hover:text-indigo-700" @click="focusDescriptor(item.feature)">
                    {{ item.feature }}
                  </button>
                  <p class="mt-1 text-xs text-slate-500">{{ formatColumnLabel(item.feature) }}</p>
                </div>
                <p v-if="hasMeasuredStrongestFeatures" class="text-sm font-black" :class="item.correlation >= 0 ? 'text-rose-600' : 'text-cyan-700'">
                  {{ item.correlation >= 0 ? '+' : '' }}{{ formatMetric(item.correlation, 4) }}
                </p>
                <span v-else class="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                  离线分析
                </span>
              </div>
              <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  class="h-full rounded-full"
                  :class="hasMeasuredStrongestFeatures ? (item.correlation >= 0 ? 'bg-rose-500' : 'bg-cyan-500') : 'bg-emerald-500'"
                  :style="{ width: hasMeasuredStrongestFeatures ? strengthBarWidth(item.correlation) : suggestedBarWidth(index) }"
                ></div>
              </div>
            </div>
          </div>

          <div v-else class="mt-6 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
            当前页还没有可用的目标敏感性结果。
          </div>

          <div class="mt-6 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white text-amber-600">
                <TriangleAlert class="h-4 w-4" />
              </div>
              <div>
                <p class="text-sm font-semibold text-amber-900">当前页建模提示</p>
                <p class="mt-2 text-sm leading-6 text-amber-900/90">{{ sensitivityAdvice }}</p>
              </div>
            </div>
          </div>
        </article>
      </div>

      <article class="rounded-[30px] border border-slate-200 bg-white p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
              <ImageIcon class="h-5 w-5" />
            </div>
            <div>
              <p class="text-sm font-semibold text-slate-950">3. 相关系数分页视图</p>
              <p class="mt-1 text-xs leading-5 text-slate-500">点击前后按钮切换 Dataset-A / Dataset-B，查看当前数据集上下文。</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button type="button" class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" @click="goPrev">
              <ChevronLeft class="h-4 w-4" />
            </button>
            <button type="button" class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" @click="goNext">
              <ChevronRight class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="mt-6 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#fbfcff_0%,#f8fafc_100%)] p-4">
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-white/90 px-4 py-3 ring-1 ring-slate-200/70">
            <div class="flex items-center gap-3">
              <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="currentPage.tagClass">{{ currentPage.tag }}</span>
              <div>
                <p class="text-sm font-black text-slate-950">{{ currentPage.title }}</p>
                <p class="mt-1 text-xs leading-5 text-slate-500">{{ currentPage.summary }}</p>
              </div>
            </div>
          </div>

          <div class="mt-4 overflow-hidden rounded-[24px] bg-gradient-to-br p-3" :class="currentPage.frameClass">
            <img :src="currentPage.image" :alt="currentPage.title" class="w-full rounded-[20px] bg-white object-contain shadow-[0_20px_60px_rgba(15,23,42,0.08)]" />
          </div>
        </div>

        <p class="mt-4 text-xs leading-6 text-slate-500">{{ currentPage.caption }}</p>

        <div v-if="currentClusterBlocks.length" class="mt-6 grid gap-4 xl:grid-cols-2">
          <div
            v-for="block in currentClusterBlocks"
            :key="`${block.title}-${block.features.join('-')}`"
            class="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4"
          >
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{{ currentPage.shortTitle }}</p>
              <span class="text-xs font-black" :class="block.tone">{{ block.correlation }}</span>
            </div>
            <h4 class="mt-2 text-lg font-black tracking-tight text-slate-950">{{ block.title }}</h4>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="feature in block.features"
                :key="feature"
                type="button"
                class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                @click="focusDescriptor(feature)"
              >
                {{ feature }}
              </button>
            </div>
          </div>
        </div>

        <section class="mt-6 rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#fffefd_0%,#f9fbff_100%)] p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">3. 当前数据集建议保留代表特征</p>
              <h3 class="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950">{{ currentPage.shortTitle }} 保留清单</h3>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                这里的勾选会直接传给下一步“分流与导出”。你可以先应用系统建议，再手动增删。
              </p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">推荐保留</p>
                <p class="mt-2 text-2xl font-black tracking-tight text-slate-950">{{ currentRecommendedFeatures.length }}</p>
              </div>
              <div class="rounded-[22px] border border-slate-200 bg-slate-950 px-4 py-4 text-white">
                <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">当前保留</p>
                <p class="mt-2 text-2xl font-black tracking-tight">{{ currentSelectedFeatures.length }}</p>
              </div>
            </div>
          </div>

          <div class="mt-5 flex flex-wrap gap-3">
            <button type="button" class="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800" @click="applyRecommendedForCurrent">
              应用当前建议
            </button>
            <button type="button" class="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="selectAllForCurrent">
              当前数据集全选
            </button>
            <button type="button" class="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" @click="clearCurrentSelection">
              清空当前选择
            </button>
          </div>

          <div v-if="currentAvailableColumns.length" class="mt-6 grid gap-3 md:grid-cols-2">
            <button
              v-for="feature in currentAvailableColumns"
              :key="feature"
              type="button"
              class="rounded-[22px] border px-4 py-4 text-left transition"
              :class="currentSelectedSet.has(feature) ? 'border-emerald-200 bg-emerald-50/80' : 'border-slate-200 bg-white hover:bg-slate-50'"
              @click="toggleFeature(feature)"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-black text-slate-950">{{ feature }}</p>
                    <span
                      v-if="currentRecommendedFeatures.includes(feature)"
                      class="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-700"
                    >
                      推荐
                    </span>
                  </div>
                  <p class="mt-1 text-sm text-slate-600">{{ semanticMap[feature]?.title || formatColumnLabel(feature) }}</p>
                </div>
                <span class="inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-black" :class="currentSelectedSet.has(feature) ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'">
                  <Check v-if="currentSelectedSet.has(feature)" class="h-4 w-4" />
                  <span v-else>+</span>
                </span>
              </div>
            </button>
          </div>

          <div v-else class="mt-6 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
            当前数据集还没有可供选择的特征列。
          </div>
        </section>
      </article>

      <div class="space-y-6">
        <article class="sticky top-4 min-h-[620px] overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f7f8fc_100%)] shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <div class="border-b border-slate-200 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.22),transparent_34%),radial-gradient(circle_at_top_left,rgba(99,102,241,0.16),transparent_28%),linear-gradient(180deg,#fffefd_0%,#ffffff_100%)] px-5 py-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">4. Descriptor Atlas</p>
                <h3 class="mt-2 text-xl font-black tracking-[-0.04em] text-slate-950">描述符语义地图</h3>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-right">
                <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">当前焦点</p>
                <p class="mt-1 text-sm font-black text-indigo-600">{{ currentDescriptor.name || '--' }}</p>
              </div>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-600">
              右侧负责解释字段含义，左侧和中间负责帮助你决定“留还是删”。
            </p>
          </div>

          <div class="space-y-5 px-5 py-5">
            <div class="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_36px_rgba(15,23,42,0.05)]">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{{ currentDescriptor.title }}</p>
                  <h4 class="mt-2 text-[1.85rem] font-black tracking-[-0.05em] text-slate-950">{{ currentDescriptor.name || '--' }}</h4>
                  <p class="mt-2 text-sm text-slate-500">{{ currentDescriptor.meaning }}</p>
                </div>
                <span class="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">单位 {{ currentDescriptor.unit }}</span>
              </div>

              <div class="mt-5 space-y-4">
                <div class="rounded-[22px] bg-slate-50 px-4 py-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">含义解释</p>
                  <p class="mt-2 text-sm leading-7 text-slate-700">{{ currentDescriptor.explanation }}</p>
                </div>
                <div class="rounded-[22px] bg-indigo-50 px-4 py-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">建模提示</p>
                  <p class="mt-2 text-sm leading-7 text-slate-700">{{ currentDescriptor.modelHint }}</p>
                </div>
                <div class="rounded-[22px] bg-amber-50 px-4 py-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-600">当前页上下文</p>
                  <p class="mt-2 text-sm leading-7 text-slate-700">{{ currentDescriptorContext }}</p>
                </div>
              </div>
            </div>

            <div class="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4">
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-semibold text-slate-950">当前页快速跳转</p>
                <span class="text-xs text-slate-400">{{ quickJumpFeatures.length }} 个高敏感字段</span>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="feature in quickJumpFeatures"
                  :key="feature"
                  type="button"
                  class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  @click="focusDescriptor(feature)"
                >
                  {{ feature }}
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>


