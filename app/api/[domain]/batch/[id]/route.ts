import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { deleteJob, getJob, updateJob } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { isLiveExtractionEnabled, LIVE_EXTRACTION_REQUIRED_MESSAGE } from "@/lib/extract";
import { kickDrain, sendJobToReview } from "@/lib/jobs";

export const runtime = "nodejs";

/** Commit a finished job's candidates into the review queue. */
export async function POST(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; indices?: number[] };
  const id = decodeURIComponent(params.id);
  if (body.action === "retry") {
    const job = getJob(params.domain, id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.status === "error") {
      if (!isLiveExtractionEnabled()) {
        return NextResponse.json({ error: LIVE_EXTRACTION_REQUIRED_MESSAGE }, { status: 503 });
      }
      const queued = updateJob(params.domain, id, {
        status: "queued", error: null, startedAt: undefined, completedAt: undefined,
      });
      kickDrain(params.domain);
      return NextResponse.json({ job: queued });
    }
    if (job.status !== "done" && job.status !== "committed") {
      return NextResponse.json({ error: "This job is already processing" }, { status: 409 });
    }
  } else if (body.action !== "commit") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const result = sendJobToReview(params.domain, id, body.action === "commit" ? body.indices : undefined);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(result);
}

export async function DELETE(_req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  const access = await requireAppApiSession(_req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  return NextResponse.json({ deleted: deleteJob(params.domain, decodeURIComponent(params.id)) });
}
