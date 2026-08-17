import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { getSource } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { deleteSourceDocument } from "@/lib/sources";

export const runtime = "nodejs";

/** Source metadata (filename + page count). */
export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const doc = getSource(params.domain, decodeURIComponent(params.id));
  if (!doc) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ id: doc.id, filename: doc.filename, pageCount: doc.pageCount });
}

/** Delete one uploaded document and every extraction artifact owned by it. */
export async function DELETE(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });

  const deleted = await deleteSourceDocument(params.domain, decodeURIComponent(params.id));
  if (!deleted) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ deleted });
}
