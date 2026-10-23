"use client";

import { useEffect, useRef, useState } from "react";

export const PANEL = "min-w-0 rounded-xl border border-[#e0e5eb] bg-white p-4";
export const CONTROL = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#d8dfe7] bg-white px-3 text-xs font-medium text-[#344256] transition hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40";
export const INPUT = "h-9 min-w-0 rounded-lg border border-[#d8dfe7] bg-white px-3 text-xs text-[#344256] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

export type TrendData = { labels: string[]; points: number[] };
export type ModuleCount = { module: string; count: number };
export type StreamEvent = { id: number; time: string; user: string; module: string; message: string; success: boolean };

const BAR_COLORS = ["bg-brand-600", "bg-indigo-500", "bg-blue-400", "bg-blue-300", "bg-teal-400", "bg-sky-400", "bg-cyan-500", "bg-slate-400"];

export function TrendChart({ period, onPeriodChange, trend }: { period: "today" | "week"; onPeriodChange: (period: "today" | "week") => void; trend: TrendData }) {
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
  const { labels, points } = trend;
  const maximum = Math.max(4, Math.ceil(Math.max(...points, 1) / 4) * 4);
  const span = Math.max(points.length - 1, 1);
  const x = (i: number) => 38 + i * (width - 56) / span;
  const y = (value: number) => 150 - value / maximum * 120;
  const line = points.map((value, i) => `${i ? "L" : "M"}${x(i)},${y(value)}`).join(" ");
  return <section aria-labelledby="usage-trend-title" className={PANEL}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="usage-trend-title" className="text-base font-semibold">使用趋势</h2>
      <div aria-label="趋势时间范围" className="flex rounded-md border border-[#d8dfe7] p-0.5">{([['today', '今天'], ['week', '近7天']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={period === key} onClick={() => { setHovered(null); onPeriodChange(key); }} className={`min-h-7 rounded px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${period === key ? "bg-brand-700 text-white" : "text-[#617080] hover:bg-ink-50"}`}>{label}</button>)}</div>
    </div>
    <p className="mt-1 text-xs text-[#617080]">活跃用户 · {period === "today" ? "每小时" : "每日"}</p>
    <svg ref={graphic} viewBox={`0 0 ${width} 180`} role="img" aria-label={`${period === "today" ? "今天每小时" : "近7天每日"}活跃用户趋势`} className="mt-1 h-[180px] w-full" onMouseLeave={() => setHovered(null)}>
      <defs><linearGradient id="usage-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d9488" stopOpacity="0.2" /><stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(step => <g key={step}><line x1="38" x2={width - 18} y1={y(step * maximum / 4)} y2={y(step * maximum / 4)} stroke="#e9edf2" /><text x="28" y={y(step * maximum / 4) + 4} textAnchor="end" fill="#617080" fontSize="12">{step * maximum / 4}</text></g>)}
      <path d={`${line} L${width - 18},150 L38,150 Z`} fill="url(#usage-area)" /><path d={line} fill="none" stroke="#0d9488" strokeWidth="2.5" />
      {points.map((value, i) => <g key={labels[i]}>{(width >= 480 || i % 2 === 0) && <text x={x(i)} y="173" textAnchor="middle" fill="#617080" fontSize="12">{labels[i]}</text>}<circle cx={x(i)} cy={y(value)} r={hovered === i ? 5 : 3.5} fill="#0d9488" tabIndex={0} aria-label={`${labels[i]}，${value} 位活跃用户`} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} onMouseEnter={() => setHovered(i)}><title>{`${labels[i]} · ${value} 位活跃用户`}</title></circle></g>)}
      {hovered !== null && hovered < points.length && <g aria-hidden="true"><rect x={Math.min(width - 80, Math.max(38, x(hovered) - 34))} y={Math.max(4, y(points[hovered]) - 32)} width="70" height="24" rx="5" fill="#134e4a" /><text x={Math.min(width - 80, Math.max(38, x(hovered) - 34)) + 35} y={Math.max(4, y(points[hovered]) - 32) + 16} textAnchor="middle" fill="white" fontSize="12">{`${points[hovered]} 人`}</text></g>}
    </svg>
  </section>;
}

export function ModuleDistribution({ items }: { items: ModuleCount[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const peak = Math.max(...items.map(item => item.count), 1);
  return <section aria-labelledby="module-distribution-title" className={PANEL}>
    <h2 id="module-distribution-title" className="text-base font-semibold">模块使用分布</h2><p className="mt-1 text-xs text-[#617080]">{total} 次访问与操作</p>
    {items.length ? <div className="mt-6 space-y-5">{items.map((item, i) => <div key={item.module} className="grid grid-cols-[8.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
      <span className="truncate" title={item.module}>{item.module}</span><div className="h-3.5 overflow-hidden rounded bg-[#f0f3f7]"><div className={`h-full rounded transition-[width] duration-500 ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{width: `${item.count / peak * 100}%`}} /></div><span className="text-right tabular-nums text-[#617080]">{item.count}</span>
    </div>)}</div> : <p className="mt-6 text-xs text-[#617080]">所选时间范围内还没有使用记录。</p>}
  </section>;
}

export function EventStream({ events, running }: { events: StreamEvent[]; running: boolean }) {
  return <section aria-labelledby="usage-events-title" className={PANEL}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="usage-events-title" className="text-base font-semibold">实时事件</h2><span className="inline-flex items-center gap-1.5 text-xs text-brand-700"><span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-brand-600 motion-safe:animate-pulse" : "bg-slate-400"}`} />{running ? "自动刷新中" : "已暂停"}</span></div>
    {events.length ? <ol aria-label="操作事件" className="mt-3 divide-y divide-[#edf0f4]">{events.map(event => <li key={event.id} aria-label={`${event.time} · ${event.user} · ${event.module} · ${event.message}`} className="flex items-center gap-2 py-3 text-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${event.success ? "bg-brand-600" : "bg-amber-500"}`} /><time className="shrink-0 tabular-nums text-[#617080]">{event.time}</time><span className="shrink-0 font-medium">{event.user}</span><p className="min-w-0 truncate text-[#344256]" title={`${event.module} · ${event.message}`}>{event.message}</p></li>)}</ol>
      : <p className="mt-6 text-xs text-[#617080]">还没有使用事件。学生登录平台后，这里会显示真实的页面访问与操作记录。</p>}
  </section>;
}
