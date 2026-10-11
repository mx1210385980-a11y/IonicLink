import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { createJobs, getDataDir, getJob, getJobHistorySummary, listRecords, updateJob } from "./db";
import { ingest } from "./ingest";
import { isDraining, kickDrain, sendCompletedJobsToReview, sendJobToReview } from "./jobs";

const raw = {
  paper: { title: "Automatic review regression" },
  cation: "[BMIM]", anion: "[PF6]", substrate: "mica",
  temperature: "25 °C", load: "5 nN", cof: 0.1, scale: "nano" as const,
};
const draft = ingest(raw);
const [legacy] = createJobs("tribology", [{ filename: "legacy.pdf", text: "legacy text" }]);
updateJob("tribology", legacy.id, { status: "done", candidates: [draft], recordCount: 1 });
sendCompletedJobsToReview("conductivity");
assert.equal(getJob("tribology", legacy.id)?.status, "done", "recovery is domain scoped");
sendCompletedJobsToReview("tribology");
assert.equal(getJob("tribology", legacy.id)?.status, "committed");
assert.equal(listRecords("tribology", { status: "review" }).length, 1);
sendCompletedJobsToReview("tribology");
assert.equal(listRecords("tribology", { status: "review" }).length, 1, "repeated polling is idempotent");

const [failing] = createJobs("tribology", [{ filename: "retry.pdf", text: "retry text" }]);
updateJob("tribology", failing.id, { status: "done", candidates: [draft], recordCount: 1 });
const db = new Database(path.join(getDataDir(), "tribology.db"));
db.exec(`CREATE TRIGGER reject_review_event BEFORE INSERT ON job_events
  WHEN NEW.status = 'committed'
  BEGIN SELECT RAISE(ABORT, 'review transfer test failure'); END;`);
try {
  const failed = sendJobToReview("tribology", failing.id);
  assert.ok("error" in failed);
  assert.match(getJob("tribology", failing.id)?.error ?? "", /review transfer test failure/);
  assert.equal(getJob("tribology", failing.id)?.status, "done");
  assert.equal(getJob("tribology", failing.id)?.candidates.length, 1, "failed transfer preserves candidates");
  assert.equal(listRecords("tribology", { status: "review" }).length, 1, "record insertion rolls back with job status");
} finally {
  db.exec("DROP TRIGGER reject_review_event");
  db.close();
}
sendCompletedJobsToReview("tribology");
assert.equal(getJob("tribology", failing.id)?.status, "done", "polling does not hammer a known failed transfer");
const retried = sendJobToReview("tribology", failing.id);
assert.ok("created" in retried && retried.created === 1);
assert.equal(getJob("tribology", failing.id)?.error, null);
const repeated = sendJobToReview("tribology", failing.id);
assert.ok("created" in repeated && repeated.created === 0);
assert.equal(listRecords("tribology", { status: "review" }).length, 2);
assert.equal(getJobHistorySummary("tribology").committedJobs, 2, "one completion event per job");

const [empty] = createJobs("tribology", [{ filename: "empty.pdf", text: "no candidates" }]);
updateJob("tribology", empty.id, { status: "done", candidates: [], recordCount: 0 });
sendCompletedJobsToReview("tribology");
assert.equal(getJob("tribology", empty.id)?.status, "committed");
assert.equal(getJob("tribology", empty.id)?.recordCount, 0);

async function main() {
  const keys = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "openai_api_key", "openai_base_url", "KIMI_API_KEY", "MOONSHOT_API_KEY", "ANTHROPIC_API_KEY", "EXTRACT_MODEL", "EXTRACT_RETRY_BASE_MS"];
  const savedEnv = new Map(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  try {
    for (const key of keys) delete process.env[key];
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://extraction.test/v1";
    process.env.EXTRACT_MODEL = "test-extractor";
    process.env.EXTRACT_RETRY_BASE_MS = "0";
    let calls = 0;
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://extraction.test/v1/chat/completions");
      calls += 1;
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ records: [raw] }) } }] } }] });
    };
    const [fresh] = createJobs("tribology", [{ filename: "fresh.pdf", text: "A fresh extraction" }]);
    kickDrain("tribology");
    kickDrain("tribology");
    const deadline = Date.now() + 5000;
    while (isDraining("tribology") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(isDraining("tribology"), false);
    assert.equal(calls, 1, "concurrent drain requests do not extract twice");
    assert.equal(getJob("tribology", fresh.id)?.status, "committed", "worker sends to review without a client request");
    assert.equal(listRecords("tribology", { status: "review" }).length, 3);
    assert.equal(listRecords("tribology", { status: "official" }).length, 0, "human approval remains required");
    assert.equal(getJob("tribology", fresh.id)?.model, "test-extractor");
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of savedEnv) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
  console.log("Automatic review, rollback, idempotency and worker tests passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
