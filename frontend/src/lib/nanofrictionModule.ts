import type { ModelTrainingStartPayload } from './api'

const INTERNAL_SHORTHAND = ['W', 'FF'].join('')
export const FORBIDDEN_PUBLIC_TERMS = [INTERNAL_SHORTHAND]

export const NANOFriction_PUBLIC_COPY = {
  moduleTitle: '纳米摩擦智能建模',
  moduleShortTitle: '纳米摩擦建模',
  moduleSubtitle: '复现含界面膜厚数据下的分区混合预测模型，并用固定划分、外部文献验证和超低摩擦趋势确认可信度。',
  primaryAction: '开始复现论文模型',
  prepareAction: '载入论文数据',
  evidenceTabs: ['成果总览', '固定划分', '候选模型', '外部验证', '影响因素'],
  steps: ['载入内置数据', '校验固定划分', '复现候选模型', '确认最优模型'],
  status: {
    notReady: '尚未载入数据',
    ready: '数据已准备',
    running: '正在复现模型',
    completed: '复现完成',
    failed: '结果未达到论文目标，建议检查依赖或重新运行',
  },
}

export const NANOFriction_TARGET_METRICS = {
  dataset: {
    totalRows: 212,
    trainingRows: 169,
    testingRows: 37,
    externalRows: 6,
    featureCount: 31,
  },
  testing: { r2: 0.991, mae: 0.057, rmse: 0.089 },
  external: { r2: 0.985, mae: 0.040, rmse: 0.046 },
}

export const NANOFriction_CANDIDATE_MODELS = [
  {
    key: 'catboost_rf_svr',
    label: 'CatBoost + Random Forest',
    simpleLabel: '二模型融合',
    summary: '外部文献验证更稳，适合作为外推能力对照。',
    testing: { r2: 0.991, mae: 0.067, rmse: 0.092 },
    external: { r2: 0.965, mae: 0.062, rmse: 0.071 },
    recommended: false,
  },
  {
    key: 'catboost_xgboost_catboost',
    label: 'CatBoost + XGBoost',
    simpleLabel: '二模型融合',
    summary: '检验集拟合更强，但外部文献验证略弱于最终方案。',
    testing: { r2: 0.994, mae: 0.047, rmse: 0.074 },
    external: { r2: 0.938, mae: 0.077, rmse: 0.095 },
    recommended: false,
  },
  {
    key: 'three_model_fusion',
    label: 'CatBoost + Random Forest + XGBoost',
    simpleLabel: '三模型融合',
    summary: '在检验集精度和外部文献验证之间取得最均衡表现。',
    testing: { r2: 0.991, mae: 0.057, rmse: 0.089 },
    external: { r2: 0.985, mae: 0.040, rmse: 0.046 },
    recommended: true,
  },
] as const

export const NANOFriction_EXTERNAL_SAMPLES = [
  { cation: '[HOC3MPip]+', anion: '[TFSI]-', surface: 'mica', potential: '0.00 V', actual: 0.21 },
  { cation: '[HOC4Py]+', anion: '[OMs]-', surface: 'mica', potential: '0.00 V', actual: 0.24 },
  { cation: '[HOC3Py]+', anion: '[OMs]-', surface: 'mica', potential: '0.00 V', actual: 0.26 },
  { cation: '[HMIM]+', anion: '[FAP]-', surface: 'stainless steel', potential: '0.00 V', actual: 1.16 },
  { cation: '[P4,4,4,1]+', anion: '[TFSI]-', surface: 'stainless steel', potential: '0.00 V', actual: 0.93 },
  { cation: '[Py1,4]+', anion: '[FAP]-', surface: 'Au(111)', potential: '-0.16 V', actual: 0.28 },
] as const

