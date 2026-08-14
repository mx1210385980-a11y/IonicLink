"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoleculeView } from "@/components/MoleculeView";
import {
  structureTargetLabel,
  structureSearchInputIssue,
  type StructureSearchTarget,
  type StructureSearchValue,
} from "@/lib/structureSearch";
import type { StructureEditorApi } from "@/components/KetcherStructureEditor";

const KetcherStructureEditor = dynamic(() => import("@/components/KetcherStructureEditor"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full min-h-[520px] place-items-center bg-white" role="status">
      <span className="inline-flex items-center gap-2 text-sm text-ink-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden />
        正在载入结构编辑器…
      </span>
    </div>
  ),
});

const TARGETS: { value: StructureSearchTarget; label: string; detail: string }[] = [
  { value: "any", label: "任意离子", detail: "匹配阳离子或阴离子" },
  { value: "cation", label: "阳离子", detail: "仅匹配阳离子结构" },
  { value: "anion", label: "阴离子", detail: "仅匹配阴离子结构" },
];

export function StructureSearchDialog({
  open,
  value,
  onApply,
  onClose,
}: {
  open: boolean;
  value: StructureSearchValue | null;
  onApply: (value: StructureSearchValue) => void;
  onClose: () => void;
}) {
  const editorApiRef = useRef<StructureEditorApi | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState<StructureSearchTarget>(value?.target ?? "any");
  const [draftSmiles, setDraftSmiles] = useState(value?.smiles ?? "");
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setPortalHost(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTarget(value?.target ?? "any");
    setDraftSmiles(value?.smiles ?? "");
    setError(null);
    if (!portalHost) return;

    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backgroundElements = Array.from(document.body.children).filter(
      (element) => element !== backdropRef.current
    );
    const previousInert = backgroundElements.map((element) => [element, element.hasAttribute("inert")] as const);
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    document.body.style.overflow = "hidden";
    for (const element of backgroundElements) element.setAttribute("inert", "");
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      for (const [element, wasInert] of previousInert) {
        if (!wasInert) element.removeAttribute("inert");
      }
      if (previousActive?.isConnected) previousActive.focus();
    };
  }, [open, onClose, portalHost, value]);

  const handleReady = useCallback((api: StructureEditorApi | null) => {
    editorApiRef.current = api;
  }, []);

  const handleDraftChange = useCallback((smiles: string) => {
    setDraftSmiles(smiles);
    if (smiles) setError(null);
  }, []);

  const clearEditor = useCallback(async () => {
    setError(null);
    setDraftSmiles("");
    await editorApiRef.current?.clear();
  }, []);

  const applySearch = useCallback(async () => {
    const api = editorApiRef.current;
    if (!api) {
      setError("结构编辑器仍在载入，请稍候。");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const smiles = (await api.getSmiles()).trim();
      const issue = structureSearchInputIssue(smiles);
      if (issue) {
        setError(issue.message);
        return;
      }
      onApply({ smiles, target, mode: "exact" });
    } catch {
      setError("当前结构尚未完成，请检查原子、键和形式电荷。");
    } finally {
      setApplying(false);
    }
  }, [onApply, target]);

  if (!open || !portalHost) return null;

  const previewKind = target === "anion" ? "anion" : "cation";
  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/35 p-0 backdrop-blur-[2px] sm:p-4"
      data-testid="structure-search-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="structure-search-title"
        data-testid="structure-search-dialog"
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_30px_90px_-24px_rgba(15,23,42,0.55)] sm:h-[min(820px,calc(100vh-32px))] sm:w-[min(1240px,calc(100vw-32px))] sm:rounded-[10px] sm:border sm:border-ink-200"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ink-200 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-ink-700 transition hover:bg-ink-100" aria-label="返回数据库">
              <BackIcon />
            </button>
            <span className="h-8 w-px bg-ink-200" aria-hidden />
            <div className="min-w-0">
              <h2 id="structure-search-title" className="text-base font-semibold text-ink-900">按结构搜索</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-transparent text-ink-500 transition hover:border-ink-200 hover:text-ink-900" aria-label="关闭结构搜索">
            <CloseIcon />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="border-b border-ink-200 bg-ink-50/55 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <fieldset>
              <legend className="text-xs font-semibold text-ink-900">匹配位置</legend>
              <div className="mt-2 space-y-1.5">
                {TARGETS.map((option) => (
                  <label key={option.value} className={`flex cursor-pointer gap-2.5 rounded-[8px] border px-2.5 py-2 transition ${target === option.value ? "border-brand-200 bg-brand-50 text-brand-800" : "border-transparent text-ink-700 hover:bg-white"}`}>
                    <input type="radio" name="structure-target" value={option.value} checked={target === option.value} onChange={() => setTarget(option.value)} className="mt-0.5 accent-brand-600" />
                    <span>
                      <span className="block text-xs font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-[10px] text-ink-500">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5 border-t border-ink-200 pt-4">
              <legend className="text-xs font-semibold text-ink-900">匹配方式</legend>
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-brand-800">
                <input type="radio" checked readOnly className="accent-brand-600" />
                精确结构
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-400" title="后续版本开放">
                <input type="radio" disabled />
                子结构 <span className="ml-auto text-[9px]">后续</span>
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-400" title="后续版本开放">
                <input type="radio" disabled />
                相似结构 <span className="ml-auto text-[9px]">后续</span>
              </label>
            </fieldset>

            <div className="mt-5 border-t border-ink-200 pt-4">
              <h3 className="text-xs font-semibold text-ink-900">结构预览</h3>
              <div className="mt-2 min-h-[124px] overflow-hidden rounded-[8px] border border-ink-200 bg-white p-2">
                {draftSmiles ? (
                  <MoleculeView smiles={draftSmiles} kind={previewKind} label={structureTargetLabel(target)} width={190} height={100} />
                ) : (
                  <div className="grid min-h-[106px] place-items-center px-3 text-center text-[11px] leading-relaxed text-ink-400">在右侧画布中绘制一个完整离子</div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="structure-smiles-preview" className="text-xs font-semibold text-ink-900">结构式</label>
              <textarea id="structure-smiles-preview" readOnly value={draftSmiles} placeholder="SMILES 将显示在这里" className="mt-2 h-24 w-full resize-none rounded-[8px] border border-ink-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-ink-700 outline-none" />
            </div>
          </aside>

          <main className="min-h-[520px] min-w-0 bg-white lg:min-h-0">
            <KetcherStructureEditor
              initialSmiles={value?.smiles ?? ""}
              onReady={handleReady}
              onChange={handleDraftChange}
            />
          </main>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ink-200 bg-white px-4 py-3 sm:px-5">
          <button type="button" onClick={() => void clearEditor()} className="text-sm font-semibold text-brand-700 transition hover:text-brand-900">清除</button>
          <div className="flex items-center gap-2">
            {error ? <span role="alert" className="mr-2 hidden max-w-sm text-right text-xs text-rose-600 md:inline">{error}</span> : null}
            <button type="button" onClick={onClose} className="btn min-w-20 justify-center">取消</button>
            <button type="button" onClick={() => void applySearch()} disabled={applying} className="btn-primary min-w-32 justify-center">
              {applying ? "正在读取…" : "应用结构搜索"}
            </button>
          </div>
        </footer>
        {error ? <div role="alert" className="shrink-0 border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700 md:hidden">{error}</div> : null}
      </section>
    </div>,
    portalHost,
  );
}

function BackIcon() {
  return <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden><path d="m12.5 4.5-5.5 5.5 5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CloseIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden><path d="m3 3 10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}
