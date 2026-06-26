"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import type { Domain } from "@/lib/domain";
import { parseQuantity } from "@/lib/units";
import { buildAtlas, buildVocabulary, rankCandidates, type AtlasCell, type DesignConstraints } from "@/lib/predict/candidates";
import { buildDataset } from "@/lib/predict/dataset";
import { describeIon, featureNorm } from "@/lib/predict/descriptors";
import { predict } from "@/lib/predict/engine";
import { runLoo } from "@/lib/predict/loo";
import { DESIGN_SPECS } from "@/lib/predict/specs";
import { fmtK, modelHash } from "./studioParts";
import { PredictBench } from "./PredictBench";
import { EvidenceLedger } from "./EvidenceLedger";
import { DesignExplorer } from "./DesignExplorer";
import { ModelLab, LAB_DEFAULTS, labSummary, type LabSettings } from "./ModelLab";
import { ModelCard } from "./ModelCard";

/**
 * The Design Studio — property prediction and new-materials design, built on
 * the domain's own curated records. Everything is computed client-side from
 * the records the server page hands over; nothing here is ever persisted.
 */

function ModelRibbonStat({
  label,
  value,
  tone = "ink",
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: "ink" | "brand" | "amber" | "violet";
  title?: string;
}) {
  const toneClass = {
    ink: "text-ink-900",
    brand: "text-brand-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
  }[tone];

  return (
    <span title={title} className="min-w-[7rem] shrink-0 rounded-[7px] border border-ink-200/70 bg-white px-2.5 py-1.5">
      <span className="block text-[9px] font-semibold uppercase tracking-eyebrow text-ink-400">{label}</span>
      <span className={`mt-0.5 block truncate font-mono text-[13px] font-semibold tnum ${toneClass}`}>{value}</span>
    </span>
  );
}

