import type { DomainDraft } from "../domain";

export type TabularScalar = string | number | boolean | Date | null;

export interface TabularSheet {
  name: string;
  headerRow: number;
  headers: string[];
  rows: { rowNumber: number; values: TabularScalar[] }[];
}

export interface DatasetColumnMapping {
  source: string;
  target: string;
  mode: "direct" | "expanded" | "preserved" | "ignored";
}

export interface DatasetPreviewRecord {
  sheet: string;
  row: number;
  species: string;
  cation: string;
  anion: string;
  temperature: string;
  diffusion: string;
  systemName?: string;
}

export interface DatasetAdaptation {
  adapter: string;
  inputRows: number;
  drafts: DomainDraft<any, any>[];
  invalidRows: { sheet: string; row: number; reason: string }[];
  warnings: string[];
  mappings: DatasetColumnMapping[];
  preview: DatasetPreviewRecord[];
}

export interface DatasetImportResult {
  fingerprint: string;
  filename: string;
  adapter: string;
  inputRows: number;
  outputRecords: number;
  invalidRows: { sheet: string; row: number; reason: string }[];
  warnings: string[];
  mappings: DatasetColumnMapping[];
  preview: DatasetPreviewRecord[];
}
