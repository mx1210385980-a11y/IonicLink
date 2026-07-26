"use client";

import type { Domain } from "@/lib/domain";
import { buildGroupConditionItems, buildSystemFacets, RecordCard } from "@/components/RecordCard";
import { RecordEditor } from "@/components/RecordEditor";
import { buildConductivityGroupConditions, buildConductivitySystemFacets, ConductivityCard } from "@/components/conductivity/ConductivityCard";
import { ConductivityEditor } from "@/components/conductivity/ConductivityEditor";
import { buildDiffusionGroupConditions, buildDiffusionSystemFacets, DiffusionCard } from "@/components/diffusion/DiffusionCard";
import { DiffusionEditor } from "@/components/diffusion/DiffusionEditor";
import type { ConditionItem, UnitMode } from "@/components/recordCardParts";
import { coreCompleteness, formatCof } from "@/lib/schema";
import { conductivityCoreCompleteness } from "@/lib/conductivity/schema";
import { diffusionCoreCompleteness } from "@/lib/diffusion/schema";
import { formatStd } from "@/lib/units";

/**
 * Client-side module registry — the React half (card, editor) plus the small
 * display hooks the generalized pages need (facet options, at-a-glance stats,
 * the completeness gate). Kept separate from registry.server so server-only
 * code (better-sqlite3) never lands in client bundles.
 */

export interface FacetUI {
  label: string;
  /** Includes the "all" option first. */
  options: { value: string; label: string; dot?: string }[];
}

export interface ClientModule {
  label: string;
  tagline: string;
  Card: React.ComponentType<any>;
  Editor: React.ComponentType<any>;
  coreCompleteness: (r: any) => { complete: boolean; missing: string[] };
  facet: FacetUI;
  listStats: (records: any[]) => { label: string; value: string }[];
  /** Condition items for group-level comparison (the shared-conditions strip). */
  conditionItems: (record: any, units: UnitMode) => ConditionItem[];
  /** System-identity facets — a paper comparing systems splits into one sub-group per distinct combination. */
  systemFacets: (record: any, units: UnitMode) => ConditionItem[];
}

function median(nums: number[]): number | null {
  const s = nums.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const papersOf = (records: any[]) => new Set(records.map((r) => r.paper?.title)).size;

export const CLIENT_MODULES: Record<Domain, ClientModule> = {
  tribology: {
    label: "Tribology",
    tagline: "Ionic-liquid tribology · curated readings",
    Card: RecordCard,
    Editor: RecordEditor,
    coreCompleteness,
    facet: {
      label: "Scale",
      options: [
        { value: "all", label: "All" },
        { value: "nano", label: "Nano / AFM", dot: "#06b6d4" },
        { value: "macro", label: "Macro / Tribometer", dot: "#475569" },
      ],
    },
    listStats: (records) => {
      const m = median(records.map((r) => r.core?.cof));
      let nano = 0;
      let macro = 0;
      for (const r of records) {
        if (r.extended?.scale === "nano") nano++;
        else if (r.extended?.scale === "macro") macro++;
      }
      return [
        { label: "Records", value: String(records.length) },
        { label: "Papers", value: String(papersOf(records)) },
        { label: "Median COF", value: m == null ? "—" : formatCof(m) },
        { label: "Nano · Macro", value: `${nano} · ${macro}` },
      ];
    },
    conditionItems: buildGroupConditionItems,
    systemFacets: buildSystemFacets,
  },
  conductivity: {
    label: "Conductivity",
    tagline: "Ionic-liquid conductivity · curated readings",
    Card: ConductivityCard,
    Editor: ConductivityEditor,
    coreCompleteness: conductivityCoreCompleteness,
    facet: {
      label: "Method",
      options: [
        { value: "all", label: "All" },
        { value: "EIS", label: "EIS", dot: "#06b6d4" },
        { value: "conductivity cell", label: "Cond. cell", dot: "#475569" },
      ],
    },
    listStats: (records) => {
      const m = median(records.map((r) => r.core?.conductivity?.std));
      let eis = 0;
      let cell = 0;
      for (const r of records) {
        if (r.extended?.method === "EIS") eis++;
        else if (r.extended?.method === "conductivity cell") cell++;
      }
      return [
        { label: "Records", value: String(records.length) },
        { label: "Papers", value: String(papersOf(records)) },
        { label: "Median σ", value: m == null ? "—" : `${Number(m.toPrecision(3))} S/m` },
        { label: "EIS · Cell", value: `${eis} · ${cell}` },
      ];
    },
    conditionItems: buildConductivityGroupConditions,
    systemFacets: buildConductivitySystemFacets,
  },
  diffusion: {
    label: "Diffusion",
    tagline: "Ionic-liquid self-diffusion · curated readings",
    Card: DiffusionCard,
    Editor: DiffusionEditor,
    coreCompleteness: diffusionCoreCompleteness,
    facet: {
      label: "Species",
      options: [
        { value: "all", label: "All" },
        { value: "cation", label: "Cation D⁺", dot: "#06b6d4" },
        { value: "anion", label: "Anion D⁻", dot: "#10b981" },
      ],
    },
    listStats: (records) => {
      const m = median(records.map((r) => r.core?.diffusion?.std));
      let cat = 0;
      let an = 0;
      for (const r of records) {
        if (r.core?.species === "cation") cat++;
        else if (r.core?.species === "anion") an++;
      }
      return [
        { label: "Records", value: String(records.length) },
        { label: "Papers", value: String(papersOf(records)) },
        { label: "Median D", value: m == null ? "—" : formatStd(m, "m²/s") },
        { label: "Cation · Anion", value: `${cat} · ${an}` },
      ];
    },
    conditionItems: buildDiffusionGroupConditions,
    systemFacets: buildDiffusionSystemFacets,
  },
};

export function getClientModule(domain: Domain): ClientModule {
  return CLIENT_MODULES[domain];
}
