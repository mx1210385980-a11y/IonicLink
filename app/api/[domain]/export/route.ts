import { NextRequest, NextResponse } from "next/server";
import { getRecord } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { recordsToCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "A JSON body with ids[] is required" }, { status: 400 });
  }

  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return NextResponse.json({ error: "ids[] must contain record ID strings" }, { status: 400 });
  }

  const records = ids.map((id) => getRecord(domain, id));
  const missing = ids.filter((_, index) => records[index] == null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Records not found in ${domain}: ${missing.join(", ")}` },
      { status: 404 }
    );
  }

  const csv = recordsToCsv(domain, records.filter((record) => record != null));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ioniclink-${domain}-visible.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
