/**
 * Pure-TypeScript tree-ensemble regressors for the Model Evaluation Lab — a
 * dependency-free stand-in for the WFF thesis's CatBoost / RF / XGBoost family.
 * A model is fit ONLY on the training split; test and external rows are then
 * predicted out-of-sample, so their metrics reflect genuine generalization
 * rather than a re-scored snapshot column.
 *
 * Everything is deterministic given the seed (seeded LCG for bootstrapping and
 * feature subsampling) so server and client renders agree.
 */

export type WffModelType = "gradient_boosting" | "random_forest" | "blend" | "gated_hybrid" | "snapshot";

export const WFF_MODEL_LABELS: Record<WffModelType, string> = {
  gradient_boosting: "Gradient boosting",
  random_forest: "Random forest",
  blend: "Blend (RF + boosting)",
  gated_hybrid: "Gated hybrid (stacking)",
  snapshot: "Snapshot (friction_pred)",
};

// --- configurable gated-hybrid (thesis Ch. 4: 3 base combos × 5 metas × q) -
export type WffBaseLearner = "catboost" | "xgboost" | "forest";
export type WffMetaModel = "ridge" | "boosting" | "forest";

export const WFF_BASE_LEARNERS: WffBaseLearner[] = ["catboost", "xgboost", "forest"];
export const WFF_META_MODELS: WffMetaModel[] = ["ridge", "boosting", "forest"];
export const WFF_BASE_LEARNER_LABELS: Record<WffBaseLearner, string> = {
  catboost: "CatBoost-style",
  xgboost: "XGBoost-style",
  forest: "Random forest",
};
export const WFF_META_LABELS: Record<WffMetaModel, string> = {
  ridge: "Ridge",
  boosting: "Boosting",
  forest: "Random forest",
};

export interface WffHybridConfig {
  baseLearners: WffBaseLearner[]; // 2-3 base learners stacked per region
  gate: WffBaseLearner; // model that assigns the friction region
  metaModel: WffMetaModel; // combiner over the base-learner meta-features
  q1: number; // lower gating quantile (0..1)
  q2: number; // upper gating quantile (0..1)
}

export const DEFAULT_HYBRID_CONFIG: WffHybridConfig = {
  baseLearners: ["catboost", "forest"],
  gate: "catboost",
  metaModel: "ridge",
  q1: 0.35,
  q2: 0.65,
};

/** Descriptor feature columns the model trains on (numeric only; `h` is film-only). */
export const WFF_FEATURE_COLUMNS = [
  "r_cat",
  "logP_cat",
  "MW_cat",
  "N_rot_cat",
  "N_HA_cat",
  "N_HD_cat",
  "N_qN_cat",
  "TPSA_cat",
  "Bertz_cat",
  "BalJ_cat",
  "r_an",
  "logP_an",
  "MW_an",
  "TPSA_an",
  "Bertz_an",
  "BalJ_an",
  "σ_s",
  "γ_s",
  "θ_s",
  "Rq",
  "velocity",
  "Potential",
  "T",
  "x_IL",
  "I_H2O",
  "I_ss",
  "h",
] as const;

export interface WffTrainedModel {
  predict(features: (number | null)[]): number;
}

type Feat = (number | null)[];

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function imputeMeans(rows: Feat[]): number[] {
  const p = rows[0]?.length ?? 0;
  const means = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const v = row[j];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    means[j] = count ? sum / count : 0;
  }
  return means;
}

function impute(row: Feat, means: number[]): number[] {
  return row.map((v, j) => (v != null && Number.isFinite(v) ? v : means[j]));
}

// --- regression tree (CART, variance reduction via prefix sums) -----------

interface Leaf {
  value: number;
}
interface Split {
  feature: number;
  threshold: number;
  left: TreeNode;
  right: TreeNode;
}
type TreeNode = Leaf | Split;

interface TreeOpts {
  maxDepth: number;
  minLeaf: number;
  featureCount: number; // features considered per split (< p enables RF-style bagging)
}

