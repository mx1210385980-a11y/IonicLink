import {
  CORE_FIELDS,
  EXTRACTION_TOOL_SCHEMA,
  coreCompleteness,
  formatCof,
  type ExtractedFields,
  type IonicRecord,
} from "../schema";
import { ingest, toFields } from "../ingest";
import { fmtNum, type Quantity } from "../units";
import { first, matchAll, pageOf, snippet } from "../extractHelpers";
import type { Module } from "./types";

/**
 * The tribology (friction) module — domain #1. It owns the friction-specific
 * extraction prompt, tool schema, mock extractor, ingest, completeness,
 * promoted columns, and CSV mapping; the shared engine drives it through the
 * Module contract. Its promoted columns reproduce the historical `records`
 * schema exactly, so the migrated `tribology.db` is byte-compatible with the
 * old `ioniclink.db` (see scripts/migrate-domains.ts).
 */

const SYSTEM_PROMPT = `You are a meticulous tribology data extractor for IonicLink, a database of ionic-liquid lubrication measurements.

The atomic unit is one CONDITION-PERFORMANCE point: a friction coefficient bound to its full set of test conditions — never a bare material→number. Emit ONE record per distinct measurement; if the paper sweeps a variable (e.g. potential), emit one record per reported point.

Required (base layer) for every record: cation, anion, substrate, temperature, load, cof.
  - Use the paper's own shorthand for ions (e.g. [BMIM], [I]). Add SMILES only if confident.
  - substrate = the counter-surface, e.g. Au(111), mica, steel.
  - temperature WITH unit, e.g. "293.15 K" or "25 °C". If the paper does not state temperature, emit "not stated"; the platform records that as an assumed 293.15 K.
  - load = the NORMAL FORCE pressing the probe into the surface. ALWAYS a force (nN, µN, mN, N). NEVER a voltage.
  - cof = the numeric friction coefficient (dimensionless); cofMethod = how it was measured, if stated.

Common (extended layer), include when present: scale ("nano" for AFM/colloid-probe/lateral-force, "macro" for ball/pin-on-disk), method, probe, probeType, velocity, potential, roughness, surfaceEnergy (γ_s), surfaceChargeDensity (σ_s), contactAngle (θ_s), crystalPlane/materialClass, additives, afm.
  - probe = the probe MATERIAL with model/maker if stated, e.g. "silicon nitride (SNL, Bruker)"; probeType = geometry + size as stated, e.g. "Tip · 2 nm" (tip radius) or "Colloid · Ø 5 μm" (sphere diameter). KEY DATA ONLY — never copy the paper's describing sentence into these fields; instead add a provenance entry for field "probe" quoting that sentence verbatim. Never report a radius/size the paper does not state.
  - potential = applied bias / surface / electrochemical potential in volts (e.g. "+0.5 V", "0–2 V"). AFM tip/surface voltages go HERE, not in load. A deflection/photodiode setpoint in volts is an instrument signal — never a load.
  - surfaceEnergy/contactAngle/surfaceChargeDensity = solid-substrate descriptors ONLY when stated in the paper. Include units exactly as reported. crystalPlane/materialClass captures indicators such as "(111)", "(0001)", "polycrystalline", "amorphous", "metal", or "carbon".
  - For AFM: capture afm.scanRate (e.g. "1 Hz") and afm.scanSize / line length (e.g. "2 µm"). Report velocity ONLY if stated directly; if only scan rate/size are given, leave velocity null — the platform derives v = 2 × scan rate × scan size.

Unusual (flexible layer): anything notable without a formal field (paper-specific methods, humidity, atmosphere, unusual conditions) goes in flexible[] as {key, value, note}. Keep it rather than discard it.

Provenance: for each value you can locate, add a provenance[] entry {field, page, figure, table, section, quote}. Use the [PAGE n] markers in the text for the page number. The quote must be copied CHARACTER-FOR-CHARACTER from the text — quotes are verified by exact search against the source PDF, so never paraphrase, reword, or elide with "..."; for a table value quote one contiguous run of the row as printed (never stitch header and value cells together); if no contiguous snippet states the value, omit the quote and cite the figure/table instead. Prioritize cof and load — every published number lives somewhere specific, and that location is what makes the data verifiable. Set basis honestly: "direct" only when the text states the value for THIS measurement; "inferred" (with a basisNote) when it comes from general/methods context — e.g. a temperature stated for CV measurements is only inferred for the AFM friction data.

Keep units exactly as reported. Set confidence (0–1) honestly. Do not invent measurements.`;

