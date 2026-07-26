import { NextRequest, NextResponse } from "next/server";
import { deleteRecords, updateRecord, type FieldProvenancePatch } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import type { ExtractedFields, RecordStatus } from "@/lib/schema";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json()) as {
    fields?: ExtractedFields;
    status?: RecordStatus;
    setProvenance?: { field: string; prov: FieldProvenancePatch };
  };
  const result = updateRecord(params.domain, decodeURIComponent(params.id), body);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ record: result.record });
}

export async function DELETE(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const n = deleteRecords(params.domain, [decodeURIComponent(params.id)]);
  return NextResponse.json({ deleted: n });
}
