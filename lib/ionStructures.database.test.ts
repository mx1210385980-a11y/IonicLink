import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveIonStructure } from "./ionStructures";

type Domain = "tribology" | "conductivity" | "diffusion";

const KNOWN_AMBIGUOUS = new Set(["anion\t[BTA]/[Doc]", "cation\t[DOP-IL]"]);
const unresolved = new Map<string, number>();
let totalRecords = 0;

for (const domain of ["tribology", "conductivity", "diffusion"] as Domain[]) {
  const dbPath = path.join(process.cwd(), "data", `${domain}.db`);
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

assert.deepEqual(new Set(unresolved.keys()), KNOWN_AMBIGUOUS);
assert.equal(unresolved.get("anion\t[BTA]/[Doc]"), 9);
assert.equal(unresolved.get("cation\t[DOP-IL]"), 4);

console.log("Ion structure database coverage tests passed");
