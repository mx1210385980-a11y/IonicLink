import assert from "node:assert/strict";
import { GET as getAuth } from "../app/api/auth/[...all]/route";
import {
  ensureAuthReady,
  isAppAuthEnabled,
  requireAppApiSession,
} from "./auth.server";

async function main() {
  if (process.env.IONICLINK_AUTH_WORKER_MODE === "partial") {
    assert.equal(isAppAuthEnabled(), false);
    await assert.rejects(
      ensureAuthReady(),
      /BETTER_AUTH_URL is required when application authentication is enabled/,
      "partial authentication configuration fails with a precise error"
    );
    console.log("Production partial auth configuration worker tests passed");
    return;
  }

  if (process.env.IONICLINK_AUTH_WORKER_MODE === "private-http") {
    assert.equal(isAppAuthEnabled(), true);
    await ensureAuthReady();
    console.log("Production private-network HTTP worker tests passed");
    return;
  }

  if (process.env.IONICLINK_AUTH_WORKER_MODE === "public-http") {
    assert.equal(isAppAuthEnabled(), true);
    await assert.rejects(
      ensureAuthReady(),
      /must use HTTPS in production unless it targets a loopback or private-network address/,
      "public HTTP origins stay rejected in production"
    );
    console.log("Production public HTTP rejection worker tests passed");
    return;
  }

  if (process.env.IONICLINK_AUTH_WORKER_MODE === "trusted-http") {
    assert.equal(isAppAuthEnabled(), true);
    await ensureAuthReady();
    console.log("Production trusted-network HTTP worker tests passed");
    return;
  }

  assert.equal(isAppAuthEnabled(), false, "missing production auth configuration disables application auth");
  await ensureAuthReady();

  const access = await requireAppApiSession(new Request("http://localhost/api/tribology/records"));
  assert.equal(access.ok, true, "public compatibility mode keeps application APIs available");
  if (access.ok) assert.equal(access.session, null);

  const proxiedSameOrigin = await requireAppApiSession(
    new Request("http://localhost:3000/api/tribology/records", {
      method: "POST",
      headers: { host: "47.82.82.215", origin: "http://47.82.82.215" },
    })
  );
  assert.equal(
    proxiedSameOrigin.ok,
    true,
    "public compatibility mode accepts the browser origin preserved in the proxy Host header"
  );

  const crossOrigin = await requireAppApiSession(
    new Request("http://localhost/api/tribology/records", {
      method: "POST",
      headers: { origin: "https://example.com" },
    })
  );
  assert.equal(crossOrigin.ok, false, "public compatibility mode still rejects cross-origin writes");
  if (!crossOrigin.ok) assert.equal(crossOrigin.response.status, 403);

  const health = await getAuth(new Request("http://127.0.0.1/api/auth/get-session"));
  assert.equal(health.status, 200, "deployment health endpoint stays available without auth configuration");
  assert.equal(await health.json(), null);

  console.log("Production auth compatibility worker tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
