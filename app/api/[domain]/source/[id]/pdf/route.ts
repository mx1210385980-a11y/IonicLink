import { NextRequest, NextResponse } from "next/server";
import { getSource } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { getSourcePdf } from "@/lib/sources";

export const runtime = "nodejs";

/** Serve the original uploaded PDF, so the curator can open the full source. */
export async function GET(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  const id = decodeURIComponent(params.id);
  const doc = getSource(domain, id);
  if (!doc) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const pdf = await getSourcePdf(domain, id);
  if (!pdf) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.filename}"`,
    },
  });
}
