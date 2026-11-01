import { NextRequest, NextResponse } from "next/server";
import {
  createLiveExperiment, finishLiveExperiment, findLiveParticipant, getLiveDashboard, getLiveStudent,
  joinLiveExperiment, listLiveExperiments, reviewLive, saveLiveDraft, setLiveGold, startLiveExperiment, submitLive, advanceLiveRound, exitLiveExperiment,
} from "@/lib/teaching/liveStore";
import { rejectCrossOriginMutation } from "../_auth";
import { labBody, labError } from "../lab/_helpers";
import { liveCaller } from "./_auth";
import type { LiveMark } from "@/lib/teaching/liveShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const caller = await liveCaller(request);
    if (!caller) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (caller.admin) {
      const experiments = listLiveExperiments();
      const id = request.nextUrl.searchParams.get("id") || experiments[0]?.id;
      const roundParam = request.nextUrl.searchParams.get("round");
      const round = roundParam == null ? undefined : Number(roundParam);
      return NextResponse.json({ role: "teacher", experiments, dashboard: id ? getLiveDashboard(id, round) : null });
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
      if (action === "create") return NextResponse.json(getLiveDashboard(createLiveExperiment({ name: String(body.name ?? ""), groupCount: Number(body.groupCount) }).id));
      if (action === "start") return NextResponse.json(startLiveExperiment(String(body.experimentId)));
      if (action === "advance") return NextResponse.json(advanceLiveRound(String(body.experimentId)));
      if (action === "finish") return NextResponse.json(finishLiveExperiment(String(body.experimentId)));
      if (action === "gold") { setLiveGold(String(body.experimentId), body.gold, body.paperIndex == null ? undefined : Number(body.paperIndex)); return NextResponse.json({ ok: true }); }
      if (action === "review") return NextResponse.json(reviewLive(String(body.participantId), { version: Number(body.version), overrides: body.overrides as Record<string, LiveMark>, note: body.note == null ? undefined : String(body.note), round: body.round == null ? undefined : Number(body.round) }));
    } else {
      if (action === "join") return NextResponse.json(getLiveStudent(joinLiveExperiment(String(body.experimentId), { userKey: caller.userKey, alias: caller.alias }).id));
      const own = findLiveParticipant(caller.userKey);
      if (!own || own.id !== body.participantId) return NextResponse.json({ error: "You can only edit your own experiment progress." }, { status: 403 });
      if (action === "exit") return NextResponse.json(exitLiveExperiment(own.id));
      if (action === "save") return NextResponse.json(saveLiveDraft(own.id, { version: Number(body.version), rows: body.rows }));
      if (action === "submit") return NextResponse.json(submitLive(own.id, { version: Number(body.version), rows: body.rows }));
    }
    return NextResponse.json({ error: "This action is not available for your account." }, { status: 403 });
  } catch (error) { return labError(error); }
}
