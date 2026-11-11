import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { digitizeAfmUpload } from "../afm/digitizeUpload.server";
import { teachingDataDir } from "./store";
import { blankLiveRow, liveCsvCell, type LiveRow } from "./liveFields";
import type { LiveAfmArtifact, LiveAfmCurve } from "./liveAfm";

type Recognition = Awaited<ReturnType<typeof digitizeAfmUpload>>;

export function classroomAfmResult(result: Recognition): { artifact: LiveAfmArtifact; rows: LiveRow[] } {
  const rows: LiveRow[] = [];
  const ordered = [...result.candidates].sort((a, b) => (a.page ?? 0) - (b.page ?? 0)
    || (a.figureLabel || "").localeCompare(b.figureLabel || "", "en", { numeric: true })
    || (a.panel?.label || a.id).localeCompare(b.panel?.label || b.id, "en", { numeric: true, sensitivity: "base" }));
  const curves = ordered.map((candidate): LiveAfmCurve => {
    const calibration = candidate.axisCalibration;
    const axes = calibration?.status === "auto-calibrated" ? calibration.axes : null;
    const points: Array<[number, number]> = candidate.analysis.normalizedPoints.map(({ x, y }) => axes
      ? [axes.xMin + x * (axes.xMax - axes.xMin), axes.yMin + y * (axes.yMax - axes.yMin)] : [x, y]);
    const context = candidate.panel?.conditions;
    const metadata = candidate.experimentalMetadata ?? result.experimentalMetadata;
    // Only an unambiguous single identity may be inherited from whole-paper metadata.
    const liquid = context?.ionicLiquid.value ?? (metadata.ionicLiquids.length === 1 ? metadata.ionicLiquids[0].value : null);
    const ionMatch = liquid?.match(/^\[([^\]]+)\]\s*\[?([^\]]+)\]?$/);
    const field = (item: { value: unknown; unit: string | null }) => item.value == null ? "NR" : `${item.value}${item.unit ? ` ${item.unit}` : ""}`;
    const base: LiveRow = { ...blankLiveRow("afm"), cation: ionMatch?.[1] || "NR", anion: ionMatch?.[2] || "NR",
      surface: context?.substrate.value ?? (metadata.substrates.length === 1 ? metadata.substrates[0].value : null) ?? "NR",
      temperature: field(metadata.externalFactors.temperature), probe: field(metadata.probe.material),
      tipRadius: field(metadata.probe.tipRadius), springConstant: field(metadata.probe.cantileverSpringConstant),
      potential: context?.electrodePotential.value == null ? "NR" : `${context.electrodePotential.value} V`,
      reference: "NR", variedParameter: "NR", variableValue: "NR", trend: "NR",
      evidence: [candidate.page ? `p. ${candidate.page}` : "", candidate.figureLabel ? `Fig. ${candidate.figureLabel}` : "", candidate.panel?.label ? `panel ${candidate.panel.label}` : "", candidate.id, "image-estimated; context requires source review"].filter(Boolean).join("; ") };
    if (axes && points.length) {
      // Extrema of the extracted samples, not semantic claims about rupture or layer boundaries.
      const minimum = points.reduce((a, b) => b[1] < a[1] ? b : a);
      const maximum = points.reduce((a, b) => b[1] > a[1] ? b : a);
      for (const [label, point] of [["Minimum digitized force (within plot)", minimum], ["Maximum digitized force (within plot)", maximum]] as const) {
        rows.push({ ...base, property: label, value: `${point[1].toPrecision(6)} ${axes.yUnit}`, separation: `${point[0].toPrecision(6)} ${axes.xUnit}` });
      }
    } else rows.push({ ...base, property: "AFM curve — physical calibration unresolved", value: "NR", separation: "NR" });
    return { id: candidate.id, label: candidate.panel?.suggestedLabel || candidate.pageLabel, page: candidate.page,
      figure: candidate.figureLabel, imageDataUrl: candidate.imageDataUrl, axes, points,
      segmentStarts: candidate.analysis.segmentStarts, warnings: candidate.analysis.warnings };
  });
  return { rows, artifact: { schema: "ioniclink.classroom-afm.v1", sourceName: result.sourceName, createdAt: new Date().toISOString(), curves } };
}

