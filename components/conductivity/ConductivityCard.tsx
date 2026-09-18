"use client";

import { useId } from "react";
import { ConductivityDependenciesPanel, ConductivityPerformanceFigurePanel } from "./ConductivityFigureInsights";
import { deriveConductivityDependencies } from "@/lib/conductivity/dependencies";
import {
  conductivityCoreCompleteness,
  type ConductivityPerformanceFigure,
  type ConductivityRecord,
} from "@/lib/conductivity/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { FieldProvenance } from "@/lib/schema";
import { parseQuantity, type Quantity } from "@/lib/units";
import { describeIon } from "@/lib/predict/descriptors";
import { resolveIonStructure, type IonKind } from "@/lib/ionStructures";
import { buildConductivityCellModel, isElectrodeFlexibleField, type ConductivityCellModel } from "@/lib/conductivity/electrodes";
import { MoleculeView } from "../MoleculeView";
import {
  ConditionChip,
  IonPill,
  ProvBadge,
  ionDisplayLabel,
  openRecordEvidence,
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

/** Prefer extracted curve metadata, with a provenance-only fallback for older records. */
export function buildConductivityPerformanceFigure(
  record: ConductivityRecord,
): ConductivityPerformanceFigure | null {
  if (record.extended.performanceFigure) {
    const provenance = record.provenance?.performanceFigure;
    return {
      ...record.extended.performanceFigure,
      page: provenance?.page ?? record.extended.performanceFigure.page,
      figureBox: provenance?.figureBox ?? record.extended.performanceFigure.figureBox,
    };
  }
  const targets = [
    ["conductivity", "conductivity curve"],
    ["capacitance", "capacitance curve"],
    ["viscosity", "viscosity curve"],
    ["electrochemicalWindow", "CV / LSV"],
    ["chargeTransferResistance", "EIS Nyquist"],
    ["electricField", "field-dependent curve"],
  ] as const;
  for (const [field, curveType] of targets) {
    const provenance = record.provenance?.[field];
    if (!provenance?.figure || provenance.page == null) continue;
    return {
      figure: provenance.figure,
      page: provenance.page,
      curveType,
      primaryField: field,
      figureBox: provenance.figureBox,
      seriesLabel: `${record.core.ionicLiquid.cation}${record.core.ionicLiquid.anion}`,
    };
  }
  return null;
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
    if (isElectrodeFlexibleField(field)) continue;
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
  comparisonRecords = [],
}: {
  record: ConductivityRecord;
  selected?: boolean;
  onToggle?: (id: string) => void;
  actions?: React.ReactNode;
  units?: UnitMode;
  domain?: Domain;
  /** Same-paper records used only for conservative, one-variable dependency comparisons. */
  comparisonRecords?: ConductivityRecord[];
}) {
  const { core, extended: e } = record;
  const il = core.ionicLiquid;
  const { missing } = conductivityCoreCompleteness(record);
  const svgId = useId().replace(/:/g, "");
  const conditions = buildConductivityConditions(record, units);
  const performance = buildConductivityPerformance(record, units);
  const performanceFigure = buildConductivityPerformanceFigure(record);
  const dependencies = deriveConductivityDependencies(record, comparisonRecords.length ? comparisonRecords : [record]);
  const cell = buildConductivityCellModel(record);
  const showConfidence = record.status === "review" && typeof record.confidence === "number";
  const confidencePct = showConfidence ? Math.round((record.confidence as number) * 100) : null;

  return (
    <article
      className={`record-card-unified-text group relative grid overflow-hidden rounded-xl border bg-white transition duration-300 xl:grid-cols-[72px_minmax(0,1.18fr)_minmax(0,1.62fr)] ${
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

      {/* ── compact identity + cell column ── */}
      <div className="min-w-0 divide-y divide-ink-100 xl:border-l xl:border-ink-100">
      <section data-testid="ionic-liquid-panel" className="flex min-w-0 flex-col gap-2 px-3 py-3">
        <span className="label-eyebrow">Ionic liquid</span>
        <div data-testid="ion-row" className="grid min-w-0 grid-cols-2 gap-2">
          <ConductivityIonCard kind="cation" rawLabel={il.cation || "—"} smiles={il.cationSmiles} units={units} />
          <ConductivityIonCard kind="anion" rawLabel={il.anion || "—"} smiles={il.anionSmiles} units={units} />
        </div>
      </section>

      {/* ── electrochemical cell ── */}
      <section
        data-testid="cell-panel"
        className="flex min-w-0 flex-col gap-2.5 px-3 py-3"
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="label-eyebrow">Electrochemical cell</span>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${
            cell.configuration === "three-electrode"
              ? "border-violet-200 bg-violet-50 text-violet-700"
              : cell.configuration === "two-electrode"
                ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                : cell.applicability === "not-applicable"
                  ? "border-slate-200 bg-slate-50 text-slate-600"
                : "border-ink-200 bg-ink-50 text-ink-500"
          }`}>
            {cell.configuration === "three-electrode"
              ? "3-electrode"
              : cell.configuration === "two-electrode"
                ? "2-electrode"
                : cell.applicability === "not-applicable"
                  ? "not applicable"
                  : "to verify"}
          </span>
        </div>
        <ConductivityCellIllustration idPrefix={svgId} active={!!e.method} cell={cell} />
        <ElectrodeMaterialList cell={cell} />
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 border-t border-ink-100 pt-2">
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
            <span className="col-span-2 w-fit whitespace-nowrap rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
              {e.method === "EIS" ? "Impedance · EIS" : e.method}
            </span>
          )}
        </div>
      </section>
      </div>

      {/* ── electrochemical performance + reported conditions ── */}
      <section className="flex min-w-0 flex-col gap-2.5 px-3 py-3 xl:border-l xl:border-ink-100">
        {performanceFigure && (
          <ConductivityPerformanceFigurePanel
            figure={performanceFigure}
            record={record}
            domain={domain}
          />
        )}
        <ConductivityDependenciesPanel dependencies={dependencies} />
        <details open={!performanceFigure} data-testid="other-performance-values" className="rounded-lg border border-ink-100">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium">All electrochemical performance values ({performance.length})</summary>
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

        </details>
        <details open={!performanceFigure}>
          <summary className="mb-1.5 flex cursor-pointer items-center justify-between gap-2">
            <span className="label-eyebrow">Reported conditions ({conditions.length}) ▾</span>
            {units === "std" && (
              <span className="rounded-full border border-brand-100 bg-brand-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-700">
                standardized units
              </span>
            )}
          </summary>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {conditions.map((item) => (
              <ConditionChip key={`${item.label}-${item.value}`} item={item} sourceId={record.sourceId} recordId={record.id} domain={domain} />
            ))}
          </div>
        </details>
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


