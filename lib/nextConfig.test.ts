import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const configUrl = pathToFileURL(path.resolve("next.config.mjs")).href;

async function loadConfig(distDir?: string) {
  if (distDir == null) {
    delete process.env.NEXT_DIST_DIR;
  } else {
    process.env.NEXT_DIST_DIR = distDir;
  }

  const mod = await import(`${configUrl}?distDir=${encodeURIComponent(distDir ?? "default")}&t=${Date.now()}`);
  return mod.default;
}

async function main() {
  {
    const config = await loadConfig();
    assert.equal(config.distDir, ".next", "default builds should keep the production .next directory");
  }

  {
    const config = await loadConfig(".next-dev");
    assert.equal(config.distDir, ".next-dev", "dev services must be able to isolate their cache/output");
  }

  delete process.env.NEXT_DIST_DIR;

  console.log("Next config dist-dir isolation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
