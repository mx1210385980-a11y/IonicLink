"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Domain } from "@/lib/domain";

type DeleteLiteratureAction =
  | { kind: "source"; sourceId: string; jobCount: number; recordCount: number }
  | { kind: "records"; recordIds: string[] };

export function deleteLiteratureConfirmation(label: string, action: DeleteLiteratureAction): string {
  const detail = action.kind === "source"
    ? `This permanently removes the stored PDF, ${action.jobCount} extraction job${action.jobCount === 1 ? "" : "s"} and their history, ${action.recordCount} Review/Checked record${action.recordCount === 1 ? "" : "s"}, and the Documents entry. You can upload it again afterward.`
    : `This permanently removes all ${action.recordIds.length} unlinked Review/Checked record${action.recordIds.length === 1 ? "" : "s"} for this paper. No indexed PDF is attached.`;
  return `Delete "${label}"?\n\n${detail}`;
}

export function DeleteLiteratureButton({
  domain,
  label,
  action,
}: {
  domain: Domain;
  label: string;
  action: DeleteLiteratureAction;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    const sourceBacked = action.kind === "source";
    if (!window.confirm(deleteLiteratureConfirmation(label, action))) return;

    setBusy(true);
    setError(null);
    try {
      const response = sourceBacked
        ? await fetch(`/api/${domain}/source/${encodeURIComponent(action.sourceId)}`, { method: "DELETE" })
        : await fetch(`/api/${domain}/records/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: action.recordIds }),
          });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "The delete request failed.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The delete request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Delete ${label}`}
      >
        <TrashIcon /> {busy ? "Deleting…" : "Delete"}
      </button>
      {error ? <p role="alert" className="max-w-64 text-right text-[11px] text-rose-700">{error}</p> : null}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
    </svg>
  );
}
