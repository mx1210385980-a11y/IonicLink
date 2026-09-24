import { existsSync } from "node:fs";
import path from "node:path";
import type { AfmCurveRecord } from "./afmCurves";

const EXTERNAL_PREFIX = "external://curve-data/";
const INTERNAL_IMPORT_PREFIX = "internal://afm-imported/";

export function resolveAfmSourceImagePath(curve: AfmCurveRecord): string | null {
  const externalPath = curve.source.imagePath;
  if (externalPath?.startsWith(INTERNAL_IMPORT_PREFIX)) {
    const relativeParts = externalPath.slice(INTERNAL_IMPORT_PREFIX.length).split("/").filter(Boolean);
    if (!relativeParts.length || relativeParts.some((part) => part === "." || part === "..")) return null;
    const root = path.resolve(process.cwd(), "data", "afm", "imported-source-figures");
    const candidate = path.resolve(root, ...relativeParts);
    if (candidate !== root && candidate.startsWith(`${root}${path.sep}`) && existsSync(candidate)) return candidate;
    return null;
  }
  if (!externalPath?.startsWith(EXTERNAL_PREFIX)) return null;
  const relativeParts = externalPath.slice(EXTERNAL_PREFIX.length).split("/").filter(Boolean);
  if (!relativeParts.length || relativeParts.some((part) => part === "." || part === "..")) return null;

  for (const configuredRoot of sourceRootCandidates()) {
    const root = path.resolve(configuredRoot);
    const candidate = path.resolve(root, ...relativeParts);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function afmSourceImageContentType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function sourceRootCandidates(): string[] {
  return [
    process.env.AFM_CURVE_ROOT,
    "D:\\ionic data\\曲线数据",
    "D:\\新建文件夹\\曲线数据",
  ].filter((value): value is string => Boolean(value?.trim()));
}
