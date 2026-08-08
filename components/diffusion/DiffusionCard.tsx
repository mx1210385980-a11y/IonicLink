"use client";

import { useId, useMemo } from "react";
import {
  diffusionCoreCompleteness,
  formatD,
  type DiffusionRecord,
} from "@/lib/diffusion/schema";
import { getDiffusionMode, type DiffusionMode } from "@/lib/diffusion/mode";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { FieldProvenance } from "@/lib/schema";
import { formatStd } from "@/lib/units";
import { MoleculeView } from "../MoleculeView";
import {
  ConditionChip,
  IonPill,
  MissingChip,
  ProvBadge,
  ionDisplayLabel,
  openRecordEvidence,
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
  if (e.nucleus) {
    items.push({ label: "Nucleus", value: e.nucleus, prov: prov.nucleus, field: "nucleus" });
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

function ConfinedSystemValue({
  label,
  hideLabel = false,
  value,
  field,
  prov,
  sourceId,
  recordId,
  domain,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  field: string;
  prov?: FieldProvenance;
  sourceId?: string;
  recordId?: string;
  domain: Domain;
}) {
  const className = `min-w-0 px-3 py-2 text-left ${
    prov ? "cursor-pointer transition hover:bg-brand-50/45 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-200" : ""
  }`;
  const content = (
    <>
      {!hideLabel && <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-500">{label}</span>}
      <span className={`${hideLabel ? "" : "mt-1 "}block w-full truncate text-[12px] font-semibold tracking-tight text-ink-900`}>{value}</span>
    </>
  );

  if (prov) {
    return (
      <button
        type="button"
        data-testid="evidence-click-target"
        data-ui={`confined-system-${field}`}
        className={className}
        title={`${value} · evidence available`}
        aria-label={`Open evidence for ${field}`}
        onClick={() => openRecordEvidence({ sourceId, recordId, field, value, prov, domain })}
      >
        {content}
      </button>
    );
  }

  return <div className={className} title={value}>{content}</div>;
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
  const dValue = core.diffusion ? quantityLabel(core.diffusion, units) : formatD(core.diffusion);
  const standardizedDValue = record.status === "review" && core.diffusion?.std != null ? formatStd(core.diffusion.std, "m²/s") : null;
  const isCationSpecies = /cation|\+$/i.test(core.species);
  const isAnionSpecies = /anion|-$/i.test(core.species);
  const mode = getDiffusionMode(e.geometry);
  const diffusionReadoutContent = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="label-eyebrow text-black">Diffusion coefficient</div>
        <div className="mt-1 font-mono text-[1.8rem] font-semibold leading-none tnum text-black [overflow-wrap:anywhere]">{dValue}</div>
        {standardizedDValue && <div className="mt-2 text-[10px] font-medium text-black">standardized · {standardizedDValue}</div>}
      </div>
      {showConfidence && <span className="shrink-0 whitespace-nowrap text-right text-[10px] font-medium text-black">conf {confidencePct}%</span>}
    </div>
  );

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
        <div className="flex h-32 w-36 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45">
          <DiffusionIllustration idPrefix={svgId} active={!!e.method} mode={mode} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-ink-100 bg-white">
            <div className="rounded-t-2xl border-b border-ink-100 bg-gradient-to-br from-white to-cyan-100/40">
              <p className="label-eyebrow px-3 pt-2">Confined system</p>
              <ConfinedSystemValue
                label="System"
                hideLabel
                value={e.systemName || "—"}
                field="systemName"
                prov={record.provenance?.systemName}
                sourceId={record.sourceId}
                recordId={record.id}
                domain={domain}
              />
            </div>
            <div className="divide-y divide-ink-100/70">
              <ConfinedSystemValue label="Method" value={methodValue} field="method" prov={record.provenance?.method} sourceId={record.sourceId} recordId={record.id} domain={domain} />
              <ConfinedSystemValue label="Material" value={e.material || "—"} field="material" prov={record.provenance?.material} sourceId={record.sourceId} recordId={record.id} domain={domain} />
              <ConfinedSystemValue label="Geometry" value={e.geometry || "—"} field="geometry" prov={record.provenance?.geometry} sourceId={record.sourceId} recordId={record.id} domain={domain} />
              <ConfinedSystemValue label="Functional groups" value={e.functionalGroups || "—"} field="functionalGroups" prov={record.provenance?.functionalGroups} sourceId={record.sourceId} recordId={record.id} domain={domain} />
              <ConfinedSystemValue label="Scale value" value={e.poreSize ? quantityLabel(e.poreSize, units) : "—"} field="poreSize" prov={record.provenance?.poreSize} sourceId={record.sourceId} recordId={record.id} domain={domain} />
              <ConfinedSystemValue label="Polarizable" value={e.polarizable || "—"} field="polarizable" prov={record.provenance?.polarizable} sourceId={record.sourceId} recordId={record.id} domain={domain} />
            </div>
          </div>
        </div>
      </section>

      {/* ── result: D readout ── */}
      <section className="flex min-w-0 flex-col gap-2.5 px-3 py-3 xl:border-l xl:border-ink-100">
        {record.provenance?.diffusion ? (
          <button
            type="button"
            data-testid="evidence-click-target"
            onClick={() =>
              openRecordEvidence({
                sourceId: record.sourceId,
                recordId: record.id,
                field: "diffusion",
                value: dValue,
                prov: record.provenance!.diffusion!,
                domain,
              })
            }
            data-ui="diffusion-summary"
            className="rounded-[10px] border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 px-3 py-2.5 text-left shadow-sm transition hover:border-brand-300 hover:bg-cyan-50/55 focus:outline-none focus:ring-2 focus:ring-brand-200"
            title={`${dValue} · evidence available`}
            aria-label="Open evidence for diffusion coefficient"
          >
            {diffusionReadoutContent}
          </button>
        ) : (
          <div data-ui="diffusion-summary" className="rounded-[10px] border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 px-3 py-2.5 shadow-sm">
            {diffusionReadoutContent}
          </div>
        )}

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

function DiffusionIllustration({ idPrefix, active, mode }: { idPrefix?: string; active: boolean; mode: DiffusionMode }) {
  const cationColor = "#0ea5e9";
  const anionColor = "#10b981";
  const bgSkeleton = "#334155";
  const softBg = "#f8fafc";

  const pfx = idPrefix ? idPrefix.replace(/[^a-z0-9\-_]/gi, "") : `diff-${mode}`.replace(/[^a-z0-9\-_]/gi, "");
  const pathCenter1D = `${pfx}-path-1d`;
  const slitPath = `${pfx}-slit-path`;
  const membranePath = `${pfx}-membrane-path`;
  const gyroidPath = `${pfx}-gyroid-path`;
  const membraneMask = `${pfx}-vector-membrane-mask`;
  const denseMembrane = useMemo(() => {
    const lines = [];
    const pores = [];

    for (let index = 0; index < 40; index++) {
      const isHorizontal = index % 2 === 0;
      const startPos = (index / 40) * 350 - 20;
      const waveOffset1 = Math.sin(index) * 50;
      const waveOffset2 = Math.cos(index) * 50;

      if (isHorizontal) {
        lines.push(<path key={`h-${index}`} d={`M -20,${startPos} Q 80,${startPos + waveOffset1} 160,${startPos} T 340,${startPos + waveOffset2}`} strokeWidth={4 + (index % 4)} fill="none" stroke="black" strokeLinecap="round" />);
      } else {
        lines.push(<path key={`v-${index}`} d={`M ${startPos},-20 Q ${startPos + waveOffset1},80 ${startPos},160 T ${startPos + waveOffset2},340`} strokeWidth={3 + (index % 3)} fill="none" stroke="black" strokeLinecap="round" />);
      }
    }

    for (let index = 0; index < 80; index++) {
      const cx = (Math.sin(index * 13) * 0.5 + 0.5) * 300;
      const cy = (Math.cos(index * 17) * 0.5 + 0.5) * 200;
      const radius = 2 + (index % 6);
      pores.push(<circle key={`p-${index}`} cx={cx} cy={cy} r={radius} fill="black" />);
    }

    return { lines, pores };
  }, []);

  const defaultViewBox = "0 0 300 200";
  const viewBox = mode === "3D-Cage" ? "-200 -190 400 356" : defaultViewBox;
  const ariaLabel = {
    "1D": "one-dimensional cylindrical channel",
    "2D": "two-dimensional slit pore",
    "3D-Cage": "three-dimensional framework cage",
    Membrane: "tortuous porous membrane",
    "0D-Pools": "isolated liquid pools",
    Gyroid: "bicontinuous gyroid channel",
  }[mode];

  const frameworkNodes = [
    { id: "n02", x: -22, y: -74 }, { id: "n03", x: -74, y: -48 }, { id: "n04", x: -33, y: -35 }, { id: "n05", x: 53, y: -45 },
    { id: "n06", x: -78, y: 28 }, { id: "n07", x: -46, y: 43 }, { id: "n08", x: 1, y: 43 }, { id: "n09", x: 50, y: 27 }, { id: "n10", x: -136, y: 51 },
    { id: "n11", x: -94, y: 72 }, { id: "n12", x: 29, y: 73 }, { id: "n13", x: 123, y: 63 }, { id: "n14", x: -134, y: 125 }, { id: "n15", x: -50, y: 141 },
    { id: "n16", x: -3, y: 127 }, { id: "n17", x: 117, y: 126 }, { id: "n18", x: -184, y: 150 }, { id: "n19", x: -151, y: 174 }, { id: "n20", x: -104, y: 156 },
    { id: "n21", x: -63, y: 181 }, { id: "n22", x: -25, y: 174 }, { id: "n23", x: 28, y: 163 }, { id: "n24", x: 62, y: 153 }, { id: "n25", x: 110, y: 184 },
    { id: "n26", x: 185, y: 159 }, { id: "n27", x: -121, y: 198 }, { id: "n28", x: -80, y: 189 }, { id: "n29", x: 16, y: 169 },
  ];
  const frameworkNodeById = new Map(frameworkNodes.map((node) => [node.id, node]));
  const frameworkEdges = [
    ["n02", "n03"], ["n02", "n04"], ["n02", "n05"], ["n03", "n06"], ["n04", "n07"], ["n05", "n09"],
    ["n06", "n07"], ["n06", "n10"], ["n06", "n11"], ["n07", "n08"], ["n07", "n11"], ["n08", "n09"], ["n08", "n12"], ["n09", "n12"], ["n09", "n13"],
    ["n10", "n14"], ["n11", "n14"], ["n11", "n15"], ["n11", "n16"], ["n12", "n16"], ["n12", "n23"], ["n13", "n17"], ["n13", "n24"],
    ["n14", "n18"], ["n14", "n19"], ["n15", "n20"], ["n15", "n21"], ["n16", "n22"], ["n16", "n23"], ["n17", "n24"], ["n17", "n25"], ["n17", "n26"],
    ["n18", "n19"], ["n19", "n20"], ["n20", "n22"], ["n20", "n27"], ["n21", "n22"], ["n21", "n28"], ["n22", "n29"], ["n23", "n24"], ["n23", "n29"], ["n24", "n25"], ["n25", "n26"],
  ] as const;
  const frameworkLinks = frameworkEdges.map(([startId, endId]) => {
    const start = frameworkNodeById.get(startId)!;
    const end = frameworkNodeById.get(endId)!;
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  });
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" className="block h-full w-full" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={`${pfx}-grad-cap`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e6f2ff" />
          <stop offset="1" stopColor="#cfe9ff" />
        </linearGradient>

        <linearGradient id={`${pfx}-grad-cap-shade`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#cfe9ff" />
          <stop offset="1" stopColor="#9fcfff" />
        </linearGradient>

        <linearGradient id={`${pfx}-grad-slit-wall`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#475569" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>

        <linearGradient id={`${pfx}-gyroid-rear`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#52717c" />
          <stop offset="1" stopColor="#284752" />
        </linearGradient>
        <linearGradient id={`${pfx}-gyroid-front`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8dce0" />
          <stop offset="0.48" stopColor="#7caeb4" />
          <stop offset="1" stopColor="#416b75" />
        </linearGradient>

        <radialGradient id={`${pfx}-ion-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="rgba(255,255,255,0.9)" />
          <stop offset="0.25" stopColor="rgba(255,255,255,0.6)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>

        {/* 管道纵深渐变：用于 1D 圆柱透视 */}
        <linearGradient id={`${pfx}-tube-grad`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#aab6bd" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#f6fbfc" stopOpacity="0.0" />
          <stop offset="1" stopColor="#9aa6ad" stopOpacity="0.95" />
        </linearGradient>

        {/* 中心孔腔光照渐变：用于让中心更亮，增强包裹感 */}
        <radialGradient id={`${pfx}-pore-light`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.6" stopColor="#f0f7f8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#f0f7f8" stopOpacity="0.0" />
        </radialGradient>

        <mask id={membraneMask}>
          <rect width="100%" height="100%" fill="white" />
          <g opacity="0.9">
            {denseMembrane.lines}
            {denseMembrane.pores}
          </g>
        </mask>

        <path id={pathCenter1D} d="M30 100 H270" fill="none" stroke="none" />

        <path id={slitPath} d="M28 100 C 80 92, 125 108, 176 99 S 240 91, 272 100" fill="none" stroke="none" />
        <path id={membranePath} d="M 10,100 L 65,100 Q 95,140 125,90 T 175,120 T 225,100 L 290,100" fill="none" stroke="none" />
        <path id={gyroidPath} d="M12 132 C 44 178, 76 178, 108 132 S 172 86, 204 132 S 260 178, 292 132" fill="none" stroke="none" />

      </defs>

      <rect x={mode === "3D-Cage" ? -200 : 0} y={mode === "3D-Cage" ? -190 : 0} width="100%" height="100%" rx="16" fill={softBg} />

      {/* 1D: 极简并规整的二维剖面，平行原子墙与居中水平单排扩散 */}
      {mode === "1D" && (
        <g>
          <rect x="0" y="0" width="300" height="200" fill="none" />

          {/* 上下两条平行原子墙（小圆点） */}
          <g fill={bgSkeleton} aria-hidden>
            {Array.from({ length: 22 }).map((_, i) => (
              <circle key={`t-${i}`} cx={20 + i * 12} cy={72} r={3} />
            ))}
            {Array.from({ length: 22 }).map((_, i) => (
              <circle key={`b-${i}`} cx={20 + i * 12} cy={128} r={3} />
            ))}
          </g>

          {/* 中央留白通道（干净利落） */}
          <rect x="18" y="78" width="264" height="44" fill="none" />

          {/* 离子：固定在中心线上，仅沿 X 轴平移 */}
          <g transform="translate(0,100)">
            <g>
              <circle cx={-90} cy={0} r={9} fill={cationColor} />
              <circle cx={-90} cy={0} r={14} fill={`url(#${pfx}-ion-glow)`} opacity={0.14} />
              {active && <animateTransform attributeName="transform" type="translate" values="-90 0; 90 0; -90 0" dur="1.4s" repeatCount="indefinite" />}
            </g>
            <g>
              <circle cx={90} cy={0} r={9} fill={anionColor} />
              <circle cx={90} cy={0} r={14} fill={`url(#${pfx}-ion-glow)`} opacity={0.14} />
              {active && <animateTransform attributeName="transform" type="translate" values="90 0; -90 0; 90 0" dur="1.8s" repeatCount="indefinite" />}
            </g>
          </g>
        </g>
      )}

      {/* 2D: two rigid slabs contain a broad, laterally open slit. */}
      {mode === "2D" && (
        <g>
          <rect x="15" width="270" height="62" rx="10" fill={`url(#${pfx}-grad-slit-wall)`} />
          <rect x="15" y="138" width="270" height="62" rx="10" fill={`url(#${pfx}-grad-slit-wall)`} />
          <path d="M15 62 H285 M15 138 H285" stroke="#94a3b8" strokeWidth="2" opacity="0.55" />
          <rect x="15" y="64" width="270" height="72" fill={softBg} />
          <g fill="#78909d" opacity="0.95" aria-hidden="true">
            {Array.from({ length: 27 }).map((_, index) => <circle key={`top-atom-${index}`} cx={20 + index * 10} cy="63" r="3.2" />)}
            {Array.from({ length: 27 }).map((_, index) => <circle key={`bottom-atom-${index}`} cx={20 + index * 10} cy="137" r="3.2" />)}
          </g>
          <circle cx="66" cy="77" r="7" fill={cationColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; 18 2; -12 -1; 0 0" dur="4.8s" repeatCount="indefinite" />}
          </circle>
          <circle cx="220" cy="123" r="5.5" fill={anionColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; -16 -2; 10 1; 0 0" dur="5.2s" repeatCount="indefinite" />}
          </circle>
          <circle cx="72" cy="101" r="8" fill={cationColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; 142 -3; 92 4; 0 0" dur="2.4s" repeatCount="indefinite" />}
          </circle>
          <circle cx="208" cy="99" r="5.5" fill={anionColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; -138 4; -82 -3; 0 0" dur="2.9s" repeatCount="indefinite" />}
          </circle>
          <circle cx="150" cy="82" r="5" fill={anionColor} opacity="0.9">
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; 28 3; -20 -2; 0 0" dur="3.7s" repeatCount="indefinite" />}
          </circle>
        </g>
      )}

      {/* Membrane: a central porous barrier separates two free-fluid regions. */}
      {mode === "Membrane" && (
        <g>
          <rect width="100%" height="100%" fill="#ffffff" />
          <rect x="75" y="0" width="150" height="100%" fill="#334155" mask={`url(#${membraneMask})`} />
          <line x1="75" y1="0" x2="75" y2="100%" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
          <line x1="225" y1="0" x2="225" y2="100%" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
          <circle r="8" fill={cationColor}>
            {active && <animateMotion dur="5.6s" repeatCount="indefinite"><mpath href={`#${membranePath}`} /></animateMotion>}
          </circle>
          <circle r="5.5" fill={anionColor}>
            {active && <animateMotion dur="6.4s" begin="-2.1s" repeatCount="indefinite"><mpath href={`#${membranePath}`} /></animateMotion>}
          </circle>
        </g>
      )}

      {/* 0D-Pools: isolated cavities retain ions in local oscillations. */}
      {mode === "0D-Pools" && (
        <g>
          <rect x="15" width="270" height="200" rx="12" fill={bgSkeleton} />
          <circle cx="74" cy="88" r="30" fill={softBg} stroke="#94a3b8" strokeWidth="2" />
          <circle cx="172" cy="59" r="22" fill={softBg} stroke="#94a3b8" strokeWidth="2" />
          <circle cx="211" cy="139" r="34" fill={softBg} stroke="#94a3b8" strokeWidth="2" />
          <circle cx="110" cy="155" r="15" fill={softBg} stroke="#94a3b8" strokeWidth="2" />
          <circle cx="74" cy="88" r="8" fill={cationColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0,0; 2,-3; -2,2; 3,-1; -1,3; 0,0" dur="0.6s" repeatCount="indefinite" />}
          </circle>
          <circle cx="74" cy="88" r="5.5" fill={anionColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0,0; -2,2; 2,3; -3,-1; 1,-3; 0,0" dur="0.72s" repeatCount="indefinite" />}
          </circle>
        </g>
      )}

      {/* Gyroid: interwoven tubular phases form a pseudo-3D bicontinuous network. */}
      {mode === "Gyroid" && (
        <g>
          <path d="M-18 61 C 18 12, 54 12, 90 61 S 162 110, 198 61 S 270 12, 318 61" fill="none" stroke="#475569" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M-18 139 C 18 188, 54 188, 90 139 S 162 90, 198 139 S 270 188, 318 139" fill="none" stroke="#475569" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 132 C 44 178, 76 178, 108 132 S 172 86, 204 132 S 260 178, 292 132" fill="none" stroke="#334155" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 68 C 44 22, 76 22, 108 68 S 172 114, 204 68 S 260 22, 292 68" fill="none" stroke="#334155" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 132 C 44 178, 76 178, 108 132 S 172 86, 204 132 S 260 178, 292 132" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" opacity="0.68" />
          <path d="M12 68 C 44 22, 76 22, 108 68 S 172 114, 204 68 S 260 22, 292 68" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" opacity="0.68" />
          <circle r="8" fill={cationColor}>
            {active && <animateMotion dur="4.2s" repeatCount="indefinite" rotate="auto"><mpath href={`#${gyroidPath}`} /></animateMotion>}
          </circle>
          <circle r="5.5" fill={anionColor}>
            {active && <animateMotion dur="5s" begin="-1.8s" repeatCount="indefinite" rotate="auto"><mpath href={`#${gyroidPath}`} /></animateMotion>}
          </circle>
        </g>
      )}

      {/* 3D-Cage: hard-coded F-framework projection with an irregular, open central cavity. */}
      {mode === "3D-Cage" && (
        <g>
          <g transform="translate(0 -64)">
            <g fill="none" stroke="#64748b" strokeWidth="1.1" strokeLinecap="round" opacity="0.82">
              {frameworkLinks.map((link, index) => <line key={`f-bond-${index}`} {...link} />)}
            </g>
            <g fill="#334155">
              {frameworkNodes.map((node) => <circle key={`f-node-${node.id}`} cx={node.x} cy={node.y} r="8.8" />)}
            </g>
            <g opacity="0.22" fill="none" stroke="#94a3b8" strokeWidth="0.9">
              <path d="M-78 28 L-46 43 L1 43 L50 27 L29 73 L-3 127 L-50 141 L-94 72 Z" />
              <path d="M-33 -35 L1 43 L-3 127" />
            </g>
          </g>
          <circle cx="0" cy="-44" r="11.5" fill={cationColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; -23 -17; -36 8; -20 37; 16 31; 37 4; 18 -21; 0 0" dur="5.8s" repeatCount="indefinite" />}
          </circle>
          <circle cx="0" cy="-44" r="8.5" fill={anionColor}>
            {active && <animateTransform attributeName="transform" type="translate" values="0 0; 28 18; 38 -4; 21 -28; -9 -24; -32 -1; -21 25; 0 0" dur="6.6s" begin="-1.7s" repeatCount="indefinite" />}
          </circle>
        </g>
      )}
    </svg>
  );
}
