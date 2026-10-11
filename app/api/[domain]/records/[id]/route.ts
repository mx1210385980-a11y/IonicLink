import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { deleteRecords, getRecord, updateRecord, type FieldProvenancePatch } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import type { ExtractedFields, RecordStatus } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const record = getRecord(params.domain, decodeURIComponent(params.id));
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json()) as {
    fields?: ExtractedFields;
    status?: RecordStatus;
    setProvenance?: { field: string; prov: FieldProvenancePatch };
    setField?: { field: string; value: string };
  };
  const result = updateRecord(params.domain, decodeURIComponent(params.id), body);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ record: result.record });
}

export async function DELETE(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const n = deleteRecords(params.domain, [decodeURIComponent(params.id)]);
  return NextResponse.json({ deleted: n });
}
