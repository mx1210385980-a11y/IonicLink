import { NextRequest, NextResponse } from "next/server";
import { extractRecords, isLiveExtractionEnabled } from "@/lib/extract";
import { pagesToTaggedText, renderPdfPage } from "@/lib/pdf";
import { failSimpleExtraction, finishSimpleExtraction, getSimpleStudent, startSimpleExtraction } from "@/lib/teaching/simpleStore";
import { readSimplePaper, readSimplePdf, recordToSimpleRow } from "@/lib/teaching/simplePapers";
import { rejectCrossOriginMutation, requireTeachingRole } from "../../_auth";
import { labBody, labError, labStudentId, checkLabAttempt } from "../_helpers";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  const session = requireTeachingRole(request, "student"); if (session instanceof NextResponse) return session;
  let runningId: string | null = null;
  let runningVersion: number | null = null;
  try {
    if (!session.participantId) throw new Error("Rejoin the experiment.");
    const body = await labBody(request);
    const current = getSimpleStudent(labStudentId(session.participantId));
    checkLabAttempt(current.id, body.attemptId);
    runningId = current.id;
    if (!current) throw new Error("Experiment not found.");
    if (current.mode !== "ai") return NextResponse.json({ error: "AI extraction is available only to the AI group." }, { status: 403 });
    if (!current.experiment.sourceId) throw new Error("Upload your paper first.");
    if (!isLiveExtractionEnabled()) return NextResponse.json({ error: "The extraction service is not configured. Ask your instructor to configure a model." }, { status: 503 });
    const paper = await readSimplePaper(current.experiment.sourceId);
    const started = startSimpleExtraction(current.id, body.version as number);
    runningVersion = started.version;
    let pdf: Uint8Array | undefined;
    const result = await extractRecords("tribology", pagesToTaggedText(paper.pages), paper.id, {
      renderPage: async (page, scale) => { pdf ??= await readSimplePdf(paper.id); return renderPdfPage(pdf, page, scale); },
    });
    if (!result.records.length) throw new Error("No reviewable records were extracted. Retry or ask your instructor to check the paper.");
    return NextResponse.json(finishSimpleExtraction(current.id, runningVersion,
      result.records.map((record) => recordToSimpleRow(record))));
  } catch (error) {
    if (runningVersion !== null && runningId) {
      try { failSimpleExtraction(runningId, runningVersion, "Extraction did not finish. Retry; elapsed time is preserved."); } catch { /* A newer request already recovered this attempt. */ }
    }
    console.error("[teaching lab extraction]", error);
    return runningVersion !== null
      ? NextResponse.json({ error: "Extraction did not finish. Retry or ask your instructor to check the model service." }, { status: 503 })
      : labError(error);
  }
}
