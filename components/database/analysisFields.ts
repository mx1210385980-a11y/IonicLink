import type { Domain } from "@/lib/domain";
import { standardizeIonLabel, type IonKind } from "@/lib/ionStructures";
import { formatCof } from "@/lib/schema";
import { rawLabel, stdLabel, type Quantity } from "@/lib/units";
import type { AnalysisField, AnalysisRecord, AnalysisSort, PlotConfig } from "./analysisTypes";

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const cleanText = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

function textField(key: string, label: string, read: (record: AnalysisRecord) => unknown, provenanceKey = key): AnalysisField {
  return { key, label, provenanceKey, getValue: (record) => cleanText(read(record)), format: (record) => cleanText(read(record)) ?? "—" };
}

function numberField(key: string, label: string, read: (record: AnalysisRecord) => unknown): AnalysisField {
  return { key, label, numeric: true, provenanceKey: key, getValue: (record) => finite(read(record)), format: (record) => finite(read(record))?.toString() ?? "—" };
}

/** Keep a reported uncertainty alongside the standardized central value. No uncertainty is inferred from prose. */
function quantityFormat(quantity: Quantity | null | undefined, units: "raw" | "std"): string {
  if (units === "raw") return rawLabel(quantity);
  const label = stdLabel(quantity);
  return quantity?.raw && /±|\+\/-/.test(quantity.raw) && label !== quantity.raw
    ? `${label} (reported: ${quantity.raw})`
    : label;
}

function quantityField(key: string, label: string, unit: string, read: (record: AnalysisRecord) => Quantity | null | undefined, provenanceKey = key): AnalysisField {
  return {
    key, label, unit, numeric: true, provenanceKey, getQuantity: read,
    getValue: (record) => finite(read(record)?.std),
    format: (record, units) => quantityFormat(read(record), units),
  };
}

function ionField(kind: IonKind): AnalysisField {
  const raw = (record: AnalysisRecord) => cleanText(record.core?.ionicLiquid?.[kind]);
  return {
    key: kind, label: kind === "cation" ? "Cation" : "Anion", provenanceKey: kind,
    getValue: (record) => raw(record) ? standardizeIonLabel(raw(record), kind) : null,
    format: (record, units) => raw(record) ? units === "std" ? standardizeIonLabel(raw(record), kind) : raw(record)! : "—",
  };
}

function flexibleValue(record: AnalysisRecord, ...keys: string[]): string | null {
  const names = new Set(keys.map((key) => key.toLowerCase().replace(/[\s_-]/g, "")));
  const item = record.flexible?.find((field) => names.has(field.key.toLowerCase().replace(/[\s_-]/g, "")));
  return item?.value?.trim() ? [item.value.trim(), item.unit?.trim()].filter(Boolean).join(" ") : null;
}

const common = [
  textField("id", "Record", (record) => record.id),
  ionField("cation"), ionField("anion"),
  quantityField("temperature", "Temperature", "K", (record) => record.core?.temperature),
  textField("method", "Method", (record) => record.extended?.method),
  textField("waterContent", "Water content", (record) => record.extended?.waterContent ?? flexibleValue(record, "waterContent", "water content")),
  textField("concentration", "Concentration", (record) => record.extended?.concentration ?? flexibleValue(record, "concentration")),
  textField("additives", "Additives", (record) => record.extended?.additives ?? flexibleValue(record, "additives", "additive")),
  textField("paper", "Paper", (record) => record.paper?.title),
  numberField("year", "Year", (record) => record.paper?.year),
];

const cofField: AnalysisField = {
  key: "metric", label: "COF", numeric: true, provenanceKey: "cof",
  getValue: (record) => finite(record.core?.cof),
  format: (record) => {
    const value = finite(record.core?.cof);
    if (value == null) return "—";
    const uncertainty = flexibleValue(record, "cof_uncertainty", "cof uncertainty", "cof error", "cof_error");
    return `${formatCof(value)}${uncertainty ? ` ${/^(?:±|\+\/-)/.test(uncertainty) ? uncertainty : `±${uncertainty}`}` : ""}`;
  },
};

