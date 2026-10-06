import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// The 2026-09-12 second-pass polymer review (batch-03-polymers-review/corrected-candidates.json)
// downgraded three already-imported records to hold: their appendix rows are duplicated
// across materials in the source (28/30 and 24/30 identical torque rows). The correction
// pass had moved them to status='review'; this script archives and removes them.
const apply = process.argv.includes("--apply");

async function main() {
const db = new Database("data/tribology.db", { readonly: !apply });

const review = db.prepare("SELECT id, payload FROM records WHERE status='review' ORDER BY id").all() as { id: string; payload: string }[];
const expected: Record<string, string> = {
  "#205": "polymer-2024-uhmwpe-neat-1800s",
  "#213": "polymer-2024-pa6-neat-1800s",
  "#214": "polymer-2024-pa6-cnt-1-1800s",
};
assert.deepEqual(review.map((r) => r.id), Object.keys(expected), "Review queue must contain exactly the three polymer records");

const reasons: Record<string, string> = {
  "#205": "p25 UHMWPE neat 与 p28 PA6 neat 的 180–1800s 全部 30 行三次扭矩、均值与 SD 完全相同（28/30 完全一致行）；来源存在复制或条件归属风险，按二次审核结论拒绝。",
  "#213": "p28 PA6 neat 与 p25 UHMWPE neat 重复数据段同上；任一端都无法确认哪张表正确，按二次审核结论拒绝。",
  "#214": "p28 PA6 CNT 1% 与 p25 UHMWPE CNT 1% 的 180–780s、1080–1800s 各行三次扭矩、均值与 SD 完全相同（24/30）；按二次审核结论拒绝。",
};

const archived = review.map((r) => {
  const payload = JSON.parse(r.payload);
  const curationKey = (payload.flexible || []).find((f: { key: string }) => f.key === "curation_key")?.value;
  assert.equal(curationKey, expected[r.id], `Unexpected curation key for ${r.id}`);
  return { id: r.id, curationKey, reason: reasons[r.id], record: payload };
});

if (!apply) {
  console.log(JSON.stringify({ plan: true, review: review.map((r) => r.id), officialBefore: db.prepare("SELECT COUNT(*) c FROM records WHERE status='official'").get().c }));
} else {
  const backupPath = `data/backups/tribology-polymer-review-resolution-${Date.now()}.db`;
  await db.backup(backupPath);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.pragma("integrity_check", { simple: true }), "ok");
  backup.close();
  const receiptPath = "data/literature-expansion-20260912/goal-root-review/polymer-review-decisions.json";
  const officialBefore = db.prepare("SELECT COUNT(*) c FROM records WHERE status='official'").get().c as number;
  db.transaction(() => {
    for (const r of review) {
      assert.equal(db.prepare("DELETE FROM records WHERE id=? AND status='review' AND payload=?").run(r.id, r.payload).changes, 1);
    }
    assert.equal((db.prepare("SELECT COUNT(*) c FROM records WHERE status='review'").get() as { c: number }).c, 0);
  })();
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  const receipt = {
    createdAt: new Date().toISOString(),
    backup: backupPath,
    backupSha256: createHash("sha256").update(readFileSync(backupPath)).digest("hex"),
    evidence: "data/literature-expansion-20260912/batch-03-polymers-review/cross-material-duplicate-evidence.json",
    reviewReport: "data/literature-expansion-20260912/batch-03-polymers-review/review-report.md",
    officialBefore,
    officialAfter: db.prepare("SELECT COUNT(*) c FROM records WHERE status='official'").get().c as number,
    deleted: archived.map(({ id, curationKey, reason }) => ({ id, curationKey, reason })),
  };
  writeFileSync(path.resolve(receiptPath), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ applied: true, deleted: receipt.deleted.map((d) => d.id), officialAfter: receipt.officialAfter, receipt: receiptPath }));
}
db.close();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
