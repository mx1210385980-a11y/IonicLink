import fs from "node:fs";
import path from "node:path";

const sourceCsv = process.argv[2];
if (!sourceCsv) {
  throw new Error("Usage: node scripts/build-legacy-afm-source-audit.mjs <legacy-source.csv>");
}

const repositoryRoot = process.cwd();
const curveSnapshotPath = path.join(repositoryRoot, "data", "afm", "afm-curves.json");
const outputPath = path.join(repositoryRoot, "data", "afm", "legacy-afm-source-audit.json");
const snapshot = JSON.parse(fs.readFileSync(curveSnapshotPath, "utf8"));
const rows = parseCsv(fs.readFileSync(sourceCsv, "utf8").replace(/^\uFEFF/, ""));
const header = rows[0];
const indexes = Object.fromEntries(header.map((name, index) => [name.trim(), index]));
const required = ["ILS", "potential/V", "T/K", "afm_y", "afm_x", "Cation_SMILES", "Anion_SMILES"];
for (const field of required) if (indexes[field] == null) throw new Error(`Missing CSV column: ${field}`);

const sourceGroups = new Map();
for (let index = 1; index < rows.length; index += 1) {
  const row = rows[index];
  const ionicLiquid = row[indexes.ILS]?.trim();
  if (!ionicLiquid) continue;
  const potentialV = Number(row[indexes["potential/V"]]);
  const temperatureK = Number(row[indexes["T/K"]]);
  const xValues = numberSeries(row[indexes.afm_x]);
  const yValues = numberSeries(row[indexes.afm_y]);
  const key = conditionKey(ionicLiquid, potentialV, temperatureK);
  const item = {
    csvRow: index + 1,
    ionicLiquid,
    potentialV,
    temperatureK,
    pointCountX: xValues.length,
    pointCountY: yValues.length,
    cationSmiles: row[indexes.Cation_SMILES]?.trim() || null,
    anionSmiles: row[indexes.Anion_SMILES]?.trim() || null,
  };
  const group = sourceGroups.get(key) ?? [];
  group.push(item);
  sourceGroups.set(key, group);
}

const legacyCurves = snapshot.curves.filter((curve) => curve.collection === "legacy-cleaned");
const records = legacyCurves.map((curve) => {
  const key = conditionKey(curve.ionicLiquid, curve.potentialV, curve.temperatureK);
  const matches = sourceGroups.get(key) ?? [];
  if (!matches.length) throw new Error(`No raw CSV rows match ${curve.id}: ${key}`);
  const cationCandidates = unique(matches.map((item) => item.cationSmiles).filter(Boolean));
  const anionCandidates = unique(matches.map((item) => item.anionSmiles).filter(Boolean));
  return {
    curveId: curve.id,
    conditionKey: key,
    ionicLiquid: curve.ionicLiquid,
    potentialV: curve.potentialV,
    temperatureK: curve.temperatureK,
    sourceCsv: {
      file: path.basename(sourceCsv),
      path: "external://legacy-afm-platform/修改3.csv",
      rows: matches.map((item) => item.csvRow),
      replicateCount: matches.length,
    },
    rawCurves: {
      pointCounts: matches.map((item) => item.pointCountX),
      allCoordinateLengthsMatch: matches.every((item) => item.pointCountX === item.pointCountY),
    },
    legacySmiles: {
      cationCandidates,
      anionCandidates,
      status: "legacy-unverified",
      warning:
        cationCandidates.length > 1 || anionCandidates.length > 1
          ? "Conflicting SMILES occur within this condition group; chemical identity review is required."
          : "Copied for audit only; chemical identity must be validated before descriptors or modeling.",
    },
  };
});

const currentKeys = new Set(records.map((record) => record.conditionKey));
const unmatchedSourceKeys = [...sourceGroups.keys()].filter((key) => !currentKeys.has(key));
if (unmatchedSourceKeys.length) throw new Error(`Raw CSV conditions missing from current curves: ${unmatchedSourceKeys.join(", ")}`);

const result = {
  schemaVersion: 1,
  generatedFrom: path.basename(sourceCsv),
  scope: "Row-level provenance linking the old prediction-platform source CSV to the 61 retained representative AFM curves.",
  policy: {
    trustedFields: ["ionicLiquid", "potentialV", "temperatureK", "raw coordinate row mapping", "replicate count"],
    unavailableFields: ["substrate", "probe", "atmosphere", "pressure", "water content", "scan rate", "instrument", "paper DOI", "figure locator"],
    smiles: "Legacy/unverified only; do not use for RDKit descriptors or modeling until chemically validated.",
  },
  summary: {
    rawRows: rows.length - 1,
    conditionGroups: sourceGroups.size,
    linkedRepresentativeCurves: records.length,
    distinctIonicLiquids: new Set(records.map((record) => record.ionicLiquid)).size,
    coordinateLengthMismatches: records.filter((record) => !record.rawCurves.allCoordinateLengthsMatch).length,
  },
  records,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${path.relative(repositoryRoot, outputPath)}: ${result.summary.rawRows} rows -> ${records.length} condition groups.`);

function conditionKey(ionicLiquid, potentialV, temperatureK) {
  return `${String(ionicLiquid).trim()}|${numericKey(potentialV)}|${numericKey(temperatureK)}`;
}

function numericKey(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid numeric condition value: ${value}`);
  return Object.is(number, -0) ? "0" : String(number);
}

function numberSeries(value) {
  if (!value?.trim()) return [];
  return value.split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
}

function unique(values) {
  return [...new Set(values)];
}

function parseCsv(text) {
  const parsed = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length)) parsed.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.length)) parsed.push(row);
  }
  return parsed;
}
