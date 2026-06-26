"use client";

import { useEffect, useRef, useState } from "react";
import { boxesInCrop, type EvidenceMatch } from "@/lib/evidence";
import { formatProvenance, type BBox, type FieldProvenance } from "@/lib/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";

/**
 * Slide-over that lets you refer back to the original paper for any value:
 * the cited page rendered as an image (the chart/figure), the surrounding text
 * with the supporting quote highlighted, and a link to open the full PDF.
 *
 * The supporting quote is also located on the page image itself (via the PDF
 * text layer) and drawn as highlighter marks, so a reviewer can check the
 * evidence in situ; when the quote cannot be found on the cited page, that
 * misalignment is called out instead of silently showing a bare page.
 *
 * It also supports figure-level cropping: a curator drags a box over the cited
 * page, which is stored (normalized) on that field's provenance, and the viewer
 * then zooms to just that figure.
 *
 * Opened by dispatching a `ioniclink:source` CustomEvent (see ProvBadge).
 */
export interface SourceEventDetail {
  sourceId?: string;
  recordId?: string;
  field: string;
  value?: string;
  prov: FieldProvenance;
  /** Which domain's source/record API to hit (defaults to tribology for legacy events). */
  domain?: Domain;
}

export function SourceViewer() {
  const [detail, setDetail] = useState<SourceEventDetail | null>(null);
  const [prov, setProv] = useState<FieldProvenance>({});
  const [pageText, setPageText] = useState<string | null>(null);
  const [marks, setMarks] = useState<BBox[] | null>(null);
  const [markTier, setMarkTier] = useState<EvidenceMatch | null>(null);
  const [imgError, setImgError] = useState(false);
  const [view, setView] = useState<"page" | "figure">("page");
  const [drawing, setDrawing] = useState(false);
  const [rect, setRect] = useState<BBox | null>(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const rectRef = useRef<BBox | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<SourceEventDetail>).detail;
      setDetail(d);
      setProv(d.prov || {});
      setPageText(null);
      setImgError(false);
      setDrawing(false);
      setRect(null);
      setView(d.prov?.figureBox ? "figure" : "page");
    };
    window.addEventListener("ioniclink:source", onOpen);
    return () => window.removeEventListener("ioniclink:source", onOpen);
  }, []);

  useEffect(() => {
    if (!detail?.sourceId || prov.page == null) return;
    let alive = true;
    fetch(`/api/${detail.domain ?? DEFAULT_DOMAIN}/source/${encodeURIComponent(detail.sourceId)}/page/${prov.page}?format=text`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setPageText(d?.text ?? ""))
      .catch(() => alive && setPageText(""));
    return () => {
      alive = false;
    };
  }, [detail, prov.page]);

  // Locate the quote on the page image → highlight marks (page fractions).
  useEffect(() => {
    setMarks(null);
    setMarkTier(null);
    const quote = prov.quote?.trim();
    if (!detail?.sourceId || prov.page == null || !quote) return;
    let alive = true;
    const base = `/api/${detail.domain ?? DEFAULT_DOMAIN}/source/${encodeURIComponent(detail.sourceId)}/page/${prov.page}`;
    fetch(`${base}?format=evidence&q=${encodeURIComponent(quote)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setMarks(Array.isArray(d?.boxes) ? d.boxes : []);
        setMarkTier(d?.match ?? null);
      })
      .catch(() => alive && setMarks([]));
    return () => {
      alive = false;
    };
  }, [detail, prov.page, prov.quote]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!detail) return null;
  const { sourceId, recordId, field, value } = detail;
  const domain = detail.domain ?? DEFAULT_DOMAIN;
  const imgSrc = sourceId && prov.page != null ? `/api/${domain}/source/${encodeURIComponent(sourceId)}/page/${prov.page}` : null;
  const canCrop = !!recordId && !!imgSrc && field !== "page";
  const summary = formatProvenance(prov);

  const norm = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = norm(e);
    startRef.current = p;
    rectRef.current = { x: p.x, y: p.y, w: 0, h: 0 };
    setRect(rectRef.current);
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer — safe to ignore */
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const p = norm(e);
    const s = startRef.current;
    rectRef.current = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
    setRect(rectRef.current);
  };
  const onUp = async () => {
    const box = rectRef.current;
    if (!startRef.current || !box) return;
    startRef.current = null;
    rectRef.current = null;
    if (box.w < 0.02 || box.h < 0.02) {
      setRect(null);
      return;
    }
    await saveCrop(box);
    setDrawing(false);
    setRect(null);
    setView("figure");
  };

  const saveCrop = async (box: BBox) => {
    const next = { ...prov, figureBox: box };
    setProv(next);
    if (!recordId) return;
    setSaving(true);
    await fetch(`/api/${domain}/records/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setProvenance: { field, prov: { figureBox: box } } }),
    }).catch(() => {});
    setSaving(false);
  };

  const clearCrop = async () => {
    const next = { ...prov };
    delete next.figureBox;
    setProv(next);
    setView("page");
    if (!recordId) return;
    await fetch(`/api/${domain}/records/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setProvenance: { field, prov: { figureBox: undefined } } }),
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm" onClick={() => setDetail(null)} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="label-eyebrow">Source</span>
              <span className="rounded-md bg-cyan-50 px-2 py-0.5 font-mono text-xs font-bold text-cyan-700">{field}</span>
              {value && <span className="font-mono text-sm font-bold text-ink-900">{value}</span>}
            </div>
            {summary && <p className="mt-1 text-xs text-ink-500">{summary}</p>}
          </div>
          <button onClick={() => setDetail(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-ink-400 hover:text-ink-700">
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {imgSrc && !imgError ? (
            <figure>
              <figcaption className="mb-2 flex items-center justify-between gap-2">
                <span className="label-eyebrow">
                  Page {prov.page}
                  {prov.figure ? ` · ${prov.figure}` : ""}
                  {view === "figure" && prov.figureBox ? " · figure crop" : ""}
                </span>
                <CropControls
                  canCrop={canCrop}
                  hasBox={!!prov.figureBox}
                  view={view}
                  drawing={drawing}
                  saving={saving}
                  onToggleView={() => setView((v) => (v === "page" ? "figure" : "page"))}
                  onStartDraw={() => {
                    setView("page");
                    setDrawing(true);
                    setRect(null);
                  }}
                  onCancelDraw={() => {
                    setDrawing(false);
                    setRect(null);
                  }}
                  onClear={clearCrop}
                />
              </figcaption>

              {view === "figure" && prov.figureBox ? (
                <CroppedImage src={imgSrc} box={prov.figureBox} marks={marks ?? undefined} onError={() => setImgError(true)} />
              ) : (
                <div
                  ref={wrapRef}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  className={`relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 ${drawing ? "cursor-crosshair touch-none" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgSrc} alt={`Page ${prov.page}`} className="block w-full select-none" draggable={false} onError={() => setImgError(true)} />
                  {/* evidence quote located on the page */}
                  {marks?.map((b, i) => <EvidenceMark key={i} box={b} />)}
                  {/* existing crop highlight (when not drawing) */}
                  {!drawing && prov.figureBox && <BoxOverlay box={prov.figureBox} muted />}
                  {/* in-progress selection */}
                  {drawing && rect && <BoxOverlay box={rect} />}
                  {drawing && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 bg-cyan-600/85 py-1 text-center text-[11px] font-semibold text-white">
                      Drag a box around the figure
                    </div>
                  )}
                </div>
              )}
              {prov.quote && marks != null && <EvidenceStatus tier={markTier} />}
            </figure>
          ) : (
            !sourceId && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-xs text-ink-400">
                No source PDF stored for this record (it was extracted from pasted text). The captured
                context is shown below.
              </div>
            )
          )}

          <div>
            <div className="label-eyebrow mb-2">Context</div>
            <ContextBlock pageText={pageText} prov={prov} hasSource={!!sourceId} />
          </div>
        </div>

        {sourceId && (
          <footer className="border-t border-slate-200 px-5 py-3">
            <a href={`/api/${domain}/source/${encodeURIComponent(sourceId)}/pdf`} target="_blank" rel="noreferrer" className="btn px-3 py-1.5 text-xs">
              Open original PDF →
            </a>
          </footer>
        )}
      </aside>
    </div>
  );
}