export const NANOFriction_FEATURE_INSIGHTS = [
  {
    region: '低摩擦区间',
    range: '预测 μ < 0.10',
    leadingFactors: ['表面能', '接触角', '膜厚', '表面电荷', '离子疏水性'],
    explanation: '低摩擦样本更依赖表面性质和疏水性，说明界面润湿与离子层排列会直接影响超低摩擦状态。',
  },
  {
    region: '中摩擦区间',
    range: '0.10 ≤ 预测 μ < 1.06',
    leadingFactors: ['膜厚', '阳离子疏水性', '基底类型', '阳离子分子量', '离子液体浓度', '滑动速度'],
    explanation: '中摩擦区间由膜厚主导，同时受离子结构、表面和工况共同调节。',
  },
  {
    region: '高摩擦区间',
    range: '预测 μ ≥ 1.06',
    leadingFactors: ['膜厚', '滑动速度', '阳离子尺寸', '基底类型', '阳离子疏水性'],
    explanation: '高摩擦样本中膜厚与滑动速度贡献更突出，反映受限液膜承载和剪切条件的共同作用。',
  },
] as const

export interface NanofrictionDatasetCandidate {
  name: string
  row_count?: number
  feature_columns?: string[]
  matrix_columns?: string[]
  import_metadata?: {
    wff_dataset_key?: string
    filename?: string
    feature_columns?: string[]
    row_count?: number
    thesis_fixed_split?: boolean
  } | null
}

export function containsForbiddenPublicTerm(value: string): boolean {
  return FORBIDDEN_PUBLIC_TERMS.some((term) => value.includes(term))
}

export function isNanofrictionFilmDataset(dataset: NanofrictionDatasetCandidate): boolean {
  const metadata = dataset.import_metadata || {}
  const datasetKey = String(metadata.wff_dataset_key || '').trim().toLowerCase()
  if (datasetKey === 'dataset_b') return true
  if (datasetKey === 'dataset_a') return false

  const filename = String(metadata.filename || '').trim().toLowerCase()
  if (filename.includes('no+film') || filename.includes('no-film')) return false
  if (filename.includes('film+dataset0312')) return true

  const name = String(dataset.name || '')
  if (name.includes('不含膜厚')) return false

  const featureColumns = [
    ...(metadata.feature_columns || []),
    ...(dataset.feature_columns || []),
    ...(dataset.matrix_columns || []),
  ].map((column) => String(column).trim())
  const hasFilmThickness = featureColumns.includes('h') || featureColumns.includes('film_thickness')
  return hasFilmThickness && (name.includes('Dataset-B') || name.includes('数据集 B') || name.includes('含膜厚'))
}

export function selectNanofrictionFilmDataset<T extends NanofrictionDatasetCandidate>(datasets: T[]): T | undefined {
  return datasets.find(isNanofrictionFilmDataset)
}

export function buildNanofrictionStartPayload(
  cleanedDatasetId: number,
  target = 'μ',
): ModelTrainingStartPayload {
  return {
    target,
    algorithm: 'high_cof_segmented',
    cleaned_dataset_id: cleanedDatasetId,
    tune: false,
    hyperparameters: {
      n_estimators: 300,
      learning_rate: 0.08,
      max_depth: 3,
      l2_leaf_reg: 2.0,
      random_strength: 1.0,
      q1: 0.3,
      q2: 0.8,
      high_blend: 0,
      base_models: ['catboost', 'random_forest', 'xgboost'],
      meta_model: 'catboost',
      thesis_profile: true,
      min_segment_size: 8,
    },
    data_options: {
      validation_split: 0.2,
      training_view: 'all',
      min_confidence: 0,
      max_records: null,
      random_seed: 42,
      split_strategy: 'wff_thesis',
      cv_folds: 5,
      reserve_external_validation: false,
      target_aggregation_strategy: 'raw',
      target_outlier_strategy: 'off',
      target_outlier_iqr_multiplier: 3.0,
      target_outlier_min: null,
      target_outlier_max: null,
    },
  }
}
