import { isVoltageLoad } from "./afm";
import { standardizeIonFormula } from "./ionStructures";
import { coreCompleteness, type FieldProvenance, type IonicRecord } from "./schema";

export type CurationIssueCode =
  | "missing_core_fields"
  | "cof_out_of_expected_range"
  | "load_out_of_expected_range"
  | "load_looks_like_potential"
  | "potential_looks_like_load"
  | "missing_cof_evidence"
  | "missing_load_evidence"
  | "missing_substrate_evidence"
  | "duplicate_condition_point";

export interface CurationIssue {
  code: CurationIssueCode;
  message: string;
  fields?: string[];
}

export interface KeepReviewEntry {
  record: IonicRecord;
  reasons: CurationIssue[];
}

export interface DuplicateGroup {
  fingerprint: string;
  records: IonicRecord[];
}

export interface ConditionFieldCoverage {
  velocity: number;
  potential: number;
  roughness: number;
  concentration: number;
  waterContent: number;
  filmThickness: number;
}

export interface OfficialCurationPlan {
  promote: IonicRecord[];
  demote: IonicRecord[];
  keepReview: KeepReviewEntry[];
  officialIssues: KeepReviewEntry[];
  duplicateGroups: DuplicateGroup[];
}

export interface CoverageSummary {
  recordCount: number;
  paperCount: number;
  ionPairCount: number;
  cationCount: number;
  anionCount: number;
  substrateCount: number;
  conditionFields: ConditionFieldCoverage;
  topIonPairs: { cation: string; anion: string; count: number }[];
  substrates: { substrate: string; count: number }[];
}

const HARD_ISSUES = new Set<CurationIssueCode>([
  "missing_core_fields",
  "cof_out_of_expected_range",
  "load_out_of_expected_range",
  "load_looks_like_potential",
  "potential_looks_like_load",
]);

const FORCE_UNIT_RE = /\d\s*(nN|µN|μN|uN|cN|mN|kN|N)\b/i;

export function officialFingerprint(record: IonicRecord): string {
  const core = record.core;
  const extended = record.extended;
  const paperIdentity = normalize(record.paper.doi) || normalize(record.paper.title);
  const parts = [
    ["paper", paperIdentity],
    ["cation", normalizeIonLabel(core.ionicLiquid.cation, "cation")],
    ["anion", normalizeIonLabel(core.ionicLiquid.anion, "anion")],
    ["substrate", normalize(core.substrate)],
    ["scale", normalize(extended.scale)],
    ["cof", numberKey(core.cof)],
    ["temperature", quantityKey(core.temperature)],
    ["load", quantityKey(core.load)],
    ["potential", quantityKey(extended.potential)],
    ["velocity", quantityKey(extended.velocity)],
    ["roughness", quantityKey(extended.roughness)],
    ["filmThickness", quantityKey(extended.filmThickness)],
    ["filmLayers", numberKey(extended.filmLayers)],
    ["concentration", normalize(extended.concentration)],
    ["waterContent", normalize(extended.waterContent)],
  ];

  return parts.map(([key, value]) => `${key}:${value}`).join("|");
}

export function classifyRecordIssues(record: IonicRecord): CurationIssue[] {
  const issues: CurationIssue[] = [];
  const completeness = coreCompleteness(record);

  if (!completeness.complete) {
    issues.push({
      code: "missing_core_fields",
      message: `Missing core fields: ${completeness.missing.join(", ")}`,
      fields: completeness.missing,
    });
  }

  const cof = record.core.cof;
  if (typeof cof === "number" && Number.isFinite(cof) && (cof < 0 || cof > 2)) {
    issues.push({
      code: "cof_out_of_expected_range",
      message: "COF is outside the accepted curation range.",
      fields: ["COF"],
    });
  }

  const load = record.core.load;
  if (load?.std != null && Number.isFinite(load.std) && (load.std <= 0 || load.std > 1000)) {
    issues.push({
      code: "load_out_of_expected_range",
      message: "Load is outside the accepted curation range.",
      fields: ["Load"],
    });
  }

  if (isVoltageLoad(load?.raw)) {
    issues.push({
      code: "load_looks_like_potential",
      message: "Load appears to be a potential value.",
      fields: ["Load"],
    });
  }

  if (looksLikeForce(record.extended.potential?.raw)) {
    issues.push({
      code: "potential_looks_like_load",
      message: "Potential appears to be a load value.",
      fields: ["Potential"],
    });
  }

  if (record.status === "official") {
    for (const field of ["cof", "load", "substrate"] as const) {
      if (!hasEvidence(record.provenance?.[field])) {
        issues.push({
          code: `missing_${field}_evidence` as CurationIssueCode,
          message: `${field} has no curation evidence.`,
          fields: [field],
        });
      }
    }
  }

  return issues;
}

