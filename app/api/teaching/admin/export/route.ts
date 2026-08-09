import { NextRequest, NextResponse } from "next/server";
import {
  getDefaultTeachingDashboard,
  rescoreErroredTeachingSubmissions,
} from "@/lib/teaching";
import { teachingExperimentToCsv } from "@/lib/teachingCsv";
import { requireTeachingRole } from "../../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  rescoreErroredTeachingSubmissions(20);
  const dashboard = getDefaultTeachingDashboard();
  const csv = teachingExperimentToCsv(dashboard, {
    anonymize: request.nextUrl.searchParams.get("anonymize") === "1",
  });
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="teaching-experiment-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
