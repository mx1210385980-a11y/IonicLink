"use client";

import { useId } from "react";
import { coreCompleteness, formatCof, type IonicRecord } from "@/lib/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import { MoleculeView } from "./MoleculeView";
import {
  ConditionChip,
  IonPill,
  MissingChip,
  ionDisplayLabel,
  openRecordEvidence,
  quantityLabel,
  quantityRange,
  quantityTitle,
  type ConditionItem,
  type UnitMode,
} from "./recordCardParts";

export type { UnitMode };

export function buildConditionItems(record: IonicRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];

  if (core.load) {
    const range = quantityRange(core.load, units);
    items.push({
      label: "Load",
      value: quantityLabel(core.load, units),
      title: quantityTitle(core.load, units),
      tone: "accent",
      variant: range ? "range" : undefined,
      range: range ?? undefined,
      prov: prov.load,
      field: "load",
    });
  }
  if (core.temperature) {
    items.push({
      label: "Temp",
      value: quantityLabel(core.temperature, units),
      title: quantityTitle(core.temperature, units),
      prov: prov.temperature,
      field: "temperature",
    });
  }
  if (e.velocity) {
    items.push({
      label: "Velocity",
      value: quantityLabel(e.velocity, units),
      title:
        (e.velocitySource === "derived"
          ? `Derived: v = 2 x ${e.afm?.scanRate ?? "scan rate"} x ${e.afm?.scanSize ?? "scan size"} · `
          : "Sliding velocity (reported) · ") + quantityTitle(e.velocity, units),
      tone: e.velocitySource === "derived" ? "violet" : "accent",
      prov: prov.velocity,
      field: "velocity",
    });
  }
  if (e.potential) {
    items.push({
      label: "Potential",
      value: quantityLabel(e.potential, units),
      title: quantityTitle(e.potential, units),
      tone: "accent",
      prov: prov.potential,
      field: "potential",
    });
  }
  // Substrate roughness (Rq) is shown inline under the substrate in the
  // tribosystem zone — intentionally NOT duplicated as a condition chip here.
  if (e.additives) {
    items.push({ label: "Additives", value: e.additives, title: "Additives", tone: "violet", prov: prov.additives, field: "additives", fullWidth: true });
  }

  return items;
}

/**
 * Condition items for group-level (sweep) comparison: the per-card condition
 * chips plus the tribosystem context (substrate, probe, method) and the AFM
 * acquisition params, each wired to its provenance. A source group's
 * shared-conditions strip uses these to show a shared value ONCE, carrying the
 * group's single evidence link — extractors typically cite a constant
 * condition on only one record of a sweep.
 */
export function buildGroupConditionItems(record: IonicRecord, units: UnitMode): ConditionItem[] {
  const { core, extended: e } = record;
  const prov = record.provenance ?? {};
  const items: ConditionItem[] = [];

  if (core.substrate) items.push({ label: "Substrate", value: core.substrate, prov: prov.substrate, field: "substrate" });
  const probeLabel = [e.probe, e.probeType].filter(Boolean).join(" · ");
  if (probeLabel) items.push({ label: "Probe", value: probeLabel, prov: prov.probe, field: "probe" });
  if (e.method) items.push({ label: "Method", value: e.method });
  items.push(...buildConditionItems(record, units));
  if (e.roughness) {
    items.push({
      label: "Roughness",
      value: quantityLabel(e.roughness, units),
      title: quantityTitle(e.roughness, units),
      prov: prov.roughness,
      field: "roughness",
    });
  }
  if (e.afm?.scanRate) items.push({ label: "Scan rate", value: e.afm.scanRate, prov: prov.scanRate, field: "scanRate" });
  if (e.afm?.scanSize) items.push({ label: "Scan size", value: e.afm.scanSize, prov: prov.scanSize, field: "scanSize" });
  return items;
}

/**
 * The facets that define one tribological SYSTEM: the ionic liquid and the
 * tribopair surface. A paper comparing systems (two substrates, three anions)
 * splits into one sub-group per distinct combination; operating conditions
 * (load, potential, additives…) are swept WITHIN a system and never split.
 */
