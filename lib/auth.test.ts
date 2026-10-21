import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { safeAuthRedirect } from "./auth-redirect";
import {
  auth,
  authDatabasePath,
  ensureAuthReady,
  getAppSession,
  getOptionalApiSession,
  requireAppApiRole,
  requireAppApiSession,
  sessionHasAdminRole,
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
  assert.equal(session?.user.role, "student");

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

  // --- RBAC: role matrix ------------------------------------------------------
  assert.equal(sessionHasAdminRole(session), false, "the default role is student-level");

  const studentDenied = await requireAppApiRole(
    new Request("http://localhost/api/tribology/records/delete", { method: "POST", headers: sessionHeaders }),
    "admin"
  );
  assert.equal(studentDenied.ok, false, "students cannot perform administrator actions");
  if (!studentDenied.ok) assert.equal(studentDenied.response.status, 403);

  const anonymousRead = await getOptionalApiSession(new Request("http://localhost/api/tribology/records"));
  assert.equal(anonymousRead.ok, true, "anonymous visitors may use public read routes");
  if (anonymousRead.ok) assert.equal(anonymousRead.session, null);

  const adminEmail = `route-admin-${process.pid}-${Date.now()}@ioniclink.test`;
  await auth.api.createUser({
    body: { email: adminEmail, name: "Route Admin", password: "Admin2026", role: "admin" },
  });
  const adminSignIn = await auth.handler(
    new Request("http://127.0.0.1:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ email: adminEmail, password: "Admin2026" }),
    })
  );
  assert.equal(adminSignIn.status, 200, "the administrator signs in by email");
  const adminCookies = (adminSignIn.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const adminCookie = adminCookies.map((value) => value.split(";", 1)[0]).join("; ");
  const adminSession = await getAppSession(new Headers({ cookie: adminCookie }));
  assert.equal(sessionHasAdminRole(adminSession), true);
  const adminAllowed = await requireAppApiRole(
    new Request("http://localhost/api/tribology/records/delete", {
      method: "POST",
      headers: { cookie: adminCookie },
    }),
    "admin"
  );
  assert.equal(adminAllowed.ok, true, "administrators pass the role guard");

  // --- Student-ID (username) sign-in ------------------------------------------
  const studentId = `S${Date.now().toString().slice(-8)}`;
  const usernameSignUp = await auth.handler(
    new Request("http://127.0.0.1:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({
        name: "Username Student",
        email: `${studentId.toLowerCase()}@student.ioniclink.local`,
        password: "Student2026",
        username: studentId,
      }),
    })
  );
  assert.equal(usernameSignUp.status, 200, "student accounts carry a username (student ID)");

  const usernameSignIn = await auth.handler(
    new Request("http://127.0.0.1:3000/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ username: studentId, password: "Student2026" }),
    })
  );
  assert.equal(usernameSignIn.status, 200, "students sign in with their student ID");
  const usernameCookies = (usernameSignIn.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const usernameCookie = usernameCookies.map((value) => value.split(";", 1)[0]).join("; ");
  const usernameSession = await getAppSession(new Headers({ cookie: usernameCookie }));
  assert.equal((usernameSession?.user as { username?: string } | undefined)?.username, studentId.toLowerCase());
  assert.equal(sessionHasAdminRole(usernameSession), false, "username accounts default to student level");

  const signOut = await auth.api.signOut({ headers: sessionHeaders, asResponse: true });
  assert.equal(signOut.status, 200);
  assert.equal(await getAppSession(sessionHeaders), null, "logout revokes the database session immediately");

  console.log("Application authentication tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
