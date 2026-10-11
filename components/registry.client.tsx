import type { ComponentType } from "react";
import type { ConditionItem, UnitMode } from "@/components/recordCardParts";

export interface FacetUI {
  label: string;
  /** Includes the "all" option first. */
  options: { value: string; label: string; dot?: string }[];
}

export interface ClientModule {
  label: string;
  tagline: string;
  Card: ComponentType<any>;
  Editor: ComponentType<any>;
  coreCompleteness: (record: any) => { complete: boolean; missing: string[] };
  facet: FacetUI;
  listStats: (records: any[]) => { label: string; value: string }[];
  conditionItems: (record: any, units: UnitMode) => ConditionItem[];
  systemFacets: (record: any, units: UnitMode) => ConditionItem[];
}

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

export function paperCount(records: any[]): number {
  return new Set(records.map((record) => record.paper?.title)).size;
}
