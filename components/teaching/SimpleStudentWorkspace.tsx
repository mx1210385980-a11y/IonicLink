"use client";
import { useCallback, useEffect, useState } from "react";
import type { SimpleRow, SimpleStudentState } from "@/lib/teaching/simpleShared";
import { requestJson, requestErrorMessage, RequestError } from "@/components/request";
import { accuracy, fieldInput, groupLabel, labPost, minutes, signOutTeaching, SimpleRows, uploadTable } from "./SimpleTeachingParts";
import { SimplePaperViewer } from "./SimplePaperViewer";

export function SimpleStudentWorkspace({ initial }: { initial: SimpleStudentState }) {
  const [state, setState] = useState(initial); const [rows, setRows] = useState<SimpleRow[]>(initial.rows);
  const [manualMinutes, setManualMinutes] = useState(""); const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [reviewed, setReviewed] = useState(false); const [now, setNow] = useState<number | null>(null);
  const [showPaper, setShowPaper] = useState(initial.mode === "ai");
  const [pendingRows, setPendingRows] = useState(false);
  useEffect(() => { setManualMinutes(""); setFilename(""); setReviewed(false); setPendingRows(false); setNow(null); }, [state.id]);
  const refresh = useCallback(async () => {
    const next = await requestJson<SimpleStudentState>("/api/teaching/lab", { cache: "no-store" }, "Could not load experiment");
    setState(next); setRows(next.rows); return next;
  }, []);
  useEffect(() => {
    if (!state.startedAt || state.status === "submitted") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [state.startedAt, state.status]);
  useEffect(() => {
    if (state.status !== "extracting" || busy) return;
    const timer = setInterval(() => void refresh().catch((cause) => setError(requestErrorMessage(cause, "Could not load progress"))), 3000);
    return () => clearInterval(timer);
  }, [state.status, busy, refresh]);
  useEffect(() => {
    if (!pendingRows) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [pendingRows]);
  const elapsed = state.elapsedSeconds ?? (state.startedAt && now !== null ? Math.max(0, (now - Date.parse(state.startedAt)) / 1000) : null);
  const attemptAge = now === null ? 0 : now - Date.parse(state.extractionAttemptAt ?? state.startedAt ?? "");
  const hasPaper = Boolean(state.experiment.sourceId);
  const submitted = state.status === "submitted";
  const inReview = state.status === "review";
  async function extract() {
    setBusy(true); setError(""); setNotice("Extracting. Please wait…");
    setNow(Date.now());
    setState((previous) => ({ ...previous, status: "extracting", startedAt: previous.startedAt ?? new Date().toISOString() }));
    try {
      const next = await labPost<SimpleStudentState>({ attemptId: state.id, version: state.version }, "/api/teaching/lab/extract");
      setState(next); setRows(next.rows); setPendingRows(false); setNotice("Extraction complete. Check each record against the source.");
    } catch (cause) {
      setError(requestErrorMessage(cause, "Extraction failed")); setNotice("");
      try { await refresh(); } catch { /* Keep the original actionable extraction error. */ }
    } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try { const next = await labPost<SimpleStudentState>({ action: "save", attemptId: state.id, version: state.version, rows }); setState(next); setPendingRows(false); setNotice("Draft saved"); }
    catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); }
  }
  async function submit() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await labPost<SimpleStudentState>({ action: "submit", attemptId: state.id, version: state.version, rows,
        ...(state.mode === "manual" ? { manualSeconds: Number(manualMinutes) * 60 } : {}) });
      setState(next); setRows(next.rows); setPendingRows(false); setNotice("Results submitted. The instructor dashboard has been updated.");
    } catch (cause) { setError(requestErrorMessage(cause, "Submission failed")); } finally { setBusy(false); }
  }
  return <section lang="en-US" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-ink-500">{state.experiment.name} · {state.studentAlias}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink-950">{state.groupNo ? `Group ${state.groupNo} · Round ${state.roundNo} of 2` : groupLabel(state.mode)}</h1>{state.groupNo && <p className="mt-2 text-sm font-medium text-brand-700">Paper {state.paperNo} · {state.mode === "ai" ? "AI extraction" : "Manual extraction"}</p>}</div>
      <div className="flex items-center gap-3"><span className="text-sm tabular-nums text-ink-600">{state.mode === "ai" ? `Experiment time ${minutes(elapsed)}` : "Record experiment time yourself"}</span>
        <button className="btn" disabled={busy || pendingRows} onClick={() => void signOutTeaching().catch((cause) => setError(cause.message))}>Sign out</button></div></header>
    {state.rounds && <div className="mt-5 overflow-x-auto rounded-lg border border-ink-200"><table aria-label="Your round results" className="w-full text-left text-sm"><thead className="bg-ink-50"><tr>{["Round", "Paper", "Method", "Status", "Accuracy", "Time"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{state.rounds.map(round => <tr key={round.id} className="border-t border-ink-100"><td className="px-3 py-2">{round.roundNo}</td><td className="px-3 py-2">{round.paperNo}</td><td className="px-3 py-2">{round.mode === "ai" ? "AI" : "Manual"}</td><td className="px-3 py-2">{round.status === "submitted" ? "Submitted" : "In progress"}</td><td className="px-3 py-2">{accuracy(round.result?.accuracy)}</td><td className="px-3 py-2">{minutes(round.elapsedSeconds)}</td></tr>)}</tbody></table></div>}
    {hasPaper && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-ink-200 py-4"><h2 className="max-w-4xl text-sm font-medium leading-6">{state.experiment.paperTitle}{state.task && <span className="mt-1 block text-xs font-normal text-ink-500">Paper task {state.task.id.slice(0, 8)} · Shared answer key for both groups</span>}</h2>
      <div className="flex gap-4 text-sm"><button className="text-brand-700" onClick={() => setShowPaper(!showPaper)}>{showPaper ? "Hide source" : "Compare with source"}</button>
        <a target="_blank" rel="noreferrer" href="/api/teaching/lab/paper" className="text-brand-700">Open PDF ↗</a></div></div>}
    {!submitted && state.status !== "extracting" && !(state.groupNo && hasPaper) && <div className="my-5 rounded-xl border border-ink-200 bg-white p-5"><h2 className="font-semibold">Upload your paper</h2><p className="mt-2 text-sm text-ink-500">{state.groupNo ? `Upload the agreed Paper ${state.paperNo} PDF (up to 20 MB). The first upload fixes the paper for both paired groups.` : "Choose a readable PDF, up to 20 MB. Matching paper content joins the same task. Replacing it resets your draft and timer."}</p><label className="btn-primary mt-4 inline-flex cursor-pointer">{hasPaper ? "Replace PDF" : "Upload PDF"}<input aria-label="Upload paper PDF" type="file" accept=".pdf" className="sr-only" disabled={busy || pendingRows} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); setError(""); setNotice("");
      try { const form = new FormData(); form.set("file", file); form.set("version", String(state.version)); form.set("attemptId", state.id);
        const next = await requestJson<SimpleStudentState>("/api/teaching/lab/paper", { method: "POST", body: form }, "Upload failed");
        setState(next); setRows(next.rows); setFilename(""); setManualMinutes(""); setReviewed(false); setPendingRows(false); setShowPaper(true); setNotice("Paper uploaded. You can begin extraction.");
      } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
    }} /></label></div>}
    {state.groupNo && !hasPaper && <button className="btn" disabled={busy} onClick={() => void refresh().catch((cause) => setError(cause.message))}>Check for paired group upload</button>}
    {error && <div className="mt-4"><RequestError>{error}</RequestError><button className="mt-2 text-xs text-brand-700 underline" disabled={busy || pendingRows} onClick={() => void refresh().then(() => setError("")).catch((cause) => setError(cause.message))}>Refresh saved progress</button></div>}
    {notice && <p role="status" className="mt-3 text-sm text-brand-700">{notice}</p>}
    {submitted ? <div className="my-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6"><h2 className="text-xl font-semibold text-emerald-900">{state.roundNo === 1 ? "Round 1 completed" : "Experiment completed"}</h2>
      <p className="mt-3 text-sm leading-7 text-emerald-900">Accuracy <strong>{accuracy(state.result?.accuracy)}</strong> · Experiment time <strong>{minutes(state.elapsedSeconds)}</strong></p>
      <p className="mt-1 text-xs text-emerald-800">{state.pendingGrade ? "Awaiting answer key. Accuracy will be calculated when your instructor sets the reference answers." : `Original automatic accuracy ${accuracy(state.result?.machineAccuracy)}. The instructor can update final results after review.`}</p>
      {state.mode === "ai" && state.startedAt && state.extractedAt && <p className="mt-2 text-xs text-emerald-800">Extraction stage {minutes((Date.parse(state.extractedAt) - Date.parse(state.startedAt)) / 1000)} · Review stage {minutes((Date.parse(state.submittedAt!) - Date.parse(state.extractedAt)) / 1000)}</p>}
      {state.roundNo === 1 && <button className="btn-primary mr-3 mt-4" disabled={busy} onClick={async () => {
        setBusy(true); setError(""); try { const next = await labPost<SimpleStudentState>({ action: "nextRound", attemptId: state.id, version: state.version }); setState(next); setRows(next.rows); setShowPaper(next.mode === "ai"); setNotice("Round 2 is ready. Your first-round results are saved."); }
        catch (cause) { setError(requestErrorMessage(cause, "Could not enter round 2")); } finally { setBusy(false); }
      }}>Continue to round 2</button>}
      <button className="btn mt-4" onClick={() => void refresh().catch((cause) => setError(cause.message))}>Refresh scores</button>
    </div> : !hasPaper ? null : state.mode === "ai" ? <div className="my-5">
      <ol aria-label="Extraction and review" className="flex gap-3 text-sm"><li className={`rounded-lg px-4 py-2 ${inReview ? "bg-ink-50 text-ink-500" : "bg-brand-50 font-medium text-brand-800"}`}>1 Extraction</li><li className={`rounded-lg px-4 py-2 ${inReview ? "bg-brand-50 font-medium text-brand-800" : "bg-ink-50 text-ink-500"}`}>2 Review and submit</li></ol>
      {!inReview && <div className="mt-5 rounded-xl border border-ink-200 bg-white p-6">
        <h2 className="text-lg font-semibold">{state.status === "extracting" || busy ? "Extracting paper" : "Start paper extraction"}</h2>
        <p className="mt-2 text-sm leading-7 text-ink-500">Generate candidate records using the extraction platform. Timing starts when extraction begins and stops when you submit the review.</p>
        {state.error && <p className="mt-2 text-sm text-amber-700">{state.error}</p>}
        <button className="btn-primary mt-4" disabled={busy || state.status === "extracting" && attemptAge < 360000} onClick={() => void extract()}>
          {busy || state.status === "extracting" && attemptAge < 360000 ? "Extracting…" : state.status === "error" || state.status === "extracting" ? "Extract again" : "Start extraction"}</button>
        {state.status === "extracting" && <p className="mt-3 text-xs text-ink-500">Progress updates automatically. Retry after 6 minutes if needed; elapsed time is preserved.</p>}
      </div>}
    </div> : <div className="my-6 max-w-3xl rounded-xl border border-ink-200 bg-white p-6">
      <h2 className="text-lg font-semibold">Submit manual extraction</h2><p className="mt-2 text-sm leading-7 text-ink-500">Complete the template, upload a CSV, TSV, or XLSX file, and enter your recorded experiment time.</p>
      <div className="mt-4 flex flex-wrap items-center gap-4"><label className={`btn-primary cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>Upload extraction table<input aria-label="Upload extraction table" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy} onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); setError(""); setNotice("");
        try { const uploaded = await uploadTable(file); const next = await labPost<SimpleStudentState>({ action: "save", attemptId: state.id, version: state.version, rows: uploaded });
          setState(next); setRows(next.rows); setFilename(file.name); setPendingRows(false); setNotice("Table uploaded and saved. Check the preview before submitting.");
        } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
      }} /></label><a href="/api/teaching/lab/table" className="text-sm text-brand-700">Download template</a><span className="text-xs text-ink-500">{filename || (rows.length ? "Uploaded table restored" : "Up to 100 records · 5 MB")}</span></div>
      <label className="mt-5 block max-w-xs text-sm text-ink-700">Manual experiment time (minutes)<input type="number" min="0.01" max="10080" step="0.01" value={manualMinutes} onChange={(event) => setManualMinutes(event.target.value)} placeholder="Example: 25.5" className={`${fieldInput} mt-2`} disabled={busy} /></label>
    </div>}
    <div className={`mt-5 grid gap-5 ${showPaper && (rows.length || inReview) ? "xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)]" : ""}`}>
      {hasPaper && showPaper && <SimplePaperViewer key={state.experiment.sourceId} />}
      {(rows.length > 0 || inReview) && <div className="min-w-0"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{submitted ? "Submitted results" : state.mode === "ai" ? "Review candidate records" : "Upload preview"}</h2><span className="text-xs text-ink-500">{rows.length}  records</span></div>
        <SimpleRows rows={rows} disabled={busy} {...(state.mode === "ai" && inReview ? { onChange: (next: SimpleRow[]) => { setRows(next); setPendingRows(true); setReviewed(false); } } : {})} />
        {!submitted && state.mode === "ai" && inReview && <>
          <p className="mt-3 text-xs leading-6 text-ink-500">Check each field against the source. Edit, add, or remove records as needed. Include units for temperature and load. Enter NR for unreported values. Missing fields count as unmatched.</p>
          <label className="mt-4 flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-1" disabled={busy} />I have checked all records against the source.</label>
          <div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn" disabled={busy} onClick={() => void save()}>Save draft</button><button className="btn-primary" disabled={busy || !reviewed || !rows.length} onClick={() => void submit()}>{busy ? "Processing…" : "Complete review and submit"}</button><span className="text-xs text-ink-500">Submitting stops the timer. Automatic scoring uses the instructor’s answer key.</span></div>
        </>}
        {!submitted && state.mode === "manual" && <button className="btn-primary mt-5" disabled={busy || !rows.length || !Number.isFinite(Number(manualMinutes)) || Number(manualMinutes) <= 0 || Number(manualMinutes) > 10080} onClick={() => void submit()}>{busy ? "Processing…" : "Submit table and time"}</button>}
      </div>}
    </div>
  </section>;
}