function artifactPath(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid classroom artifact ID");
  return path.join(teachingDataDir(), "teaching-afm", `${id}.json`);
}

export async function saveLiveAfmArtifact(artifact: LiveAfmArtifact): Promise<string> {
  const payload = JSON.stringify(artifact);
  if (Buffer.byteLength(payload) > 64 * 1024 * 1024) throw new Error("The AFM result is too large for one lesson. Use a smaller paper.");
  const id = randomUUID(), target = artifactPath(id);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, payload, { flag: "wx" });
  return id;
}

export async function readLiveAfmArtifact(id: string): Promise<LiveAfmArtifact> {
  return JSON.parse(await readFile(artifactPath(id), "utf8")) as LiveAfmArtifact;
}

export function liveAfmCurveCsv(curve: LiveAfmCurve): string {
  const axes = curve.axes;
  return "\uFEFF" + [["# Classroom digitization; not a verified research measurement"], ["# source", curve.label],
    ["# coordinates", axes ? "physical; automatically calibrated; review required" : "relative pixels; not physical"],
    [axes ? `Separation (${axes.xUnit})` : "Relative horizontal position", axes ? `Force (${axes.yUnit})` : "Relative vertical position", "segment"],
    ...curve.points.map((point, i) => [...point, curve.segmentStarts.filter((start) => start <= i).length])]
    .map((row) => row.map(liveCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function liveAfmCurvePng(curve: LiveAfmCurve): Buffer {
  const canvas = createCanvas(1200, 800), ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1200, 800);
  ctx.fillStyle = "#242b33"; ctx.font = "20px sans-serif";
  ctx.fillText(curve.label.slice(0, 90), 100, 40);
  ctx.font = "15px sans-serif"; ctx.fillText("Classroom digitization — source review required; no gap interpolation", 100, 70);
  if (!curve.points.length) return canvas.toBuffer("image/png");
  const xs = curve.points.map((p) => p[0]), ys = curve.points.map((p) => p[1]);
  const x0 = curve.axes?.xMin ?? 0, x1 = curve.axes?.xMax ?? 1;
  const y0 = curve.axes?.yMin ?? 0, y1 = curve.axes?.yMax ?? 1;
  const px = (x: number) => 110 + (x - x0) / (x1 - x0) * 1010;
  const py = (y: number) => 670 - (y - y0) / (y1 - y0) * 550;
  ctx.strokeStyle = "#526273"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(110, 120); ctx.lineTo(110, 670); ctx.lineTo(1120, 670); ctx.stroke();
  for (let i = 0; i <= 5; i++) {
    const x = x0 + (x1 - x0) * i / 5, y = y0 + (y1 - y0) * i / 5;
    ctx.fillText(Number(x.toPrecision(4)).toString(), px(x) - 10, 696);
    ctx.fillText(Number(y.toPrecision(4)).toString(), 25, py(y) + 5);
  }
  ctx.fillText(curve.axes ? `Separation (${curve.axes.xUnit})` : "Relative horizontal position — not a physical axis", 370, 744);
  ctx.save(); ctx.translate(20, 520); ctx.rotate(-Math.PI / 2);
  ctx.fillText(curve.axes ? `Force (${curve.axes.yUnit})` : "Relative vertical position", 0, 0); ctx.restore();
  ctx.strokeStyle = "#00888a"; ctx.fillStyle = "#00888a";
  ctx.beginPath();
  const breaks = new Set(curve.segmentStarts);
  curve.points.forEach((point, i) => {
    const x = px(xs[i]), y = py(ys[i]);
    if (!i || breaks.has(i)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }); ctx.stroke();
  curve.points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(px(x), py(y), 1.4, 0, Math.PI * 2); ctx.fill(); });
  return canvas.toBuffer("image/png");
}
