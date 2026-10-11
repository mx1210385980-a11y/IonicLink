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
  conductor: boolean;
  layered: boolean;
  plane: string;
  materialClass: string;
}

const DEFAULTS: { match: RegExp; props: SurfaceDefaults }[] = [
  {
    match: /^mica|muscovite/,
    props: { name: "mica", conductor: false, layered: true, plane: "(0001)", materialClass: "ceramic" },
  },
  {
    match: /^hopg|graphit|graphene/,
    props: { name: "HOPG", conductor: true, layered: true, plane: "(0001)", materialClass: "carbon" },
  },
  {
    match: /^au|gold/,
    props: {
      name: "Au",
      conductor: true,
      layered: false,
      plane: "(111)",
      materialClass: "metal",
    },
  },
  {
    match: /^(?:pt(?:\b|\()|platinum)/,
    props: {
      name: "Pt",
      conductor: true,
      layered: false,
      plane: "(111)",
      materialClass: "metal",
    },
  },
  {
    match: /silica|sio2|quartz|glass/,
    props: { name: "silica", conductor: false, layered: false, plane: "amorphous", materialClass: "ceramic" },
  },
  {
    match: /alumina|al2o3|sapphire/,
    props: { name: "alumina", conductor: false, layered: false, plane: "(0001)", materialClass: "ceramic" },
  },
  {
    match: /stainless|steel|iron/,
    props: { name: "stainless steel", conductor: true, layered: false, plane: "polycrystalline", materialClass: "metal" },
  },
  {
    match: /silicon|^si\b|^si\(/,
    props: { name: "silicon (native oxide)", conductor: false, layered: false, plane: "(100)", materialClass: "semiconductor" },
  },
  {
    match: /glassy\s*carbon/,
    props: { name: "glassy carbon", conductor: true, layered: false, plane: "amorphous", materialClass: "carbon" },
  },
  {
    match: /diamond|dlc/,
    props: { name: "diamond/DLC", conductor: false, layered: false, plane: "(111)", materialClass: "carbon" },
  },
  {
    match: /ptfe|teflon/,
    props: { name: "PTFE", conductor: false, layered: false, plane: "amorphous", materialClass: "polymer" },
  },
  {
    match: /titanium|\bti\b/,
    props: { name: "titanium", conductor: true, layered: false, plane: "polycrystalline", materialClass: "metal" },
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

  const verifiedSurfaceValue = (field: "surfaceEnergy" | "surfaceChargeDensity" | "contactAngle", raw?: string | null) => {
    const value = raw?.trim();
    const evidence = provenance[field];
    if (!value || !hasCitableEvidence(evidence)) {
      delete provenance[field];
      return undefined;
    }
    return value;
  };
  const surfaceEnergy = verifiedSurfaceValue("surfaceEnergy", reported.surfaceEnergy);
  const surfaceChargeDensity = verifiedSurfaceValue("surfaceChargeDensity", reported.surfaceChargeDensity);
  const contactAngle = verifiedSurfaceValue("contactAngle", reported.contactAngle);

  const descriptors: SurfaceDescriptors = {
    ...defaults,
    surfaceEnergy: surfaceEnergy ? parseQuantity(surfaceEnergy, "surfaceEnergy") ?? undefined : undefined,
    surfaceChargeDensity: surfaceChargeDensity
      ? parseQuantity(surfaceChargeDensity, "surfaceChargeDensity") ?? undefined
      : undefined,
    contactAngle: contactAngle ? parseQuantity(contactAngle, "angle") ?? undefined : undefined,
    roughness: reported.roughness?.trim()
      ? parseQuantity(reported.roughness, "length") ?? defaults.roughness
      : defaults.roughness,
    materialClass: reported.materialClass?.trim() || defaults.materialClass || surfaceMaterialClass(input.substrate),
    plane: reported.crystalPlane?.trim() || inferPlane(input.substrate) || defaults.plane,
    conductor: typeof reported.conductor === "boolean" ? reported.conductor : defaults.conductor,
    layered: typeof reported.layered === "boolean" ? reported.layered : defaults.layered,
  };

  for (const field of ["surfaceEnergy", "surfaceChargeDensity", "contactAngle"] as const) {
    if (!descriptors[field]) delete provenance[field];
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
  const mergedProvenance = {
    ...record.provenance,
    ...surface.provenance,
  };
  for (const field of ["surfaceEnergy", "surfaceChargeDensity", "contactAngle"] as const) {
    if (!surface.descriptors[field]) delete mergedProvenance[field];
  }

  return {
    ...record,
    extended: {
      ...record.extended,
      surface: surface.descriptors,
      roughness: record.extended?.roughness ?? surface.descriptors.roughness,
    },
    provenance: mergedProvenance,
  };
}

function assumedProvenance(substrate: string | null | undefined, basisNote: string): FieldProvenance {
  return {
    basis: "assumed",
    basisNote: `${basisNote}${substrate ? ` for ${substrate}` : ""}`,
  };
}

function hasCitableEvidence(evidence: FieldProvenance | undefined): boolean {
  if (!evidence || evidence.basis === "assumed") return false;
  return Boolean(
    evidence.page != null ||
      evidence.figure ||
      evidence.table ||
      evidence.section ||
      evidence.quote ||
      evidence.context ||
      evidence.figureBox
  );
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
