"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { simpleGroupAssignment } from "@/lib/teaching/simpleShared";
import type { SimpleDashboard, SimpleExperiment, SimpleMode, SimplePaperTask, SimpleRow, SimpleStudent } from "@/lib/teaching/simpleShared";
import type { SimplePaperOption } from "@/lib/teaching/simplePapers";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import { accuracy, blankRow, FIELD_LABELS, fieldInput, groupLabel, groupSummary, labPost, minutes, signOutTeaching, SimpleRows, STATUS_LABELS, uploadTable } from "./SimpleTeachingParts";

export type SimpleTeacherData = { experiments: SimpleExperiment[]; papers: SimplePaperOption[]; dashboard: SimpleDashboard | null };
export function SimpleTeacherDashboard({ initial, example = false }: { initial: SimpleTeacherData; example?: boolean }) {
  const [data, setData] = useState(initial);
  const [creating, setCreating] = useState(!example && !initial.experiments.length);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const currentId = data.dashboard?.experiment.id;
  const refresh = useCallback(async (id?: string) => {
    const next = await requestJson<SimpleTeacherData>(`/api/teaching/lab${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" }, "Refresh failed");
    setData(next); setError("");
  }, []);
  useEffect(() => {
    if (example) return;
    const timer = setInterval(() => { if (!document.hidden) void refresh(currentId).catch((cause) => setError(requestErrorMessage(cause, "Refresh failed"))); }, 15000);
    return () => clearInterval(timer);
  }, [currentId, refresh, example]);
  const dashboard = data.dashboard;
  const tasks = dashboard?.tasks ?? [];
  const task = tasks.find((item) => item.id === selectedTaskId) ?? tasks[0];
  const students = dashboard?.students.filter((student) => student.taskId === task?.id) ?? [];
  const unassigned = dashboard?.students.filter((student) => !student.taskId) ?? [];
  const review = students.find((student) => student.id === selectedStudent);
  const ai = groupSummary(students.filter((student) => student.mode === "ai"));
  const manual = groupSummary(students.filter((student) => student.mode === "manual"));
  async function refreshNow(id?: string) {
    setBusy(true); setNotice("");
    try { await refresh(id); setNotice("Results updated"); } catch (cause) { setError(requestErrorMessage(cause, "Refresh failed")); } finally { setBusy(false); }
  }
  return <section lang="en-US" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight text-ink-950">Paper extraction lab</h1><p className="mt-1 text-sm text-ink-500">Experiment → Paper task → AI and manual groups</p></div>
      <div className="flex flex-wrap gap-2">{example ? <a className="btn" href="/teaching/admin">Back to instructor dashboard</a> : <><a className="btn" href="/teaching/example">View example data</a><button className="btn" disabled={busy} onClick={() => void refreshNow(currentId)}>Refresh results</button>
        <button className="btn" onClick={() => void signOutTeaching().catch((cause) => setError(cause.message))}>Sign out</button></>}</div>
    </header>
    {example && <p role="note" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Example data · Simulated papers, answers and timing for demonstrating the workflow. Read-only; excluded from classroom results.</p>}
    {error && <div className="mt-4"><RequestError>{error}</RequestError></div>}
    {notice && <p role="status" className="mt-3 text-sm text-brand-700">{notice}</p>}
    <div className="mt-6 flex flex-wrap items-end gap-3">
      <label className="min-w-60 flex-1 text-xs text-ink-600">Current experiment<select aria-label="Current experiment" className={`${fieldInput} mt-1`} value={currentId ?? ""} disabled={example || busy || !data.experiments.length}
        onChange={(event) => { setSelectedTaskId(null); setSelectedStudent(null); void refreshNow(event.target.value); }}>
        {!data.experiments.length && <option value="">No experiment created yet</option>}
        {data.experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.name}</option>)}
      </select></label>
      {!example && <button className="btn-primary min-h-10" onClick={() => setCreating(!creating)}>{creating ? "Hide settings" : "New experiment"}</button>}
    </div>
    {creating && <CreateExperiment onCreated={async (experiment) => {
      await refresh(experiment.id); setCreating(false); setSelectedTaskId(null); setSelectedStudent(null); setNotice("Experiment created. Students can join by selecting an extraction method on the lab entry page.");
    }} />}
    {dashboard && <>
      {dashboard.experiment.design === "crossover" && <section className="mt-5 rounded-xl border border-ink-200 bg-white p-5"><h2 className="font-semibold">Group and round assignments</h2><p className="mt-2 text-sm text-ink-500">Students stay in their assigned group for both rounds. Each paired group uses the same paper. Uploads are provided by students.</p>
        <div className="mt-4 overflow-x-auto"><table aria-label="Group round schedule" className="w-full text-left text-sm"><thead className="bg-ink-50"><tr>{["Group", "Round 1", "Round 2", "Submitted R1 / R2"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{[1, 2, 3, 4].map(groupNo => <tr key={groupNo} className="border-t border-ink-100"><td className="px-3 py-3 font-medium">Group {groupNo}</td>{[1, 2].map(roundNo => { const assignment = simpleGroupAssignment(groupNo, roundNo); return <td key={roundNo} className="px-3 py-3">Paper {assignment.paperNo} · {assignment.mode === "ai" ? "AI" : "Manual"}</td>; })}<td className="px-3 py-3">{dashboard.students.filter(student => student.groupNo === groupNo && student.roundNo === 1 && student.status === "submitted").length} / {dashboard.students.filter(student => student.groupNo === groupNo && student.roundNo === 2 && student.status === "submitted").length}</td></tr>)}</tbody></table></div>
      </section>}

      <div className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Paper tasks</h2><span className="text-xs text-ink-500">{tasks.length} tasks · {new Set(dashboard.students.map(student => student.learnerId ?? student.id)).size} students</span></div>
        {tasks.length > 0 ? <label className="mt-4 block text-sm text-ink-600">Current paper task<select aria-label="Current paper task" className={`${fieldInput} mt-2`} value={task?.id ?? ""} onChange={(event) => { setSelectedTaskId(event.target.value); setSelectedStudent(null); }}>
          {tasks.map((item, index) => <option key={item.id} value={item.id}>{item.paperNo ? `Paper ${item.paperNo}` : `${index + 1}.`} {item.sourceId ? item.paperTitle : "Awaiting student upload"} · {item.id.slice(0, 8)} · {dashboard.students.filter((student) => student.taskId === item.id).length} students</option>)}
        </select></label> : <p className="mt-3 text-sm text-ink-500">Tasks appear when students upload a paper. Matching paper content is grouped automatically within this experiment.</p>}
        {unassigned.length > 0 && <details className="mt-3 text-sm text-ink-500"><summary className="cursor-pointer">Awaiting paper upload · {unassigned.length} students</summary><ul className="mt-2 space-y-1">{unassigned.map((student) => <li key={student.id}>{student.studentAlias} · {groupLabel(student.mode)}</li>)}</ul></details>}
      </div>
      {task && <>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3 border-y border-ink-200 py-4"><div><h2 className="font-semibold">{task.paperNo ? `Paper ${task.paperNo} · ` : ""}{task.sourceId ? task.paperTitle : "Awaiting student upload"}</h2><p className="mt-1 text-xs text-ink-500">Task {task.id.slice(0, 8)} · Shared answer key: {task.gold.length ? `${task.gold.length} records` : "Awaiting answer key"}</p></div>
        {!example && task.sourceId && <a className="text-sm text-brand-700" target="_blank" rel="noreferrer" href={`/api/teaching/lab/paper?sourceId=${task.sourceId}`}>View paper ↗</a>}
      </div>
      {task.sourceId && <TaskAnswerKey key={`${task.id}-${task.version}`} task={task} readOnly={example} onSaved={async () => { await refresh(currentId); setNotice("Shared answer key saved. Both groups have been rescored."); }} />}
      {ai.count > 0 && manual.count > 0 && <p className="mt-4 rounded-lg bg-ink-50 px-4 py-3 text-sm text-ink-700">
        {ai.accuracy != null && manual.accuracy != null ? <>Accuracy difference (AI − manual): <strong>{((ai.accuracy - manual.accuracy) * 100).toFixed(1)} percentage points</strong>. </> : <>Accuracy comparison awaits scored submissions in both groups. </>}
        {ai.seconds! > 0 ? <>Manual group average time / AI group average time: <strong>{(manual.seconds! / ai.seconds!).toFixed(2)} times</strong>.</> : "AI group has insufficient timing data for a speed comparison."}
        <span className="ml-2 text-xs text-ink-500">Current paper task only. Accuracy uses scored submissions; time uses all submissions.</span>
      </p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2" aria-label="Group comparison">
        {(["ai", "manual"] as SimpleMode[]).map((mode) => <GroupPanel key={mode} mode={mode}
          students={students.filter((student) => student.mode === mode)} selectedId={selectedStudent}
          onSelect={setSelectedStudent} />)}
      </div>
      <p className="mt-3 text-xs leading-6 text-ink-500">AI group time runs from extraction to review submission, including waits and retries. Manual time is recorded by students. Results are intended for descriptive classroom comparisons.</p>
      {review?.learnerId && <section className="mt-5 rounded-lg border border-ink-200 p-5"><h2 className="font-semibold">{review.studentAlias} · Group {review.groupNo} · Both rounds</h2><div className="mt-3 overflow-x-auto"><table aria-label="Student paired results" className="w-full text-left text-sm"><thead><tr>{["Round", "Paper", "Method", "Accuracy", "Time", "Status"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{dashboard.students.filter(item => item.learnerId === review.learnerId).sort((a,b) => a.roundNo! - b.roundNo!).map(item => <tr key={item.id}><td className="p-2">{item.roundNo}</td><td className="p-2">{item.paperNo}</td><td className="p-2">{item.mode === "ai" ? "AI" : "Manual"}</td><td className="p-2">{accuracy(item.score?.accuracy)}</td><td className="p-2">{minutes(item.elapsedSeconds)}</td><td className="p-2">{STATUS_LABELS[item.status]}</td></tr>)}</tbody></table></div></section>}
      {review?.score && <ReviewStudent key={`${review.id}-${review.version}`} student={review} readOnly={example} onClose={() => setSelectedStudent(null)} onSaved={async () => { await refresh(currentId); setNotice("Instructor review saved. Group statistics updated."); }} />}
      {review && !review.score && <section className="mt-5 rounded-lg border border-ink-200 p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">{review.studentAlias} · {review.status === "submitted" ? "Awaiting answer key" : STATUS_LABELS[review.status]}</h2><button className="btn" onClick={() => setSelectedStudent(null)}>Collapse</button></div><p className="my-3 text-sm text-ink-500">Time {minutes(review.elapsedSeconds)}</p><SimpleRows rows={review.rows} /></section>}
      <details className="mt-6 rounded-lg border border-ink-200 p-4"><summary className="cursor-pointer text-sm font-medium text-ink-700">Scoring rules</summary>
        <p className="my-4 text-xs leading-6 text-ink-500">Automatic scoring starts after the instructor sets an answer key for the uploaded paper. Each record is matched uniquely by the greatest field overlap. Record order does not affect scoring; missing and extra records reduce the score. Text matching ignores case and extra spaces. Temperature and load support unit conversion. Enter NR for unreported values; blanks count as unmatched. Group comparisons use instructor-reviewed accuracy while preserving the original automatic score.</p>
        </details>
      </>}
    </>}
  </section>;
}

function CreateExperiment({ onCreated }: { onCreated: (experiment: SimpleExperiment) => Promise<void> }) {
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { const result = await labPost<SimpleDashboard>({ action: "create", name }); await onCreated(result.experiment); }
    catch (cause) { setError(requestErrorMessage(cause, "Creation failed")); } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void create(event)} className="mt-5 rounded-xl border border-ink-200 bg-white p-5">
    <h2 className="text-lg font-semibold">New experiment</h2><p className="mt-2 text-sm text-ink-500">Four fixed groups, two rounds. Students upload the four assigned papers.</p>
    <label className="mt-4 block text-sm">Experiment name<input required maxLength={100} className={`${fieldInput} mt-2`} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <button className="btn-primary mt-4" disabled={busy}>{busy ? "Saving…" : "Create experiment"}</button>
    {error && <RequestError>{error}</RequestError>}
  </form>;
}

function TaskAnswerKey({ task, readOnly, onSaved }: { task: SimplePaperTask; readOnly: boolean; onSaved: () => Promise<void> }) {
  const [gold, setGold] = useState<SimpleRow[]>(task.gold.length ? task.gold : [blankRow()]);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <details className="mt-4 rounded-xl border border-ink-200 bg-white p-5">
    <summary className="cursor-pointer font-medium">{readOnly ? "View shared answer key" : task.gold.length ? "Edit shared answer key" : "Set shared answer key"}</summary>
    <p className="my-3 text-sm text-ink-500">One answer key applies to all students in this paper task. Saving recalculates submitted results in both groups and resets prior instructor overrides.</p>
    {!readOnly && <><label className="btn mb-3 inline-flex cursor-pointer">Upload answer key<input aria-label="Upload answer key" type="file" accept=".csv,.tsv,.xlsx" className="sr-only" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); setError("");
      try { setGold(await uploadTable(file)); setConfirmed(false); } catch (cause) { setError(requestErrorMessage(cause, "Upload failed")); } finally { setBusy(false); }
    }} /></label><a className="ml-4 text-sm text-brand-700" href="/api/teaching/lab/table">Download template</a></>}
    <SimpleRows rows={gold} label={readOnly ? "Shared answer key" : "Edit answer key"} disabled={busy} {...(!readOnly ? { onChange: (rows: SimpleRow[]) => { setGold(rows); setConfirmed(false); } } : {})} />
    {!readOnly && <><label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I have verified the shared answer key against this paper.</label>
    <button className="btn-primary mt-4" disabled={busy || !confirmed} onClick={async () => {
      setBusy(true); setError(""); try { await labPost({ action: "taskGold", taskId: task.id, version: task.version, gold }); await onSaved(); }
      catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); }
    }}>{busy ? "Saving…" : "Save key and score both groups"}</button></>}
    {error && <RequestError>{error}</RequestError>}
  </details>;
}

function GroupPanel({ mode, students, selectedId, onSelect }: { mode: SimpleMode; students: SimpleStudent[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const summary = groupSummary(students);
  return <section aria-label={groupLabel(mode)} className={`overflow-hidden rounded-xl border border-ink-200 bg-white border-t-4 ${mode === "ai" ? "border-t-brand-600" : "border-t-amber-500"}`}>
    <header className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{groupLabel(mode)}</h2>
      <a href="/teaching" className="text-xs text-brand-700">Student entry ↗</a></div>
      <p className="mt-2 text-xs text-ink-500">{mode === "ai" ? "Extraction → Review → Automatically timed submission" : "Upload table → Enter time → Submit"}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4"><div><dt className="text-xs text-ink-500">Average accuracy</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{accuracy(summary.accuracy)}</dd></div>
        <div><dt className="text-xs text-ink-500">Average time</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{minutes(summary.seconds)}</dd></div></dl>
      <p className="mt-3 text-xs text-ink-500">Submitted {summary.count} / {students.length} participants · Scored {summary.scoredCount}</p>
    </header>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-ink-50 text-xs text-ink-500"><tr>{["Student", "Accuracy", "Time", "Status"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr></thead>
      <tbody>{students.map((student) => <tr key={student.id} className={`border-t border-ink-100 ${selectedId === student.id ? "bg-brand-50" : ""}`}>
        <td className="px-4 py-3"><button onClick={() => onSelect(student.id)} className="max-w-40 break-words text-left font-medium text-brand-700 underline-offset-4 hover:underline">{student.studentAlias}</button>{student.groupNo && <p className="mt-1 text-xs text-ink-500">Group {student.groupNo} · Round {student.roundNo}</p>}<p className="mt-1 max-w-48 truncate text-xs text-ink-500">{student.paper?.paperTitle}</p></td>
        <td className="px-4 py-3 tabular-nums"><span>{accuracy(student.score?.accuracy)}</span>{student.reviewedAt && <span className="mt-1 block whitespace-nowrap text-[10px] text-ink-500">Instructor reviewed</span>}</td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{minutes(student.elapsedSeconds)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">{student.status === "submitted" && !student.score ? "Awaiting answer key" : student.mode === "manual" && student.status === "review" ? "Pending submission" : STATUS_LABELS[student.status]}</td>
      </tr>)}</tbody></table></div>
    {!students.length && <p className="px-5 py-8 text-center text-sm leading-6 text-ink-500">No students have joined yet.<br />Students can select their group at the lab entry page to begin.</p>}
    {summary.count > 0 && <p className="px-5 py-3 text-xs text-ink-500">Select a student to view and review their answers.</p>}
  </section>;
}

function ReviewStudent({ student, readOnly = false, onClose, onSaved }: { student: SimpleStudent; readOnly?: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [overrides, setOverrides] = useState(student.overrides); const [note, setNote] = useState(student.reviewNote);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <section aria-label="Instructor review" className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
    <header className="flex justify-between gap-4"><div><h2 className="text-lg font-semibold">{student.studentAlias} · {groupLabel(student.mode)}</h2>
      <p className="mt-1 text-sm text-ink-500">Automatic score {accuracy(student.score?.machineAccuracy)} · Current accuracy {accuracy(student.score?.accuracy)} · Time {minutes(student.elapsedSeconds)}</p></div>
      <button className="btn" onClick={onClose}>Collapse</button></header>
    <details className="mt-3 text-xs text-ink-500"><summary className="cursor-pointer">Student recovery code</summary><code className="mt-2 block select-all">{student.resumeCode}</code></details>
    <div className="mt-4 max-h-[480px] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-ink-50 text-xs text-ink-500"><tr>{["Reference / Student records", "Field", "Answer key", "Student answers", "Automatic assessment", "Instructor assessment"].map((label) => <th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}</tr></thead>
      <tbody>{student.score?.cells.map((cell) => <tr key={cell.key} className="border-t border-ink-100">
        <td className="px-3 py-3 text-xs">{cell.goldRow == null ? "Extra" : cell.goldRow + 1} / {cell.answerRow == null ? "Missing" : cell.answerRow + 1}</td>
        <td className="whitespace-nowrap px-3 py-3">{FIELD_LABELS[cell.field]}</td><td className="max-w-48 break-words px-3 py-3">{cell.expected || "—"}</td><td className="max-w-48 break-words px-3 py-3">{cell.actual || "Missing"}</td>
        <td className={`whitespace-nowrap px-3 py-3 text-xs ${cell.machineCorrect ? "text-emerald-700" : "text-amber-700"}`}>{cell.machineCorrect ? "Match" : "Unmatched"}</td>
        <td className="px-3 py-2"><select aria-label={`Review ${cell.key}`} disabled={busy || readOnly} className={`${fieldInput} min-w-28`} value={cell.key in overrides ? String(overrides[cell.key]) : "auto"} onChange={(event) => {
          const next = { ...overrides }; if (event.target.value === "auto") delete next[cell.key]; else next[cell.key] = event.target.value === "true"; setOverrides(next);
        }}><option value="auto">Use automatic score</option><option value="true">Correct</option><option value="false">Incorrect</option></select></td>
      </tr>)}</tbody></table></div>
    <label className="mt-4 block text-xs text-ink-600">Review notes<textarea maxLength={1000} readOnly={readOnly} value={note} onChange={(event) => setNote(event.target.value)} className={`${fieldInput} mt-1 py-2`} placeholder="Explain the review decision, including equivalent terms or unusual units" /></label>
    {!readOnly && <button className="btn-primary mt-3" disabled={busy} onClick={async () => { setBusy(true); setError(""); try {
      await labPost({ action: "review", studentId: student.id, version: student.version, overrides, note }); await onSaved();
    } catch (cause) { setError(requestErrorMessage(cause, "Save failed")); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save instructor review"}</button>}
    {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
  </section>;
}
