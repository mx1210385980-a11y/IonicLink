import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin, username } from "better-auth/plugins";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { safeAuthRedirect } from "./auth-redirect";

const DEV_SECRET = "ioniclink-local-development-only-secret-2026";
const DEV_BASE_URL = "http://localhost:3000";
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function value(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

const configuredSecret = value("BETTER_AUTH_SECRET");
const configuredBaseURL = value("BETTER_AUTH_URL");
const authSecret = configuredSecret ?? DEV_SECRET;

export function isAppAuthEnabled(): boolean {
  return Boolean(configuredSecret && configuredBaseURL);
}

function resolvedBaseURL(): string {
  if (!configuredBaseURL) return DEV_BASE_URL;
  try {
    return new URL(configuredBaseURL).origin;
  } catch {
    return DEV_BASE_URL;
  }
}

const authBaseURL = resolvedBaseURL();

function authTrustedOrigins(): string[] {
  const origins = new Set([authBaseURL]);
  if (process.env.NODE_ENV === "production") return [...origins];

  const configured = new URL(authBaseURL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)) return [...origins];

  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const loopback = new URL(authBaseURL);
    loopback.hostname = hostname;
    origins.add(loopback.origin);
  }
  return [...origins];
}

export function isSelfRegistrationEnabled(): boolean {
  if (!isAppAuthEnabled()) return false;
  const configured = value("IONICLINK_ALLOW_SIGNUP");
  if (configured) return configured.toLowerCase() === "true";
  return process.env.NODE_ENV !== "production";
}

export function authDatabasePath(): string {
  const dataDir = path.resolve(value("IONICLINK_DATA_DIR") ?? path.join(process.cwd(), "data"));
  return path.join(dataDir, "auth.db");
}

function openAuthDatabase(): Database.Database {
  const databasePath = authDatabasePath();
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 30000");
  return database;
}

type AuthGlobals = typeof globalThis & {
  __ionicLinkAuthDatabase?: Database.Database;
  __ionicLinkAuth?: ReturnType<typeof createAuth>;
};

const authGlobals = globalThis as AuthGlobals;
const authDatabase = authGlobals.__ionicLinkAuthDatabase ?? openAuthDatabase();

function createAuth() {
  return betterAuth({
    appName: "IonicLink",
    baseURL: authBaseURL,
    secret: authSecret,
    trustedOrigins: authTrustedOrigins(),
    database: authDatabase,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !isSelfRegistrationEnabled(),
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-in/username": { window: 60, max: 5 },
        "/sign-up/email": { window: 300, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "ioniclink",
    },
    plugins: [
      // Student accounts sign in with their student ID as the username; no email
      // is exposed to them (a synthetic placeholder email is stored internally).
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
      }),
      admin({
        defaultRole: "student",
        adminRoles: ["admin"],
      }),
    ],
  });
}

export const auth = authGlobals.__ionicLinkAuth ?? createAuth();

if (process.env.NODE_ENV !== "production") {
  authGlobals.__ionicLinkAuthDatabase = authDatabase;
  authGlobals.__ionicLinkAuth = auth;
}

let authReadyPromise: Promise<void> | null = null;

function isPrivateNetworkHost(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname.startsWith("[")) {
    // IPv6 literals: loopback, link-local, and unique-local addresses are private.
    return (
      hostname === "[::1]" ||
      hostname.startsWith("[fe80:") ||
      hostname.startsWith("[fc") ||
      hostname.startsWith("[fd")
    );
  }
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = octets.map(Number);
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // link-local
  );
}

/**
 * Explicit opt-out for trusted networks whose addresses are not RFC 1918 (some
 * campuses assign publicly-routable ranges internally, e.g. 192.10.x.x). When
 * set, plain HTTP origins are accepted in production. Session cookies then
 * travel unencrypted, so this must only be used on a trusted internal network.
 */
function allowInsecureHttpOrigin(): boolean {
  return value("IONICLINK_ALLOW_INSECURE_HTTP")?.toLowerCase() === "true";
}

