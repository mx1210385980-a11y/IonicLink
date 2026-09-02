import type { FlexibleField, ProvenanceMap } from "../schema";
import { parseQuantity, type Quantity } from "../units";
import { resolveIonSmiles } from "../ionStructures";
import type {
  ConductivityDraft,
  ConductivityExtended,
  ConductivityExtractedFields,
} from "./schema";

/**
 * Conductivity ingestion: raw extracted fields → a standardized three-layer
 * draft. Parses σ → S/m and viscosity → Pa·s, resolves ion SMILES via the
 * shared resolver, and sorts the optional fields into extended/flexible. Unlike
 * the tribology ingest there is NO AFM/load/voltage logic.
 */
export function ingest(f: ConductivityExtractedFields): ConductivityDraft {
  const cation = (f.cation ?? "").trim();
  const anion = (f.anion ?? "").trim();

  const flexibleInput: FlexibleField[] = (f.flexible ?? [])
    .filter((x) => x && x.key && x.value)
    .map((x) => ({
      key: x.key.trim(),
      value: String(x.value).trim(),
      unit: x.unit?.trim() || undefined,
      note: x.note?.trim() || undefined,
    }));
  const pressureIndex = flexibleInput.findIndex((item) => /^(?:pressure|press\.?|压力|压强)$/i.test(item.key));
  const pressureField = pressureIndex >= 0 ? flexibleInput[pressureIndex] : undefined;
  const pressureRaw = f.pressure?.trim() || (pressureField ? `${pressureField.value}${pressureField.unit ? ` ${pressureField.unit}` : ""}` : "");
  const pressure = parseQuantity(pressureRaw, "pressure");
  const flexible = pressure && pressureIndex >= 0
    ? flexibleInput.filter((_, index) => index !== pressureIndex)
    : flexibleInput;

  const temperature = parseConductivityTemperature(f.temperature);
  const conductivity = parseQuantity(f.conductivity, "conductivity");
  const capacitance = parseQuantity(f.capacitance, "capacitance");
  const electricField = parseQuantity(f.electricField, "electricField");
  const electrodePotential = parseQuantity(f.electrodePotential, "potential");
  const electrochemicalWindow = parseQuantity(f.electrochemicalWindow, "potential");
  const chargeTransferResistance = parseQuantity(f.chargeTransferResistance, "resistance");
  const extended: ConductivityExtended = {
    method: f.method?.trim() || undefined,
    potentialReference: f.potentialReference?.trim() || undefined,
    pressure: pressure ?? undefined,
    viscosity: parseQuantity(f.viscosity, "viscosity") ?? undefined,
    waterContent: f.waterContent?.trim() || undefined,
    concentration: f.concentration?.trim() || undefined,
    density: f.density?.trim() || undefined,
    cellConstant: f.cellConstant?.trim() || undefined,
  };

  // Per-field provenance: array → map, keeping only entries with content.
  const provenance: ProvenanceMap = {};
  for (const p of f.provenance ?? []) {
    if (!p?.field) continue;
    const entry = {
      page: typeof p.page === "number" ? p.page : undefined,
      figure: p.figure?.trim() || undefined,
      table: p.table?.trim() || undefined,
      section: p.section?.trim() || undefined,
      quote: p.quote?.trim() || undefined,
      context: p.context?.trim() || undefined,
      figureBox: p.figureBox,
      basis: p.basis === "direct" || p.basis === "inferred" || p.basis === "assumed" ? p.basis : undefined,
      basisNote: p.basisNote?.trim() || undefined,
    };
    if (
      entry.page != null ||
      entry.figure ||
      entry.table ||
      entry.section ||
      entry.quote ||
      entry.context ||
      entry.figureBox ||
      entry.basis ||
      entry.basisNote
    ) {
      provenance[p.field] = entry;
    }
  }

  const confidence = typeof f.confidence === "number" ? clamp01(f.confidence) : null;

  return {
    paper: f.paper,
    provenance: Object.keys(provenance).length ? provenance : undefined,
    core: {
      ionicLiquid: {
        cation,
        anion,
        cationSmiles: resolveIonSmiles(cation, "cation") || f.cationSmiles?.trim() || undefined,
        anionSmiles: resolveIonSmiles(anion, "anion") || f.anionSmiles?.trim() || undefined,
      },
      surface: (f.surface ?? "").trim(),
      temperature,
      conductivity,
      capacitance,
      electricField,
      electrodePotential,
      electrochemicalWindow,
      chargeTransferResistance,
    },
    extended,
    flexible,
    confidence,
  };
}

/**
 * Conductivity records must not turn a qualitative condition such as "room
 * temperature" into an unlabelled exact value.  Preserve the reported wording;
 * only temperatures with an explicit number can be standardized to kelvin.
 */
function parseConductivityTemperature(raw: string | null | undefined): Quantity | null {
  if (!raw?.trim()) return null;
  if (!/[-+]?\d/.test(raw)) {
    return {
      raw: raw.trim(),
      value: null,
      unit: "",
      std: null,
      stdUnit: "K",
      approx: true,
    };
  }
  return parseQuantity(raw, "temperature");
}

/** Reverse of ingest: flatten a record back to editable raw fields. */
export function toFields(r: ConductivityDraft): ConductivityExtractedFields {
  return {
    paper: r.paper,
    cation: r.core.ionicLiquid.cation,
    anion: r.core.ionicLiquid.anion,
    cationSmiles: r.core.ionicLiquid.cationSmiles,
    anionSmiles: r.core.ionicLiquid.anionSmiles,
    surface: r.core.surface,
    temperature: r.core.temperature?.raw,
    conductivity: r.core.conductivity?.raw,
    capacitance: r.core.capacitance?.raw,
    electricField: r.core.electricField?.raw,
    electrodePotential: r.core.electrodePotential?.raw,
    electrochemicalWindow: r.core.electrochemicalWindow?.raw,
    chargeTransferResistance: r.core.chargeTransferResistance?.raw,
    potentialReference: r.extended.potentialReference,
    pressure: r.extended.pressure?.raw,
    method: r.extended.method,
    viscosity: r.extended.viscosity?.raw,
    waterContent: r.extended.waterContent,
    concentration: r.extended.concentration,
    density: r.extended.density,
    cellConstant: r.extended.cellConstant,
    flexible: r.flexible,
    provenance: r.provenance
      ? Object.entries(r.provenance).map(([field, p]) => ({ field, ...p }))
      : undefined,
    confidence: r.confidence,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
