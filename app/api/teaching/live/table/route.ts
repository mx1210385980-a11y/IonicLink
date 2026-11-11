import { NextRequest, NextResponse } from "next/server";
import { blankLiveRow, liveDomain, liveRowsCsv } from "@/lib/teaching/liveFields";
import { parseLiveTable } from "@/lib/teaching/liveTable";
import { findLiveParticipant, getLiveExperiment } from "@/lib/teaching/liveStore";
import { MAX_TABLE_BYTES } from "@/lib/teaching/simpleTable";
import { rejectCrossOriginMutation } from "../../_auth";
import { labError } from "../../lab/_helpers";
import { liveCaller } from "../_auth";
import { readLiveForm } from "../_form";
import { liveTeachingExample } from "@/lib/teaching/liveExamples.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const domain = liveDomain(request.nextUrl.searchParams.get("domain"));
    const exampleId = request.nextUrl.searchParams.get("example");
    if (exampleId) {
      if (!caller.admin) return NextResponse.json({ error: "Example answer keys are for instructors only." }, { status: 403 });
      const example = liveTeachingExample(domain);
      if (!example || example.id !== exampleId) throw new Error("Choose an example for this teaching domain");
      return new NextResponse(liveRowsCsv(example.rows, domain), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${example.id}.csv"`, "cache-control": "private, no-store" } });
    }
    const example = Object.fromEntries(Object.keys(blankLiveRow(domain)).map((key) => [key, "NR"]));
    return new NextResponse(liveRowsCsv([example], domain), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="teaching-${domain}-template.csv"`, "cache-control": "private, no-store" } });
  } catch (error) { return labError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const domain = liveDomain(request.nextUrl.searchParams.get("domain"));
    if (!caller.admin) {
      const own = findLiveParticipant(caller.userKey);
      const experiment = own ? getLiveExperiment(own.experimentId) : null;
      if (!own || experiment?.status !== "running" || liveDomain(experiment.domain) !== domain || own.status === "submitted" || own.status === "extracting") {
        return NextResponse.json({ error: "Table uploads are not available in this state." }, { status: 403 });
      }
    }
    const form = await readLiveForm(request, MAX_TABLE_BYTES);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select a table file.");
    return NextResponse.json({ rows: await parseLiveTable(file.name, new Uint8Array(await file.arrayBuffer()), domain), filename: file.name });
  } catch (error) { return labError(error); }
}
