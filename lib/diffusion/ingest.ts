import type { FlexibleField, ProvenanceMap } from "../schema";
import { parseQuantity } from "../units";
import { resolveIonSmiles } from "../ionStructures";
import type {
  DiffusionDraft,
  DiffusionExtended,
  DiffusionExtractedFields,
} from "./schema";

/**
 * Diffusion ingestion: raw extracted fields → a standardized three-layer draft.
 * Parses D → m²/s (including "5.2 × 10⁻¹¹ m² s⁻¹" scientific notation, handled
 * by the unit layer), viscosity → Pa·s, and the confinement scale (poreSize,
 * "2.5 nm" / "38 Å") → m, resolves ion SMILES via the shared resolver, and
 * sorts the optional fields into extended/flexible. The confined-system name
 * (systemName) is kept verbatim — it is the author's own label.
 */
export function ingest(f: DiffusionExtractedFields): DiffusionDraft {
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

  const temperature = parseQuantity(f.temperature, "temperature");
  const diffusion = parseQuantity(f.diffusion, "diffusion");

  const extended: DiffusionExtended = {
    systemName: f.systemName?.trim() || undefined,
    poreSize: parseQuantity(f.poreSize, "length") ?? undefined,
    material: f.material?.trim() || undefined,
    geometry: f.geometry?.trim() || undefined,
    functionalGroups: f.functionalGroups?.trim() || undefined,
    polarizable: f.polarizable?.trim() || undefined,
    method: f.method?.trim() || undefined,
    nucleus: f.nucleus?.trim() || undefined,
    surface: f.surface?.trim() || undefined,
    viscosity: parseQuantity(f.viscosity, "viscosity") ?? undefined,
    waterContent: f.waterContent?.trim() || undefined,
    concentration: f.concentration?.trim() || undefined,
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
      species: (f.species ?? "").trim(),
      temperature,
      diffusion,
    },
    extended,
    flexible,
    confidence,
  };
}

/** Reverse of ingest: flatten a record back to editable raw fields. */
export function toFields(r: DiffusionDraft): DiffusionExtractedFields {
  return {
    paper: r.paper,
    cation: r.core.ionicLiquid.cation,
    anion: r.core.ionicLiquid.anion,
    cationSmiles: r.core.ionicLiquid.cationSmiles,
    anionSmiles: r.core.ionicLiquid.anionSmiles,
    species: r.core.species,
    temperature: r.core.temperature?.raw,
    diffusion: r.core.diffusion?.raw,
    systemName: r.extended.systemName,
    poreSize: r.extended.poreSize?.raw,
    material: r.extended.material,
    geometry: r.extended.geometry,
    functionalGroups: r.extended.functionalGroups,
    polarizable: r.extended.polarizable,
    method: r.extended.method,
    nucleus: r.extended.nucleus,
    surface: r.extended.surface,
    viscosity: r.extended.viscosity?.raw,
    waterContent: r.extended.waterContent,
    concentration: r.extended.concentration,
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
