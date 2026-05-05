import { computed, type Component, type ComputedRef, type Ref } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileWarning,
  ListChecks,
  Wand2,
  Workflow,
} from 'lucide-vue-next'
import type { ModelCleaningOptions, ModelCleaningPreview, ModelTrainingCleaningSummary, SavedCleanedDatasetSummary } from '@/lib/api'
import type { BuilderSubsetSummary } from '../dataset-builder/types'
import type { TRAINING_VIEW_OPTIONS } from './useCleaningPreview'

export type QualitySeverity = 'ok' | 'watch' | 'action'
export type NextActionTarget = 'review' | 'explorer' | 'datasets' | 'training'

export type QualityIssueCard = {
  key: string
  title: string
  value: number
  unit: string
  severity: QualitySeverity
  status: string
  explanation: string
  studentAction: string
  trainingTreatment: string
  knowledgeTreatment: string
  blockingScope: 'sample' | 'recipe' | 'knowledge'
  icon: Component
}

type TrainingViewOption = (typeof TRAINING_VIEW_OPTIONS)[number]
type QualityGates = NonNullable<ModelTrainingCleaningSummary['quality_gates']>

const STRUCTURED_GATE_KEYS = [
  'temperature',
  'speed',
  'load',
  'system_total_load',
  'contact_load_per_unit',
  'potential',
  'il_additive_mol_fraction',
  'base_oil_mol_fraction',
] as const