export function buildSystemFacets(record: IonicRecord, units: UnitMode): ConditionItem[] {
  const { core } = record;
  const prov = record.provenance ?? {};
  const il = core.ionicLiquid;
  const items: ConditionItem[] = [];
  if (il.cation) items.push({ label: "Cation", value: ionDisplayLabel(il.cation, "cation", units), prov: prov.cation, field: "cation" });
  if (il.anion) items.push({ label: "Anion", value: ionDisplayLabel(il.anion, "anion", units), prov: prov.anion, field: "anion" });
  if (core.substrate) items.push({ label: "Substrate", value: core.substrate, prov: prov.substrate, field: "substrate" });
  return items;
}

type TribopairDisplay = {
  mode: "nano" | "macro" | "unknown";
  pattern: "afm" | "ball-disk" | "pin-disk" | "three-ball-plate" | "ball-pins" | "block-ring" | "counterface-specimen";
  primaryRole: string;
  secondaryRole: string;
  primaryLabel: string;
  primaryDetails: string;
};

function normalizedContactText(record: IonicRecord): string {
  const { core, extended: e } = record;
  return [e.scale, e.method, e.probe, e.probeType, core.substrate]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[‐‑‒–—-]+/g, "_")
    .replace(/[^a-z0-9µμ]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function macroPattern(record: IonicRecord): TribopairDisplay["pattern"] {
  const text = normalizedContactText(record);
  if (text.includes("3_ball_on_plate") || text.includes("three_ball_on_plate") || text.includes("3_ball_plate")) return "three-ball-plate";
  if (text.includes("ball_on_3_pins") || text.includes("ball_on_three_pins") || text.includes("ball_3_pins")) return "ball-pins";
  if (text.includes("pin_on_disk") || text.includes("pin_on_disc") || text.includes("pin_disk")) return "pin-disk";
  if (text.includes("block_on_ring") || text.includes("block_ring")) return "block-ring";
  if (text.includes("ball_on") || text.includes("ball_disk") || text.includes("ball_disc") || text.includes("ball")) return "ball-disk";
  return "counterface-specimen";
}

function macroRoles(pattern: TribopairDisplay["pattern"]): Pick<TribopairDisplay, "primaryRole" | "secondaryRole"> {
  if (pattern === "three-ball-plate") return { primaryRole: "3-ball", secondaryRole: "Plate" };
  if (pattern === "ball-pins") return { primaryRole: "Ball", secondaryRole: "3 pins" };
  if (pattern === "pin-disk") return { primaryRole: "Pin", secondaryRole: "Disk" };
  if (pattern === "block-ring") return { primaryRole: "Block", secondaryRole: "Ring" };
  if (pattern === "ball-disk") return { primaryRole: "Ball", secondaryRole: "Disk" };
  return { primaryRole: "Counterface", secondaryRole: "Specimen" };
}

function tribopairDisplay(record: IonicRecord): TribopairDisplay {
  const { core, extended: e } = record;
  if (e.scale === "macro") {
    const pattern = macroPattern(record);
    const roles = macroRoles(pattern);
    return {
      mode: "macro",
      pattern,
      ...roles,
      primaryLabel: e.probe || "—",
      primaryDetails: [e.probeType, e.method].filter(Boolean).join(" · "),
    };
  }

  return {
    mode: e.scale === "nano" ? "nano" : "unknown",
    pattern: "afm",
    primaryRole: "Probe",
    secondaryRole: "Substrate",
    primaryLabel: [e.probe, e.probeType].filter(Boolean).join(" · ") || e.method || "—",
    primaryDetails: e.method || "",
  };
}

function TribopairContactValue({
  label,
  value,
  missing,
  prov,
  sourceId,
  recordId,
  field,
  domain,
}: {
  label: string;
  value: string;
  missing?: boolean;
  prov?: NonNullable<IonicRecord["provenance"]>[string];
  sourceId?: string;
  recordId?: string;
  field: string;
  domain: Domain;
}) {
  const className = `min-w-0 bg-white px-2.5 py-2 text-left ${
    prov ? "cursor-pointer transition hover:bg-brand-50/45 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200" : ""
  }`;
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-x-2">
        <span className="font-sans text-[9px] font-bold uppercase leading-relaxed tracking-eyebrow text-cyan-700">{label}</span>
      </span>
      <span
        className={`mt-0.5 block break-words text-[13px] font-semibold leading-snug ${
          missing ? "text-amber-600" : "text-ink-900"
        }`}
      >
        {value}
      </span>
    </>
  );
  if (prov) {
    return (
      <button
        type="button"
        data-testid="evidence-click-target"
        className={className}
        title={`${value} · evidence available`}
        aria-label={`Open evidence for ${field}`}
        onClick={() => openRecordEvidence({ sourceId, recordId, field, value, prov, domain })}
      >
        {content}
      </button>
    );
  }
  return (
    <div data-testid="tribopair-contact-value" className={className} title={value}>
      {content}
    </div>
  );
}

