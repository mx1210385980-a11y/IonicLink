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

/** Dataset-import lineage keys are bookkeeping, not user data — hide them from the card. */
const INTERNAL_FLEXIBLE_KEYS = new Set([
  "dataset_filename",
  "dataset_sheet",
  "dataset_row",
  "dataset_fingerprint",
  "dataset_source",
]);

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
  const className = `block w-full min-w-0 px-3 py-2 text-left ${
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
  const flexibleFields = (record.flexible ?? []).filter(
    (field) => field.key.trim() && field.value.trim() && !INTERNAL_FLEXIBLE_KEYS.has(field.key)
  );
  // Unmapped dataset columns (flexible layer) are reported conditions too —
  // render them as chips in the same grid instead of a separate panel.
  const allConditions: ConditionItem[] = [
    ...conditions,
    ...flexibleFields.map((field) => ({
      label: field.key,
      value: field.unit ? `${field.value} ${field.unit}` : field.value,
      title: field.note ? `${field.key}: ${field.value} · ${field.note}` : undefined,
    })),
  ];
  const showConfidence = record.status === "review" && typeof record.confidence === "number";
  const confidencePct = showConfidence ? Math.round((record.confidence as number) * 100) : null;
  const dValue = core.diffusion ? quantityLabel(core.diffusion, units) : formatD(core.diffusion);
  const standardizedDValue = record.status === "review" && core.diffusion?.std != null ? formatStd(core.diffusion.std, "m²/s") : null;
  const isCationSpecies = /cation|\+$/i.test(core.species);
  const isAnionSpecies = /anion|-$/i.test(core.species);
  const isOverallSpecies = /overall|all/i.test(core.species);
  const diffusionTitle = isOverallSpecies
    ? "Diffusion coefficient of all species"
    : isCationSpecies
      ? "Diffusion coefficient of cation"
      : isAnionSpecies
        ? "Diffusion coefficient of anion"
        : "Diffusion coefficient";
  const mode = getDiffusionMode(e.geometry);
  const diffusionReadoutContent = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="label-eyebrow text-black">{diffusionTitle}</div>
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
              <ConfinedSystemValue label="Pore size" value={e.poreSize ? quantityLabel(e.poreSize, units) : "—"} field="poreSize" prov={record.provenance?.poreSize} sourceId={record.sourceId} recordId={record.id} domain={domain} />
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
            {allConditions.map((item) => (
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
  const cageTravelPath = `${pfx}-cage-travel-path`;
  const steelBall = `${pfx}-steel-ball`;
  const membraneMask = `${pfx}-vector-membrane-mask`;
  const tubeFadeMask = `${pfx}-tube-fade-mask`;
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
  const tubeData = useMemo(() => {
    const length = 500;
    const radius = 50;
    const centerY = 120;
    const rings = 50;
    const pointsPerRing = 16;
    const nodes: Array<{ x: number; y: number; z: number }> = [];
    const edges: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; z: number }> = [];

    for (let ring = 0; ring < rings; ring++) {
      const x = (ring / (rings - 1)) * length;
      const angleOffset = (ring % 2) * (Math.PI / pointsPerRing);
      for (let point = 0; point < pointsPerRing; point++) {
        const theta = (point / pointsPerRing) * Math.PI * 2 + angleOffset;
        nodes.push({ x, y: centerY + radius * Math.cos(theta), z: radius * Math.sin(theta) });
      }
    }

    for (let ring = 0; ring < rings - 1; ring++) {
      for (let point = 0; point < pointsPerRing; point++) {
        const nextPoint = (point - 1 + pointsPerRing) % pointsPerRing;
        const current = nodes[ring * pointsPerRing + point];
        const straight = nodes[(ring + 1) * pointsPerRing + point];
        const diagonal = nodes[(ring + 1) * pointsPerRing + nextPoint];
        edges.push({ id: `tube-${ring}-${point}-straight`, x1: current.x, y1: current.y, x2: straight.x, y2: straight.y, z: (current.z + straight.z) / 2 });
        edges.push({ id: `tube-${ring}-${point}-diagonal`, x1: current.x, y1: current.y, x2: diagonal.x, y2: diagonal.y, z: (current.z + diagonal.z) / 2 });
      }
    }

    return { backEdges: edges.filter((edge) => edge.z < 0), frontEdges: edges.filter((edge) => edge.z >= 0) };
  }, []);

  const defaultViewBox = "0 0 300 200";
  const viewBox = mode === "3D-Cage" ? "-240 -240 480 480" : mode === "1D" ? "0 20 500 200" : defaultViewBox;
  const ariaLabel = {
    "1D": "one-dimensional cylindrical channel",
    "2D": "two-dimensional slit pore",
    "3D-Cage": "three-dimensional framework cage",
    Membrane: "tortuous porous membrane",
    "0D-Pools": "isolated liquid pools",
    Gyroid: "bicontinuous gyroid channel",
  }[mode];

  const pcuModel = useMemo(() => {
    const S = 55;
    const L = 94;
    const yaw = 0.65;
    const pitch = -0.35;
    const rotate3D = (x: number, y: number, z: number) => {
      const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
      const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
      const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
      const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
      const fov = 900;
      const scale = fov / (fov - z2);
      return { x: x1 * scale, y: y2 * scale, z: z2, scale };
    };
    type Point3 = { x: number; y: number; z: number };
    type ProjectedPoint = ReturnType<typeof rotate3D>;
    type PcuItem =
      | { type: "octa_face"; id: string; points: ProjectedPoint[]; z: number; scale: number }
      | { type: "octa_edge" | "linker"; id: string; from: ProjectedPoint; to: ProjectedPoint; z: number; scale: number }
      | { type: "vertex"; id: string; point: ProjectedPoint; z: number; scale: number };
    const items: PcuItem[] = [];
    const bases = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => ({ x: x * L, y: y * L, z: z * L }))));
    const pointKey = (point: Point3) => `${point.x},${point.y},${point.z}`;
    const octahedra = new Map<string, Record<"xp" | "xn" | "yp" | "yn" | "zp" | "zn", Point3>>();
    const faceIndices = [["xp", "yp", "zp"], ["xp", "yp", "zn"], ["xp", "yn", "zp"], ["xp", "yn", "zn"], ["xn", "yp", "zp"], ["xn", "yp", "zn"], ["xn", "yn", "zp"], ["xn", "yn", "zn"]] as const;
    const vertexNames = ["xp", "xn", "yp", "yn", "zp", "zn"] as const;

    for (const base of bases) {
      const vertices = {
        xp: { x: base.x + S, y: base.y, z: base.z }, xn: { x: base.x - S, y: base.y, z: base.z },
        yp: { x: base.x, y: base.y + S, z: base.z }, yn: { x: base.x, y: base.y - S, z: base.z },
        zp: { x: base.x, y: base.y, z: base.z + S }, zn: { x: base.x, y: base.y, z: base.z - S },
      };
      octahedra.set(pointKey(base), vertices);
      const projected = Object.fromEntries(vertexNames.map((name) => [name, rotate3D(vertices[name].x, vertices[name].y, vertices[name].z)])) as Record<typeof vertexNames[number], ProjectedPoint>;
      for (const name of vertexNames) items.push({ type: "vertex", id: `vertex-${pointKey(base)}-${name}`, point: projected[name], z: projected[name].z, scale: projected[name].scale });
      for (const face of faceIndices) {
        const points = face.map((name) => projected[name]);
        items.push({ type: "octa_face", id: `face-${pointKey(base)}-${face.join("-")}`, points, z: points.reduce((sum, point) => sum + point.z, 0) / 3, scale: points.reduce((sum, point) => sum + point.scale, 0) / 3 });
      }
      for (let left = 0; left < vertexNames.length; left++) {
        for (let right = left + 1; right < vertexNames.length; right++) {
          const fromName = vertexNames[left];
          const toName = vertexNames[right];
          if (fromName[0] !== toName[0]) {
            const from = projected[fromName];
            const to = projected[toName];
            items.push({ type: "octa_edge", id: `edge-${pointKey(base)}-${fromName}-${toName}`, from, to, z: (from.z + to.z) / 2, scale: (from.scale + to.scale) / 2 });
          }
        }
      }
    }
    for (const base of bases) {
      for (const axis of ["x", "y", "z"] as const) {
        if (base[axis] !== -L) continue;
        const neighbor = { ...base, [axis]: L };
        const current = octahedra.get(pointKey(base))!;
        const adjacent = octahedra.get(pointKey(neighbor))!;
        const fromName = `${axis}p` as "xp" | "yp" | "zp";
        const toName = `${axis}n` as "xn" | "yn" | "zn";
        const from = rotate3D(current[fromName].x, current[fromName].y, current[fromName].z);
        const to = rotate3D(adjacent[toName].x, adjacent[toName].y, adjacent[toName].z);
        items.push({ type: "linker", id: `linker-${pointKey(base)}-${axis}`, from, to, z: (from.z + to.z) / 2, scale: (from.scale + to.scale) / 2 });
      }
    }
    return items.sort((left, right) => left.z - right.z);
  }, []);
  return (
    <svg viewBox={viewBox} preserveAspectRatio={mode === "3D-Cage" ? "xMidYMid meet" : "xMidYMid slice"} className="block h-full w-full" role="img" aria-label={ariaLabel}>
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
        <radialGradient id={steelBall} cx="32%" cy="27%" r="72%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#cbd5e1" />
          <stop offset="1" stopColor="#475569" />
        </radialGradient>

        <linearGradient id={`${pfx}-tube-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="black" stopOpacity="0" />
          <stop offset="0.09" stopColor="white" />
          <stop offset="0.91" stopColor="white" />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </linearGradient>
        <mask id={tubeFadeMask}>
          <rect x="0" y="20" width="500" height="200" fill={`url(#${pfx}-tube-fade)`} />
        </mask>

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
        <path id={cageTravelPath} d="M-102 22 C-74 22 -52 8 -34 -2 C-12 -14 12 -14 34 -2 C54 10 74 22 102 22" fill="none" stroke="none" />

      </defs>

      {mode !== "3D-Cage" && <rect x="0" y="0" width="100%" height="100%" rx="16" fill={softBg} />}

      {/* 1D: a depth-sorted carbon nanotube lattice encloses strictly axial ion motion. */}
      {mode === "1D" && (
        <g mask={`url(#${tubeFadeMask})`}>
          <g opacity="0.15">
            {tubeData.backEdges.map((edge) => <line key={edge.id} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={bgSkeleton} strokeWidth="1.2" />)}
          </g>
          <line x1="0" y1="70" x2="500" y2="70" stroke={bgSkeleton} strokeWidth="2.5" strokeDasharray="8 4" opacity="0.6" />
          <line x1="0" y1="170" x2="500" y2="170" stroke={bgSkeleton} strokeWidth="2.5" strokeDasharray="8 4" opacity="0.6" />
          <circle cy="115" r="9" fill={cationColor}>
            {active && <animate attributeName="cx" values="50; 450; 50" dur="4s" repeatCount="indefinite" calcMode="spline" keyTimes="0; 0.5; 1" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />}
          </circle>
          <circle cy="125" r="9" fill={anionColor}>
            {active && <animate attributeName="cx" values="430; 70; 430" dur="5.5s" repeatCount="indefinite" calcMode="spline" keyTimes="0; 0.5; 1" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />}
          </circle>
          <g opacity="0.75">
            {tubeData.frontEdges.map((edge) => <line key={edge.id} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={bgSkeleton} strokeWidth="1.5" />)}
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

      {/* 3D-Cage: a pcu net of octahedral nodes, depth sorted with Painter's Algorithm. */}
      {mode === "3D-Cage" && (
        <g>
          <g data-testid="pcu-octahedral-mof" transform="scale(1.12)">
            {pcuModel.map((item) => {
              const depthOpacity = Math.max(0.25, Math.min(1, (item.z + 180) / 320));
              if (item.type === "octa_face") {
                return <polygon key={item.id} points={item.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="rgba(241, 245, 249, 0.92)" stroke="#cbd5e1" strokeWidth="0.5" />;
              }
              if (item.type === "vertex") {
                return <circle key={item.id} cx={item.point.x} cy={item.point.y} r={6 * item.scale} fill={`url(#${steelBall})`} opacity={depthOpacity} />;
              }
              return <line key={item.id} x1={item.from.x} y1={item.from.y} x2={item.to.x} y2={item.to.y} stroke={item.type === "octa_edge" ? "#475569" : "#334155"} strokeWidth={(item.type === "octa_edge" ? 3 : 5) * item.scale} strokeLinecap="round" opacity={depthOpacity} />;
            })}
          </g>
          <circle r="20" fill={cationColor}>
            {active && <animateMotion dur="5.8s" repeatCount="indefinite"><mpath href={`#${cageTravelPath}`} /></animateMotion>}
          </circle>
          <circle r="20" fill={anionColor}>
            {active && <animateMotion dur="6.7s" begin="-2.1s" repeatCount="indefinite"><mpath href={`#${cageTravelPath}`} /></animateMotion>}
          </circle>
        </g>
      )}
    </svg>
  );
}
