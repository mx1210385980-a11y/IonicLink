import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins";
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
        "/sign-up/email": { window: 300, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "ioniclink",
    },
    plugins: [
      admin({
        defaultRole: "user",
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

function validateRuntimeConfig(): void {
  if (configuredSecret && configuredSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (configuredBaseURL) {
    let parsed: URL;
    try {
      parsed = new URL(configuredBaseURL);
    } catch {
      throw new Error("BETTER_AUTH_URL must be a valid absolute URL.");
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("BETTER_AUTH_URL must be an origin without a path, query, or hash.");
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
    }
  }
  if (process.env.NODE_ENV === "production") {
    if (!configuredSecret) throw new Error("BETTER_AUTH_SECRET is required in production.");
    if (!configuredBaseURL) throw new Error("BETTER_AUTH_URL is required in production.");
  }
}

async function ensureBootstrapAdmin(): Promise<void> {
  const email = value("IONICLINK_BOOTSTRAP_EMAIL")?.toLowerCase();
  const password = value("IONICLINK_BOOTSTRAP_PASSWORD");
  const name = value("IONICLINK_BOOTSTRAP_NAME") ?? "IonicLink Administrator";

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
    body: { email, password, name, role: "admin" },
  });
  console.info("[auth-audit]", JSON.stringify({ event: "bootstrap_admin_created" }));
}

export async function ensureAuthReady(): Promise<void> {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      validateRuntimeConfig();
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
  await ensureAuthReady();
  return auth.api.getSession({ headers: requestHeaders });
}

export async function getCurrentAppSession() {
  // Read request state first so static builds bail out before touching runtime auth state.
  const requestHeaders = headers();
  return getAppSession(requestHeaders);
}

export async function requireAppPageSession(nextPath: string) {
  const requestHeaders = headers();
  const session = await getAppSession(requestHeaders);
  if (!session) {
    const next = safeAuthRedirect(requestHeaders.get("x-ioniclink-request-path") ?? nextPath);
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return session;
}

type AppApiAccess =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getAppSession>>> }
  | { ok: false; response: NextResponse };

function crossOriginResponse(request: Request): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const requestOrigin = new URL(request.url).origin;
    const suppliedOrigin = new URL(origin).origin;
    if (suppliedOrigin === requestOrigin || suppliedOrigin === authBaseURL) return null;
  } catch {
    // Invalid origins are rejected below.
  }
  return NextResponse.json({ error: "请求来源校验失败。" }, { status: 403 });
}

export async function requireAppApiSession(request: Request): Promise<AppApiAccess> {
  const crossOrigin = crossOriginResponse(request);
  if (crossOrigin) return { ok: false, response: crossOrigin };

  try {
    const session = await getAppSession(request.headers);
    if (!session) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "登录已失效，请重新登录。" },
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
        { error: "登录服务暂时不可用。" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
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
