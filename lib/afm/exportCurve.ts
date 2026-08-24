import type { AfmCurveRecord } from "./afmCurves";
import type { CuratedField } from "./interfacialExperiment";

export type AfmExportFormat = "csv" | "json" | "png";

export function afmCurveFileStem(curve: AfmCurveRecord) {
  const identity = curve.context.ionicLiquid.name.value || curve.ionicLiquid || curve.id;
  return `ioniclink-afm-${identity}-${curve.id}`
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function buildAfmCurveCsv(curve: AfmCurveRecord) {
  const metadata = exportMetadata(curve);
  const rows = [
    ["# IonicLink AFM force-curve export"],
    ["# curve_id", curve.id],
    ...metadata.map(([key, value]) => [`# ${key}`, value]),
    [],
    [`separation_${curve.xUnit || "unknown"}`, `force_${curve.yUnit || "unknown"}`],
    ...curve.points.map(([x, y]) => [x, y]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildAfmCurveJson(curve: AfmCurveRecord) {
  return JSON.stringify(
    {
      schema: "ioniclink.afm-force-curve",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      curve: {
        id: curve.id,
        label: curve.label,
        status: curve.status,
        collection: curve.collection,
        pointCount: curve.pointCount,
        axes: {
          x: { quantity: "separation", unit: curve.xUnit },
          y: { quantity: "force", unit: curve.yUnit },
        },
      },
      conditions: {
        ionicLiquid: {
          name: curve.context.ionicLiquid.name,
          cation: curve.context.ionicLiquid.cation,
          anion: curve.context.ionicLiquid.anion,
          cationSmiles: curve.context.ionicLiquid.cationSmiles,
          anionSmiles: curve.context.ionicLiquid.anionSmiles,
        },
        probe: {
          material: curve.context.interface.probeMaterial,
          springConstant: curve.acquisition.springConstant,
        },
        substrate: {
          material: curve.context.interface.substrate,
          surfaceState: curve.context.interface.surfaceState,
        },
        contactInterface: {
          technique: curve.acquisition.technique,
          curveBranch: curve.acquisition.curveBranch,
          scanRate: curve.acquisition.scanRate,
          scanSize: curve.acquisition.scanSize,
          electrodePotential: curve.context.electrochemistry.electrodePotential,
          potentialReference: curve.context.electrochemistry.potentialReference,
          capacitance: curve.context.electrochemistry.capacitance,
          electricField: curve.context.electrochemistry.electricField,
        },
        externalFactors: curve.context.thermodynamics,
        acquisition: {
          instrument: curve.acquisition.instrument,
          separationUnit: curve.acquisition.separationUnit,
          forceUnit: curve.acquisition.forceUnit,
        },
      },
      layering: curve.layering,
      digitization: curve.digitization,
      review: curve.review,
      source: curve.source,
      notes: curve.notes,
      points: curve.points.map(([separation, force]) => ({ separation, force })),
    },
    null,
    2,
  );
}

function exportMetadata(curve: AfmCurveRecord): Array<[string, string | number]> {
  const rows: Array<[string, string | number]> = [];
  addField(rows, "ionic_liquid", curve.context.ionicLiquid.name);
  addField(rows, "cation", curve.context.ionicLiquid.cation);
  addField(rows, "anion", curve.context.ionicLiquid.anion);
  addField(rows, "probe_material", curve.context.interface.probeMaterial);
  addField(rows, "probe_spring_constant", curve.acquisition.springConstant);
  addField(rows, "substrate", curve.context.interface.substrate);
  addField(rows, "surface_state", curve.context.interface.surfaceState);
  addField(rows, "technique", curve.acquisition.technique);
  addField(rows, "curve_branch", curve.acquisition.curveBranch);
  addField(rows, "scan_rate", curve.acquisition.scanRate);
  addField(rows, "scan_size", curve.acquisition.scanSize);
  addField(rows, "temperature", curve.context.thermodynamics.temperature);
  addField(rows, "pressure", curve.context.thermodynamics.pressure);
  addField(rows, "atmosphere", curve.context.thermodynamics.atmosphere);
  addField(rows, "water_content", curve.context.thermodynamics.waterContent);
  addField(rows, "electrode_potential", curve.context.electrochemistry.electrodePotential);
  addField(rows, "potential_reference", curve.context.electrochemistry.potentialReference);
  addField(rows, "capacitance", curve.context.electrochemistry.capacitance);
  addField(rows, "electric_field", curve.context.electrochemistry.electricField);
  rows.push(["digitization", "Digitized from figure"]);
  rows.push(["digitization_quality", curve.digitization.quality]);
  rows.push(["metadata_verified_percent", curve.review.verifiedPercent]);
  if (curve.source.pdfFile) rows.push(["source_paper", curve.source.pdfFile]);
  if (curve.source.doi) rows.push(["doi", curve.source.doi]);
  if (curve.source.imageFile) rows.push(["source_figure", curve.source.imageFile]);
  return rows;
}

function addField(rows: Array<[string, string | number]>, key: string, field: CuratedField<unknown>) {
  if (field.value === null || field.value === "" || field.status === "not-reported") return;
  const raw = Array.isArray(field.value) ? field.value.join("; ") : String(field.value);
  const value = field.unit ? `${raw} ${field.unit}` : raw;
  rows.push([key, value]);
  rows.push([`${key}_status`, field.status]);
  if (field.confidence !== null) rows.push([`${key}_confidence`, field.confidence]);
}

function csvCell(value: string | number | undefined) {
  const text = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
