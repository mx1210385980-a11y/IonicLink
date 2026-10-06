"use client";

import { DatabaseView } from "@/components/DatabaseView";
import {
  buildDiffusionGroupConditions,
  buildDiffusionSystemFacets,
  DiffusionCard,
} from "@/components/diffusion/DiffusionCard";
import { DiffusionEditor } from "@/components/diffusion/DiffusionEditor";
import { median, paperCount, type ClientModule } from "@/components/registry.client";
import type { DatabaseInitialData } from "@/lib/databasePayload";
import { diffusionCoreCompleteness } from "@/lib/diffusion/schema";
import { formatStd } from "@/lib/units";

export const diffusionClientModule: ClientModule = {
  label: "Diffusion",
  tagline: "Ionic-liquid self-diffusion · curated readings",
  Card: DiffusionCard,
  Editor: DiffusionEditor,
  coreCompleteness: diffusionCoreCompleteness,
  facet: {
    label: "Species",
    options: [
      { value: "all", label: "All" },
      { value: "cation", label: "Cation Dₛ", dot: "#06b6d4" },
      { value: "anion", label: "Anion Dₛ", dot: "#10b981" },
    ],
  },
  listStats: (records) => {
    const diffusion = median(records.map((record) => record.core?.diffusion?.std));
    let cation = 0;
    let anion = 0;
    for (const record of records) {
      if (record.core?.species === "cation") cation += 1;
      else if (record.core?.species === "anion") anion += 1;
    }
    return [
      { label: "Records", value: String(records.length) },
      { label: "Papers", value: String(paperCount(records)) },
      { label: "Median D", value: diffusion == null ? "—" : formatStd(diffusion, "m²/s") },
      { label: "Cation · Anion", value: `${cation} · ${anion}` },
    ];
  },
  conditionItems: buildDiffusionGroupConditions,
  systemFacets: buildDiffusionSystemFacets,
};

export function DiffusionDatabaseView({ initialData }: { initialData: DatabaseInitialData }) {
  return <DatabaseView domain="diffusion" clientModule={diffusionClientModule} initialData={initialData} />;
}
