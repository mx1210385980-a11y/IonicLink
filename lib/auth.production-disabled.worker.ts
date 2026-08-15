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

  assert.equal(isAppAuthEnabled(), false, "missing production auth configuration disables application auth");
  await ensureAuthReady();

  const access = await requireAppApiSession(new Request("http://localhost/api/tribology/records"));
  assert.equal(access.ok, true, "public compatibility mode keeps application APIs available");
  if (access.ok) assert.equal(access.session, null);

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
