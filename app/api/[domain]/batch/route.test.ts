import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createJobs } from "../../../../lib/db";
import { createTestAppSession } from "../../../../lib/auth.test-helpers";
import { GET } from "./route";

async function main() {
  const { cookie } = await createTestAppSession();
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

  console.log("Batch API history tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
