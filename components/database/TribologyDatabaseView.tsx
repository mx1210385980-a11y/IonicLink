"use client";

import { DatabaseView } from "@/components/DatabaseView";
import { buildGroupConditionItems, buildSystemFacets, RecordCard } from "@/components/RecordCard";
import { RecordEditor } from "@/components/RecordEditor";
import { median, paperCount, type ClientModule } from "@/components/registry.client";
import type { DatabaseInitialData } from "@/lib/databasePayload";
import { coreCompleteness, formatCof } from "@/lib/schema";

export const tribologyClientModule: ClientModule = {
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
    const cof = median(records.map((record) => record.core?.cof));
    let nano = 0;
    let macro = 0;
    for (const record of records) {
      if (record.extended?.scale === "nano") nano += 1;
      else if (record.extended?.scale === "macro") macro += 1;
    }
    return [
      { label: "Records", value: String(records.length) },
      { label: "Papers", value: String(paperCount(records)) },
      { label: "Median COF", value: cof == null ? "—" : formatCof(cof) },
      { label: "Nano · Macro", value: `${nano} · ${macro}` },
    ];
  },
  conditionItems: buildGroupConditionItems,
  systemFacets: buildSystemFacets,
};

export function TribologyDatabaseView({ initialData }: { initialData: DatabaseInitialData }) {
  return <DatabaseView domain="tribology" clientModule={tribologyClientModule} initialData={initialData} />;
}
