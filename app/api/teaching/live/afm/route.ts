import { NextRequest, NextResponse } from "next/server";
import { findLiveParticipant, getLiveDashboard } from "@/lib/teaching/liveStore";
import { liveAfmCurveCsv, liveAfmCurvePng, readLiveAfmArtifact } from "@/lib/teaching/liveAfm.server";
import { liveCaller } from "../_auth";
import { labError } from "../../lab/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const own = findLiveParticipant(caller.userKey);
    const participant = caller.admin
      ? getLiveDashboard(request.nextUrl.searchParams.get("experimentId") || "").participants.find((p) => p.id === request.nextUrl.searchParams.get("participantId"))
      : own;
    if (!participant || (!caller.admin && request.nextUrl.searchParams.get("participantId") !== own?.id)) return NextResponse.json({ error: "You may only view your own classroom curves." }, { status: 403 });
    if (!participant.afmArtifactId) return NextResponse.json({ error: "No automatic AFM result is saved for this participant." }, { status: 404 });
    const artifact = await readLiveAfmArtifact(participant.afmArtifactId);
    const format = request.nextUrl.searchParams.get("format");
    const headers = { "cache-control": "private, no-store" };
    if (format === "csv" || format === "png") {
      const curve = artifact.curves.find((c) => c.id === request.nextUrl.searchParams.get("curveId"));
      if (!curve) return NextResponse.json({ error: "Choose a saved curve." }, { status: 404 });
      const name = `classroom-afm-${artifact.curves.indexOf(curve) + 1}.${format}`;
      return new NextResponse(format === "csv" ? liveAfmCurveCsv(curve) : new Uint8Array(liveAfmCurvePng(curve)).buffer, { headers: { ...headers, "content-type": format === "csv" ? "text/csv;charset=utf-8" : "image/png", "content-disposition": `attachment; filename="${name}"` } });
    }
    return NextResponse.json(artifact, { headers });
  } catch (error) { return labError(error); }
}
