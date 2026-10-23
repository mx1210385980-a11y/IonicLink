import { NextRequest, NextResponse } from "next/server";
import { requireAppApiRole } from "@/lib/auth.server";
import { monitorSummary, type MonitorPeriod } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aggregated real usage data for the administrator monitor page. */
export async function GET(request: NextRequest) {
  const access = await requireAppApiRole(request, "admin");
  if (!access.ok) return access.response;

  const period: MonitorPeriod = request.nextUrl.searchParams.get("period") === "week" ? "week" : "today";
  return NextResponse.json(monitorSummary(period), { headers: { "Cache-Control": "no-store" } });
}