const fieldsByDomain: Record<Domain, AnalysisField[]> = {
  tribology: [
    ...common, cofField,
    textField("substrate", "Substrate", (record) => record.core?.substrate),
    textField("scale", "Scale", (record) => record.extended?.scale),
    textField("probe", "Probe", (record) => record.extended?.probe),
    textField("probeType", "Probe type", (record) => record.extended?.probeType, "probe"),
    textField("cofMethod", "COF method", (record) => record.extended?.cofMethod),
    quantityField("load", "Load", "N", (record) => record.core?.load),
    quantityField("velocity", "Velocity", "m/s", (record) => record.extended?.velocity),
    quantityField("potential", "Potential", "V", (record) => record.extended?.potential),
    quantityField("roughness", "Roughness", "m", (record) => record.extended?.roughness ?? record.extended?.surface?.roughness),
    quantityField("filmThickness", "Film thickness", "m", (record) => record.extended?.filmThickness),
    numberField("filmLayers", "Film layers", (record) => record.extended?.filmLayers),
    quantityField("surfaceChargeDensity", "Surface charge", "C/m²", (record) => record.extended?.surface?.surfaceChargeDensity),
    textField("crystalPlane", "Crystal plane", (record) => record.extended?.surface?.plane),
    textField("materialClass", "Material class", (record) => record.extended?.surface?.materialClass),
  ],
  conductivity: [
    ...common,
    quantityField("metric", "Conductivity", "S/m", (record) => record.core?.conductivity, "conductivity"),
    quantityField("capacitance", "Capacitance", "F", (record) => record.core?.capacitance),
    quantityField("electricField", "Electric field", "V/m", (record) => record.core?.electricField),
    quantityField("electrodePotential", "Electrode potential", "V", (record) => record.core?.electrodePotential),
    quantityField("electrochemicalWindow", "Electrochemical window", "V", (record) => record.core?.electrochemicalWindow),
    quantityField("chargeTransferResistance", "Charge-transfer resistance", "Ω", (record) => record.core?.chargeTransferResistance),
    quantityField("pressure", "Pressure", "Pa", (record) => record.extended?.pressure),
    textField("potentialReference", "Potential reference", (record) => record.extended?.potentialReference),
    textField("cellConfiguration", "Cell configuration", (record) => record.extended?.cellConfiguration),
    textField("workingElectrode", "Working electrode", (record) => record.extended?.workingElectrode),
    textField("counterElectrode", "Counter electrode", (record) => record.extended?.counterElectrode),
    textField("referenceElectrode", "Reference electrode", (record) => record.extended?.referenceElectrode),
    textField("positiveElectrode", "Positive electrode", (record) => record.extended?.positiveElectrode),
    textField("negativeElectrode", "Negative electrode", (record) => record.extended?.negativeElectrode),
    textField("surface", "Surface", (record) => record.core?.surface),
    quantityField("viscosity", "Viscosity", "Pa·s", (record) => record.extended?.viscosity),
    textField("density", "Density", (record) => record.extended?.density),
    textField("cellConstant", "Cell constant", (record) => record.extended?.cellConstant),
  ],
  diffusion: [
    ...common,
    quantityField("metric", "Diffusion D", "m²/s", (record) => record.core?.diffusion, "diffusion"),
    textField("species", "Species", (record) => record.core?.species),
    textField("systemName", "Confined system", (record) => record.extended?.systemName),
    quantityField("poreSize", "Pore size", "m", (record) => record.extended?.poreSize),
    textField("material", "Material", (record) => record.extended?.material),
    textField("geometry", "Geometry", (record) => record.extended?.geometry),
    textField("nucleus", "Nucleus", (record) => record.extended?.nucleus),
    textField("functionalGroups", "Functional groups", (record) => record.extended?.functionalGroups),
    textField("polarizable", "Polarizability", (record) => record.extended?.polarizable),
    textField("surface", "Surface", (record) => record.extended?.surface),
    quantityField("viscosity", "Viscosity", "Pa·s", (record) => record.extended?.viscosity),
  ],
};

export function getAnalysisFields(domain: Domain): AnalysisField[] { return fieldsByDomain[domain]; }

export function defaultColumns(domain: Domain): string[] {
  const context = domain === "tribology" ? ["substrate", "scale", "load", "velocity"] : domain === "conductivity" ? ["surface", "viscosity"] : ["species", "systemName", "poreSize"];
  return ["id", "cation", "anion", "metric", ...context, "temperature", "method", "paper", "year"];
}

export function defaultPlotConfig(domain: Domain): PlotConfig {
  return { x: domain === "tribology" ? "load" : "temperature", y: "metric", logX: domain === "tribology", logY: domain === "diffusion", groupBy: "method" };
}

/** Missing/non-finite values stay last in both directions; ties retain input order. */
export function sortAnalysisRecords(records: AnalysisRecord[], fields: AnalysisField[], sort: AnalysisSort): AnalysisRecord[] {
  const field = fields.find((candidate) => candidate.key === sort.key);
  if (!field) return [...records];
  const direction = sort.direction === "desc" ? -1 : 1;
  return records.map((record, index) => ({ record, index, value: field.getValue(record) })).sort((a, b) => {
    const missing = (value: string | number | null) => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));
    if (missing(a.value) || missing(b.value)) return Number(missing(a.value)) - Number(missing(b.value)) || a.index - b.index;
    const comparison = typeof a.value === "number" && typeof b.value === "number"
      ? a.value - b.value : String(a.value).localeCompare(String(b.value), "en", { numeric: true, sensitivity: "base" });
    return comparison * direction || a.index - b.index;
  }).map(({ record }) => record);
}
