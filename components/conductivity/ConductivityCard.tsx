"use client";

import { useId } from "react";
import {
  conductivityCoreCompleteness,
  type ConductivityRecord,
} from "@/lib/conductivity/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { FieldProvenance } from "@/lib/schema";
import { parseQuantity, type Quantity } from "@/lib/units";
import { MoleculeView } from "../MoleculeView";
import {
  ConditionChip,
  IonPill,
  ProvBadge,
  ionDisplayLabel,
  quantityLabel,
  quantityTitle,
  type ConditionItem,
  type UnitMode,
} from "../recordCardParts";

/** System-identity facets (see buildSystemFacets in RecordCard): the IL and the electrode surface. */
export function buildConductivitySystemFacets(record: ConductivityRecord, units: UnitMode): ConditionItem[] {
  const { core } = record;
  const prov = record.provenance ?? {};
  const il = core.ionicLiquid;
  const items: ConditionItem[] = [];
  if (il.cation) items.push({ label: "Cation", value: ionDisplayLabel(il.cation, "cation", units), prov: prov.cation, field: "cation" });
  if (il.anion) items.push({ label: "Anion", value: ionDisplayLabel(il.anion, "anion", units), prov: prov.anion, field: "anion" });
  if (core.surface) items.push({ label: "Surface", value: core.surface, prov: prov.surface, field: "surface" });
  return items;
}

/** Group-level condition items (see buildGroupConditionItems in RecordCard): per-card chips plus the measurement context. */
export function buildConductivityGroupConditions(record: ConductivityRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];
  if (core.surface) items.push({ label: "Surface", value: core.surface, prov: prov.surface, field: "surface" });
  if (e.method) items.push({ label: "Method", value: e.method, prov: prov.method, field: "method" });
  items.push(...buildConductivityConditions(record, units));
  return items;
}

export interface ConductivityPerformanceItem {
  label: string;
  symbol: string;
  value: string;
  title: string;
  field: string;
  quantity: Quantity;
  primary?: boolean;
}

/** Comparable output properties. Applied electrode potential remains a condition. */
export function buildConductivityPerformance(record: ConductivityRecord, units: UnitMode): ConductivityPerformanceItem[] {
  const { core, extended } = record;
  const items: ConductivityPerformanceItem[] = [];
  const add = (label: string, symbol: string, field: string, quantity: Quantity | null | undefined, primary = false) => {
    if (!quantity) return;
    items.push({
      label,
      symbol,
      field,
      quantity,
      primary,
      value: quantityLabel(quantity, units),
      title: quantityTitle(quantity, units),
    });
  };

  add("Ionic conductivity", "σ", "conductivity", core.conductivity, true);
  add("Capacitance", "C", "capacitance", core.capacitance);
  add("Electric field", "E", "electricField", core.electricField);
  add("Viscosity", "η", "viscosity", extended.viscosity);
  add("Electrochemical window", "ΔE", "electrochemicalWindow", core.electrochemicalWindow);
  add("Charge-transfer resistance", "Rct", "chargeTransferResistance", core.chargeTransferResistance);
  return items;
}

function legacyPressure(record: ConductivityRecord): Quantity | null {
  const entry = record.flexible.find((item) => /^(?:pressure|press\.?|压力|压强)$/i.test(item.key.trim()));
  if (!entry) return null;
  return parseQuantity(`${entry.value}${entry.unit ? ` ${entry.unit}` : ""}`, "pressure");
}