function sampleFeatures(p: number, k: number, rng: () => number): number[] {
  if (k >= p) return Array.from({ length: p }, (_, i) => i);
  const pool = Array.from({ length: p }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (p - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

function buildTree(X: number[][], y: number[], idx: number[], depth: number, opts: TreeOpts, rng: () => number): TreeNode {
  const n = idx.length;
  let total = 0;
  let totalSq = 0;
  for (const i of idx) {
    total += y[i];
    totalSq += y[i] * y[i];
  }
  const mean = total / n;
  if (depth >= opts.maxDepth || n < 2 * opts.minLeaf) return { value: mean };
  const parentSse = totalSq - (total * total) / n;
  if (parentSse <= 1e-12) return { value: mean };

  const p = X[0].length;
  const feats = sampleFeatures(p, opts.featureCount, rng);
  let bestGain = 1e-12;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestOrder: number[] | null = null;
  let bestSplitAt = -1;

  for (const f of feats) {
    const order = [...idx].sort((a, b) => X[a][f] - X[b][f]);
    let leftSum = 0;
    let leftSqSum = 0;
    for (let i = 0; i < n - 1; i++) {
      const yi = y[order[i]];
      leftSum += yi;
      leftSqSum += yi * yi;
      const nl = i + 1;
      const nr = n - nl;
      if (nl < opts.minLeaf || nr < opts.minLeaf) continue;
      if (X[order[i]][f] === X[order[i + 1]][f]) continue;
      const rightSum = total - leftSum;
      const rightSqSum = totalSq - leftSqSum;
      const sseLeft = leftSqSum - (leftSum * leftSum) / nl;
      const sseRight = rightSqSum - (rightSum * rightSum) / nr;
      const gain = parentSse - (sseLeft + sseRight);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = (X[order[i]][f] + X[order[i + 1]][f]) / 2;
        bestOrder = order;
        bestSplitAt = i;
      }
    }
  }

  if (bestFeature < 0 || !bestOrder) return { value: mean };
  const leftIdx = bestOrder.slice(0, bestSplitAt + 1);
  const rightIdx = bestOrder.slice(bestSplitAt + 1);
  return {
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, y, leftIdx, depth + 1, opts, rng),
    right: buildTree(X, y, rightIdx, depth + 1, opts, rng),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let cur = node;
  while ("feature" in cur) {
    cur = x[cur.feature] <= cur.threshold ? cur.left : cur.right;
  }
  return cur.value;
}

// --- ensembles ------------------------------------------------------------

// Sized for a live, in-browser teaching tool: small enough to retrain on every
// settings change without blocking the UI, large enough to generalize well.
type RfOpts = { nTrees: number; maxDepth: number; minLeaf: number };
type GbOpts = { nRounds: number; maxDepth: number; minLeaf: number; learningRate: number; subsample: number; colsample: number };
const RF_OPTS: RfOpts = { nTrees: 36, maxDepth: 8, minLeaf: 3 };
const GB_OPTS: GbOpts = { nRounds: 60, maxDepth: 3, minLeaf: 3, learningRate: 0.14, subsample: 0.8, colsample: 0.6 };

function randomForest(X: number[][], y: number[], rng: () => number, opts: RfOpts = RF_OPTS): (x: number[]) => number {
  const n = X.length;
  const p = X[0].length;
  const featureCount = Math.max(1, Math.round(Math.sqrt(p)));
  const trees: TreeNode[] = [];
  for (let t = 0; t < opts.nTrees; t++) {
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = Math.floor(rng() * n);
    trees.push(buildTree(X, y, idx, 0, { maxDepth: opts.maxDepth, minLeaf: opts.minLeaf, featureCount }, rng));
  }
  return (x) => {
    let sum = 0;
    for (const tree of trees) sum += predictTree(tree, x);
    return sum / trees.length;
  };
}

function gradientBoosting(X: number[][], y: number[], rng: () => number, gb: GbOpts = GB_OPTS): (x: number[]) => number {
  const n = X.length;
  const p = X[0].length;
  const allIdx = Array.from({ length: n }, (_, i) => i);
  const base = y.reduce((a, b) => a + b, 0) / n;
  const F = new Array(n).fill(base);
  const trees: TreeNode[] = [];
  // Column subsampling (à la XGBoost/CatBoost colsample) considers a random
  // feature subset per split — cheaper than scanning all features and a real
  // regularizer.
  const opts = { maxDepth: gb.maxDepth, minLeaf: gb.minLeaf, featureCount: Math.max(1, Math.round(p * gb.colsample)) };
  // Stochastic boosting: each round fits the residual tree on a random row
  // subsample (à la XGBoost/CatBoost). This both regularizes and makes the
  // seed meaningful for the boosting fit, not just for the split.
  const sampleSize = Math.max(4, Math.floor(n * gb.subsample));
  const useSubsample = sampleSize < n;
  for (let m = 0; m < gb.nRounds; m++) {
    const resid = y.map((v, i) => v - F[i]);
    let idx = allIdx;
    if (useSubsample) {
      idx = new Array(sampleSize);
      for (let i = 0; i < sampleSize; i++) idx[i] = Math.floor(rng() * n);
    }
    const tree = buildTree(X, resid, idx, 0, opts, rng);
    for (let i = 0; i < n; i++) F[i] += gb.learningRate * predictTree(tree, X[i]);
    trees.push(tree);
  }
  return (x) => {
    let sum = base;
    for (const tree of trees) sum += gb.learningRate * predictTree(tree, x);
    return sum;
  };
}

// --- gated partitioned hybrid stacking (WFF thesis Ch. 4) -----------------
// Gate-based partitioning + per-region stacking: a gradient-boosting gate
// (5-fold OOF) splits samples into Low/Middle/High friction regions by
// quantiles of its predictions; within each region a Ridge meta-model learns
// region-specific blend weights over the [boosting, forest] base predictions
// (their out-of-fold meta-features). This captures the thesis's finding that
// different learners dominate different friction regimes.

const HYBRID = { folds: 2, ridgeLambda: 1e-3, minRegion: 4 };
// Lighter base learners for the hybrid's many sub-fits (OOF folds + full), so
// the gate + per-region stacking stays affordable as a live, opt-in model.
// CatBoost-style = shallow symmetric-ish boosting; XGBoost-style = a bit
// deeper/greedier; plus a random forest — three distinct tree learners.
const HYBRID_GB_CAT: GbOpts = { nRounds: 40, maxDepth: 3, minLeaf: 3, learningRate: 0.18, subsample: 0.8, colsample: 0.6 };
const HYBRID_GB_XGB: GbOpts = { nRounds: 50, maxDepth: 4, minLeaf: 3, learningRate: 0.15, subsample: 0.8, colsample: 0.7 };
const HYBRID_RF: RfOpts = { nTrees: 24, maxDepth: 7, minLeaf: 3 };

type FitFn = (x: number[][], y: number[], rng: () => number) => (x: number[]) => number;

function baseLearnerFit(kind: WffBaseLearner): FitFn {
  if (kind === "catboost") return (x, y, r) => gradientBoosting(x, y, r, HYBRID_GB_CAT);
  if (kind === "xgboost") return (x, y, r) => gradientBoosting(x, y, r, HYBRID_GB_XGB);
  return (x, y, r) => randomForest(x, y, r, HYBRID_RF);
}

// Region meta-model over the base learners' meta-features Z (per region).
function metaFit(kind: WffMetaModel, Z: number[][], y: number[], rng: () => number): (z: number[]) => number {
  if (Z.length < HYBRID.minRegion) {
    // too few rows to fit a combiner → average the base predictions
    return (z) => (z.length ? z.reduce((a, b) => a + b, 0) / z.length : 0);
  }
  if (kind === "ridge") {
    const w = ridgeFit(Z, y, HYBRID.ridgeLambda);
    return (z) => w[0] + z.reduce((s, zi, i) => s + w[i + 1] * zi, 0);
  }
  if (kind === "boosting") return gradientBoosting(Z, y, rng, HYBRID_GB_CAT);
  return randomForest(Z, y, rng, HYBRID_RF);
}

function fisherYates(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function quantileSorted(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * (sortedAsc.length - 1))));
  return sortedAsc[pos];
}

