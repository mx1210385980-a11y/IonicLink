"use client";

import React, { useMemo, useRef, useState, type PointerEvent } from "react";
import type { AnalysisField, AnalysisRecord, PlotConfig } from "./analysisTypes";
import { axisDomain, axisPosition, axisTicks, buildScatterPoints, formatAxisNumber, MAX_PLOT_POINTS, scatterColor, selectPointsInBox, type AxisDomain, type ScatterPoint } from "./scatterPlot";

export interface DatabaseScatterPlotProps {
  records: AnalysisRecord[];
  fields: AnalysisField[];
  config: PlotConfig;
  onConfigChange: (value: PlotConfig) => void;
  selectedIds: ReadonlySet<string>;
  onSelectRecords: (ids: string[] | null) => void;
  onOpenRecord: (record: AnalysisRecord) => void;
  onToggleCompare: (record: AnalysisRecord) => void;
  compareIds: ReadonlySet<string>;
  disabled: boolean;
}

const WIDTH = 660, HEIGHT = 340;
const LEFT = 78, RIGHT = 632, TOP = 22, BOTTOM = 278;
const controlClass = "rounded-lg border border-ink-200 bg-white px-2.5 py-2 text-xs text-ink-800 disabled:opacity-50";

function axisLabel(field: AnalysisField) { return `${field.label}${field.unit ? ` (${field.unit})` : ""}`; }

