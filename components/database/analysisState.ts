import type { Domain } from "@/lib/domain";
import type { RecordStatus } from "@/lib/schema";
import { isStructureSearchTarget, structureSearchInputIssue, type StructureSearchValue } from "@/lib/structureSearch";
import { EMPTY_FILTERS, type RecordFilters } from "@/components/recordFilters";
import { defaultColumns, defaultPlotConfig, getAnalysisFields } from "./analysisFields";
import type { AnalysisConstraint, AnalysisDensity, AnalysisField, AnalysisRecord, AnalysisSort, AnalysisView, EvidenceFilter, PlotConfig } from "./analysisTypes";
import { getRecordEvidence } from "./comparison";

export interface AnalysisState {
  version: 1;
  view: AnalysisView;
  density: AnalysisDensity;
  units: "raw" | "std";
  columns: string[];
  sort: AnalysisSort;
  plot: PlotConfig;
  constraints: AnalysisConstraint[];
  evidence: EvidenceFilter;
  method: string;
  context: string;
  plotIds: string[] | null;
  groupByPaper: boolean;
  conditionsOverview: boolean;
}

export function defaultAnalysisState(domain: Domain): AnalysisState {
  return {
    version: 1, view: "table", density: "compact", units: "std",
    columns: defaultColumns(domain), sort: { key: "id", direction: "asc" },
    plot: defaultPlotConfig(domain), constraints: [], evidence: "all", method: "", context: "",
    plotIds: null, groupByPaper: true, conditionsOverview: false,
  };
}

const strings = (value: unknown, max = 100): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 512))].slice(0, max) : [];
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function parseAnalysisState(value: unknown, domain: Domain): AnalysisState {
  const defaults = defaultAnalysisState(domain);
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const input = value as Record<string, any>;
  if (input.version !== 1) return defaults;
  const fields = getAnalysisFields(domain);
  const keys = new Set(fields.map((field) => field.key));
  const numeric = new Set(fields.filter((field) => field.numeric).map((field) => field.key));
  const columns = strings(input.columns).filter((key) => keys.has(key));
  const constraints: AnalysisConstraint[] = Array.isArray(input.constraints) ? input.constraints.slice(0, 8).flatMap((item: any) => {
    if (!item || !numeric.has(item.field)) return [];
    return [{ field: item.field, min: finite(item.min), max: finite(item.max), missing: ["present", "missing"].includes(item.missing) ? item.missing : "any" }];
  }) : [];
  return {
    ...defaults,
    view: ["cards", "table", "plot"].includes(input.view) ? input.view : defaults.view,
    density: input.density === "comfortable" ? "comfortable" : "compact",
    units: input.units === "raw" ? "raw" : "std",
    columns: columns.length ? columns : defaults.columns,
    sort: { key: keys.has(input.sort?.key) ? input.sort.key : "id", direction: input.sort?.direction === "desc" ? "desc" : "asc" },
    plot: {
      x: numeric.has(input.plot?.x) ? input.plot.x : defaults.plot.x,
      y: numeric.has(input.plot?.y) ? input.plot.y : defaults.plot.y,
      logX: input.plot?.logX === true, logY: input.plot?.logY === true,
      groupBy: ["method", "paper", "cation"].includes(input.plot?.groupBy) ? input.plot.groupBy : "method",
    },
    constraints,
    evidence: ["direct", "inferred", "assumed", "unassessed"].includes(input.evidence) ? input.evidence : "all",
    method: typeof input.method === "string" ? input.method.slice(0, 512) : "",
    context: typeof input.context === "string" ? input.context.slice(0, 512) : "",
    plotIds: Array.isArray(input.plotIds) ? strings(input.plotIds, 10000) : null,
    groupByPaper: input.groupByPaper !== false,
    conditionsOverview: input.conditionsOverview === true,
  };
}

export function parseRecordFilters(value: unknown): RecordFilters {
  if (!value || typeof value !== "object") return { ...EMPTY_FILTERS };
  const input = value as Record<string, unknown>;
  return {
    cations: strings(input.cations), anions: strings(input.anions), surfaces: strings(input.surfaces),
    surfaceQuery: typeof input.surfaceQuery === "string" ? input.surfaceQuery.slice(0, 512) : "",
    confinedSystems: strings(input.confinedSystems).filter((mode): mode is RecordFilters["confinedSystems"][number] => ["1D", "2D", "3D-Cage", "Membrane", "0D-Pools", "Gyroid"].includes(mode)),
    loadMinN: finite(input.loadMinN), loadMaxN: finite(input.loadMaxN), tempMinK: finite(input.tempMinK), tempMaxK: finite(input.tempMaxK),
  };
}

