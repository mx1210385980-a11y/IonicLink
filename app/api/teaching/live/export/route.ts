import { NextRequest, NextResponse } from "next/server";
import { liveCsvCell, liveFields } from "@/lib/teaching/liveFields";
import { getLiveDashboard } from "@/lib/teaching/liveStore";
import { labError } from "../../lab/_helpers";
import { liveCaller } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (!caller.admin) return NextResponse.json({ error: "Only instructors can export classroom results." }, { status: 403 });
    const dashboard = getLiveDashboard(request.nextUrl.searchParams.get("experimentId") || "");
    const { experiment, participants } = dashboard;
    const records = request.nextUrl.searchParams.get("format") === "records";
    const fields = liveFields(experiment.domain).map(({ key }) => key);
    const header = ["experimentId", "experiment", "domain", "round", "previousRoundId", "participantId", "student", "group", "mode", "status", "elapsedSeconds", "accuracy", "uncertain", "reviewedAt", "reviewNote", "relativeTolerancePercent", "absoluteTolerance", "afmArtifactId",
      ...(records ? ["record", ...fields] : ["goldRow", "answerRow", "field", "expected", "actual", "machineCorrect", "reviewMark"])];
    const rows = participants.flatMap((p) => {
      const prefix = [experiment.id, experiment.name, experiment.domain || "tribology", experiment.round || 1, experiment.previousRoundId, p.id, p.alias, p.groupNo, p.mode, p.status, p.elapsedSeconds,
        experiment.gold.length ? p.score?.accuracy : "", p.score?.uncertain, p.reviewedAt, p.reviewNote, experiment.assessmentPolicy?.relativeTolerancePercent ?? 0, experiment.assessmentPolicy?.absoluteTolerance, p.afmArtifactId];
      return records ? p.rows.map((row, i) => [...prefix, i + 1, ...fields.map((key) => row[key])])
        : p.score?.cells.map((cell) => [...prefix, cell.goldRow == null ? "" : cell.goldRow + 1, cell.answerRow == null ? "" : cell.answerRow + 1,
          cell.field, cell.expected, cell.actual, cell.machineCorrect, cell.mark]) || [[...prefix]];
    });
    return new NextResponse("\uFEFF" + [header, ...rows].map((row) => row.map(liveCsvCell).join(",")).join("\r\n") + "\r\n", {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="teaching-${experiment.id}-${records ? "records" : "assessment"}.csv"`, "cache-control": "private, no-store" },
    });
  } catch (error) { return labError(error); }
}
