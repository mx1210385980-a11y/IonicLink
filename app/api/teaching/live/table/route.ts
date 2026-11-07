import { NextRequest, NextResponse } from "next/server";
import { MAX_TABLE_BYTES, parseSimpleTable, simpleTemplateCsv } from "@/lib/teaching/simpleTable";
import { LIVE_EXTRACTION_FIELDS } from "@/lib/teaching/liveFields";
import { rejectCrossOriginMutation } from "../../_auth";
import { labError } from "../../lab/_helpers";
import { liveCaller } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const caller = await liveCaller(request);
  if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return new NextResponse(simpleTemplateCsv(LIVE_EXTRACTION_FIELDS), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="live-extraction-template.csv"' },
  });
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select a table file.");
    if (file.size > MAX_TABLE_BYTES) return NextResponse.json({ error: "The file exceeds 5 MB." }, { status: 413 });
    const rows = await parseSimpleTable(file.name, new Uint8Array(await file.arrayBuffer()), LIVE_EXTRACTION_FIELDS);
    return NextResponse.json({ rows, filename: file.name });
  } catch (error) { return labError(error); }
}
