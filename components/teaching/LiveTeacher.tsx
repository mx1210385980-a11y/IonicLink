"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { LiveDashboard, LiveExperiment, LiveMark, LiveParticipantView } from "@/lib/teaching/liveShared";
import { TEACHING_FIELDS } from "@/lib/teaching/simpleShared";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import { accuracy, blankRow, FIELD_LABELS, fieldInput, minutes, SimpleRows, uploadTable } from "./SimpleTeachingParts";

type TeacherData = { experiments: LiveExperiment[]; dashboard: LiveDashboard | null };

const GROUP_COLORS = ["bg-brand-50/60", "bg-amber-50/60", "bg-violet-50/60", "bg-emerald-50/60", "bg-sky-50/60", "bg-rose-50/60", "bg-lime-50/60", "bg-orange-50/60"];
const MARK_STYLE: Record<LiveMark, string> = {
  correct: "bg-emerald-100 text-emerald-900",
  incorrect: "bg-rose-100 text-rose-900",
  uncertain: "bg-amber-100 text-amber-900",
};

async function post<T>(body: object): Promise<T> {
  return requestJson<T>("/api/teaching/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Action failed");
}

export function LiveTeacher() {
  const [data, setData] = useState<TeacherData>({ experiments: [], dashboard: null });
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewCell, setReviewCell] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (id?: string | null) => {
    const next = await requestJson<TeacherData>(`/api/teaching/live${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" }, "Refresh failed");
    setData(next); setLoaded(true); setError("");
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(selectedId).catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [refresh, selectedId]);
  useEffect(() => { void refresh().catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }, [refresh]);

  const dashboard = data.dashboard;
  const experiment = dashboard?.experiment;
  const review = dashboard?.participants.find((item) => item.id === reviewId && item.score) ?? null;

  async function run(action: string, extra: object = {}, message = "") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await post<LiveDashboard>({ action, experimentId: experiment?.id, ...extra });
      setData((previous) => ({ ...previous, dashboard: next }));
      setSelectedId(next.experiment.id);
      if (message) setNotice(message);
    } catch (cause) { setError(requestErrorMessage(cause, "Action failed")); } finally { setBusy(false); }
  }

  return <div data-testid="live-teacher" className="mt-3 space-y-5">
    {error && <RequestError>{error}</RequestError>}
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 text-xs text-ink-600">Experiment
        <select aria-label="Current live experiment" className={`${fieldInput} mt-1`} value={experiment?.id ?? ""} disabled={!data.experiments.length}
          onChange={(event) => { setSelectedId(event.target.value); setReviewId(null); setReviewCell(null); void refresh(event.target.value).catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }}>
          {!data.experiments.length && <option value="">No experiment yet</option>}
          {data.experiments.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}
        </select>
      </label>
      <button className="btn-primary min-h-10" onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "开展实验"}</button>
    </div>
    {creating && <CreateLiveExperiment onCreated={async (created) => {
      setCreating(false); setSelectedId(created.experiment.id);
      setData((previous) => ({ experiments: [created.experiment, ...previous.experiments], dashboard: created }));
      setNotice("实验已创建，学生现在可以加入。上传文献并等待人数到齐后开始。");
    }} />}
    {!loaded && <p className="text-sm text-ink-500">Loading…</p>}
    {loaded && !dashboard && !creating && <p className="rounded-lg border border-dashed border-ink-300 p-6 text-sm text-ink-500">点击「开展实验」创建一场实验：设置组数、上传文献、等待学生加入。</p>}
    {dashboard && experiment && <>
      <section className="rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{experiment.name}</h3>
            <p className="mt-1 text-sm text-ink-500">
              {experiment.status === "open" ? "开放加入中" : experiment.status === "running" ? "实验进行中" : "实验已结束"}
              {" · "}{experiment.groupCount} groups · 已加入 <strong>{dashboard.participants.length}</strong> 人
            </p>
          </div>
          {experiment.status === "open" && <button className="btn-primary" disabled={busy || !experiment.paperSourceId || !dashboard.participants.length} onClick={() => void run("start", {}, "实验已开始，学生已自动分组并收到文献。")}>开始实验</button>}
          {experiment.status === "running" && <button className="btn" disabled={busy} onClick={() => void run("finish", {}, "实验已结束。")}>结束实验</button>}
        </div>
        {experiment.status === "open" && <>
          <p className="mt-3 text-xs text-ink-500">开始条件：已上传文献 + 至少 1 名学生加入。开始后系统自动轮流分组（当前统一为人工提取通道），文献自动下发。</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className={`btn cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>{experiment.paperSourceId ? "更换文献 PDF" : "上传文献 PDF"}
              <input aria-label="Upload experiment paper" type="file" accept=".pdf" className="sr-only" disabled={busy} onChange={async (event) => {
                const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
                setBusy(true); setError("");
                try {
                  const form = new FormData(); form.set("file", file); form.set("experimentId", experiment.id);
                  await requestJson("/api/teaching/live/paper", { method: "POST", body: form }, "Upload failed");
                  await refresh(experiment.id); setNotice("文献已上传，开始实验后自动下发给学生。");
                } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
              }} />
            </label>
            <span className="text-sm text-ink-600">{experiment.paperTitle || "尚未上传文献"}</span>
            {experiment.paperSourceId && <a className="text-sm text-brand-700" target="_blank" rel="noreferrer" href={`/api/teaching/live/paper?experimentId=${experiment.id}`}>查看 PDF ↗</a>}
          </div>
          <LiveAnswerKey key={`${experiment.id}-${experiment.gold.length}`} experiment={experiment} onSaved={async () => { await refresh(experiment.id); setNotice("答案已保存，提交结果自动评分。"); }} />
          {dashboard.participants.length > 0 && <ul className="mt-4 flex flex-wrap gap-2">{dashboard.participants.map((item) => <li key={item.id} className="rounded-full bg-ink-50 px-3 py-1 text-xs text-ink-700">{item.alias}</li>)}</ul>}
        </>}
      </section>
      {experiment.status !== "open" && <LiveResults dashboard={dashboard} reviewId={reviewId} reviewCell={reviewCell}
        onSelect={(id, cellKey = null) => { setReviewId(id); setReviewCell(cellKey); }} />}
      {review && <LiveReview key={`${review.id}-${review.version}`} participant={review} focusKey={reviewCell} onFocus={setReviewCell} onClose={() => { setReviewId(null); setReviewCell(null); }} onSaved={async () => { await refresh(experiment.id); setNotice("审阅已保存，学生端可看到结果。"); }} />}
    </>}
  </div>;
}

