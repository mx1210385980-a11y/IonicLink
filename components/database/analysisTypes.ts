import type { DomainRecord } from "@/lib/domain";
import type { Quantity } from "@/lib/units";
import type { UnitMode } from "@/components/recordCardParts";

export type AnalysisRecord = DomainRecord<any, any>;

/** Numeric values are canonical SI; labels may preserve the original report. */
export interface AnalysisField {
  key: string;
  label: string;
  unit?: string;
  numeric?: boolean;
  provenanceKey?: string;
  getValue: (record: AnalysisRecord) => string | number | null;
  format: (record: AnalysisRecord, units: UnitMode) => string;
  getQuantity?: (record: AnalysisRecord) => Quantity | null | undefined;
}

export type AnalysisSort = { key: string; direction: "asc" | "desc" };
export type AnalysisView = "cards" | "table" | "plot";
export type AnalysisDensity = "compact" | "comfortable";
export type PlotConfig = {
  x: string;
  y: string;
  logX: boolean;
  logY: boolean;
  groupBy: "method" | "paper" | "cation";
};

export type AnalysisConstraint = {
  field: string;
  min: number | null;
  max: number | null;
  missing: "any" | "present" | "missing";
};

export type EvidenceFilter = "all" | "direct" | "inferred" | "assumed" | "unassessed";
