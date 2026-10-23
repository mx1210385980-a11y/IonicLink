"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CONTROL, EventStream, INPUT, ModuleDistribution, PANEL, TrendChart } from "./MonitorPanels";

type MonitorUser = { id: string; name: string; module: string; status: "在线" | "空闲"; minutes: number; operations: number };
type MonitorEvent = { id: number; at: string; user: string; module: string; message: string; success: boolean };
type MonitorFeedback = { id: string; at: string; user: string; kind: string; text: string; reply: string; repliedBy: string | null };
type Summary = {
  online: number;
  activeUsers: number;
  actionTotal: number;
  actionOk: number;
  pendingFeedback: number;
  modules: Array<{ module: string; count: number }>;
  trend: { labels: string[]; points: number[] };
  events: MonitorEvent[];
  users: MonitorUser[];
  feedback: MonitorFeedback[];
};

type Selection = { kind: "user" | "feedback"; id: string } | null;
type FeedbackFilter = "all" | "pending" | "replied";
const PRIMARY = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-xs font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-40";
const TH = "whitespace-nowrap bg-[#f7f9fb] px-3 py-1.5 text-left !text-xs !font-medium !text-[#617080]";
const TD = "border-t border-[#edf0f4] px-3 py-1 text-xs";
const REFRESH_MS = 15000;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
}

function feedbackTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const hm = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  return sameDay ? `今天 ${hm}` : `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${hm}`;
}

function usersCsv(users: MonitorUser[], period: string): string {
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return "﻿" + [["数据来源", "期间", "用户", "模块", "状态", "本次停留（分钟）", "操作次数"], ...users.map(user => ["平台使用日志", period, user.name, user.module, user.status, user.minutes, user.operations])].map(row => row.map(cell).join(",")).join("\r\n");
}