function CreateLiveExperiment({ onCreated }: { onCreated: (dashboard: LiveDashboard) => Promise<void> }) {
  const [name, setName] = useState("");
  const [groupCount, setGroupCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { await onCreated(await post<LiveDashboard>({ action: "create", name, groupCount })); }
    catch (cause) { setError(requestErrorMessage(cause, "Creation failed")); } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void create(event)} className="rounded-xl border border-brand-200 bg-brand-50/40 p-5">
    <h3 className="font-semibold">开展新实验</h3>
    <div className="mt-4 flex flex-wrap items-end gap-4">
      <label className="min-w-56 flex-1 text-sm">实验名称<input required maxLength={100} className={`${fieldInput} mt-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：第 3 周离子液体提取实验" /></label>
      <label className="text-sm">组数（2–8）<input aria-label="Group count" type="number" min={2} max={8} className={`${fieldInput} mt-1 w-24`} value={groupCount} onChange={(event) => setGroupCount(Number(event.target.value))} /></label>
      <button className="btn-primary" disabled={busy}>{busy ? "创建中…" : "创建并开放加入"}</button>
    </div>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </form>;
}

function LiveAnswerKey({ experiment, onSaved }: { experiment: LiveExperiment; onSaved: () => Promise<void> }) {
  const [gold, setGold] = useState(experiment.gold.length ? experiment.gold : [blankRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <details className="mt-4 rounded-lg border border-ink-200 p-4">
    <summary className="cursor-pointer text-sm font-medium text-ink-700">{experiment.gold.length ? `标准答案（${experiment.gold.length} 条记录）` : "设置标准答案（用于准确率评分）"}</summary>
    <div className="mt-3 flex flex-wrap gap-3">
      <label className="btn cursor-pointer">上传答案表<input aria-label="Upload answer key" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy} onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        setBusy(true); setError("");
        try { setGold(await uploadTable(file)); } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
      }} /></label>
      <a className="btn" href="/api/teaching/lab/table">下载模板</a>
    </div>
    <div className="mt-3"><SimpleRows rows={gold} label="Answer key" disabled={busy} onChange={setGold} /></div>
    <button className="btn-primary mt-3" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await post({ action: "gold", experimentId: experiment.id, gold }); await onSaved(); }
      catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); }
    }}>{busy ? "保存中…" : "保存答案并评分"}</button>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </details>;
}

function LiveResults({ dashboard, reviewId, reviewCell, onSelect }: { dashboard: LiveDashboard; reviewId: string | null; reviewCell: string | null; onSelect: (id: string | null, cellKey?: string | null) => void }) {
  const groups = Array.from({ length: dashboard.experiment.groupCount }, (_, index) => index + 1);
  const hasGold = dashboard.experiment.gold.length > 0;
  return <section className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((groupNo) => {
        const members = dashboard.participants.filter((item) => item.groupNo === groupNo);
        const submitted = members.filter((item) => item.status === "submitted");
        const scored = hasGold ? submitted.filter((item) => item.score) : [];
        const avgAccuracy = scored.length ? scored.reduce((sum, item) => sum + item.score!.accuracy, 0) / scored.length : null;
        const timed = submitted.filter((item) => item.elapsedSeconds != null);
        const avgSeconds = timed.length ? timed.reduce((sum, item) => sum + item.elapsedSeconds!, 0) / timed.length : null;
        return <div key={groupNo} className={`rounded-xl border border-ink-200 p-4 ${GROUP_COLORS[(groupNo - 1) % GROUP_COLORS.length]}`}>
          <h4 className="font-semibold">Group {groupNo} <span className="ml-1 text-xs font-normal text-ink-500">{members[0]?.mode === "manual" ? "人工提取" : "AI 提取"}</span></h4>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-ink-500">准确率</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{accuracy(avgAccuracy)}</dd></div>
            <div><dt className="text-xs text-ink-500">平均用时</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{avgSeconds == null ? "—" : `${(avgSeconds / 60).toFixed(1)} min`}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-ink-500">已提交 {submitted.length} / {members.length} 人{scored.some((item) => item.score!.uncertain > 0) ? ` · 存疑 ${scored.reduce((sum, item) => sum + item.score!.uncertain, 0)} 格` : ""}</p>
        </div>;
      })}
    </div>
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
      <table aria-label="Combined group results" className="w-full text-left text-sm">
        <thead className="bg-ink-50 text-xs text-ink-600"><tr>
          {["Group", "Student", "Record", ...TEACHING_FIELDS.map(({ key }) => FIELD_LABELS[key]), "审阅"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}
        </tr></thead>
        <tbody>
          {dashboard.participants.map((item) => {
            const marks = new Map<string, LiveMark>();
            for (const cell of item.score?.cells ?? []) if (cell.answerRow != null) marks.set(`${cell.answerRow}:${cell.field}`, cell.mark);
            if (item.status !== "submitted" || !item.rows.length) {
              return <tr key={item.id} className={`border-t border-ink-100 ${GROUP_COLORS[((item.groupNo ?? 1) - 1) % GROUP_COLORS.length]}`}>
                <td className="px-3 py-3 font-medium">G{item.groupNo}</td><td className="px-3 py-3">{item.alias}</td>
                <td colSpan={7} className="px-3 py-3 text-xs text-ink-500">{item.status === "extracting" ? "AI 提取中…" : item.status === "review" ? "校对中" : "尚未提交"}</td>
                <td className="px-3 py-3 text-xs text-ink-400">—</td>
              </tr>;
            }
            return item.rows.map((row, rowIndex) => <tr key={`${item.id}-${rowIndex}`} className={`border-t border-ink-100 ${GROUP_COLORS[((item.groupNo ?? 1) - 1) % GROUP_COLORS.length]}`}>
              {rowIndex === 0 && <>
                <td rowSpan={item.rows.length} className="px-3 py-3 align-top font-medium">G{item.groupNo}</td>
                <td rowSpan={item.rows.length} className="max-w-32 break-words px-3 py-3 align-top">{item.alias}
                  <span className="mt-1 block text-xs font-normal text-ink-500">{minutes(item.elapsedSeconds)}{hasGold && item.score ? ` · ${accuracy(item.score.accuracy)}` : ""}</span>
                </td>
              </>}
              <td className="px-3 py-2 tabular-nums text-ink-500">{rowIndex + 1}</td>
              {TEACHING_FIELDS.map(({ key }) => {
                const cellKey = `${rowIndex}:${key}`;
                const mark = marks.get(cellKey);
                const selected = reviewId === item.id && reviewCell === cellKey;
                return <td key={key} className={`max-w-44 break-words p-1 ${mark ? MARK_STYLE[mark] : ""}`}>
                  <button type="button" aria-label={`Review ${item.alias} record ${rowIndex + 1} ${key}`} onClick={() => onSelect(item.id, cellKey)}
                    className={`w-full rounded-md px-2 py-1.5 text-left transition hover:ring-2 hover:ring-brand-400 ${selected ? "ring-2 ring-brand-600" : ""}`}>
                    {row[key] || "—"}
                  </button>
                </td>;
              })}
              {rowIndex === 0 && <td rowSpan={item.rows.length} className="px-3 py-3 align-top">
                {item.score ? <button className={`text-sm ${reviewId === item.id ? "font-semibold text-brand-800" : "text-brand-700"} underline-offset-4 hover:underline`} onClick={() => onSelect(reviewId === item.id && !reviewCell ? null : item.id)}>{item.reviewedAt ? "已审阅 · 修改" : "审阅"}</button> : <span className="text-xs text-ink-400">待提交</span>}
              </td>}
            </tr>);
          })}
          {!dashboard.participants.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-ink-500">还没有学生加入。</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-xs text-ink-500">点击任意单元格，在下方审阅面板为该格打 <span className="font-semibold text-emerald-700">✓ 正确</span> / <span className="font-semibold text-amber-600">⭕ 存疑</span> / <span className="font-semibold text-rose-700">× 错误</span>；单元格颜色同步显示审阅结果。{!hasGold && "设置标准答案后自动计算机评与准确率。"}</p>
  </section>;
}

function LiveReview({ participant, focusKey, onFocus, onClose, onSaved }: { participant: LiveParticipantView; focusKey: string | null; onFocus: (key: string) => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const [overrides, setOverrides] = useState<Record<string, LiveMark>>(participant.overrides);
  const [note, setNote] = useState(participant.reviewNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const marks: Array<{ value: LiveMark; label: string; symbol: string; active: string }> = [
    { value: "correct", label: "正确", symbol: "✓", active: "bg-emerald-600 text-white" },
    { value: "uncertain", label: "存疑", symbol: "⭕", active: "bg-amber-400 text-amber-950" },
    { value: "incorrect", label: "错误", symbol: "×", active: "bg-rose-600 text-white" },
  ];
  const cells = participant.score?.cells ?? [];
  const focused = cells.find((cell) => cell.answerRow != null && `${cell.answerRow}:${cell.field}` === focusKey) ?? null;
  function markCell(key: string, value: LiveMark) {
    setOverrides((previous) => ({ ...previous, [key]: value }));
  }
  return <section aria-label="Instructor review" className="rounded-xl border border-brand-300 bg-white p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-lg font-semibold">审阅：{participant.alias} · Group {participant.groupNo}</h3>
        <p className="mt-1 text-sm text-ink-500">准确率 {accuracy(participant.score?.accuracy)} · 存疑 {participant.score?.uncertain ?? 0} 格 · 用时 {minutes(participant.elapsedSeconds)}</p></div>
      <button className="btn" onClick={onClose}>收起</button>
    </header>
    {focused ? <div className="mt-4 rounded-xl border-2 border-brand-200 bg-brand-50/50 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">当前单元格 · 记录 {focused.answerRow! + 1} · {FIELD_LABELS[focused.field]}</p>
      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <p><span className="text-ink-500">学生答案：</span><strong>{focused.actual || "Missing"}</strong></p>
        <p><span className="text-ink-500">标准答案：</span>{focused.expected || "—（未设答案，请直接判断）"}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3" role="group" aria-label={`Mark ${focused.key}`}>
        {marks.map((mark) => {
          const current = overrides[focused.key] ?? (focused.machineCorrect ? "correct" : "incorrect");
          return <button key={mark.value} type="button" aria-pressed={current === mark.value} disabled={busy}
            className={`flex h-14 min-w-32 items-center justify-center gap-2 rounded-xl px-6 text-xl font-bold shadow-sm transition ${current === mark.value ? `${mark.active} ring-2 ring-offset-2` : "bg-white text-ink-400 ring-1 ring-ink-200 hover:bg-ink-50"}`}
            onClick={() => markCell(focused.key, mark.value)}>{mark.symbol}<span className="text-sm font-semibold">{mark.label}</span></button>;
        })}
      </div>
      <p className="mt-3 text-xs text-ink-500">选好后点击下方「保存审阅结果」生效；可继续点击其他单元格逐格审阅。</p>
    </div> : <p className="mt-4 rounded-lg border border-dashed border-brand-300 bg-brand-50/40 p-4 text-sm text-brand-800">👆 点击上方大表格中的任意单元格，这里会突出显示 <span className="font-semibold text-emerald-700">✓ 正确</span> / <span className="font-semibold text-amber-600">⭕ 存疑</span> / <span className="font-semibold text-rose-700">× 错误</span> 三个选项。</p>}
    <div className="mt-4 max-h-[480px] overflow-auto"><table className="w-full text-left text-sm">
      <thead className="sticky top-0 bg-ink-50 text-xs text-ink-500"><tr>{["Record", "Field", "Answer key", "Student answer", "Auto", "审阅"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2">{label}</th>)}</tr></thead>
      <tbody>{cells.map((cell) => <tr key={cell.key} className={`border-t border-ink-100 ${focused?.key === cell.key ? "bg-brand-50/70" : ""} ${cell.answerRow != null ? "cursor-pointer" : ""}`}
        onClick={() => { if (cell.answerRow != null) onFocus(`${cell.answerRow}:${cell.field}`); }}>
        <td className="px-3 py-2 text-xs">{cell.goldRow == null ? "Extra" : cell.goldRow + 1} / {cell.answerRow == null ? "Missing" : cell.answerRow + 1}</td>
        <td className="whitespace-nowrap px-3 py-2">{FIELD_LABELS[cell.field]}</td>
        <td className="max-w-40 break-words px-3 py-2">{cell.expected || "—"}</td>
        <td className="max-w-40 break-words px-3 py-2">{cell.actual || "Missing"}</td>
        <td className={`px-3 py-2 text-xs ${cell.machineCorrect ? "text-emerald-700" : "text-rose-700"}`}>{cell.machineCorrect ? "Match" : "Unmatched"}</td>
        <td className="px-3 py-2"><div className="flex gap-1" role="group" aria-label={`Review ${cell.key}`}>
          {marks.map((mark) => {
            const current = overrides[cell.key] ?? (cell.machineCorrect ? "correct" : "incorrect");
            return <button key={mark.value} type="button" title={mark.label} aria-label={`${mark.label} ${cell.key}`} aria-pressed={current === mark.value} disabled={busy}
              className={`h-8 w-8 rounded-md text-base font-semibold transition ${current === mark.value ? mark.active : "bg-ink-50 text-ink-400 hover:bg-ink-100"}`}
              onClick={(event) => { event.stopPropagation(); markCell(cell.key, mark.value); }}>{mark.symbol}</button>;
          })}
        </div></td>
      </tr>)}</tbody>
    </table></div>
    <label className="mt-4 block text-xs text-ink-600">审阅备注<textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className={`${fieldInput} mt-1 py-2`} placeholder="说明判分依据，学生会看到这条备注" /></label>
    <button className="btn-primary mt-3" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await post({ action: "review", participantId: participant.id, version: participant.version, overrides, note }); await onSaved(); }
      catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); }
    }}>{busy ? "保存中…" : "保存审阅结果"}</button>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </section>;
}
