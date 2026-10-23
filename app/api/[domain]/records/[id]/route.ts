import { NextRequest, NextResponse } from "next/server";
import { getOptionalApiSession, isAppAuthEnabled, requireAppApiRole, requireAppApiSession } from "@/lib/auth.server";
import { deleteRecords, getRecord, updateRecord, type FieldProvenancePatch } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { withUsageAction } from "@/lib/usage";
import type { ExtractedFields, RecordStatus } from "@/lib/schema";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await getOptionalApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const record = getRecord(params.domain, decodeURIComponent(params.id));
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  // Review-queue records are invisible to anonymous visitors.
  if (record.status !== "official" && isAppAuthEnabled() && !access.session) {
    return NextResponse.json({ error: "Record not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
}

async function patchHandler(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json()) as {
    fields?: ExtractedFields;
    status?: RecordStatus;
    setProvenance?: { field: string; prov: FieldProvenancePatch };
    setField?: { field: string; value: string };
  };
  // Changing record status (approve-to-official / demote) is administrator-only;
  // field edits stay available to any signed-in user (students collaborate in the queue).
  const access =
    body.status !== undefined
      ? await requireAppApiRole(req, "admin")
      : await requireAppApiSession(req);
  if (!access.ok) return access.response;
  const result = updateRecord(params.domain, decodeURIComponent(params.id), body);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ record: result.record });
}

async function deleteHandler(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiRole(_req, "admin");
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const n = deleteRecords(params.domain, [decodeURIComponent(params.id)]);
  return NextResponse.json({ deleted: n });
}

export function PATCH(req: NextRequest, context: { params: { domain: string; id: string } }) {
  return withUsageAction(req, "更新记录", patchHandler, req, context);
}

export function DELETE(req: NextRequest, context: { params: { domain: string; id: string } }) {
  return withUsageAction(req, "删除记录", deleteHandler, req, context);
}
