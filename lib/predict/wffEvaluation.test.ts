import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildWffEvaluation,
  buildWffEvaluationFromRows,
  computeWffMetrics,
  parseWffCsv,
  splitWffRows,
  wffPointsToCsv,
  type WffParsedRow,
} from "./wffEvaluation";

const csv = `﻿source_literature_key,source_literature_title,wff_dataset,Cation,anion,compound,surface,h,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,friction_diff,error_flag
paper_a,Paper A,no_film,[A]+,[X]-,zero,mica,1.2,298,0.10,0,alpha,0_alpha,1,0.12,0.02,
paper_a,Paper A,no_film,[B]+,[X]-,zero,mica,1.3,298,0.20,0,alpha,0_alpha,2,0.18,-0.02,
paper_a,Paper A,no_film,[C]+,[X]-,zero,mica,1.4,298,0.30,0,alpha,0_alpha,3,0.33,0.03,
paper_a,Paper A,no_film,[D]+,[X]-,zero,mica,1.5,298,0.40,0,alpha,0_alpha,4,0.37,-0.03,
paper_a,Paper A,no_film,[E]+,[X]-,zero,mica,1.6,298,0.50,0,alpha,0_alpha,5,0.52,0.02,
paper_a,Paper A,no_film,[F]+,[X]-,zero,mica,1.7,298,0.60,0,alpha,0_alpha,6,0.57,-0.03,
paper_b,Paper B,no_film,[G]+,[Y]-,zero,Au(111),2.1,339,0.70,1,beta,1_beta,7,0.73,0.03,
paper_b,Paper B,no_film,[H]+,[Y]-,zero,Au(111),2.2,339,0.80,1,beta,1_beta,8,0.76,-0.04,
paper_b,Paper B,no_film,[I]+,[Y]-,zero,Au(111),2.3,339,0.90,1,beta,1_beta,9,0.95,0.05,
paper_b,Paper B,no_film,[J]+,[Y]-,zero,Au(111),2.4,339,1.00,1,beta,1_beta,10,0.96,-0.04,
paper_c,Paper C,no_film,[K]+,[Z]-,zero,steel,3.1,369,1.10,2,gamma,2_gamma,11,1.15,0.05,
paper_c,Paper C,no_film,[L]+,[Z]-,zero,steel,3.2,369,1.20,2,gamma,2_gamma,12,1.13,-0.07,
paper_d,Paper D,no_film,[S]+,[Q]-,zero,silica,,298,1.30,3,single,3_single,13,-0.10,-1.40,high error
`;

const cationCommaCsv = `Cation,anion,compound,surface,h,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,friction_diff,error_flag
[N8,8,8,12]+,[A4BMB]-,zero,mica,2.5,298,0.0032,0,480,0_480,99,0.0038,0.0006,
`;

const combinedCationCommaCsv = `source_literature_key,wff_dataset,wff_row_number,Cation,anion,compound,surface,h,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,friction_diff,error_flag
paper_x,film,1,[P4,4,4,1 ]+,[TFSI]-,zero,stainless steel,3.1,298,0.93,6,217,6_217,,0.91,-0.02,
paper_y,no_film,2,[A]+,[B]-,zero,mica,,298,0.10,0,alpha,0_alpha,,0.11,0.01,
`;

const missingSnapshotCsv = `source_literature_key,wff_dataset,Cation,anion,compound,surface,h,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,friction_diff,error_flag
paper_z,film,[A]+,[B]-,zero,mica,1.2,298,0.42,2,alpha,2_alpha,,,
`;

// --- parsing -------------------------------------------------------------
{
  const rows = parseWffCsv(csv);
  assert.equal(rows.length, 13);
  assert.equal(rows[0].cation, "[A]+");
  assert.equal(rows[0].measured, 0.1);
  assert.equal(rows[0].predicted, 0.12);
  assert.equal(rows[0].temperature, 298);
  assert.equal(rows[0].jointLabel, "0_alpha");
  assert.equal(rows[0].sourceLiteratureKey, "paper_a");
  assert.equal(rows[0].flaggedHighError, false);
  assert.equal(rows[12].physicallyInvalidPrediction, true, "negative prediction is physically invalid");
  assert.equal(rows[12].flaggedHighError, true, "a non-empty error_flag marks the row flagged");
}

{
  const rows = parseWffCsv(cationCommaCsv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cation, "[N8,8,8,12]+", "unquoted comma-rich cation labels are merged back into Cation");
  assert.equal(rows[0].anion, "[A4BMB]-");
  assert.equal(rows[0].measured, 0.0032);
  assert.equal(rows[0].predicted, 0.0038);
}

