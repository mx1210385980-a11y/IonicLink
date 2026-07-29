import { NextRequest, NextResponse } from "next/server";
import { deleteRecords } from "@/lib/db";
import { isDomain } from "@/lib/domain";

export const runtime = "nodejs";

/** Bulk delete: { ids: string[] }. */
export async function POST(req: NextRequest, { params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const { ids } = (await req.json()) as { ids?: string[] };
  const deleted = deleteRecords(params.domain, Array.isArray(ids) ? ids : []);
  return NextResponse.json({ deleted });
}
