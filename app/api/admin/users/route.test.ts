import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { auth, getAppSession, sessionHasAdminRole } from "@/lib/auth.server";
import { createTestAdminSession, createTestAppSession } from "@/lib/auth.test-helpers";

function request(body: unknown, cookie: string | null) {
  return new NextRequest("http://localhost/api/admin/users", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function signInUsername(username: string, password: string) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ username, password }),
    })
  );
}

async function main() {
  const suffix = `${process.pid}${Date.now().toString().slice(-6)}`;
  const idOne = `B${suffix}01`;
  const idTwo = `B${suffix}02`;

  // Access control: anonymous and student callers are rejected.
  assert.equal((await POST(request({ mode: "batch", studentIds: [idOne] }, null))).status, 401);
  const student = await createTestAppSession();
  assert.equal((await POST(request({ mode: "batch", studentIds: [idOne] }, student.cookie))).status, 403);

  const admin = await createTestAdminSession();

  // Batch creation: valid IDs get accounts, malformed IDs are reported inline.
  const batch = await POST(request({ mode: "batch", studentIds: [idOne, idTwo, "bad id!!", idOne] }, admin.cookie));
  assert.equal(batch.status, 200);
  const payload = (await batch.json()) as { results: Array<{ studentId: string; ok: boolean; error?: string }> };
  assert.deepEqual(
    payload.results.map((result) => [result.studentId, result.ok]),
    [[idOne, true], [idTwo, true], ["bad id!!", false]]
  );

  // The default password is "<studentId>@Njust", the role is student-level,
  // and the display name defaults to the account itself.
  const signIn = await signInUsername(idOne, `${idOne}@Njust`);
  assert.equal(signIn.status, 200, "batch-created students sign in with the default password");
  const setCookies = (signIn.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  const session = await getAppSession(new Headers({ cookie }));
  assert.equal(sessionHasAdminRole(session), false);
  assert.equal(session?.user.name, idOne, "student display names default to the account");

  // Recreating the same ID fails per-row without failing the batch.
  const duplicate = await POST(request({ mode: "batch", studentIds: [idOne] }, admin.cookie));
  const duplicatePayload = (await duplicate.json()) as { results: Array<{ ok: boolean; error?: string }> };
  assert.equal(duplicatePayload.results[0].ok, false);
  assert.match(duplicatePayload.results[0].error ?? "", /already exists/i);

  // Single administrator creation: username-style account + password, role
  // admin, display name defaulting to the account.
  const adminAccount = `A${suffix}`;
  const created = await POST(
    request({ mode: "single", role: "admin", account: adminAccount, password: "Admin2026x" }, admin.cookie)
  );
  assert.equal(created.status, 200);
  const adminSignIn = await signInUsername(adminAccount, "Admin2026x");
  assert.equal(adminSignIn.status, 200, "created administrators sign in with their account");
  const adminCookies = (adminSignIn.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const adminSession = await getAppSession(new Headers({ cookie: adminCookies.map((value) => value.split(";", 1)[0]).join("; ") }));
  assert.equal(sessionHasAdminRole(adminSession), true);
  assert.equal(adminSession?.user.name, adminAccount, "administrator display names default to the account");

  // Validation failures.
  assert.equal(
    (await POST(request({ mode: "single", role: "admin", account: "bad account!!", password: "Admin2026x" }, admin.cookie))).status,
    400
  );
  assert.equal(
    (await POST(request({ mode: "single", role: "student", account: "ab", password: "Student2026x" }, admin.cookie))).status,
    400
  );

  console.log("Admin user-management API route tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
