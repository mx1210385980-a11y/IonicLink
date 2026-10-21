import { NextRequest, NextResponse } from "next/server";
import { getOptionalApiSession, requireAppApiRole } from "@/lib/auth.server";
import { getSource } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { deleteSourceDocument } from "@/lib/sources";

export const runtime = "nodejs";

/** Source metadata (filename + page count). Public read (source ids are unguessable UUIDs). */
export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await getOptionalApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const doc = getSource(params.domain, decodeURIComponent(params.id));
  if (!doc) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ id: doc.id, filename: doc.filename, pageCount: doc.pageCount });
}

/** Delete one uploaded document and every extraction artifact owned by it. Administrator-only. */
export async function DELETE(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiRole(req, "admin");
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });

  const deleted = await deleteSourceDocument(params.domain, decodeURIComponent(params.id));
  if (!deleted) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ deleted });
}
