import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ingest } from "../../../../lib/ingest";
import { POST } from "./route";

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
  const response = await POST(
    new NextRequest("http://localhost/api/tribology/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [mockDraft], status: "official" }),
    }),
    { params: { domain: "tribology" } }
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as { error?: string };
  assert.match(payload.error ?? "", /Cannot create official records from mock extraction/);

  console.log("Records API official mock gate tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
