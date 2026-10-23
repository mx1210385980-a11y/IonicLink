import { NextRequest, NextResponse } from "next/server";
import { getOptionalApiSession, isAppAuthEnabled, requireAppApiRole, requireAppApiSession } from "@/lib/auth.server";
import { createRecords, type ListOptions } from "@/lib/db";
import { getDatabasePayload } from "@/lib/database.server";
import { isDomain } from "@/lib/domain";
import type { RecordDraft } from "@/lib/schema";
import { parseExactStructureSearch, StructureSearchInputError } from "@/lib/structureSearch.server";
import { withUsageAction } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { domain: string } }) {
  const access = await getOptionalApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  const sp = req.nextUrl.searchParams;
  const opts: ListOptions = {};
  const status = sp.get("status");
  if (status === "review" || status === "official") opts.status = status;
  // Anonymous visitors may only browse the official (checked) database.
  if (isAppAuthEnabled() && !access.session) opts.status = "official";
  const facet = sp.get("facet");
  if (facet) opts.facet = facet;
  const search = sp.get("search");
  if (search) opts.search = search;
  const paper = sp.get("paper");
  if (paper) opts.paper = paper;
  try {
    const structure = parseExactStructureSearch(sp);
    if (structure) opts.structure = structure;
  } catch (error) {
    if (error instanceof StructureSearchInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  return NextResponse.json(getDatabasePayload(domain, opts));
}

async function postHandler(req: NextRequest, { params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json()) as { records: RecordDraft[]; status?: "review" | "official" };
  if (!Array.isArray(body.records)) {
    return NextResponse.json({ error: "records[] required" }, { status: 400 });
  }
  // Inserting straight into the official database is an administrator-only action.
  const access =
    body.status === "official"
      ? await requireAppApiRole(req, "admin")
      : await requireAppApiSession(req);
  if (!access.ok) return access.response;
  try {
    const created = createRecords(params.domain, body.records, body.status ?? "review");
    return NextResponse.json({ created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create records";
    if (message.startsWith("Cannot create checked records")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    throw error;
  }
}

export function POST(req: NextRequest, context: { params: { domain: string } }) {
  return withUsageAction(req, "创建记录", postHandler, req, context);
}
