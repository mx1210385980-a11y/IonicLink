import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["afm-curves.json", "afm-curation.json", "afm-paper-candidates.json"];

function portableSourcePath(value) {
  if (typeof value !== "string") return value;
  const normalized = value.replaceAll("\\", "/");
  const mappings = [
    ["/曲线数据/", "external://curve-data/"],
    ["/文献来源/", "external://paper-library/"],
    ["/ion_liquid_prediction/", "external://legacy-afm-platform/"],
  ];
  for (const [marker, prefix] of mappings) {
    const index = normalized.indexOf(marker);
    if (index >= 0) return prefix + normalized.slice(index + marker.length);
  }
  return normalized;
}

function sanitize(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return key.endsWith("Path") || key === "papersRoot" ? portableSourcePath(value) : value;
}

for (const filename of files) {
  const target = path.join(projectRoot, "data", "afm", filename);
  const payload = sanitize(JSON.parse(await readFile(target, "utf8")));
  if (filename === "afm-curves.json") {
    payload.scope = "Independent AFM workspace data asset; curves retain explicit links to related electrochemical evidence.";
  }
  if (filename === "afm-paper-candidates.json") payload.papersRoot = "external://paper-library";
  await writeFile(target, JSON.stringify(payload), "utf8");
}

console.log("Sanitized AFM source paths for portable repository data.");
