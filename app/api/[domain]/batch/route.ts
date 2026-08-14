import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import {
  clearFinishedJobs,
  createJobs,
  findSourceByDoi,
  getJobHistorySummary,
  listJobs,
} from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { extractDoiFromPages } from "@/lib/doi";
import { extractionConcurrency, isDraining, kickDrain } from "@/lib/jobs";
import { pdfToPages } from "@/lib/pdf";
import { createSourceFromPdf } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Upload one or more PDFs/text files → enqueue jobs → start processing. */
export async function POST(req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const pastedText = (form.get("text") as string | null)?.trim() || "";
  if (files.length === 0 && !pastedText) {
    return NextResponse.json({ error: "No files or text provided" }, { status: 400 });
  }

  const items: { filename: string; text: string; sourceId?: string }[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  // DOIs seen earlier in this same upload, so a batch can't duplicate itself.
  const batchDois = new Map<string, string>();

  if (pastedText) {
    items.push({ filename: "Pasted text", text: pastedText });
  }
  for (const file of files) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (file.name.toLowerCase().endsWith(".pdf")) {
        // Duplicate check BEFORE storing the source or queuing extraction:
        // the same paper (by DOI) is skipped, not re-extracted.
        const pages = await pdfToPages(buf);
        const doi = extractDoiFromPages(pages);
        if (doi) {
          const existing = findSourceByDoi(domain, doi);
          if (existing) {
            skipped.push({
              filename: file.name,
              reason: `already uploaded as "${existing.filename}" on ${existing.createdAt.slice(0, 10)} (DOI ${doi})`,
            });
            continue;
          }
          const inBatch = batchDois.get(doi);
          if (inBatch) {
            skipped.push({ filename: file.name, reason: `duplicate of "${inBatch}" in this upload (DOI ${doi})` });
            continue;
          }
          batchDois.set(doi, file.name);
        }
        const src = await createSourceFromPdf(domain, file.name, buf, pages);
        if (!src.taggedText.trim()) {
          skipped.push({ filename: file.name, reason: "no readable text" });
          continue;
        }
        items.push({ filename: file.name, text: src.taggedText, sourceId: src.id });
      } else {
        const text = new TextDecoder().decode(buf);
        if (!text.trim()) {
          skipped.push({ filename: file.name, reason: "no readable text" });
          continue;
        }
        items.push({ filename: file.name, text });
      }
    } catch (err) {
      skipped.push({ filename: file.name, reason: err instanceof Error ? err.message : "read error" });
    }
  }

  const jobs = createJobs(domain, items);
  kickDrain(domain);
  return NextResponse.json({ jobs, skipped });
}

/** Poll the queue. */
export async function GET(_req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({
    jobs: listJobs(params.domain),
    draining: isDraining(params.domain),
    concurrency: extractionConcurrency(),
    history: getJobHistorySummary(params.domain),
  });
}

/** Clear all finished/errored/committed jobs from the queue. */
export async function DELETE(_req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({ cleared: clearFinishedJobs(params.domain) });
}
