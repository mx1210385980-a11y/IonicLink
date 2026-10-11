import assert from "node:assert/strict";
import { extractRecords } from "./extract";

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
  try {
    for (const key of providerKeys) delete process.env[key];
    await assert.rejects(
      extractRecords(
        "tribology",
        "At 298 K, [BMIM][PF6] on mica under a 5 nN load had nanoscale AFM COF = 0.12.",
        "source-metadata-test"
      ),
      /Live extraction is not configured/,
      "paper extraction requires a configured LLM provider"
    );
  } finally {
    for (const key of providerKeys) {
      const value = saved.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("Live extraction configuration tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
