import { NextRequest, NextResponse } from "next/server";
import { getTeachingAdminDashboard } from "@/lib/teaching";
import { teachingRowsToCsv } from "@/lib/teachingCsv";
import { requireTeachingRole } from "../../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  const dashboard = getTeachingAdminDashboard(request.nextUrl.searchParams.get("project"));
  const csv = teachingRowsToCsv(dashboard.rows);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="teaching-comparison-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}

