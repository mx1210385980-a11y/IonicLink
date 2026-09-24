import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveIonStructure } from "./ionStructures";

type Domain = "tribology" | "conductivity" | "diffusion";

// This is a coverage guard over the developer's current local databases, not a
// frozen fixture. Known ambiguous/composite labels may be absent or occur a
// different number of times as records are curated; only newly unknown labels
// should fail the test.
const KNOWN_AMBIGUOUS = new Set([
  "anion\t[BTA]/[Doc]",
  "cation\t[DOP-IL]",
  "cation\t[pyrrole-C6MIm+]",
]);
const unresolved = new Map<string, number>();
let totalRecords = 0;
const dataDir = path.resolve(process.env.IONICLINK_DATA_DIR || path.join(process.cwd(), "data"));

for (const domain of ["tribology", "conductivity", "diffusion"] as Domain[]) {
  const dbPath = path.join(dataDir, `${domain}.db`);
  if (!existsSync(dbPath)) {
    console.log(`Ion structure database coverage skipped: missing ${dbPath}`);
    process.exit(0);
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare("select payload from records").all() as { payload: string }[];
  totalRecords += rows.length;

  for (const row of rows) {
    const rec = JSON.parse(row.payload) as {
      core?: { ionicLiquid?: Record<string, string | undefined> };
    };
    const il = rec.core?.ionicLiquid ?? {};

    for (const kind of ["cation", "anion"] as const) {
      const label = il[kind]?.trim() ?? "";
      const smiles = il[`${kind}Smiles`]?.trim() ?? "";
      if (!label || smiles || resolveIonStructure(label, kind)?.smiles) continue;
      const key = `${kind}\t${label}`;
      unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
    }
  }
}

if (totalRecords === 0) {
  console.log("Ion structure database coverage skipped: no local database records");
  process.exit(0);
}

const unexpected = new Set([...unresolved.keys()].filter((label) => !KNOWN_AMBIGUOUS.has(label)));
assert.deepEqual(unexpected, new Set(), `Unexpected unresolved ion labels: ${[...unexpected].join(", ")}`);

console.log("Ion structure database coverage tests passed");
