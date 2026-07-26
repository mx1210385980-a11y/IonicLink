import type {
  ExtractedFields,
  ExtendedFields,
  FlexibleField,
  ProvenanceMap,
  RecordDraft,
} from "./schema";
import { parseQuantity, ROOM_TEMPERATURE_RAW } from "./units";
import { deriveExtendedVelocity, isVoltageLoad } from "./afm";
import { resolveIonSmiles } from "./ionStructures";
import { standardizeSubstrate } from "./substrates";
import { buildSurfaceDescriptors } from "./surfaceDescriptors";

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
  const cation = (f.cation ?? "").trim();
  const anion = (f.anion ?? "").trim();

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
    const layerMatch = /layer/i.test(filmRaw) ? filmRaw.match(/[\d.]+/) : null;
    if (layerMatch) filmLayers = Number(layerMatch[0]);
    else filmThickness = parseQuantity(filmRaw, "length") ?? undefined;
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
    probeType: f.probeType?.trim() || undefined,
    potential: parseQuantity(f.potential, "potential") ?? undefined,
    roughness: parseQuantity(f.roughness, "length") ?? surface.descriptors.roughness,
    additives: f.additives?.trim() || undefined,
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
    filmThickness: r.extended.filmThickness?.raw ?? (r.extended.filmLayers != null ? `${r.extended.filmLayers} layers` : undefined),
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