export function useQualityIssues(opts: {
  preview: Ref<ModelCleaningPreview | null>
  form: ModelCleaningOptions
  selectedTrainingView: ComputedRef<TrainingViewOption>
  datasetASummary: ComputedRef<BuilderSubsetSummary | null>
  datasetBSummary: ComputedRef<BuilderSubsetSummary | null>
  savedDatasets: Ref<SavedCleanedDatasetSummary[]>
}) {
  const {
    preview,
    form,
    selectedTrainingView,
    datasetASummary,
    datasetBSummary,
    savedDatasets,
  } = opts

  const cleaningSummary = computed(() => preview.value?.summary || null)
  const qualityGates = computed<QualityGates>(() => cleaningSummary.value?.quality_gates || {})

  const missingTargetCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_target || 0)
  const missingCationCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_cation_smiles || 0)
  const missingAnionCount = computed(() => cleaningSummary.value?.dropped_by_reason.missing_anion_smiles || 0)
  const outsideTrainingViewCount = computed(() => cleaningSummary.value?.dropped_by_reason.outside_training_view || 0)
  const missingChemistryFieldCount = computed(() => missingCationCount.value + missingAnionCount.value)
  const repairCount = computed(() => {
    const repairs = cleaningSummary.value?.missing_value_repairs || {}
    return Object.values(repairs).reduce((sum, value) => sum + Number(value || 0), 0)
  })
  const rawRecordCount = computed(() => cleaningSummary.value?.raw_records || 0)
  const trainingReadyCount = computed(() => cleaningSummary.value?.training_ready_records || 0)
  const chemistryReadyCount = computed(() => cleaningSummary.value?.chemistry_ready_records || 0)
  const outlierCount = computed(() => cleaningSummary.value?.outliers_detected || 0)

  const pendingReviewCount = computed(() => Number(qualityGates.value.pending_review_records || 0))
  const blockedReviewCount = computed(() => Number(qualityGates.value.blocked_review_records || 0))
  const missingEvidenceCount = computed(() => Number(qualityGates.value.missing_evidence_records || 0))
  const lowConfidenceCount = computed(() => Number(qualityGates.value.low_confidence_records || 0))
  const mixtureRatioGapCount = computed(() => Number(qualityGates.value.mixture_ratio_gaps || 0))
  const conditionCollisionGroupCount = computed(() => Number(qualityGates.value.condition_collision_groups || 0))
  const conditionCollisionRecordCount = computed(() => Number(qualityGates.value.condition_collision_records || 0))
  const featureGapMap = computed<Record<string, number>>(() => qualityGates.value.feature_gaps || {})
  const structuredConditionGapCount = computed(() => {
    const explicit = Number(qualityGates.value.structured_condition_gaps || 0)
    const fromMap = STRUCTURED_GATE_KEYS.reduce((sum, key) => sum + Number(featureGapMap.value[key] || 0), 0)
    return Math.max(explicit, fromMap)
  })

  const baseDatasetCount = computed(() =>
    datasetASummary.value?.row_count
    || preview.value?.dataset_builder?.descriptor_generation?.usable_rows
    || trainingReadyCount.value,
  )
  const enhancedDatasetCount = computed(() => datasetBSummary.value?.row_count || 0)
  const filmMissingCount = computed(() => Math.max(0, baseDatasetCount.value - enhancedDatasetCount.value))
  const readyRatio = computed(() => {
    if (!rawRecordCount.value) return 0
    return trainingReadyCount.value / rawRecordCount.value
  })
  const filmCoverageRatio = computed(() => {
    if (!baseDatasetCount.value) return 0
    return enhancedDatasetCount.value / baseDatasetCount.value
  })

  const qualityIssueCards = computed<QualityIssueCard[]>(() => [
    {
      key: 'target',
      title: '目标值完整度',
      value: missingTargetCount.value,
      unit: '条缺少 μ/COF',
      severity: missingTargetCount.value > 0 ? 'action' : 'ok',
      status: form.drop_missing_target ? '已按推荐排除' : '建议排除后再训练',
      explanation: '模型必须知道每条样本的摩擦系数,缺少目标值的记录不能直接进入训练。',
      studentAction: '保留"有 μ/COF 的样本"开关,必要时回到审核页补充原文事实。',
      trainingTreatment: '训练视图会排除缺目标值的记录;Knowledge 中仍保留这些文献事实。',
      knowledgeTreatment: '如果文献实际给出了 μ/COF,再回 Review 补全目标值和证据。',
      blockingScope: 'sample',
      icon: FileWarning,
    },
    {
      key: 'evidence',
      title: '审核与证据状态',
      value: missingEvidenceCount.value,
      unit: '条缺定位/证据',
      severity: blockedReviewCount.value > 0 ? 'action' : missingEvidenceCount.value > 0 || pendingReviewCount.value > 0 ? 'watch' : 'ok',
      status: blockedReviewCount.value > 0
        ? `${blockedReviewCount.value} 条被存疑或需补证据`
        : pendingReviewCount.value > 0
          ? `${pendingReviewCount.value} 条还未最终确认`
          : '证据链已通过',
      explanation: '证据定位是 Knowledge 的可追溯性指标,不应强迫训练分支删除仍有用的事实字段。',
      studentAction: '训练时忽略证据定位字段;只有发现事实值可能错误时,再回 Review 修正。',
      trainingTreatment: '默认不把证据页码/bbox 作为模型特征;严格复现实验时可只选已审记录。',
      knowledgeTreatment: 'Review 继续用于补定位、确认别名和保留原文出处。',
      blockingScope: 'knowledge',
      icon: ListChecks,
    },
    {
      key: 'confidence',
      title: '低置信度记录',
      value: lowConfidenceCount.value,
      unit: '条低于 0.8',
      severity: lowConfidenceCount.value > 0 ? 'watch' : 'ok',
      status: lowConfidenceCount.value > 0 ? '建议抽样复核' : '置信度稳定',
      explanation: '低置信度不一定是错误,但更容易包含单位、定位或字段拆解问题。',
      studentAction: '先复核低置信度里的 COF、载荷、电势和混合比例,再决定是否进入训练。',
      trainingTreatment: '基线训练可以保留;正式模型可导出后按置信度再筛选一版。',
      knowledgeTreatment: '低置信度记录保留在 Knowledge 中,便于后续追溯和补证据。',
      blockingScope: 'recipe',
      icon: AlertTriangle,
    },
    {
      key: 'profile',
      title: '实验视图匹配',
      value: outsideTrainingViewCount.value,
      unit: '条不在当前视图',
      severity: outsideTrainingViewCount.value > 0 ? 'watch' : 'ok',
      status: selectedTrainingView.value.label,
      explanation: '训练视图按实验尺度和方法筛选 macro / AFM 数据,避免把不同物理尺度当成同分布样本。',
      studentAction: '预测宏观 COF/磨损时选"宏观性能预测";研究 AFM 信号时选"AFM 表面响应";做跨尺度假设时选"跨尺度数据池"。',
      trainingTreatment: '当前配方只冻结选定训练视图,不会拆分或删除统一 Knowledge。',
      knowledgeTreatment: 'Knowledge 保留 macro / AFM 全量记录,靠 scale_regime 和 test_method 区分。',
      blockingScope: 'recipe',
      icon: Workflow,
    },
    {
      key: 'chemistry',
      title: '离子结构可用性',
      value: missingChemistryFieldCount.value,
      unit: '个 SMILES 缺口',
      severity: missingChemistryFieldCount.value > 0 ? (form.require_dual_smiles ? 'action' : 'watch') : 'ok',
      status: form.require_dual_smiles
        ? `${chemistryReadyCount.value} 条记录可生成分子描述符`
        : '当前配方允许无 SMILES 记录',
      explanation: 'SMILES 只对分子结构特征模型是硬要求;工况/材料基线模型可以先舍弃结构描述符。',
      studentAction: '要做结构模型就补齐 SMILES;要先看工况影响,可切到"工况基线"配方。',
      trainingTreatment: form.require_dual_smiles
        ? '结构配方会排除无双离子 SMILES 的记录。'
        : '工况基线会保留这些记录,并在导出特征中舍弃离子描述符。',
      knowledgeTreatment: 'Knowledge 继续保留缺 SMILES 的离子液体和文献别名,后续可补结构。',
      blockingScope: 'recipe',
      icon: Database,
    },
    {
      key: 'mixture',
      title: '混合物比例',
      value: mixtureRatioGapCount.value,
      unit: '条比例缺口',
      severity: mixtureRatioGapCount.value > 0 ? 'action' : 'ok',
      status: mixtureRatioGapCount.value > 0 ? '需要补 components' : '比例字段可用',
      explanation: 'ILM 或 IL/oil 混合物必须把每个组分和比例拆进 components,否则同一工况会出现不同 COF。',
      studentAction: '重点检查带 oil、ILM、molar ratio、wt% 的记录,把比例写成结构化数组。',
      trainingTreatment: '当前配方可先不选混合比例特征;做混合物模型前再单独补齐。',
      knowledgeTreatment: 'Review 中保留原文比例描述,后续沉淀成 components。',
      blockingScope: 'recipe',
      icon: Wand2,
    },
    {
      key: 'process',
      title: '结构化工况',
      value: structuredConditionGapCount.value,
      unit: '个关键字段缺口',
      severity: structuredConditionGapCount.value > 0 ? 'watch' : 'ok',
      status: repairCount.value > 0
        ? `${repairCount.value} 个空值已按${form.missing_value_strategy === 'median' ? '中位数' : form.missing_value_strategy}处理`
        : '温度/速度/载荷/比例字段已结构化',
      explanation: '载荷、速度、电势和混合比例要拆成数值特征,复合长句不能直接作为训练输入。',
      studentAction: '中位数只能做基线占位;正式训练前应回到文献把 scan rate、load per pin、IL/oil ratio 等拆准。',
      trainingTreatment: '训练数据集可以舍弃覆盖率差的工况字段,或用中位数生成基线版本。',
      knowledgeTreatment: 'Knowledge 保留原始条件文本和结构化拆解状态。',
      blockingScope: 'recipe',
      icon: Workflow,
    },
    {
      key: 'collision',
      title: '重复条件冲突',
      value: conditionCollisionGroupCount.value,
      unit: '组冲突',
      severity: conditionCollisionGroupCount.value > 0 ? 'action' : 'ok',
      status: conditionCollisionGroupCount.value > 0 ? `${conditionCollisionRecordCount.value} 条记录需核对` : '未发现同条件不同 COF',
      explanation: '同一材料、润滑剂和工况下出现多个不同 COF,通常意味着比例、载荷或电势缺了一个子字段。',
      studentAction: '先排查混合比例和结构化工况;确实是重复实验时再保留为重复测量。',
      trainingTreatment: '基线版本可保留重复实验;需要严格建模时再按均值聚合或排除冲突组。',
      knowledgeTreatment: 'Knowledge 不删除重复实验,因为它们可能代表真实重复测量或不同子条件。',
      blockingScope: 'recipe',
      icon: AlertTriangle,
    },
    {
      key: 'outlier',
      title: '异常摩擦系数',
      value: outlierCount.value,
      unit: '条疑似异常',
      severity: outlierCount.value > 0 ? 'watch' : 'ok',
      status: form.remove_target_outliers ? '已移出训练池' : '保留但会提示风险',
      explanation: '极端 μ/COF 可能是真实特殊现象,也可能是单位或抽取错误。',
      studentAction: '课堂练习可先保留观察;正式训练前建议逐条检查证据。',
      trainingTreatment: '可导出保留异常值和移除异常值两版数据集进行对比。',
      knowledgeTreatment: '异常值保留在 Knowledge 中,除非 Review 确认为抽取错误。',
      blockingScope: 'recipe',
      icon: AlertTriangle,
    },
    {
      key: 'film',
      title: '膜厚覆盖',
      value: enhancedDatasetCount.value,
      unit: '条含膜厚',
      severity: enhancedDatasetCount.value > 0 ? 'ok' : 'watch',
      status: `${Math.round(filmCoverageRatio.value * 100)}% 可进入增强数据集`,
      explanation: '膜厚不是所有文献都会给出,所以平台会自动分成基础数据集和增强数据集。',
      studentAction: filmMissingCount.value > 0
        ? `不要强行补膜厚;${filmMissingCount.value} 条样本会留在基础数据集中。`
        : '当前样本都可以进入增强数据集。',
      trainingTreatment: '平台自动生成基础版和膜厚增强版,不要求所有样本都有膜厚。',
      knowledgeTreatment: '膜厚作为 Knowledge 的可选机制字段保留。',
      blockingScope: 'recipe',
      icon: ListChecks,
    },
    {
      key: 'ready',
      title: '可训练样本池',
      value: trainingReadyCount.value,
      unit: '条可训练',
      severity: trainingReadyCount.value >= 10 ? 'ok' : 'action',
      status: trainingReadyCount.value >= 10 ? '已达到 Modeling 最低要求' : '少于 10 条,暂不建议训练',
      explanation: '样本太少时模型评估不稳定,训练结果更像演示而不是可靠实验。',
      studentAction: '如果不足 10 条,先扩大文献范围或降低筛选限制。',
      trainingTreatment: '这是训练分支的真正硬门槛:样本数不足时不生成训练版本。',
      knowledgeTreatment: 'Knowledge 不受样本数限制,继续沉淀已有记录。',
      blockingScope: 'sample',
      icon: CheckCircle2,
    },
  ])

  const actionIssueCards = computed(() => qualityIssueCards.value.filter((card) => card.severity === 'action'))
  const watchIssueCards = computed(() => qualityIssueCards.value.filter((card) => card.severity === 'watch'))
  const okIssueCards = computed(() => qualityIssueCards.value.filter((card) => card.severity === 'ok'))
  const actionIssueCount = computed(() => actionIssueCards.value.length)
  const watchIssueCount = computed(() => watchIssueCards.value.length)
  const okIssueCount = computed(() => okIssueCards.value.length)

  const qualityScore = computed(() => {
    const readiness = Math.round(readyRatio.value * 70)
    const issuePenalty = actionIssueCount.value * 10 + watchIssueCount.value * 4
    const savedBonus = savedDatasets.value.length > 0 ? 8 : 0
    return Math.max(0, Math.min(100, readiness + 22 + savedBonus - issuePenalty))
  })

  const qualityVerdict = computed<{ tone: QualitySeverity; label: string; helper: string }>(() => {
    if (trainingReadyCount.value < 10) {
      return {
        tone: 'action',
        label: '暂不建议训练',
        helper: `当前可训练样本仅 ${trainingReadyCount.value} 条,先扩大文献范围或放宽筛选。`,
      }
    }
    if (actionIssueCount.value > 0) {
      return {
        tone: 'watch',
        label: `${actionIssueCount.value} 类问题需要配方处理`,
        helper: '这些问题不必都回 Review 修;可以通过排除字段、切换配方或保留为基线版本处理。',
      }
    }
    if (watchIssueCount.value > 0) {
      return {
        tone: 'watch',
        label: '可以生成基线数据集',
        helper: `仍有 ${watchIssueCount.value} 项需确认,可继续也可先核对。`,
      }
    }
    return {
      tone: 'ok',
      label: '当前可以开始训练',
      helper: '所有质量检查通过,可直接进入下一步。',
    }
  })

  const cleaningStageLabel = computed(() => {
    if (!rawRecordCount.value) return '等待数据'
    if (trainingReadyCount.value < 10) return '样本不足'
    if (actionIssueCount.value > 0) return '选择配方'
    if (watchIssueCount.value > 0) return '可以做基线'
    return '已准备好'
  })

  const nextStudentAction = computed<{
    target: NextActionTarget
    label: string
    title: string
    description: string
  }>(() => {
    if (!rawRecordCount.value) {
      return {
        target: 'explorer',
        label: '先选择记录',
        title: '先从文献库选择数据',
        description: '当前没有可清洗的记录。先回到数据浏览,确认本次训练要使用哪些文献和记录。',
      }
    }
    if (trainingReadyCount.value < 10) {
      return {
        target: 'explorer',
        label: '回到数据浏览',
        title: '先补足可训练样本',
        description: '少于 10 条时模型结果很不稳定。先扩大文献范围,或回到 Review 补齐目标值和结构信息。',
      }
    }
    if (actionIssueCount.value > 0) {
      return {
        target: 'datasets',
        label: '生成/调整训练集',
        title: '用训练配方处理问题',
        description: '这些问题多数属于建模选择:可以排除字段、切换非结构基线、保留重复实验,事实错误再回 Review。',
      }
    }
    if (watchIssueCount.value > 0) {
      return {
        target: 'datasets',
        label: '生成基线数据集',
        title: '可以先生成基线',
        description: '剩下的问题多是需要确认的风险项。可以先生成一个基线数据集,同时保留后续复核入口。',
      }
    }
    return {
      target: 'datasets',
      label: '生成训练数据集',
      title: '数据已经可以进入训练',
      description: '关键字段、证据链和结构化工况都已通过。下一步生成训练数据集版本。',
    }
  })

  type ProgressTone = 'slate' | 'emerald' | 'rose' | 'amber'
  const cleaningProgressItems = computed<Array<{ label: string; value: number; helper: string; tone: ProgressTone }>>(() => [
    {
      label: '原始记录',
      value: rawRecordCount.value,
      helper: '本次纳入清洗',
      tone: 'slate',
    },
    {
      label: '可训练',
      value: trainingReadyCount.value,
      helper: `${Math.round(readyRatio.value * 100)}% 可用`,
      tone: trainingReadyCount.value >= 10 ? 'emerald' : 'rose',
    },
    {
      label: '配方处理',
      value: actionIssueCount.value,
      helper: actionIssueCount.value ? '不阻塞基线' : '没有处理项',
      tone: actionIssueCount.value ? 'amber' : 'emerald',
    },
    {
      label: '建议确认',
      value: watchIssueCount.value,
      helper: watchIssueCount.value ? '可先做基线' : '风险较低',
      tone: watchIssueCount.value ? 'amber' : 'emerald',
    },
  ])

  return {
    cleaningSummary,
    rawRecordCount,
    trainingReadyCount,
    qualityIssueCards,
    actionIssueCards,
    watchIssueCards,
    okIssueCards,
    actionIssueCount,
    watchIssueCount,
    okIssueCount,
    qualityScore,
    qualityVerdict,
    cleaningStageLabel,
    nextStudentAction,
    cleaningProgressItems,
    readyRatio,
  }
}
