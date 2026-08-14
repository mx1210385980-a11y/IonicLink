import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { getSource } from "@/lib/db";
import { isDomain } from "@/lib/domain";

export const runtime = "nodejs";

/** Source metadata (filename + page count). */
export async function GET(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const doc = getSource(params.domain, decodeURIComponent(params.id));
  if (!doc) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ id: doc.id, filename: doc.filename, pageCount: doc.pageCount });
}
