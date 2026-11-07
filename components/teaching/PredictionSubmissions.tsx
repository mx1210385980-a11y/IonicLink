"use client";

/* eslint-disable @next/next/no-img-element -- submitted screenshots are dynamic PNG data URLs. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ModelPreview, type ModelPreviewCaptureControls } from "@/components/design/ModelPreview";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";
import {
  PREDICTION_MAX_REFLECTION_LENGTH,
  predictionParameterRows,
  type PredictionDashboard,
  type PredictionParameters,
  type PredictionSubmission,
} from "@/lib/teaching/predictionShared";

function timeLabel(value: string): string {
  return `${value.replace("T", " ").slice(0, 16)} UTC`;
}

function ParameterList({ parameters }: { parameters: PredictionParameters }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {predictionParameterRows(parameters).map((row) => (
        <div key={row.key} className="rounded-[7px] border border-ink-100 bg-white px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{row.label}</dt>
          <dd className="mt-1 break-words font-mono text-xs font-semibold text-ink-950">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SubmissionCard({ submission }: { submission: PredictionSubmission }) {
  return (
    <article className="rounded-[10px] border border-indigo-100 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-serif text-lg font-semibold text-ink-950">{submission.studentName}</h4>
          <p className="mt-0.5 text-xs text-ink-500">Submitted {timeLabel(submission.createdAt)}</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
          {submission.parameters.strategy} model
        </span>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <img
          src={submission.screenshot}
          alt={`${submission.studentName}'s tuned prediction charts`}
          className="w-full rounded-[8px] border border-ink-200 bg-ink-50 object-contain"
        />
        <section aria-label={`${submission.studentName}'s model parameters`}>
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-indigo-800">Tuned model parameters</h5>
          <div className="max-h-[32rem] overflow-y-auto pr-1">
            <ParameterList parameters={submission.parameters} />
          </div>
        </section>
      </div>
      <section className="mt-4 rounded-[8px] bg-indigo-50/60 p-4" aria-label={`${submission.studentName}'s reflection`}>
        <h5 className="text-xs font-semibold uppercase tracking-eyebrow text-indigo-800">Reflection / comments</h5>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-800">{submission.reflection}</p>
      </section>
    </article>
  );
}

function StudentSubmissionPanel({ capture, parameters }: ModelPreviewCaptureControls) {
  const [screenshot, setScreenshot] = useState("");
  const [snapshot, setSnapshot] = useState<PredictionParameters>(parameters);
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState<"capture" | "submit" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSubmittedAt, setLastSubmittedAt] = useState("");
  const currentParameters = useRef(parameters);
  currentParameters.current = parameters;

  useEffect(() => {
    // A screenshot and its parameters are one immutable submission snapshot.
    // Changing any control requires a fresh capture rather than pairing an old
    // image with new values.
    setScreenshot("");
    setSnapshot(parameters);
  }, [parameters]);

  async function captureCurrentCharts() {
    if (busy) return;
    setBusy("capture");
    setError("");
    setNotice("");
    try {
      const image = await capture();
      if (currentParameters.current !== parameters) throw new Error("Parameters changed during capture. Take the screenshot again.");
      setSnapshot({ strategy: parameters.strategy, options: { ...parameters.options } });
      setScreenshot(image);
      setNotice("Screenshot captured. Add your reflection and submit it to your teacher.");
    } catch (cause) {
      setError(requestErrorMessage(cause, "Screenshot failed"));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (busy || !screenshot || !reflection.trim()) return;
    setBusy("submit");
    setError("");
    setNotice("");
    try {
      const submission = await requestJson<PredictionSubmission>("/api/teaching/prediction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ screenshot, parameters: snapshot, reflection }),
      }, "Submission failed");
      setLastSubmittedAt(submission.createdAt);
      setReflection("");
      setNotice("Submitted successfully. Your teacher can now view the image, parameters, and reflection.");
    } catch (cause) {
      setError(requestErrorMessage(cause, "Submission failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-testid="prediction-student-submission" aria-labelledby="prediction-submission-title" className="rounded-[10px] border border-indigo-200 bg-indigo-50/35 p-4 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="prediction-submission-title" className="font-serif text-lg font-semibold text-indigo-950">Submit your tuned model</h3>
          <p className="mt-1 text-xs leading-5 text-ink-600">Capture the current charts, check the parameter snapshot, then write your reflection.</p>
        </div>
        <button type="button" className="btn-primary" disabled={busy !== null} onClick={() => void captureCurrentCharts()}>
          {busy === "capture" ? "Capturing…" : screenshot ? "Retake screenshot" : "Capture current charts"}
        </button>
      </div>
      {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
      {notice && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <div className="overflow-hidden rounded-[8px] border border-dashed border-indigo-200 bg-white">
          {screenshot ? (
            <img src={screenshot} alt="Captured prediction charts ready for submission" className="w-full object-contain" />
          ) : (
            <div className="flex min-h-48 items-center justify-center p-6 text-center text-sm text-ink-500">
              Your PNG screenshot will appear here.
            </div>
          )}
        </div>
        <section aria-label="Current tuned model parameters">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-indigo-800">Tuned model parameters</h4>
          <div className="max-h-[32rem] overflow-y-auto pr-1">
            <ParameterList parameters={parameters} />
          </div>
        </section>
      </div>
      <label className="mt-4 block text-sm font-semibold text-ink-900" htmlFor="prediction-reflection">
        Reflection / comments
        <textarea
          id="prediction-reflection"
          value={reflection}
          maxLength={PREDICTION_MAX_REFLECTION_LENGTH}
          onChange={(event) => setReflection(event.target.value)}
          placeholder="What changed when you tuned the model? Which settings gave the best result, and why?"
          className="mt-2 min-h-32 w-full resize-y rounded-[8px] border border-indigo-100 bg-white px-3 py-2 text-sm font-normal leading-6 text-ink-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-500">
          {lastSubmittedAt ? `Last submitted ${timeLabel(lastSubmittedAt)}` : `${reflection.length}/${PREDICTION_MAX_REFLECTION_LENGTH} characters`}
        </span>
        <button type="button" className="btn-primary" disabled={busy !== null || !screenshot || !reflection.trim()} onClick={() => void submit()}>
          {busy === "submit" ? "Submitting…" : "Submit to teacher"}
        </button>
      </div>
    </section>
  );
}

export function PredictionStudentWorkspace() {
  return (
    <ModelPreview embedded>
      {(controls) => <StudentSubmissionPanel {...controls} />}
    </ModelPreview>
  );
}

function TeacherInbox() {
  const [submissions, setSubmissions] = useState<PredictionSubmission[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notification, setNotification] = useState("");
  const newestId = useRef("");

  const refresh = useCallback(async () => {
    const next = await requestJson<PredictionDashboard>("/api/teaching/prediction", { cache: "no-store" }, "Could not load student submissions");
    const latest = next.submissions[0];
    if (latest && newestId.current && latest.id !== newestId.current) {
      setNotification(`New reflection received from ${latest.studentName}.`);
      setSelectedId(latest.id);
    }
    newestId.current = latest?.id ?? "";
    setSubmissions(next.submissions);
    setSelectedId((current) => next.submissions.some((item) => item.id === current) ? current : latest?.id ?? "");
    setLoaded(true);
    setError("");
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => {
      setLoaded(true);
      setError(requestErrorMessage(cause, "Could not load student submissions"));
    });
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selected = submissions.find((item) => item.id === selectedId) ?? submissions[0] ?? null;
  return (
    <section data-testid="prediction-teacher-inbox" aria-labelledby="prediction-inbox-title" className="mb-5 rounded-[10px] border border-indigo-200 bg-indigo-50/35 p-4 shadow-panel">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="prediction-inbox-title" className="font-serif text-xl font-semibold text-indigo-950">Student reflections</h3>
          <p className="mt-1 text-xs text-ink-600">New submissions appear automatically every 5 seconds.</p>
        </div>
        {submissions.length > 0 && (
          <label className="min-w-64 text-xs font-semibold text-ink-700">
            Received submission
            <select
              aria-label="Received student submission"
              value={selected?.id ?? ""}
              onChange={(event) => { setSelectedId(event.target.value); setNotification(""); }}
              className="mt-1 h-10 w-full rounded-[8px] border border-indigo-200 bg-white px-3 text-sm font-normal text-ink-900"
            >
              {submissions.map((item) => (
                <option key={item.id} value={item.id}>{item.studentName} · {timeLabel(item.createdAt)}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {notification && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{notification}</p>}
      {error && <div className="mt-3"><RequestError>{error}</RequestError></div>}
      {!loaded && <p className="mt-4 text-sm text-ink-500">Loading submissions…</p>}
      {loaded && !selected && !error && (
        <p className="mt-4 rounded-[8px] border border-dashed border-indigo-200 bg-white p-6 text-center text-sm text-ink-500">
          No student reflections yet. New submissions will be shown here.
        </p>
      )}
      {selected && <div className="mt-4"><SubmissionCard submission={selected} /></div>}
    </section>
  );
}

export function PredictionTeacherWorkspace() {
  return (
    <>
      <TeacherInbox />
      <ModelPreview embedded />
    </>
  );
}
