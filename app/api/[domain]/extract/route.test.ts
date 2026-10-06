import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createTestAppSession } from "@/lib/auth.test-helpers";
import { POST } from "./route";

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
  try {
    for (const key of providerKeys) delete process.env[key];
    const response = await POST(
      new NextRequest("http://localhost/api/tribology/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, origin: "http://localhost" },
        body: JSON.stringify({
          text: "Mock API metadata test. At 298 K, [BMIM][PF6] on mica under a 5 nN load had nanoscale AFM COF = 0.12.",
        }),
      }),
      { params: { domain: "tribology" } }
    );

    assert.equal(response.status, 503);
    const payload = (await response.json()) as { error?: string };
    assert.match(payload.error ?? "", /Live extraction is not configured/);
  } finally {
    for (const key of providerKeys) {
      const value = saved.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("Extract API live-provider guard tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
