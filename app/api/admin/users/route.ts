import { NextRequest, NextResponse } from "next/server";
import { auth, requireAppApiRole } from "@/lib/auth.server";
import { withUsageAction } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Placeholder domain for student accounts: students sign in by student ID, never by email. */
const STUDENT_EMAIL_DOMAIN = "student.ioniclink.local";
/** Placeholder domain for administrator accounts created with a plain account name. */
const ADMIN_EMAIL_DOMAIN = "admin.ioniclink.local";
/** Default initial password for batch-created student accounts: <studentId>@Njust */
const STUDENT_PASSWORD_SUFFIX = "@Njust";

const MAX_BATCH = 200;

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Accounts are username-style: letters and digits (plus '-'/'_'), never email addresses. */
function validAccountId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{3,30}$/.test(value.trim());
}

const ACCOUNT_ID_RULE = "Accounts must be 3-30 letters, digits, '-' or '_'.";

async function createStudentAccount(studentId: string, password: string, name?: string) {
  // The username plugin matches case-insensitively and stores lowercase; keep
  // the synthetic email lowercase too, displayUsername preserves the original.
  const id = studentId.trim();
  return auth.api.createUser({
    body: {
      email: `${id.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`,
      name: name?.trim() || id,
      password,
      role: "student",
      data: { username: id, displayUsername: id },
    },
  } as unknown as Parameters<typeof auth.api.createUser>[0]);
}

async function createAdminAccount(account: string, password: string, name?: string) {
  const id = account.trim();
  return auth.api.createUser({
    body: {
      email: `${id.toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`,
      // The display name defaults to the account itself; it can be renamed later.
      name: name?.trim() || id,
      password,
      role: "admin",
      data: { username: id, displayUsername: id },
    },
  } as unknown as Parameters<typeof auth.api.createUser>[0]);
}

async function postHandler(request: NextRequest) {
  const access = await requireAppApiRole(request, "admin");
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "Invalid request body.");
  }

  // Batch student creation: only student IDs are required; each account gets
  // the default initial password "<studentId>@Njust".
  if (body.mode === "batch") {
    const rawIds = Array.isArray(body.studentIds) ? body.studentIds : [];
    const studentIds = [...new Set(rawIds.map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (!studentIds.length) return jsonError(400, "Provide at least one student ID.");
    if (studentIds.length > MAX_BATCH) return jsonError(400, `Create at most ${MAX_BATCH} accounts per batch.`);

    const results: Array<{ studentId: string; ok: boolean; error?: string }> = [];
    for (const studentId of studentIds) {
      if (!validAccountId(studentId)) {
        results.push({ studentId, ok: false, error: ACCOUNT_ID_RULE });
        continue;
      }
      try {
        await createStudentAccount(studentId, `${studentId}${STUDENT_PASSWORD_SUFFIX}`);
        results.push({ studentId, ok: true });
      } catch (error) {
        results.push({
          studentId,
          ok: false,
          error: error instanceof Error && /exist|unique/i.test(error.message) ? "Account already exists." : "Creation failed.",
        });
      }
    }
    return NextResponse.json({ results, defaultPasswordHint: `<studentId>${STUDENT_PASSWORD_SUFFIX}` });
  }

  // Single account creation: an administrator or one student. Both sign in
  // with a username-style account (letters/digits); the display name defaults
  // to the account itself.
  if (body.mode === "single") {
    const role = body.role === "admin" ? "admin" : "student";
    const account = String(body.account ?? "").trim();
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");
    if (password.length < 8 || password.length > 128) return jsonError(400, "Passwords must be 8-128 characters.");
    if (!validAccountId(account)) return jsonError(400, ACCOUNT_ID_RULE);

    try {
      if (role === "admin") {
        await createAdminAccount(account, password, name);
      } else {
        await createStudentAccount(account, password, name);
      }
    } catch (error) {
      const message = error instanceof Error && /exist|unique/i.test(error.message) ? "That account already exists." : "Could not create the account.";
      return jsonError(400, message);
    }
    return NextResponse.json({ ok: true });
  }

  return jsonError(400, "Unknown mode.");
}

export function POST(request: NextRequest) {
  return withUsageAction(request, "创建账号", postHandler, request);
}
