import type { ModelTrainingStartPayload } from './api'

export const FORBIDDEN_PUBLIC_TERMS = ['WFF'] as const

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

export function containsForbiddenPublicTerm(value: string): boolean {
  return FORBIDDEN_PUBLIC_TERMS.some((term) => value.includes(term))
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
