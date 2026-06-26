"use client";

import { useMemo, useState } from "react";
import type { Atlas, AtlasCell, DesignConstraints, RankedCandidate } from "@/lib/predict/candidates";
import { CALIBRATION_GATE } from "@/lib/predict/engine";
import type { DesignSpec } from "@/lib/predict/specs";
import { PairLabel, SectionHeader, TierBadge } from "./studioParts";
import { frictionRegimeInsight } from "./thesisInsights";

/**
 * Zone 3 — the design explorer: the cation × anion Pair Atlas plus the ranked
 * candidate shortlist. Below the calibration gate the atlas is coverage-only
 * (measured cells light up, nothing else is colored) and ranking is disabled —
 * the unlock condition is stated, not hidden.
 */

interface ExplorerProps {
  spec: DesignSpec;
  atlas: Atlas;
  ranked: RankedCandidate[];
  objective: "max" | "min";
  includeExtrapolated: boolean;
  constraints: DesignConstraints;
  modelHashValue: string;
  /** Human-readable non-default model-lab settings (null at defaults) — the
   *  hash alone is one-way; a tuned shortlist/export must say so in words. */
  labSummary?: string | null;
  onObjective: (o: "max" | "min") => void;
  onIncludeExtrapolated: (v: boolean) => void;
  onConstraints: (c: DesignConstraints) => void;
  onPickPair: (cell: AtlasCell) => void;
}

