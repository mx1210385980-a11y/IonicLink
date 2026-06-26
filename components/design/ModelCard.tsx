"use client";

import { SLIDE_VELOCITY_FORMULA } from "@/lib/afm";
import { VFT_UNLOCK } from "@/lib/predict/arrhenius";
import type { DomainDataset } from "@/lib/predict/dataset";
import { CALIBRATION_GATE } from "@/lib/predict/engine";
import type { LooResult } from "@/lib/predict/loo";
import type { DesignSpec } from "@/lib/predict/specs";
import { LAB_DEFAULTS, labSummary, type LabSettings } from "./ModelLab";
import { THESIS_DATASETS } from "./thesisInsights";

/**
 * Zone 4 — the calibration certificate. The model indicts itself: training
 * census, per-pair Arrhenius fits, leave-one-out scatter (or the verbatim
 * "insufficient data for validation" statement), the exclusion ledger, and the
 * growth loop — what concrete curation work unlocks which capability next.
 */

function LooScatter({ loo }: { loo: LooResult }) {
  const all = loo.pairs.flatMap((p) => [p.measuredLog, p.predictedLog]);
  const lo = Math.min(...all) - 0.3;
  const hi = Math.max(...all) + 0.3;
  const S = 190;
  // Rounded for deterministic SSR/client hydration (1-ulp Math differences).
  const P = (v: number) => +(30 + ((v - lo) / (hi - lo)) * (S - 44)).toFixed(2);
  const PY = (v: number) => +(S - P(v)).toFixed(2);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[230px]" role="img" aria-label="Leave-one-out predicted vs measured">
      <rect x="0" y="0" width={S} height={S} rx="10" className="fill-ink-50/60" />
      <line x1={P(lo + 0.3)} y1={PY(lo + 0.3)} x2={P(hi - 0.3)} y2={PY(hi - 0.3)} className="stroke-ink-300" strokeWidth="1" strokeDasharray="4 3" />
      {loo.pairs.map((p, i) => (
        <circle key={i} cx={P(p.measuredLog)} cy={PY(p.predictedLog)} r="3.2" className="fill-violet-500/85" />
      ))}
      <text x={S / 2} y={S - 6} textAnchor="middle" className="fill-ink-400 font-mono" fontSize="8">
        measured log₁₀
      </text>
      <text x="10" y={S / 2} textAnchor="middle" transform={`rotate(-90 10 ${S / 2})`} className="fill-ink-400 font-mono" fontSize="8">
        predicted log₁₀
      </text>
    </svg>
  );
}

