"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

const KINDS = ["问题反馈", "功能建议", "使用建议"] as const;
const INPUT = "mt-2 block w-full rounded-lg border border-[#d8dfe7] bg-white p-3 text-sm text-[#243246] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

/**
 * Feedback submission dialog, opened from the account avatar menu. Entries are
 * stored server-side and answered by administrators on the usage monitor page.
 */
export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("问题反馈");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function reset() {
    setKind("问题反馈");
    setText("");
    setError("");
    setDone(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, text: text.trim() }),
      });
      if (!response.ok) {
        setError(response.status === 401 ? "登录状态已过期，请重新登录后再提交。" : "提交失败，请稍后重试。");
        return;
      }
      setDone(true);
    } catch {
      setError("提交失败，请检查网络连接。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="feedback-dialog-title"
      onClose={() => { onClose(); window.setTimeout(reset, 150); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#e0e5eb] bg-white p-5 text-[#243246] shadow-xl backdrop:bg-slate-950/30 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="feedback-dialog-title" className="text-lg font-semibold">提交反馈</h2>
        <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">×</button>
      </div>
      {done ? (
        <div className="mt-4">
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700" role="status">
            反馈已提交，管理员会在 Usage monitor 中处理并回复。
          </p>
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-xs font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              完成
            </button>
          </div>
        </div>
      ) : (
        <form className="mt-4" onSubmit={submit}>
          <label className="block text-xs font-medium">
            反馈类型
            <select value={kind} onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])} className={INPUT}>
              {KINDS.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="mt-4 block text-xs font-medium">
            反馈内容
            <textarea aria-label="反馈内容" value={text} onChange={(event) => setText(event.target.value)} required maxLength={1000} rows={4} placeholder="描述你遇到的问题或建议…" className={INPUT} />
          </label>
          {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#d8dfe7] bg-white px-3 text-xs font-medium text-[#344256] transition hover:border-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              取消
            </button>
            <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-xs font-medium text-white transition hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-40">
              {busy ? "提交中…" : "提交"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
