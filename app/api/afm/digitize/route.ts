import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { digitizeAfmUpload } from "@/lib/afm/digitizeUpload.server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const access = await requireAppApiSession(request);
  if (!access.ok) return access.response;
  try {
    const form = await request.formData();
    return NextResponse.json(await digitizeAfmUpload(form.get("file") as File));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AFM curve recognition failed.";
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