function exportCsv(spec: DesignSpec, ranked: RankedCandidate[], hash: string, labSummary?: string | null) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [
    `# PREDICTED — NOT MEASURED (except rows marked kind=measured) · IonicLink Design Studio · ${spec.domain} · model ${hash}`,
    ...(labSummary ? [`# model-lab settings (non-default): ${labSummary}`] : []),
    "rank,cation,anion,kind,tier,value,low,high,unit,n_evidence,top_analog_id,top_analog_paper",
  ];
  for (const r of ranked) {
    const c = r.cell;
    const p = c.prediction;
    const topMember = p?.neighbors[0]?.point.members[0] ?? c.measured[0]?.members[0];
    lines.push(
      [
        r.rank,
        esc(c.cation.label),
        esc(c.anion.label),
        c.kind,
        p?.tier ?? "measured",
        c.value ?? "",
        p?.low ?? "",
        p?.high ?? "",
        spec.unitBase || "dimensionless",
        p?.neighbors.length ?? c.measured.length,
        esc(topMember?.id ?? ""),
        esc(topMember?.paperTitle ?? ""),
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ioniclink-${spec.domain}-design-candidates.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ConstraintChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:text-brand-700"
      }`}
    >
      {label}
    </button>
  );
}

function PairAtlas({ spec, atlas, onPickPair }: { spec: DesignSpec; atlas: Atlas; onPickPair: (c: AtlasCell) => void }) {
  const [hover, setHover] = useState<AtlasCell | null>(null);
  const CELL = 17;
  const LEFT = 86;
  const TOP = 74;
  const W = LEFT + atlas.anions.length * CELL + 8;
  const H = TOP + atlas.cations.length * CELL + 8;

  // Color scale over log10 values present in the atlas (measured + predicted).
  const { lo, hi } = useMemo(() => {
    const logs = atlas.cells
      .flat()
      .map((c) => c.value)
      .filter((v): v is number => v != null && v > 0)
      .map((v) => Math.log10(v));
    return logs.length ? { lo: Math.min(...logs), hi: Math.max(...logs) } : { lo: 0, hi: 1 };
  }, [atlas]);
  const scale = (v: number) => (hi > lo ? (Math.log10(v) - lo) / (hi - lo) : 0.5);

  const cellAria = (cell: AtlasCell) => {
    const detail = cell.value != null ? `, ${spec.formatValue(cell.value)} ${cell.kind}` : ", no estimate";
    return `${cell.cation.label}${cell.anion.label}${detail} - load into bench`;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} role="group" aria-label="Cation by anion pair atlas">
          <defs>
            <pattern id="atlas-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" className="fill-violet-100" />
              <line x1="0" y1="0" x2="0" y2="4" className="stroke-violet-400" strokeWidth="1.4" />
            </pattern>
          </defs>
          {atlas.anions.map((a, j) => (
            <text
              key={a.key}
              x={LEFT + j * CELL + CELL / 2}
              y={TOP - 8}
              transform={`rotate(-50 ${LEFT + j * CELL + CELL / 2} ${TOP - 8})`}
              className="fill-emerald-700 font-mono"
              fontSize="7.5"
            >
              {a.label}
            </text>
          ))}
          {atlas.cations.map((c, i) => (
            <text key={c.key} x={LEFT - 6} y={TOP + i * CELL + CELL / 2 + 2.5} textAnchor="end" className="fill-cyan-700 font-mono" fontSize="7.5">
              {c.label}
            </text>
          ))}
          {atlas.cells.map((row, i) =>
            row.map((cell, j) => {
              const x = LEFT + j * CELL;
              const y = TOP + i * CELL;
              const common = {
                onMouseEnter: () => setHover(cell),
                onMouseLeave: () => setHover(null),
                onFocus: () => setHover(cell),
                onBlur: () => setHover(null),
                onClick: () => onPickPair(cell),
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPickPair(cell);
                  }
                },
                role: "button" as const,
                tabIndex: 0,
                "aria-label": cellAria(cell),
                className: "cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-ink-900 [&:focus-visible>rect]:stroke-2",
              };
              if (cell.kind === "measured") {
                return (
                  <g key={cell.pairKey} {...common}>
                    <rect x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} rx="3" className="fill-brand-100" />
                    <circle
                      cx={x + CELL / 2}
                      cy={y + CELL / 2}
                      r="4"
                      className={cell.reviewOnly ? "fill-brand-500 stroke-amber-400" : "fill-brand-600 stroke-brand-300"}
                      strokeWidth="1.6"
                    />
                  </g>
                );
              }
              if (cell.kind === "predicted" && cell.value != null) {
                const t = scale(cell.value);
                const extrapolated = cell.prediction?.tier === "extrapolated";
                // Alpha rounded: a raw double can differ by 1 ulp between Node
                // SSR and the browser → hydration warning on the fill prop.
                return (
                  <g key={cell.pairKey} {...common}>
                    <rect
                      x={x + 1}
                      y={y + 1}
                      width={CELL - 2}
                      height={CELL - 2}
                      rx="3"
                      fill={extrapolated ? "url(#atlas-hatch)" : `rgba(139, 92, 246, ${(0.12 + t * 0.62).toFixed(3)})`}
                    />
                  </g>
                );
              }
              return (
                <g key={cell.pairKey} {...common}>
                  <rect x={x + 1} y={y + 1} width={CELL - 2} height={CELL - 2} rx="3" className="fill-ink-100/60" />
                </g>
              );
            })
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-600" /> measured (click → bench)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-amber-300" /> review-only evidence</span>
        {!atlas.gated && (
          <>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-400/70" /> predicted (darker = {`larger value`})</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-100 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgb(167_139_250)_2px,rgb(167_139_250)_3px)]" /> extrapolated</span>
          </>
        )}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-100" /> insufficient evidence</span>
        {hover && (
          <span className="font-mono text-ink-700">
            {hover.cation.label}{hover.anion.label}
            {hover.value != null ? ` · ${spec.formatValue(hover.value)}${hover.kind === "predicted" ? " (predicted)" : " (measured)"}` : " · no estimate"}
          </span>
        )}
      </div>
    </div>
  );
}

export function DesignExplorer(props: ExplorerProps) {
  const { spec, atlas, ranked, constraints } = props;
  const measuredCount = useMemo(() => atlas.cells.flat().filter((c) => c.kind === "measured").length, [atlas]);

  return (
    <section className="panel overflow-hidden">
      <SectionHeader
        title="Design explorer"
        hint="Every cation × anion combination over the ion library, at the bench conditions."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={props.objective}
              onChange={(e) => props.onObjective(e.target.value as "max" | "min")}
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 shadow-sm outline-none focus:border-brand-300"
              aria-label="Design objective"
            >
              <option value={spec.objectiveDefault}>{spec.objectiveLabel[spec.objectiveDefault]}</option>
              <option value={spec.objectiveDefault === "max" ? "min" : "max"}>
                {spec.objectiveLabel[spec.objectiveDefault === "max" ? "min" : "max"]}
              </option>
            </select>
            <button
              type="button"
              className="btn !px-2.5 !py-1.5 text-xs"
              disabled={ranked.length === 0}
              onClick={() => exportCsv(spec, ranked, props.modelHashValue, props.labSummary)}
            >
              Export CSV
            </button>
          </div>
        }
      />

      {props.labSummary && (
        <div className="border-b border-violet-100 bg-violet-50/50 px-5 py-2 text-[11px] font-medium text-violet-700">
          Tuned model: {props.labSummary} — this atlas, shortlist and any export are computed under non-default
          model-lab settings.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-5 py-2.5">
        <span className="label-eyebrow mr-1">Constraints</span>
        <ConstraintChip active={!!constraints.halideFree} label="halide-free" onClick={() => props.onConstraints({ ...constraints, halideFree: !constraints.halideFree })} />
        <ConstraintChip active={!!constraints.fluorineFree} label="fluorine-free" onClick={() => props.onConstraints({ ...constraints, fluorineFree: !constraints.fluorineFree })} />
        <ConstraintChip
          active={constraints.maxChainLength === 8}
          label="chain ≤ C8"
          onClick={() => props.onConstraints({ ...constraints, maxChainLength: constraints.maxChainLength === 8 ? null : 8 })}
        />
        <ConstraintChip active={!!props.includeExtrapolated} label="include extrapolated" onClick={() => props.onIncludeExtrapolated(!props.includeExtrapolated)} />
      </div>

      {atlas.gated && (
        <div className="border-b border-amber-100 bg-amber-50/60 px-5 py-2.5 text-xs leading-relaxed text-amber-800">
          <strong>Coverage mode.</strong> Candidate ranking and predictive coloring unlock at {CALIBRATION_GATE} usable records — this
          pool has {atlas.usableN}. The grid shows the {measuredCount} measured pair{measuredCount === 1 ? "" : "s"}; approving records
          in the review queue grows it.
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="border-b border-ink-100 px-5 py-4 lg:border-b-0 lg:border-r">
          <PairAtlas spec={spec} atlas={atlas} onPickPair={props.onPickPair} />
        </div>
        <div>
          <div className="px-5 pt-3.5">
            <span className="label-eyebrow">{atlas.gated ? "Shortlist (locked)" : `Top candidates — ${spec.objectiveLabel[props.objective]}`}</span>
          </div>
          {ranked.length === 0 ? (
            <p className="px-5 py-4 text-xs leading-relaxed text-ink-700">
              {atlas.gated
                ? "No ranking below the calibration gate — a top-10 computed from this little data would be noise dressed as advice."
                : "No candidates clear the current tier filter. Try including extrapolated estimates."}
            </p>
          ) : (
            <ol className="pb-2">
              {ranked.map((r) => {
                const c = r.cell;
                const p = c.prediction;
                const topMember = p?.neighbors[0]?.point.members[0] ?? c.measured[0]?.members[0];
                const regime = spec.domain === "tribology" ? frictionRegimeInsight(c.value) : null;
                return (
                  <li key={c.pairKey} className="border-b border-ink-100 px-5 py-2.5 last:border-0">
                    <button type="button" onClick={() => props.onPickPair(c)} className="block w-full text-left">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="w-6 font-mono text-xs font-bold text-ink-400 tnum">{r.rank}.</span>
                        <PairLabel cation={c.cation} anion={c.anion} />
                        <span className={`font-mono text-sm font-semibold tnum ${c.kind === "measured" ? "text-brand-700" : "text-violet-700"}`}>
                          {c.value != null ? spec.formatValue(c.value) : "—"}
                        </span>
                        {p?.fold != null && <span className="font-mono text-[10px] text-ink-500 tnum">×/÷ {p.fold.toFixed(2)}</span>}
                        {c.kind === "measured" ? <TierBadge tier="measured" /> : p ? <TierBadge tier={p.tier} /> : null}
                        {r.novel && <span className="status-mini border-violet-200 bg-violet-50 text-violet-700">novel</span>}
                      </div>
                      {topMember && (
                        <p className="mt-0.5 pl-8 text-[10px] text-ink-400">
                          {c.kind === "measured" ? "measured in" : "nearest evidence"} · {topMember.id} — {topMember.paperTitle}
                        </p>
                      )}
                      {regime && (
                        <p className="mt-1 pl-8 text-[10px] leading-relaxed text-ink-700">
                          <span className="font-semibold text-ink-700">Gate regime</span> · {regime.label} ({regime.range}).{" "}
                          <span className="font-semibold text-violet-700">Paper-derived rationale:</span> {regime.rationale}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
