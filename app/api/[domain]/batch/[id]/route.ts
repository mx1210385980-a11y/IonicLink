import { NextRequest, NextResponse } from "next/server";
import { commitJob, deleteJob } from "@/lib/db";
import { isDomain } from "@/lib/domain";

export const runtime = "nodejs";

/** Commit a finished job's candidates into the review queue. */
export async function POST(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; indices?: number[] };
  if (body.action !== "commit") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const result = commitJob(params.domain, decodeURIComponent(params.id), body.indices);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(result);
}

export async function DELETE(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({ deleted: deleteJob(params.domain, decodeURIComponent(params.id)) });
}
