"use client";

import { useCallback, useEffect, useState } from "react";
import type { LiveParticipantView, LiveStudentState } from "@/lib/teaching/liveShared";
import { blankLiveRow, liveDomainLabel, liveFields, liveInstructions, liveMethodLabel, liveRowsCsv, type LiveDomain } from "@/lib/teaching/liveFields";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import { accuracy, minutes } from "./SimpleTeachingParts";
import { SimplePaperViewer } from "./SimplePaperViewer";
import { LiveRows, uploadLiveTable } from "./LiveRows";
import { useLiveDraft } from "./useLiveDraft";
import { LiveLessonGuide } from "./LiveLessonGuide";
import { LiveAfmResults } from "./LiveAfmResults";

type AvailableClassroom = { id: string; name: string; domain?: LiveDomain; groupCount: number };
type StudentData = { state: LiveStudentState | null; openExperiment: AvailableClassroom | null; openExperiments?: AvailableClassroom[] };
async function post<T>(body: object, url = "/api/teaching/live"): Promise<T> {
  return requestJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Action failed");
}

export function LiveStudent() {
  const [data, setData] = useState<StudentData>({ state: null, openExperiment: null });
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [choice, setChoice] = useState("");
  const refresh = useCallback(async () => { setData(await requestJson<StudentData>("/api/teaching/live", { cache: "no-store" }, "Refresh failed")); setLoaded(true); }, []);
  useEffect(() => { void refresh().catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => setError("Live updates are unavailable. Your saved work is retained; check the connection.")); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const available = data.openExperiments ?? (data.openExperiment ? [data.openExperiment] : []);
  const selected = available.find((e) => e.id === choice) ?? available[0];
  async function join() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try { setData({ state: await post<LiveStudentState>({ action: "join", experimentId: selected.id }), openExperiment: null }); }
    catch (cause) { setError(requestErrorMessage(cause, "Join failed")); } finally { setBusy(false); }
  }
  const state = data.state;
  const canJoin = selected && (!state || state.experiment.status === "finished");
  return <div data-testid="live-student" className="mt-3 space-y-5">
    {error && <RequestError>{error}</RequestError>}
    {!loaded && <p className="text-sm text-ink-500">Loading…</p>}
    {canJoin && <section className="rounded-xl border border-brand-200 bg-brand-50/50 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Open classroom · {liveDomainLabel(selected.domain)}</p>
      {available.length > 1 ? <label className="mt-3 block text-sm">Choose your instructor&apos;s classroom<select aria-label="Available classrooms" className="mt-2 min-h-10 w-full rounded-lg border border-ink-200 bg-white px-3" value={selected.id} onChange={(event) => setChoice(event.target.value)}>{available.map((e) => <option key={e.id} value={e.id}>{e.name} · {liveDomainLabel(e.domain)}</option>)}</select></label> : <h3 className="mt-2 text-lg font-semibold">{selected.name}</h3>}
      <p className="mt-2 text-sm text-ink-600">Join before the instructor starts. The paper and group assignment will appear automatically.</p>
      <button className="btn-primary mt-4" disabled={busy} onClick={() => void join()}>{busy ? "Joining…" : "Join experiment"}</button>
    </section>}
    {loaded && !state && !canJoin && <p className="rounded-xl border border-dashed border-ink-300 p-6 text-sm text-ink-500">No classroom is open for joining yet.</p>}
    {state?.participant.status === "waiting" && <section className="rounded-xl border border-ink-200 bg-white p-6">
      <h3 className="text-lg font-semibold">{state.experiment.name}</h3>
      <p className="mt-3 text-sm text-ink-600">You have joined round {state.experiment.round || 1}. {state.joinedCount} students are waiting for the instructor to start. This page updates automatically.</p>
    </section>}
    {state && state.participant.status !== "waiting" && <LiveWorkspace key={state.participant.id} initial={state} />}
  </div>;
}

