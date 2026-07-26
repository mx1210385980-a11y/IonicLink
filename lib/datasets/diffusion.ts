import { ingest } from "../diffusion/ingest";
import type { DiffusionExtractedFields } from "../diffusion/schema";
import type { FlexibleField, FieldProvenance } from "../schema";
import { displayValue } from "./parse";
import type {
  DatasetAdaptation,
  DatasetColumnMapping,
  DatasetPreviewRecord,
  TabularScalar,
  TabularSheet,
} from "./types";

export const DIFFUSION_DATASET_ADAPTER = "diffusion-tabular-v1";

const ALIASES = {
  paperTitle: ["paper_title", "title", "article_title", "citation"],
  journal: ["journal"],
  year: ["year", "publication_year"],
  doi: ["doi"],
  systemName: ["system_name", "confinement_system", "system"],
  cation: ["cation"],
  anion: ["anion"],
  ionicLiquid: ["ionic_liquid", "ionic_liquid_name", "il"],
  dCation: ["d_cation", "diffusion_cation", "cation_diffusion"],
  dAnion: ["d_anion", "diffusion_anion", "anion_diffusion"],
  dTotal: ["d_total", "diffusion_total", "diffusion", "d"],
  dUnit: ["d_unit", "diffusion_unit"],
  temperature: ["temperature_value", "temperature", "temp", "t"],
  temperatureUnit: ["temperature_unit", "temp_unit", "t_unit"],
  poreSize: ["confinement_scale_value", "pore_size", "pore_size_value", "confinement_scale"],
  poreSizeUnit: ["confinement_scale_unit", "pore_size_unit"],
  method: ["method", "measurement_method"],
  nucleus: ["nucleus", "nmr_nucleus"],
  surface: ["surface", "electrode_surface"],
  viscosity: ["viscosity", "viscosity_value"],
  viscosityUnit: ["viscosity_unit"],
  waterContent: ["water_content"],
  concentration: ["concentration"],
  source: ["source", "source_table", "table"],
} as const;

type AliasKey = keyof typeof ALIASES;

