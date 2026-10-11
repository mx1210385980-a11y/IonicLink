import { NextRequest, NextResponse } from "next/server";
import { getGroupCrossoverDashboard } from "@/lib/teaching";
import { groupCrossoverToCsv } from "@/lib/teachingCsv";
import { requireTeachingRole } from "../../../_auth";
import { internalTeachingErrorResponse } from "../../../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return NextResponse.json({ error: "Experiment ID is required." }, { status: 400 });
  }
  try {
    const dashboard = getGroupCrossoverDashboard(projectId);
    const csv = groupCrossoverToCsv(dashboard, {
      anonymize: request.nextUrl.searchParams.get("anonymize") === "1",
    });
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="group-crossover-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return internalTeachingErrorResponse(
      "export group crossover dashboard",
      error,
      { status: 503, message: "Could not export group experiment data. Try again later." }
    );
  }
}
