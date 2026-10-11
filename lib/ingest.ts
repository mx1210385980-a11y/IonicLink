import type {
  ExtractedFields,
  ExtendedFields,
  FlexibleField,
  ProvenanceMap,
  RecordDraft,
} from "./schema";
import { parseQuantity, ROOM_TEMPERATURE_RAW } from "./units";
import { deriveExtendedVelocity, isVoltageLoad } from "./afm";
import { normalizeExtractedIonLabel, resolveIonSmiles } from "./ionStructures";
import { standardizeSubstrate } from "./substrates";
import { buildSurfaceDescriptors } from "./surfaceDescriptors";

const PROBE_UNIT_PATTERN = "(?:nm|µm|μm|um|mm)";
const PROBE_DIAMETER_RE = new RegExp(
  `(?:diameter|dia\\.?|[Øø⌀])\\s*[:=]?\\s*([~≈]?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:±\\s*(\\d+(?:\\.\\d+)?)\\s*)?(${PROBE_UNIT_PATTERN})`,
  "i",
);

type ReportedRadius = {
  qualifier: string;
  value: string;
  uncertainty?: string;
  unit: string;
};

function normalizedProbeUnit(unit: string): string {
  return unit.toLowerCase().replace(/[µμ]/g, "u");
}

function normalizedAdditives(additives: string | undefined): string | undefined {
  const value = additives?.trim();
  if (!value) return undefined;
  const explicitlyEmpty = /^(?:none|no additives?|without(?: any)? additives?|not applicable|n\/?a)(?:\s*\([^)]*\))?\.?$/i;
  return explicitlyEmpty.test(value) ? undefined : value;
}

function reportedRadii(quote: string): ReportedRadius[] {
  const radii: ReportedRadius[] = [];
  const inline = new RegExp(
    `(?:probe\\s+)?radius\\s*[:=]?\\s*([~≈]?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:±\\s*(\\d+(?:\\.\\d+)?)\\s*)?(${PROBE_UNIT_PATTERN})`,
    "gi",
  );
  for (const match of quote.matchAll(inline)) {
    radii.push({ qualifier: match[1] || "", value: match[2], uncertainty: match[3], unit: match[4] });
  }

  const table = quote.match(new RegExp(`probe\\s+radius\\s*\\(\\s*(${PROBE_UNIT_PATTERN})\\s*\\)([\\s\\S]*)`, "i"));
  if (table) {
    const values = /(\d+(?:\.\d+)?)\s*(?:±\s*(\d+(?:\.\d+)?))?/g;
    for (const match of table[2].matchAll(values)) {
      radii.push({ qualifier: "", value: match[1], uncertainty: match[2], unit: table[1] });
    }
  }
  return radii;
}

/** Restore a directly reported radius when the model unnecessarily converted it to diameter. */
function probeTypeAsReported(probeType: string | undefined, evidenceQuote: string | undefined): string | undefined {
  const raw = probeType?.trim();
  if (!raw || !evidenceQuote) return raw || undefined;

  const diameter = raw.match(PROBE_DIAMETER_RE);
  if (!diameter) return raw;
  const diameterValue = Number(diameter[2]);
  const diameterUnit = normalizedProbeUnit(diameter[4]);
  const reported = reportedRadii(evidenceQuote).find(
    (candidate) =>
      normalizedProbeUnit(candidate.unit) === diameterUnit &&
      Math.abs(Number(candidate.value) * 2 - diameterValue) <= Math.max(1, diameterValue) * 1e-9,
  );
  if (!reported) return raw;

  const shape = raw.replace(diameter[0], "").replace(/^[\s·|,;:=-]+|[\s·|,;:=-]+$/g, "").trim();
  const uncertainty = reported.uncertainty ? ` ± ${reported.uncertainty}` : "";
  const measurement = `radius ${reported.qualifier}${reported.value}${uncertainty} ${reported.unit}`;
  return shape ? `${shape} · ${measurement}` : measurement;
}

/**
 * Ingestion = turn raw extracted fields into a standardized, three-layer record:
 *   - parse every dimensional field into a Quantity (raw + canonical),
 *   - sort fields into core / extended / flexible,
 *   - apply the load-voltage guard and the AFM velocity rule,
 *   - keep anything unusual in the flexible (raw JSON) layer with a note.
 *
 * This is the single entry point for both AI extraction and manual edits, so
 * every record in the database is standardized the same way.
 */
