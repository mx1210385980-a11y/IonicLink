import type { ConductivityDraft } from "../conductivity/schema";
import type { Quantity } from "../units";
import type { LiveDomain, LiveRow } from "./liveFields";
import { recordToSimpleRow } from "./simplePapers";

/** Source-grounded observations, not generated curves or default room temperatures. */
export function recordToLiveRows(domain: LiveDomain, draft: unknown): LiveRow[] {
  if (domain === "tribology") return [recordToSimpleRow(draft as Parameters<typeof recordToSimpleRow>[0])];
  if (domain === "afm") throw new Error("Use the AFM classroom recognizer for curve observations");
  const record = draft as ConductivityDraft;
  const c = record.core, e = record.extended;
  const quantity = (key: string, q: Quantity | null | undefined) => record.provenance?.[key]?.basis === "assumed" || /not stated|not reported/i.test(q?.raw || "") ? "NR" : q?.raw || "NR";
  const flex = (key: string) => {
    const field = record.flexible.find((item) => item.key.toLowerCase() === key.toLowerCase());
    return field ? `${field.value}${field.unit ? ` ${field.unit}` : ""}` : "NR";
  };
  const base: LiveRow = {
    cation: c.ionicLiquid.cation || "NR", anion: c.ionicLiquid.anion || "NR", surface: c.surface || "NR",
    temperature: quantity("temperature", c.temperature), concentration: e.concentration || "NR", scanRate: flex("scanRate"),
    potential: quantity("electrodePotential", c.electrodePotential), reference: e.potentialReference || e.referenceElectrode || "NR",
    method: e.method || "NR", variedParameter: "NR", variableValue: "NR", trend: "NR", evidence: "NR",
  };
  const fields = ["conductivity", "capacitance", "electricField", "electrochemicalWindow", "chargeTransferResistance"] as const;
  const observations: LiveRow[] = fields.flatMap((field) => {
    const q = c[field];
    if (!q || record.provenance?.[field]?.basis === "assumed") return [];
    const p = record.provenance?.[field];
    const dep = e.propertyDependencies?.find((item) => item.dependentField === field && item.scope === "record-series");
    return [{ ...base, property: field, value: q.raw, variedParameter: dep?.independentVariable || "NR", trend: dep?.trend || "NR",
      evidence: [p?.page ? `p. ${p.page}` : "", p?.figure, p?.table].filter(Boolean).join("; ") || "NR" }];
  });
  // Keep sparse series observations separate so values never lose their X condition.
  for (const dep of e.propertyDependencies ?? []) {
    if (dep.scope !== "record-series" || dep.source === "image-estimated") continue;
    const conditionKey = ({ temperature: "temperature", scanrate: "scanRate", concentration: "concentration", potential: "potential", electrodepotential: "potential" } as Record<string, string>)[dep.independentVariable.toLowerCase().replace(/[\s_-]/g, "")];
    for (const point of dep.observations) observations.push({ ...base, property: dep.dependentField, value: point.y, variableValue: point.x,
      variedParameter: dep.independentVariable, trend: dep.trend,
      ...(conditionKey ? { [conditionKey]: point.x } : {}),
      evidence: [`${dep.independentVariable}: ${point.x}`, point.seriesLabel, point.condition, dep.sourcePage ? `p. ${dep.sourcePage}` : ""].filter(Boolean).join("; ") });
  }
  for (const point of e.performanceFigure?.keyPoints ?? []) {
    if (point.scope !== "record" || point.source === "image-estimated" || !point.value) continue;
    observations.push({ ...base, property: point.field || point.label, value: point.y || point.value,
      variedParameter: point.x ? e.performanceFigure?.xAxis || "x" : "NR", variableValue: point.x || "NR",
      evidence: [point.sourcePage ? `p. ${point.sourcePage}` : "", e.performanceFigure?.figure, point.panelLabel, point.seriesLabel, point.condition].filter(Boolean).join("; ") || "NR" });
  }
  return observations.filter((row, i) => observations.findIndex((other) => JSON.stringify(other) === JSON.stringify(row)) === i);
}