const rawCell = (q: Quantity | null | undefined) => q?.raw ?? "";
const stdCell = (q: Quantity | null | undefined) => (q && q.std != null ? fmtNum(q.std) : "");

export const tribologyModule: Module<IonicRecord, ExtractedFields> = {
  domain: "tribology",
  label: "Tribology",
  tagline: "Ionic-liquid friction — one COF per condition point.",

  systemPrompt: SYSTEM_PROMPT,
  toolName: "submit_records",
  toolDescription: "Submit the standardized friction records extracted from the paper.",
  toolSchema: EXTRACTION_TOOL_SCHEMA,
  userPrompt: (body) => `Extract all friction records from this paper text:\n\n<paper>\n${body}\n</paper>`,
  mockExtract,

  ingest,
  toFields,
  coreCompleteness,
  coreFields: CORE_FIELDS.map((f) => ({ key: f.key, label: f.label })),

  promotedColumns: [
    { name: "substrate", type: "TEXT", get: (r) => r.core.substrate || null },
    { name: "scale", type: "TEXT", get: (r) => r.extended.scale || null },
    { name: "cof", type: "REAL", get: (r) => r.core.cof },
    { name: "temp_k", type: "REAL", get: (r) => r.core.temperature?.std ?? null },
    { name: "load_n", type: "REAL", get: (r) => r.core.load?.std ?? null },
  ],
  searchColumns: ["paper_title", "cation", "anion", "substrate"],
  facet: { key: "scale", column: "scale", values: ["nano", "macro"] },

  csvHeaders: [
    "id",
    "paper_title",
    "journal",
    "year",
    "doi",
    "cation",
    "anion",
    "substrate",
    "temperature_raw",
    "temperature_K",
    "load_raw",
    "load_N",
    "cof",
    "cof_method",
    "scale",
    "method",
    "probe",
    "probe_type",
    "velocity_raw",
    "velocity_m_s",
    "velocity_source",
    "potential_raw",
    "potential_V",
    "roughness_raw",
    "roughness_m",
    "surface_energy_raw",
    "surface_energy_mJ_m2",
    "surface_charge_raw",
    "surface_charge_C_m2",
    "contact_angle_raw",
    "contact_angle_deg",
    "crystal_plane",
    "material_class",
    "additives",
    "film_thickness_raw",
    "film_thickness_m",
    "film_layers",
    "water_content",
    "concentration",
    "scan_rate",
    "scan_size",
    "flexible_json",
    "provenance_json",
    "status",
  ],
  csvRow: (r) => {
    const c = r.core;
    const e = r.extended;
    return [
      r.id,
      r.paper.title,
      r.paper.journal ?? "",
      r.paper.year ?? "",
      r.paper.doi ?? "",
      c.ionicLiquid.cation,
      c.ionicLiquid.anion,
      c.substrate,
      rawCell(c.temperature),
      stdCell(c.temperature),
      rawCell(c.load),
      stdCell(c.load),
      c.cof === null ? "" : formatCof(c.cof),
      e.cofMethod ?? "",
      e.scale ?? "",
      e.method ?? "",
      e.probe ?? "",
      e.probeType ?? "",
      rawCell(e.velocity),
      stdCell(e.velocity),
      e.velocitySource ?? "",
      rawCell(e.potential),
      stdCell(e.potential),
      rawCell(e.roughness),
      stdCell(e.roughness),
      rawCell(e.surface?.surfaceEnergy),
      stdCell(e.surface?.surfaceEnergy),
      rawCell(e.surface?.surfaceChargeDensity),
      stdCell(e.surface?.surfaceChargeDensity),
      rawCell(e.surface?.contactAngle),
      stdCell(e.surface?.contactAngle),
      e.surface?.plane ?? "",
      e.surface?.materialClass ?? "",
      e.additives ?? "",
      rawCell(e.filmThickness),
      stdCell(e.filmThickness),
      e.filmLayers ?? "",
      e.waterContent ?? "",
      e.concentration ?? "",
      e.afm?.scanRate ?? "",
      e.afm?.scanSize ?? "",
      r.flexible.length ? JSON.stringify(r.flexible) : "",
      r.provenance && Object.keys(r.provenance).length ? JSON.stringify(r.provenance) : "",
      r.status,
    ];
  },
  recordHeadline: (r) => `COF ${formatCof(r.core.cof)}`,
};

