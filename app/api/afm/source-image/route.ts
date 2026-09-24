import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { NextRequest, NextResponse } from "next/server";
import { AFM_CURVE_DATASET } from "@/lib/afm/afmCurves";
import { afmSourceImageContentType, resolveAfmSourceImagePath } from "@/lib/afm/sourceImage.server";
import { requireAppApiSession } from "@/lib/auth.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireAppApiSession(request);
  if (!access.ok) return access.response;
  const curveId = request.nextUrl.searchParams.get("curveId")?.trim();
  if (!curveId) return NextResponse.json({ error: "curveId is required" }, { status: 400 });
  const curve = AFM_CURVE_DATASET.curves.find((candidate) => candidate.id === curveId);
  if (!curve?.source.imagePath) return NextResponse.json({ error: "Source figure not found" }, { status: 404 });
  const sourcePath = resolveAfmSourceImagePath(curve);
  if (!sourcePath) return NextResponse.json({ error: "Source figure is unavailable on this host" }, { status: 404 });

  const bytes = await readFile(sourcePath);
  let responseBytes: Uint8Array = bytes;
  let contentType = afmSourceImageContentType(sourcePath);
  if (curve.source.imageCrop) {
    const image = await loadImage(bytes);
    const crop = curve.source.imageCrop;
    const left = Math.max(0, Math.min(image.width - 1, Math.round(image.width * crop.left)));
    const top = Math.max(0, Math.min(image.height - 1, Math.round(image.height * crop.top)));
    const right = Math.max(left + 1, Math.min(image.width, Math.round(image.width * crop.right)));
    const bottom = Math.max(top + 1, Math.min(image.height, Math.round(image.height * crop.bottom)));
    const canvas = createCanvas(right - left, bottom - top);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    responseBytes = canvas.toBuffer("image/png");
    contentType = "image/png";
  }
  return new Response(responseBytes as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(curve.source.imageFile ?? "afm-source.png")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