export function planOfficialCuration(input: {
  officialRecords: IonicRecord[];
  reviewRecords: IonicRecord[];
}): OfficialCurationPlan {
  const promote: IonicRecord[] = [];
  const demote: IonicRecord[] = [];
  const keepReview: KeepReviewEntry[] = [];
  const officialIssues: KeepReviewEntry[] = [];
  const duplicateGroups = findDuplicateGroups([...input.officialRecords, ...input.reviewRecords]);
  const demoteIds = new Set<string>();

  for (const record of input.officialRecords) {
    const issues = classifyRecordIssues(record);
    if (issues.some((issue) => HARD_ISSUES.has(issue.code))) {
      demote.push(record);
      demoteIds.add(record.id);
    } else if (issues.length > 0) {
      officialIssues.push({ record, reasons: issues });
    }
  }

  const seenPromotable = new Set(
    input.officialRecords
      .filter((record) => !demoteIds.has(record.id))
      .map(officialFingerprint)
  );

  for (const record of input.reviewRecords) {
    const issues = classifyOfficialCandidateIssues(record);
    const fingerprint = officialFingerprint(record);
    if (seenPromotable.has(fingerprint)) {
      issues.push({
        code: "duplicate_condition_point",
        message: "Condition-performance point already exists in the curation set.",
      });
    }

    if (issues.length === 0) {
      promote.push(record);
      seenPromotable.add(fingerprint);
    } else {
      keepReview.push({ record, reasons: issues });
    }
  }

  return { promote, demote, keepReview, officialIssues, duplicateGroups };
}

export function buildCoverageSummary(records: IonicRecord[]): CoverageSummary {
  const papers = new Set<string>();
  const ionPairs = new Map<string, { cation: string; anion: string; count: number }>();
  const cations = new Set<string>();
  const anions = new Set<string>();
  const substrates = new Map<string, { substrate: string; count: number }>();
  const conditionFields: ConditionFieldCoverage = {
    velocity: 0,
    potential: 0,
    roughness: 0,
    concentration: 0,
    waterContent: 0,
    filmThickness: 0,
  };

  for (const record of records) {
    const paperKey = normalize(record.paper.doi) || normalize(record.paper.title);
    if (paperKey) papers.add(paperKey);

    const cation = record.core.ionicLiquid.cation;
    const anion = record.core.ionicLiquid.anion;
    if (cation.trim()) cations.add(normalize(cation));
    if (anion.trim()) anions.add(normalize(anion));

    const ionPairKey = `${normalize(cation)}|${normalize(anion)}`;
    if (normalize(cation) || normalize(anion)) {
      const current = ionPairs.get(ionPairKey) ?? { cation, anion, count: 0 };
      current.count += 1;
      ionPairs.set(ionPairKey, current);
    }

    const substrate = record.core.substrate.trim();
    const substrateKey = normalize(substrate);
    if (substrateKey) {
      const current = substrates.get(substrateKey) ?? { substrate, count: 0 };
      current.count += 1;
      substrates.set(substrateKey, current);
    }

    if (record.extended.velocity) conditionFields.velocity += 1;
    if (record.extended.potential) conditionFields.potential += 1;
    if (record.extended.roughness && record.provenance?.roughness?.basis !== "assumed") {
      conditionFields.roughness += 1;
    }
    if (record.extended.concentration) conditionFields.concentration += 1;
    if (record.extended.waterContent) conditionFields.waterContent += 1;
    if (record.extended.filmThickness) conditionFields.filmThickness += 1;
  }

  return {
    recordCount: records.length,
    paperCount: papers.size,
    ionPairCount: ionPairs.size,
    cationCount: cations.size,
    anionCount: anions.size,
    substrateCount: substrates.size,
    conditionFields,
    topIonPairs: [...ionPairs.values()].sort(compareIonPairCounts).slice(0, 20),
    substrates: [...substrates.values()]
      .sort((a, b) => b.count - a.count || a.substrate.localeCompare(b.substrate))
      .slice(0, 20),
  };
}

function findDuplicateGroups(records: IonicRecord[]): DuplicateGroup[] {
  const groups = new Map<string, IonicRecord[]>();
  for (const record of records) {
    const fingerprint = officialFingerprint(record);
    const group = groups.get(fingerprint) ?? [];
    group.push(record);
    groups.set(fingerprint, group);
  }

  return [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([fingerprint, records]) => ({ fingerprint, records }));
}

function hasEvidence(provenance?: FieldProvenance): boolean {
  return Boolean(provenance?.quote || provenance?.figure || provenance?.table || provenance?.section);
}

function looksLikeForce(raw?: string | null): boolean {
  return Boolean(raw && FORCE_UNIT_RE.test(raw) && !isVoltageLoad(raw));
}

function classifyOfficialCandidateIssues(record: IonicRecord): CurationIssue[] {
  return classifyRecordIssues({ ...record, status: "official" });
}

function normalizeIonLabel(value: string | null | undefined, kind: "cation" | "anion"): string {
  return normalize(standardizeIonFormula(value, kind)).replace(/[^a-z0-9]/g, "");
}

function quantityKey(quantity?: { raw: string; std: number | null; unit?: string } | null): string {
  if (!quantity) return "";
  if (quantity.std != null && Number.isFinite(quantity.std)) return numberKey(quantity.std);
  return normalize(quantity.raw);
}

function numberKey(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Number(value.toPrecision(12))) : "";
}

function normalize(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compareIonPairCounts(
  a: { cation: string; anion: string; count: number },
  b: { cation: string; anion: string; count: number }
): number {
  return b.count - a.count || a.cation.localeCompare(b.cation) || a.anion.localeCompare(b.anion);
}
