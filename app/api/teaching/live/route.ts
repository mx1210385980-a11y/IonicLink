import { NextRequest, NextResponse } from "next/server";
import {
  createLiveExperiment, finishLiveExperiment, findLiveParticipant, getLiveDashboard, getLiveStudent,
  joinLiveExperiment, listLiveExperiments, reviewLive, saveLiveDraft, setLiveGold, startLiveExperiment, submitLive,
} from "@/lib/teaching/liveStore";
import { rejectCrossOriginMutation } from "../_auth";
import { labBody, labError } from "../lab/_helpers";
import { liveCaller } from "./_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (caller.admin) {
      const experiments = listLiveExperiments();
      const id = request.nextUrl.searchParams.get("id") || experiments[0]?.id;
      return NextResponse.json({ role: "teacher", experiments, dashboard: id ? getLiveDashboard(id) : null });
    }
    const existing = findLiveParticipant(caller.userKey);
    const open = listLiveExperiments().find((experiment) => experiment.status === "open" && experiment.id !== existing?.experimentId);
    return NextResponse.json({
      role: "student",
      state: existing ? getLiveStudent(existing.id) : null,
      openExperiment: open ? { id: open.id, name: open.name, groupCount: open.groupCount } : null,
    });
  } catch (error) { return labError(error); }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossOriginMutation(request); if (rejected) return rejected;
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const body = await labBody(request);
    const action = String(body.action ?? "");
    if (caller.admin) {
      if (action === "create") return NextResponse.json(getLiveDashboard(createLiveExperiment({ name: body.name, groupCount: body.groupCount }).id));
      if (action === "start") return NextResponse.json(getLiveDashboard(startLiveExperiment(String(body.experimentId)).id));
      if (action === "finish") return NextResponse.json(getLiveDashboard(finishLiveExperiment(String(body.experimentId)).id));
      if (action === "gold") { setLiveGold(String(body.experimentId), body.gold); return NextResponse.json({ ok: true }); }
      if (action === "review") return NextResponse.json(reviewLive(String(body.participantId), { version: body.version, overrides: body.overrides, note: body.note }));
    } else {
      if (action === "join") return NextResponse.json(getLiveStudent(joinLiveExperiment(String(body.experimentId), { userKey: caller.userKey, alias: caller.alias }).id));
      const own = findLiveParticipant(caller.userKey);
      if (!own || own.id !== body.participantId) return NextResponse.json({ error: "You can only edit your own experiment progress." }, { status: 403 });
      if (action === "save") return NextResponse.json(saveLiveDraft(own.id, { version: body.version, rows: body.rows }));
      if (action === "submit") return NextResponse.json(submitLive(own.id, { version: body.version, rows: body.rows }));
    }
    return NextResponse.json({ error: "This action is not available for your account." }, { status: 403 });
  } catch (error) { return labError(error); }
}
