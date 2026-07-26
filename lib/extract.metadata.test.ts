import assert from "node:assert/strict";
import { createRecords } from "./db";
import { extractRecords } from "./extract";

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
    const result = await extractRecords(
      "tribology",
      "Mock metadata test. At 298 K, [BMIM][PF6] on mica under a 5 nN load had nanoscale AFM COF = 0.12.",
      "source-metadata-test"
    );

    assert.equal(result.source, "mock");
    assert.ok(result.records.length > 0, "the deterministic mock produces a candidate");
    for (const record of result.records) {
      assert.deepEqual(record.extraction, { source: "mock" });
      assert.equal(record.sourceId, "source-metadata-test");
    }
    assert.throws(
      () => createRecords("tribology", result.records, "official"),
      /Cannot create official records from mock extraction/,
      "direct extract-to-official workflows cannot discard the mock gate"
    );
  } finally {
    for (const key of providerKeys) {
      const value = saved.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log("Extraction metadata stamping tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