export interface DatabaseLocation {
  status: RecordStatus; facet: string; paper: string; search: string;
  structure: StructureSearchValue | null; filters: RecordFilters; analysis: AnalysisState;
}

export function readDatabaseLocation(search: string, domain: Domain): DatabaseLocation {
  const params = new URLSearchParams(search);
  let payload: any = null;
  try { const raw = params.get("analysis"); if (raw && raw.length <= 200000) payload = JSON.parse(raw); } catch {}
  const smiles = params.get("structureSmiles") ?? "";
  const target = params.get("structureTarget");
  return {
    status: params.get("status") === "review" ? "review" : "official",
    facet: params.get("facet") || "all", paper: params.get("paper") || "all", search: (params.get("search") ?? "").slice(0, 2048),
    structure: smiles && !structureSearchInputIssue(smiles) && isStructureSearchTarget(target) ? { smiles, target, mode: "exact" } : null,
    filters: parseRecordFilters(payload?.version === 1 ? payload.filters : null), analysis: parseAnalysisState(payload, domain),
  };
}

export function buildAnalysisUrl(href: string, state: DatabaseLocation): string {
  const url = new URL(href);
  for (const key of ["status", "facet", "paper", "search", "structureSmiles", "structureTarget", "structureMode", "analysis"]) url.searchParams.delete(key);
  url.searchParams.set("status", state.status);
  if (state.facet !== "all") url.searchParams.set("facet", state.facet);
  if (state.paper !== "all") url.searchParams.set("paper", state.paper);
  if (state.search.trim()) url.searchParams.set("search", state.search.trim());
  if (state.structure) {
    url.searchParams.set("structureSmiles", state.structure.smiles);
    url.searchParams.set("structureTarget", state.structure.target);
    url.searchParams.set("structureMode", state.structure.mode);
  }
  url.searchParams.set("analysis", JSON.stringify({ ...state.analysis, filters: state.filters }));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function applyAnalysisFilters(records: AnalysisRecord[], fields: AnalysisField[], state: AnalysisState): AnalysisRecord[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const contextTokens = state.context.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return records.filter((record) => {
    if (state.method && record.extended?.method !== state.method) return false;
    if (state.evidence !== "all" && getRecordEvidence(record, fields) !== state.evidence) return false;
    if (contextTokens.length) {
      const text = [record.extended?.waterContent, record.extended?.concentration, record.extended?.additives, record.extended?.systemName].filter(Boolean).join(" ").toLowerCase();
      if (!contextTokens.every((token) => text.includes(token))) return false;
    }
    return state.constraints.every((constraint) => {
      const field = byKey.get(constraint.field);
      if (!field) return true;
      const value = field.getValue(record);
      const present = typeof value === "number" && Number.isFinite(value);
      if (constraint.missing === "missing") return !present;
      if (!present) return constraint.missing !== "present" && constraint.min == null && constraint.max == null;
      // A range is a range, not its stored upper endpoint. Keep only intervals
      // fully within the requested window; open-ended inequalities stay excluded.
      const quantity = field.getQuantity?.(record);
      const hasBounds = constraint.min != null || constraint.max != null;
      if (hasBounds && quantity?.approx && !quantity.range) return false;
      if (hasBounds && quantity?.range && (quantity.range.stdMin == null || quantity.range.stdMax == null)) return false;
      const lower = quantity?.range?.stdMin ?? value;
      const upper = quantity?.range?.stdMax ?? value;
      return (constraint.min == null || lower >= constraint.min) && (constraint.max == null || upper <= constraint.max);
    });
  });
}

export function hasAnalysisFilters(state: AnalysisState): boolean {
  return state.evidence !== "all" || Boolean(state.method || state.context.trim()) || state.plotIds !== null || state.constraints.some((filter) => filter.min != null || filter.max != null || filter.missing !== "any");
}

export function downloadAnalysisSnapshot(domain: Domain, records: AnalysisRecord[], location: DatabaseLocation): void {
  const payload = { format: "ioniclink-analysis", version: 1, exportedAt: new Date().toISOString(), domain, view: location, recordCount: records.length, records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `ioniclink-${domain}-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
}
