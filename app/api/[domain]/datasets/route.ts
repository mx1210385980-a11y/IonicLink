import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { commitDatasetImport } from "@/lib/db";
import { adaptDiffusionDataset, DIFFUSION_DATASET_ADAPTER } from "@/lib/datasets/diffusion";
import { parseTabularFile } from "@/lib/datasets/parse";
import type { DatasetImportResult } from "@/lib/datasets/types";
import { isDomain } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  if (params.domain !== "diffusion") {
    return NextResponse.json({ error: `No tabular adapter is configured for ${params.domain} yet.` }, { status: 422 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const paperTitle = typeof form.get("paperTitle") === "string" ? String(form.get("paperTitle")).trim() : "";
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "The uploaded dataset is empty." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Dataset exceeds the 20 MB upload limit." }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fingerprint = createHash("sha256")
      .update(bytes)
      .update(`\0${DIFFUSION_DATASET_ADAPTER}`)
      .digest("hex");
    const sheets = await parseTabularFile(file.name, bytes);
    if (sheets.length === 0) return NextResponse.json({ error: "No tabular data was found." }, { status: 422 });
    const adaptation = adaptDiffusionDataset(sheets, {
      filename: file.name,
      fingerprint,
      paperTitle,
    });
    if (adaptation.drafts.length === 0) {
      return NextResponse.json(
        { error: "No valid diffusion records were produced. Check the ion, temperature, diffusion, and unit columns.", details: adaptation.invalidRows.slice(0, 20) },
        { status: 422 }
      );
    }

    const result: DatasetImportResult = {
      fingerprint,
      filename: file.name,
      adapter: adaptation.adapter,
      inputRows: adaptation.inputRows,
      outputRecords: adaptation.drafts.length,
      invalidRows: adaptation.invalidRows.slice(0, 100),
      warnings: adaptation.warnings,
      mappings: adaptation.mappings,
      preview: adaptation.preview,
    };
    if (mode === "preview") return NextResponse.json(result);

    const committed = commitDatasetImport(params.domain, {
      fingerprint,
      filename: file.name,
      adapter: adaptation.adapter,
      drafts: adaptation.drafts,
      metadata: {
        paperTitle: paperTitle || null,
        inputRows: adaptation.inputRows,
        invalidRows: adaptation.invalidRows.length,
        mappings: adaptation.mappings,
      },
    });
    return NextResponse.json({ ...result, ...committed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import dataset";
    const status = /supported dataset formats|rows exceeds|columns exceeds|unrecognized|invalid/i.test(message) ? 422 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