function ConductivityIonCard({
  kind,
  rawLabel,
  smiles,
  units,
}: {
  kind: IonKind;
  rawLabel: string;
  smiles?: string;
  units: UnitMode;
}) {
  const isCation = kind === "cation";
  const resolved = resolveIonStructure(rawLabel, kind);
  const resolvedSmiles = resolved?.smiles || smiles?.trim();
  const descriptor = describeIon(rawLabel, kind);
  return (
    <div
      data-testid={`ion-card-${kind}`}
      className={`min-w-0 overflow-hidden rounded-xl border ${
        isCation ? "border-cyan-100 bg-gradient-to-b from-cyan-50/65 to-white" : "border-emerald-100 bg-gradient-to-b from-emerald-50/65 to-white"
      }`}
    >
      <IonPill kind={kind} label={isCation ? "Cation" : "Anion"} value={rawLabel} units={units} chargePosition="end" embedded />
      <MoleculeView
        smiles={smiles}
        ionLabel={rawLabel}
        kind={kind}
        label={isCation ? "Cation" : "Anion"}
        width={isCation ? 236 : 320}
        height={isCation ? 88 : 116}
        embedded
      />
      <div className={`border-t px-2 py-2 ${isCation ? "border-cyan-100/80" : "border-emerald-100/80"}`}>
        <div className="label-eyebrow mb-1">SMILES</div>
        <div className="truncate font-mono text-[9px] leading-relaxed text-ink-600" title={resolvedSmiles || "No verified SMILES"}>
          {resolvedSmiles || "Not verified"}
        </div>
        {descriptor.resolved && (
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-[9px]">
            <IonDescriptor value={descriptor.formula} label="Formula" />
            <IonDescriptor value={descriptor.mw.toFixed(2)} label="Mᵣ" />
            <IonDescriptor value={descriptor.family} label="Family" />
          </div>
        )}
      </div>
    </div>
  );
}

