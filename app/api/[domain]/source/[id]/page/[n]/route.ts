import { NextRequest, NextResponse } from "next/server";
import { requireAppApiSession } from "@/lib/auth.server";
import { getSourcePageText } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { findEvidenceOnPage, renderSourceFigure, renderSourcePage } from "@/lib/sources";
import type { BBox } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET a cited page. Default: the rendered page image (PNG). `?format=text`: the
 * page's extracted text, for showing context with a highlight. `?format=evidence&q=…`:
 * normalized boxes locating the quote on the page image, for on-image highlights.
 */
export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string; n: string } }) {
  const access = await requireAppApiSession(req);
  if (!access.ok) return access.response;
  if (!isDomain(params.domain)) return NextResponse.json({ error: "Unknown domain" }, { status: 404 });
  const domain = params.domain;
  const id = decodeURIComponent(params.id);
  const page = parseInt(params.n, 10);
  if (!Number.isFinite(page) || page < 1) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }

  if (req.nextUrl.searchParams.get("format") === "text") {
    const text = getSourcePageText(domain, id, page);
    if (text == null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ page, text });
  }

  if (req.nextUrl.searchParams.get("format") === "evidence") {
    const quote = req.nextUrl.searchParams.get("q") ?? "";
    try {
      const evidence = await findEvidenceOnPage(domain, id, page, quote);
      if (!evidence) return NextResponse.json({ error: "Source not found" }, { status: 404 });
      return NextResponse.json(
        { page, ...evidence },
        // The stored PDF never changes, so quote lookups are stable per URL.
        { headers: { "Cache-Control": "public, max-age=3600" } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lookup failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (req.nextUrl.searchParams.get("format") === "figure") {
    const figure = req.nextUrl.searchParams.get("figure")?.trim() ?? "";
    const rawBox = req.nextUrl.searchParams.get("box");
    let box: BBox | undefined;
    if (rawBox) {
      const values = rawBox.split(",").map(Number);
      if (values.length === 4 && values.every(Number.isFinite)) {
        box = { x: values[0], y: values[1], w: values[2], h: values[3] };
      }
    }
    if (!figure && !box) {
      return NextResponse.json({ error: "A figure label or crop box is required" }, { status: 400 });
    }
    try {
      const result = await renderSourceFigure(domain, id, page, figure, box);
      if (!result) {
        return NextResponse.json({ error: "Figure could not be located on this source page" }, { status: 404 });
      }
      return new Response(result.png as BodyInit, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "X-IonicLink-Figure-Crop": result.inferred ? "inferred" : "exact",
          "X-IonicLink-Figure-Box": [result.box.x, result.box.y, result.box.w, result.box.h].join(","),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Figure render failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const scale = Number(req.nextUrl.searchParams.get("scale")) || 2;
    const png = await renderSourcePage(domain, id, page, scale);
    if (!png) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    return new Response(png as BodyInit, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Render failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