function validateRuntimeConfig(): void {
  const configurationStarted = Boolean(configuredSecret || configuredBaseURL);
  if (!configurationStarted) return;

  if (!configuredSecret) {
    throw new Error("BETTER_AUTH_SECRET is required when application authentication is enabled.");
  }
  if (configuredSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (!configuredBaseURL) {
    throw new Error("BETTER_AUTH_URL is required when application authentication is enabled.");
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredBaseURL);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid absolute URL.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("BETTER_AUTH_URL must be an origin without a path, query, or hash.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:" &&
    !isPrivateNetworkHost(parsed)
  ) {
    if (!allowInsecureHttpOrigin()) {
      throw new Error(
        "BETTER_AUTH_URL must use HTTPS in production unless it targets a loopback or private-network address. " +
          "For trusted internal networks with publicly-routable addresses, set IONICLINK_ALLOW_INSECURE_HTTP=true."
      );
    }
    console.warn(
      "[auth] IONICLINK_ALLOW_INSECURE_HTTP is enabled: credentials and session cookies travel " +
        "unencrypted. Only use this on a trusted internal network."
    );
  }
}

async function ensureBootstrapAdmin(): Promise<void> {
  const email = value("IONICLINK_BOOTSTRAP_EMAIL")?.toLowerCase();
  const password = value("IONICLINK_BOOTSTRAP_PASSWORD");
  const name = value("IONICLINK_BOOTSTRAP_NAME") ?? "IonicLink Administrator";
  // Optional: lets the bootstrap administrator sign in with a username
  // (e.g. a numeric ID) instead of the synthetic email.
  const username = value("IONICLINK_BOOTSTRAP_USERNAME");

  if (Boolean(email) !== Boolean(password)) {
    throw new Error("IONICLINK_BOOTSTRAP_EMAIL and IONICLINK_BOOTSTRAP_PASSWORD must be set together.");
  }

  const userCount = authDatabase.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number };
  if (!email || !password) {
    if (process.env.NODE_ENV === "production" && !isSelfRegistrationEnabled() && userCount.count === 0) {
      throw new Error("No application user exists. Configure the bootstrap administrator before deployment.");
    }
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `IONICLINK_BOOTSTRAP_PASSWORD must contain ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`
    );
  }

  const existing = authDatabase
    .prepare('SELECT id FROM "user" WHERE lower(email) = lower(?) LIMIT 1')
    .get(email) as { id: string } | undefined;
  if (existing) return;

  await auth.api.createUser({
    body: {
      email,
      password,
      name,
      role: "admin",
      ...(username ? { data: { username, displayUsername: username } } : {}),
    },
  } as unknown as Parameters<typeof auth.api.createUser>[0]);
  console.info("[auth-audit]", JSON.stringify({ event: "bootstrap_admin_created" }));
}

/**
 * SQLite cannot ALTER TABLE ... ADD COLUMN with a UNIQUE constraint, which is
 * what better-auth's migration generates when the username plugin meets an
 * existing user table. Add the columns as nullable TEXT first (SQLite unique
 * indexes allow multiple NULLs, matching the plugin's optional-username
 * semantics); the regular migration diff then sees them as present.
 */
function ensureUsernameColumns(): void {
  const table = authDatabase
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'")
    .get() as { name: string } | undefined;
  if (!table) return;

  const columns = authDatabase.prepare('PRAGMA table_info("user")').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  const added: string[] = [];
  if (!names.has("username")) {
    authDatabase.exec('ALTER TABLE "user" ADD COLUMN username TEXT');
    added.push("username");
  }
  if (!names.has("displayUsername")) {
    authDatabase.exec('ALTER TABLE "user" ADD COLUMN displayUsername TEXT');
    added.push("displayUsername");
  }
  authDatabase.exec('CREATE UNIQUE INDEX IF NOT EXISTS "user_username_unique" ON "user" (username)');
  if (added.length) {
    console.info("[auth-audit]", JSON.stringify({ event: "username_columns_added", columns: added }));
  }
}

export async function ensureAuthReady(): Promise<void> {
  validateRuntimeConfig();
  if (!isAppAuthEnabled()) return;

  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      ensureUsernameColumns();
      const migrations = await getMigrations(auth.options);
      if (migrations.toBeCreated.length || migrations.toBeAdded.length) {
        await migrations.runMigrations();
        console.info(
          "[auth-audit]",
          JSON.stringify({
            event: "schema_migrated",
            created: migrations.toBeCreated.map((item) => item.table),
            altered: migrations.toBeAdded.map((item) => item.table),
          })
        );
      }
      await ensureBootstrapAdmin();
    })().catch((error) => {
      authReadyPromise = null;
      throw error;
    });
  }
  return authReadyPromise;
}

