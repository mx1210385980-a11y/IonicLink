"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import {
  TEACHING_FIELDS,
  type GroupCrossoverDashboard,
  type GroupCrossoverListItem,
  type TeachingFieldKey,
  type TeachingScore,
  type TeachingScores,
  type TeachingTeacherRound,
} from "@/lib/teachingShared";

// Mirrors CheckedRecordOption in lib/teaching/groupGold.ts (server-only module,
// so the shape is duplicated here for the client bundle).
type CheckedRecordOption = {
  recordId: string;
  title: string;
  doi: string;
  journal: string;
  cation: string;
  anion: string;
  substrate: string;
  temperatureRaw: string;
  loadRaw: string;
  cof: number;
};

type ImportResult = {
  added: number;
  updated: number;
  rejected: Array<{ line: number; studentName: string; reason: string }>;
};

const SEQUENCE_LABELS = {
  manual_then_ai: "Manual→AI",
  ai_then_manual: "AI→Manual",
} as const;

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function parseRosterLines(text: string): Array<{ studentName: string; groupNo: number }> {
  const entries: Array<{ studentName: string; groupNo: number }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaParts = line.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    let name = "";
    let groupText = "";
    if (commaParts.length >= 2) {
      name = commaParts.slice(0, -1).join(" ");
      groupText = commaParts[commaParts.length - 1];
    } else {
      const spaceParts = line.split(/\s+/).filter(Boolean);
      if (spaceParts.length >= 2) {
        name = spaceParts.slice(0, -1).join(" ");
        groupText = spaceParts[spaceParts.length - 1];
      }
    }
    const groupNo = Number(groupText);
    if (name && Number.isInteger(groupNo)) entries.push({ studentName: name, groupNo });
  }
  return entries;
}