{
  const rows = parseWffCsv(combinedCationCommaCsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceLiteratureKey, "paper_x");
  assert.equal(rows[0].wffDataset, "film");
  assert.equal(rows[0].cation, "[P4,4,4,1 ]+", "comma-rich Cation is repaired at its actual header position");
  assert.equal(rows[0].anion, "[TFSI]-");
  assert.equal(rows[0].surface, "stainless steel");
  assert.equal(rows[0].measured, 0.93);
}

{
  const rows = parseWffCsv(missingSnapshotCsv);
  assert.equal(rows.length, 1, "rows with measured μ are kept even when friction_pred is absent");
  assert.equal(rows[0].snapshotPredicted, null);
  const trained = buildWffEvaluationFromRows(rows, { datasetId: "dataset-b", label: "B", modelType: "gradient_boosting" });
  assert.equal(trained.evaluatedRowCount, 1);
  const snap = buildWffEvaluationFromRows(rows, { datasetId: "dataset-b", label: "B", modelType: "snapshot" });
  assert.equal(snap.evaluatedRowCount, 0, "snapshot mode cannot score rows with no snapshot prediction");
}

// --- joint-label stratified split: singletons -> external literature -----
{
  const rows = parseWffCsv(csv);
  const split = splitWffRows(rows, { testSize: 0.2, randomSeed: 42 });
  // 0_alpha(6) 1_beta(4) 2_gamma(2) -> train/test; 3_single(1) -> external literature.
  assert.equal(split.externalLiterature.length, 1, "the singleton stratum becomes the external literature set");
  assert.equal(split.externalLiterature[0].jointLabel, "3_single");
  assert.equal(split.train.length, 9, "5+3+1 train rows");
  assert.equal(split.test.length, 3, "1+1+1 test rows (>=1 per multi-sample stratum)");
  assert.equal(split.externalExperiment.length, 0);
  assert.ok(!split.train.some((r) => r.jointLabel === "3_single"), "singletons never enter training");
  assert.deepEqual(
    splitWffRows(rows, { testSize: 0.2, randomSeed: 42 }).test.map((r) => r.id),
    split.test.map((r) => r.id),
    "split is deterministic for a fixed seed"
  );
}

// --- stratify mode changes which strata are singletons -------------------
{
  // Two rows share a friction bin but differ in cation bin.
  const mixed = `Cation,anion,surface,T,μ,friction_bin,cation_bin,stratify_label,original_index,friction_pred,error_flag
[A]+,[X]-,mica,298,0.10,0,alpha,0_alpha,1,0.12,
[B]+,[X]-,mica,298,0.20,0,beta,0_beta,2,0.18,
`;
  const rows = parseWffCsv(mixed);
  const joint = splitWffRows(rows, { stratifyMode: "joint" });
  assert.equal(joint.externalLiterature.length, 2, "under joint labels both rows are singletons");
  assert.equal(joint.train.length + joint.test.length, 0);
  const friction = splitWffRows(rows, { stratifyMode: "friction" });
  assert.equal(friction.externalLiterature.length, 0, "under friction-bin labels the two rows share a stratum");
  assert.equal(friction.train.length + friction.test.length, 2);
}

// --- metrics -------------------------------------------------------------
{
  const rows: WffParsedRow[] = [
    { ...parseWffCsv(csv)[0], measured: 1, predicted: 1.1 },
    { ...parseWffCsv(csv)[1], measured: 2, predicted: 1.9 },
    { ...parseWffCsv(csv)[2], measured: 3, predicted: 3.2 },
  ];
  const m = computeWffMetrics(rows);
  assert.equal(m.n, 3);
  assert.ok(Math.abs(m.mae! - 0.13333333333333344) < 1e-12);
  assert.ok(Math.abs(m.mse! - 0.020000000000000035) < 1e-12);
  assert.ok(Math.abs(m.rmse! - Math.sqrt(0.020000000000000035)) < 1e-12);
  assert.ok(m.r2 != null && m.r2 > 0.96 && m.r2 < 0.98);
  assert.equal(computeWffMetrics([]).n, 0);
  assert.equal(computeWffMetrics([]).r2, null);
}