export function LiveWorkspace({ initial }: { initial: LiveStudentState }) {
  const meta = initial.experiment, domain = meta.domain || "tribology";
  const draft = useLiveDraft(initial.participant, domain, meta.status === "running");
  const state = draft.participant;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [showPaper, setShowPaper] = useState(true);
  const submitted = state.status === "submitted", extracting = state.status === "extracting";
  const editable = meta.status === "running" && !submitted && !extracting && (state.mode === "manual" || state.status === "review");
  const labels = Object.fromEntries(liveFields(domain).map((field) => [field.key, field.label]));
  const incomplete = draft.rows.reduce((sum, row) => sum + liveFields(domain).filter((field) => !row[field.key]?.trim()).length, 0);
  async function extract() {
    if (busy || draft.saving) return;
    setBusy(true); setError(""); setNotice("Extracting source-grounded records…");
    try {
      draft.accept(await post<LiveParticipantView>({ participantId: state.id, version: state.version }, "/api/teaching/live/extract"), true);
      setNotice("Extraction complete. Check each observation and its source before submitting.");
    } catch (cause) { setError(requestErrorMessage(cause, "Extraction failed")); setNotice(""); } finally { setBusy(false); }
  }
  async function submit() {
    if (busy || draft.saving || draft.dirty || draft.conflict || !editable) return;
    setBusy(true); setError("");
    try { draft.accept(await post<LiveParticipantView>({ action: "submit", participantId: state.id, version: state.version, rows: draft.rows }), true); setNotice("Results submitted to the instructor."); }
    catch (cause) { setError(requestErrorMessage(cause, "Submission failed")); } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([liveRowsCsv(draft.rows, domain)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `teaching-${domain}-${state.id}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="space-y-5">
    <header className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">{meta.name}</h3><p className="mt-1 text-sm text-ink-600">{liveDomainLabel(domain)} · Round {meta.round || 1} · Group {state.groupNo} · {liveMethodLabel(domain, state.mode)} · {meta.status}</p></div>
        <div className="flex gap-2"><button className="btn" onClick={() => setShowPaper(!showPaper)}>{showPaper ? "Hide paper" : "View paper"}</button><a className="btn" href="/api/teaching/live/paper" target="_blank" rel="noreferrer">Open PDF</a></div>
      </div>
      <p className="mt-2 text-xs text-ink-500">{meta.paperTitle}</p>
    </header>
    <LiveLessonGuide domain={domain} />
    {meta.taskInstructions && <section aria-label="Assigned lesson task" className="rounded-xl border border-ink-200 bg-white p-4"><h4 className="text-sm font-semibold">Your task</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-700">{meta.taskInstructions}</p></section>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {showPaper && <SimplePaperViewer baseUrl="/api/teaching/live/paper" />}
      <div className={`min-w-0 space-y-4 ${showPaper ? "" : "xl:col-span-2"}`}>
        {error && <RequestError>{error}</RequestError>}
        {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}
        {meta.status === "finished" && !submitted && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">This classroom has finished. Unsent browser drafts are retained, but further edits and submissions are closed.</p>}
        {state.mode === "ai" && !submitted && state.status !== "review" && meta.status === "running" && <section className="rounded-xl border border-ink-200 bg-white p-5">
          <h4 className="font-semibold">{liveMethodLabel(domain, state.mode)}</h4><p className="mt-2 text-sm text-ink-600">{domain === "afm" ? "The platform recognizer finds source panels, curve pixels and available physical axes. Results and source crops are saved to the classroom server. Unresolved axes remain explicitly relative." : "The configured model uses this lesson's domain schema. No mock data are used."} Timing includes extraction and your review.</p>
          {state.error && <p className="mt-2 text-sm text-amber-700">{state.error}</p>}
          <button className="btn-primary mt-3" disabled={busy || (extracting && Date.now() - Date.parse(state.extractionAttemptAt || "") < 360000)} onClick={() => void extract()}>{busy || extracting ? "Extracting / recover after 6 minutes" : domain === "afm" ? "Start automatic extraction" : "Start AI extraction"}</button>
        </section>}
        {state.afmArtifactId && <LiveAfmResults key={state.afmArtifactId} participantId={state.id} experimentId={meta.id} />}
        <section className="rounded-xl border border-ink-200 bg-white p-5">
          <h4 className="font-semibold">{submitted ? "Submitted observations" : "Extraction records"}</h4>
          <p className="my-3 text-xs leading-5 text-ink-500">{liveInstructions(domain)} Use NR for unreported fields; never enter zero as a substitute.</p>
          {editable && <div className="mb-4 flex flex-wrap gap-2">
            <label className="btn cursor-pointer">Upload table<input aria-label="Upload extraction table" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy || draft.saving} onChange={async (event) => {
              const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
              if (draft.rows.some((row) => Object.values(row).some(Boolean)) && !window.confirm("Replace the current observations with this table?")) return;
              setBusy(true); setError(""); try { draft.edit(await uploadLiveTable(file, domain)); } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
            }} /></label>
            <a className="btn" href={`/api/teaching/live/table?domain=${domain}`}>Download template</a>
          </div>}
          <LiveRows domain={domain} rows={draft.rows.length ? draft.rows : [blankLiveRow(domain)]} disabled={busy || !editable} onChange={editable ? draft.edit : undefined} />
          {!submitted && <div className="mt-4 space-y-3">
            {incomplete > 0 && <p className="text-xs text-amber-800">{incomplete} empty field(s), including collapsed conditions / source sections. Complete them or enter NR if unreported.</p>}
            <p role="status" className="text-xs text-ink-600">{draft.saving ? "Saving draft…" : draft.message || (state.startedAt ? "Server draft restored. Timing continues from your first saved edit." : "Timing starts at your first server-saved edit.")}</p>
            {draft.conflict && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Another session changed these records. Your edits have not been overwritten.
              <div className="mt-2 flex gap-2"><button className="btn" onClick={() => draft.resolve(true)}>Keep my browser draft</button><button className="btn" onClick={() => draft.resolve(false)}>Use server records</button></div>
            </div>}
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!editable || busy || draft.saving || draft.conflict || !draft.dirty} onClick={() => void draft.save()}>Save draft now</button>
              <button className="btn-primary" disabled={!editable || busy || draft.saving || draft.dirty || draft.conflict || !draft.rows.length || (meta.classroomVersion === 2 && incomplete > 0)} onClick={() => void submit()}>Submit results</button>
            </div>
            <p className="text-xs text-ink-500">Save confirmation is required before submitting. Elapsed time includes pauses after the first saved edit.</p>
          </div>}
          {draft.rows.length > 0 && <button className="btn mt-3" onClick={download}>Export my records CSV</button>}
        </section>
        {submitted && <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h4 className="font-semibold text-emerald-900">Submission received</h4>
          <p className="mt-2 text-sm">Elapsed: {minutes(state.elapsedSeconds)} · {meta.hasAnswerKey ? `Accuracy: ${accuracy(state.score?.accuracy)}` : "Awaiting an answer key / instructor review"}</p>
          {meta.assessmentPolicy && <p className="mt-2 text-xs">Assessment tolerance: {meta.assessmentPolicy.relativeTolerancePercent}%{meta.assessmentPolicy.absoluteTolerance ? ` / ${meta.assessmentPolicy.absoluteTolerance}` : ""}; measured values only.</p>}
          {state.reviewNote && <p className="mt-2 text-sm">Instructor note: {state.reviewNote}</p>}
          {(meta.hasAnswerKey || state.reviewedAt) && state.score && <div className="mt-4 max-h-96 overflow-auto"><table aria-label="Your reviewed results" className="w-full text-left text-xs">
            <thead><tr>{["Record", "Field", "Expected", "Your answer", "Assessment"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
            <tbody>{state.score.cells.map((cell) => <tr key={cell.key} className="border-t border-emerald-200"><td className="p-2">{cell.answerRow == null ? "Missing" : cell.answerRow + 1}</td><td className="p-2">{labels[cell.field]}</td><td className="break-words p-2">{cell.expected || "—"}</td><td className="break-words p-2">{cell.actual || "Missing"}</td><td className="p-2">{cell.mark}</td></tr>)}</tbody>
          </table></div>}
        </section>}
      </div>
    </div>
  </section>;
}
