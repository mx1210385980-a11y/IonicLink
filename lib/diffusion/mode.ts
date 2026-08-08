export type DiffusionMode = "1D" | "2D" | "3D-Cage" | "Membrane" | "0D-Pools" | "Gyroid";

const includesAny = (value: string, needles: string[]) =>
  needles.some((needle) => value.includes(needle));

export function getDiffusionMode(geometry: string | null | undefined): DiffusionMode {
  const normalized = (geometry ?? "").trim().toLowerCase();
  if (includesAny(normalized, ["1d", "cylindrical", "nanotube", "cnt"])) return "1D";
  if (includesAny(normalized, ["2d", "slit", "parallel", "flat plate", "layer spacing"])) return "2D";
  if (includesAny(normalized, ["mof", "framework", "zeolite", "cage"])) return "3D-Cage";
  if (includesAny(normalized, ["0d", "pool", "droplet", "isolated"])) return "0D-Pools";
  if (includesAny(normalized, ["gyroid", "bicontinuous", "lamella"])) return "Gyroid";
  return "Membrane";
}