// Solve A w = b for a small square system via Gauss-Jordan with partial pivoting.
function solveLinear(A: number[][], b: number[]): number[] {
  const p = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= p; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[p] / M[i][i]));
}

// Ridge regression of y on meta-features Z (with intercept). Returns [b0, w...].
function ridgeFit(Z: number[][], y: number[], lambda: number): number[] {
  const p = Z[0].length + 1;
  const ATA = Array.from({ length: p }, () => new Array(p).fill(0));
  const ATy = new Array(p).fill(0);
  for (let i = 0; i < Z.length; i++) {
    const a = [1, ...Z[i]];
    for (let r = 0; r < p; r++) {
      ATy[r] += a[r] * y[i];
      for (let c = 0; c < p; c++) ATA[r][c] += a[r] * a[c];
    }
  }
  for (let r = 1; r < p; r++) ATA[r][r] += lambda; // regularize weights, not the intercept
  return solveLinear(ATA, ATy);
}

// Out-of-fold predictions: each row is predicted by a model trained on the
// other folds, so the meta-model never sees a base learner's in-sample fit.
function kFoldOof(X: number[][], y: number[], k: number, rng: () => number, fit: (x: number[][], y: number[], rng: () => number) => (x: number[]) => number): number[] {
  const n = X.length;
  const order = fisherYates(n, rng);
  const fold = new Array(n);
  for (let i = 0; i < n; i++) fold[order[i]] = i % k;
  const oof = new Array(n).fill(0);
  for (let f = 0; f < k; f++) {
    const trI: number[] = [];
    const teI: number[] = [];
    for (let i = 0; i < n; i++) (fold[i] === f ? teI : trI).push(i);
    if (teI.length === 0) continue;
    if (trI.length < 4) {
      const src = trI.length ? trI : teI;
      const m = src.reduce((s, i) => s + y[i], 0) / src.length;
      for (const i of teI) oof[i] = m;
      continue;
    }
    const model = fit(
      trI.map((i) => X[i]),
      trI.map((i) => y[i]),
      rng
    );
    for (const i of teI) oof[i] = model(X[i]);
  }
  return oof;
}

