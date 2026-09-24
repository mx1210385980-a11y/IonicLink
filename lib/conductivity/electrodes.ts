import type { FlexibleField } from "../schema";
import type {
  ConductivityExtractedFields,
  ConductivityRecord,
  ElectrochemicalCellConfiguration,
} from "./schema";

const ELECTRODE_FLEX_KEYS = {
  cellSetup: /^(?:cell\s*(?:setup|configuration)|electrode\s*(?:setup|configuration)|电池构型|电极体系)$/i,
  workingElectrode: /^(?:working\s*electrode|WE|工作电极)$/i,
  counterElectrode: /^(?:counter\s*electrode|auxiliary\s*electrode|CE|对电极|辅助电极)$/i,
  referenceElectrode: /^(?:reference\s*electrode|RE|参比电极)$/i,
  positiveElectrode: /^(?:positive\s*electrode|cathode|正极)$/i,
  negativeElectrode: /^(?:negative\s*electrode|anode|负极)$/i,
} as const;

type ElectrodeFieldKey = keyof typeof ELECTRODE_FLEX_KEYS;

export interface ConductivityCellModel {
  configuration: ElectrochemicalCellConfiguration | "unknown";
  applicability: "electrochemical" | "not-applicable" | "unverified";
  setupLabel: string | null;
  surface: string | null;
  workingElectrode: string | null;
  counterElectrode: string | null;
  referenceElectrode: string | null;
  positiveElectrode: string | null;
  negativeElectrode: string | null;
}

export function normalizeCellConfiguration(raw: string | null | undefined): ElectrochemicalCellConfiguration | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (/\b(?:three|3)\s*[- ]?electrode\b|三电极/i.test(value)) return "three-electrode";
  if (/\b(?:two|2)\s*[- ]?electrode\b|双电极|两电极/i.test(value)) return "two-electrode";
  return undefined;
}

function flexibleValue(flexible: FlexibleField[], key: ElectrodeFieldKey): string | undefined {
  const matcher = ELECTRODE_FLEX_KEYS[key];
  return flexible.find((item) => matcher.test(item.key.trim()))?.value.trim() || undefined;
}

export function isElectrodeFlexibleField(field: FlexibleField): boolean {
  return Object.values(ELECTRODE_FLEX_KEYS).some((matcher) => matcher.test(field.key.trim()));
}

/**
 * Promote legacy catch-all electrode fields into the typed conductivity layer.
 * The helper is intentionally tolerant so already-stored records remain useful.
 */
export function promoteElectrodeFields(
  fields: Pick<ConductivityExtractedFields,
    | "cellConfiguration"
    | "cellSetup"
    | "workingElectrode"
    | "counterElectrode"
    | "referenceElectrode"
    | "positiveElectrode"
    | "negativeElectrode"
    | "surface"
    | "potentialReference"
  >,
  flexible: FlexibleField[],
) {
  const cellSetup = fields.cellSetup?.trim() || flexibleValue(flexible, "cellSetup");
  const workingElectrode = fields.workingElectrode?.trim() || flexibleValue(flexible, "workingElectrode");
  const sharedCounterReference = cellSetup?.match(/(?:^|[;,])\s*([^;,]+?)\s+counter\s*\/\s*reference\b/i)?.[1]?.trim();
  const counterElectrode = fields.counterElectrode?.trim() || flexibleValue(flexible, "counterElectrode") || sharedCounterReference;
  const referenceElectrode = fields.referenceElectrode?.trim() || flexibleValue(flexible, "referenceElectrode") || sharedCounterReference;
  const positiveElectrode = fields.positiveElectrode?.trim() || flexibleValue(flexible, "positiveElectrode");
  const negativeElectrode = fields.negativeElectrode?.trim() || flexibleValue(flexible, "negativeElectrode");
  const explicit = normalizeCellConfiguration(fields.cellConfiguration) ?? normalizeCellConfiguration(cellSetup);
  const inferred = referenceElectrode || counterElectrode
    ? "three-electrode"
    : positiveElectrode || negativeElectrode
      ? "two-electrode"
      : undefined;

  return {
    cellConfiguration: explicit ?? inferred,
    cellSetup,
    workingElectrode,
    counterElectrode,
    referenceElectrode,
    positiveElectrode,
    negativeElectrode,
    flexible: flexible.filter((item) => !isElectrodeFlexibleField(item)),
  };
}

/** Build the display model from both new typed fields and legacy flexible data. */
export function buildConductivityCellModel(record: ConductivityRecord): ConductivityCellModel {
  const e = record.extended;
  const legacy = promoteElectrodeFields(
    {
      cellConfiguration: e.cellConfiguration,
      cellSetup: e.cellSetup,
      workingElectrode: e.workingElectrode,
      counterElectrode: e.counterElectrode,
      referenceElectrode: e.referenceElectrode,
      positiveElectrode: e.positiveElectrode,
      negativeElectrode: e.negativeElectrode,
      surface: record.core.surface,
      potentialReference: e.potentialReference,
    },
    record.flexible,
  );
  const configuration = legacy.cellConfiguration ?? "unknown";
  const method = record.extended.method?.trim() ?? "";
  const bulkOnly = /^(?:bulk liquid|neat ionic liquid)$/i.test(record.core.surface.trim()) &&
    !record.core.capacitance &&
    !record.core.electrodePotential &&
    !record.core.electrochemicalWindow &&
    !record.core.chargeTransferResistance;
  const nonCellMethod = /(?:^|[;\s])(?:MD|molecular dynamics|finite-element simulation)(?:$|[;\s])/i.test(method);
  const applicability = configuration !== "unknown"
    ? "electrochemical"
    : bulkOnly || nonCellMethod
      ? "not-applicable"
      : "unverified";

  return {
    configuration,
    applicability,
    setupLabel: legacy.cellSetup ?? null,
    surface: record.core.surface?.trim() || null,
    workingElectrode: legacy.workingElectrode ?? (configuration === "three-electrode" ? record.core.surface?.trim() || null : null),
    counterElectrode: legacy.counterElectrode ?? null,
    referenceElectrode: legacy.referenceElectrode ?? (configuration === "three-electrode" ? e.potentialReference?.trim() || null : null),
    positiveElectrode: legacy.positiveElectrode ?? null,
    negativeElectrode: legacy.negativeElectrode ?? null,
  };
}