function TribopairInlineSpec({
  label,
  value,
  title,
  missing,
  tone = "ink",
  prov,
  sourceId,
  recordId,
  field,
  domain,
}: {
  label: string;
  value: string;
  title?: string;
  missing?: boolean;
  tone?: "ink" | "cyan" | "violet" | "amber";
  prov?: NonNullable<IonicRecord["provenance"]>[string];
  sourceId?: string;
  recordId?: string;
  field: string;
  domain: Domain;
}) {
  const toneClass =
    tone === "cyan"
      ? "text-cyan-800"
      : tone === "violet"
        ? "text-violet-800"
        : tone === "amber" || missing
          ? "text-amber-800"
          : "text-ink-800";

  const className = `min-w-0 bg-white px-2.5 py-1.5 text-left ${
    prov ? "cursor-pointer transition hover:bg-brand-50/45 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200" : ""
  }`;
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-x-1.5">
        <span className="min-w-0 break-words font-sans text-[8.5px] font-bold uppercase leading-relaxed tracking-eyebrow text-ink-400">{label}</span>
      </span>
      <span className={`mt-0.5 block break-words font-mono text-[12px] font-semibold leading-tight ${toneClass}`}>{value}</span>
    </>
  );
  if (prov) {
    return (
      <button
        type="button"
        data-testid="evidence-click-target"
        className={className}
        title={`${title ?? value} · evidence available`}
        aria-label={`Open evidence for ${field}`}
        onClick={() => openRecordEvidence({ sourceId, recordId, field, value, prov, domain })}
      >
        {content}
      </button>
    );
  }
  return (
    <div data-testid="tribopair-inline-spec" className={className} title={title ?? value}>
      {content}
    </div>
  );
}

