import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
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

const privateDataDir = mkdtempSync(path.join(os.tmpdir(), "ioniclink-auth-test-"));
try {
  const privateHttp = spawnSync(process.execPath, [tsxCli, worker], {
    cwd: root,
    env: {
      ...env,
      BETTER_AUTH_SECRET: "ioniclink-production-test-secret-at-least-32-characters",
      BETTER_AUTH_URL: "http://10.20.30.40:3000",
      IONICLINK_ALLOW_SIGNUP: "true",
      IONICLINK_DATA_DIR: privateDataDir,
      IONICLINK_AUTH_WORKER_MODE: "private-http",
    },
    stdio: "inherit",
  });

  if (privateHttp.error) throw privateHttp.error;
  assert.equal(privateHttp.status, 0, "production accepts plain HTTP on a private-network address");
} finally {
  rmSync(privateDataDir, { recursive: true, force: true });
}

const publicHttp = spawnSync(process.execPath, [tsxCli, worker], {
  cwd: root,
  env: {
    ...env,
    BETTER_AUTH_SECRET: "ioniclink-production-test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://ioniclink.example.org",
    IONICLINK_AUTH_WORKER_MODE: "public-http",
  },
  stdio: "inherit",
});

if (publicHttp.error) throw publicHttp.error;
assert.equal(publicHttp.status, 0, "production still rejects plain HTTP on a public origin");

const trustedDataDir = mkdtempSync(path.join(os.tmpdir(), "ioniclink-auth-test-"));
try {
  const trustedHttp = spawnSync(process.execPath, [tsxCli, worker], {
    cwd: root,
    env: {
      ...env,
      BETTER_AUTH_SECRET: "ioniclink-production-test-secret-at-least-32-characters",
      BETTER_AUTH_URL: "http://192.10.88.147:3000",
      IONICLINK_ALLOW_INSECURE_HTTP: "true",
      IONICLINK_ALLOW_SIGNUP: "true",
      IONICLINK_DATA_DIR: trustedDataDir,
      IONICLINK_AUTH_WORKER_MODE: "trusted-http",
    },
    stdio: "inherit",
  });

  if (trustedHttp.error) throw trustedHttp.error;
  assert.equal(
    trustedHttp.status,
    0,
    "production accepts plain HTTP on a non-RFC1918 address with the explicit insecure-HTTP opt-in"
  );
} finally {
  rmSync(trustedDataDir, { recursive: true, force: true });
}

console.log("Production auth compatibility tests passed");
