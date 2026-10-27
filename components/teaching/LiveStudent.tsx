"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveStudentState } from "@/lib/teaching/liveShared";
import { TEACHING_FIELDS, type SimpleRow } from "@/lib/teaching/simpleShared";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import { accuracy, blankRow, FIELD_LABELS, fieldInput, minutes, SimpleRows, uploadTable } from "./SimpleTeachingParts";
import { SimplePaperViewer } from "./SimplePaperViewer";

type StudentData = {
  state: LiveStudentState | null;
  openExperiment: { id: string; name: string; groupCount: number } | null;
};

async function post<T>(body: object, url = "/api/teaching/live"): Promise<T> {
  return requestJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Action failed");
}

export function LiveStudent() {
  const [data, setData] = useState<StudentData>({ state: null, openExperiment: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const next = await requestJson<StudentData>("/api/teaching/live", { cache: "no-store" }, "Refresh failed");
    setData(next); setLoaded(true); setError("");
  }, []);
  useEffect(() => { void refresh().catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function join() {
    if (!data.openExperiment || busy) return;
    setBusy(true); setError("");
    try {
      const state = await post<LiveStudentState>({ action: "join", experimentId: data.openExperiment.id });
      setData({ state, openExperiment: null });
      setNotice("已加入实验，等待教师开始。");
    } catch (cause) { setError(requestErrorMessage(cause, "Join failed")); } finally { setBusy(false); }
  }

  const state = data.state;
  return <div data-testid="live-student" className="mt-3 space-y-5">
    {error && <RequestError>{error}</RequestError>}
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}
    {!loaded && <p className="text-sm text-ink-500">Loading…</p>}
    {loaded && !state && data.openExperiment && <section className="rounded-xl border border-brand-200 bg-brand-50/50 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">正在进行中的实验</p>
      <h3 className="mt-2 text-lg font-semibold">{data.openExperiment.name}</h3>
      <p className="mt-2 text-sm text-ink-600">教师将上传文献并自动分组（{data.openExperiment.groupCount} 个组，当前统一使用人工提取通道）。加入后请等待教师开始。</p>
      <button className="btn-primary mt-4" disabled={busy} onClick={() => void join()}>{busy ? "加入中…" : "加入实验"}</button>
    </section>}
    {loaded && !state && !data.openExperiment && <p className="rounded-lg border border-dashed border-ink-300 p-6 text-sm text-ink-500">当前没有可加入的实验。教师开展实验后，这里会出现加入入口。</p>}
    {state && state.participant.status === "waiting" && <section className="rounded-xl border border-ink-200 bg-white p-6">
      <h3 className="text-lg font-semibold">{state.experiment.name}</h3>
      <p className="mt-3 text-sm text-ink-600">你已加入实验 ✅ 当前已有 <strong>{state.joinedCount}</strong> 名同学加入，等待教师开始。开始后系统会自动分组并下发文献，本页会自动更新。</p>
    </section>}
    {state && state.participant.status !== "waiting" && <LiveWorkspace key={state.participant.id} initial={state} onChanged={setData} />}
  </div>;
}

function LiveWorkspace({ initial, onChanged }: { initial: LiveStudentState; onChanged: (updater: (previous: StudentData) => StudentData) => void }) {
  const [state, setState] = useState(initial.participant);
  const [meta] = useState(initial.experiment);
  const [rows, setRows] = useState<SimpleRow[]>(initial.participant.rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showPaper, setShowPaper] = useState(true);

  // Background polls deliver teacher reviews and score updates; a version bump
  // always comes with a fresh server snapshot, so syncing here is safe.
  useEffect(() => {
    setState(initial.participant);
    setRows(initial.participant.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.participant.version]);

  function apply(next: typeof state) {
    setState(next); setRows(next.rows);
    onChanged((previous) => previous.state ? { ...previous, state: { ...previous.state, participant: next } } : previous);
  }

  const submitted = state.status === "submitted";
  const showScore = submitted && (meta.hasAnswerKey || Boolean(state.reviewedAt));
  const inReview = state.status === "review";
  const extracting = state.status === "extracting";

  async function extract() {
    setBusy(true); setError(""); setNotice("AI 提取中，请稍候…");
    try {
      const next = await post<typeof state>({ participantId: state.id, version: state.version }, "/api/teaching/live/extract");
      apply(next); setNotice("提取完成，请对照原文校对后提交。");
    } catch (cause) { setError(requestErrorMessage(cause, "Extraction failed")); setNotice(""); } finally { setBusy(false); }
  }
  async function submit() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await post<typeof state>({ action: "submit", participantId: state.id, version: state.version, rows });
      apply(next); setNotice("提交成功。");
    } catch (cause) { setError(requestErrorMessage(cause, "Submission failed")); } finally { setBusy(false); }
  }

  return <section className="space-y-5">
    <header className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{meta.name}</h3>
          <p className="mt-1 text-sm text-ink-600">Group {state.groupNo} · {state.mode === "ai" ? "AI 提取" : "人工提取"}{state.status !== "submitted" && meta.status === "finished" ? " · 实验已结束" : ""}</p>
        </div>
        <button className="btn" onClick={() => setShowPaper(!showPaper)}>{showPaper ? "收起文献" : "查看文献"}</button>
      </div>
      {meta.paperTitle && <p className="mt-2 text-xs text-ink-500">{meta.paperTitle}</p>}
    </header>
    {showPaper && <SimplePaperViewer baseUrl="/api/teaching/live/paper" />}
    {error && <RequestError>{error}</RequestError>}
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}

    {!submitted && state.mode === "ai" && <div className="rounded-xl border border-ink-200 bg-white p-5">
      <ol className="flex gap-3 text-sm"><li className={`rounded-lg px-4 py-2 ${inReview ? "bg-ink-50 text-ink-500" : "bg-brand-50 font-medium text-brand-800"}`}>1 AI 提取</li><li className={`rounded-lg px-4 py-2 ${inReview ? "bg-brand-50 font-medium text-brand-800" : "bg-ink-50 text-ink-500"}`}>2 校对并提交</li></ol>
      {!inReview && <div className="mt-4">
        <p className="text-sm text-ink-600">点击开始，平台自动从文献提取数据，格式与人工提取完全一致。计时从提取开始，到提交为止。</p>
        {state.error && <p className="mt-2 text-sm text-amber-700">{state.error}</p>}
        <button className="btn-primary mt-4" disabled={busy || extracting} onClick={() => void extract()}>{busy || extracting ? "提取中…" : state.rows.length || state.error ? "重新提取" : "开始 AI 提取"}</button>
        {extracting && !busy && <p className="mt-2 text-xs text-ink-500">提取在后台进行，稍等片刻后点「重新提取」可恢复进度；或刷新页面。</p>}
      </div>}
    </div>}

    {!submitted && state.mode === "manual" && <div className="rounded-xl border border-ink-200 bg-white p-5">
      <h4 className="font-semibold">人工提取</h4>
      <p className="mt-2 text-sm text-ink-600">阅读文献，按模板填写提取表格（与 AI 提取格式一致），上传检查后提交。也可以直接在下方逐条录入。</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className={`btn cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>上传提取表（CSV/TSV/XLSX）
          <input aria-label="Upload extraction table" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy} onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            setBusy(true); setError("");
            try { setRows(await uploadTable(file)); setNotice("表格已读取，请检查预览后提交。"); }
            catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
          }} />
        </label>
        <a className="btn" href="/api/teaching/lab/table">下载模板</a>
      </div>
      <p className="mt-3 text-xs text-ink-500">用时自动记录：从开始填写到提交，无需手动填写。</p>
    </div>}

    {!submitted && state.mode === "manual" && <div className="rounded-xl border border-ink-200 bg-white p-5">
      <h4 className="mb-1 font-semibold">提取数据录入 <span className="ml-2 text-xs font-normal text-ink-500">{rows.length} 条记录</span></h4>
      <p className="mb-4 text-xs text-ink-500">逐条填写：每个字段一个格子，数值和单位一起填（如 25 °C、10 mN）；未报道的字段填 NR。</p>
      <RecordEditor rows={rows.length ? rows : [blankRow()]} disabled={busy} onChange={(next) => setRows(next)} />
      <button className="btn-primary mt-4" disabled={busy || !rows.length} onClick={() => void submit()}>{busy ? "提交中…" : "提交实验结果"}</button>
    </div>}

    {!submitted && state.mode === "ai" && <div className="rounded-xl border border-ink-200 bg-white p-5">
      <h4 className="mb-1 font-semibold">校对提取结果 / 人工补录<span className="ml-2 text-xs font-normal text-ink-500">{rows.length} 条记录</span></h4>
      <p className="mb-4 text-xs text-ink-500">可以直接修改提取结果，也可以像人工组一样添加、删除记录；核对后提交即完成实验。</p>
      <RecordEditor rows={rows.length ? rows : [blankRow()]} disabled={busy} onChange={(next) => setRows(next)} />
      <button className="btn-primary mt-4" disabled={busy || !rows.length} onClick={() => void submit()}>{busy ? "提交中…" : "提交实验结果"}</button>
    </div>}

    {submitted && <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h4 className="text-xl font-semibold text-emerald-900">你已完成实验 ✅</h4>
        <p className="mt-3 text-sm text-emerald-900">结果已提交，教师端已收到你的数据。{showScore && state.score ? <>准确率 <strong>{accuracy(state.score.accuracy)}</strong> · </> : "等待教师审阅 · "}用时 <strong>{minutes(state.elapsedSeconds)}</strong></p>
        <p className="mt-1 text-xs text-emerald-800">{state.reviewedAt ? "教师已完成审阅，下方为逐格结果。" : "教师审阅后，这里会显示每一格的正确 / 错误 / 存疑标记。"}</p>
      </div>
      {showScore && state.score && <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table aria-label="Your reviewed results" className="w-full text-left text-sm">
          <thead className="bg-ink-50 text-xs text-ink-600"><tr>{["Record", "Field", "标准答案", "你的答案", "结果"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
          <tbody>{state.score.cells.map((cell) => <tr key={cell.key} className="border-t border-ink-100">
            <td className="px-3 py-2 text-xs">{cell.goldRow == null ? "Extra" : cell.goldRow + 1} / {cell.answerRow == null ? "Missing" : cell.answerRow + 1}</td>
            <td className="whitespace-nowrap px-3 py-2">{FIELD_LABELS[cell.field]}</td>
            <td className="max-w-40 break-words px-3 py-2">{cell.expected || "—"}</td>
            <td className="max-w-40 break-words px-3 py-2">{cell.actual || "Missing"}</td>
            <td className="px-3 py-2">{cell.mark === "correct" ? <span className="font-semibold text-emerald-700">✓ 正确</span> : cell.mark === "incorrect" ? <span className="font-semibold text-rose-700">× 错误</span> : <span className="font-semibold text-amber-600">⭕ 存疑</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {state.reviewNote && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">教师备注：{state.reviewNote}</p>}
      <SimpleRows rows={state.rows} label="Submitted results" />
    </div>}
  </section>;
}

const FIELD_ENTRY: Array<{ key: keyof SimpleRow; label: string; placeholder: string }> = [
  { key: "cation", label: "阳离子 Cation", placeholder: "如 [EMIM]+" },
  { key: "anion", label: "阴离子 Anion", placeholder: "如 [BF4]−" },
  { key: "substrate", label: "基底 Substrate", placeholder: "如 steel、Au(111)" },
  { key: "temperature", label: "温度 Temperature", placeholder: "数值+单位，如 25 °C" },
  { key: "load", label: "载荷 Load", placeholder: "数值+单位，如 10 mN" },
  { key: "cof", label: "摩擦系数 COF", placeholder: "数值，如 0.08" },
];

/** One card per record: every field gets its own labelled input, value and unit together. */
function RecordEditor({ rows, onChange, disabled }: { rows: SimpleRow[]; onChange: (rows: SimpleRow[]) => void; disabled: boolean }) {
  return <div className="space-y-4">
    {rows.map((row, index) => <div key={index} className="rounded-lg border border-ink-200 bg-ink-50/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h5 className="text-sm font-semibold text-ink-700">记录 {index + 1}</h5>
        <button type="button" className="text-xs text-ink-500 hover:text-rose-700 disabled:opacity-30" disabled={disabled || rows.length === 1}
          onClick={() => onChange(rows.filter((_, i) => i !== index))}>删除记录</button>
      </div>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {FIELD_ENTRY.map((field) => <label key={field.key} className="flex flex-col gap-1 text-xs font-medium text-ink-600">
          {field.label}
          <input aria-label={`Record ${index + 1} ${field.label}`} className={fieldInput} value={row[field.key]} maxLength={500} disabled={disabled}
            placeholder={field.placeholder} onChange={(event) => onChange(rows.map((item, i) => i === index ? { ...item, [field.key]: event.target.value } : item))} />
        </label>)}
      </div>
    </div>)}
    <button type="button" className="btn" disabled={disabled || rows.length >= 100} onClick={() => onChange([...rows, blankRow()])}>＋ 添加记录</button>
  </div>;
}