export function RecordCard({
  record,
  selected,
  onToggle,
  actions,
  units = "raw",
  domain = DEFAULT_DOMAIN,
}: {
  record: IonicRecord;
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
  const { missing } = coreCompleteness(record);
  const svgId = useId().replace(/:/g, "");
  const conditions = buildConditionItems(record, units);
  const tribopair = tribopairDisplay(record);
  const probeLabel = tribopair.mode === "macro" ? tribopair.primaryLabel : tribopair.primaryLabel;
  const showConfidence = record.status === "review" && typeof record.confidence === "number";
  const confidencePct = showConfidence ? Math.round((record.confidence as number) * 100) : null;
  const instrumentLabel = tribopair.mode === "macro" ? "TRIBO" : "AFM";
  const tribopairSpecs = [
    {
      label: "Rq roughness",
      value: e.roughness ? quantityLabel(e.roughness, units) : "—",
      title: e.roughness ? `Root Mean Square Roughness (Rq): ${quantityTitle(e.roughness, units)}` : "Root Mean Square Roughness (Rq) not reported",
      missing: !e.roughness,
      tone: "cyan" as const,
      prov: record.provenance?.roughness,
      field: "roughness",
    },
    {
      label: "γs · Surface energy",
      value: e.surface?.surfaceEnergy ? quantityLabel(e.surface.surfaceEnergy, units) : "—",
      title: e.surface?.surfaceEnergy ? `Surface energy (γs): ${quantityTitle(e.surface.surfaceEnergy, units)}` : "Surface energy not reported",
      missing: !e.surface?.surfaceEnergy,
      tone: "ink" as const,
      prov: record.provenance?.surfaceEnergy,
      field: "surfaceEnergy",
    },
    {
      label: "σs · Surface charge",
      value: e.surface?.surfaceChargeDensity ? quantityLabel(e.surface.surfaceChargeDensity, units) : "—",
      title: e.surface?.surfaceChargeDensity
        ? `Surface charge density (σs): ${quantityTitle(e.surface.surfaceChargeDensity, units)}`
        : "Surface charge density not reported",
      missing: !e.surface?.surfaceChargeDensity,
      tone: "violet" as const,
      prov: record.provenance?.surfaceChargeDensity,
      field: "surfaceChargeDensity",
    },
    {
      label: "θs · Contact angle",
      value: e.surface?.contactAngle ? quantityLabel(e.surface.contactAngle, units) : "—",
      title: e.surface?.contactAngle ? `Contact angle (θs): ${quantityTitle(e.surface.contactAngle, units)}` : "Contact angle not reported",
      missing: !e.surface?.contactAngle,
      tone: "amber" as const,
      prov: record.provenance?.contactAngle,
      field: "contactAngle",
    },
  ];
  const cofValue = formatCof(core.cof);
  const cofReadoutContent = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-eyebrow text-ink-500">Coefficient of friction</div>
          <div
            className={`mt-1 font-mono text-[1.8rem] font-semibold leading-none tnum ${
              core.cof == null ? "text-amber-600" : "text-ink-900"
            }`}
          >
            {cofValue}
          </div>
        </div>
        {showConfidence && (
          <span className="shrink-0 whitespace-nowrap text-right text-[10px] font-medium text-ink-400">conf {confidencePct}%</span>
        )}
      </div>
    </>
  );

  return (
    <article
      className={`record-card-unified-text group relative grid items-start overflow-hidden rounded-[10px] border bg-white transition duration-300 xl:grid-cols-[auto_minmax(0,0.84fr)_minmax(0,1.05fr)_minmax(0,1.28fr)] ${
        selected
          ? "border-brand-300 shadow-card ring-1 ring-brand-200"
          : "border-ink-200/80 shadow-sm hover:-translate-y-px hover:border-brand-200 hover:shadow-card"
      }`}
    >
      {/* selected accent bar */}
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
        <span
          className={`status-mini whitespace-nowrap ${record.status === "review" ? "status-mini-review" : "status-mini-official"}`}
        >
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
        <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2">
          <MoleculeView smiles={il.cationSmiles} ionLabel={cationLabel} kind="cation" label="Cation" width={236} height={88} />
          <MoleculeView smiles={il.anionSmiles} ionLabel={anionLabel} kind="anion" label="Anion" width={320} height={116} />
        </div>
      </section>

      {/* ── tribosystem ── */}
      <section
        data-testid="tribopair-panel"
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 border-b border-ink-100 bg-white px-3 py-3 xl:border-b-0 xl:border-l xl:border-ink-100"
      >
        <div
          className={`flex h-fit w-[3.85rem] shrink-0 flex-col items-center justify-center rounded-[8px] border px-1.5 py-2 ${
            tribopair.mode === "macro"
              ? "border-orange-100 bg-orange-50/45"
              : "border-cyan-100 bg-cyan-50/55"
          }`}
        >
          {tribopair.mode === "macro" ? (
            <MacroTribometerIllustration idPrefix={svgId} pattern={tribopair.pattern} />
          ) : (
            <AfmProbeIllustration idPrefix={svgId} active={e.scale === "nano"} />
          )}
          <div className="mt-1.5 w-full border-t border-ink-100/70 pt-1 text-center font-mono text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">
            {instrumentLabel}
          </div>
        </div>
        <div data-testid="tribopair-contact-strip" className="min-w-0 overflow-hidden rounded-[8px] border border-ink-100 bg-white">
          <div className="border-b border-ink-100 bg-gradient-to-r from-cyan-50/70 to-white px-2.5 py-1.5">
            <span className="font-sans text-[8.5px] font-bold uppercase tracking-eyebrow text-ink-400">Tribopair</span>
          </div>
          <div data-testid="tribopair-contact-stack" className="grid min-w-0 grid-cols-1 divide-y divide-ink-100 bg-white">
            <TribopairContactValue
              label="Probe"
              value={probeLabel}
              prov={record.provenance?.probe}
              sourceId={record.sourceId}
              recordId={record.id}
              field="probe"
              domain={domain}
            />
            <TribopairContactValue
              label="Substrate"
              value={core.substrate || "substrate?"}
              missing={!core.substrate}
              prov={record.provenance?.substrate}
              sourceId={record.sourceId}
              recordId={record.id}
              field="substrate"
              domain={domain}
            />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-px border-t border-ink-100 bg-ink-100">
            {tribopairSpecs.map((spec) => (
              <TribopairInlineSpec
                key={spec.label}
                label={spec.label}
                value={spec.value}
                title={spec.title}
                missing={spec.missing}
                tone={spec.tone}
                prov={spec.prov}
                sourceId={record.sourceId}
                recordId={record.id}
                field={spec.field}
                domain={domain}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── result ── */}
      <section className="flex min-w-0 flex-col gap-2.5 px-3 py-3 xl:border-l xl:border-ink-100">
        {record.provenance?.cof ? (
          <button
            type="button"
            data-testid="evidence-click-target"
            onClick={() =>
              openRecordEvidence({ sourceId: record.sourceId, recordId: record.id, field: "cof", value: cofValue, prov: record.provenance!.cof!, domain })
            }
            data-ui="cof-summary"
            className="rounded-[10px] border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 px-3 py-2.5 text-left shadow-sm transition hover:border-brand-300 hover:bg-cyan-50/55 focus:outline-none focus:ring-2 focus:ring-brand-200"
            title={`${cofValue} · evidence available`}
            aria-label="Open evidence for cof"
          >
            {cofReadoutContent}
          </button>
        ) : (
          <div data-ui="cof-summary" className="rounded-[10px] border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 px-3 py-2.5 shadow-sm">
            {cofReadoutContent}
          </div>
        )}

        <div>
          <div className="mb-1.5">
            <span className="label-eyebrow">{units === "std" ? "Standardized Conditions" : "Reported Conditions"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {/* half-width chips first, then missing-field placeholders in their
                logical slot, then any full-width chip (e.g. additives) as the last row */}
            {conditions.filter((c) => !c.fullWidth).map((item) => (
              <ConditionChip key={`${item.label}-${item.value}`} item={item} sourceId={record.sourceId} recordId={record.id} domain={domain} />
            ))}
            {!core.load && <MissingChip label="Load" />}
            {!core.temperature && <MissingChip label="Temp" />}
            {conditions.filter((c) => c.fullWidth).map((item) => (
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

function AfmProbeIllustration({ idPrefix, active }: { idPrefix: string; active: boolean }) {
  const tipId = `${idPrefix}-tip`;
  const glowId = `${idPrefix}-glow`;
  const stageId = `${idPrefix}-stage`;

  return (
    <svg
      data-testid="afm-probe-illustration"
      className="h-16 w-10 overflow-visible"
      viewBox="0 0 86 146"
      role="img"
      aria-label="AFM probe scanning substrate"
    >
      <defs>
        <linearGradient id={tipId} x1="43" y1="44" x2="43" y2="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#718197" />
          <stop offset="1" stopColor="#445369" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(43 96) rotate(90) scale(35 22)">
          <stop stopColor="#f0feff" />
          <stop offset=".48" stopColor="#baf4f8" stopOpacity=".78" />
          <stop offset="1" stopColor="#6dd8e1" stopOpacity=".12" />
        </radialGradient>
        <linearGradient id={stageId} x1="8" y1="111" x2="78" y2="111" gradientUnits="userSpaceOnUse">
          <stop stopColor="#283449" />
          <stop offset=".58" stopColor="#182336" />
          <stop offset="1" stopColor="#0f192a" />
        </linearGradient>
      </defs>
      <ellipse cx="43" cy="124" rx="35" ry="8" fill="#162234" opacity=".12" />
      <g>
        {active && <animateTransform attributeName="transform" type="scale" values=".97;1.02;.97" dur="2.8s" repeatCount="indefinite" additive="sum" />}
        <ellipse cx="43" cy="96" rx="26" ry="31" fill={`url(#${glowId})`} />
      </g>
      <g stroke="#40cddb" strokeLinecap="round">
        {active && <animateTransform attributeName="transform" type="translate" values="-7 0;7 0;-7 0" dur="2.8s" repeatCount="indefinite" />}
        <path d="M25 98 C33 96 39 101 47 98 S58 96 64 99" opacity=".42" />
        <path d="M23 103 C33 101 39 105 50 103 S61 101 66 104" opacity=".22" />
      </g>
      <g>
        {active && <animateTransform attributeName="transform" type="translate" values="-7 0;7 0;-7 0" dur="2.8s" repeatCount="indefinite" />}
        <path d="M29 44H57L43 88Z" fill={`url(#${tipId})`} />
      </g>
      <path d="M8 108 C15 102 22 110 29 104 C36 98 43 108 50 103 C58 98 64 107 72 102 C76 100 78 103 78 108 L78 116 Q78 124 70 124 L16 124 Q8 124 8 116 Z" fill={`url(#${stageId})`} />
      <path d="M16 110 C25 106 30 108 38 104 C48 100 55 106 66 103" stroke="#ffffff" strokeWidth="1.3" opacity=".16" fill="none" />
      <path d="M25 110V124M39 107V124M53 106V124" stroke="#44536a" strokeWidth="1" opacity=".55" />
    </svg>
  );
}

function MacroTribometerIllustration({ idPrefix, pattern }: { idPrefix: string; pattern: TribopairDisplay["pattern"] }) {
  const isPin = pattern === "pin-disk";
  const isBlock = pattern === "block-ring" || pattern === "counterface-specimen";
  const isThreeBall = pattern === "three-ball-plate";
  const isBallPins = pattern === "ball-pins";
  const stageId = `${idPrefix}-macro-stage`;
  const glowId = `${idPrefix}-macro-glow`;

  return (
    <svg
      data-testid="macro-tribometer-illustration"
      data-pattern={pattern}
      className="h-16 w-10 overflow-visible"
      viewBox="0 0 86 146"
      role="img"
      aria-label="Macro tribometer contact"
    >
      <defs>
        <linearGradient id={stageId} x1="13" y1="112" x2="73" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#283449" />
          <stop offset="1" stopColor="#111827" />
        </linearGradient>
        <radialGradient id={glowId} cx="43" cy="91" r="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fed7aa" stopOpacity=".62" />
          <stop offset="1" stopColor="#fed7aa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="43" cy="124" rx="35" ry="8" fill="#162234" opacity=".12" />
      <ellipse cx="43" cy="91" rx="31" ry="34" fill={`url(#${glowId})`}>
        <animate attributeName="opacity" values=".38;.72;.38" dur="2.2s" repeatCount="indefinite" />
      </ellipse>
      <path d="M18 92H68" stroke="#fb923c" strokeWidth="5" strokeLinecap="round" opacity=".25">
        <animateTransform attributeName="transform" type="translate" values="-6 0;6 0;-6 0" dur="2s" repeatCount="indefinite" />
      </path>
      <g>
        <animateTransform attributeName="transform" type="translate" values="-5 0;5 0;-5 0" dur="2s" repeatCount="indefinite" />
        {isPin ? (
          <rect x="36" y="44" width="14" height="45" rx="6" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
        ) : isBlock ? (
          <rect x="27" y="53" width="32" height="27" rx="7" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
        ) : isThreeBall ? (
          <>
            <circle cx="43" cy="49" r="10" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
            <circle cx="28" cy="72" r="10" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
            <circle cx="58" cy="72" r="10" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
          </>
        ) : (
          <circle cx="43" cy={isBallPins ? 57 : 65} r="16" fill="#fff7ed" stroke="#f97316" strokeWidth="5" />
        )}
      </g>
      <circle cx="43" cy="94" r="6" fill="#ea580c">
        <animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".55;1;.55" dur="2s" repeatCount="indefinite" />
      </circle>
      {isBallPins ? (
        <>
          <circle cx="27" cy="111" r="9" fill="#182336" />
          <circle cx="43" cy="111" r="9" fill="#182336" />
          <circle cx="59" cy="111" r="9" fill="#182336" />
        </>
      ) : pattern === "block-ring" ? (
        <circle cx="43" cy="111" r="22" fill="none" stroke="#182336" strokeWidth="10" />
      ) : (
        <rect x="13" y="105" width="60" height="15" rx="5" fill={`url(#${stageId})`} />
      )}
      <path d="M20 109H66" stroke="#ffffff" strokeWidth="1.4" opacity=".16" />
    </svg>
  );
}