function ScatterPanel({ points, title, xField, yField, config, xDomain, yDomain, selectedIds, disabled, onInspect, onSelectRecords }: {
  points: ScatterPoint[]; title: string; xField: AnalysisField; yField: AnalysisField; config: PlotConfig;
  xDomain: AxisDomain; yDomain: AxisDomain; selectedIds: ReadonlySet<string>; disabled: boolean;
  onInspect: (id: string) => void; onSelectRecords: (ids: string[] | null) => void;
}) {
  const [drag, setDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const project = (point: ScatterPoint) => ({ x: axisPosition(point.x, xDomain, LEFT, RIGHT, config.logX), y: axisPosition(point.y, yDomain, BOTTOM, TOP, config.logY) });
  const localPosition = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: Math.max(LEFT, Math.min(RIGHT, local.x)), y: Math.max(TOP, Math.min(BOTTOM, local.y)) };
  };
  return <section className="min-w-0 rounded-xl border border-ink-100 bg-white p-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="truncate text-xs font-semibold text-ink-800" title={title}>{title} <span className="font-normal text-ink-500">· {points.length} points</span></h3>
      <button type="button" className="shrink-0 text-xs font-medium text-cyan-700 disabled:opacity-50" disabled={disabled || !points.length} onClick={() => onSelectRecords(points.map((point) => point.record.id))}>Select group</button>
    </div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full touch-none" role="group" aria-label={`${title}: ${axisLabel(yField)} versus ${axisLabel(xField)}. Drag to select points or focus a point and press Enter.`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || (event.target as Element).closest("[data-point]")) return;
        const position = localPosition(event); if (!position) return;
        const next = { x1: position.x, y1: position.y, x2: position.x, y2: position.y };
        dragRef.current = next; setDrag(next); event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        const position = localPosition(event); if (!position) return;
        const next = { ...dragRef.current, x2: position.x, y2: position.y }; dragRef.current = next; setDrag(next);
      }}
      onPointerUp={(event) => {
        const box = dragRef.current;
        if (!box) return;
        const position = localPosition(event);
        const finalBox = position ? { ...box, x2: position.x, y2: position.y } : box;
        if (Math.abs(finalBox.x2 - finalBox.x1) > 4 || Math.abs(finalBox.y2 - finalBox.y1) > 4) onSelectRecords(selectPointsInBox(points, finalBox, project));
        dragRef.current = null; setDrag(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
      onLostPointerCapture={() => { dragRef.current = null; setDrag(null); }}>
      <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="#fafcfd" />
      {axisTicks(xDomain, config.logX).map((tick, index) => {
        const position = LEFT + tick.fraction * (RIGHT - LEFT);
        return <g key={`x-${index}`}><line x1={position} x2={position} y1={TOP} y2={BOTTOM} stroke="#e2e8f0" /><text x={position} y={BOTTOM + 19} textAnchor="middle" fontSize="11" fill="#64748b">{formatAxisNumber(tick.value)}</text></g>;
      })}
      {axisTicks(yDomain, config.logY).map((tick, index) => {
        const position = BOTTOM - tick.fraction * (BOTTOM - TOP);
        return <g key={`y-${index}`}><line x1={LEFT} x2={RIGHT} y1={position} y2={position} stroke="#e2e8f0" /><text x={LEFT - 10} y={position + 4} textAnchor="end" fontSize="11" fill="#64748b">{formatAxisNumber(tick.value)}</text></g>;
      })}
      <text x={(LEFT + RIGHT) / 2} y={HEIGHT - 13} textAnchor="middle" fontSize="12" fill="#334155">{axisLabel(xField)}{config.logX ? " · log scale" : ""}</text>
      <text transform={`translate(14 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#334155">{axisLabel(yField)}{config.logY ? " · log scale" : ""}</text>
      {points.map((point) => {
        const position = project(point);
        const selected = selectedIds.has(point.record.id);
        return <circle key={point.record.id} data-point={point.record.id} cx={position.x} cy={position.y} r={selected ? 6 : 4.5}
          fill={scatterColor(point.group)} opacity={selectedIds.size && !selected ? 0.22 : 0.78} stroke={selected ? "#0f172a" : "white"} strokeWidth={selected ? 2 : 1}
          role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`${point.record.id}: ${axisLabel(xField)} ${formatAxisNumber(point.x)}, ${axisLabel(yField)} ${formatAxisNumber(point.y)}; ${point.group}. Open point details.`}
          className="cursor-pointer focus:outline-none focus:stroke-ink-900 focus:stroke-[3]"
          onClick={() => { if (!disabled) onInspect(point.record.id); }}
          onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onInspect(point.record.id); } }}>
          <title>{`${point.record.id} · ${point.record.paper.title} · ${axisLabel(xField)}: ${formatAxisNumber(point.x)} · ${axisLabel(yField)}: ${formatAxisNumber(point.y)}`}</title>
        </circle>;
      })}
      {drag && <rect x={Math.min(drag.x1, drag.x2)} y={Math.min(drag.y1, drag.y2)} width={Math.abs(drag.x2 - drag.x1)} height={Math.abs(drag.y2 - drag.y1)} fill="#0891b2" fillOpacity="0.13" stroke="#0891b2" strokeDasharray="4 3" pointerEvents="none" />}
    </svg>
  </section>;
}

export function DatabaseScatterPlot({ records, fields, config, onConfigChange, selectedIds, onSelectRecords, onOpenRecord, onToggleCompare, compareIds, disabled }: DatabaseScatterPlotProps) {
  const [activeId, setActiveId] = useState("");
  const numericFields = fields.filter((field) => field.numeric);
  const xField = numericFields.find((field) => field.key === config.x);
  const yField = numericFields.find((field) => field.key === config.y);
  const data = useMemo(() => xField && yField ? buildScatterPoints(records, xField, yField, config) : { points: [], excluded: {}, excludedCount: records.length }, [records, xField, yField, config]);
  const visiblePoints = useMemo(() => data.points.slice(0, MAX_PLOT_POINTS), [data.points]);
  const groups = useMemo(() => {
    const map = new Map<string, ScatterPoint[]>();
    for (const point of visiblePoints) {
      const name = config.groupBy === "method" ? point.group : "All methods · check experimental conditions before comparing";
      const group = map.get(name) || []; group.push(point); map.set(name, group);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visiblePoints, config.groupBy]);
  const domains = useMemo(() => ({ x: axisDomain(visiblePoints.map((point) => point.x), config.logX), y: axisDomain(visiblePoints.map((point) => point.y), config.logY) }), [visiblePoints, config.logX, config.logY]);
  const legend = useMemo(() => [...new Set(visiblePoints.map((point) => point.group))].sort(), [visiblePoints]);
  const activePoint = visiblePoints.find((point) => point.record.id === activeId);
  const overlapping = activePoint ? visiblePoints.filter((point) => point.x === activePoint.x && point.y === activePoint.y && (config.groupBy !== "method" || point.group === activePoint.group)) : [];
  return <div className="space-y-4" data-testid="database-scatter-plot">
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-100 bg-white p-4">
      {(["x", "y"] as const).map((axis) => <label key={axis} className="grid gap-1.5 text-xs font-medium text-ink-600">{axis.toUpperCase()} axis · canonical units
        <select aria-label={`${axis.toUpperCase()} axis`} className={controlClass} disabled={disabled} value={config[axis]} onChange={(event) => onConfigChange({ ...config, [axis]: event.target.value })}>
          {numericFields.map((field) => <option key={field.key} value={field.key}>{axisLabel(field)}</option>)}
        </select>
      </label>)}
      <label className="grid gap-1.5 text-xs font-medium text-ink-600">Color / panels<select className={controlClass} aria-label="Plot grouping" value={config.groupBy} disabled={disabled} onChange={(event) => onConfigChange({ ...config, groupBy: event.target.value as PlotConfig["groupBy"] })}>
        <option value="method">Method · separate panels</option><option value="paper">Paper · combined panel</option><option value="cation">Cation · combined panel</option>
      </select></label>
      <label className="flex items-center gap-2 py-2 text-xs text-ink-600"><input type="checkbox" checked={config.logX} disabled={disabled} onChange={(event) => onConfigChange({ ...config, logX: event.target.checked })} />Log X</label>
      <label className="flex items-center gap-2 py-2 text-xs text-ink-600"><input type="checkbox" checked={config.logY} disabled={disabled} onChange={(event) => onConfigChange({ ...config, logY: event.target.checked })} />Log Y</label>
      <button type="button" disabled={disabled} className={controlClass} onClick={() => onSelectRecords(null)}>Clear point selection</button>
    </div>
    <div className="space-y-1 text-xs text-ink-500" aria-live="polite">
      <p><strong className="text-ink-700">{visiblePoints.length} plotted</strong> of {records.length} filtered records · {data.excludedCount} excluded. Axes use canonical units. Panels share axis limits.</p>
      {data.excludedCount > 0 && <p>Exclusion reasons (a record may have more than one): {Object.entries(data.excluded).map(([reason, count]) => `${reason}: ${count}`).join(" · ") || "Choose two available numeric fields."}</p>}
      {data.points.length > MAX_PLOT_POINTS && <p className="font-medium text-amber-700">Display limit: first {MAX_PLOT_POINTS.toLocaleString()} of {data.points.length.toLocaleString()} eligible records. Narrow filters to view the remainder. Point selection applies to displayed records.</p>}
      <p>Drag a rectangle to filter the results and export. Click a point for its source and comparison actions. Keyboard: choose a record below or focus a point and press Enter. Equal coordinates stay in place.</p>
    </div>
    {!!legend.length && <div className="flex max-h-24 flex-wrap gap-x-4 gap-y-2 overflow-auto text-xs text-ink-600" aria-label="Plot legend">{legend.map((group) => <span key={group} className="inline-flex max-w-full items-center gap-1.5" title={group}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: scatterColor(group) }} /><span className="max-w-64 truncate">{group}</span></span>)}</div>}
    {xField && yField && visiblePoints.length ? <>
      <div className={`grid gap-4 ${groups.length > 1 ? "xl:grid-cols-2" : ""}`}>{groups.map(([name, points]) => <ScatterPanel key={`${name}-${config.x}-${config.y}-${config.logX}-${config.logY}`} points={points} title={name} xField={xField} yField={yField} config={config} xDomain={domains.x} yDomain={domains.y} selectedIds={selectedIds} disabled={disabled} onInspect={setActiveId} onSelectRecords={onSelectRecords} />)}</div>
      <label className="flex flex-wrap items-center gap-3 text-xs font-medium text-ink-600">Inspect a plotted record
        <select className={`${controlClass} max-w-full`} aria-label="Inspect a plotted record" value={activePoint?.record.id || ""} disabled={disabled} onChange={(event) => setActiveId(event.target.value)}>
          <option value="">Choose a record…</option>{visiblePoints.map((point) => <option key={point.record.id} value={point.record.id}>{point.record.id} · {point.group} · {formatAxisNumber(point.x)}, {formatAxisNumber(point.y)}</option>)}
        </select>
      </label>
    </> : <div className="rounded-xl border border-dashed border-ink-200 px-6 py-12 text-center text-sm text-ink-500">No eligible points for these axes. Change the axes, log scale, or filters.</div>}
    {activePoint && xField && yField && <section aria-label="Point details" className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/40 p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-ink-900">{activePoint.record.id} · {activePoint.group}</h3><p className="mt-1 text-xs text-ink-600">{activePoint.record.paper.title}{activePoint.record.paper.year ? ` (${activePoint.record.paper.year})` : ""}</p></div><button className="text-xs text-ink-500" type="button" onClick={() => setActiveId("")}>Close details</button></div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">{[xField, yField].map((field, index) => <div key={`${field.key}-${index}`}><dt className="font-semibold text-ink-700">{axisLabel(field)}</dt><dd className="mt-1 text-ink-600">{field.format(activePoint.record, "std")} · Reported: {field.format(activePoint.record, "raw")}</dd><dd className="mt-1 text-ink-500">{sourceLabel(activePoint.record, field)}</dd></div>)}</dl>
      {activePoint.record.paper.doi && <p className="break-all text-xs text-ink-500">DOI: {activePoint.record.paper.doi}</p>}
      {overlapping.length > 1 && <div className="text-xs text-ink-600"><p>{overlapping.length} records share this position:</p><div className="mt-1 flex flex-wrap gap-2">{overlapping.map((point) => <button type="button" className="underline underline-offset-2" key={point.record.id} onClick={() => setActiveId(point.record.id)}>{point.record.id}</button>)}</div></div>}
      <div className="flex flex-wrap gap-2"><button type="button" className={controlClass} disabled={disabled} onClick={() => onOpenRecord(activePoint.record)}>View record &amp; evidence</button><button type="button" className={controlClass} disabled={disabled} onClick={() => onToggleCompare(activePoint.record)}>{compareIds.has(activePoint.record.id) ? "Remove from comparison" : "Add to comparison"}</button><button type="button" className={controlClass} disabled={disabled} onClick={() => onSelectRecords([activePoint.record.id])}>Select this record</button></div>
    </section>}
  </div>;
}

function sourceLabel(record: AnalysisRecord, field: AnalysisField) {
  const source = record.provenance?.[field.provenanceKey || field.key];
  if (!source) return "Evidence: unassessed";
  return [source.basis || "unassessed", source.page ? `page ${source.page}` : "", source.figure, source.table, source.section].filter(Boolean).join(" · ");
}
