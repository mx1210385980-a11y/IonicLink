"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson, requestErrorMessage } from "@/components/request";
import { liveDraftConflicts, sameLiveRows } from "@/lib/teaching/liveDraft";
import { validateLiveRows, type LiveDomain, type LiveRow } from "@/lib/teaching/liveFields";
import type { LiveParticipantView } from "@/lib/teaching/liveShared";

export function useLiveDraft(initial: LiveParticipantView, domain: LiveDomain, running: boolean) {
  const [participant, setParticipant] = useState(initial);
  const [rows, setRows] = useState(initial.rows);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef({ participant: initial, rows: initial.rows, base: initial.rows, revision: 0, dirty: false, saving: false, conflict: false });
  const mounted = useRef(true);
  const cacheKey = `ioniclink:live-draft:v1:${initial.id}`;
  const persist = useCallback(() => {
    try {
      const draft = ref.current;
      if (!draft.dirty) localStorage.removeItem(cacheKey);
      else localStorage.setItem(cacheKey, JSON.stringify({ rows: draft.rows, base: draft.base, version: draft.participant.version }));
    } catch { setMessage("Browser backup unavailable. Keep this page open until the server confirms saving."); }
  }, [cacheKey]);

  useEffect(() => {
    mounted.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (stored && initial.status !== "submitted") {
        const restored = validateLiveRows(stored.rows, domain);
        if (!sameLiveRows(restored, initial.rows)) {
          const base = stored.base?.length ? validateLiveRows(stored.base, domain) : [];
          const conflicts = stored.version !== initial.version && liveDraftConflicts(base, restored, initial.rows);
          Object.assign(ref.current, { rows: restored, dirty: true, conflict: conflicts, base: initial.rows });
          setRows(restored); setDirty(true); setConflict(conflicts); setMessage("Recovered this participant's unsent draft from this browser.");
        }
      } else if (initial.status === "submitted") localStorage.removeItem(cacheKey);
    } catch { setMessage("Could not restore the browser draft. Server-saved records are shown."); }
    return () => { mounted.current = false; };
    // Restore once for this participant, never on a background poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, domain]);

  const accept = useCallback((next: LiveParticipantView, authoritative = false) => {
    const current = ref.current;
    if (next.version < current.participant.version) return;
    if (!authoritative && current.saving) return;
    const conflicts = current.dirty && !authoritative && next.status !== "submitted" && liveDraftConflicts(current.base, current.rows, next.rows);
    current.participant = next; setParticipant(next);
    if (authoritative || !current.dirty || next.status === "submitted" || sameLiveRows(current.rows, next.rows)) {
      Object.assign(current, { rows: next.rows, base: next.rows, dirty: false, conflict: false });
      setRows(next.rows); setDirty(false); setConflict(false);
    } else { current.base = next.rows; current.conflict ||= conflicts; setConflict(current.conflict); }
    persist();
  }, [persist]);

  useEffect(() => { accept(initial); }, [initial, accept]);

  const edit = useCallback((next: LiveRow[]) => {
    const current = ref.current;
    current.rows = next; current.dirty = true; current.revision++;
    setRows(next); setDirty(true); setMessage("Unsaved edits are backed up in this browser."); persist();
  }, [persist]);

  const save = useCallback(async () => {
    const current = ref.current;
    if (!current.dirty || current.saving || current.conflict || !running) return;
    const revision = current.revision, sent = current.rows;
    current.saving = true; setSaving(true);
    try {
      const next = await requestJson<LiveParticipantView>("/api/teaching/live", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", participantId: current.participant.id, version: current.participant.version, rows: sent }) }, "Draft save failed");
      if (!mounted.current) return;
      current.saving = false;
      if (current.revision === revision) accept(next, true);
      else { current.participant = next; current.base = next.rows; setParticipant(next); persist(); }
      setMessage(current.dirty ? "Saving newer edits…" : "Draft saved to the classroom server.");
    } catch (cause) { if (mounted.current) setMessage(`${requestErrorMessage(cause, "Draft save failed")} Your local draft is retained. Retry saving before submitting.`); }
    finally { current.saving = false; if (mounted.current) setSaving(false); }
  }, [accept, persist, running]);

  useEffect(() => {
    if (!dirty || conflict || saving || !running) return;
    const timer = setTimeout(() => { void save(); }, 700);
    return () => clearTimeout(timer);
    // Retry on an edit/version change, not an unbounded failure loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, participant.version, dirty, conflict, running, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (ref.current.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { participant, rows, edit, accept, save, dirty, saving, conflict, message,
    resolve: (keepLocal: boolean) => {
      const current = ref.current;
      current.conflict = false; setConflict(false);
      if (keepLocal) { current.revision++; setRows([...current.rows]); persist(); }
      else accept(current.participant, true);
    } };
}
