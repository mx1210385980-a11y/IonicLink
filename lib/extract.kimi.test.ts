import assert from "node:assert/strict";
import { extractRecords } from "./extract";

const envKeys = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "EXTRACT_MODEL"] as const;
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const savedFetch = globalThis.fetch;

async function main() {
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://api.moonshot.cn/v1";
    process.env.EXTRACT_MODEL = "kimi-k3";

    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (requestBody.tool_choice !== "required") {
        return new Response(
          JSON.stringify({
            error: {
              message: "tool_choice 'specified' is incompatible with thinking enabled",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [{ function: { arguments: JSON.stringify({ records: [] }) } }],
            },
          },
        ],
      });
    };

    const result = await extractRecords("tribology", "A minimal paper excerpt.");

    assert.equal(requestBody?.tool_choice, "required");
    assert.equal("temperature" in (requestBody ?? {}), false);
    assert.equal(requestBody?.max_completion_tokens, 8000);
    assert.equal("max_tokens" in (requestBody ?? {}), false);
    assert.equal(result.source, "openai-compatible");
    assert.equal(result.model, "kimi-k3");
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("Kimi extraction compatibility tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