export async function getAppSession(requestHeaders: Headers) {
  if (!isAppAuthEnabled()) return null;
  await ensureAuthReady();
  return auth.api.getSession({ headers: requestHeaders });
}

export async function getCurrentAppSession() {
  // Read request state first so static builds bail out before touching runtime auth state.
  const requestHeaders = headers();
  return getAppSession(requestHeaders);
}

export async function requireAppPageSession(nextPath: string) {
  if (!isAppAuthEnabled()) return null;
  const requestHeaders = headers();
  const session = await getAppSession(requestHeaders);
  if (!session) {
    const next = safeAuthRedirect(requestHeaders.get("x-ioniclink-request-path") ?? nextPath);
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return session;
}

export type AppSession = NonNullable<Awaited<ReturnType<typeof getAppSession>>>;

/** Only the "admin" role is privileged; everything else (student, legacy "user") is student-level. */
export function sessionHasAdminRole(session: AppSession | null): boolean {
  const role = session?.user?.role;
  if (!role) return false;
  return role
    .split(",")
    .map((part) => part.trim())
    .includes("admin");
}

export async function requireAppPageRole(nextPath: string, role: "admin") {
  const session = await requireAppPageSession(nextPath);
  if (session && role === "admin" && !sessionHasAdminRole(session)) {
    redirect("/");
  }
  return session;
}

type AppApiAccess =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getAppSession>>> | null }
  | { ok: false; response: NextResponse };

function crossOriginResponse(request: Request): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Request origin validation failed." }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedURL = new URL(origin);
    const suppliedOrigin = suppliedURL.origin;
    if (suppliedOrigin === requestOrigin || suppliedOrigin === authBaseURL) return null;

    // In public compatibility mode, a reverse proxy may expose the app on a
    // public Host while Next.js still reports the internal container URL.
    const requestHost = request.headers.get("host")?.split(",")[0]?.trim().toLowerCase();
    if (!isAppAuthEnabled() && requestHost && suppliedURL.host.toLowerCase() === requestHost) {
      return null;
    }
  } catch {
    // Invalid origins are rejected below.
  }
  return NextResponse.json({ error: "Request origin validation failed." }, { status: 403 });
}

export async function requireAppApiSession(request: Request): Promise<AppApiAccess> {
  const crossOrigin = crossOriginResponse(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };
  if (!isAppAuthEnabled()) return { ok: true, session: null };

  try {
    const session = await getAppSession(request.headers);
    if (!session) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Your session has expired. Please sign in again." },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        ),
      };
    }
    return { ok: true, session };
  } catch (error) {
    console.error("[auth] session validation failed", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign-in is temporarily unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
}

/**
 * Read-tier guard: cross-origin check plus best-effort session resolution.
 * Anonymous visitors get `{ ok: true, session: null }` (even when auth is
 * enabled) so public read routes can serve official-only data. Note the
 * ambiguity with public compatibility mode (auth disabled), which also yields
 * a null session — callers that need to distinguish must check
 * `isAppAuthEnabled()` themselves.
 */
export async function getOptionalApiSession(request: Request): Promise<AppApiAccess> {
  const crossOrigin = crossOriginResponse(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };
  if (!isAppAuthEnabled()) return { ok: true, session: null };

  try {
    const session = await getAppSession(request.headers);
    return { ok: true, session };
  } catch (error) {
    console.error("[auth] session validation failed", error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign-in is temporarily unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
}

/** Write-tier guard for administrator-only actions (approve-to-official, delete, import). */
export async function requireAppApiRole(request: Request, role: "admin"): Promise<AppApiAccess> {
  const access = await requireAppApiSession(request);
  if (!access.ok) return access;
  if (!access.session) return access; // public compatibility mode: no roles exist
  if (role === "admin" && !sessionHasAdminRole(access.session)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This action requires an administrator account." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
  return access;
}

export function auditAuthResponse(request: Request, response: Response): void {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "") || "/";
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  console.info(
    "[auth-audit]",
    JSON.stringify({
      event: "auth_request",
      at: new Date().toISOString(),
      action: path,
      method: request.method,
      status: response.status,
      ip: forwardedFor || null,
    })
  );
}
