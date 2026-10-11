import { NextRequest, NextResponse } from "next/server";
import { attachSimpleStudentPaper, getSimpleStudent } from "@/lib/teaching/simpleStore";
import { readSimplePaper, readSimplePdf, saveStudentUploadedPdf } from "@/lib/teaching/simplePapers";
import { getSourcePdf } from "@/lib/sources";
import { getSource } from "@/lib/db";
import { renderPdfPage } from "@/lib/pdf";
import { rejectCrossOriginMutation, sessionFromRequest } from "../../_auth";
import { labError, labStudentId, checkLabAttempt } from "../_helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const student = session.role === "student" && session.participantId ? getSimpleStudent(labStudentId(session.participantId)) : null;
    const id = session.role === "teacher" ? request.nextUrl.searchParams.get("sourceId") : student?.experiment.sourceId;
    if (!id) throw new Error("Assigned paper not found.");
    const source = await readSimplePaper(id).catch((error) => {
      if (session.role === "teacher") return getSource("tribology", id);
      throw error;
    });
    if (request.nextUrl.searchParams.get("format") === "text") {
      if (!source) throw new Error("Paper not found.");
      return NextResponse.json({ pages: source.pages }, { headers: { "cache-control": "private, no-store" } });
    }
    const pdf = await readSimplePdf(id).catch((error) => {
      if (session.role === "teacher") return getSourcePdf("tribology", id);
      throw error;
    });
    if (!pdf) throw new Error("PDF is missing.");
    if (request.nextUrl.searchParams.get("format") === "page") {
      const page = Number(request.nextUrl.searchParams.get("page"));
      if (!source || !Number.isInteger(page) || page < 1 || page > source.pageCount) throw new Error("Invalid page number.");
      const png = await renderPdfPage(pdf, page, 1.5);
      return new NextResponse(Buffer.from(png), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
    }
    return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="paper.pdf"', "cache-control": "private, no-store" } });
  } catch (error) { return labError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const session = sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (session.role !== "student" || !session.participantId) return NextResponse.json({ error: "Students upload their own paper." }, { status: 403 });
    const student = getSimpleStudent(labStudentId(session.participantId));
    if (student.status === "submitted" || student.status === "extracting") throw new Error("Paper upload is locked in the current state.");
    const reader = request.body?.getReader(); if (!reader) throw new Error("Select a PDF.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 20 * 1024 * 1024 + 65536) { await reader.cancel(); return NextResponse.json({ error: "The file exceeds 20 MB." }, { status: 413 }); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
    checkLabAttempt(student.id, form.get("attemptId"));
    const file = form.get("file"); const version = Number(form.get("version"));
    if (!(file instanceof File)) throw new Error("Select a PDF.");
    if (!form.has("version") || version !== student.version) throw new Error("Progress changed. Refresh and retry.");
    const paper = await saveStudentUploadedPdf(file.name, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(attachSimpleStudentPaper(student.id, { version, sourceId: paper.id, paperTitle: paper.filename, fingerprint: paper.fingerprint }));
  } catch (error) { return labError(error); }
}
