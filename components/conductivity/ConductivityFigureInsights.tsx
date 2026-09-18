"use client";

import { useState } from "react";
import type { ConductivityPerformanceFigure, ConductivityRecord, ConductivityCurveKeyPoint, ConductivityPropertyDependency } from "@/lib/conductivity/schema";
import type { Domain } from "@/lib/domain";
import { pointDisplayLabel, pointInterpretation, visibleCurveKeyPoints } from "@/lib/conductivity/curveInsights";
import { openRecordEvidence } from "../recordCardParts";

export function ConductivityPerformanceFigurePanel({ figure, record, domain }: {
  figure: ConductivityPerformanceFigure; record: ConductivityRecord; domain: Domain;
}) {
  const [index,setIndex]=useState(0);
  const [failedUrl,setFailedUrl]=useState<string|null>(null);
  const panels=figure.panels??[];
  const activeIndex=Math.min(index,Math.max(0,panels.length-1));
  const panel=panels[activeIndex];
  const box=panel?.figureBox??figure.figureBox;
  const label=panel ? `${figure.figure.replace(/(\d)\s*[a-t]\b/i,"$1")} · ${panel.label}` : figure.figure;
  const curveType=panel?.curveType??figure.curveType;
  const xAxis=panel?.xAxis??figure.xAxis, yAxis=panel?.yAxis??figure.yAxis;
  const points=visibleCurveKeyPoints(figure,panel);
  const canOpen=!!record.sourceId&&figure.page!=null;
  const url=canOpen?`/api/${domain}/source/${encodeURIComponent(record.sourceId!)}/page/${figure.page}?format=figure&figure=${encodeURIComponent(label)}${box?`&box=${[box.x,box.y,box.w,box.h].join(",")}`:""}`:null;
  const openSource=(point?: ConductivityCurveKeyPoint)=>{
    if(!canOpen)return;
    const fieldSource=record.provenance?.[point?.field??"performanceFigure"];
    const samePage=point?.sourcePage==null||point.sourcePage===figure.page;
    openRecordEvidence({domain,sourceId:record.sourceId,recordId:record.id,field:point?.field??"performanceFigure",value:point?.value??label,
      prov:{...fieldSource,page:point?.sourcePage??figure.page,figure:samePage?label:fieldSource?.figure,figureBox:samePage?box:undefined,quote:point?.evidence??(point?fieldSource?.quote:figure.caption)}});
  };
  const move=(step:number)=>setIndex((activeIndex+step+panels.length)%panels.length);
  return <div data-testid="performance-figure" className="overflow-hidden rounded-xl border border-cyan-200 bg-white">
    <div className="flex items-center justify-between gap-2 border-b border-cyan-100 bg-cyan-50/50 px-3 py-2">
      <div className="min-w-0"><div className="label-eyebrow">Performance curve</div><div className="mt-0.5 text-sm font-semibold leading-snug">{curveType}</div></div>
      <button type="button" disabled={!canOpen} onClick={()=>openSource()} className="shrink-0 rounded-md border border-cyan-100 bg-white px-2 py-1 font-mono text-[10px] hover:bg-cyan-50" aria-label={`Open ${label} in source PDF`}>{label} · p.{figure.page??"?"} ↗</button>
    </div>
    <button type="button" onClick={()=>openSource()} disabled={!canOpen} className="block h-[220px] w-full bg-white p-2" aria-label="View the full-resolution source figure">
      {url&&failedUrl!==url ? /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt={`${label} ${curveType}`} className="h-full w-full object-contain" loading="lazy" onError={()=>setFailedUrl(url)}/> :
        <span className="text-xs text-ink-500">{canOpen?"A clean panel crop is unavailable. Open the source page.":"The source PDF is not linked."}</span>}
    </button>
    {panels.length>1&&<nav data-testid="performance-figure-pagination" className="flex items-center justify-between border-t border-cyan-100 px-3 py-1.5" aria-label="Performance figure pagination">
      <button type="button" aria-label="Previous curve panel" onClick={()=>move(-1)} className="rounded border border-ink-100 px-2 py-0.5 hover:bg-cyan-50">‹</button>
      <span className="font-mono text-[10px]">Panel {panel.label} · {activeIndex+1}/{panels.length}</span>
      <button type="button" aria-label="Next curve panel" onClick={()=>move(1)} className="rounded border border-ink-100 px-2 py-0.5 hover:bg-cyan-50">›</button>
    </nav>}
    <div className="space-y-2 border-t border-cyan-100 bg-slate-50/60 p-2.5">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-500">
        {xAxis&&<span><b>X</b> · {xAxis}</span>}{yAxis&&<span><b>Y</b> · {yAxis}</span>}
      </div>
      {(record.core.temperature?.raw||record.core.electrodePotential?.raw)&&<div className="text-[10px] leading-relaxed text-ink-500">Record conditions · {[record.core.temperature?.raw,record.core.electrodePotential?.raw?`${record.core.electrodePotential.raw}${record.extended.potentialReference?` vs ${record.extended.potentialReference}`:""}`:null].filter(Boolean).join(" · ")}</div>}
      <div data-testid="performance-figure-key-data">
        <div className="mb-1.5 flex items-center justify-between gap-2"><span className="label-eyebrow">Curve insights · key readings</span><span className="text-[9px] text-ink-500">Sparse landmarks, not a full series</span></div>
        {points.length ? <div className={`grid gap-1.5 ${points.length>1?"grid-cols-2":"grid-cols-1"}`}>{points.slice(0,4).map((point,i)=><Insight key={i} point={point} open={()=>openSource(point)}/>)}</div>:
          <p className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs">No numeric value can yet be assigned reliably to this series; placeholders are never substituted.</p>}
        {points.length>4&&<details className="mt-1.5 text-xs"><summary className="cursor-pointer py-1">More key readings ({points.length-4})</summary><div className="mt-1 grid grid-cols-2 gap-1.5">{points.slice(4).map((point,i)=><Insight key={i} point={point} open={()=>openSource(point)}/>)}</div></details>}
      </div>
      {figure.seriesLabel&&<details className="text-[10px]"><summary className="cursor-pointer text-ink-500">Matching series / sample</summary><p className="pt-1 leading-relaxed [overflow-wrap:anywhere]">{figure.seriesLabel}</p></details>}
    </div>
  </div>;
}

function Insight({point,open}:{point:ConductivityCurveKeyPoint;open:()=>void}) {
  const meaning=pointInterpretation(point);
  return <div data-testid="curve-insight" className="min-w-0 rounded-lg border border-cyan-100 bg-white p-2">
    <div className="text-[10px] font-semibold leading-snug">{pointDisplayLabel(point)}</div>
    <div className="my-1 font-mono text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{point.source==="image-estimated"?"≈ ":""}{point.value}</div>
    {(point.x||point.y)&&<div className="mb-1 font-mono text-[10px]">{[point.x?`x: ${point.x}`:"",point.y?`y: ${point.y}`:""].filter(Boolean).join(" · ")}</div>}
    {meaning&&<p className="text-[11px] leading-relaxed text-ink-600">{meaning}</p>}
    {point.scope==="figure-comparison"&&<span className="mt-1 block text-[9px] text-ink-500">Within-figure comparison · not a single-record value</span>}
    <button type="button" onClick={open} title={[point.condition,point.evidence,point.note].filter(Boolean).join("\n")} className="mt-1.5 text-left text-[9px] text-ink-400 underline decoration-dotted underline-offset-2">
      {point.source==="image-estimated"?"Image estimate · not a raw measurement":point.source==="figure-annotation"?"Figure annotation":"Reported by paper"}{point.sourcePage?` · p.${point.sourcePage}`:""} ↗
    </button>
  </div>;
}

const TREND_LABEL: Record<ConductivityPropertyDependency["trend"], string> = {
  increases: "Increases with X ↗",
  decreases: "Decreases with X ↘",
  "non-monotonic": "Non-monotonic ∿",
  "approximately-constant": "Approximately constant →",
  comparison: "Conditional comparison",
};

export function ConductivityDependenciesPanel({ dependencies }: { dependencies: ConductivityPropertyDependency[] }) {
  if (!dependencies.length) return null;
  return <section data-testid="property-dependencies" className="rounded-xl border border-violet-200 bg-violet-50/45 p-2.5">
    <div className="flex items-start justify-between gap-2">
      <div><p className="label-eyebrow text-violet-800">Property dependence</p><p className="mt-1 text-[10px] leading-relaxed text-violet-950">A sparse landmark relationship, not a complete curve or a claim of causality.</p></div>
      <span className="shrink-0 rounded-full bg-white px-2 py-1 font-mono text-[9px] text-violet-700">Y = f(X)</span>
    </div>
    <div className="mt-2 space-y-2">
      {dependencies.map((dependency, index) => <DependencyCard key={`${dependency.dependentField}-${dependency.independentVariable}-${index}`} dependency={dependency} />)}
    </div>
  </section>;
}

function DependencyCard({ dependency }: { dependency: ConductivityPropertyDependency }) {
  return <article className="rounded-lg border border-violet-100 bg-white p-2.5">
    <div className="flex flex-wrap items-start justify-between gap-1.5">
      <h4 className="text-[11px] font-semibold leading-snug text-ink-900">{dependency.label}</h4>
      <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-800">{TREND_LABEL[dependency.trend]}</span>
    </div>
    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">{dependency.statement}</p>
    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label={`${dependency.label} observations`}>
      {dependency.observations.map((observation, index) => <div key={`${observation.x}-${observation.y}-${index}`} className="min-w-[7.5rem] rounded-md border border-ink-100 bg-slate-50 px-2 py-1.5">
        <div className="truncate font-mono text-[9px] text-ink-500" title={observation.seriesLabel}>{observation.seriesLabel || observation.x}</div>
        <div className="mt-0.5 font-mono text-[10px] font-semibold text-ink-900">{observation.x} → {observation.y}</div>
        {observation.condition&&<div className="mt-0.5 truncate text-[9px] text-ink-400" title={observation.condition}>{observation.condition}</div>}
      </div>)}
    </div>
    <div className="mt-1 flex flex-wrap gap-x-2 text-[9px] text-ink-400">
      {dependency.xAxis&&<span>X · {dependency.xAxis}</span>}{dependency.yAxis&&<span>Y · {dependency.yAxis}</span>}
      <span>{dependency.source === "record-comparison" ? "Same-paper record comparison" : dependency.source === "image-estimated" ? "Image estimate" : "Paper extraction"}</span>
      {dependency.confidence!=null&&<span>Confidence {Math.round(dependency.confidence*100)}%</span>}
    </div>
  </article>;
}
