import assert from "node:assert/strict";
import { extractRecords } from "./extract";

const envKeys = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "EXTRACT_MODEL",
  "EXTRACT_RETRY_BASE_MS",
  "EXTRACT_VISION_MODE",
  "EXTRACT_VISUAL_PAGE_LIMIT",
  "EXTRACT_VISUAL_PAGE_SCALE",
] as const;
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const savedFetch = globalThis.fetch;

async function main() {
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.MOONSHOT_API_KEY;
    process.env.KIMI_API_KEY = "test-key";
    process.env.EXTRACT_MODEL = "kimi-k3";
    process.env.EXTRACT_RETRY_BASE_MS = "0";

    let requestBody: Record<string, unknown> | undefined;
    let requestCount = 0;
    globalThis.fetch = async (input, init) => {
      requestCount += 1;
      assert.equal(String(input), "https://api.moonshot.cn/v1/chat/completions");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (requestCount === 1) {
        return Response.json({ error: { type: "engine_overloaded_error" } }, { status: 429 });
      }
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
    assert.equal(requestCount, 2);
    assert.equal("temperature" in (requestBody ?? {}), false);
    assert.equal(requestBody?.max_completion_tokens, 8000);
    assert.equal(requestBody?.reasoning_effort, "low");
    assert.equal("max_tokens" in (requestBody ?? {}), false);
    assert.equal(result.source, "openai-compatible");
    assert.equal(result.model, "kimi-k3");

    const visualPage = "data:image/png;base64,aW1hZ2U=";
    await extractRecords(
      "tribology",
      "[PAGE 5]\nFriction coefficients are displayed in Figure 3b.",
      undefined,
      { visualPages: [{ page: 5, dataUrl: visualPage }] },
    );
    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    const userContent = messages.find((message) => message.role === "user")?.content;
    assert.ok(Array.isArray(userContent), "vision extraction uses multipart message content");
    assert.deepEqual(
      userContent.filter((part) => part.type === "image_url"),
      [{ type: "image_url", image_url: { url: visualPage } }],
    );
    assert.match(
      String(userContent.find((part) => part.type === "text" && String(part.text).includes("PAGE 5"))?.text),
      /PAGE 5/,
      "the image is paired with its PDF page number",
    );

    process.env.EXTRACT_VISION_MODE = "on";
    process.env.EXTRACT_VISUAL_PAGE_LIMIT = "1";
    process.env.EXTRACT_VISUAL_PAGE_SCALE = "2";
    const rendered: Array<[number, number]> = [];
    await extractRecords("tribology", "[PAGE 5]\nFriction coefficients are displayed in Figure 3b.", "isolated-student-upload", {
      renderPage: async (page, scale) => { rendered.push([page, scale]); return Buffer.from("student-pdf-image"); },
    });
    assert.deepEqual(rendered, [[5, 2]], "teaching PDF rendering uses shared page selection and scale");
    assert.ok(JSON.stringify(requestBody?.messages).includes(Buffer.from("student-pdf-image").toString("base64")));
    process.env.EXTRACT_VISION_MODE = "off";
    await extractRecords("tribology", "[PAGE 5]\nFriction coefficients are displayed in Figure 3b.", "isolated-student-upload", {
      renderPage: async () => { throw new Error("Vision disabled must skip rendering"); },
    });
    delete process.env.EXTRACT_VISION_MODE;

    let recoveryRequestCount = 0;
    const recoveryBodies: Record<string, unknown>[] = [];
    globalThis.fetch = async (_input, init) => {
      recoveryRequestCount += 1;
      recoveryBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        choices: [
          {
            finish_reason: recoveryRequestCount === 1 ? "length" : "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    arguments:
                      recoveryRequestCount === 1
                        ? '{"records":[{"paperTitle":"truncated'
                        : JSON.stringify({ records: [] }),
                  },
                },
              ],
            },
          },
        ],
      });
    };

    const recovered = await extractRecords("tribology", "A paper whose first tool result is truncated.");
    assert.equal(recoveryRequestCount, 2, "a truncated successful response is retried once");
    assert.equal(recovered.records.length, 0);
    assert.match(
      JSON.stringify(recoveryBodies[1]?.messages),
      /RETRY REQUIREMENT/,
      "the retry asks for a compact, fully closed tool call",
    );

    let malformedRequestCount = 0;
    globalThis.fetch = async () => {
      malformedRequestCount += 1;
      return Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    arguments:
                      malformedRequestCount === 1
                        ? '{"records":[{"paperTitle":"malformed'
                        : JSON.stringify({ records: [] }),
                  },
                },
              ],
            },
          },
        ],
      });
    };

    await extractRecords("tribology", "A paper whose first tool result is malformed.");
    assert.equal(malformedRequestCount, 2, "malformed tool JSON is retried even without finish_reason=length");

    let exhaustedRequestCount = 0;
    globalThis.fetch = async () => {
      exhaustedRequestCount += 1;
      return Response.json({
        choices: [
          {
            finish_reason: "length",
            message: {
              tool_calls: [{ function: { arguments: '{"records":[{"paperTitle":"still truncated' } }],
            },
          },
        ],
      });
    };

    await assert.rejects(
      extractRecords("tribology", "A paper whose tool result remains truncated."),
      /unusable completion after 2 attempts: provider stopped before completing the tool JSON \(finish_reason=length, tool argument chars=\d+\)/,
    );
    assert.equal(exhaustedRequestCount, 2, "persistent truncation stops after the bounded retry");
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