export function DesignStudio({
  domain,
  records,
  evaluationLabHref,
}: {
  domain: Domain;
  records: any[];
  evaluationLabHref?: string | null;
}) {
  const spec = DESIGN_SPECS[domain];

  const [includeReview, setIncludeReview] = useState(domain !== "tribology");
  // null = pristine (opens on the first measured pair); "" = deliberately cleared.
  const [cationText, setCationText] = useState<string | null>(null);
  const [anionText, setAnionText] = useState<string | null>(null);
  const [tempK, setTempK] = useState(298);
  const [substrate, setSubstrate] = useState("");
  const [species, setSpecies] = useState("cation");
  // Tribology operating conditions — raw text with units, parsed like every
  // other quantity on the platform. Empty = unconditioned (wildcard).
  const [condText, setCondText] = useState({ load: "", velocity: "", potential: "", film: "" });
  const [objective, setObjective] = useState<"max" | "min">(spec.objectiveDefault);
  const [includeExtrapolated, setIncludeExtrapolated] = useState(false);
  const [constraints, setConstraints] = useState<DesignConstraints>({});
  // Model-lab hyperparameters (tribology). Live for the whole studio: every
  // predict/atlas/LOO below runs under these knobs, so the interval floor and
  // the bench always describe the SAME model the lab is reporting on.
  const [lab, setLab] = useState<LabSettings>(LAB_DEFAULTS);

  // Tribology is a NANOSCALE friction model: macroscopic records are out of
  // scope (different physical regime), excluded with a visible count.
  const dataset = useMemo(
    () => buildDataset(domain, records, { includeReview, nanoOnly: domain === "tribology" }),
    [domain, records, includeReview]
  );
  const cationOptions = useMemo(() => buildVocabulary("cation", dataset), [dataset]);
  const anionOptions = useMemo(() => buildVocabulary("anion", dataset), [dataset]);
  const norm = useMemo(() => featureNorm([...cationOptions, ...anionOptions]), [cationOptions, anionOptions]);
  const labKnobs = useMemo(
    () =>
      domain === "tribology"
        ? { bandwidthScale: lab.bandwidthScale, kNeighbors: lab.kNeighbors, excludeOutliers: lab.excludeOutliers }
        : {},
    [domain, lab]
  );
  // Per-pathway calibration: A = conservative (film column unused), B = film-thickness subset.
  const loo = useMemo(() => runLoo(domain, dataset, norm, labKnobs), [domain, dataset, norm, labKnobs]);
  const looB = useMemo(
    () => (domain === "tribology" ? runLoo(domain, dataset, norm, { tribologyPathway: "B", ...labKnobs }) : null),
    [domain, dataset, norm, labKnobs]
  );

  // Parsed tribology conditions (null = unconditioned).
  const tribCond = useMemo(() => {
    if (domain !== "tribology") return null;
    const layers = /layer/i.test(condText.film) ? Number(condText.film.match(/[\d.]+/)?.[0] ?? NaN) || null : null;
    const filmQ = layers == null ? parseQuantity(condText.film, "length") : null;
    return {
      loadQ: parseQuantity(condText.load, "force"),
      velocityQ: parseQuantity(condText.velocity, "velocity"),
      potentialQ: parseQuantity(condText.potential, "potential"),
      filmQ,
      filmLayers: layers,
    };
  }, [domain, condText]);
  const condQuery = useMemo(
    () => ({
      loadN: tribCond?.loadQ?.std ?? null,
      velocityMps: tribCond?.velocityQ?.std ?? null,
      potentialV: tribCond?.potentialQ?.std ?? null,
      filmThicknessM: tribCond?.filmQ?.std ?? null,
      filmLayers: tribCond?.filmLayers ?? null,
    }),
    [tribCond]
  );
  // Mirror the engine's pathway rule so the right calibration floors the interval.
  const pathwayB =
    domain === "tribology" && (condQuery.filmThicknessM != null || condQuery.filmLayers != null) && dataset.filmPointCount > 0;
  const sigmaCal = (pathwayB ? looB : loo)?.sigmaCal ?? null;

  // Default bench ions: the first measured pair, so the page opens on real data.
  const first = dataset.points[0];
  const effCation = cationText ?? (first?.cation.label || "[BMIM]");
  const effAnion = anionText ?? (first?.anion.label || "[TFSI]");
  const cation = useMemo(() => describeIon(effCation, "cation"), [effCation]);
  const anion = useMemo(() => describeIon(effAnion, "anion"), [effAnion]);

  const queryTempK = spec.hasTemperatureModel ? tempK : null;
  const prediction = useMemo(
    () =>
      predict(
        domain,
        dataset,
        {
          cation,
          anion,
          tempK: queryTempK,
          substrate: substrate || null,
          species: spec.conditionKind === "species" ? species : null,
          ...condQuery,
        },
        norm,
        { sigmaCal, ...labKnobs }
      ),
    [domain, dataset, cation, anion, queryTempK, substrate, species, spec.conditionKind, norm, sigmaCal, condQuery, labKnobs]
  );

  // The atlas re-predicts every cell — defer its temperature AND the lab
  // knobs (with the sigmaCal derived under them) so slider scrubbing keeps
  // the bench readout snappy while the grid catches up.
  const atlasTempK = useDeferredValue(queryTempK);
  const atlasLabKnobs = useDeferredValue(labKnobs);
  const atlasSigmaCal = useDeferredValue(sigmaCal);
  const atlas = useMemo(
    () =>
      buildAtlas(
        domain,
        dataset,
        norm,
        {
          tempK: atlasTempK,
          substrate: substrate || null,
          species: spec.conditionKind === "species" ? species : null,
          ...condQuery,
        },
        constraints,
        { sigmaCal: atlasSigmaCal, ...atlasLabKnobs }
      ),
    [domain, dataset, norm, atlasTempK, substrate, species, spec.conditionKind, constraints, atlasSigmaCal, condQuery, atlasLabKnobs]
  );
  const ranked = useMemo(() => rankCandidates(atlas, objective, { includeExtrapolated }), [atlas, objective, includeExtrapolated]);

  const hash = useMemo(
    () =>
      modelHash([
        ...records.map((r) => `${r.id}:${r.status}`).sort(),
        includeReview,
        domain,
        lab.bandwidthScale,
        lab.kNeighbors,
        lab.excludeOutliers,
      ]),
    [records, includeReview, domain, lab]
  );

  const pickPair = (cell: AtlasCell) => {
    setCationText(cell.cation.label);
    setAnionText(cell.anion.label);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4 pt-5 pb-6">
      <header className="space-y-2.5">
        <section data-testid="studio-workbench-header" className="rounded-[8px] border border-ink-200/80 bg-white/90 px-4 py-3 backdrop-blur">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <span className="hidden h-9 w-1 rounded-full bg-brand-500 md:block" aria-hidden="true" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 className="text-lg font-semibold tracking-tight text-ink-950">Design Studio</h1>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-700">Prediction &amp; design</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-600">
                Estimate {spec.propertyLabel.toLowerCase()} for unmeasured ion pairs and rank candidates from curated evidence.
              </p>
            </div>
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 whitespace-nowrap rounded-[7px] border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-200 hover:text-brand-700">
              <input
                type="checkbox"
                checked={!includeReview}
                onChange={(e) => setIncludeReview(!e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-600"
              />
              official records only
            </label>
          </div>
        </section>

        <section
          aria-label="Model ribbon"
          data-testid="model-ribbon"
          className="flex gap-1.5 overflow-x-auto rounded-[8px] border border-ink-200/70 bg-ink-50/45 p-1.5 backdrop-blur"
        >
          <ModelRibbonStat label="usable points" value={dataset.points.length} />
          <ModelRibbonStat label="ion pairs" value={dataset.pairCount} />
          <ModelRibbonStat
            label="official / review"
            value={
              <>
                <span className="text-brand-700">{dataset.officialCount}</span>
                <span className="text-ink-300"> / </span>
                <span className="text-amber-700">{dataset.reviewCount}</span>
              </>
            }
            title="official / review"
          />
          <ModelRibbonStat label="papers" value={dataset.paperCount} />
          {dataset.tempRange && (
            <ModelRibbonStat label="temperature" value={`${fmtK(dataset.tempRange[0])} - ${fmtK(dataset.tempRange[1])}`} />
          )}
          {domain === "tribology" && (
            <ModelRibbonStat
              label="scope"
              value="nano-only"
              tone="brand"
              title={`Macroscopic friction is out of scope — nanoscale (AFM-class) records only. ${dataset.scaleExcludedCount} macroscale (or unscaled) record${dataset.scaleExcludedCount === 1 ? "" : "s"} excluded.`}
            />
          )}
          {domain === "tribology" && (
            <ModelRibbonStat
              label="h on file"
              value={dataset.filmPointCount}
              tone="violet"
              title="Records reporting interfacial film thickness — the Dataset-B pool"
            />
          )}
          {loo ? (
            <ModelRibbonStat
              label={domain === "tribology" ? "LOO A" : "LOO"}
              value={`×/÷ ${loo.foldError.toFixed(2)}`}
              title="Leave-one-out median fold error"
            />
          ) : (
            <span className="min-w-[16rem] shrink-0 rounded-[7px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
              calibration unavailable — outputs are cited analog lookups
            </span>
          )}
          {looB && (
            <ModelRibbonStat label="LOO B" value={`×/÷ ${looB.foldError.toFixed(2)}`} title="Film-thickness pathway leave-one-out fold error" />
          )}
          <span className="flex min-w-[7rem] shrink-0 items-end justify-start rounded-[7px] border border-ink-200/70 bg-white px-2.5 py-1.5 lg:justify-end">
            <span className="truncate font-mono text-[10px] text-ink-400" title="Deterministic hash of the records + settings feeding this model">
              model {hash}
            </span>
          </span>
        </section>
      </header>

      {domain === "tribology" && evaluationLabHref && (
        <section className="rounded-[8px] border border-ink-200/80 bg-white/90 px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="label-eyebrow text-brand-700">Teaching dataset</p>
              <h2 className="mt-0.5 text-base font-semibold tracking-tight text-ink-950">Model Evaluation Lab</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-600">
                Open a compact lab for train/test metrics and external validation, separate from the design workspace.
              </p>
            </div>
            <Link
              href={evaluationLabHref}
              className="inline-flex min-h-[34px] items-center justify-center rounded-[7px] border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-700 transition hover:border-brand-300 hover:bg-brand-100"
            >
              Open lab
            </Link>
          </div>
        </section>
      )}

      <PredictBench
        domain={domain}
        spec={spec}
        dataset={dataset}
        prediction={prediction}
        cationText={effCation}
        anionText={effAnion}
        cation={cation}
        anion={anion}
        cationOptions={cationOptions}
        anionOptions={anionOptions}
        tempK={tempK}
        substrate={substrate}
        species={species}
        conditions={condText}
        parsedConditions={tribCond}
        onCation={setCationText}
        onAnion={setAnionText}
        onTempK={setTempK}
        onSubstrate={setSubstrate}
        onSpecies={setSpecies}
        onConditions={(patch) => setCondText((prev) => ({ ...prev, ...patch }))}
      />

      <EvidenceLedger domain={domain} spec={spec} dataset={dataset} prediction={prediction} tempK={queryTempK} />

      <DesignExplorer
        spec={spec}
        atlas={atlas}
        ranked={ranked}
        objective={objective}
        includeExtrapolated={includeExtrapolated}
        constraints={constraints}
        modelHashValue={hash}
        labSummary={domain === "tribology" ? labSummary(lab) : null}
        onObjective={setObjective}
        onIncludeExtrapolated={setIncludeExtrapolated}
        onConstraints={setConstraints}
        onPickPair={pickPair}
      />

      {domain === "tribology" && (
        <ModelLab
          domain={domain}
          spec={spec}
          dataset={dataset}
          norm={norm}
          lab={lab}
          onLab={(patch) => setLab((prev) => ({ ...prev, ...patch }))}
          loo={loo}
        />
      )}

      <ModelCard spec={spec} dataset={dataset} loo={loo} looB={looB} lab={domain === "tribology" ? lab : undefined} />

      <p className="text-center text-xs text-ink-400">
        Predictions are ephemeral — recomputed from the curated records on every visit, never stored beside measurements.
      </p>
    </div>
  );
}
