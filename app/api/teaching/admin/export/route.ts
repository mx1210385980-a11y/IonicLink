import { NextRequest, NextResponse } from "next/server";
import {
  getDefaultTeachingDashboard,
  rescoreErroredTeachingSubmissions,
} from "@/lib/teaching";
import { teachingExperimentToCsv } from "@/lib/teachingCsv";
import { requireTeachingRole } from "../../_auth";
import { internalTeachingErrorResponse } from "../../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireTeachingRole(request, "teacher");
  if (session instanceof NextResponse) return session;
  try {
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
  } catch (error) {
    return internalTeachingErrorResponse(
      "export default teaching dashboard",
      error,
      { status: 503, message: "导出教学实验数据失败，请稍后重试。" }
    );
  }
}
