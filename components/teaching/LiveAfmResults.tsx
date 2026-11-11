"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { LiveAfmArtifact, LiveAfmCurve } from "@/lib/teaching/liveAfm";
import { requestJson, requestErrorMessage, RequestError } from "../request";

export function LiveAfmResults({ participantId, experimentId }: { participantId: string; experimentId: string }) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const [artifact, setArtifact] = useState<LiveAfmArtifact | null>(null), [error, setError] = useState("");
  const base = `/api/teaching/live/afm?participantId=${encodeURIComponent(participantId)}&experimentId=${encodeURIComponent(experimentId)}`;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void requestJson<LiveAfmArtifact>(base, { cache: "no-store" }, "Could not load saved AFM results").then((value) => { if (active) setArtifact(value); }).catch((cause) => { if (active) setError(requestErrorMessage(cause, "Load failed")); });
    return () => { active = false; };
  }, [base, open]);
  const curve = artifact?.curves[selected];
  return <section className="rounded-xl border border-ink-200 bg-white p-4">
    <button type="button" className="text-sm font-medium text-brand-700" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "View"} saved AFM curves</button>
    {open && <div className="mt-4 space-y-4">
      {error && <RequestError>{error}</RequestError>}
      {!artifact && !error && <p role="status" className="text-sm text-ink-500">Loading classroom server results…</p>}
      {curve && <>
        <nav aria-label="Saved AFM panels" className="flex items-center justify-between gap-2 text-xs"><button className="btn" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>Previous panel</button><span>{selected + 1} / {artifact!.curves.length}</span><button className="btn" disabled={selected === artifact!.curves.length - 1} onClick={() => setSelected(selected + 1)}>Next panel</button></nav>
        <p className="text-sm font-medium">{curve.label} · {curve.page ? `p. ${curve.page}` : "image"}{curve.figure ? ` · Fig. ${curve.figure}` : ""}</p>
        <Image src={curve.imageDataUrl} alt={`Original source panel: ${curve.label}`} width={900} height={600} unoptimized className="max-h-80 w-full rounded-lg bg-ink-50 object-contain" />
        <LiveAfmChart curve={curve} />
        <p className="text-xs leading-5 text-amber-900">{curve.axes ? "Automatically calibrated physical coordinates. Digitized landmarks and inherited conditions still require source review." : "Physical calibration unresolved. This curve remains in relative pixel coordinates and must not be used as physical force data."}</p>
        <div className="flex flex-wrap gap-2"><a className="btn" href={`${base}&curveId=${encodeURIComponent(curve.id)}&format=csv`}>Curve points CSV</a><a className="btn" href={`${base}&curveId=${encodeURIComponent(curve.id)}&format=png`}>Curve PNG</a></div>
      </>}
    </div>}
  </section>;
}

export function LiveAfmChart({ curve }: { curve: LiveAfmCurve }) {
  const a = curve.axes;
  const x0 = a?.xMin ?? 0, x1 = a?.xMax ?? 1, y0 = a?.yMin ?? 0, y1 = a?.yMax ?? 1;
  const px = (x: number) => 70 + (x - x0) / (x1 - x0) * 540;
  const py = (y: number) => 285 - (y - y0) / (y1 - y0) * 240;
  const breaks = new Set(curve.segmentStarts);
  const path = curve.points.map(([x, y], i) => `${!i || breaks.has(i) ? "M" : "L"}${px(x).toFixed(2)},${py(y).toFixed(2)}`).join(" ");
  return <svg role="img" aria-label="Digitized classroom force curve" viewBox="0 0 650 350" className="w-full rounded-lg border border-ink-200 bg-white">
    <path d="M70 45V285H610" fill="none" stroke="#526273" />
    {a && Array.from({ length: 5 }, (_, i) => {
      const x = x0 + (x1 - x0) * i / 4, y = y0 + (y1 - y0) * i / 4;
      return <g key={i} fill="#526273" fontSize="11"><text x={px(x)} y="305" textAnchor="middle">{Number(x.toPrecision(3))}</text><text x="61" y={py(y) + 4} textAnchor="end">{Number(y.toPrecision(3))}</text></g>;
    })}
    <path d={path} fill="none" stroke="#00888a" strokeWidth="1.5" />
    {curve.points.map(([x, y], i) => <circle key={i} cx={px(x)} cy={py(y)} r="1" fill="#00888a" />)}
    <g fontSize="12" fill="#242b33"><text x="340" y="336" textAnchor="middle">{a ? `Separation (${a.xUnit})` : "Relative horizontal position — not a physical axis"}</text><text transform="translate(16 170) rotate(-90)" textAnchor="middle">{a ? `Force (${a.yUnit})` : "Relative vertical position"}</text></g>
  </svg>;
}