/* ------------------------------------------------------------------ */
/* Deterministic offline extractor — scans the text for ion shorthands, */
/* COF mentions, and condition tokens so Extract works without a key.   */
/* ------------------------------------------------------------------ */

export function mockExtract(text: string): ExtractedFields[] {
  const title =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 12) || "Untitled paper";

  const ionPairs = matchAll(text, /\[([A-Za-z0-9]{1,8})\]/g)
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  const cation = ionPairs[0] ? `[${ionPairs[0]}]` : "[BMIM]";
  const anion = ionPairs[1] ? `[${ionPairs[1]}]` : "[I]";

  const cofs = matchAll(text, /(?:cof|coefficient of friction|friction coefficient)[^0-9]{0,20}(0?\.\d{1,4})/gi)
    .map((m) => parseFloat(m[1]))
    .filter((n) => !Number.isNaN(n));

  const potential =
    first(text, /([+-]?\d+(?:\.\d+)?\s*[–-]\s*[+-]?\d+(?:\.\d+)?\s?V)\b/) ??
    first(text, /([+-]?\d+(?:\.\d+)?\s?V)\b/);
  const velocity = first(text, /(\d+(?:\.\d+)?\s?(?:µm|um|nm|mm|m)\/s)/);
  const temperature =
    first(text, /(\d{2,3}(?:\.\d+)?\s?K\b)/) ?? first(text, /(\d{1,3}(?:\.\d+)?\s?°?\s?C)\b/);
  const load = first(text, /([<>]?\s?\d+(?:\.\d+)?\s?(?:nN|µN|uN|mN|N)\b)/);
  const roughness = first(text, /(?:roughness|Ra)[^0-9]{0,12}(\d+(?:\.\d+)?\s?(?:nm|µm|Å))/i);
  const scale: "nano" | "macro" = /afm|colloid|lateral force|nN\b/i.test(text) ? "nano" : "macro";
  const scanRate =
    first(text, /scan rate[^0-9]{0,20}(\d+(?:\.\d+)?\s?(?:kHz|Hz))/i) ??
    first(text, /(\d+(?:\.\d+)?\s?(?:kHz|Hz))\b/i);
  const scanSize =
    first(text, /scan (?:size|area|length|range)[^0-9]{0,20}(\d+(?:\.\d+)?\s?(?:nm|µm|um|mm))/i) ??
    first(text, /(\d+(?:\.\d+)?\s?(?:µm|um|nm))\s*(?:scan|line)/i);
  const humidity = first(text, /(\d+(?:\.\d+)?\s?%\s?(?:RH|relative humidity))/i);

  const values = cofs.length ? cofs.slice(0, 5) : [null];
  return values.map((cof) => {
    const provenance: ExtractedFields["provenance"] = [];
    if (cof != null) {
      const idx = text.indexOf(String(cof));
      if (idx >= 0) provenance.push({ field: "cof", page: pageOf(text, idx), quote: snippet(text, idx) });
    }
    if (load) {
      const idx = text.indexOf(load);
      if (idx >= 0) provenance.push({ field: "load", page: pageOf(text, idx), quote: snippet(text, idx) });
    }
    return {
      paper: { title },
      cation,
      anion,
      substrate: first(text, /(Au\(\d{3}\)|mica|HOPG|graphite|steel|sapphire|silicon)/i) ?? "",
      temperature: temperature ?? undefined,
      load: load ?? undefined,
      cof,
      scale,
      method: scale === "nano" ? "AFM" : "Tribometer",
      probe: first(text, /(silica|silicon|steel|diamond|tungsten)/i) ?? undefined,
      potential: potential ?? undefined,
      velocity: velocity ?? undefined,
      roughness: roughness ?? undefined,
      afm:
        scanRate || scanSize
          ? { scanRate: scanRate ?? undefined, scanSize: scanSize ?? undefined }
          : undefined,
      flexible: humidity ? [{ key: "humidity", value: humidity, note: "captured by mock extractor" }] : [],
      provenance,
      confidence: 0.4,
    };
  });
}
