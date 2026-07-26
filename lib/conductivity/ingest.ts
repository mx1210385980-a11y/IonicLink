import type { FlexibleField, ProvenanceMap } from "../schema";
import { parseQuantity, ROOM_TEMPERATURE_RAW } from "../units";
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

  const flexible: FlexibleField[] = (f.flexible ?? [])
    .filter((x) => x && x.key && x.value)
    .map((x) => ({
      key: x.key.trim(),
      value: String(x.value).trim(),
      unit: x.unit?.trim() || undefined,
      note: x.note?.trim() || undefined,
    }));

  const temperature = parseQuantity(f.temperature?.trim() || ROOM_TEMPERATURE_RAW, "temperature");
  const conductivity = parseQuantity(f.conductivity, "conductivity");

  const extended: ConductivityExtended = {
    method: f.method?.trim() || undefined,
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
        cationSmiles: f.cationSmiles?.trim() || resolveIonSmiles(cation, "cation"),
        anionSmiles: f.anionSmiles?.trim() || resolveIonSmiles(anion, "anion"),
      },
      surface: (f.surface ?? "").trim(),
      temperature,
      conductivity,
    },
    extended,
    flexible,
    confidence,
  };
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
