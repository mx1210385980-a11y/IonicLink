import { NextRequest, NextResponse } from "next/server";
import { extractRecords, isLiveExtractionEnabled } from "@/lib/extract";
import { pagesToTaggedText, renderPdfPage } from "@/lib/pdf";
import { readSimplePaper, readSimplePdf, recordToSimpleRow } from "@/lib/teaching/simplePapers";
import { failLiveExtraction, findLiveParticipant, finishLiveExtraction, getLiveExperiment, startLiveExtraction } from "@/lib/teaching/liveStore";
import { rejectCrossOriginMutation } from "../../_auth";
import { labBody, labError } from "../../lab/_helpers";
import { liveCaller } from "../_auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  let runningId: string | null = null;
  let runningVersion: number | null = null;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (caller.admin) return NextResponse.json({ error: "AI extraction is a student task." }, { status: 403 });
    const own = findLiveParticipant(caller.userKey);
    if (!own) throw new Error("Join the experiment first.");
    const body = await labBody(request);
    if (own.id !== body.participantId) return NextResponse.json({ error: "You can only run your own extraction." }, { status: 403 });
    if (own.mode !== "ai") return NextResponse.json({ error: "AI extraction is available only to AI groups." }, { status: 403 });
    const experiment = getLiveExperiment(own.experimentId);
    if (!experiment.paperSourceId) throw new Error("The instructor has not uploaded the paper yet.");
    if (!isLiveExtractionEnabled()) return NextResponse.json({ error: "The extraction service is not configured. Ask your instructor to configure a model." }, { status: 503 });
    const paper = await readSimplePaper(experiment.paperSourceId);
    const started = startLiveExtraction(own.id, body.version);
    runningId = own.id;
    runningVersion = started.version;
    let pdf: Uint8Array | undefined;
    const result = await extractRecords("tribology", pagesToTaggedText(paper.pages), paper.id, {
      renderPage: async (page, scale) => { pdf ??= await readSimplePdf(paper.id); return renderPdfPage(pdf, page, scale); },
    });
    if (!result.records.length) throw new Error("No reviewable records were extracted. Retry or ask your instructor to check the paper.");
    return NextResponse.json(finishLiveExtraction(own.id, runningVersion, result.records.map((record) => recordToSimpleRow(record))));
  } catch (error) {
    if (runningVersion !== null && runningId) {
      try { failLiveExtraction(runningId, runningVersion, "Extraction did not finish. Retry; elapsed time is preserved."); } catch { /* A newer request already recovered this attempt. */ }
    }
    console.error("[live teaching extraction]", error);
    return runningVersion !== null
      ? NextResponse.json({ error: "Extraction did not finish. Retry or ask your instructor to check the model service." }, { status: 503 })
      : labError(error);
  }
}