export function adaptDiffusionDataset(
  sheets: TabularSheet[],
  context: { filename: string; fingerprint: string; paperTitle?: string }
): DatasetAdaptation {
  const drafts: DatasetAdaptation["drafts"] = [];
  const invalidRows: DatasetAdaptation["invalidRows"] = [];
  const warnings = new Set<string>();
  const mappings = new Map<string, DatasetColumnMapping>();
  const preview: DatasetPreviewRecord[] = [];
  let inputRows = 0;

  for (const sheet of sheets) {
    const normalizedHeaders = sheet.headers.map(normalizeHeader);
    const columns = resolveColumns(normalizedHeaders);
    recordMappings(sheet.headers, columns, mappings);
    const recognized = new Set(Object.values(columns).filter((value): value is number => value != null));
    for (const row of sheet.rows) {
      inputRows += 1;
      const get = (key: AliasKey) => valueAt(row.values, columns[key]);
      const cationDirect = get("cation");
      const anionDirect = get("anion");
      const ionPair = parseIonPair(get("ionicLiquid"));
      if (ionPair?.inferred) {
        warnings.add("Hyphenated ionic-liquid names were split into cation and anion at '-'; review these mappings.");
      }
      const cation = cationDirect || ionPair?.cation || "";
      const anion = anionDirect || ionPair?.anion || "";
      if (!cation || !anion) {
        invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: "Could not resolve cation and anion" });
        continue;
      }

      const temperatureValue = get("temperature");
      if (!temperatureValue) {
        invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: "Missing temperature" });
        continue;
      }
      const temperatureUnit = get("temperatureUnit") || "K";
      if (!get("temperatureUnit")) warnings.add("Temperature unit was absent; values were interpreted as K.");

      const dUnit = get("dUnit") || "m2/s";
      if (!get("dUnit")) warnings.add("Diffusion unit was absent; values were interpreted as m2/s.");
      const speciesValues: { species: "cation" | "anion" | "overall"; value: string; header?: string }[] = [];
      const dCation = get("dCation");
      const dAnion = get("dAnion");
      if (dCation) speciesValues.push({ species: "cation", value: dCation, header: headerAt(sheet, columns.dCation) });
      if (dAnion) speciesValues.push({ species: "anion", value: dAnion, header: headerAt(sheet, columns.dAnion) });
      const dTotal = get("dTotal");
      if (speciesValues.length === 0 && dTotal) {
        speciesValues.push({ species: "overall", value: dTotal, header: headerAt(sheet, columns.dTotal) });
      } else if (dTotal) {
        warnings.add("D_total was ignored where species-specific diffusion columns were present.");
      }
      if (speciesValues.length === 0) {
        invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: "Missing diffusion coefficient" });
        continue;
      }

      const systemName = get("systemName") || undefined;
      const sourceLabel = get("source");
      const paperTitle = get("paperTitle") || context.paperTitle?.trim() || stripExtension(context.filename);
      if (!get("paperTitle") && !context.paperTitle?.trim()) {
        warnings.add("Paper title was absent; the uploaded filename was used as the source title.");
      }
      const flexible = buildFlexibleFields(sheet, row.rowNumber, row.values, recognized, context, sourceLabel);

      for (const item of speciesValues) {
        const diffusion = diffusionQuantity(item.value, dUnit);
        const table = `${sheet.name}!row ${row.rowNumber}`;
        const provenance = provenanceEntries({
          filename: context.filename,
          table,
          sourceLabel,
          species: item.species,
          diffusionHeader: item.header || `D_${item.species}`,
          diffusionValue: item.value,
          diffusionUnit: dUnit,
          temperatureHeader: headerAt(sheet, columns.temperature) || "temperature",
          temperatureValue,
          temperatureUnit,
        });
        const extracted: DiffusionExtractedFields = {
          paper: {
            title: paperTitle,
            journal: get("journal") || undefined,
            year: finiteYear(get("year")),
            doi: get("doi") || undefined,
          },
          cation,
          anion,
          species: item.species,
          temperature: `${temperatureValue} ${temperatureUnit}`.trim(),
          diffusion,
          systemName,
          poreSize: quantity(get("poreSize"), get("poreSizeUnit")),
          method: get("method") || undefined,
          nucleus: get("nucleus") || undefined,
          surface: get("surface") || undefined,
          viscosity: quantity(get("viscosity"), get("viscosityUnit")),
          waterContent: get("waterContent") || undefined,
          concentration: get("concentration") || undefined,
          flexible,
          provenance,
          confidence: 1,
        };
        const draft = ingest(extracted);
        if (!draft.core.diffusion?.std || !Number.isFinite(draft.core.diffusion.std)) {
          invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: `Unrecognized diffusion unit: ${dUnit}` });
          continue;
        }
        drafts.push(draft);
        if (preview.length < 12) {
          preview.push({
            sheet: sheet.name,
            row: row.rowNumber,
            species: item.species,
            cation,
            anion,
            temperature: extracted.temperature!,
            diffusion,
            systemName,
          });
        }
      }
    }
  }

  return {
    adapter: DIFFUSION_DATASET_ADAPTER,
    inputRows,
    drafts,
    invalidRows,
    warnings: [...warnings],
    mappings: [...mappings.values()],
    preview,
  };
}

function resolveColumns(headers: string[]): Record<AliasKey, number | undefined> {
  return Object.fromEntries(
    Object.entries(ALIASES).map(([key, aliases]) => [key, headers.findIndex((header) => aliases.includes(header as never))])
  ) as Record<AliasKey, number | undefined>;
}

