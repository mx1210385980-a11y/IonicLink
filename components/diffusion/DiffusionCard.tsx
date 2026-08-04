"use client";

import { useId } from "react";
import {
  diffusionCoreCompleteness,
  formatD,
  type DiffusionRecord,
} from "@/lib/diffusion/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import { formatStd } from "@/lib/units";
import { MoleculeView } from "../MoleculeView";
import {
  ConditionChip,
  IonPill,
  MissingChip,
  ProvBadge,
  ionDisplayLabel,
  quantityLabel,
  quantityTitle,
  type ConditionItem,
  type UnitMode,
} from "../recordCardParts";

/** System-identity facets (see buildSystemFacets in RecordCard): the IL and the diffusing species. */
export function buildDiffusionSystemFacets(record: DiffusionRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const il = core.ionicLiquid;
  const items: ConditionItem[] = [];
  if (il.cation) items.push({ label: "Cation", value: ionDisplayLabel(il.cation, "cation", units), prov: prov.cation, field: "cation" });
  if (il.anion) items.push({ label: "Anion", value: ionDisplayLabel(il.anion, "anion", units), prov: prov.anion, field: "anion" });
  if (e.systemName) items.push({ label: "System", value: e.systemName, prov: prov.systemName, field: "systemName" });
  if (core.species) items.push({ label: "Species", value: core.species, prov: prov.species, field: "species" });
  return items;
}

/** Group-level condition items (see buildGroupConditionItems in RecordCard): per-card chips plus the measurement context. */
function formatMethod(method?: string): string {
  const trimmed = method?.trim();
  return !trimmed || trimmed === "—" ? "Experiment" : trimmed;
}

export function buildDiffusionGroupConditions(record: DiffusionRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];
  if (e.systemName) items.push({ label: "System", value: e.systemName, prov: prov.systemName, field: "systemName" });
  if (core.species) items.push({ label: "Species", value: core.species });
  const methodValue = formatMethod(e.method);
  if (methodValue) items.push({ label: "Method", value: methodValue, prov: prov.method, field: "method" });
  if (e.nucleus) items.push({ label: "Nucleus", value: e.nucleus, prov: prov.nucleus, field: "nucleus" });
  items.push(...buildDiffusionConditions(record, units));
  return items;
}

function buildDiffusionConditions(record: DiffusionRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];

  // Show species in the right-side conditions (with cation/anion indicator)
  if (core.species) {
    const isCation = /cation|\+$/i.test(core.species);
    const isAnion = /anion|-$/i.test(core.species);
    const kind = isCation ? "Cation" : isAnion ? "Anion" : undefined;
    // Show only the ion kind label (Cation / Anion) in the condition chips
    if (kind) items.push({ label: "Species", value: kind, prov: prov.species, field: "species" });
    else items.push({ label: "Species", value: core.species, prov: prov.species, field: "species" });
  }

  if (core.temperature) {
    items.push({
      label: "Temp",
      value: quantityLabel(core.temperature, units),
      title: quantityTitle(core.temperature, units),
      tone: "accent",
      prov: prov.temperature,
      field: "temperature",
    });
  }
  if (e.viscosity) {
    items.push({
      label: "Viscosity",
      value: quantityLabel(e.viscosity, units),
      title: quantityTitle(e.viscosity, units) + " · Stokes–Einstein context",
      prov: prov.viscosity,
      field: "viscosity",
    });
  }
  if (e.waterContent) {
    items.push({ label: "Water", value: e.waterContent, title: "Water content", prov: prov.waterContent, field: "waterContent" });
  }
  if (e.concentration) {
    items.push({ label: "Conc.", value: e.concentration, title: "Concentration", prov: prov.concentration, field: "concentration" });
  }
  if (e.surface) {
    items.push({ label: "Surface", value: e.surface, title: "Electrode surface (electrochemical D)", prov: prov.surface, field: "surface" });
  }
  return items;
}

/** Diffusion band on a log scale (10⁻¹³ – 10⁻⁹ m²/s) — at-a-glance ion mobility. */
function diffusionBand(dSI: number | null | undefined) {
  if (dSI == null) return { label: "—", pct: 0 };
  const lo = -13;
  const hi = -9;
  const pct = Math.max(2, Math.min(100, ((Math.log10(Math.max(dSI, 1e-15)) - lo) / (hi - lo)) * 100));
  if (dSI >= 1e-10) return { label: "fast diffusion", pct };
  if (dSI >= 1e-12) return { label: "moderate", pct };
  return { label: "slow diffusion", pct };
}

