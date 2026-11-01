import type { CoreFields, ExtendedFields, ProvenanceMap } from "../schema";

/** Every structured tribology field students can extract in the live experiment. */
export const LIVE_EXTRACTION_FIELDS = [
  { key: "cation", label: "Cation", zh: "阳离子", group: "Core", placeholder: "如 [EMIM]+" },
  { key: "anion", label: "Anion", zh: "阴离子", group: "Core", placeholder: "如 [BF4]−" },
  { key: "substrate", label: "Substrate", zh: "基底", group: "Core", placeholder: "如 steel、Au(111)" },
  { key: "temperature", label: "Temperature", zh: "温度", group: "Core", placeholder: "数值+单位，如 25 °C" },
  { key: "load", label: "Load", zh: "载荷", group: "Core", placeholder: "数值+单位，如 10 mN" },
  { key: "cof", label: "COF", zh: "摩擦系数", group: "Core", placeholder: "数值，如 0.08" },
  { key: "scale", label: "Scale", zh: "尺度", group: "Measurement", placeholder: "nano / macro" },
  { key: "method", label: "Method", zh: "实验方法", group: "Measurement", placeholder: "AFM / Tribometer" },
  { key: "probe", label: "Probe", zh: "探针材料", group: "Measurement", placeholder: "如 silica、silicon nitride" },
  { key: "probeType", label: "Probe type", zh: "探针类型与尺寸", group: "Measurement", placeholder: "如 colloid probe, R = 5 μm" },
  { key: "cofMethod", label: "COF method", zh: "摩擦系数测量方法", group: "Measurement", placeholder: "如 Ff/FN slope" },
  { key: "velocity", label: "Velocity", zh: "滑动速度", group: "Measurement", placeholder: "数值+单位，如 10 μm/s" },
  { key: "potential", label: "Potential", zh: "电位", group: "Measurement", placeholder: "数值+单位，如 +0.5 V" },
  { key: "roughness", label: "Roughness", zh: "表面粗糙度", group: "Surface", placeholder: "数值+单位，如 2 nm" },
  { key: "surfaceEnergy", label: "Surface energy", zh: "表面能 γ_s", group: "Surface", placeholder: "数值+单位，如 55 mJ/m²" },
  { key: "surfaceChargeDensity", label: "Surface charge density", zh: "表面电荷密度 σ_s", group: "Surface", placeholder: "数值+单位，如 −0.02 C/m²" },
  { key: "contactAngle", label: "Contact angle", zh: "接触角 θ_s", group: "Surface", placeholder: "数值+单位，如 75°" },
  { key: "crystalPlane", label: "Crystal plane", zh: "晶面", group: "Surface", placeholder: "(111) / polycrystalline" },
  { key: "materialClass", label: "Material class", zh: "材料类别", group: "Surface", placeholder: "metal / carbon / ceramic" },
  { key: "additives", label: "Additives", zh: "添加剂", group: "Film & solution", placeholder: "名称及含量" },
  { key: "filmThickness", label: "Film thickness", zh: "膜厚", group: "Film & solution", placeholder: "数值+单位，如 2.5 nm" },
  { key: "filmLayers", label: "Film layers", zh: "膜层数", group: "Film & solution", placeholder: "数值，如 3" },
  { key: "waterContent", label: "Water content", zh: "水含量", group: "Film & solution", placeholder: "如 120 ppm / 0.5 wt%" },
  { key: "concentration", label: "Concentration", zh: "浓度", group: "Film & solution", placeholder: "如 0.1 mol/L / x_IL = 0.3" },
  { key: "scanRate", label: "AFM scan rate", zh: "AFM 扫描速率", group: "AFM", placeholder: "数值+单位，如 1 Hz" },
  { key: "scanSize", label: "AFM scan size", zh: "AFM 扫描范围", group: "AFM", placeholder: "数值+单位，如 5 μm" },
] as const;

export type LiveExtractionFieldKey = (typeof LIVE_EXTRACTION_FIELDS)[number]["key"];
export type LiveRow = Record<LiveExtractionFieldKey, string>;
export const LIVE_FIELD_GROUPS = ["Core", "Measurement", "Surface", "Film & solution", "AFM"] as const;
export const LIVE_FIELD_LABELS = Object.fromEntries(LIVE_EXTRACTION_FIELDS.map((field) => [field.key, field.label])) as Record<LiveExtractionFieldKey, string>;

export function blankLiveRow(): LiveRow {
  return Object.fromEntries(LIVE_EXTRACTION_FIELDS.map((field) => [field.key, ""])) as LiveRow;
}

/** Map an AI/database record onto the exact same complete template used manually. */
export function recordToLiveRow(record: { core: CoreFields; extended?: ExtendedFields; provenance?: ProvenanceMap }): LiveRow {
  const { core, extended: e } = record;
  const text = (value: unknown): string => typeof value === "string" && value.trim() ? value.trim()
    : typeof value === "number" && Number.isFinite(value) ? String(value) : "/";
  const quantity = (value: { raw?: string; value?: number | null; unit?: string } | null | undefined): string =>
    text(value?.raw || (value?.value != null ? `${value.value} ${value.unit ?? ""}`.trim() : ""));
  const row: LiveRow = {
    cation: text(core.ionicLiquid?.cation), anion: text(core.ionicLiquid?.anion), substrate: text(core.substrate),
    temperature: quantity(core.temperature), load: quantity(core.load), cof: text(core.cof),
    scale: text(e?.scale), method: text(e?.method), probe: text(e?.probe), probeType: text(e?.probeType), cofMethod: text(e?.cofMethod),
    velocity: quantity(e?.velocity), potential: quantity(e?.potential), roughness: quantity(e?.roughness ?? e?.surface?.roughness),
    surfaceEnergy: quantity(e?.surface?.surfaceEnergy), surfaceChargeDensity: quantity(e?.surface?.surfaceChargeDensity), contactAngle: quantity(e?.surface?.contactAngle),
    crystalPlane: text(e?.surface?.plane), materialClass: text(e?.surface?.materialClass), additives: text(e?.additives),
    filmThickness: quantity(e?.filmThickness), filmLayers: text(e?.filmLayers), waterContent: text(e?.waterContent), concentration: text(e?.concentration),
    scanRate: text(e?.afm?.scanRate), scanSize: text(e?.afm?.scanSize),
  };
  for (const { key } of LIVE_EXTRACTION_FIELDS) if (record.provenance?.[key]?.basis === "assumed") row[key] = "/";
  if (record.provenance?.probe?.basis === "assumed") row.probeType = "/";
  return row;
}