function recordMappings(
  headers: string[],
  columns: Record<AliasKey, number | undefined>,
  mappings: Map<string, DatasetColumnMapping>
) {
  const targets: Partial<Record<AliasKey, string>> = {
    paperTitle: "paper.title", journal: "paper.journal", year: "paper.year", doi: "paper.doi",
    systemName: "extended.systemName", cation: "core.ionicLiquid.cation", anion: "core.ionicLiquid.anion",
    ionicLiquid: "core.ionicLiquid.{cation,anion}", dCation: "core.diffusion (species=cation)",
    dAnion: "core.diffusion (species=anion)", dTotal: "core.diffusion (species=overall)",
    dUnit: "core.diffusion.unit", temperature: "core.temperature", temperatureUnit: "core.temperature.unit",
    poreSize: "extended.poreSize", poreSizeUnit: "extended.poreSize.unit", method: "extended.method",
    nucleus: "extended.nucleus", surface: "extended.surface", viscosity: "extended.viscosity",
    viscosityUnit: "extended.viscosity.unit", waterContent: "extended.waterContent",
    concentration: "extended.concentration", source: "provenance",
  };
  for (const [key, index] of Object.entries(columns) as [AliasKey, number | undefined][]) {
    if (index == null || index < 0) continue;
    const source = headers[index];
    mappings.set(source, {
      source,
      target: targets[key] || key,
      mode: key === "ionicLiquid" || key === "dCation" || key === "dAnion" ? "expanded" : key === "dTotal" ? "ignored" : "direct",
    });
  }
  for (const header of headers) {
    if (!mappings.has(header)) mappings.set(header, { source: header, target: "flexible[]", mode: "preserved" });
  }
}

function buildFlexibleFields(
  sheet: TabularSheet,
  rowNumber: number,
  values: TabularScalar[],
  recognized: Set<number>,
  context: { filename: string; fingerprint: string },
  sourceLabel: string
): FlexibleField[] {
  const fields: FlexibleField[] = [
    { key: "dataset_filename", value: context.filename, note: "dataset import lineage" },
    { key: "dataset_sheet", value: sheet.name, note: "dataset import lineage" },
    { key: "dataset_row", value: String(rowNumber), note: "dataset import lineage" },
    { key: "dataset_fingerprint", value: context.fingerprint, note: "idempotent import key" },
  ];
  if (sourceLabel) fields.push({ key: "dataset_source", value: sourceLabel });
  sheet.headers.forEach((header, index) => {
    if (recognized.has(index)) return;
    const value = displayValue(values[index]).trim();
    if (value) fields.push({ key: header, value, note: "unmapped source column preserved verbatim" });
  });
  return fields;
}

function provenanceEntries(input: {
  filename: string; table: string; sourceLabel: string; species: string;
  diffusionHeader: string; diffusionValue: string; diffusionUnit: string;
  temperatureHeader: string; temperatureValue: string; temperatureUnit: string;
}): DiffusionExtractedFields["provenance"] {
  const note = `Imported from ${input.filename}${input.sourceLabel ? `; source=${input.sourceLabel}` : ""}`;
  const direct = (field: string, quote: string): FieldProvenance & { field: string } => ({
    field, table: input.table, quote, basis: "direct", basisNote: note,
  });
  return [
    direct("species", `species=${input.species}`),
    direct("temperature", `${input.temperatureHeader}=${input.temperatureValue} ${input.temperatureUnit}`),
    direct("diffusion", `${input.diffusionHeader}=${input.diffusionValue} ${input.diffusionUnit}`),
  ];
}

function valueAt(values: TabularScalar[], index: number | undefined): string {
  return index == null || index < 0 ? "" : displayValue(values[index]).trim();
}

function headerAt(sheet: TabularSheet, index: number | undefined): string | undefined {
  return index == null || index < 0 ? undefined : sheet.headers[index];
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function parseIonPair(value: string): { cation: string; anion: string; inferred?: boolean } | null {
  const matches = value.match(/\[[^\]]+\]/g);
  if (matches && matches.length >= 2) return { cation: matches[0], anion: matches.slice(1).join("") };
  const parts = value.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2 && parts.every((part) => /^[A-Za-z0-9]+$/.test(part))) {
    return { cation: `[${parts[0]}]`, anion: `[${parts[1]}]`, inferred: true };
  }
  return null;
}

function diffusionQuantity(value: string, unit: string): string {
  const scale = unit.trim().match(/^10\^?([+-]?\d+)\s+(.+)$/i);
  return scale ? `${value}e${scale[1]} ${scale[2]}` : `${value} ${unit}`.trim();
}

function quantity(value: string, unit: string): string | undefined {
  return value ? `${value}${unit ? ` ${unit}` : ""}` : undefined;
}

function finiteYear(value: string): number | undefined {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}