export function buildConductivityConditions(record: ConductivityRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];

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
  const pressure = e.pressure ?? legacyPressure(record);
  if (pressure) {
    items.push({
      label: "Pressure",
      value: quantityLabel(pressure, units),
      title: quantityTitle(pressure, units),
      prov: prov.pressure,
      field: "pressure",
    });
  }
  if (core.electrodePotential) {
    items.push({ label: "Potential", value: quantityLabel(core.electrodePotential, units), title: quantityTitle(core.electrodePotential, units), prov: prov.electrodePotential, field: "electrodePotential" });
  }
  if (e.potentialReference) {
    items.push({ label: "Reference", value: e.potentialReference, prov: prov.potentialReference, field: "potentialReference" });
  }
  if (e.waterContent) {
    items.push({ label: "Water", value: e.waterContent, title: "Water content", prov: prov.waterContent, field: "waterContent" });
  }
  if (e.concentration) {
    items.push({ label: "Conc.", value: e.concentration, title: "Concentration", prov: prov.concentration, field: "concentration" });
  }
  if (e.density) {
    items.push({ label: "Density", value: e.density, title: "Density", prov: prov.density, field: "density" });
  }
  if (e.cellConstant) {
    items.push({ label: "Cell k", value: e.cellConstant, title: "Conductivity-cell constant" });
  }
  for (const field of record.flexible) {
    if (/^(?:pressure|press\.?|压力|压强)$/i.test(field.key.trim())) continue;
    items.push({
      label: field.key,
      value: `${field.value}${field.unit ? ` ${field.unit}` : ""}`,
      title: field.note,
    });
  }
  return items;
}

/** Conductivity band on a log scale (0.01–10 S/m) — an at-a-glance read on ion transport. */
function sigmaBand(sigmaSI: number | null | undefined) {
  if (sigmaSI == null) return { label: "—", pct: 0 };
  const lo = Math.log10(0.01);
  const hi = Math.log10(10);
  const pct = Math.max(2, Math.min(100, ((Math.log10(Math.max(sigmaSI, 1e-6)) - lo) / (hi - lo)) * 100));
  if (sigmaSI >= 1) return { label: "high conductivity", pct };
  if (sigmaSI >= 0.1) return { label: "moderate", pct };
  return { label: "low conductivity", pct };
}

