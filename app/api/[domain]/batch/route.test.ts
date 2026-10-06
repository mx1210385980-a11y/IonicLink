import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createJobs, getJob, listRecords, updateJob } from "../../../../lib/db";
import { ingest } from "../../../../lib/ingest";
import { createTestAppSession } from "../../../../lib/auth.test-helpers";
import { GET, POST } from "./route";
import { POST as retryJob } from "./[id]/route";
import { isDraining } from "../../../../lib/jobs";

const providerKeys = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "openai_api_key",
  "openai_base_url",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;
const saved = new Map(providerKeys.map((key) => [key, process.env[key]]));

async function main() {
  const { cookie } = await createTestAppSession();
  for (const key of providerKeys) delete process.env[key];

  const uploadResponse = await POST(
    new NextRequest("http://localhost/api/tribology/batch", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
      body: new FormData(),
    }),
    { params: { domain: "tribology" } }
  );
  assert.equal(uploadResponse.status, 503);
  assert.match(((await uploadResponse.json()) as { error?: string }).error ?? "", /Live extraction is not configured/);

  const [created] = createJobs("tribology", [
    { filename: "history-route-test.txt", text: "A route-level history test." },
  ]);

  const response = await GET(
    new NextRequest("http://localhost/api/tribology/batch", { headers: { cookie } }),
    { params: { domain: "tribology" } }
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    jobs?: Array<{ id: string }>;
    draining?: boolean;
    concurrency?: number;
    history?: { receivedJobs: number };
  };

  assert.ok(payload.jobs?.some((job) => job.id === created.id), "GET still returns the current jobs");
  assert.equal(typeof payload.draining, "boolean", "GET still returns the draining state");
  assert.equal(typeof payload.concurrency, "number", "GET still returns extraction concurrency");
  assert.equal(payload.history?.receivedJobs, 1, "GET exposes persisted job history");

  const retryRequest = () => new NextRequest(`http://localhost/api/tribology/batch/${created.id}`, {
    method: "POST", headers: { cookie, origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "retry" }),
  });
  const context = { params: { domain: "tribology", id: created.id } };
  assert.equal((await retryJob(retryRequest(), context)).status, 409, "running jobs are not requeued");
  updateJob("tribology", created.id, { status: "error", error: "Provider timeout" });
  assert.equal((await retryJob(retryRequest(), context)).status, 503, "extraction retries require a live provider");
  assert.equal(getJob("tribology", created.id)?.status, "error");

  const draft = ingest({ paper: { title: "Auto review API" }, cation: "[BMIM]", anion: "[PF6]",
    substrate: "mica", temperature: "25 °C", load: "5 nN", cof: 0.1, scale: "nano" });
  updateJob("tribology", created.id, { status: "done", candidates: [draft], recordCount: 1, error: null });
  await GET(new NextRequest("http://localhost/api/tribology/batch", { headers: { cookie } }), { params: { domain: "tribology" } });
  assert.equal(getJob("tribology", created.id)?.status, "committed", "GET migrates existing ready results");
  assert.equal(listRecords("tribology", { status: "review" }).length, 1);
  assert.equal((await retryJob(retryRequest(), context)).status, 200);
  assert.equal(listRecords("tribology", { status: "review" }).length, 1, "a stale retry cannot duplicate records");

  const [transfer] = createJobs("tribology", [{ filename: "transfer.txt", text: "Already extracted" }]);
  updateJob("tribology", transfer.id, { status: "done", candidates: [draft], recordCount: 1, error: "Storage unavailable" });
  const transferResponse = await retryJob(retryRequest(), { params: { domain: "tribology", id: transfer.id } });
  assert.equal(transferResponse.status, 200, "review retry uses saved candidates without a configured model");
  assert.equal(getJob("tribology", transfer.id)?.status, "committed");
  assert.equal(getJob("tribology", transfer.id)?.error, null);
  assert.equal(listRecords("tribology", { status: "review" }).length, 2);
  assert.equal(listRecords("tribology", { status: "official" }).length, 0);

  const savedFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "retry-test-key";
    process.env.OPENAI_BASE_URL = "https://retry.test/v1";
    let extractionCalls = 0;
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://retry.test/v1/chat/completions");
      extractionCalls += 1;
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ records: [] }) } }] } }] });
    };
    const [failedExtraction] = createJobs("tribology", [{ filename: "failed.txt", text: "Retry extraction" }]);
    updateJob("tribology", failedExtraction.id, { status: "error", error: "Provider timeout" });
    const retryResponse = await retryJob(retryRequest(), { params: { domain: "tribology", id: failedExtraction.id } });
    assert.equal(retryResponse.status, 200);
    const deadline = Date.now() + 5000;
    while (isDraining("tribology") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(isDraining("tribology"), false);
    assert.equal(extractionCalls, 1);
    assert.equal(getJob("tribology", failedExtraction.id)?.status, "committed", "an extraction retry completes the entire automatic flow");
    assert.equal(getJob("tribology", failedExtraction.id)?.error, null);
  } finally {
    globalThis.fetch = savedFetch;
  }

  for (const key of providerKeys) {
    const value = saved.get(key);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }

  console.log("Batch API history and live-provider guard tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
