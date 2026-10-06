"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { createDemoState, demoReducer, FEEDBACK_STORAGE, MODULES, restoreFeedback, usersCsv, type Feedback, type UsageUser } from "./demo";
import { CONTROL, EventStream, INPUT, ModuleDistribution, PANEL, TrendChart } from "./MonitorPanels";

type Selection = { kind: "user" | "feedback"; id: string } | null;
type FeedbackFilter = "all" | "pending" | "replied";
const PRIMARY = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-xs font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-40";
const TH = "whitespace-nowrap bg-[#f7f9fb] px-3 py-1.5 text-left !text-xs !font-medium !text-[#617080]";
const TD = "border-t border-[#edf0f4] px-3 py-1 text-xs";

export function UsageMonitor() {
  const [state, dispatch] = useReducer(demoReducer, undefined, createDemoState);
  const [running, setRunning] = useState(true);
  const [period, setPeriod] = useState<"today" | "week">("today");
  const [module, setModule] = useState("all");
  const [query, setQuery] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");
  const [selected, setSelected] = useState<Selection>(null);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    try { dispatch({ type: "restore", feedback: restoreFeedback(localStorage.getItem(FEEDBACK_STORAGE)) }); }
    catch { setNotice("浏览器存储暂不可用，回复将在本次演示中保留。"); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(FEEDBACK_STORAGE, JSON.stringify({ version: 1, replies: state.feedback.map(({ id, reply: text }) => ({ id, reply: text })) })); }
    catch { setNotice("浏览器存储暂不可用，回复将在本次演示中保留。"); }
  }, [ready, state.feedback]);
  useEffect(() => {
    if (!running || !ready) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 4000);
    return () => window.clearInterval(timer);
  }, [running, ready]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (selected && !element.open) element.showModal();
    if (!selected && element.open) element.close();
  }, [selected]);

  const visibleUsers = useMemo(() => state.users.filter(user => (module === "all" || user.module === module) && `${user.id} ${user.module}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [state.users, module, query]);
  const pending = state.feedback.filter(item => !item.reply).length;
  const totalOperations = state.moduleCounts.reduce((sum, count) => sum + count, 0);
  const shownFeedback = state.feedback.filter(item => feedbackFilter === "all" || (feedbackFilter === "pending" ? !item.reply : Boolean(item.reply)));
  const selectedUser = selected?.kind === "user" ? state.users.find(user => user.id === selected.id) : undefined;
  const selectedFeedback = selected?.kind === "feedback" ? state.feedback.find(item => item.id === selected.id) : undefined;
  const openFeedback = (item: Feedback) => { setReply(item.reply); setSelected({ kind: "feedback", id: item.id }); };
  const exportUsers = () => {
    const blob = new Blob([usersCsv(visibleUsers, period === "today" ? "今天" : "近7天")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "ioniclink-usage-demo.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`已导出 ${visibleUsers.length} 位用户的演示会话数据。`);
  };
  const saveReply = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFeedback || !reply.trim()) return;
    dispatch({ type: "reply", id: selectedFeedback.id, reply });
    setSelected(null); setNotice("模拟回复已保存，可在“已回复”中查看。");
  };

  return <section lang="zh-CN" aria-labelledby="usage-monitor-title" className="mx-auto w-full max-w-[1600px] bg-[#fafafa] px-4 py-6 text-[#243246] sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 id="usage-monitor-title" className="text-[30px] font-semibold leading-tight tracking-tight">Usage monitor</h1><div className="mt-2 flex flex-wrap items-center gap-3"><p className="text-sm text-[#617080]">用户使用状况与反馈</p><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">演示数据</span></div></div>
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" role="switch" aria-checked={running} aria-label="动态演示" onClick={() => setRunning(value => !value)} className="inline-flex min-h-9 items-center gap-2 rounded px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">动态演示<span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${running ? "justify-end bg-brand-700" : "justify-start bg-slate-300"}`}><span className="h-4 w-4 rounded-full bg-white" /></span></button>
        <button type="button" aria-label={running ? "暂停动态更新" : "继续动态更新"} onClick={() => setRunning(value => !value)} className={`${CONTROL} !w-9 !px-0`}>{running ? <PauseIcon /> : <PlayIcon />}</button>
        <label><span className="sr-only">统计时间范围</span><select value={period} onChange={event => setPeriod(event.target.value as "today" | "week")} className={`${INPUT} w-24`}><option value="today">今天</option><option value="week">近7天</option></select></label>
        <button type="button" onClick={exportUsers} disabled={!visibleUsers.length} className={CONTROL} title="导出当前筛选的演示用户会话"><DownloadIcon />导出</button>
      </div>
    </header>
    {notice && <div role="status" className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-900"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")} className="h-7 w-7 rounded hover:bg-brand-100">×</button></div>}

    <dl id="overview" aria-label="演示使用指标" className="mt-5 grid scroll-mt-32 grid-cols-2 gap-y-5 rounded-xl border border-[#e0e5eb] bg-white py-5 sm:grid-cols-4 lg:scroll-mt-6">
      <Metric label="当前在线" value={String(state.users.filter(user => user.status === "在线").length)} color="text-brand-700" />
      <Metric label="活跃用户" value={String((period === "today" ? 186 : 1042) + Math.floor(state.tick / 6))} color="text-indigo-600" />
      <Metric label="操作成功率" value={`${(state.successful / totalOperations * 100).toFixed(1)}%`} color="text-brand-700" />
      <Metric label="待处理反馈" value={String(pending)} color="text-amber-600" />
    </dl>

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]"><TrendChart period={period} onPeriodChange={setPeriod} tick={state.tick} /><ModuleDistribution counts={state.moduleCounts.map(count => count * (period === "week" ? 7 : 1))} /></div>
    <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <section aria-labelledby="usage-users-title" className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="usage-users-title" className="text-base font-semibold">用户活动</h2><p className="sr-only">当前会话 · {visibleUsers.length} 位用户</p></div><div className="flex max-w-full flex-wrap gap-2"><label><span className="sr-only">筛选用户模块</span><select value={module} onChange={event => setModule(event.target.value)} className={`${INPUT} max-w-full`}><option value="all">全部模块</option>{MODULES.map(name => <option key={name}>{name}</option>)}</select></label><label className="min-w-0"><span className="sr-only">搜索用户</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索用户…" className={`${INPUT} w-36 max-w-full`} /></label></div></div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#edf0f4]"><table aria-label="用户活动" className="w-full min-w-[550px] text-left"><thead><tr>{['用户', '当前模块', '状态', '本次停留', '操作'].map(label => <th key={label} scope="col" className={TH}>{label}</th>)}</tr></thead><tbody>
          {visibleUsers.map(user => <tr key={user.id} className="hover:bg-ink-50"><td className={`${TD} whitespace-nowrap font-medium`}>{user.id}</td><td className={TD}>{user.module}</td><td className={TD}><UserStatus user={user} /></td><td className={`${TD} whitespace-nowrap tabular-nums text-[#617080]`}>{user.minutes} 分钟</td><td className={TD}><button type="button" aria-label={`查看 ${user.id} 详情`} onClick={() => setSelected({kind: "user", id: user.id})} className="min-h-7 rounded px-1 font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">详情</button></td></tr>)}
          {!visibleUsers.length && <tr><td colSpan={5} className="h-32 text-center text-xs text-[#617080]">没有符合条件的用户。<button type="button" onClick={() => { setModule("all"); setQuery(""); }} className="ml-2 rounded text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500">清除筛选</button></td></tr>}
        </tbody></table></div>
      </section>
      <EventStream events={state.events} running={running} />
    </div>

    <section id="feedback" aria-labelledby="usage-feedback-title" className={`${PANEL} mt-4 scroll-mt-32 lg:scroll-mt-6`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><h2 id="usage-feedback-title" className="text-base font-semibold">用户反馈</h2><nav aria-label="反馈状态筛选" className="flex gap-3">{([['all', '全部', state.feedback.length], ['pending', '待处理', pending], ['replied', '已回复', state.feedback.length - pending]] as const).map(([key, label, count]) => <button type="button" key={key} aria-pressed={feedbackFilter === key} onClick={() => setFeedbackFilter(key)} className={`min-h-9 border-b-2 px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${feedbackFilter === key ? "border-brand-700 font-semibold text-brand-700" : "border-transparent text-[#617080]"}`}>{label}（{count}）</button>)}</nav></div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-[#edf0f4]"><table aria-label="用户反馈" className="w-full min-w-[750px] text-left"><thead><tr>{['类型', '用户', '反馈内容', '状态', '提交时间', '操作'].map(label => <th key={label} scope="col" className={TH}>{label}</th>)}</tr></thead><tbody>
        {shownFeedback.map(item => <tr key={item.id} className="hover:bg-ink-50"><td className={`${TD} whitespace-nowrap`}><span className={`rounded px-2 py-1 text-xs ${item.kind === "问题反馈" ? "bg-rose-50 text-rose-700" : item.kind === "功能建议" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700"}`}>{item.kind}</span></td><td className={`${TD} whitespace-nowrap text-[#617080]`}>{item.user}</td><td className={`${TD} max-w-[440px]`}><p className="line-clamp-2" title={item.text}>{item.text}</p></td><td className={`${TD} whitespace-nowrap`}><span className={`inline-flex items-center gap-1.5 ${item.reply ? "text-emerald-700" : "text-amber-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${item.reply ? "bg-emerald-500" : "bg-amber-500"}`} />{item.reply ? "已回复" : "待处理"}</span></td><td className={`${TD} whitespace-nowrap text-[#617080]`}>{item.time}</td><td className={TD}><button type="button" aria-label={`${item.reply ? "查看回复" : "处理反馈"} ${item.id}`} onClick={() => openFeedback(item)} className={item.reply ? CONTROL : PRIMARY}>{item.reply ? "查看" : "处理"}</button></td></tr>)}
        {!shownFeedback.length && <tr><td colSpan={6} className="h-28 text-center text-xs text-[#617080]">{feedbackFilter === "replied" ? "还没有模拟回复，处理一条反馈即可体验。" : "当前没有待处理反馈。"}</td></tr>}
      </tbody></table></div>
    </section>
    <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#617080]"><p>前端演示 · 数据为模拟样本 · 每 4 秒更新 · 回复仅保存在当前浏览器</p><button type="button" onClick={() => { dispatch({type: "reset"}); setFeedbackFilter("all"); setNotice("已恢复初始演示数据。"); }} className="min-h-8 rounded px-1 underline-offset-4 hover:text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500">恢复演示数据</button></footer>

    <dialog ref={dialog} aria-labelledby="usage-detail-title" onClose={() => setSelected(null)} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-[#e0e5eb] bg-white p-5 text-[#243246] shadow-xl backdrop:bg-slate-950/30 sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 id="usage-detail-title" className="text-lg font-semibold">{selectedUser ? "用户会话详情" : "处理用户反馈"}</h2><button type="button" aria-label="关闭详情" onClick={() => setSelected(null)} className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">×</button></div>
      {selectedUser && <><p className="mt-2 text-sm text-[#617080]">{selectedUser.id} · 演示会话</p><dl className="mt-5 grid grid-cols-2 gap-5 text-xs"><Detail label="当前模块" value={selectedUser.module} /><div><dt className="text-[#617080]">当前状态</dt><dd className="mt-1"><UserStatus user={selectedUser} /></dd></div><Detail label="本次停留" value={`${selectedUser.minutes} 分钟`} /><Detail label="本次操作" value={`${selectedUser.operations} 次`} /></dl><h3 className="mt-6 text-sm font-semibold">最近操作</h3><ul className="mt-2 space-y-2 text-xs text-[#617080]">{state.events.filter(event => event.user === selectedUser.id).map(event => <li key={event.id}>{event.time} · {event.message}</li>)}{!state.events.some(event => event.user === selectedUser.id) && <li>当前事件窗口中没有该用户的操作。</li>}</ul></>}
      {selectedFeedback && <form onSubmit={saveReply}><p className="mt-2 text-xs text-[#617080]">{selectedFeedback.id} · {selectedFeedback.user} · {selectedFeedback.kind}</p><p className="my-5 rounded-lg bg-ink-50 p-3 text-sm leading-6">{selectedFeedback.text}</p><label className="block text-xs font-medium">模拟回复<textarea aria-label="模拟回复" value={reply} onChange={event => setReply(event.target.value)} required maxLength={1000} rows={4} placeholder="输入回复，体验反馈处理流程…" className="mt-2 block w-full rounded-lg border border-[#d8dfe7] p-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100" /></label><p className="mt-2 text-xs text-[#617080]">本次回复保存在浏览器演示数据中。</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setSelected(null)} className={CONTROL}>取消</button><button type="submit" disabled={!reply.trim()} className={PRIMARY}>保存模拟回复</button></div></form>}
    </dialog>
  </section>;
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="border-[#e8edf2] px-5 even:border-l sm:border-l sm:first:border-l-0 sm:px-7"><dt className="text-xs text-[#617080]">{label}</dt><dd className={`mt-2 text-[30px] font-semibold leading-9 tabular-nums ${color}`}>{value}</dd></div>;
}
function UserStatus({ user }: { user: UsageUser }) { return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className={`h-1.5 w-1.5 rounded-full ${user.status === "在线" ? "bg-emerald-500" : "bg-amber-500"}`} />{user.status}</span>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[#617080]">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>; }
function PauseIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="4" y="3" width="2.5" height="10" rx=".5" /><rect x="9.5" y="3" width="2.5" height="10" rx=".5" /></svg>; }
function PlayIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M5 3v10l8-5z" /></svg>; }
function DownloadIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
