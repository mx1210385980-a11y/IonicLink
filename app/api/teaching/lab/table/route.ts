import { NextRequest, NextResponse } from "next/server";
import { MAX_TABLE_BYTES, parseSimpleTable, simpleTemplateCsv } from "@/lib/teaching/simpleTable";
import { getSimpleStudent } from "@/lib/teaching/simpleStore";
import { rejectCrossOriginMutation, sessionFromRequest } from "../../_auth";
import { labError, labStudentId } from "../_helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!sessionFromRequest(request)) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return new NextResponse(simpleTemplateCsv(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="teaching-template.csv"' } });
}
export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const session = sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (session.role === "student") {
      const student = session.participantId ? getSimpleStudent(labStudentId(session.participantId)) : null;
      if (!student || student.mode !== "manual" || student.status === "submitted") return NextResponse.json({ error: "Table uploads are not available in the current state." }, { status: 403 });
    }
    // Bound the entire multipart stream, including uploads without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Select a table file.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_TABLE_BYTES + 65536) { await reader.cancel(); return NextResponse.json({ error: "The file exceeds 5 MB." }, { status: 413 }); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select a table file.");
    return NextResponse.json({ rows: await parseSimpleTable(file.name, new Uint8Array(await file.arrayBuffer())), filename: file.name });
  } catch (error) { return labError(error); }
}
