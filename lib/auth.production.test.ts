import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const worker = path.join(root, "lib", "auth.production-disabled.worker.ts");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "",
  BETTER_AUTH_URL: "",
  IONICLINK_ALLOW_SIGNUP: "false",
  IONICLINK_BOOTSTRAP_EMAIL: "",
  IONICLINK_BOOTSTRAP_PASSWORD: "",
  IONICLINK_BOOTSTRAP_NAME: "",
};

const result = spawnSync(process.execPath, [tsxCli, worker], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
assert.equal(result.status, 0, "production starts in public compatibility mode when auth is not configured");

const partial = spawnSync(process.execPath, [tsxCli, worker], {
  cwd: root,
  env: {
    ...env,
    BETTER_AUTH_SECRET: "ioniclink-production-test-secret-at-least-32-characters",
    IONICLINK_AUTH_WORKER_MODE: "partial",
  },
  stdio: "inherit",
});

if (partial.error) throw partial.error;
assert.equal(partial.status, 0, "partial production auth configuration fails with a precise diagnostic");

console.log("Production auth compatibility tests passed");