// --- full build ----------------------------------------------------------
{
  const result = buildWffEvaluation({ datasetId: "dataset-b", label: "Dataset-B", csvText: csv, testSize: 0.2, randomSeed: 42 });
  assert.equal(result.sourceRowCount, 13);
  assert.equal(result.evaluatedRowCount, 13);
  assert.equal(result.droppedFlaggedCount, 0);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.singletonStrataCount, 1);
  assert.equal(result.splits.externalLiterature.points.length, 1);
  assert.equal(result.splits.externalLiterature.metrics.n, 1);
  assert.ok(Math.abs((result.splits.externalLiterature.metrics.mae ?? 0) - 1.4) < 1e-12);
  assert.match(result.splits.externalLiterature.metrics.r2Note ?? "", /Small validation set/);
  assert.equal(result.splits.externalLiterature.points[0].source, "external-literature");
  assert.equal(result.splits.externalExperiment.points.length, 0);
  assert.match(result.splits.externalExperiment.note ?? "", /No external-experiment/);
  assert.equal(result.settings.splitStrategy, "joint_label_stratified");
  assert.equal(result.settings.stratifyMode, "joint");
  assert.equal(result.settings.singletonPolicy, "routed_to_external_literature");
  assert.ok(result.fitLines.train);
  assert.ok(result.chartBounds.xMin < result.chartBounds.xMax);
  // point-wise ordering: external literature points carry a 1-based sampleIndex
  assert.equal(result.splits.externalLiterature.points[0].sampleIndex, 1);

  const exported = wffPointsToCsv(result.splits.externalLiterature.points);
  assert.match(exported, /cation,anion,surface,temperatureK,measured,predicted,snapshotPredicted,absoluteError,squaredError,split,source,dataset/);
  assert.match(exported, /external-literature/);
}

// --- excludeFlagged drops the flagged row from everything ----------------
{
  const rows = parseWffCsv(csv);
  const result = buildWffEvaluationFromRows(rows, { datasetId: "dataset-a", label: "A", excludeFlagged: true });
  assert.equal(result.evaluatedRowCount, 12);
  assert.equal(result.droppedFlaggedCount, 1);
  assert.equal(result.invalidCount, 0, "the only invalid prediction was the flagged row");
  assert.equal(result.splits.externalLiterature.points.length, 0, "the flagged singleton no longer reaches external literature");
}

// --- wffDataset filter ---------------------------------------------------
{
  const filmOnly = buildWffEvaluation({ datasetId: "dataset-b", label: "film", csvText: csv, wffDataset: "film" });
  assert.equal(filmOnly.evaluatedRowCount, 0, "no rows are tagged film in this fixture");
}

// --- real Dataset B combined CSV keeps all film rows and uses thesis external rows
{
  const combined = fs.readFileSync("data/wff/wff_lubrication_source_annotations.combined.csv", "utf8");
  const rows = parseWffCsv(combined, "dataset-b").filter((row) => row.wffDataset === "film");
  assert.equal(rows.length, 212, "combined CSV parser keeps every measured Dataset B film row");
  const result = buildWffEvaluationFromRows(rows, {
    datasetId: "dataset-b",
    label: "Dataset B",
    sourceRowCount: rows.length,
    modelType: "gradient_boosting",
  });
  assert.equal(result.splits.externalLiterature.points.length, 6, "Dataset B live split uses the thesis Table 2.2 external rows");
  assert.equal(result.splits.train.points.length, 160);
  assert.equal(result.splits.test.points.length, 46);
}

// --- trained-model mode overrides the snapshot column --------------------
{
  const snap = buildWffEvaluation({ datasetId: "dataset-a", label: "A", csvText: csv, modelType: "snapshot" });
  assert.equal(snap.settings.modelType, "snapshot");
  assert.equal(snap.settings.trained, false);
  assert.equal(snap.invalidCount, 1, "snapshot keeps the negative friction_pred as invalid");

  const trained = buildWffEvaluation({ datasetId: "dataset-a", label: "A", csvText: csv, modelType: "gradient_boosting" });
  assert.equal(trained.settings.modelType, "gradient_boosting");
  assert.equal(trained.settings.trained, true);
  assert.equal(trained.settings.modelLabel, "Gradient boosting");
  // snapshot column is preserved on every point even when a model overrides `predicted`
  const allTrained = [...trained.splits.train.points, ...trained.splits.test.points, ...trained.splits.externalLiterature.points];
  assert.ok(
    allTrained.some((p) => p.predicted !== p.snapshotPredicted),
    "the trained model replaces the snapshot prediction"
  );
  assert.ok(
    allTrained.every((p) => Number.isFinite(p.predicted)),
    "every trained prediction is finite"
  );
  // with these rows the model predicts a positive mean, so the snapshot's lone invalid point is no longer invalid
  assert.equal(trained.invalidCount, 0, "invalidCount reflects the model's predictions, not the snapshot");
}

console.log("WFF evaluation tests passed");
