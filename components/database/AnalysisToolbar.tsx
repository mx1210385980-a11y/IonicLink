"use client";

import { useEffect, useState } from "react";
import type { Domain } from "@/lib/domain";
import type { AnalysisState } from "./analysisState";

type SavedView = { name: string; url: string };

export function AnalysisToolbar({ domain, state, onChange, viewUrl, onRestore, onSnapshot, disabled }: {
  domain: Domain; state: AnalysisState; onChange: (state: AnalysisState) => void;
  viewUrl: string; onRestore: (url: string) => void; onSnapshot: () => void; disabled: boolean;
}) {
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState("");
  const storageKey = `ioniclink:analysis-views:v1:${domain}`;
  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(parsed)) setSaved(parsed.filter((view) => typeof view?.name === "string" && typeof view?.url === "string" && view.url.startsWith(`/${domain}/database?`)).slice(0, 20));
    } catch { setFeedback("Saved views are unavailable in this browser."); }
  }, [domain, storageKey]);
  const save = () => {
    if (!name.trim()) return;
    const next = [{ name: name.trim().slice(0, 80), url: viewUrl }, ...saved.filter((view) => view.name !== name.trim())].slice(0, 20);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setName(""); setFeedback("View saved on this device. It will query the current database when reopened."); }
    catch { setFeedback("Browser storage is full or unavailable. Use Copy view link instead."); }
  };
  return <div className="border-b border-ink-200 bg-white px-4 py-3" data-testid="analysis-toolbar">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Database view" className="inline-flex rounded-md border border-ink-300 p-0.5">
          {(["table", "plot", "cards"] as const).map((view) => <button key={view} type="button" aria-pressed={state.view === view} onClick={() => onChange({ ...state, view })} className={`min-h-9 rounded px-4 text-sm font-semibold ${state.view === view ? "bg-brand-700 text-white" : "text-ink-600 hover:bg-ink-50"}`}>
            {view === "table" ? "Table" : view === "plot" ? "Plot" : "Cards"}
          </button>)}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-600">Units
          <select aria-label="Analysis units" className="rounded border border-ink-200 bg-white px-2 py-1.5" value={state.units} onChange={(event) => onChange({ ...state, units: event.target.value as AnalysisState["units"] })}>
            <option value="std">Standardized</option><option value="raw">As reported</option>
          </select>
        </label>
        {state.view === "table" && <label className="flex items-center gap-2 text-sm text-ink-600">Density
          <select aria-label="Table density" className="rounded border border-ink-200 bg-white px-2 py-1.5" value={state.density} onChange={(event) => onChange({ ...state, density: event.target.value as AnalysisState["density"] })}>
            <option value="compact">Compact</option><option value="comfortable">Comfortable</option>
          </select>
        </label>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <details className="relative">
          <summary className="btn cursor-pointer">Saved views{saved.length ? ` (${saved.length})` : ""}</summary>
          <div className="absolute left-0 top-full z-40 mt-2 w-72 max-w-[85vw] rounded-lg border border-ink-200 bg-white p-3 shadow-xl sm:left-auto sm:right-0">
            <p className="mb-2 text-xs text-ink-500">Saved on this device · live results</p>
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
              <input aria-label="View name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Name this view" className="min-w-0 flex-1 rounded border border-ink-300 px-2 py-1 text-sm" />
              <button type="submit" disabled={!name.trim() || disabled} className="btn disabled:opacity-40">Save</button>
            </form>
            <ul className="mt-2 max-h-52 space-y-1 overflow-auto">
              {saved.map((view) => <li key={view.name} className="flex items-center justify-between gap-1">
                <button type="button" className="min-w-0 flex-1 truncate rounded p-2 text-left text-sm text-brand-800 hover:bg-brand-50" onClick={(event) => { onRestore(view.url); event.currentTarget.closest("details")?.removeAttribute("open"); setFeedback(`Restored ${view.name}.`); }}>{view.name}</button>
                <button type="button" aria-label={`Remove saved view ${view.name}`} className="rounded p-2 text-ink-500 hover:bg-ink-100" onClick={() => {
                  const next = saved.filter((item) => item.name !== view.name);
                  try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); } catch { setFeedback("Could not update browser storage."); }
                }}>×</button>
              </li>)}
            </ul>
          </div>
        </details>
        <button type="button" className="btn" disabled={disabled} onClick={async () => {
          try { await navigator.clipboard.writeText(new URL(viewUrl, window.location.origin).href); setFeedback("View link copied. Recipients need access to this database."); }
          catch { setFeedback("Copy the current browser address to share this view."); }
        }}>Copy view link</button>
        <button type="button" className="btn disabled:opacity-40" disabled={disabled} onClick={onSnapshot}>Snapshot JSON</button>
      </div>
    </div>
    {feedback && <p role="status" className="mt-2 text-xs text-brand-800">{feedback}</p>}
  </div>;
}
