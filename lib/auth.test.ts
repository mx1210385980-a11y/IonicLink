import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { safeAuthRedirect } from "./auth-redirect";
import {
  auth,
  authDatabasePath,
  ensureAuthReady,
  getAppSession,
  requireAppApiSession,
} from "./auth.server";
import { createTestAppSession } from "./auth.test-helpers";

async function main() {
  await ensureAuthReady();
  assert.equal(existsSync(authDatabasePath()), true, "auth.db is created in the isolated data directory");

  const checkDb = new Database(authDatabasePath(), { readonly: true });
  assert.equal(checkDb.pragma("quick_check", { simple: true }), "ok");
  checkDb.close();

  assert.equal(safeAuthRedirect("/tribology/database?status=review"), "/tribology/database?status=review");
  assert.equal(safeAuthRedirect("https://example.com/steal"), "/");
  assert.equal(safeAuthRedirect("//example.com/steal"), "/");
  assert.equal(safeAuthRedirect("/login"), "/");
  assert.equal(safeAuthRedirect("/\\example.com"), "/");

  const loopbackOrigin = await auth.handler(
    new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({
        name: "Origin regression",
        email: "origin-repro@ioniclink.test",
        password: "short",
      }),
    })
  );
  assert.notEqual(loopbackOrigin.status, 403, "development accepts both localhost loopback hostnames");

  const testSession = await createTestAppSession();
  assert.ok(testSession.setCookies.some((cookie) => /HttpOnly/i.test(cookie)), "session cookie is HttpOnly");
  assert.ok(testSession.setCookies.some((cookie) => /SameSite=Lax/i.test(cookie)), "session cookie is SameSite=Lax");

  const sessionHeaders = new Headers({ cookie: testSession.cookie });
  const session = await getAppSession(sessionHeaders);
  assert.equal(session?.user.email, testSession.email);
  assert.equal(session?.user.role, "user");

  const missing = await requireAppApiSession(new Request("http://localhost/api/tribology/records"));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.response.status, 401);

  const teachingOnly = await requireAppApiSession(
    new Request("http://localhost/api/tribology/records", {
      headers: { cookie: "ioniclink_teaching_session=not-an-app-session" },
    })
  );
  assert.equal(teachingOnly.ok, false, "teaching cookies do not authenticate the main app");

  const valid = await requireAppApiSession(
    new Request("http://localhost/api/tribology/records", { headers: sessionHeaders })
  );
  assert.equal(valid.ok, true);

  const crossOrigin = await requireAppApiSession(
    new Request("http://localhost/api/tribology/records", {
      method: "POST",
      headers: { cookie: testSession.cookie, origin: "https://example.com" },
    })
  );
  assert.equal(crossOrigin.ok, false);
  if (!crossOrigin.ok) assert.equal(crossOrigin.response.status, 403);

  const spoofedProxyOrigin = await requireAppApiSession(
    new Request("http://localhost/api/tribology/records", {
      method: "POST",
      headers: {
        cookie: testSession.cookie,
        origin: "https://example.com",
        "x-forwarded-host": "example.com",
        "x-forwarded-proto": "https",
      },
    })
  );
  assert.equal(spoofedProxyOrigin.ok, false, "forwarded headers cannot bypass origin validation");
  if (!spoofedProxyOrigin.ok) assert.equal(spoofedProxyOrigin.response.status, 403);

  const signOut = await auth.api.signOut({ headers: sessionHeaders, asResponse: true });
  assert.equal(signOut.status, 200);
  assert.equal(await getAppSession(sessionHeaders), null, "logout revokes the database session immediately");

  console.log("Application authentication tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
