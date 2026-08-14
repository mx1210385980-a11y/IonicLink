import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ingest } from "../../../../lib/ingest";
import { createRecords } from "../../../../lib/db";
import { createTestAppSession } from "../../../../lib/auth.test-helpers";
import { GET, POST } from "./route";

const mockDraft = {
  ...ingest({
    paper: { title: "Mock API gate test" },
    cation: "[BMIM]",
    anion: "[PF6]",
    substrate: "mica",
    temperature: "25 °C",
    load: "5 nN",
    cof: 0.1,
    scale: "nano",
  }),
  extraction: { source: "mock" as const },
};

async function main() {
  const { cookie } = await createTestAppSession();
  const response = await POST(
    new NextRequest("http://localhost/api/tribology/records", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin: "http://localhost" },
      body: JSON.stringify({ records: [mockDraft], status: "official" }),
    }),
    { params: { domain: "tribology" } }
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Cannot create checked records from mock extraction/);

  createRecords(
    "tribology",
    [
      ingest({
        paper: { title: "Structure API filter" },
        cation: "[BMIM]",
        anion: "[PF6]",
        substrate: "mica",
        temperature: "298 K",
        load: "5 nN",
        cof: 0.08,
        scale: "nano",
      }),
    ],
    "review"
  );

  const queryUrl = new URL("http://localhost/api/tribology/records");
  queryUrl.searchParams.set("status", "review");
  queryUrl.searchParams.set("structureSmiles", "F[P-](F)(F)(F)(F)F");
  queryUrl.searchParams.set("structureTarget", "anion");
  queryUrl.searchParams.set("structureMode", "exact");
  const filtered = await GET(new NextRequest(queryUrl, { headers: { cookie } }), { params: { domain: "tribology" } });
  assert.equal(filtered.status, 200);
  const filteredPayload = (await filtered.json()) as { records: { paper: { title: string } }[] };
  assert.deepEqual(filteredPayload.records.map((record) => record.paper.title), ["Structure API filter"]);

  const invalidUrl = new URL(queryUrl);
  invalidUrl.searchParams.set("structureSmiles", "CCO.CN");
  const invalid = await GET(new NextRequest(invalidUrl, { headers: { cookie } }), { params: { domain: "tribology" } });
  assert.equal(invalid.status, 400);
  assert.match(((await invalid.json()) as { error: string }).error, /一个完整离子/);

  console.log("Records API structure-filter and official mock gate tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