export function UsageMonitor() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [running, setRunning] = useState(true);
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [module, setModule] = useState("all");
  const [query, setQuery] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");
  const [selected, setSelected] = useState<Selection>(null);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async (selectedPeriod: "today" | "week") => {
    try {
      const response = await fetch(`/api/monitor/summary?period=${selectedPeriod}`, { cache: "no-store" });
      if (!response.ok) {
        setLoadError(response.status === 403 ? "当前账号没有查看使用监测的权限。" : "使用数据加载失败，请稍后重试。");
        return;
      }
      setLoadError("");
      setSummary((await response.json()) as Summary);
    } catch {
      setLoadError("使用数据加载失败，请检查网络连接。");
    }
  }, []);

  useEffect(() => { void refresh(period); }, [period, refresh]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(period), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [running, period, refresh]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (selected && !element.open) element.showModal();
    if (!selected && element.open) element.close();
  }, [selected]);

  const users = summary?.users ?? [];
  const feedback = summary?.feedback ?? [];
  const moduleNames = [...new Set(users.map(user => user.module))];
  const visibleUsers = users.filter(user => (module === "all" || user.module === module) && `${user.name} ${user.module}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shownFeedback = feedback.filter(item => feedbackFilter === "all" || (feedbackFilter === "pending" ? !item.reply : Boolean(item.reply)));
  const selectedUser = selected?.kind === "user" ? users.find(user => user.id === selected.id) : undefined;
  const selectedFeedback = selected?.kind === "feedback" ? feedback.find(item => item.id === selected.id) : undefined;
  const successRate = summary && summary.actionTotal > 0 ? `${(summary.actionOk / summary.actionTotal * 100).toFixed(1)}%` : "—";

  const openFeedback = (item: MonitorFeedback) => { setReply(item.reply); setSelected({ kind: "feedback", id: item.id }); };
  const exportUsers = () => {
    const blob = new Blob([usersCsv(visibleUsers, period === "today" ? "今天" : "近7天")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "ioniclink-usage.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`已导出 ${visibleUsers.length} 位活跃用户的使用数据。`);
  };
  const saveReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFeedback || !reply.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/monitor/feedback/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selectedFeedback.id, reply: reply.trim() }),
      });
      if (!response.ok) {
        setNotice("回复保存失败，请稍后重试。");
        return;
      }
      setSelected(null);
      setNotice("回复已保存，学生下次查看反馈时可见。");
      await refresh(period);
    } finally {
      setSaving(false);
    }
  };

  return <section lang="zh-CN" aria-labelledby="usage-monitor-title" className="mx-auto w-full max-w-[1600px] bg-[#fafafa] px-4 py-6 text-[#243246] sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 id="usage-monitor-title" className="text-[30px] font-semibold leading-tight tracking-tight">Usage monitor</h1><div className="mt-2 flex flex-wrap items-center gap-3"><p className="text-sm text-[#617080]">用户使用状况与反馈</p><span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">实时数据</span></div></div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" role="switch" aria-checked={running} aria-label="自动刷新" onClick={() => setRunning(value => !value)} className="inline-flex min-h-9 items-center gap-2 rounded px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">自动刷新<span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${running ? "justify-end bg-brand-700" : "justify-start bg-slate-300"}`}><span className="h-4 w-4 rounded-full bg-white" /></span></button>
        <button type="button" aria-label={running ? "暂停自动刷新" : "继续自动刷新"} onClick={() => setRunning(value => !value)} className={`${CONTROL} !w-9 !px-0`}>{running ? <PauseIcon /> : <PlayIcon />}</button>
        <label><span className="sr-only">统计时间范围</span><select value={period} onChange={event => setPeriod(event.target.value as "today" | "week")} className={`${INPUT} w-24`}><option value="today">今天</option><option value="week">近7天</option></select></label>
        <button type="button" onClick={exportUsers} disabled={!visibleUsers.length} className={CONTROL} title="导出当前筛选的用户使用数据"><DownloadIcon />导出</button>
      </div>
    </header>
    {notice && <div role="status" className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-900"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")} className="h-7 w-7 rounded hover:bg-brand-100">×</button></div>}
    {loadError && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{loadError}</div>}

    <dl id="overview" aria-label="使用指标" className="mt-5 grid scroll-mt-32 grid-cols-2 gap-y-5 rounded-xl border border-[#e0e5eb] bg-white py-5 sm:grid-cols-4 lg:scroll-mt-6">
      <Metric label="当前在线" value={summary ? String(summary.online) : "—"} color="text-brand-700" />
      <Metric label={`活跃用户（${period === "today" ? "今天" : "近7天"}）`} value={summary ? String(summary.activeUsers) : "—"} color="text-indigo-600" />
      <Metric label="操作成功率" value={successRate} color="text-brand-700" />
      <Metric label="待处理反馈" value={summary ? String(summary.pendingFeedback) : "—"} color="text-amber-600" />
    </dl>

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]"><TrendChart period={period} onPeriodChange={setPeriod} trend={summary?.trend ?? { labels: [], points: [] }} /><ModuleDistribution items={summary?.modules ?? []} /></div>
    <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <section aria-labelledby="usage-users-title" className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="usage-users-title" className="text-base font-semibold">用户活动</h2><p className="sr-only">近 30 分钟活跃 · {visibleUsers.length} 位用户</p></div><div className="flex max-w-full flex-wrap gap-2"><label><span className="sr-only">筛选用户模块</span><select value={module} onChange={event => setModule(event.target.value)} className={`${INPUT} max-w-full`}><option value="all">全部模块</option>{moduleNames.map(name => <option key={name}>{name}</option>)}</select></label><label className="min-w-0"><span className="sr-only">搜索用户</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索用户…" className={`${INPUT} w-36 max-w-full`} /></label></div></div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#edf0f4]"><table aria-label="用户活动" className="w-full min-w-[550px] text-left"><thead><tr>{['用户', '当前模块', '状态', '本次停留', '操作'].map(label => <th key={label} scope="col" className={TH}>{label}</th>)}</tr></thead><tbody>
          {visibleUsers.map(user => <tr key={user.id} className="hover:bg-ink-50"><td className={`${TD} whitespace-nowrap font-medium`}>{user.name}</td><td className={TD}>{user.module}</td><td className={TD}><UserStatus user={user} /></td><td className={`${TD} whitespace-nowrap tabular-nums text-[#617080]`}>{user.minutes} 分钟</td><td className={TD}><button type="button" aria-label={`查看 ${user.name} 详情`} onClick={() => setSelected({kind: "user", id: user.id})} className="min-h-7 rounded px-1 font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">详情</button></td></tr>)}
          {!visibleUsers.length && <tr><td colSpan={5} className="h-32 text-center text-xs text-[#617080]">{users.length ? <>没有符合条件的用户。<button type="button" onClick={() => { setModule("all"); setQuery(""); }} className="ml-2 rounded text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500">清除筛选</button></> : "近 30 分钟内没有活跃用户。学生登录使用后会出现在这里。"}</td></tr>}
        </tbody></table></div>
      </section>
      <EventStream events={(summary?.events ?? []).map(event => ({ id: event.id, time: clockTime(event.at), user: event.user, module: event.module, message: event.message, success: event.success }))} running={running} />
    </div>

    <section id="feedback" aria-labelledby="usage-feedback-title" className={`${PANEL} mt-4 scroll-mt-32 lg:scroll-mt-6`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><h2 id="usage-feedback-title" className="text-base font-semibold">用户反馈</h2><nav aria-label="反馈状态筛选" className="flex gap-3">{([['all', '全部', feedback.length], ['pending', '待处理', summary?.pendingFeedback ?? 0], ['replied', '已回复', feedback.length - (summary?.pendingFeedback ?? 0)]] as const).map(([key, label, count]) => <button type="button" key={key} aria-pressed={feedbackFilter === key} onClick={() => setFeedbackFilter(key)} className={`min-h-9 border-b-2 px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${feedbackFilter === key ? "border-brand-700 font-semibold text-brand-700" : "border-transparent text-[#617080]"}`}>{label}（{count}）</button>)}</nav></div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-[#edf0f4]"><table aria-label="用户反馈" className="w-full min-w-[750px] text-left"><thead><tr>{['类型', '用户', '反馈内容', '状态', '提交时间', '操作'].map(label => <th key={label} scope="col" className={TH}>{label}</th>)}</tr></thead><tbody>
        {shownFeedback.map(item => <tr key={item.id} className="hover:bg-ink-50"><td className={`${TD} whitespace-nowrap`}><span className={`rounded px-2 py-1 text-xs ${item.kind === "问题反馈" ? "bg-rose-50 text-rose-700" : item.kind === "功能建议" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{item.kind}</span></td><td className={`${TD} whitespace-nowrap text-[#617080]`}>{item.user}</td><td className={`${TD} max-w-[440px]`}><p className="line-clamp-2" title={item.text}>{item.text}</p></td><td className={`${TD} whitespace-nowrap`}><span className={`inline-flex items-center gap-1.5 ${item.reply ? "text-emerald-700" : "text-amber-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${item.reply ? "bg-emerald-500" : "bg-amber-500"}`} />{item.reply ? "已回复" : "待处理"}</span></td><td className={`${TD} whitespace-nowrap text-[#617080]`}>{feedbackTime(item.at)}</td><td className={TD}><button type="button" aria-label={`${item.reply ? "查看回复" : "处理反馈"} ${item.id}`} onClick={() => openFeedback(item)} className={item.reply ? CONTROL : PRIMARY}>{item.reply ? "查看" : "处理"}</button></td></tr>)}
        {!shownFeedback.length && <tr><td colSpan={6} className="h-28 text-center text-xs text-[#617080]">{feedbackFilter === "replied" ? "还没有已回复的反馈。" : "当前没有待处理反馈。学生可通过左下角头像菜单里的 Submit feedback 提交。"}</td></tr>}
      </tbody></table></div>
    </section>
    <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#617080]"><p>数据来自平台使用日志（页面访问 + 关键操作） · 每 15 秒自动刷新 · 永久保存</p><button type="button" onClick={() => { void refresh(period); setNotice("已刷新为最新数据。"); }} className="min-h-8 rounded px-1 underline-offset-4 hover:text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500">立即刷新</button></footer>

    <dialog ref={dialog} aria-labelledby="usage-detail-title" onClose={() => setSelected(null)} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-[#e0e5eb] bg-white p-5 text-[#243246] shadow-xl backdrop:bg-slate-950/30 sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 id="usage-detail-title" className="text-lg font-semibold">{selectedUser ? "用户会话详情" : "处理用户反馈"}</h2><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)} className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">×</button></div>
      {selectedUser && <><p className="mt-2 text-sm text-[#617080]">{selectedUser.name} · 当前活动窗口</p><dl className="mt-5 grid grid-cols-2 gap-5 text-xs"><Detail label="当前模块" value={selectedUser.module} /><div><dt className="text-[#617080]">当前状态</dt><dd className="mt-1"><UserStatus user={selectedUser} /></dd></div><Detail label="本次停留" value={`${selectedUser.minutes} 分钟`} /><Detail label="本次操作" value={`${selectedUser.operations} 次`} /></dl><h3 className="mt-6 text-sm font-semibold">最近操作</h3><ul className="mt-2 space-y-2 text-xs text-[#617080]">{(summary?.events ?? []).filter(event => event.user === selectedUser.name).map(event => <li key={event.id}>{clockTime(event.at)} · {event.message}</li>)}{!(summary?.events ?? []).some(event => event.user === selectedUser.name) && <li>当前事件窗口中没有该用户的操作。</li>}</ul></>}
      {selectedFeedback && <form onSubmit={saveReply}><p className="mt-2 text-xs text-[#617080]">{selectedFeedback.id} · {selectedFeedback.user} · {selectedFeedback.kind}</p><p className="my-5 rounded-lg bg-ink-50 p-3 text-sm leading-6">{selectedFeedback.text}</p><label className="block text-xs font-medium">回复<textarea aria-label="回复" value={reply} onChange={event => setReply(event.target.value)} required maxLength={1000} rows={4} placeholder="输入回复内容…" className="mt-2 block w-full rounded-lg border border-[#d8dfe7] p-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100" /></label><p className="mt-2 text-xs text-[#617080]">回复保存在服务器上，提交反馈的用户可见。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSelected(null)} className={CONTROL}>取消</button><button type="submit" disabled={!reply.trim() || saving} className={PRIMARY}>{saving ? "保存中…" : "保存回复"}</button></div></form>}
    </dialog>
  </section>;
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="border-[#e8edf2] px-5 even:border-l sm:border-l sm:first:border-l-0 sm:px-7"><dt className="text-xs text-[#617080]">{label}</dt><dd className={`mt-2 text-[30px] font-semibold leading-9 tabular-nums ${color}`}>{value}</dd></div>;
}
function UserStatus({ user }: { user: MonitorUser }) { return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`h-1.5 w-1.5 rounded-full ${user.status === "在线" ? "bg-emerald-500" : "bg-amber-500"}`} />{user.status}</span>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[#617080]">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function PauseIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="4" y="3" width="2.5" height="10" rx=".5" /><rect x="9.5" y="3" width="2.5" height="10" rx=".5" /></svg>; }
function PlayIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l8-5z" /></svg>; }
function DownloadIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