function IonDescriptor({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-white/80 px-1.5 py-1">
      <div className="font-bold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 truncate font-mono font-semibold text-ink-700" title={value}>{value}</div>
    </div>
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

/** Compact cell schematic that reflects the paper's reported electrode configuration. */
function ConductivityCellIllustration({ idPrefix, active, cell }: { idPrefix: string; active: boolean; cell: ConductivityCellModel }) {
  const glowId = `${idPrefix}-cell-glow`;
  const three = cell.configuration === "three-electrode";
  const unknown = cell.configuration === "unknown";
  return (
    <svg data-testid="electrode-cell-diagram" className="h-[92px] w-full overflow-visible rounded-lg border border-ink-100 bg-gradient-to-b from-white to-cyan-50/40" viewBox="0 0 180 104" role="img" aria-label={`${cell.configuration} electrochemical cell`}>
      <defs>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(90 62) rotate(90) scale(34 58)">
          <stop stopColor="#f0feff" />
          <stop offset=".5" stopColor="#baf4f8" stopOpacity=".7" />
          <stop offset="1" stopColor="#6dd8e1" stopOpacity=".1" />
        </radialGradient>
      </defs>
      <rect x="20" y="28" width="140" height="62" rx="9" fill={`url(#${glowId})`} opacity=".9" />
      <path d="M20 84 H160 V91 Q160 96 154 96 H26 Q20 96 20 91 Z" fill="#283449" />
      {three ? (
        <>
          <ElectrodeGlyph x={48} sign="WE" role="working" />
          <ElectrodeGlyph x={90} sign="RE" role="reference" reference />
          <ElectrodeGlyph x={132} sign="CE" role="counter" />
        </>
      ) : cell.applicability === "not-applicable" ? (
        <>
          <path d="M58 39 H122 L116 75 Q114 84 104 84 H76 Q66 84 64 75 Z" fill="none" stroke="#64748b" strokeWidth="2.5" />
          <path d="M72 57 C81 49 99 65 108 56" fill="none" stroke="#22b8cf" strokeWidth="3" strokeLinecap="round" />
          <text x="90" y="22" textAnchor="middle" fontSize="9" fontWeight="800" fill="#64748b">BULK PROPERTY</text>
        </>
      ) : (
        <>
          <ElectrodeGlyph x={58} sign={unknown ? "—" : "+"} role={unknown ? "E1" : "positive"} />
          <ElectrodeGlyph x={122} sign={unknown ? "—" : "−"} role={unknown ? "E2" : "negative"} />
        </>
      )}
      {/* migrating ions */}
      <g>
        {active && <animateTransform attributeName="transform" type="translate" values="-4 0;4 0;-4 0" dur="2.6s" repeatCount="indefinite" />}
        <circle cx="78" cy="57" r="3.5" fill="#22b8cf" />
        <circle cx="104" cy="67" r="3.5" fill="#2f9e6f" />
        <circle cx="87" cy="76" r="3" fill="#22b8cf" />
      </g>
    </svg>
  );
}

function ElectrodeGlyph({ x, sign, role, reference = false }: { x: number; sign: string; role: string; reference?: boolean }) {
  return (
    <g>
      <circle cx={x} cy="15" r="9" fill={reference ? "#f5f3ff" : "#ecfeff"} stroke={reference ? "#8b5cf6" : "#0891b2"} />
      <text x={x} y="18.5" textAnchor="middle" fontSize={sign.length > 1 ? "7" : "11"} fontWeight="800" fill={reference ? "#7c3aed" : "#0e7490"}>{sign}</text>
      <path d={`M${x} 24 V33`} stroke="#445369" strokeWidth="2" />
      <rect x={x - 4} y="33" width="8" height={reference ? 40 : 48} rx="2.5" fill={reference ? "#8b5cf6" : "#445369"} />
      <text x={x} y="86" textAnchor="middle" fontSize="7" fontWeight="800" fill="#475569">{role}</text>
    </g>
  );
}

function ElectrodeMaterialList({ cell }: { cell: ConductivityCellModel }) {
  const items = cell.configuration === "three-electrode"
    ? [
        { sign: "WE", role: "WE", material: cell.workingElectrode },
        { sign: "CE", role: "CE", material: cell.counterElectrode },
        { sign: "RE", role: "RE", material: cell.referenceElectrode },
      ]
    : cell.configuration === "two-electrode"
      ? [
          { sign: "+", role: "Positive", material: cell.positiveElectrode },
          { sign: "−", role: "Negative", material: cell.negativeElectrode },
        ]
      : [];
  return (
    <div data-testid="electrode-material-list" className="w-full space-y-1">
      {cell.setupLabel && <div className="line-clamp-2 text-[10px] font-medium text-ink-500" title={cell.setupLabel}>{cell.setupLabel}</div>}
      {items.length ? items.map((item) => (
        <div key={item.role} className="grid grid-cols-[20px_28px_minmax(0,1fr)] items-center gap-1 text-[10px]">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-cyan-200 bg-cyan-50 font-bold text-cyan-700">{item.sign}</span>
          <span className="font-mono font-bold text-ink-500">{item.role}</span>
          <span className={`truncate font-semibold ${item.material ? "text-ink-800" : "text-ink-400"}`} title={item.material || "Not reported in paper"}>
            {item.material || "not reported"}
          </span>
        </div>
      )) : cell.applicability === "not-applicable" ? (
        <div className="text-[10px] leading-snug text-ink-500">Bulk/non-cell measurement; no 2E/3E assignment required.</div>
      ) : (
        <div className="text-[10px] leading-snug text-amber-600">Configuration awaiting source verification.</div>
      )}
    </div>
  );
}
