import { NextResponse } from "next/server";
import { normalizeStrategyRequest, runWffStrategy, streamWffStrategy } from "@/lib/predict/wffStrategy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const normalized = normalizeStrategyRequest(body);
    const url = new URL(request.url);
    if (url.searchParams.get("stream") === "1") {
      return new Response(streamWffStrategy(normalized), {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }
    const result = await runWffStrategy(normalized);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Model evaluation failed" },
      { status: 500 }
    );
  }
}
