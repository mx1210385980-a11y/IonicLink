import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const env = { ...process.env };
delete env.OPENAI_API_KEY;
delete env.openai_api_key;
delete env.OPENAI_BASE_URL;
delete env.openai_base_url;
delete env.ANTHROPIC_API_KEY;

let failed = false;
try {
  execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "scripts/evaluate-tribology-gold.ts",
      "--live",
      `--report-dir=${path.join("reports", "tribology-gold-evaluation", "test-live-guard")}`,
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: "pipe",
    }
  );
} catch (error) {
  failed = true;
  const stderr = String((error as { stderr?: string }).stderr ?? "");
  assert.match(stderr, /Live extraction requested but no live extractor is configured/);
}

assert.equal(failed, true, "--live must fail instead of silently falling back to mock extraction");

console.log("Tribology gold live guard tests passed");
