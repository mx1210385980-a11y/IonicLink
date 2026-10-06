"use client";

import { DatabaseView } from "@/components/DatabaseView";
import {
  buildConductivityGroupConditions,
  buildConductivitySystemFacets,
  ConductivityCard,
} from "@/components/conductivity/ConductivityCard";
import { ConductivityEditor } from "@/components/conductivity/ConductivityEditor";
import { median, paperCount, type ClientModule } from "@/components/registry.client";
import type { DatabaseInitialData } from "@/lib/databasePayload";
import { conductivityCoreCompleteness } from "@/lib/conductivity/schema";

export const conductivityClientModule: ClientModule = {
  label: "Conductivity",
  tagline: "Ionic-liquid transport and interfacial electrochemistry · curated readings",
  Card: ConductivityCard,
  Editor: ConductivityEditor,
  coreCompleteness: conductivityCoreCompleteness,
  facet: {
    label: "Method",
    options: [
      { value: "all", label: "All" },
      { value: "EIS", label: "EIS", dot: "#06b6d4" },
      { value: "conductivity cell", label: "Cond. cell", dot: "#475569" },
      { value: "CV", label: "CV" },
      { value: "chronoamperometry", label: "Chronoamperometry" },
      { value: "galvanostatic charge-discharge", label: "Charge-discharge" },
      { value: "MD simulation", label: "MD simulation" },
    ],
  },
  listStats: (records) => {
    const conductivity = median(records.map((record) => record.core?.conductivity?.std));
    let eis = 0;
    let cell = 0;
    for (const record of records) {
      if (record.extended?.method === "EIS") eis += 1;
      else if (record.extended?.method === "conductivity cell") cell += 1;
    }
    return [
      { label: "Records", value: String(records.length) },
      { label: "Papers", value: String(paperCount(records)) },
      { label: "Median σ", value: conductivity == null ? "—" : `${Number(conductivity.toPrecision(3))} S/m` },
      { label: "EIS · Cell", value: `${eis} · ${cell}` },
    ];
  },
  conditionItems: buildConductivityGroupConditions,
  systemFacets: buildConductivitySystemFacets,
};

export function ConductivityDatabaseView({ initialData }: { initialData: DatabaseInitialData }) {
  return <DatabaseView domain="conductivity" clientModule={conductivityClientModule} initialData={initialData} />;
}
