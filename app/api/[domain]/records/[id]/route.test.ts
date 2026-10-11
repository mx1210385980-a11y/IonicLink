import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createRecords, updateRecord } from "@/lib/db";
import { ingest } from "@/lib/ingest";
import { createTestAppSession } from "@/lib/auth.test-helpers";
import { GET } from "./route";

async function main() {
  const { cookie } = await createTestAppSession();
  const [record] = createRecords("tribology", [ingest({
    paper: { title: "Single record refresh", doi: "10.1234/refresh" },
    cation: "[BMIM]", anion: "[PF6]", substrate: "mica", temperature: "298 K", load: "5 nN", cof: 0.08, scale: "nano",
  })], "review");
  assert.ok(record);
  const request = (domain: string, id: string, authenticated = true) => GET(
    new NextRequest(`http://localhost/api/${domain}/records/${encodeURIComponent(id)}`, { headers: authenticated ? { cookie } : {} }),
    { params: { domain, id: encodeURIComponent(id) } },
  );

  const response = await request("tribology", record.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.record.id, record.id);
  assert.equal(payload.record.paper.title, "Single record refresh");
  assert.equal(payload.record.core.cof, 0.08);

  const updated = updateRecord("tribology", record.id, { setField: { field: "cof", value: "0.12" } });
  assert.equal(updated.error, undefined);
  const refreshed = await request("tribology", record.id);
  assert.equal((await refreshed.json()).record.core.cof, 0.12, "single-record GET returns the latest saved value");

  const missing = await request("tribology", "missing-record");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, "Record not found");
  const wrongDomain = await request("not-a-domain", record.id);
  assert.equal(wrongDomain.status, 404);
  assert.equal((await wrongDomain.json()).error, "Unknown domain");
  const isolatedDomain = await request("conductivity", record.id);
  assert.equal(isolatedDomain.status, 404, "records are isolated by property domain");

  const unauthenticated = await request("tribology", record.id, false);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).record, undefined);
  const unauthenticatedDomain = await request("not-a-domain", record.id, false);
  assert.equal(unauthenticatedDomain.status, 401, "authentication is checked before record or domain lookup");
  console.log("Single-record GET authentication, domain isolation and fresh read tests passed");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