export function GroupCrossoverAdmin() {
  const [experiments, setExperiments] = useState<GroupCrossoverListItem[] | null>(null);
  const [records, setRecords] = useState<CheckedRecordOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [dashboard, setDashboard] = useState<GroupCrossoverDashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // create form
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [groupCount, setGroupCount] = useState("10");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // roster import
  const [rosterText, setRosterText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // review
  const [reviewParticipantId, setReviewParticipantId] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, TeachingScores>>({});
  const [savingReview, setSavingReview] = useState(false);

  const loadList = useCallback(async () => {
    const result = await requestJson<{ experiments: GroupCrossoverListItem[] }>(
      "/api/teaching/admin/group?action=list",
      { cache: "no-store" },
      "Could not load experiments"
    );
    setExperiments(result.experiments);
    setShowCreate((current) => current || result.experiments.length === 0);
    return result.experiments;
  }, []);

  const loadDashboard = useCallback(async (projectId: string) => {
    const result = await requestJson<GroupCrossoverDashboard>(
      `/api/teaching/admin/group?action=dashboard&projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
      "Could not load experiment dashboard"
    );
    setDashboard(result);
    setRosterOpen(result.roster.length === 0);
  }, []);

  useEffect(() => {
    loadList()
      .then((list) => {
        if (list.length > 0) {
          setSelectedId(list[0].id);
          return loadDashboard(list[0].id);
        }
      })
      .catch((cause) => setError(requestErrorMessage(cause, "Could not load group experiment.")));
    requestJson<{ records: CheckedRecordOption[] }>(
      "/api/teaching/admin/group?action=checkedRecords",
      { cache: "no-store" },
      "Could not load paper pool"
    )
      .then((result) => setRecords(result.records))
      .catch((cause) => setError(requestErrorMessage(cause, "Could not load paper pool.")));
  }, [loadList, loadDashboard]);

  const selectExperiment = (projectId: string) => {
    setSelectedId(projectId);
    setRosterOpen(false);
    setReviewParticipantId(null);
    setImportResult(null);
    setError("");
    loadDashboard(projectId).catch((cause) =>
      setError(requestErrorMessage(cause, "Could not load experiment dashboard."))
    );
  };

  const expectedCount = Number(groupCount);

  const togglePick = (recordId: string) => {
    setPicked((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId]
    );
  };

  const createExperiment = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{ projectId: string }>(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            name,
            inviteCode,
            groupCount: expectedCount,
            recordIds: picked,
          }),
        },
        "Could not create group experiment"
      );
      setNotice("Experiment created. Import the student roster next.");
      setName("");
      setInviteCode("");
      setPicked([]);
      setShowCreate(false);
      await loadList();
      selectExperiment(result.projectId);
      setRosterOpen(true);
    } catch (cause) {
      setError(requestErrorMessage(cause, "Could not create group experiment."));
    } finally {
      setCreating(false);
    }
  };

  const importRoster = async () => {
    if (importing || !selectedId) return;
    const entries = parseRosterLines(rosterText);
    if (entries.length === 0) {
      setError("No valid roster rows found. Enter name,group number on each line.");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const result = await requestJson<ImportResult>(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "importRoster", projectId: selectedId, entries }),
        },
        "Could not import roster"
      );
      setImportResult(result);
      setRosterText("");
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "Could not import roster."));
    } finally {
      setImporting(false);
    }
  };

  const removeRosterEntry = async (rosterId: string) => {
    setError("");
    try {
      await requestJson(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "deleteRosterEntry", projectId: selectedId, rosterId }),
        },
        "Could not delete roster entry"
      );
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "Could not delete roster entry."));
    }
  };

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice(`Experiment code: ${code}`);
    }
  };

  const reviewParticipant = useMemo(
    () => dashboard?.participants.find((row) => row.participantId === reviewParticipantId) ?? null,
    [dashboard, reviewParticipantId]
  );

  const reviewRounds = useMemo(() => {
    if (!reviewParticipant) return [];
    return [reviewParticipant.manual, reviewParticipant.aiAssisted].filter(
      (round): round is TeachingTeacherRound => round !== null
    );
  }, [reviewParticipant]);

  const openReview = (participantId: string) => {
    setReviewParticipantId(participantId);
    const participant = dashboard?.participants.find((row) => row.participantId === participantId);
    const drafts: Record<string, TeachingScores> = {};
    for (const round of [participant?.manual, participant?.aiAssisted]) {
      if (!round) continue;
      const scores: TeachingScores = {};
      for (const field of TEACHING_FIELDS) {
        scores[field.key] = round.review?.finalValueScores[field.key] ?? "pending";
      }
      drafts[round.submissionId] = scores;
    }
    setReviewDrafts(drafts);
  };

  const setReviewScore = (submissionId: string, field: TeachingFieldKey, score: TeachingScore) => {
    setReviewDrafts((current) => ({
      ...current,
      [submissionId]: { ...current[submissionId], [field]: score },
    }));
  };

  const saveReview = async (submissionId: string) => {
    if (savingReview) return;
    setSavingReview(true);
    setError("");
    try {
      await requestJson(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "review",
            submissionId,
            humanScores: reviewDrafts[submissionId] ?? {},
          }),
        },
        "Could not save review"
      );
      setNotice("Review saved. Statistics now use the reviewed scores.");
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "Could not save review."));
    } finally {
      setSavingReview(false);
    }
  };

  const summary = dashboard?.summary ?? null;
  const loading = experiments === null;

  return (
    <section lang="en-US" aria-labelledby="group-crossover-title" className="pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="group-crossover-title" className="text-xl font-semibold text-ink-950 sm:text-2xl">Group experiment</h2>
          <p className="mt-1 text-sm text-ink-600">
            {dashboard
              ? "View student progress, review scores, and export results below."
              : "Create an experiment, import the roster, and invite students with the experiment code."}
          </p>
        </div>
        {experiments && experiments.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Current experiment</span>
              <select
                value={selectedId}
                onChange={(event) => selectExperiment(event.target.value)}
                className="min-h-10 min-w-56 rounded-[8px] border border-ink-200 bg-white px-3 text-sm text-ink-900"
              >
                {experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>{experiment.name}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setShowCreate((current) => !current)} className="btn min-h-10 px-4">
              {showCreate ? "Cancel" : "New experiment"}
            </button>
          </div>
        ) : null}
      </header>

      {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}
      {notice ? (
        <p className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {loading ? <p className="mt-6 text-sm text-ink-500">Loading experiment…</p> : null}

      {showCreate ? (
      <div className="mt-6 rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-ink-950">
            <span className="mr-2 font-mono text-xs font-bold text-brand-700">Step 1</span>Create experiment
          </h3>
          <p className="text-xs text-ink-500">Select one paper record per group. Records are assigned in selection order.</p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">Experiment name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Example: Spring 2026 Tribology Lab"
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">Experiment code for students</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              maxLength={40}
              placeholder="At least 4 characters, e.g. TRIBO-2026"
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">Number of groups (even, 2–40)</span>
            <input
              type="number"
              value={groupCount}
              onChange={(event) => setGroupCount(event.target.value)}
              min={2}
              max={40}
              step={2}
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
        <details className="mt-4 rounded-[8px] border border-ink-200 bg-ink-50/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink-800 [&::-webkit-details-marker]:hidden">
            <span>Select paper</span>
            <span className={picked.length === expectedCount ? "text-emerald-700" : "text-brand-700"}>
              {picked.length} / {Number.isFinite(expectedCount) ? expectedCount : "—"} records
            </span>
          </summary>
          <p className="border-t border-ink-100 bg-white px-4 py-3 text-xs leading-5 text-ink-600">
            Records are assigned to groups in selection order. Each record represents one set of conditions, so a paper may appear more than once.
          </p>
        <div className="max-h-72 overflow-y-auto border-t border-ink-200 bg-white">
          {records.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">No reviewed records available.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {records.map((record) => {
                const order = picked.indexOf(record.recordId);
                return (
                  <li key={record.recordId}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-ink-50">
                      <input
                        type="checkbox"
                        checked={order >= 0}
                        onChange={() => togglePick(record.recordId)}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">
                          {order >= 0 && (
                            <span className="mr-2 rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-800">
                              Group {order + 1}
                            </span>
                          )}
                          {record.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {record.cation} / {record.anion} · {record.substrate} · {record.temperatureRaw} · {record.loadRaw} · COF {record.cof}
                          {record.journal ? ` · ${record.journal}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </details>
        <button
          type="button"
          onClick={() => void createExperiment()}
          disabled={creating || picked.length !== expectedCount || !name.trim() || inviteCode.trim().length < 4}
          className="btn-primary mt-4 min-h-10 px-5"
        >
          {creating ? "Creating…" : "Create experiment"}
        </button>
      </div>
      ) : null}

      {dashboard && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-brand-200 bg-brand-50/60 px-5 py-4">
            <p className="text-sm text-ink-700">
              Student join code
              <span className="ml-2 rounded-[6px] bg-white px-2.5 py-1 font-mono text-base font-bold tracking-wider text-brand-800 ring-1 ring-brand-200">
                {dashboard.experiment.inviteCode}
              </span>
            </p>
            <button
              type="button"
              onClick={() => void copyInviteCode(dashboard.experiment.inviteCode)}
              className="btn min-h-8 px-3 text-xs"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
            <p className="text-xs text-ink-500">Share this code with students on the roster so they can join at the lab entry page.</p>
          </div>

          <details
            open={rosterOpen}
            onToggle={(event) => setRosterOpen(event.currentTarget.open)}
            className="rounded-[12px] border border-ink-200 bg-white shadow-panel"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-base font-semibold text-ink-950 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="mr-2 font-mono text-xs font-bold text-brand-700">Step 2</span>Student roster
              </span>
              <span className="text-sm font-normal text-ink-500">{dashboard.roster.length} participants · Click to {rosterOpen ? "Collapse" : "Expand"}</span>
            </summary>
            <div className="border-t border-ink-100 px-5 pb-5 pt-4">
            <p className="text-sm leading-6 text-ink-600">
              Enter name/student ID,group number per line (comma or whitespace separated), groups 1–{dashboard.experiment.groupCount}.Roster entries are locked once students have joined.
            </p>
            <textarea
              value={rosterText}
              onChange={(event) => setRosterText(event.target.value)}
              rows={4}
              placeholder={"Alex,1\nSam,1\nTaylor,2"}
              className="mt-3 w-full rounded-[8px] border border-ink-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void importRoster()}
                disabled={importing || rosterText.trim().length === 0}
                className="btn-primary min-h-10 px-5"
              >
                {importing ? "Importing…" : "Import roster"}
              </button>
              {importResult && (
                <p className="text-sm text-ink-700">
                  Added {importResult.added} · Updated {importResult.updated} · Rejected {importResult.rejected.length}
                </p>
              )}
            </div>
            {importResult && importResult.rejected.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {importResult.rejected.map((item) => (
                  <li key={item.line}>
                    Row {item.line}: {item.studentName || " (empty)"}: {item.reason}
                  </li>
                ))}
              </ul>
            )}
            {dashboard.roster.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-[8px] border border-ink-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-ink-50">
                    <tr className="border-b border-ink-200 text-xs text-ink-500">
                      <th className="px-3 py-2 font-medium">Name / Student ID</th>
                      <th className="px-3 py-2 font-medium">Group number</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {dashboard.roster.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 text-ink-900">{entry.studentName}</td>
                        <td className="px-3 py-2">Group {entry.groupNo}</td>
                        <td className="px-3 py-2">
                          {entry.claimed ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">Joined</span>
                          ) : (
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">Not joined</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!entry.claimed && (
                            <button
                              type="button"
                              onClick={() => void removeRosterEntry(entry.id)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </details>

          <section aria-labelledby="group-results-title" className="rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="group-results-title" className="text-base font-semibold text-ink-950">
                <span className="mr-2 font-mono text-xs font-bold text-brand-700">Step 3</span>Progress and results
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadDashboard(selectedId)}
                  className="btn min-h-9 px-3 text-xs"
                >
                  Refresh
                </button>
                <a
                  href={`/api/teaching/admin/group/export?projectId=${encodeURIComponent(selectedId)}`}
                  className="btn min-h-9 px-3 text-xs"
                >
                  Export CSV
                </a>
                <a
                  href={`/api/teaching/admin/group/export?projectId=${encodeURIComponent(selectedId)}&anonymize=1`}
                  className="btn min-h-9 px-3 text-xs"
                >
                  Export anonymized
                </a>
              </div>
            </div>

            {summary && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatCard label="Joined / Completed" value={`${summary.completion.total} / ${summary.completion.completed}`} />
                <StatCard label="Eligible pairs" value={String(summary.completion.paired)} />
                <StatCard label="Accuracy · Manual → AI" value={`${percent(summary.manual.medianAccuracy)} → ${percent(summary.aiAssisted.medianAccuracy)}`} />
              </div>
            )}

            <h4 className="mt-6 text-sm font-semibold text-ink-900">Group overview</h4>
            <div className="mt-2 overflow-x-auto rounded-[8px] border border-ink-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">Group number</th>
                    <th className="px-3 py-2 font-medium">Extraction order</th>
                    <th className="px-3 py-2 font-medium">Assigned paper</th>
                    <th className="px-3 py-2 font-medium">Roster / Joined / Completed</th>
                    <th className="px-3 py-2 font-medium">Manual accuracy</th>
                    <th className="px-3 py-2 font-medium">AI Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {dashboard.groupProgress.map((group) => {
                    const diag = dashboard.diagnostics.byGroup[String(group.groupNo)];
                    return (
                      <tr key={group.groupNo}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-900">
                          Group {group.groupNo}<span className="ml-1.5 text-xs font-normal text-ink-400">{Math.ceil(group.groupNo / 2)} Group</span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {group.groupNo % 2 === 1 ? "AI → Manual" : "Manual → AI"}
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-2 text-xs" title={group.paperTitle}>
                          {group.paperTitle}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {group.rosterSize} / {group.joined} / {group.completed}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{percent(diag?.manual.medianAccuracy ?? null)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{percent(diag?.aiAssisted.medianAccuracy ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h4 className="mt-6 text-sm font-semibold text-ink-900">Student results and review</h4>
            <div className="mt-2 overflow-x-auto rounded-[8px] border border-ink-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Manual (Paper / Correct count)</th>
                    <th className="px-3 py-2 font-medium">AI (Paper / Correct count)</th>
                    <th className="px-3 py-2 font-medium">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {dashboard.participants.map((participant) => (
                    <tr key={participant.participantId}>
                      <td className="px-3 py-2 font-medium text-ink-900">{participant.studentAlias}</td>
                      <td className="px-3 py-2 text-xs">{SEQUENCE_LABELS[participant.sequence]}</td>
                      <td className="px-3 py-2 text-xs">
                        {participant.quality.completion === "completed" ? "Completed" : "In progress"}
                        {participant.quality.excluded && <span className="ml-1 text-red-600">Excluded</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {participant.manual
                          ? `${participant.manual.paperCode} / ${participant.manual.score.valueCorrect}/6`
                          : "—"}
                        {participant.manual?.review && <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] text-brand-800">Reviewed</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {participant.aiAssisted
                          ? `${participant.aiAssisted.paperCode} / ${participant.aiAssisted.score.valueCorrect}/6`
                          : "—"}
                        {participant.aiAssisted?.review && <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] text-brand-800">Reviewed</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openReview(participant.participantId)}
                          className="btn min-h-8 px-3 text-xs"
                        >
                          Review score adjustment
                        </button>
                      </td>
                    </tr>
                  ))}
                  {dashboard.participants.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-500">No students have joined yet. Share the experiment code to get started.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {reviewParticipant ? (
        <ReviewDialog
          alias={reviewParticipant.studentAlias}
          rounds={reviewRounds}
          drafts={reviewDrafts}
          saving={savingReview}
          onSetScore={setReviewScore}
          onSave={saveReview}
          onClose={() => setReviewParticipantId(null)}
        />
      ) : null}
    </section>
  );
}

function ReviewDialog({
  alias,
  rounds,
  drafts,
  saving,
  onSetScore,
  onSave,
  onClose,
}: {
  alias: string;
  rounds: TeachingTeacherRound[];
  drafts: Record<string, TeachingScores>;
  saving: boolean;
  onSetScore: (submissionId: string, field: TeachingFieldKey, score: TeachingScore) => void;
  onSave: (submissionId: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-review-dialog-title"
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-950/35 p-2 sm:p-6"
    >
      <button type="button" tabIndex={-1} aria-label="Close review" className="absolute inset-0 cursor-default" onClick={onClose} />
      <article className="relative z-10 my-auto w-full max-w-3xl overflow-hidden rounded-[12px] border border-ink-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h3 id="group-review-dialog-title" className="text-lg font-semibold text-ink-950">Review: {alias}</h3>
            <p className="mt-1 text-xs text-ink-600">Pending keeps the automatic score. Select Correct or Incorrect to update statistics using the review.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn min-h-9 px-3 text-xs">Close</button>
        </header>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-4">
          {rounds.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">This student has no submissions to review yet.</p>
          ) : null}
          {rounds.map((round) => (
            <div key={round.submissionId} className="mt-4 first:mt-0 rounded-[8px] border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-900">
                  {round.mode === "manual" ? "Manual round" : "AI Assisted round"} · Paper {round.paperCode} · Automatic {round.score.valueCorrect}/6
                  {round.review && (
                    <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-800">
                      Reviewed {new Date(round.review.reviewedAt).toLocaleString("en-US")}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => onSave(round.submissionId)}
                  disabled={saving}
                  className="btn-primary min-h-9 px-4 text-xs"
                >
                  {saving ? "Saving…" : "Save round review"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {TEACHING_FIELDS.map((field) => {
                  const auto = round.score.values[field.key];
                  const answer = round.finalAnswers[field.key];
                  const draft = drafts[round.submissionId]?.[field.key] ?? "pending";
                  return (
                    <div
                      key={field.key}
                      className="flex flex-wrap items-center gap-3 rounded-[6px] border border-ink-100 px-3 py-2"
                    >
                      <span className="w-24 text-xs font-semibold text-ink-800">{field.label}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-600" title={answer?.value ?? ""}>
                        {answer?.value || <em className="text-ink-400">Not filled</em>}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          auto?.correct
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        Automatic: {auto?.correct ? "Correct" : "Incorrect"}
                      </span>
                      <span className="flex rounded-[6px] border border-ink-200 bg-ink-50 p-0.5" role="group" aria-label={`${field.label} Review`}>
                        {(
                          [
                            ["correct", "Correct"],
                            ["incorrect", "Incorrect"],
                            ["pending", "Pending"],
                          ] as Array<[TeachingScore, string]>
                        ).map(([score, label]) => (
                          <button
                            key={score}
                            type="button"
                            aria-pressed={draft === score}
                            onClick={() => onSetScore(round.submissionId, field.key, score)}
                            className={`min-h-7 rounded-[5px] px-2.5 text-xs transition ${
                              draft === score
                                ? score === "correct"
                                  ? "bg-emerald-600 text-white"
                                  : score === "incorrect"
                                    ? "bg-red-600 text-white"
                                    : "bg-white text-ink-900 shadow-sm"
                                : "text-ink-500 hover:text-ink-900"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-ink-200 bg-ink-50 px-4 py-3.5">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-ink-950">{value}</p>
    </div>
  );
}