export function DiffusionCard({
  record,
  selected,
  onToggle,
  actions,
  units = "raw",
  domain = DEFAULT_DOMAIN,
}: {
  record: DiffusionRecord;
  selected?: boolean;
  onToggle?: (id: string) => void;
  actions?: React.ReactNode;
  units?: UnitMode;
  domain?: Domain;
}) {
  const { core, extended: e } = record;
  const il = core.ionicLiquid;
  const cationLabel = ionDisplayLabel(il.cation || "—", "cation", units);
  const anionLabel = ionDisplayLabel(il.anion || "—", "anion", units);
  const { missing } = diffusionCoreCompleteness(record);
  const svgId = useId().replace(/:/g, "");
  const methodValue = formatMethod(e.method);
  const conditions = buildDiffusionConditions(record, units);
  const showConfidence = record.status === "review" && typeof record.confidence === "number";
  const confidencePct = showConfidence ? Math.round((record.confidence as number) * 100) : null;
  const band = diffusionBand(core.diffusion?.std);
  const dValue = core.diffusion ? quantityLabel(core.diffusion, units) : formatD(core.diffusion);
  const isCationSpecies = /cation|\+$/i.test(core.species);
  const isAnionSpecies = /anion|-$/i.test(core.species);

  return (
    <article
      className={`record-card-unified-text group relative grid overflow-hidden rounded-xl border bg-white transition duration-300 xl:grid-cols-[auto_minmax(0,0.72fr)_minmax(0,0.95fr)_minmax(0,1.3fr)] ${
        selected
          ? "border-brand-300 shadow-card ring-1 ring-brand-200"
          : "border-ink-200/80 shadow-sm hover:-translate-y-px hover:border-brand-200 hover:shadow-card"
      }`}
    >
      {selected && <span className="absolute inset-y-0 left-0 z-10 w-[3px] bg-brand-500" />}

      {/* ── rail: select / id / status ── */}
      <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/40 px-3 py-2 xl:flex-col xl:items-start xl:gap-2 xl:border-b-0 xl:border-r xl:py-3">
        {onToggle && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggle(record.id)}
            className="h-4 w-4 cursor-pointer rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            aria-label={`Select ${record.id}`}
          />
        )}
        <span className="font-mono text-xs font-semibold tracking-tight text-ink-400">{record.id}</span>
        <span className={`status-mini whitespace-nowrap ${record.status === "review" ? "status-mini-review" : "status-mini-official"}`}>
          {record.status === "official" ? "checked" : record.status}
        </span>
      </div>

      {/* ── ionic identity ── */}
      <section data-testid="ionic-liquid-panel" className="flex min-w-0 flex-col gap-2 border-b border-ink-100 px-3 py-3 xl:border-b-0 xl:border-l xl:border-ink-100">
        <span className="label-eyebrow">Ionic liquid</span>
        <div data-testid="ion-row" className="grid min-w-0 grid-cols-2 gap-1.5">
          <IonPill kind="cation" label="Cation" value={il.cation || "—"} units={units} />
          <IonPill kind="anion" label="Anion" value={il.anion || "—"} units={units} />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 2xl:grid-cols-2">
          <MoleculeView smiles={il.cationSmiles} ionLabel={cationLabel} kind="cation" label="Cation" width={236} height={88} />
          <MoleculeView smiles={il.anionSmiles} ionLabel={anionLabel} kind="anion" label="Anion" width={320} height={116} />
        </div>
      </section>

      {/* ── confined system summary ── */}
      <section
        data-testid="confined-system-panel"
        className="flex min-w-0 items-start gap-4 border-b border-ink-100 px-3 py-3 xl:border-b-0 xl:border-l xl:border-ink-100"
      >
        <div className="grid h-24 w-20 shrink-0 place-items-center rounded-2xl border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 p-3">
          <DiffusionIllustration idPrefix={svgId} active={!!e.method} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-ink-100 bg-white">
            <div className="rounded-t-2xl border-b border-ink-100 bg-gradient-to-br from-white to-cyan-100/40 px-3 py-2">
              <p className="label-eyebrow">Confined system</p>
              <p className="mt-1 text-[13px] font-semibold text-ink-900">{e.systemName || "—"}</p>
              {record.provenance?.systemName && (
                <div className="mt-2">
                  <ProvBadge
                    p={record.provenance.systemName}
                    sourceId={record.sourceId}
                    recordId={record.id}
                    field="systemName"
                    value={e.systemName}
                    domain={domain}
                  />
                </div>
              )}
            </div>
            <div className="space-y-0.5 px-3 py-1 text-[12px] text-ink-900">
              <div className="border-b border-ink-100/70 py-2">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">Material</span>
                <span className="mt-1 block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900">{e.material || "—"}</span>
              </div>
              <div className="border-b border-ink-100/70 py-2">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">Geometry</span>
                <span className="mt-1 block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900">{e.geometry || "—"}</span>
              </div>
              <div className="border-b border-ink-100/70 py-2">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">Functional groups</span>
                <span className="mt-1 block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900">{e.functionalGroups || "—"}</span>
              </div>
              <div className="border-b border-ink-100/70 py-2">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">Scale value</span>
                <span className="mt-1 block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900">{e.poreSize ? quantityLabel(e.poreSize, units) : "—"}</span>
              </div>
              <div className="py-2">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">Polarizable</span>
                <span className="mt-1 block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900">{e.polarizable || "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── result: D readout ── */}
      <section className="flex min-w-0 flex-col gap-2.5 px-3 py-3 xl:border-l xl:border-ink-100">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-ink-900 to-ink-800 px-3.5 py-2.5 text-white shadow-readout diffusion-readout" style={{ color: "white" }}>
          <div className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-brand-400/25 blur-2xl" />
          <div className="relative flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="label-eyebrow" style={{ color: "white" }}>Self-diffusion · D</div>
              <div className="mt-0.5 font-mono text-[1.55rem] font-semibold leading-none tnum [overflow-wrap:anywhere]" style={{ color: "white" }}>
                {dValue}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 pb-1 text-right">
              {core.diffusion != null && (
                <span className="whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90">{band.label}</span>
              )}
              {showConfidence && <span className="whitespace-nowrap text-[10px] font-medium text-white/70">conf {confidencePct}%</span>}
              {record.provenance?.diffusion && (
                <ProvBadge p={record.provenance.diffusion} sourceId={record.sourceId} recordId={record.id} field="diffusion" value={dValue} domain={domain} />
              )}
            </div>
          </div>
          {/* diffusion magnitude meter (log 10⁻¹³ – 10⁻⁹ m²/s) */}
          <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-400 to-brand-300 transition-[width] duration-500"
              style={{ width: `${band.pct}%` }}
            />
          </div>
          {core.diffusion?.std != null && (
            <div className="mt-2 truncate text-[10px] font-medium" style={{ color: "white" }} title={`standardized: ${formatStd(core.diffusion.std, "m²/s")}`}>
              {units === "std"
                ? "as reported · " + (core.diffusion.raw || "—")
                : "standardized · " + formatStd(core.diffusion.std, "m²/s")}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5">
            <span className="label-eyebrow">{units === "std" ? "Standardized Conditions" : "Reported Conditions"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {conditions.map((item) => (
              <ConditionChip key={`${item.label}-${item.value}`} item={item} sourceId={record.sourceId} recordId={record.id} domain={domain} />
            ))}
            {!core.temperature && <MissingChip label="Temp" />}
          </div>
        </div>
      </section>

      {/* ── actions footer ── */}
      {actions && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-ink-100 bg-ink-50/30 px-3 py-2 xl:col-span-4">
          {missing.length > 0 && (
            <span className="text-[11px] font-medium text-amber-600">missing: {missing.join(", ")}</span>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>
        </div>
      )}
    </article>
  );
}

/** Two ions random-walking apart — the PFG-NMR displacement picture. */
function DiffusionIllustration({ idPrefix, active }: { idPrefix: string; active: boolean }) {
  const glowId = `${idPrefix}-diff-glow`;
  return (
    <svg className="h-16 w-10 overflow-visible mx-auto" viewBox="0 0 86 146" role="img" aria-label="diffusing ions">
      <defs>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(43 80) rotate(90) scale(48 30)">
          <stop stopColor="#f0feff" />
          <stop offset=".5" stopColor="#baf4f8" stopOpacity=".7" />
          <stop offset="1" stopColor="#6dd8e1" stopOpacity=".1" />
        </radialGradient>
      </defs>
      {/* liquid volume */}
      <rect x="14" y="30" width="58" height="100" rx="10" fill={`url(#${glowId})`} opacity=".95" />
      <rect x="14" y="30" width="58" height="100" rx="10" fill="none" stroke="#445369" strokeWidth="2" opacity=".5" />
      {/* random-walk traces */}
      <path d="M28 56 l8 -6 l6 8 l9 -4" stroke="#22b8cf" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".55" strokeDasharray="2 3" />
      <path d="M56 108 l-7 5 l-7 -6 l-9 5" stroke="#2f9e6f" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".55" strokeDasharray="2 3" />
      {/* ions */}
      <g>
        {active && <animateTransform attributeName="transform" type="translate" values="0 0;5 -4;0 0" dur="2.6s" repeatCount="indefinite" />}
        <circle cx="51" cy="54" r="5" fill="#22b8cf" />
        <text x="51" y="57" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff">+</text>
      </g>
      <g>
        {active && <animateTransform attributeName="transform" type="translate" values="0 0;-5 4;0 0" dur="2.6s" repeatCount="indefinite" />}
        <circle cx="33" cy="112" r="5" fill="#2f9e6f" />
        <text x="33" y="115" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff">−</text>
      </g>
      {/* gradient coil hint (PFG) */}
      <path d="M18 138 h50" stroke="#283449" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