export function ingest(f: ExtractedFields): RecordDraft {
  const cation = normalizeExtractedIonLabel(f.cation, "cation");
  const anion = normalizeExtractedIonLabel(f.anion, "anion");

  const flexible: FlexibleField[] = (f.flexible ?? [])
    .filter((x) => x && x.key && x.value)
    .map((x) => ({ key: x.key.trim(), value: String(x.value).trim(), unit: x.unit?.trim() || undefined, note: x.note?.trim() || undefined }));

  // --- base layer ---
  const temperature = parseQuantity(f.temperature?.trim() || ROOM_TEMPERATURE_RAW, "temperature");

  let load = null;
  let voltageLoadCaught = false;
  if (f.load && f.load.trim()) {
    if (isVoltageLoad(f.load)) {
      // A voltage is not a load — don't discard it; park it in the flexible
      // layer with a note so a curator can reclassify it.
      voltageLoadCaught = true;
      flexible.push({
        key: "reported_load_voltage",
        value: f.load.trim(),
        note: "A voltage was reported where a load (force) was expected — verify (bias vs deflection setpoint).",
      });
    } else {
      load = parseQuantity(f.load, "force");
    }
  }

  const cof = typeof f.cof === "number" ? f.cof : null;

  // Film thickness: a stated layer COUNT ("3 layers") and a measured length
  // ("2.5 nm") are different observations — kept in separate fields, never
  // converted into each other.
  const filmRaw = f.filmThickness?.trim() || "";
  let filmThickness;
  let filmLayers;
  if (filmRaw) {
    const layerMatch = filmRaw.match(/(?<![\d.])(\d+)\s*(?:ion\s+)?layers?\b/i);
    if (layerMatch) filmLayers = Number(layerMatch[1]);
    else if (/\b(?:a\s+)?single\s+(?:ion\s+)?layer\b/i.test(filmRaw)) filmLayers = 1;
    const lengthMatch = filmRaw.match(/(?:[~≈]?\s*\d+(?:\.\d+)?\s*(?:±\s*\d+(?:\.\d+)?\s*)?)(?:nm|µm|μm|um|mm|pm|Å|m)\b/i);
    if (lengthMatch) filmThickness = parseQuantity(lengthMatch[0], "length") ?? undefined;
    else if (filmLayers == null) filmThickness = parseQuantity(filmRaw, "length") ?? undefined;
  }

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
      figureBox: p.figureBox, // curator-drawn crop, preserved across edits
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
  const substrate = standardizeSubstrate(f.substrate, provenance.substrate);
  const surface = buildSurfaceDescriptors({
    substrate,
    reported: {
      surfaceEnergy: f.surfaceEnergy,
      surfaceChargeDensity: f.surfaceChargeDensity,
      contactAngle: f.contactAngle,
      roughness: f.roughness,
      crystalPlane: f.crystalPlane,
      materialClass: f.materialClass,
    },
    provenance,
  });
  Object.assign(provenance, surface.provenance);

  // --- middle layer ---
  let extended: ExtendedFields = {
    scale: f.scale,
    method: f.method?.trim() || undefined,
    probe: f.probe?.trim() || undefined,
    probeType: probeTypeAsReported(f.probeType, provenance.probe?.quote),
    potential: parseQuantity(f.potential, "potential") ?? undefined,
    roughness: parseQuantity(f.roughness, "length") ?? surface.descriptors.roughness,
    additives: normalizedAdditives(f.additives),
    cofMethod: f.cofMethod?.trim() || undefined,
    velocity: parseQuantity(f.velocity, "velocity") ?? undefined,
    surface: Object.keys(surface.descriptors).length ? surface.descriptors : undefined,
    filmThickness,
    filmLayers: Number.isFinite(filmLayers) ? filmLayers : undefined,
    waterContent: f.waterContent?.trim() || undefined,
    concentration: f.concentration?.trim() || undefined,
    afm:
      f.afm && (f.afm.scanRate || f.afm.scanSize)
        ? { scanRate: f.afm.scanRate || undefined, scanSize: f.afm.scanSize || undefined }
        : undefined,
  };
  extended = deriveExtendedVelocity(extended);
  if (extended.velocity && extended.velocitySource === "derived" && !provenance.velocity) {
    const scanProvenance = provenance.scanRate ?? provenance.scanSize;
    if (scanProvenance) {
      provenance.velocity = {
        ...scanProvenance,
        basis: scanProvenance.basis === "assumed" ? "assumed" : "inferred",
        basisNote:
          scanProvenance.basisNote ??
          "Velocity standardized from the AFM scan parameters; inspect scanRate/scanSize evidence for the reported basis.",
      };
    }
  }

  // Confidence: respect the model, but flag a caught voltage-as-load for review.
  let confidence = typeof f.confidence === "number" ? clamp01(f.confidence) : null;
  if (voltageLoadCaught) confidence = Math.min(confidence ?? 1, 0.5);

  if (temperature && !/\d/.test(temperature.raw) && !provenance.temperature) {
    provenance.temperature = {
      basis: "assumed",
      basisNote: `no explicit value — "${temperature.raw}" recorded as ${temperature.std} K by convention`,
    };
  }

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
      substrate,
      temperature,
      load,
      cof,
    },
    extended,
    flexible,
    confidence,
  };
}

/** Reverse of ingest: flatten a record back to editable raw fields. */
export function toFields(r: RecordDraft): ExtractedFields {
  return {
    paper: r.paper,
    cation: r.core.ionicLiquid.cation,
    anion: r.core.ionicLiquid.anion,
    cationSmiles: r.core.ionicLiquid.cationSmiles,
    anionSmiles: r.core.ionicLiquid.anionSmiles,
    substrate: r.core.substrate,
    temperature: r.core.temperature?.raw,
    load: r.core.load?.raw,
    cof: r.core.cof,
    cofMethod: r.extended.cofMethod,
    scale: r.extended.scale,
    method: r.extended.method,
    probe: r.extended.probe,
    probeType: r.extended.probeType,
    // a derived velocity is not a reported value — don't round-trip it as one
    velocity: r.extended.velocitySource === "derived" ? undefined : r.extended.velocity?.raw,
    potential: r.extended.potential?.raw,
    roughness: r.extended.roughness?.raw,
    surfaceEnergy: r.extended.surface?.surfaceEnergy?.raw,
    surfaceChargeDensity: r.extended.surface?.surfaceChargeDensity?.raw,
    contactAngle: r.extended.surface?.contactAngle?.raw,
    crystalPlane: r.extended.surface?.plane,
    materialClass: r.extended.surface?.materialClass,
    additives: r.extended.additives,
    filmThickness: r.extended.filmThickness
      ? `${r.extended.filmThickness.raw}${r.extended.filmLayers != null ? ` (${r.extended.filmLayers} layers)` : ""}`
      : r.extended.filmLayers != null ? `${r.extended.filmLayers} layers` : undefined,
    waterContent: r.extended.waterContent,
    concentration: r.extended.concentration,
    afm: r.extended.afm,
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
