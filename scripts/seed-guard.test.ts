import assert from "node:assert/strict";
import { prepareSeed } from "./seed-guard";

let resetCalls = 0;
assert.throws(
  () =>
    prepareSeed("tribology", [], {
      countByStatus: () => ({ official: 2, review: 1 }),
      backupDomainDatabase: () => {
        throw new Error("backup must not run without --reset");
      },
      resetAll: () => {
        resetCalls += 1;
      },
    }),
  (error: unknown) => {
    assert.match(String(error), /Refusing to seed tribology/);
    assert.match(String(error), /3 existing record\(s\)/);
    assert.match(String(error), /npm run seed -- --reset/);
    return true;
  }
);
assert.equal(resetCalls, 0, "existing records must not be reset without --reset");

prepareSeed("conductivity", [], {
  countByStatus: () => ({ official: 0, review: 0 }),
  backupDomainDatabase: () => {
    throw new Error("empty safe seed must not create a backup");
  },
  resetAll: () => {
    resetCalls += 1;
  },
});
assert.equal(resetCalls, 0, "an empty database can be seeded without resetting");

let resetDomain = "";
const resetEvents: string[] = [];
prepareSeed("diffusion", ["--reset"], {
  countByStatus: () => ({ official: 4, review: 5 }),
  backupDomainDatabase: (domain) => {
    resetEvents.push(`backup:${domain}`);
    return "data/backups/diffusion-test.db";
  },
  resetAll: (domain) => {
    resetEvents.push(`reset:${domain}`);
    resetCalls += 1;
    resetDomain = domain;
  },
});
assert.equal(resetCalls, 1, "--reset explicitly permits one reset");
assert.equal(resetDomain, "diffusion", "only the selected domain is reset");
assert.deepEqual(resetEvents, ["backup:diffusion", "reset:diffusion"], "backup completes before destructive reset");

console.log("Seed safety guard tests passed");
