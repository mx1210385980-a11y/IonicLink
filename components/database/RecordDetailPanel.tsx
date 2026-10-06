"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Non-modal so the existing source-evidence viewer remains independently usable. */
export function RecordDetailPanel({ recordId, onClose, children }: { recordId: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[aria-modal="true"], [data-testid="source-viewer"]')) onClose();
    };
    // Inspect the overlay before its own bubbling Escape handler removes it.
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); active?.focus(); };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(<aside aria-label={`Record details ${recordId}`} className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-4xl flex-col border-l border-ink-300 bg-white shadow-2xl">
    <div className="flex shrink-0 items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-3">
      <h2 className="font-semibold">Record details · {recordId}</h2>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="Close record details" className="btn">Close ×</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
  </aside>, document.body);
}