export function ConductivityCard({
  record,
  selected,
  onToggle,
  actions,
  units = "raw",
  domain = DEFAULT_DOMAIN,
}: {
  record: ConductivityRecord;
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
  const { missing } = conductivityCoreCompleteness(record);
  const svgId = useId().replace(/:/g, "");
  const conditions = buildConductivityConditions(record, units);
  const performance = buildConductivityPerformance(record, units);
  const showConfidence = record.status === "review" && typeof record.confidence === "number";
  const confidencePct = showConfidence ? Math.round((record.confidence as number) * 100) : null;

  return (
    <article
      className={`record-card-unified-text group relative grid overflow-hidden rounded-xl border bg-white transition duration-300 xl:grid-cols-[auto_minmax(0,0.78fr)_minmax(0,0.72fr)_minmax(0,1.45fr)] ${
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

      {/* ── electrochemical cell ── */}
      <section
        data-testid="cell-panel"
        className="flex min-w-0 items-start gap-2.5 border-b border-ink-100 px-3 py-3 xl:border-b-0 xl:border-l xl:border-ink-100"
      >
        <div className="grid w-10 shrink-0 place-items-center self-start rounded-lg border border-ink-100 bg-gradient-to-b from-ink-50 to-cyan-50/60 py-1">
          <ConductivityCellIllustration idPrefix={svgId} active={!!e.method} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="label-eyebrow">Surface</span>
              {record.provenance?.surface && (
                <ProvBadge p={record.provenance.surface} sourceId={record.sourceId} recordId={record.id} field="surface" value={core.surface} domain={domain} />
              )}
            </div>
            <div
              className={`line-clamp-2 text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${core.surface ? "text-ink-900" : "text-amber-600"}`}
              title={core.surface || "surface missing"}
            >
              {core.surface || "surface?"}
            </div>
          </div>
          <div className="min-w-0">
            <span className="label-eyebrow">Method</span>
            <div className="line-clamp-2 text-sm font-semibold leading-snug text-ink-900 [overflow-wrap:anywhere]" title={e.method || "—"}>
              {e.method || "—"}
            </div>
          </div>
          {e.method && (
            <span className="w-fit whitespace-nowrap rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
              {e.method === "EIS" ? "Impedance · EIS" : e.method}
            </span>
          )}
        </div>
      </section>

      {/* ── electrochemical performance + reported conditions ── */}
      <section className="flex min-w-0 flex-col gap-2.5 px-3 py-3 xl:border-l xl:border-ink-100">
        <div data-testid="electrochemical-performance" className="conductivity-performance-readout relative overflow-hidden rounded-xl bg-gradient-to-br from-ink-900 to-ink-800 px-3.5 py-3 text-white shadow-readout">
          <div className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-brand-400/25 blur-2xl" />
          <div className="relative mb-2 flex items-center justify-between gap-3">
            <span className="label-eyebrow text-white/70">Electrochemical performance</span>
            {showConfidence && <span className="whitespace-nowrap text-[10px] font-medium text-white/70">conf {confidencePct}%</span>}
          </div>
          {performance.length > 0 ? (
            <div className={`relative grid gap-1.5 ${performance.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
              {performance.map((item) => (
                <PerformanceTile
                  key={item.field}
                  item={item}
                  provenance={record.provenance?.[item.field]}
                  sourceId={record.sourceId}
                  recordId={record.id}
                  domain={domain}
                />
              ))}
            </div>
          ) : (
            <div className="relative rounded-lg border border-amber-200/25 bg-white/10 px-3 py-3 text-sm font-semibold text-amber-100">
              No verified performance value
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="label-eyebrow">Reported conditions</span>
            {units === "std" && (
              <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-700">
                standardized units
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {conditions.map((item) => (
              <ConditionChip key={`${item.label}-${item.value}`} item={item} sourceId={record.sourceId} recordId={record.id} domain={domain} />
            ))}
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

function PerformanceTile({
  item,
  provenance,
  sourceId,
  recordId,
  domain,
}: {
  item: ConductivityPerformanceItem;
  provenance?: FieldProvenance;
  sourceId?: string;
  recordId: string;
  domain: Domain;
}) {
  const band = item.field === "conductivity" ? sigmaBand(item.quantity.std) : null;
  return (
    <div
      data-testid={`performance-${item.field}`}
      className={`min-w-0 rounded-lg border px-2.5 py-2 ${
        item.primary ? "border-brand-300/35 bg-brand-400/15" : "border-white/10 bg-white/[0.07]"
      }`}
      title={item.title}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[9px] font-bold uppercase tracking-eyebrow text-white/60">
            {item.label} · {item.symbol}
          </div>
          <div className="mt-0.5 break-words font-mono text-[15px] font-semibold leading-tight text-white tnum">
            {item.value}
          </div>
        </div>
        {provenance && (
          <ProvBadge
            p={provenance}
            sourceId={sourceId}
            recordId={recordId}
            field={item.field}
            value={item.value}
            domain={domain}
          />
        )}
      </div>
      {band && (
        <div className="mt-2">
          <div className="mb-1 text-[9px] font-semibold text-white/65">{band.label}</div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-300"
              style={{ width: `${band.pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact two-electrode conductivity cell with ions between the plates. */
function ConductivityCellIllustration({ idPrefix, active }: { idPrefix: string; active: boolean }) {
  const glowId = `${idPrefix}-cell-glow`;
  return (
    <svg className="h-16 w-10 overflow-visible" viewBox="0 0 86 146" role="img" aria-label="conductivity cell">
      <defs>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(43 86) rotate(90) scale(40 26)">
          <stop stopColor="#f0feff" />
          <stop offset=".5" stopColor="#baf4f8" stopOpacity=".7" />
          <stop offset="1" stopColor="#6dd8e1" stopOpacity=".1" />
        </radialGradient>
      </defs>
      {/* electrolyte glow */}
      <rect x="16" y="46" width="54" height="78" rx="6" fill={`url(#${glowId})`} opacity=".9" />
      {/* electrodes */}
      <rect x="24" y="30" width="6" height="92" rx="2" fill="#445369" />
      <rect x="56" y="30" width="6" height="92" rx="2" fill="#445369" />
      {/* leads */}
      <path d="M27 30 V20 H43" stroke="#445369" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M59 30 V20 H43" stroke="#445369" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* migrating ions */}
      <g>
        {active && <animateTransform attributeName="transform" type="translate" values="-4 0;4 0;-4 0" dur="2.6s" repeatCount="indefinite" />}
        <circle cx="38" cy="66" r="4" fill="#22b8cf" />
        <circle cx="50" cy="86" r="4" fill="#2f9e6f" />
        <circle cx="40" cy="104" r="3.4" fill="#22b8cf" />
      </g>
      {/* cell base */}
      <path d="M16 120 H70 V124 Q70 130 64 130 H22 Q16 130 16 124 Z" fill="#283449" />
    </svg>
  );
}
