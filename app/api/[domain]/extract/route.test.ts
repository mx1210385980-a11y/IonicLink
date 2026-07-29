import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";

const providerKeys = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "openai_api_key",
  "openai_base_url",
  "ANTHROPIC_API_KEY",
] as const;
const saved = new Map(providerKeys.map((key) => [key, process.env[key]]));

async function main() {
  try {
    for (const key of providerKeys) delete process.env[key];
    const response = await POST(
      new NextRequest("http://localhost/api/tribology/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Mock API metadata test. At 298 K, [BMIM][PF6] on mica under a 5 nN load had nanoscale AFM COF = 0.12.",
        }),
      }),
      { params: { domain: "tribology" } }
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      source?: string;
      records?: Array<{ extraction?: { source?: string } }>;
    };
    assert.equal(payload.source, "mock");
    assert.ok(payload.records?.length, "the endpoint returns a candidate");
    assert.ok(payload.records?.every((record) => record.extraction?.source === "mock"));
  } finally {
    for (const key of providerKeys) {
      const value = saved.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("Extract API metadata tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