function CropControls({
  canCrop,
  hasBox,
  view,
  drawing,
  saving,
  onToggleView,
  onStartDraw,
  onCancelDraw,
  onClear,
}: {
  canCrop: boolean;
  hasBox: boolean;
  view: "page" | "figure";
  drawing: boolean;
  saving: boolean;
  onToggleView: () => void;
  onStartDraw: () => void;
  onCancelDraw: () => void;
  onClear: () => void;
}) {
  if (!canCrop) return null;
  const btn = "rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-ink-600 hover:border-cyan-300 hover:text-cyan-700";
  if (drawing) {
    return (
      <button onClick={onCancelDraw} className={btn}>
        Cancel
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      {saving && <span className="text-[10px] text-ink-400">saving…</span>}
      {hasBox && (
        <button onClick={onToggleView} className={btn}>
          {view === "figure" ? "View page" : "View figure"}
        </button>
      )}
      <button onClick={onStartDraw} className={btn}>
        {hasBox ? "Re-crop" : "Crop to figure"}
      </button>
      {hasBox && (
        <button onClick={onClear} className={`${btn} hover:border-rose-200 hover:text-rose-600`}>
          Clear
        </button>
      )}
    </span>
  );
}

/** Highlighter mark over the located quote on the page image. */
function EvidenceMark({ box }: { box: BBox }) {
  const padX = 0.004;
  const padY = 0.002;
  return (
    <div
      data-testid="evidence-mark"
      className="pointer-events-none absolute rounded-[2px] border border-cyan-500/50 bg-cyan-400/30 mix-blend-multiply"
      style={{
        left: `${(box.x - padX) * 100}%`,
        top: `${(box.y - padY) * 100}%`,
        width: `${(box.w + padX * 2) * 100}%`,
        height: `${(box.h + padY * 2) * 100}%`,
      }}
    />
  );
}

/**
 * Whether the quote was located on the page image. The "not found" case is the
 * important one — it flags evidence that doesn't align with the cited page.
 */
function EvidenceStatus({ tier }: { tier: EvidenceMatch | null }) {
  if (tier === null) {
    return (
      <p data-testid="evidence-status-missing" className="mt-1.5 text-[11px] font-semibold text-amber-600">
        ⚠ Quote not found on this page image — the evidence may cite the wrong page. Check the context below.
      </p>
    );
  }
  const qualifier = tier === "loose" ? " (approximate match)" : tier === "partial" ? ' (matched around "…" gaps)' : "";
  return (
    <p data-testid="evidence-status-found" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-400">
      <span className="inline-block h-2.5 w-4 rounded-[2px] border border-cyan-500/50 bg-cyan-400/30" />
      Quote highlighted on the page{qualifier}
    </p>
  );
}

function BoxOverlay({ box, muted }: { box: BBox; muted?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute rounded-sm border-2 ${muted ? "border-cyan-400/70 bg-cyan-300/10" : "border-cyan-500 bg-cyan-400/20"}`}
      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
    />
  );
}

/** Distortion-free zoom to the box region of the page image. */
function CroppedImage({ src, box, marks, onError }: { src: string; box: BBox; marks?: BBox[]; onError: () => void }) {
  const [ar, setAr] = useState<number | null>(null);
  const cropAspect = ar ? (box.w / box.h) * ar : undefined;
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
      style={cropAspect ? { aspectRatio: String(cropAspect) } : { minHeight: 220 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="figure crop"
        onLoad={(e) => setAr(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        onError={onError}
        style={{
          position: "absolute",
          width: `${100 / box.w}%`,
          height: `${100 / box.h}%`,
          left: `${(-box.x * 100) / box.w}%`,
          top: `${(-box.y * 100) / box.h}%`,
          maxWidth: "none",
        }}
      />
      {/* evidence marks that fall inside the crop, re-expressed in crop space */}
      {marks && boxesInCrop(marks, box).map((b, i) => <EvidenceMark key={i} box={b} />)}
    </div>
  );
}

function ContextBlock({ pageText, prov, hasSource }: { pageText: string | null; prov: FieldProvenance; hasSource: boolean }) {
  if (hasSource && pageText == null) {
    return <p className="text-sm text-ink-400">Loading page text…</p>;
  }
  const text = pageText && pageText.trim() ? pageText : prov.context || prov.quote || "";
  if (!text) return <p className="text-sm text-ink-400">No context captured.</p>;
  const hl = highlight(text, prov.quote);
  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-ink-700">
      {hl.lead}
      {hl.before}
      {hl.match && <mark className="rounded bg-cyan-100 px-0.5 text-ink-900">{hl.match}</mark>}
      {hl.after}
      {hl.trail}
    </p>
  );
}

function highlight(raw: string, quote?: string): { lead: string; before: string; match: string; after: string; trail: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  const empty = { lead: "", before: "", match: "", after: "", trail: "" };
  if (!quote) return { ...empty, before: text.slice(0, 700), trail: text.length > 700 ? " …" : "" };
  const q = quote.replace(/\s+/g, " ").trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return { ...empty, before: text.slice(0, 700), trail: text.length > 700 ? " …" : "" };
  const start = Math.max(0, idx - 280);
  const end = Math.min(text.length, idx + q.length + 280);
  return {
    lead: start > 0 ? "… " : "",
    before: text.slice(start, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length, end),
    trail: end < text.length ? " …" : "",
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
