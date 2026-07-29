import assert from "node:assert/strict";
import { createRecords, deleteRecords, listRecords } from "./db";
import { DOMAINS, type Domain } from "./domain";
import { ingest as triboIngest } from "./ingest";
import { ingest as condIngest } from "./conductivity/ingest";
import { ingest as diffIngest } from "./diffusion/ingest";

/**
 * Proves the core isolation guarantee: records written to one domain's database
 * never appear in any other's. Exercises the per-domain handle/counter Maps in
 * lib/db.ts — the change that physically separates the datasets.
 *
 * Non-destructive: it creates one marker record per domain, asserts pairwise
 * isolation across ALL domains, then deletes them in a finally block.
 */
const MARK = "__ISOLATION_MARKER__";

const made: Record<Domain, string> = {
  tribology: createRecords(
    "tribology",
    [
      triboIngest({
        paper: { title: MARK + "-tribology" },
        cation: "[ZtestM]",
        anion: "[Ztest]",
        substrate: "TestSurface",
        temperature: "300 K",
        load: "5 nN",
        cof: 0.99,
      }),
    ],
    "review"
  )[0].id,
  conductivity: createRecords(
    "conductivity",
    [
      condIngest({
        paper: { title: MARK + "-conductivity" },
        cation: "[ZtestM]",
        anion: "[Ztest]",
        surface: "TestSurface",
        temperature: "300 K",
        conductivity: "9 mS/cm",
      }),
    ],
    "review"
  )[0].id,
  diffusion: createRecords(
    "diffusion",
    [
      diffIngest({
        paper: { title: MARK + "-diffusion" },
        cation: "[ZtestM]",
        anion: "[Ztest]",
        species: "cation",
        temperature: "300 K",
        diffusion: "9.9e-11 m2/s",
      }),
    ],
    "review"
  )[0].id,
};

try {
  const titles = new Map(DOMAINS.map((d) => [d, listRecords(d).map((r) => r.paper.title)]));

  // each record appears ONLY in its own domain — pairwise, no cross-contamination
  for (const own of DOMAINS) {
    assert.ok(titles.get(own)!.includes(`${MARK}-${own}`), `${own} record present in ${own}`);
    for (const other of DOMAINS) {
      if (other === own) continue;
      assert.ok(
        !titles.get(other)!.includes(`${MARK}-${own}`),
        `${own} record must NOT leak into ${other}`
      );
    }
  }

  // schemas don't bleed: each domain's record carries ITS measured field only
  const cond = listRecords("conductivity").find((r) => r.paper.title === MARK + "-conductivity");
  assert.ok(cond?.core.conductivity, "conductivity record has σ");
  assert.equal(cond?.core.cof, undefined, "conductivity record has no cof field");
  const diff = listRecords("diffusion").find((r) => r.paper.title === MARK + "-diffusion");
  assert.ok(diff?.core.diffusion, "diffusion record has D");
  assert.equal(diff?.core.species, "cation", "diffusion record carries its species");
  assert.equal(diff?.core.cof, undefined, "diffusion record has no cof field");
  assert.equal(diff?.core.conductivity, undefined, "diffusion record has no σ field");

  console.log("DB domain isolation tests passed");
} finally {
  for (const d of DOMAINS) deleteRecords(d, [made[d]]);
}
