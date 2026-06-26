import type { FieldProvenance } from "./schema";
import { parseQuantity, type Quantity } from "./units";
import { standardizeSubstrate } from "./substrates";

export interface SurfaceDescriptors {
  surfaceEnergy?: Quantity;
  surfaceChargeDensity?: Quantity;
  contactAngle?: Quantity;
  roughness?: Quantity;
  materialClass?: string;
  plane?: string;
  conductor?: boolean;
  layered?: boolean;
}

export interface SurfaceDescriptorInput {
  substrate: string | null | undefined;
  reported?: {
    surfaceEnergy?: string | null;
    surfaceChargeDensity?: string | null;
    contactAngle?: string | null;
    roughness?: string | null;
    materialClass?: string | null;
    crystalPlane?: string | null;
    conductor?: boolean | null;
    layered?: boolean | null;
  };
  provenance?: Record<string, FieldProvenance | undefined>;
}

interface SurfaceDefaults {
  name: string;
  gammaMJm2: number | null;
  thetaDeg: number | null;
  sigmaCm2: number | null;
  roughnessNm: number | null;
  conductor: boolean;
  layered: boolean;
  plane: string;
  materialClass: string;
}

const DEFAULTS: { match: RegExp; props: SurfaceDefaults }[] = [
  // Calibrated from backend/data/wff/*0312.csv by surface-level medians.
  // The WFF CSV columns are empirical features: `σ_s` carries the effective
  // surface-energy scale (J/m² → mJ/m² here), while `γ_s` carries charge density
  // (C/m²). The UI keeps the user's physical labels: γ_s = surface energy,
  // σ_s = surface charge density. These are model priors, not reported facts.
  {
    match: /^mica|muscovite/,
    props: { name: "mica", gammaMJm2: 1770, thetaDeg: 0, sigmaCm2: -0.16, roughnessNm: 0.0569, conductor: false, layered: true, plane: "(0001)", materialClass: "ceramic" },
  },
  {
    match: /^hopg|graphit|graphene/,
    props: { name: "HOPG", gammaMJm2: 50, thetaDeg: 85, sigmaCm2: -0.0002, roughnessNm: 0.89, conductor: true, layered: true, plane: "(0001)", materialClass: "carbon" },
  },
  {
    match: /^au|gold/,
    props: {
      name: "Au",
      gammaMJm2: 700,
      thetaDeg: 60,
      sigmaCm2: -0.02,
      roughnessNm: 0.835,
      conductor: true,
      layered: false,
      plane: "(111)",
      materialClass: "metal",
    },
  },
  {
    match: /^pt|platinum/,
    props: {
      name: "Pt",
      gammaMJm2: 72,
      thetaDeg: 65,
      sigmaCm2: null,
      roughnessNm: null,
      conductor: true,
      layered: false,
      plane: "(111)",
      materialClass: "metal",
    },
  },
  {
    match: /silica|sio2|quartz|glass/,
    props: { name: "silica", gammaMJm2: 200, thetaDeg: 20.7, sigmaCm2: -0.07, roughnessNm: 0.5, conductor: false, layered: false, plane: "amorphous", materialClass: "ceramic" },
  },
  {
    match: /alumina|al2o3|sapphire/,
    props: { name: "alumina", gammaMJm2: 50, thetaDeg: 55, sigmaCm2: 0.01, roughnessNm: null, conductor: false, layered: false, plane: "(0001)", materialClass: "ceramic" },
  },
  {
    match: /stainless|steel|iron/,
    props: { name: "stainless steel", gammaMJm2: 70, thetaDeg: 72, sigmaCm2: 0.01, roughnessNm: 0.9, conductor: true, layered: false, plane: "polycrystalline", materialClass: "metal" },
  },
  {
    match: /silicon|^si\b|^si\(/,
    props: { name: "silicon (native oxide)", gammaMJm2: 55, thetaDeg: 40, sigmaCm2: -0.015, roughnessNm: null, conductor: false, layered: false, plane: "(100)", materialClass: "semiconductor" },
  },
  {
    match: /glassy\s*carbon/,
    props: { name: "glassy carbon", gammaMJm2: 50, thetaDeg: 70, sigmaCm2: 0, roughnessNm: null, conductor: true, layered: false, plane: "amorphous", materialClass: "carbon" },
  },
  {
    match: /diamond|dlc/,
    props: { name: "diamond/DLC", gammaMJm2: 45, thetaDeg: 80, sigmaCm2: 0, roughnessNm: null, conductor: false, layered: false, plane: "(111)", materialClass: "carbon" },
  },
  {
    match: /ptfe|teflon/,
    props: { name: "PTFE", gammaMJm2: 19, thetaDeg: 110, sigmaCm2: -0.00005, roughnessNm: 7, conductor: false, layered: false, plane: "amorphous", materialClass: "polymer" },
  },
  {
    match: /titanium|\bti\b/,
    props: { name: "titanium", gammaMJm2: 500, thetaDeg: 60, sigmaCm2: 0.005, roughnessNm: 61.15, conductor: true, layered: false, plane: "polycrystalline", materialClass: "metal" },
  },
];

export function normalizeSurfaceKey(raw: string | null | undefined): string {
  return standardizeSubstrate(raw).toLowerCase().replace(/\s+/g, "");
}

export function surfaceMaterialClass(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "other";
  if (/hopg|graphit|graphene|glassy\s*carbon|diamond|carbon/.test(s)) return "carbon";
  if (/mica|silica|sio2|alumina|al2o3|sapphire|glass|quartz|oxide|tio2|zro2|si3n4|nitride|ceramic/.test(s)) return "ceramic";
  if (/ptfe|pdms|peek|polyether|polymer|polyimide|nylon/.test(s)) return "polymer";
  if (/si\s*\(|silicon|\bsi\b/.test(s)) return "semiconductor";
  if (/au|gold|pt|platinum|ag|silver|cu|copper|steel|iron|nickel|\bni\b|titanium|\bti\b|chromium|tungsten|metal/.test(s)) return "metal";
  return "other";
}

function defaultProps(substrate: string | null | undefined): SurfaceDefaults | null {
  const key = normalizeSurfaceKey(substrate);
  if (!key) return null;
  for (const entry of DEFAULTS) {
    if (entry.match.test(key)) return entry.props;
  }
  return null;
}

export function surfaceDescriptorDefaults(substrate: string | null | undefined): SurfaceDescriptors | null {
  const props = defaultProps(substrate);
  if (!props) {
    const materialClass = surfaceMaterialClass(substrate);
    return materialClass === "other" ? null : { materialClass };
  }

  return {
    surfaceEnergy: props.gammaMJm2 == null ? undefined : parseQuantity(`${props.gammaMJm2} mJ/m2`, "surfaceEnergy") ?? undefined,
    surfaceChargeDensity: props.sigmaCm2 == null ? undefined : parseQuantity(`${props.sigmaCm2} C/m2`, "surfaceChargeDensity") ?? undefined,
    contactAngle: props.thetaDeg == null ? undefined : parseQuantity(`${props.thetaDeg}°`, "angle") ?? undefined,
    roughness: props.roughnessNm == null ? undefined : parseQuantity(`${props.roughnessNm} nm`, "length") ?? undefined,
    materialClass: props.materialClass,
    plane: inferPlane(substrate) ?? props.plane,
    conductor: props.conductor,
    layered: props.layered,
  };
}

export function buildSurfaceDescriptors(input: SurfaceDescriptorInput): {
  descriptors: SurfaceDescriptors;
  provenance: Record<string, FieldProvenance>;
} {
  const defaults = surfaceDescriptorDefaults(input.substrate) ?? {};
  const props = defaultProps(input.substrate);
  const reported = input.reported ?? {};
  const provenance = { ...(input.provenance ?? {}) } as Record<string, FieldProvenance>;

  const descriptors: SurfaceDescriptors = {
    ...defaults,
    surfaceEnergy: reported.surfaceEnergy?.trim()
      ? parseQuantity(reported.surfaceEnergy, "surfaceEnergy") ?? defaults.surfaceEnergy
      : defaults.surfaceEnergy,
    surfaceChargeDensity: reported.surfaceChargeDensity?.trim()
      ? parseQuantity(reported.surfaceChargeDensity, "surfaceChargeDensity") ?? defaults.surfaceChargeDensity
      : defaults.surfaceChargeDensity,
    contactAngle: reported.contactAngle?.trim()
      ? parseQuantity(reported.contactAngle, "angle") ?? defaults.contactAngle
      : defaults.contactAngle,
    roughness: reported.roughness?.trim()
      ? parseQuantity(reported.roughness, "length") ?? defaults.roughness
      : defaults.roughness,
    materialClass: reported.materialClass?.trim() || defaults.materialClass || surfaceMaterialClass(input.substrate),
    plane: reported.crystalPlane?.trim() || inferPlane(input.substrate) || defaults.plane,
    conductor: typeof reported.conductor === "boolean" ? reported.conductor : defaults.conductor,
    layered: typeof reported.layered === "boolean" ? reported.layered : defaults.layered,
  };

  assumeDefault("surfaceEnergy", descriptors.surfaceEnergy, !reported.surfaceEnergy?.trim(), input.substrate, provenance);
  assumeDefault("contactAngle", descriptors.contactAngle, !reported.contactAngle?.trim(), input.substrate, provenance);
  assumeDefault("roughness", descriptors.roughness, !reported.roughness?.trim(), input.substrate, provenance);
  if (descriptors.surfaceChargeDensity) {
    assumeDefault("surfaceChargeDensity", descriptors.surfaceChargeDensity, !reported.surfaceChargeDensity?.trim(), input.substrate, provenance);
  }
  if (descriptors.plane && !reported.crystalPlane?.trim()) {
    provenance.crystalPlane ??= assumedProvenance(input.substrate, `crystal plane inferred as a model prior from the substrate label/default table`);
  }
  if (descriptors.materialClass && !reported.materialClass?.trim()) {
    provenance.materialClass ??= assumedProvenance(input.substrate, `material class inferred as a model prior from the substrate label/default table`);
  }

  return { descriptors, provenance: pruneUndefinedProvenance(provenance) };
}

export function applySurfaceDescriptorsToRecord<T extends {
  core?: { substrate?: string };
  extended?: { surface?: SurfaceDescriptors; roughness?: Quantity };
  provenance?: Record<string, FieldProvenance>;
}>(record: T): T {
  const existing = record.extended?.surface;
  const reportedRaw = (field: string, raw: string | undefined): string | undefined =>
    record.provenance?.[field]?.basis === "assumed" ? undefined : raw;
  const surface = buildSurfaceDescriptors({
    substrate: record.core?.substrate,
    reported: {
      surfaceEnergy: reportedRaw("surfaceEnergy", existing?.surfaceEnergy?.raw),
      surfaceChargeDensity: reportedRaw("surfaceChargeDensity", existing?.surfaceChargeDensity?.raw),
      contactAngle: reportedRaw("contactAngle", existing?.contactAngle?.raw),
      roughness: reportedRaw("roughness", record.extended?.roughness?.raw ?? existing?.roughness?.raw),
      crystalPlane: reportedRaw("crystalPlane", existing?.plane),
      materialClass: reportedRaw("materialClass", existing?.materialClass),
      conductor: existing?.conductor,
      layered: existing?.layered,
    },
    provenance: record.provenance,
  });
  if (Object.keys(surface.descriptors).length === 0) return record;

  return {
    ...record,
    extended: {
      ...record.extended,
      surface: surface.descriptors,
      roughness: record.extended?.roughness ?? surface.descriptors.roughness,
    },
    provenance: {
      ...record.provenance,
      ...surface.provenance,
    },
  };
}

function assumeDefault(
  field: string,
  value: Quantity | undefined,
  usingDefault: boolean,
  substrate: string | null | undefined,
  provenance: Record<string, FieldProvenance | undefined>
): void {
  if (!value || !usingDefault) return;
  if (!provenance[field] || provenance[field]?.basis === "assumed") {
    provenance[field] = assumedProvenance(substrate, `${field} filled as a WFF-calibrated model prior, not a reported material property`);
  }
}

function assumedProvenance(substrate: string | null | undefined, basisNote: string): FieldProvenance {
  return {
    basis: "assumed",
    basisNote: `${basisNote}${substrate ? ` for ${substrate}` : ""}`,
  };
}

function inferPlane(substrate: string | null | undefined): string | undefined {
  const raw = substrate ?? "";
  const compact = raw.replace(/\s+/g, "");
  const plane = compact.match(/\((\d{3,4})\)/);
  return plane ? `(${plane[1]})` : undefined;
}

function pruneUndefinedProvenance(input: Record<string, FieldProvenance | undefined>): Record<string, FieldProvenance> {
  const out: Record<string, FieldProvenance> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value) out[key] = value;
  }
  return out;
}