function gatedHybrid(X: number[][], y: number[], rng: () => number, cfg: WffHybridConfig): (x: number[]) => number {
  const n = X.length;
  const bases = cfg.baseLearners.length ? cfg.baseLearners : ["catboost" as WffBaseLearner];

  // out-of-fold meta-features + a full model for each selected base learner
  const oof: number[][] = [];
  const full: ((x: number[]) => number)[] = [];
  for (const b of bases) {
    const fit = baseLearnerFit(b);
    oof.push(kFoldOof(X, y, HYBRID.folds, rng, fit));
    full.push(fit(X, y, rng));
  }

  // gate: reuse a base learner's fit if it's one of them, else train its own
  const gateIdx = bases.indexOf(cfg.gate);
  const gateOof = gateIdx >= 0 ? oof[gateIdx] : kFoldOof(X, y, HYBRID.folds, rng, baseLearnerFit(cfg.gate));
  const gateFull = gateIdx >= 0 ? full[gateIdx] : baseLearnerFit(cfg.gate)(X, y, rng);

  // partition thresholds from the gate's out-of-fold predictions
  const sorted = [...gateOof].sort((a, b) => a - b);
  const lo = Math.min(cfg.q1, cfg.q2);
  const hi = Math.max(cfg.q1, cfg.q2);
  const mu1 = quantileSorted(sorted, lo);
  const mu2 = quantileSorted(sorted, hi);
  const regionOf = (g: number) => (g < mu1 ? 0 : g < mu2 ? 1 : 2);

  // per-region meta-model over the base learners' OOF meta-features
  const metas = [0, 1, 2].map((r) => {
    const Z: number[][] = [];
    const yr: number[] = [];
    for (let i = 0; i < n; i++) {
      if (regionOf(gateOof[i]) === r) {
        Z.push(bases.map((_, b) => oof[b][i]));
        yr.push(y[i]);
      }
    }
    return metaFit(cfg.metaModel, Z, yr, rng);
  });

  return (x) => {
    const z = full.map((f) => f(x));
    return metas[regionOf(gateFull(x))](z);
  };
}

export function trainWffModel(
  modelType: Exclude<WffModelType, "snapshot">,
  trainFeatures: Feat[],
  trainTargets: number[],
  seed: number,
  hybridConfig: WffHybridConfig = DEFAULT_HYBRID_CONFIG
): WffTrainedModel {
  if (trainFeatures.length === 0) {
    return { predict: () => 0 };
  }
  const means = imputeMeans(trainFeatures);
  if (trainFeatures.length < 4) {
    // Too few rows to train a tree meaningfully — predict the training mean.
    const base = trainTargets.reduce((a, b) => a + b, 0) / trainTargets.length;
    return { predict: () => base };
  }
  const X = trainFeatures.map((row) => impute(row, means));
  const rng = lcg(seed);
  const predictors: ((x: number[]) => number)[] = [];
  if (modelType === "gated_hybrid") predictors.push(gatedHybrid(X, trainTargets, rng, hybridConfig));
  if (modelType === "random_forest" || modelType === "blend") predictors.push(randomForest(X, trainTargets, rng));
  if (modelType === "gradient_boosting" || modelType === "blend") predictors.push(gradientBoosting(X, trainTargets, rng));
  return {
    predict(features) {
      const x = impute(features, means);
      let sum = 0;
      for (const p of predictors) sum += p(x);
      return sum / predictors.length;
    },
  };
}
