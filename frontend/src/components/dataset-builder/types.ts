import type { ModelCleaningMatrixRow, ModelCleaningPreview, SavedCleanedDatasetSummary } from '@/lib/api'

export type DatasetBuilderPayload = NonNullable<ModelCleaningPreview['dataset_builder']>
export type DescriptorSummary = DatasetBuilderPayload['descriptor_generation']
export type ScreeningSummary = DatasetBuilderPayload['screening']
export type BuilderSubsetSummary = DatasetBuilderPayload['subsets']['dataset_a']
export type SubsetKey = 'dataset_a' | 'dataset_b'

export type SubsetCard = {
  key: SubsetKey
  label: string
  title: string
  summary: BuilderSubsetSummary | null
  accent: 'sky' | 'emerald'
  description: string
}

export type MatrixRow = ModelCleaningMatrixRow
export type SavedDatasetSummary = SavedCleanedDatasetSummary
