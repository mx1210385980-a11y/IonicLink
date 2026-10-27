import { NextRequest, NextResponse } from "next/server";
import { renderPdfPage } from "@/lib/pdf";
import { readSimplePaper, readSimplePdf, saveStudentUploadedPdf } from "@/lib/teaching/simplePapers";
import { findLiveParticipant, getLiveExperiment, setLivePaper } from "@/lib/teaching/liveStore";
import { rejectCrossOriginMutation } from "../../_auth";
import { labError } from "../../lab/_helpers";
import { liveCaller } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function paperForCaller(request: NextRequest): Promise<string> {
  const caller = await liveCaller(request);
  if (!caller) throw Object.assign(new Error("Sign in first."), { status: 401 });
  if (caller.admin) {
    const id = String(request.nextUrl.searchParams.get("experimentId") ?? "");
    return getLiveExperiment(id).paperSourceId;
  }
  const own = findLiveParticipant(caller.userKey);
  if (!own) throw Object.assign(new Error("Join the experiment first."), { status: 403 });
  const experiment = getLiveExperiment(own.experimentId);
  if (experiment.status === "open") throw new Error("The paper is available once the experiment starts");
  return experiment.paperSourceId;
}

export async function GET(request: NextRequest) {
  try {
    const sourceId = await paperForCaller(request);
    if (!sourceId) throw new Error("Assigned paper not found.");
    const source = await readSimplePaper(sourceId);
    if (request.nextUrl.searchParams.get("format") === "text") {
      return NextResponse.json({ pages: source.pages }, { headers: { "cache-control": "private, no-store" } });
    }
    if (request.nextUrl.searchParams.get("format") === "page") {
      const page = Number(request.nextUrl.searchParams.get("page"));
      if (!Number.isInteger(page) || page < 1 || page > source.pageCount) throw new Error("Invalid page number.");
      const pdf = await readSimplePdf(sourceId);
      const png = await renderPdfPage(pdf, page, 4);
      return new NextResponse(Buffer.from(png), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
    }
    const pdf = await readSimplePdf(sourceId);
    return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="paper.pdf"', "cache-control": "private, no-store" } });
  } catch (error) { return labError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (!caller.admin) return NextResponse.json({ error: "Only the instructor uploads the experiment paper." }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    const experimentId = String(form.get("experimentId") ?? "");
    if (!(file instanceof File)) throw new Error("Select a PDF.");
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "The file exceeds 20 MB." }, { status: 413 });
    const paper = await saveStudentUploadedPdf(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(setLivePaper(experimentId, { sourceId: paper.id, paperTitle: paper.filename }));
  } catch (error) { return labError(error); }
}
