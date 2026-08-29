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
  paperTitle: ["paper_title", "title", "article_title", "citation", "标题", "论文标题", "题名"],
  journal: ["journal", "期刊", "杂志"],
  year: ["year", "publication_year", "年份", "发表年份", "出版年份"],
  doi: ["doi"],
  systemName: ["system_name", "confinement_system", "system", "体系", "体系名称", "限域体系", "系统名称"],
  material: ["material", "confinement_material", "confinement_material_class", "material_class", "host_material", "材料", "限域材料", "宿主材料", "基体材料"],
  geometry: ["geometry", "confinement_geometry", "confinement_geometry_class", "geometry_class", "pore_shape", "channel_shape", "structure", "几何", "几何结构", "孔道结构", "结构"],
  functionalGroups: ["functional_groups", "functional_group", "surface_functional_groups", "functionalization", "官能团", "表面官能团", "功能基团"],
  polarizable: ["polarizable", "polarizability", "polarizable_walls", "wall_polarizability", "可极化", "极化", "壁极化"],
  cation: ["cation", "阳离子", "正离子"],
  anion: ["anion", "阴离子", "负离子"],
  ionicLiquid: ["ionic_liquid", "ionic_liquid_name", "il", "离子液体", "离子液体名称"],
  dCation: ["d_cation", "diffusion_cation", "cation_diffusion", "阳离子扩散系数", "阳离子扩散", "阳离子自扩散系数"],
  dAnion: ["d_anion", "diffusion_anion", "anion_diffusion", "阴离子扩散系数", "阴离子扩散", "阴离子自扩散系数"],
  dTotal: ["d_total", "diffusion_total", "diffusion", "d", "扩散系数", "总扩散系数", "自扩散系数"],
  dUnit: ["d_unit", "diffusion_unit", "扩散单位", "扩散系数单位"],
  temperature: ["temperature_value", "temperature", "temp", "t", "温度", "实验温度", "测试温度"],
  temperatureUnit: ["temperature_unit", "temp_unit", "t_unit", "温度单位"],
  poreSize: ["confinement_scale_value", "pore_size", "pore_size_value", "confinement_scale", "孔径", "孔尺寸", "限域尺寸", "孔道尺寸"],
  poreSizeUnit: ["confinement_scale_unit", "pore_size_unit", "孔径单位", "限域尺寸单位"],
  method: ["method", "measurement_method", "方法", "测试方法", "测量方法", "实验方法"],
  nucleus: ["nucleus", "nmr_nucleus", "核", "核磁核", "探测核"],
  surface: ["surface", "electrode_surface", "表面", "电极表面"],
  viscosity: ["viscosity", "viscosity_value", "黏度", "粘度", "黏度值", "粘度值"],
  viscosityUnit: ["viscosity_unit", "黏度单位", "粘度单位"],
  waterContent: ["water_content", "含水量", "水含量", "水分含量"],
  concentration: ["concentration", "浓度"],
  source: ["source", "source_table", "table", "来源", "数据来源", "表格来源"],
} as const;

type AliasKey = keyof typeof ALIASES;

/**
 * Unit-ish tokens that may trail a column header after normalization
 * (e.g. "temperature_k", "d_cation_10_9_m2s"). Only these may be stripped
 * during fuzzy matching, so "anion_transport_number" never collapses to "anion".
 */
const STRIPPABLE_SUFFIX = new Set([
  "value", "values", "unit", "units",
  "k", "c", "f",
  "m2s", "m2", "cm2s", "cm2", "s", "ms",
  "m", "cm", "mm", "um", "nm",
  "pa", "pas", "cp", "mpas",
  "ppm", "wt", "mol", "l",
  "n", "mn", "kn",
  "v", "hz", "khz", "mhz",
]);

function fuzzyMatchHeader(normalized: string, alias: string): boolean {
  let candidate = normalized;
  while (candidate.length > alias.length) {
    const cut = candidate.lastIndexOf("_");
    if (cut < 0) return false;
    const suffix = candidate.slice(cut + 1);
    if (!/^\d+$/.test(suffix) && !STRIPPABLE_SUFFIX.has(suffix)) return false;
    candidate = candidate.slice(0, cut);
    if (candidate === alias) return true;
  }
  return false;
}

/**
 * Ionic-liquid intrinsic properties (SMILES, InChI, CAS, ion-pair counts,
 * molar mass, and structure-derived descriptors like LogP/TPSA/H-bond counts)
 * are derivable from the ion names themselves, while MSD curves and their
 * log-log slopes are the intermediate quantities diffusion coefficients are
 * computed from — keeping them would leak the target. All of these columns
 * are neither mapped nor preserved; they are reported as "ignored".
 */
