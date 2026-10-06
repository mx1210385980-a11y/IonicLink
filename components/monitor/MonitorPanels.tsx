"use client";

import { useEffect, useRef, useState } from "react";
import { MODULES, TODAY_POINTS, WEEK_POINTS, type DemoState, type UsageEvent } from "./demo";

export const PANEL = "min-w-0 rounded-xl border border-[#e0e5eb] bg-white p-4";
export const CONTROL = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#d8dfe7] bg-white px-3 text-xs font-medium text-[#344256] transition hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40";
export const INPUT = "h-9 min-w-0 rounded-lg border border-[#d8dfe7] bg-white px-3 text-xs text-[#344256] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

export function TrendChart({ period, onPeriodChange, tick }: { period: "today" | "week"; onPeriodChange: (period: "today" | "week") => void; tick: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const graphic = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = graphic.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const labels = period === "today" ? ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"] : ["09/24", "09/25", "09/26", "09/27", "09/28", "09/29", "09/30"];
  const points = (period === "today" ? TODAY_POINTS : WEEK_POINTS).map((value, i, all) => i === all.length - 1 ? value + (period === "today" ? tick % 9 : Math.floor(tick / 6)) : value);
  const maximum = Math.max(period === "today" ? 80 : 200, Math.ceil(Math.max(...points) / 20) * 20);
  const x = (i: number) => 38 + i * (width - 56) / (points.length - 1);
  const y = (value: number) => 150 - value / maximum * 120;
  const line = points.map((value, i) => `${i ? "L" : "M"}${x(i)},${y(value)}`).join(" ");
  return <section aria-labelledby="usage-trend-title" className={PANEL}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="usage-trend-title" className="text-base font-semibold">使用趋势</h2>
      <div aria-label="趋势时间范围" className="flex rounded-md border border-[#d8dfe7] p-0.5">{([['today', '今天'], ['week', '近7天']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={period === key} onClick={() => { setHovered(null); onPeriodChange(key); }} className={`min-h-7 rounded px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${period === key ? "bg-brand-700 text-white" : "text-[#617080] hover:bg-ink-50"}`}>{label}</button>)}</div>
    </div>
    <p className="mt-1 text-xs text-[#617080]">活跃用户 · {period === "today" ? "每小时" : "每日"}</p>
    <svg ref={graphic} viewBox={`0 0 ${width} 180`} role="img" aria-label={`${period === "today" ? "今天每小时" : "近7天每日"}活跃用户趋势（演示数据）`} className="mt-1 h-[180px] w-full" onMouseLeave={() => setHovered(null)}>
      <defs><linearGradient id="usage-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity="0.2" /><stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(step => <g key={step}><line x1="38" x2={width - 18} y1={y(step * maximum / 4)} y2={y(step * maximum / 4)} stroke="#e9edf2" /><text x="28" y={y(step * maximum / 4) + 4} textAnchor="end" fill="#617080" fontSize="12">{step * maximum / 4}</text></g>)}
      <path d={`${line} L${width - 18},150 L38,150 Z`} fill="url(#usage-area)" /><path d={line} fill="none" stroke="#0d9488" strokeWidth="2.5" />
      {points.map((value, i) => <g key={labels[i]}>{(width >= 480 || i % 2 === 0) && <text x={x(i)} y="173" textAnchor="middle" fill="#617080" fontSize="12">{labels[i]}</text>}<circle cx={x(i)} cy={y(value)} r={hovered === i ? 5 : 3.5} fill="#0d9488" tabIndex={0} aria-label={`${labels[i]}，${value} 位活跃用户`} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(i)}><title>{`${labels[i]} · ${value} 位活跃用户`}</title></circle></g>)}
      {hovered !== null && hovered < points.length && <g aria-hidden="true"><rect x={Math.min(width - 80, Math.max(38, x(hovered) - 34))} y={Math.max(4, y(points[hovered]) - 32)} width="70" height="24" rx="5" fill="#134e4a" /><text x={Math.min(width - 80, Math.max(38, x(hovered) - 34)) + 35} y={Math.max(4, y(points[hovered]) - 32) + 16} textAnchor="middle" fill="white" fontSize="12">{`${points[hovered]} 人`}</text></g>}
    </svg>
  </section>;
}

export function ModuleDistribution({ counts }: { counts: DemoState["moduleCounts"] }) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return <section aria-labelledby="module-distribution-title" className={PANEL}>
    <h2 id="module-distribution-title" className="text-base font-semibold">模块使用分布</h2><p className="mt-1 text-xs text-[#617080]">{total} 次操作 · 演示样本</p>
    <div className="mt-6 space-y-5">{MODULES.map((module, i) => <div key={module} className="grid grid-cols-[8.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
      <span className="truncate" title={module}>{module}</span><div className="h-3.5 overflow-hidden rounded bg-[#f0f3f7]"><div className={`h-full rounded transition-[width] duration-500 ${['bg-brand-600', 'bg-indigo-500', 'bg-blue-400', 'bg-blue-300'][i]}`} style={{width: `${counts[i] / Math.max(...counts, 1) * 100}%`}} /></div><span className="text-right tabular-nums text-[#617080]">{counts[i]}</span>
    </div>)}</div>
  </section>;
}

export function EventStream({ events, running }: { events: UsageEvent[]; running: boolean }) {
  return <section aria-labelledby="usage-events-title" className={PANEL}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="usage-events-title" className="text-base font-semibold">实时事件</h2><span className="inline-flex items-center gap-1.5 text-xs text-brand-700"><span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-brand-600 motion-safe:animate-pulse" : "bg-slate-400"}`} />{running ? "演示更新中" : "已暂停"}</span></div>
    <ol aria-label="演示操作事件" className="mt-3 divide-y divide-[#edf0f4]">{events.map(event => <li key={event.id} aria-label={`${event.time} · ${event.user} · ${event.module} · ${event.message}`} className="flex items-center gap-2 py-3 text-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${event.success ? "bg-brand-600" : "bg-amber-500"}`} /><time className="shrink-0 tabular-nums text-[#617080]">{event.time}</time><span className="shrink-0 font-medium">{event.user}</span><p className="min-w-0 truncate text-[#344256]" title={`${event.module} · ${event.message}`}>{event.message}</p></li>)}</ol>
  </section>;
}
