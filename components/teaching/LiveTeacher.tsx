"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { LiveAssessmentPolicy, LiveDashboard, LiveExperiment, LiveMark, LiveParticipantView } from "@/lib/teaching/liveShared";
import { blankLiveRow, LIVE_DOMAINS, liveDomainLabel, liveFields, liveMethodLabel, type LiveDomain } from "@/lib/teaching/liveFields";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import { accuracy, fieldInput, minutes } from "./SimpleTeachingParts";
import { LiveRows, uploadLiveTable } from "./LiveRows";
import { LiveLessonGuide } from "./LiveLessonGuide";
import { LiveAfmResults } from "./LiveAfmResults";
import { SCHOOL_PANEL } from "../workspaceStyles";

export type TeacherData = { experiments: LiveExperiment[]; dashboard: LiveDashboard | null; canUseAi: boolean; automaticDomains?: LiveDomain[] };
type Stage = "prepare" | "classroom" | "results";
const MARK_STYLE: Record<LiveMark, string> = { correct: "bg-emerald-100 text-emerald-900", incorrect: "bg-rose-100 text-rose-900", uncertain: "bg-amber-100 text-amber-900" };
async function post<T>(body: object): Promise<T> {
  return requestJson<T>("/api/teaching/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Action failed");
}

export function LiveTeacher({ initialData }: { initialData?: TeacherData }) {
  const [data, setData] = useState<TeacherData>(initialData ?? { experiments: [], dashboard: null, canUseAi: false });
  const [loaded, setLoaded] = useState(Boolean(initialData)), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialData?.dashboard?.experiment.id ?? null), [reviewId, setReviewId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(initialData?.dashboard?.experiment.status === "finished" ? "results" : initialData?.dashboard?.experiment.status === "running" ? "classroom" : "prepare"), [keyDirty, setKeyDirty] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [stale, setStale] = useState(false);
  const requestSerial = useRef({ value: 0 });
  const activeClassroom = useRef<string | undefined>();
  const refresh = useCallback(async (id?: string | null) => {
    const serial = ++requestSerial.current.value;
    const next = await requestJson<TeacherData>(`/api/teaching/live${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" }, "Refresh failed");
    if (serial !== requestSerial.current.value) return;
    setData(next); setLoaded(true); setStale(false);
    setSelectedId((current) => current ?? next.dashboard?.experiment.id ?? null);
  }, []);
  useEffect(() => { void refresh().catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(selectedId).catch(() => setStale(true)); }, 5000);
    const requests = requestSerial.current;
    return () => { clearInterval(timer); requests.value++; };
  }, [refresh, selectedId]);
  const dashboard = data.dashboard, experiment = dashboard?.experiment;
  const domain = experiment?.domain || "tribology";
  const review = dashboard?.participants.find((item) => item.id === reviewId && item.score);
  useEffect(() => { if (activeClassroom.current === experiment?.id) return; activeClassroom.current = experiment?.id; setStage(experiment?.status === "open" ? "prepare" : experiment?.status === "finished" ? "results" : "classroom"); setKeyDirty(false); }, [experiment?.id, experiment?.status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (keyDirty || reviewDirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [keyDirty, reviewDirty]);
  function canLeave() { if (!keyDirty && !reviewDirty) return true; if (!window.confirm("Leave without saving the current answer-key or review edits?")) return false; setKeyDirty(false); setReviewDirty(false); return true; }
  async function run(action: string, message: string) {
    if (busy || !experiment) return;
    setBusy(true); setError("");
    try {
      const next = await post<LiveDashboard>({ action, experimentId: experiment.id });
      setSelectedId(next.experiment.id); await refresh(next.experiment.id); setNotice(message);
      if (action === "start") setStage("classroom");
      if (action === "finish") setStage("results");
    } catch (cause) { setError(requestErrorMessage(cause, "Action failed")); } finally { setBusy(false); }
  }
  const ready = Boolean(experiment?.paperSourceId && experiment.gold.length && dashboard?.participants.length);
  return <div data-testid="live-teacher" className="mt-3 space-y-5">
    {error && <RequestError>{error}</RequestError>}
    {stale && <p role="alert" className="text-sm text-amber-800">Live updates are temporarily unavailable. Existing work is retained; check the connection before starting or finishing class.</p>}
    {notice && <p role="status" className="text-sm text-brand-700">{notice}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 text-xs text-ink-600">Classroom
        <select aria-label="Current live experiment" className={`${fieldInput} mt-1`} value={experiment?.id ?? ""} disabled={!data.experiments.length || busy}
          onChange={(event) => { if (!canLeave()) return; setSelectedId(event.target.value); setReviewId(null); void refresh(event.target.value).catch((cause) => setError(requestErrorMessage(cause, "Load failed"))); }}>
          {!data.experiments.length && <option value="">No experiment yet</option>}
          {data.experiments.map((item) => <option key={item.id} value={item.id}>{item.name} · {liveDomainLabel(item.domain)} · {item.status}</option>)}
        </select>
      </label>
      <button className="btn-primary min-h-10" disabled={busy} onClick={() => { if (canLeave()) setCreating(!creating); }}>{creating ? "Cancel" : "Create experiment"}</button>
    </div>
    {creating && <CreateLiveExperiment automaticDomains={data.automaticDomains || (data.canUseAi ? ["tribology", "conductivity", "afm"] : ["afm"])} onCreated={async (created) => {
      setCreating(false); setSelectedId(created.experiment.id); await refresh(created.experiment.id); setNotice("Classroom created. Prepare the paper and verified answer key, then check the roster.");
    }} />}
    {!loaded && <p role="status" className="text-sm text-ink-500">Loading…</p>}
    {loaded && !dashboard && !creating && <p className={`${SCHOOL_PANEL} p-6 text-sm text-ink-500`}>Create a classroom to prepare a lesson. Teachers and students use this same entry with their platform accounts.</p>}
    {!creating && dashboard && experiment && <>
      <header className={`${SCHOOL_PANEL} p-5`}>
        <h3 className="text-lg font-semibold">{experiment.name}</h3>
        <p className="mt-1 text-sm text-ink-500">{liveDomainLabel(domain)} · Round {experiment.round || 1} · {experiment.status} · {dashboard.participants.length} students</p>
        <nav aria-label="Instructor lesson stages" className="mt-5 grid gap-2 sm:grid-cols-3">{([['prepare', '1. Prepare lesson'], ['classroom', '2. Run classroom'], ['results', '3. Review and export']] as const).map(([value, label]) => <button key={value} type="button" disabled={busy} aria-current={stage === value ? "step" : undefined} className={`rounded-lg border px-4 py-3 text-left text-sm ${stage === value ? "border-brand-500 bg-brand-50 font-semibold text-brand-900" : "border-ink-200 text-ink-600"}`} onClick={() => { if (canLeave()) { setStage(value); setReviewId(null); } }}>{label}</button>)}</nav>
      </header>
      {stage === "prepare" && <section className={`${SCHOOL_PANEL} space-y-4 p-5`}>
        <h4 className="font-semibold">Lesson preparation</h4>
        <LiveLessonGuide domain={domain} instructor />
        {experiment.status === "open" && <div className="flex flex-wrap items-center gap-3">
          <label className={`btn cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>{experiment.paperSourceId ? "Replace paper PDF" : "Upload paper PDF"}
            <input aria-label="Upload experiment paper" type="file" accept=".pdf" className="sr-only" disabled={busy} onChange={async (event) => {
              const file = event.target.files?.[0]; event.target.value = ""; if (!file || !canLeave()) return;
              if (experiment.paperSourceId && !window.confirm("Replacing the paper clears its answer key. Continue?")) return;
              setBusy(true); setError("");
              try { const form = new FormData(); form.set("file", file); form.set("experimentId", experiment.id);
                await requestJson("/api/teaching/live/paper", { method: "POST", body: form }, "Upload failed"); await refresh(experiment.id); setNotice("Paper uploaded. Prepare its answer key before starting.");
              } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
            }} />
          </label><span className="text-sm text-ink-600">{experiment.paperTitle || "No paper uploaded"}</span>
        </div>}
        {experiment.previousRoundId && <p className="text-xs leading-5 text-ink-600">Round 2 keeps the same students and groups, swaps extraction methods and requires a different paper with a new answer key.</p>}
        {experiment.paperSourceId && <a className="inline-block text-sm text-brand-700" target="_blank" rel="noreferrer" href={`/api/teaching/live/paper?experimentId=${experiment.id}`}>Open assigned PDF ↗</a>}
        <LiveAnswerKey key={experiment.id} experiment={experiment} onDirtyChange={setKeyDirty} onBusyChange={setBusy} onSaved={async () => { await refresh(experiment.id); setNotice("Answer key and assessment settings saved. Previous review marks were reset."); }} />
        <button className="btn-primary" disabled={keyDirty || !experiment.paperSourceId || !experiment.gold.length} onClick={() => setStage("classroom")}>Continue to classroom</button>
      </section>}
      {stage === "classroom" && <section className={`${SCHOOL_PANEL} space-y-4 p-5`}>
        <h4 className="font-semibold">Classroom readiness</h4>
        <ul className="space-y-2 text-sm text-ink-600"><li>{experiment.paperSourceId ? "✓ Paper ready" : "○ Upload a paper in Prepare lesson"}</li><li>{experiment.gold.length ? `✓ Answer key ready · ${experiment.gold.length} observations` : "○ Save the answer key in Prepare lesson"}</li><li>{dashboard.participants.length ? `✓ ${dashboard.participants.length} students joined` : "○ Ask students to open AI experiment → Experiment Ⅰ and join"}</li></ul>
        <p className="text-xs leading-5 text-ink-500">{experiment.channel === "alternating" ? `${domain === "afm" ? "Automatic" : "AI-assisted"} and manual groups work on the same paper. Group assignment is frozen when class starts.` : "All groups work manually."} Time is elapsed wall-clock time, including pauses, not active attention.</p>
        <div className="overflow-x-auto"><table aria-label="Classroom roster" className="w-full text-left text-sm"><thead className="bg-ink-50"><tr>{["Student", "Group", "Method", "Progress"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{dashboard.participants.map((p) => <tr key={p.id} className="border-t border-ink-100"><td className="p-3">{p.alias}</td><td className="p-3">{p.groupNo || "Assigned at start"}</td><td className="p-3">{p.mode ? liveMethodLabel(domain, p.mode) : "Assigned at start"}</td><td className="p-3">{p.status}</td></tr>)}</tbody></table></div>
        {experiment.status === "open" && <button className="btn-primary" disabled={busy || !ready || stale} onClick={() => void run("start", "Classroom started. Students have their paper and group assignment.")}>Start experiment</button>}
        {experiment.status === "running" && <button className="btn" disabled={busy || stale} onClick={() => { const missing = dashboard.participants.filter((p) => p.status !== "submitted").length; if (window.confirm(`${missing ? `${missing} students have not submitted. ` : ""}Finish this classroom and close further submissions?`)) void run("finish", "Classroom finished. Review and exports remain available."); }}>Finish experiment</button>}
        {experiment.status === "finished" && <p className="text-sm text-ink-600">Classroom finished. Open Review and export for the saved results.</p>}
      </section>}
      {stage === "results" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Review and export</h4><div className="flex gap-2"><a className="btn" href={`/api/teaching/live/export?experimentId=${experiment.id}&format=records`}>Records CSV</a><a className="btn" href={`/api/teaching/live/export?experimentId=${experiment.id}`}>Assessment CSV</a></div></div>
        <LiveResults dashboard={dashboard} onSelect={(id) => { if (id !== reviewId && canLeave()) setReviewId(id); }} />
        {review && <LiveReview key={review.id} experiment={experiment} participant={review} onDirtyChange={setReviewDirty} onClose={() => setReviewId(null)} onSaved={async () => { setReviewId(null); await refresh(experiment.id); setNotice("Review saved and shared with the student."); }} />}
        {experiment.status === "finished" && experiment.channel === "alternating" && !experiment.previousRoundId && <details className={`${SCHOOL_PANEL} p-4`}><summary className="cursor-pointer text-sm font-medium">Optional: second-round crossover</summary><p className="my-3 text-xs leading-5 text-ink-600">Use a different paper and answer key. The same students keep their groups and swap methods. All students must have submitted round 1. This supports a paired classroom comparison, not a causal claim.</p><button className="btn" disabled={busy || dashboard.participants.some((p) => p.status !== "submitted")} onClick={() => void run("nextRound", "Round 2 prepared. Upload a different paper and save its answer key.")}>{experiment.nextRoundId ? "Open round 2" : "Prepare round 2"}</button></details>}
      </>}
    </>}
  </div>;
}

function CreateLiveExperiment({ automaticDomains, onCreated }: { automaticDomains: LiveDomain[]; onCreated: (dashboard: LiveDashboard) => Promise<void> }) {
  const [name, setName] = useState(""), [domain, setDomain] = useState<LiveDomain>("conductivity");
  const [groupCount, setGroupCount] = useState(2), [channel, setChannel] = useState("manual");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const automatic = automaticDomains.includes(domain);
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await onCreated(await post<LiveDashboard>({ action: "create", name, domain, groupCount, channel })); }
    catch (cause) { setError(requestErrorMessage(cause, "Creation failed")); } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void create(event)} className={`${SCHOOL_PANEL} p-5`}>
    <h3 className="font-semibold">Create experiment</h3>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-xs text-ink-600">Experiment name<input aria-label="Experiment name" required maxLength={100} className={`${fieldInput} mt-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Week 3: conductivity vs temperature" /></label>
      <label className="text-xs text-ink-600">Teaching domain<select aria-label="Teaching domain" className={`${fieldInput} mt-1`} value={domain} onChange={(event) => { setDomain(event.target.value as LiveDomain); setChannel("manual"); }}>{LIVE_DOMAINS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label className="text-xs text-ink-600">Groups (2–8)<input aria-label="Group count" type="number" min={2} max={8} className={`${fieldInput} mt-1`} value={groupCount} onChange={(event) => setGroupCount(Number(event.target.value))} /></label>
      <label className="text-xs text-ink-600">Extraction channel<select aria-label="Extraction channel" className={`${fieldInput} mt-1`} value={channel} onChange={(event) => setChannel(event.target.value)}><option value="manual">Manual</option><option value="alternating" disabled={!automatic}>{domain === "afm" ? "Automatic / manual groups" : "AI-assisted / manual groups"}</option></select></label>
    </div>
    <p className="mt-3 text-xs leading-5 text-ink-500">{domain === "afm" ? "Automatic AFM recognition uses the same local recognizer as the research workspace; no paid language model is needed." : automatic ? "AI-assisted groups use the configured extraction model and may incur provider charges." : "No extraction model is configured. Manual lessons work; AI-assisted groups remain disabled."}</p>
    <button className="btn-primary mt-4" disabled={busy}>{busy ? "Creating…" : "Create and prepare lesson"}</button>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </form>;
}

function LiveAnswerKey({ experiment, onSaved, onDirtyChange, onBusyChange }: { experiment: LiveExperiment; onSaved: () => Promise<void>; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const domain = experiment.domain || "tribology";
  const [gold, setGold] = useState(experiment.gold.length ? experiment.gold : [blankLiveRow(domain)]);
  const [policy, setPolicy] = useState<LiveAssessmentPolicy>(experiment.assessmentPolicy || { relativeTolerancePercent: 0, absoluteTolerance: "" });
  const [keyVersion, setKeyVersion] = useState(experiment.keyVersion ?? 0), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [instructions, setInstructions] = useState(experiment.taskInstructions || "");
  const [sourceId, setSourceId] = useState(experiment.paperSourceId);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  function markDirty() { setDirty(true); onDirtyChange(true); }
  useEffect(() => {
    if (!dirty && !busy) { setGold(experiment.gold.length ? experiment.gold : [blankLiveRow(domain)]); setPolicy(experiment.assessmentPolicy || { relativeTolerancePercent: 0, absoluteTolerance: "" }); setKeyVersion(experiment.keyVersion ?? 0); setInstructions(experiment.taskInstructions || ""); setSourceId(experiment.paperSourceId); }
  }, [experiment.gold, experiment.assessmentPolicy, experiment.keyVersion, experiment.taskInstructions, experiment.paperSourceId, domain, dirty, busy]);
  const changedElsewhere = (keyVersion !== (experiment.keyVersion ?? 0) || sourceId !== experiment.paperSourceId) && dirty;
  return <details open={!experiment.gold.length} className="rounded-lg border border-ink-200 p-4">
    <summary className="cursor-pointer text-sm font-medium text-ink-700">Answer key · {experiment.gold.length} saved observations{dirty ? " · unsaved edits" : ""}</summary>
    <p className="mt-3 text-xs leading-5 text-ink-500">Verify every observation against the source. Fill all fields; use NR when unreported. Saving replaces the key and clears previous review marks. The key is not generated or approved automatically.</p>
    <label className="mt-4 block text-xs text-ink-600">Student task / target figures<textarea aria-label="Lesson instructions" className={`${fieldInput} mt-1 min-h-24 py-2`} maxLength={3000} disabled={busy} value={instructions} placeholder="Specify the table / panels, properties and comparisons students should report. Do not put the answers here." onChange={(event) => { setInstructions(event.target.value); markDirty(); }} /></label>
    {changedElsewhere && <div role="alert" className="mt-3 text-sm text-amber-800">The saved paper or key changed in another session. Your edits are retained and cannot overwrite the newer version.<button className="btn ml-3" onClick={() => { if (window.confirm("Discard these unsaved edits and reload the saved key?")) { setDirty(false); onDirtyChange(false); } }}>Reload saved key</button></div>}
    <div className="my-3 flex flex-wrap gap-3"><label className="btn cursor-pointer">Upload answer table<input aria-label="Upload answer key" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy} onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); setError(""); try { setGold(await uploadLiveTable(file, domain)); markDirty(); } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); } }} /></label><a className="btn" href={`/api/teaching/live/table?domain=${domain}`}>Download template</a></div>
    <LiveRows domain={domain} rows={gold} label="Answer key" disabled={busy} onChange={(rows) => { setGold(rows); markDirty(); }} />
    {domain !== "tribology" && <details className="mt-4 border-t border-ink-100 pt-3"><summary className="cursor-pointer text-sm font-medium">Assessment settings</summary><p className="my-3 text-xs leading-5 text-ink-500">Default: exact reported values after unit conversion. For image readings only, set a justified tolerance before class. Tolerances apply to measured value / separation, never to experimental conditions. Unknown units must match exactly.</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-ink-600">Relative tolerance (%)<input aria-label="Relative tolerance percent" className={`${fieldInput} mt-1`} type="number" min="0" max="20" step="0.1" value={policy.relativeTolerancePercent} onChange={(event) => { setPolicy({ ...policy, relativeTolerancePercent: Number(event.target.value) }); markDirty(); }} /></label><label className="text-xs text-ink-600">Absolute tolerance (optional, with unit)<input aria-label="Absolute tolerance" className={`${fieldInput} mt-1`} maxLength={80} value={policy.absoluteTolerance} placeholder="e.g. 0.05 nN" onChange={(event) => { setPolicy({ ...policy, absoluteTolerance: event.target.value }); markDirty(); }} /></label></div></details>}
    <button className="btn-primary mt-4" disabled={busy || changedElsewhere || !experiment.paperSourceId} onClick={async () => {
      if (experiment.gold.length && !window.confirm("Replace the answer key and clear previous review marks?")) return;
      setBusy(true); setError("");
      try { await post({ action: "gold", experimentId: experiment.id, gold, keyVersion, assessmentPolicy: policy, taskInstructions: instructions }); setDirty(false); onDirtyChange(false); await onSaved(); }
      catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save verified answer key"}</button>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </details>;
}

function LiveResults({ dashboard, onSelect }: { dashboard: LiveDashboard; onSelect: (id: string) => void }) {
  const { experiment, participants } = dashboard, domain = experiment.domain || "tribology";
  return <section className={`${SCHOOL_PANEL} space-y-4 p-5`}>
    <p className="text-xs leading-5 text-ink-500">{participants.filter((p) => p.status === "submitted").length} / {participants.length} submitted. Select a student to inspect observations and review individual fields. Automatic scores are provisional; uncertain fields remain in the denominator.</p>
    <details><summary className="cursor-pointer text-sm font-medium">Group summaries</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: experiment.groupCount }, (_, i) => i + 1).map((group) => { const members = participants.filter((p) => p.groupNo === group), submitted = members.filter((p) => p.status === "submitted"), timed = submitted.filter((p) => p.elapsedSeconds != null); return <div key={group} className="rounded-lg border border-ink-200 p-3 text-xs"><p className="font-semibold">Group {group} · {members[0]?.mode ? liveMethodLabel(domain, members[0].mode) : "Not assigned"}</p><p className="mt-2">{submitted.length} / {members.length} submitted · {accuracy(experiment.gold.length && submitted.length ? submitted.reduce((sum, p) => sum + (p.score?.accuracy || 0), 0) / submitted.length : null)}</p><p className="mt-1">{minutes(timed.length ? timed.reduce((sum, p) => sum + p.elapsedSeconds!, 0) / timed.length : null)}</p></div>; })}</div></details>
    <div className="overflow-x-auto"><table aria-label="Combined group results" className="w-full text-left text-sm"><thead className="bg-ink-50"><tr>{["Student / group", "Method", "Progress", "Accuracy", "Elapsed", "Review"].map((label) => <th key={label} className="whitespace-nowrap p-3">{label}</th>)}</tr></thead><tbody>{participants.map((p) => <tr key={p.id} className="border-t border-ink-100"><td className="p-3">{p.alias} · {p.groupNo ? `G${p.groupNo}` : "—"}</td><td className="p-3">{p.mode ? liveMethodLabel(domain, p.mode) : "—"}</td><td className="p-3">{p.status}</td><td className="p-3">{experiment.gold.length ? accuracy(p.score?.accuracy) : "Awaiting key"}</td><td className="p-3">{minutes(p.elapsedSeconds)}</td><td className="p-3"><button className="text-brand-700 underline disabled:text-ink-400 disabled:no-underline" disabled={!p.score} onClick={() => onSelect(p.id)}>{p.reviewedAt ? "Edit review" : "Review"}</button></td></tr>)}</tbody></table></div>
    {dashboard.previousRound && <details className="border-t border-ink-100 pt-3"><summary className="cursor-pointer text-sm font-medium">Paired round comparison</summary><p className="my-3 text-xs text-ink-500">Different papers and opposite methods; elapsed times include pauses. These are classroom comparisons, not controlled causal estimates.</p><div className="overflow-x-auto"><table aria-label="Paired classroom rounds" className="w-full text-left text-xs"><thead><tr>{["Student", "Round 1 method / accuracy / time", "Round 2 method / accuracy / time"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{participants.map((p) => { const before = dashboard.previousRound!.participants.find((first) => first.userKey === p.userKey); return <tr key={p.id} className="border-t border-ink-100"><td className="p-2">{p.alias}</td><td className="p-2">{before ? `${liveMethodLabel(domain, before.mode)} · ${accuracy(before.score?.accuracy)} · ${minutes(before.elapsedSeconds)}` : "No paired result"}</td><td className="p-2">{liveMethodLabel(domain, p.mode)} · {accuracy(p.score?.accuracy)} · {minutes(p.elapsedSeconds)}</td></tr>; })}</tbody></table></div></details>}
  </section>;
}

function LiveReview({ participant, experiment, onClose, onSaved, onDirtyChange }: { participant: LiveParticipantView; experiment: LiveExperiment; onClose: () => void; onSaved: () => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const [snapshot] = useState(participant);
  const [overrides, setOverrides] = useState<Record<string, LiveMark>>(snapshot.overrides), [note, setNote] = useState(snapshot.reviewNote);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const labels = Object.fromEntries(liveFields(experiment.domain).map((field) => [field.key, field.label]));
  const changed = note !== snapshot.reviewNote || JSON.stringify(overrides) !== JSON.stringify(snapshot.overrides);
  useEffect(() => { onDirtyChange(changed); return () => onDirtyChange(false); }, [changed, onDirtyChange]);
  return <section aria-label="Instructor review" className={`${SCHOOL_PANEL} p-5`}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Review · {snapshot.alias} · Group {snapshot.groupNo}</h3><p className="mt-1 text-xs text-ink-500">{accuracy(snapshot.score?.accuracy)} · {minutes(snapshot.elapsedSeconds)}</p></div><button className="btn" onClick={() => { if (!changed || window.confirm("Discard unsaved review changes?")) onClose(); }}>Close review</button></header>
    {participant.version !== snapshot.version && <p role="alert" className="mt-3 text-sm text-amber-800">The submission changed. Your unsaved marks are retained; close and reopen to review the latest version.</p>}
    <div className="my-3"><a className="text-sm text-brand-700" href={`/api/teaching/live/paper?experimentId=${experiment.id}`} target="_blank" rel="noreferrer">Open source PDF ↗</a></div>
    {snapshot.afmArtifactId && <LiveAfmResults participantId={snapshot.id} experimentId={experiment.id} />}
    <div className="mt-4 max-h-[480px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-ink-50"><tr>{["Record", "Field", "Expected", "Actual", "Review"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{snapshot.score?.cells.map((cell) => <tr key={cell.key} className={`border-t border-ink-100 ${MARK_STYLE[overrides[cell.key] || cell.mark]}`}><td className="p-3">{cell.answerRow == null ? "Missing" : cell.answerRow + 1}</td><td className="p-3">{labels[cell.field]}</td><td className="max-w-48 break-words p-3">{cell.expected || "No answer key"}</td><td className="max-w-48 break-words p-3">{cell.actual || "Missing"}</td><td className="p-3"><select aria-label={`Review ${cell.key}`} className={fieldInput} disabled={busy} value={overrides[cell.key] || cell.mark} onChange={(event) => setOverrides((previous) => ({ ...previous, [cell.key]: event.target.value as LiveMark }))}>{(["correct", "incorrect", "uncertain"] as const).map((mark) => <option key={mark} value={mark}>{mark}</option>)}</select></td></tr>)}</tbody></table></div>
    <label className="mt-4 block text-xs text-ink-600">Instructor note<textarea aria-label="Instructor note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} className={`${fieldInput} mt-1 py-2`} /></label>
    <button className="btn-primary mt-3" disabled={busy || participant.version !== snapshot.version} onClick={async () => { setBusy(true); setError(""); try { await post({ action: "review", participantId: snapshot.id, version: snapshot.version, overrides, note }); await onSaved(); } catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); } }}>Save instructor review</button>
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </section>;
}
