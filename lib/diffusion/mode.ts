export type DiffusionMode = "1D" | "2D" | "3D";

const lower = (value: string) => value.toLowerCase();

const includesAny = (value: string, needles: string[]) =>
  needles.some((needle) => value.includes(needle));

export function getDiffusionMode(geometry: string | null | undefined): DiffusionMode {
  const normalized = (geometry ?? "").trim().toLowerCase();
  if (!normalized) return "3D";

  const is1D = includesAny(normalized, ["1d", "cylindrical", "nanotube", "cnt", "channel"]);
  const is2D = includesAny(normalized, [
    "2d",
    "slit",
    "planar",
    "parallel",
    "flat",
    "film",
    "layer spacing",
    "graphene oxide",
    "smectic",
  ]);
  const is3D = includesAny(normalized, [
    "3d",
    "pores",
    "mesopore",
    "gel",
    "ionogel",
    "network",
    "carbon",
    "membrane",
    "gyroid",
    "framework",
    "matrix",
    "cavities",
  ]);

  if (is1D && !normalized.includes("2d")) {
    return "1D";
  }
  if (is2D) {
    return "2D";
  }
  if (is3D) {
    return "3D";
  }

  return "3D";
}
