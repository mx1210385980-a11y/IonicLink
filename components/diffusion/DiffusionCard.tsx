"use client";

import { useId } from "react";
import {
  diffusionCoreCompleteness,
  formatD,
  type DiffusionRecord,
} from "@/lib/diffusion/schema";
import { getDiffusionMode, type DiffusionMode } from "@/lib/diffusion/mode";
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
  if (e.method) {
    items.push({ label: "Method", value: formatMethod(e.method), prov: prov.method, field: "method" });
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
  const mode = getDiffusionMode(e.geometry);

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
        <div className="flex h-32 w-36 shrink-0 items-center justify-center rounded-2xl border border-cyan-100 bg-gradient-to-br from-white to-cyan-50/45 p-3">
          <DiffusionIllustration idPrefix={svgId} active={!!e.method} mode={mode} />
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

function DiffusionIllustration({ idPrefix, active, mode }: { idPrefix?: string; active: boolean; mode: DiffusionMode }) {
  // restore original ion palette (blue / green) used previously
  const cationColor = "#22b8cf"; // cyan-ish blue for cation
  const anionColor = "#2f9e6f"; // green for anion
  // softer, less-black blob color to feel like nanoporous material
  const bgSkeleton = "#203B47"; // deep teal/graphite for porous scaffold
  const softBg = "#f8fafc";

  const pfx = idPrefix ? idPrefix.replace(/[^a-z0-9\-_]/gi, "") : `diff-${mode}`.replace(/[^a-z0-9\-_]/gi, "");
  const pathCenter1D = `${pfx}-path-1d`;
  const centerWave = `${pfx}-center-wave`;
  const blobPath = `${pfx}-blob-path`;
  const mazePath = `${pfx}-maze-path`;

  const defaultViewBox = "0 0 300 200";
  const viewBox = mode === "3D" ? "-120 -120 240 240" : defaultViewBox;
  const ariaLabel = mode === "1D" ? "one-dimensional confined channel" : mode === "2D" ? "two-dimensional slit channel" : "three-dimensional porous network";

  const phi = (1 + Math.sqrt(5)) / 2;
  const rotateX = 0.4;
  const rotateY = 0.6;
  const scale = 40;
  const cosX = Math.cos(rotateX);
  const sinX = Math.sin(rotateX);
  const cosY = Math.cos(rotateY);
  const sinY = Math.sin(rotateY);

  const points3D = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ];

  const projectedIcos = points3D.map(([x0, y0, z0]) => {
    const y1 = y0 * cosX - z0 * sinX;
    const z1 = y0 * sinX + z0 * cosX;
    const x2 = x0 * cosY + z1 * sinY;
    const z2 = -x0 * sinY + z1 * cosY;
    const x = x2 * scale;
    const y = y1 * scale;
    const z = z2 * scale;
    const f = 200 / (200 + z);
    return { x: x * f, y: y * f, z, original: [x0, y0, z0] as [number, number, number] };
  });

  const icosahedronEdges = points3D.flatMap((_, i) =>
    points3D.slice(i + 1).map((_, j) => ({ i, j: j + i + 1 }))
  ).filter(({ i, j }) => {
    const [x1, y1, z1] = points3D[i];
    const [x2, y2, z2] = points3D[j];
    const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    return d >= 1.9 && d <= 2.1;
  });

  function getPentagonPoints(radius: number, offsetAngle: number) {
    return Array.from({ length: 5 }, (_, index) => {
      const angle = offsetAngle + (index * 2 * Math.PI) / 5;
      return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      };
    });
  }

  const innerPoints = getPentagonPoints(25, -Math.PI / 2);
  const middlePoints = getPentagonPoints(60, -Math.PI / 2 + Math.PI / 5);
  const outerPoints = getPentagonPoints(95, -Math.PI / 2 + Math.PI / 5);

  const allPoints = [...innerPoints, ...middlePoints, ...outerPoints];

  function pointPairs(points: { x: number; y: number }[]) {
    return points.map((point, i) => ({ start: point, end: points[(i + 1) % points.length] }));
  }

  const innerEdges = pointPairs(innerPoints);
  const middleEdges = pointPairs(middlePoints);
  const outerEdges = pointPairs(outerPoints);
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid slice" className="h-full w-full" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={`${pfx}-grad-cap`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e6f2ff" />
          <stop offset="1" stopColor="#cfe9ff" />
        </linearGradient>

        <linearGradient id={`${pfx}-grad-cap-shade`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#cfe9ff" />
          <stop offset="1" stopColor="#9fcfff" />
        </linearGradient>

        <linearGradient id={`${pfx}-grad-membrane`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f0fbff" />
          <stop offset="1" stopColor="#def6ff" />
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

        <path id={pathCenter1D} d="M30 100 H270" fill="none" stroke="none" />

        <path id={centerWave} d="M40 90 C 80 70, 120 110, 160 90 S 240 70, 260 90" fill="none" stroke="none" />

        <path
          id={blobPath}
          d={`M150 30
             C 210 30, 270 70, 260 130
             C 250 170, 200 190, 150 170
             C 100 190, 50 170, 40 130
             C 30 80, 80 30, 150 30 Z`}
          fill={bgSkeleton}
        />

        <path
          id={mazePath}
          d={`M120 60 C 140 80, 110 100, 130 120 S 180 140, 200 120 C 220 100, 190 90, 170 80 S 140 60, 120 60`}
          fill="none"
          stroke="none"
        />

        <mask id={`${pfx}-pore-mask`}>
          <rect x="0" y="0" width="300" height="200" fill="black" />
          <use href={`#${blobPath}`} fill="white" />
          <circle cx="175" cy="70" r="14" fill="black" />
          <circle cx="135" cy="95" r="10" fill="black" />
          <circle cx="190" cy="125" r="12" fill="black" />
          <circle cx="110" cy="135" r="9" fill="black" />
          <ellipse cx="155" cy="150" rx="20" ry="12" fill="black" />
        </mask>
      </defs>

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

      {/* 2D: 波浪状膜（保留简洁膜示意） */}
      {mode === "2D" && (
        <g>
          <rect x="0" y="0" width="300" height="200" fill="none" />
          <path d="M10 70 Q 60 40, 110 70 T 210 70 T 290 70 L 290 90 Q 220 120, 150 90 T 10 90 Z" fill={`url(#${pfx}-grad-membrane)`} opacity={0.95} />
          <path d="M10 110 Q 60 140, 110 110 T 210 110 T 290 110 L 290 90 Q 220 60, 150 90 T 10 90 Z" fill={`url(#${pfx}-grad-membrane)`} opacity={0.95} />

          <path d="M40 90 C 80 70, 120 110, 160 90 S 240 70, 260 90" stroke="#9fd7f7" strokeWidth={1} strokeDasharray="4 4" opacity={0.22} fill="none" />

          <g>
            <circle r={9} fill={cationColor}>
              {active && (
                <animateMotion dur="3s" repeatCount="indefinite">
                  <mpath href={`#${centerWave}`} />
                </animateMotion>
              )}
            </circle>

            <circle r={9} fill={anionColor}>
              {active && (
                <animateMotion dur="3.6s" begin="0.4s" repeatCount="indefinite">
                  <mpath href={`#${centerWave}`} />
                </animateMotion>
              )}
            </circle>

            <g transform="translate(90,86)">
              <circle r={7} fill={cationColor} opacity={0.95} />
              {active && <animateTransform attributeName="transform" type="translate" values="0 0; 6 -6; 12 2; 0 0" dur="2.8s" repeatCount="indefinite" />}
            </g>

            <g transform="translate(200,100)">
              <circle r={7} fill={anionColor} opacity={0.95} />
              {active && <animateTransform attributeName="transform" type="translate" values="0 0; -8 6; -16 -2; 0 0" dur="3.2s" repeatCount="indefinite" />}
            </g>
          </g>
        </g>
      )}

      {/* 3D: Icosahedron cage projection using strict 3D coordinates and perspective */}
      {mode === "3D" && (
        <g>
          <rect x="-120" y="-120" width="240" height="240" fill="none" />

          <g fill="none" stroke="#555" strokeWidth={2}>
            {icosahedronEdges.map(({ i, j }, idx) => {
              const p1 = projectedIcos[i];
              const p2 = projectedIcos[j];
              const avgZ = (p1.z + p2.z) / 2;
              return (
                <line
                  key={`edge-${i}-${j}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  strokeOpacity={avgZ < 0 ? 0.3 : 0.95}
                />
              );
            })}
          </g>

          <g fill="#333" aria-hidden>
            {projectedIcos.map((pt, idx) => (
              <circle key={`vertex-${idx}`} cx={pt.x} cy={pt.y} r={4} />
            ))}
          </g>

          <g>
            <circle cx={0} cy={0} r={6} fill={cationColor} />
            <circle cx={0} cy={0} r={12} fill={`url(#${pfx}-ion-glow)`} opacity={0.18} />
            {active && (
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0,0; 15,-10; -10,-15; 10,15; 0,0"
                dur="4s"
                repeatCount="indefinite"
              />
            )}
          </g>
        </g>
      )}
    </svg>
  );
}