const IGNORED_COLUMN_PATTERN =
  /smiles|inchi|^pairs$|ion_pairs?|n_pairs|num_pairs|pairs_count|^cas(_|$)|cas_number|molar_mass|mol(ecular)?_?weight|^mw$|^log_?p$|hydrophobicity|^tpsa$|polar_surface_area|h_?(bond_?)?(donors?|acceptors?)|num_h_|^msd(_|$)|^log$|^log_?slope/;

function isIgnoredColumn(normalized: string): boolean {
  return IGNORED_COLUMN_PATTERN.test(normalized);
}

/**
 * Pair unmapped "X_unit"/"X_units" columns with their unmapped "X_value" (or
 * "X") column, so the unit rides on the flexible field instead of appearing
 * as a separate, constant column.
 */
function pairFlexibleUnitColumns(
  sheet: TabularSheet,
  recognized: Set<number>,
  ignored: Set<number>
): { unitForValue: Map<number, number>; valueForUnit: Map<number, number> } {
  const byName = new Map<string, number>();
  sheet.headers.map(normalizeHeader).forEach((name, index) => {
    if (!recognized.has(index) && !ignored.has(index) && !byName.has(name)) byName.set(name, index);
  });
  const unitForValue = new Map<number, number>();
  const valueForUnit = new Map<number, number>();
  for (const [name, unitIndex] of byName) {
    const base = name.replace(/_units?$/, "");
    if (base === name) continue;
    const valueIndex = byName.get(`${base}_value`) ?? byName.get(base);
    if (valueIndex == null || valueIndex === unitIndex) continue;
    unitForValue.set(valueIndex, unitIndex);
    valueForUnit.set(unitIndex, valueIndex);
  }
  return { unitForValue, valueForUnit };
}

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
    const headerUnits = sheet.headers.map(extractHeaderUnit);
    const columns = resolveColumns(normalizedHeaders);
    const ignored = new Set(
      normalizedHeaders
        .map((header, index) => (isIgnoredColumn(header) ? index : -1))
        .filter((index) => index >= 0)
    );
    const recognized = new Set(Object.values(columns).filter((value): value is number => value != null));
    const flexibleUnits = pairFlexibleUnitColumns(sheet, recognized, ignored);
    recordMappings(sheet.headers, columns, ignored, flexibleUnits, mappings);
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
      // A unit annotation attached to the column header ("Temperature (K)") is
      // column-specific and wins over the shared unit column.
      const headerTemperatureUnit = unitAt(headerUnits, columns.temperature);
      const temperatureUnit = headerTemperatureUnit || get("temperatureUnit") || "K";
      if (!headerTemperatureUnit && !get("temperatureUnit")) {
        warnings.add("Temperature unit was absent; values were interpreted as K.");
      }

      const sharedDUnit = get("dUnit");
      const speciesValues: { species: "cation" | "anion" | "overall"; value: string; unit: string; header?: string }[] = [];
      const dCation = get("dCation");
      const dAnion = get("dAnion");
      if (dCation) speciesValues.push({ species: "cation", value: dCation, unit: unitAt(headerUnits, columns.dCation) || sharedDUnit, header: headerAt(sheet, columns.dCation) });
      if (dAnion) speciesValues.push({ species: "anion", value: dAnion, unit: unitAt(headerUnits, columns.dAnion) || sharedDUnit, header: headerAt(sheet, columns.dAnion) });
      const dTotal = get("dTotal");
      if (speciesValues.length === 0 && dTotal) {
        speciesValues.push({ species: "overall", value: dTotal, unit: unitAt(headerUnits, columns.dTotal) || sharedDUnit, header: headerAt(sheet, columns.dTotal) });
      } else if (dTotal) {
        warnings.add("D_total was ignored where species-specific diffusion columns were present.");
      }
      if (speciesValues.length === 0) {
        invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: "Missing diffusion coefficient" });
        continue;
      }
      if (speciesValues.some((item) => !item.unit)) {
        warnings.add("Diffusion unit was absent; values were interpreted as m2/s.");
      }

      const systemName = get("systemName") || undefined;
      const sourceLabel = get("source");
      const paperTitle = get("paperTitle") || context.paperTitle?.trim() || stripExtension(context.filename);
      if (!get("paperTitle") && !context.paperTitle?.trim()) {
        warnings.add("Paper title was absent; the uploaded filename was used as the source title.");
      }
      const flexible = buildFlexibleFields(sheet, row.rowNumber, row.values, recognized, ignored, flexibleUnits, context, sourceLabel);

      for (const item of speciesValues) {
        const itemUnit = item.unit || "m2/s";
        const diffusion = diffusionQuantity(item.value, itemUnit);
        const table = `${sheet.name}!row ${row.rowNumber}`;
        const provenance = provenanceEntries({
          filename: context.filename,
          table,
          sourceLabel,
          species: item.species,
          diffusionHeader: item.header || `D_${item.species}`,
          diffusionValue: item.value,
          diffusionUnit: itemUnit,
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
          material: get("material") || undefined,
          geometry: get("geometry") || undefined,
          functionalGroups: get("functionalGroups") || undefined,
          polarizable: get("polarizable") || undefined,
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
          invalidRows.push({ sheet: sheet.name, row: row.rowNumber, reason: `Unrecognized diffusion unit: ${itemUnit}` });
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
  const entries = Object.entries(ALIASES) as [AliasKey, readonly string[]][];
  const result = {} as Record<AliasKey, number | undefined>;
  const claimed = new Set<number>();
  // Pass 1: exact alias matches win, so "temperature_unit" is never stolen by "temperature".
  for (const [key, aliases] of entries) {
    const index = headers.findIndex((header, i) => !claimed.has(i) && aliases.includes(header));
    if (index >= 0) {
      result[key] = index;
      claimed.add(index);
    }
  }
  // Pass 2: tolerate trailing unit segments ("temperature_k", "d_cation_10_9_m2s").
  for (const [key, aliases] of entries) {
    if (result[key] != null) continue;
    const index = headers.findIndex(
      (header, i) => !claimed.has(i) && aliases.some((alias) => fuzzyMatchHeader(header, alias))
    );
    if (index >= 0) {
      result[key] = index;
      claimed.add(index);
    }
  }
  return result;
}

function recordMappings(
  headers: string[],
  columns: Record<AliasKey, number | undefined>,
  ignored: Set<number>,
  flexibleUnits: { valueForUnit: Map<number, number> },
  mappings: Map<string, DatasetColumnMapping>
) {
  const targets: Partial<Record<AliasKey, string>> = {
    paperTitle: "paper.title", journal: "paper.journal", year: "paper.year", doi: "paper.doi",
    systemName: "extended.systemName", material: "extended.material", geometry: "extended.geometry", functionalGroups: "extended.functionalGroups", polarizable: "extended.polarizable", cation: "core.ionicLiquid.cation", anion: "core.ionicLiquid.anion",
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
  headers.forEach((header, index) => {
    if (mappings.has(header)) return;
    if (ignored.has(index)) {
      mappings.set(header, { source: header, target: "— (derivable from ion names)", mode: "ignored" });
    } else if (flexibleUnits.valueForUnit.has(index)) {
      const valueHeader = headers[flexibleUnits.valueForUnit.get(index)!];
      mappings.set(header, { source: header, target: `flexible[${valueHeader}].unit`, mode: "preserved" });
    } else {
      mappings.set(header, { source: header, target: "flexible[]", mode: "preserved" });
    }
  });
}

function buildFlexibleFields(
  sheet: TabularSheet,
  rowNumber: number,
  values: TabularScalar[],
  recognized: Set<number>,
  ignored: Set<number>,
  flexibleUnits: { unitForValue: Map<number, number>; valueForUnit: Map<number, number> },
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
    if (recognized.has(index) || ignored.has(index) || flexibleUnits.valueForUnit.has(index)) return;
    const value = displayValue(values[index]).trim();
    if (!value) return;
    const unitIndex = flexibleUnits.unitForValue.get(index);
    const unit = unitIndex == null ? undefined : displayValue(values[unitIndex]).trim() || undefined;
    fields.push({ key: header, value, unit, note: "unmapped source column preserved verbatim" });
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

/** Unit annotation attached to a header, e.g. "D_cation (10^-11 m2/s)" → "10^-11 m2/s". */
function extractHeaderUnit(value: string): string {
  const match = value.match(/\(([^)]*)\)|（([^）]*)）|\[([^\]]*)]/);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function unitAt(units: string[], index: number | undefined): string {
  return index == null || index < 0 ? "" : units[index];
}

function headerAt(sheet: TabularSheet, index: number | undefined): string | undefined {
  return index == null || index < 0 ? undefined : sheet.headers[index];
}

function normalizeHeader(value: string): string {
  return value
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*]/g, " ") // drop "(°C)", "[m2/s]" annotations
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/[^\p{Script=Han}a-z0-9_]/gu, "")
    .replace(/^_+|_+$/g, "");
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
