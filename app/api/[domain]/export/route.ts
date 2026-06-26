import { NextRequest, NextResponse } from "next/server";
import { listRecords, type ListOptions } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { recordsToCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  const sp = req.nextUrl.searchParams;
  const opts: ListOptions = {};
  const status = sp.get("status");
  if (status === "review" || status === "official") opts.status = status;
  const facet = sp.get("facet");
  if (facet) opts.facet = facet;
  const search = sp.get("search");
  if (search) opts.search = search;
  const paper = sp.get("paper");
  if (paper) opts.paper = paper;

  const csv = recordsToCsv(domain, listRecords(domain, opts));
  const stamp = (opts.status ?? "all") + "";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ioniclink-${domain}-${stamp}.csv"`,
    },
  });
}
