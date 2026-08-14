import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { extractRecords, isLiveExtractionEnabled } from "@/lib/extract";
import { isDomain } from "@/lib/domain";
import { createSourceFromPdf } from "@/lib/sources";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Accepts either a PDF upload (multipart, field "file") or raw text
 * (JSON { text }). Returns extracted candidate records WITHOUT saving.
 */
export async function POST(req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  try {
    const contentType = req.headers.get("content-type") || "";
    let text = "";
    let sourceName = "pasted text";
    let sourceId: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) {
        sourceName = file.name;
        const buf = new Uint8Array(await file.arrayBuffer());
        if (file.name.toLowerCase().endsWith(".pdf")) {
          const src = await createSourceFromPdf(domain, file.name, buf);
          text = src.taggedText;
          sourceId = src.id;
        } else {
          text = new TextDecoder().decode(buf);
        }
      }
    } else {
      const body = (await req.json()) as { text?: string };
      text = body.text ?? "";
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "No readable text found in input." }, { status: 400 });
    }

    const result = await extractRecords(domain, text, sourceId);
    return NextResponse.json({
      ...result,
      sourceName,
      live: isLiveExtractionEnabled(),
      chars: text.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({ live: isLiveExtractionEnabled() });
}
