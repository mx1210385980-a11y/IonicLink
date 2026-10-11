"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { simpleGroupAssignment } from "@/lib/teaching/simpleShared";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";

export function TeachingGateway({ initialMode = "student", embedded = false }: { initialMode?: "student" | "teacher"; embedded?: boolean }) {
  const [busy, setBusy] = useState<number | "teacher" | null>(null);
  const [error, setError] = useState("");
  const entering = useRef(false);
  const enter = useCallback(async (choice: number | "teacher") => {
    if (entering.current) return;
    entering.current = true; setBusy(choice); setError("");
    try {
      const result = await requestJson<{ redirect: string }>("/api/teaching/lab/enter", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(typeof choice === "number" ? { groupNo: choice } : { mode: "teacher" }),
      }, "Entry failed");
      window.location.assign(result.redirect);
    } catch (cause) {
      setError(requestErrorMessage(cause, "Could not enter the lab. Try again.")); setBusy(null); entering.current = false;
    }
  }, []);
  useEffect(() => { if (initialMode === "teacher") void enter("teacher"); }, [initialMode, enter]);

  if (initialMode === "teacher") return <section lang="en-US" className="mx-auto max-w-md px-5 py-16 text-center">
    <p role="status" className="text-sm text-ink-600">Opening instructor dashboard…</p>
    {error && <div className="mt-4"><RequestError>{error}</RequestError><button className="btn mt-4" onClick={() => void enter("teacher")}>Retry</button></div>}
  </section>;

  return <section lang="en-US" aria-label="Student groups" className={embedded ? "mt-3" : "mx-auto w-full max-w-xl px-5 py-14 sm:py-24"}>
    {!embedded && <h1 className="text-center text-2xl font-semibold tracking-tight text-ink-950">Data extraction</h1>}
    <p className={`text-sm leading-6 text-ink-500 ${embedded ? "" : "mt-3 text-center"}`}>Choose your assigned group. Your extraction method changes in round 2.</p>
    <div className="mt-4 grid grid-cols-2 gap-3">
      {[1, 2, 3, 4].map((groupNo) => { const first = simpleGroupAssignment(groupNo, 1), second = simpleGroupAssignment(groupNo, 2); return <button key={groupNo} type="button" disabled={busy !== null} onClick={() => void enter(groupNo)}
        className="min-w-0 rounded-xl border border-ink-200 bg-white p-3 text-left transition hover:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50">
        <span className="block text-lg font-semibold text-ink-950">{busy === groupNo ? "Opening…" : `Group ${groupNo}`}</span>
        <span className="mt-3 block rounded-lg border border-brand-200 bg-brand-50 px-2 py-2 text-xs leading-5 text-brand-900">
          <span className="block font-semibold">Round 1</span>
          <span className="block">Paper {first.paperNo} · {first.mode === "ai" ? "AI" : "Manual"}</span>
        </span>
        <span className="mt-2 block rounded-lg border border-violet-200 bg-violet-50 px-2 py-2 text-xs leading-5 text-violet-900"><span className="block font-semibold">Round 2</span><span className="block">Paper {second.paperNo} · {second.mode === "ai" ? "AI" : "Manual"}</span></span>
      </button>; })}
    </div>
    {error && <div className="mt-5"><RequestError>{error}</RequestError></div>}
    <div className="mt-8 text-center"><a href="/teaching/admin" className="text-sm text-ink-500 underline-offset-4 hover:text-brand-700 hover:underline">Instructor dashboard →</a></div>
  </section>;
}