export function ModelCard({
  spec,
  dataset,
  loo,
  looB,
  lab = LAB_DEFAULTS,
}: {
  spec: DesignSpec;
  dataset: DomainDataset;
  loo: LooResult | null;
  looB?: LooResult | null;
  /** Live model-lab hyperparameters (tribology) — the certificate must describe the model that produced its numbers. */
  lab?: LabSettings;
}) {
  const labNote = labSummary(lab);
  // Growth hints: groups with exactly one distinct temperature are one measurement away from an Arrhenius fit.
  const singleTempGroups: string[] = [];
  if (spec.hasTemperatureModel) {
    const tempsByGroup = new Map<string, Set<number>>();
    for (const p of dataset.points) {
      if (p.tempK == null) continue;
      const set = tempsByGroup.get(p.groupKey) ?? new Set<number>();
      set.add(Math.round(p.tempK));
      tempsByGroup.set(p.groupKey, set);
    }
    for (const [groupKey, temps] of tempsByGroup) {
      if (temps.size === 1) {
        const label = dataset.points.find((p) => p.groupKey === groupKey)?.groupLabel;
        if (label) singleTempGroups.push(label);
      }
    }
  }
  const outliers = dataset.points.filter((p) => p.outlier);
  const sketch = dataset.points.length < CALIBRATION_GATE;

  return (
    <section className="panel overflow-hidden">
      <details>
        <summary className="cursor-pointer select-none px-5 py-3.5 text-base font-semibold text-ink-900 transition hover:text-brand-700">
          Calibration certificate — how these numbers are made
          <span className="ml-2 align-middle text-[11px] font-medium text-ink-400">methodology · fits · validation · limits</span>
        </summary>

        <div className="grid gap-x-6 gap-y-5 border-t border-ink-100 px-5 py-4 lg:grid-cols-2">
          <div className="space-y-3 text-xs leading-relaxed text-ink-700">
            <div>
              <span className="label-eyebrow">Method</span>
              <p className="mt-1">
                Similarity-weighted nearest neighbors over physically named ion descriptors computed from each ion&apos;s molecular
                graph: MW, vdW radius (and the r₊/r₋ packing ratio), rotatable bonds N_rot, H-bond donors/acceptors, TPSA
                (Ertl-style), Balaban J, a Bertz-style complexity index, a fragment-additive logP estimate, fluorination, chain
                length, and the quaternary-ammonium count — plus a graded chemical-family term. Because every feature derives
                from SMILES at runtime, new ionic liquids featurize the moment their records arrive. Estimates are computed in
                log₁₀ ({spec.symbol} spans decades) as a Gaussian-kernel weighted mean of the top-{lab.kNeighbors} analogs; the
                kernel bandwidth is the median pairwise distance between measured pairs
                {lab.bandwidthScale !== 1 ? `, scaled ×${lab.bandwidthScale.toFixed(2)} by the model lab` : ""}. logP and Bertz
                values are labeled approximations — not RDKit MolLogP/BertzCT.
              </p>
            </div>
            {spec.domain === "tribology" && (
              <div>
                <span className="label-eyebrow">Operating conditions &amp; surfaces</span>
                <p className="mt-1">
                  Training points are resolved per OPERATING POINT — pair + substrate + scale + method + potential + load +
                  speed + roughness + film thickness + concentration + water content. Distinct setpoints never collapse
                  (friction varies non-monotonically with potential), and only true replicates merge to a median. The distance
                  adds a Gower term over the conditions the query specifies, and a surface term built from curated descriptors
                  (γ&#8347;, contact angle, characteristic surface charge, conductor/layered/plane indicators) — unknown substrates
                  fall back to a coarse material-class match, never imputed values.
                </p>
              </div>
            )}
            {spec.domain === "tribology" && (
              <div>
                <span className="label-eyebrow">Dual pathway — film thickness h</span>
                <p className="mt-1">
                  The interfacial film thickness (or layer count) is the strongest single descriptor in the literature, and it
                  is treated without imputation: the <strong>Dataset-B “interfacial structure-enhanced” model</strong> runs only
                  when the query specifies h AND records report it ({dataset.filmPointCount} of {dataset.points.length} points
                  currently do), trained exclusively on those records with h in the distance. All other queries use the{" "}
                  <strong>Dataset-A conservative model</strong>: every record participates, but the h column is simply never
                  consulted. A thickness and a layer count are different observations and are never converted into each other.
                </p>
              </div>
            )}
            {spec.domain === "tribology" && (
              <div>
                <span className="label-eyebrow">Thesis research basis</span>
                <p className="mt-1">
                  The design layer mirrors the paper&apos;s AFM/SFA nano-friction framework:{" "}
                  <strong>Dataset-A {THESIS_DATASETS.datasetA}</strong> literature samples for broad IL-surface-condition coverage,
                  and <strong>Dataset-B {THESIS_DATASETS.datasetB}</strong> samples where interfacial film thickness h is reported.
                  The paper&apos;s strongest product-facing result is not only a lower error number; it is the operating rule that h,
                  surface descriptors and sliding conditions matter differently across low, middle and high friction regimes.
                </p>
              </div>
            )}
            {spec.hasTemperatureModel ? (
              <div>
                <span className="label-eyebrow">Temperature</span>
                <p className="mt-1">
                  Evidence is translated to the query temperature only along a fitted Arrhenius law: a pair&apos;s own fit where it
                  has ≥2 temperatures (<em>inferred</em>), else the domain-median fitted slope (<em>assumed</em>, flagged, interval
                  ×1.5). With no fitted slope anywhere, evidence is never translated — a distance penalty applies instead. No
                  literature activation energies are ever used. VFT stays locked until a pair has ≥{VFT_UNLOCK.minTemps} temperatures
                  spanning ≥{VFT_UNLOCK.minSpanK} K.
                </p>
              </div>
            ) : (
              <div>
                <span className="label-eyebrow">Domain rules</span>
                <p className="mt-1">
                  COF gets no temperature law — temperature is a match criterion only. Substrate enters the distance softly (same
                  substrate &gt; same class &gt; different). Legacy derivation rule retained from the knowledge page: sliding velocity
                  derives as <span className="font-mono text-ink-700">{SLIDE_VELOCITY_FORMULA}</span> (lib/afm), applied at extraction
                  and editing.
                </p>
              </div>
            )}
            <div>
              <span className="label-eyebrow">Honesty gates</span>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {spec.domain === "tribology" && (
                  <li>
                    Macroscopic friction is out of scope: the pool admits nanoscale (AFM-class) records only —
                    macroscale tribometry is a different physical regime, not extra evidence.
                  </li>
                )}
                <li>Exact pair+condition matches return the measurement — the model is bypassed, never duplicated.</li>
                <li>Statistical estimates, atlas coloring, ranking and validation all unlock at {CALIBRATION_GATE} usable records.</li>
                <li>The Insufficient tier renders no number — nearest analogs and the missing-evidence reason only.</li>
                <li>Predictions are ephemeral: never stored in the database, never shown outside this page.</li>
              </ul>
            </div>
            <div>
              <span className="label-eyebrow">Limits — stated plainly</span>
              <p className="mt-1">
                {sketch
                  ? `This ${spec.domain} model is trained on ${dataset.points.length} usable point${dataset.points.length === 1 ? "" : "s"} — treat everything here as a cited analog lookup, not a statistical model.`
                  : `Trained on ${dataset.points.length} points over ${dataset.pairCount} pairs; estimates are interpolation in a small, biased sample of the literature — they rank hypotheses, they do not replace measurement.`}{" "}
                Additives, water content and mixtures are not modeled.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <span className="label-eyebrow">Validation (leave-one-out)</span>
              {labNote && (
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                  Model-lab settings active: {labNote} — every number in this certificate is computed under these
                  settings, not the calibrated defaults.
                </p>
              )}
              {loo ? (
                <div className="mt-1.5">
                  <p className="text-xs text-ink-700">
                    Each point predicted from the others{spec.domain === "tribology" ? " (conservative pathway A)" : ""}: median
                    fold error <span className="font-mono font-semibold text-ink-900 tnum">×/÷ {loo.foldError.toFixed(2)}</span>{" "}
                    over {loo.n} points. Every interval on this page is floored at its pathway&apos;s demonstrated error.
                  </p>
                  <p className="mt-1 text-xs text-ink-700">
                    Study metrics on the same held-out folds (log₁₀ space):{" "}
                    <span className="font-mono font-semibold text-violet-700 tnum">
                      R² {loo.r2 == null ? "—" : loo.r2.toFixed(3)}
                    </span>{" "}
                    · <span className="font-mono font-semibold text-violet-700 tnum">RMSE {loo.rmseLog.toFixed(3)}</span> ·{" "}
                    <span className="font-mono font-semibold text-violet-700 tnum">MAE {loo.maeLog.toFixed(3)}</span>
                  </p>
                  {looB && (
                    <p className="mt-1 text-xs text-ink-700">
                      Film-thickness pathway B: <span className="font-mono font-semibold tnum">×/÷ {looB.foldError.toFixed(2)}</span>{" "}
                      over {looB.n} h-bearing points.
                    </p>
                  )}
                  {spec.domain === "tribology" && !looB && (
                    <p className="mt-1 text-xs text-ink-700">
                      Pathway B validation unlocks at {CALIBRATION_GATE} film-thickness records (currently {dataset.filmPointCount}).
                    </p>
                  )}
                  <div className="mt-2">
                    <LooScatter loo={loo} />
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-xs font-medium text-amber-700">
                  Insufficient data for validation — outputs are cited analog lookups, not a statistical model.
                </p>
              )}
            </div>

            {spec.hasTemperatureModel && (
              <div>
                <span className="label-eyebrow">Arrhenius fits</span>
                {dataset.fits.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-700">No pair has two distinct temperatures yet — no fits available.</p>
                ) : (
                  <table className="mt-1.5 w-full text-left text-xs">
                    <thead>
                      <tr className="label-eyebrow border-b border-ink-100">
                        <th className="py-1 pr-2 font-semibold">Pair</th>
                        <th className="py-1 pr-2 font-semibold">Ea</th>
                        <th className="py-1 pr-2 font-semibold">Points</th>
                        <th className="py-1 font-semibold">Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataset.fits.map((f) => (
                        <tr key={f.groupKey} className="border-b border-ink-100/70 last:border-0">
                          <td className="py-1 pr-2 font-mono">{f.groupLabel}</td>
                          <td className="py-1 pr-2 font-mono tnum">{(f.eaJmol / 1000).toFixed(1)} kJ/mol</td>
                          <td className="py-1 pr-2 tnum">
                            {f.nPoints}
                            {f.nPoints === 2 && <span className="ml-1 text-amber-600" title="exact 2-point fit, no redundancy">2-pt fit</span>}
                          </td>
                          <td className="py-1 font-mono tnum">
                            {Math.round(f.tempRange[0])}–{Math.round(f.tempRange[1])} K
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div>
              <span className="label-eyebrow">Exclusion ledger</span>
              {dataset.exclusions.length === 0 && outliers.length === 0 && dataset.reviewExcludedCount === 0 && dataset.scaleExcludedCount === 0 ? (
                <p className="mt-1 text-xs text-ink-700">Nothing excluded — every record in the pool is usable.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
                  {dataset.scaleExcludedCount > 0 && (
                    <li>
                      {dataset.scaleExcludedCount} macroscale (or unscaled) record{dataset.scaleExcludedCount === 1 ? "" : "s"} excluded
                      — this is a nanoscale-only friction model
                    </li>
                  )}
                  {dataset.exclusions.map((e) => (
                    <li key={`${e.id}-${e.reason}`}>
                      <span className="font-mono text-ink-500">{e.id}</span> {e.pair} — {e.reason}
                    </li>
                  ))}
                  {outliers.map((p) => (
                    <li key={p.groupKey + String(p.tempK)}>
                      <span className="font-mono text-ink-500">{p.members[0]?.id}</span> {p.groupLabel} — flagged outlier
                      (|z| = {Math.abs(p.outlierZ).toFixed(1)}),{" "}
                      {lab.excludeOutliers
                        ? "excluded from the pool by the model-lab setting"
                        : "still in the pool, announced on its evidence rows"}
                    </li>
                  ))}
                  {dataset.reviewExcludedCount > 0 && (
                    <li>{dataset.reviewExcludedCount} review-status records hidden by the official-only toggle</li>
                  )}
                </ul>
              )}
            </div>

            <div>
              <span className="label-eyebrow">Unlocks with data</span>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-700">
                {sketch && (
                  <li>
                    <strong>{CALIBRATION_GATE - dataset.points.length} more usable records</strong> unlock statistical estimates,
                    atlas coloring, ranking and leave-one-out validation.
                  </li>
                )}
                {singleTempGroups.slice(0, 3).map((g) => (
                  <li key={g}>
                    One more temperature on <span className="font-mono">{g}</span> unlocks its own Arrhenius fit.
                  </li>
                ))}
                {spec.domain === "tribology" && dataset.filmPointCount < CALIBRATION_GATE && (
                  <li>
                    {CALIBRATION_GATE - dataset.filmPointCount} more record{CALIBRATION_GATE - dataset.filmPointCount === 1 ? "" : "s"}{" "}
                    reporting film thickness h unlock the interfacial-enhanced pathway&apos;s statistics — the literature&apos;s
                    strongest single descriptor.
                  </li>
                )}
                {spec.hasTemperatureModel && (
                  <li>
                    {VFT_UNLOCK.minTemps} temperatures spanning {VFT_UNLOCK.minSpanK} K on one pair unlock VFT (the physically
                    better law for ionic liquids).
                  </li>
                )}
                <li>Approving review-queue records moves them from amber to teal everywhere on this page.</li>
              </ul>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
