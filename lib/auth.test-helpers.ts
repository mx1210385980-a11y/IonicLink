import { auth, ensureAuthReady } from "./auth.server";

const TEST_EMAIL = `route-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ioniclink.test`;
const TEST_PASSWORD = "Test2026";

type TestSession = {
  cookie: string;
  email: string;
  password: string;
  setCookies: string[];
};

let sessionPromise: Promise<TestSession> | null = null;

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie")].filter((value): value is string => Boolean(value));
}

export function createTestAppSession(): Promise<TestSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      await ensureAuthReady();
      const response = await auth.api.signUpEmail({
        body: {
          name: "Route Test User",
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        },
        asResponse: true,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Could not create the test account (HTTP ${response.status})${detail ? `: ${detail}` : "."}`);
      }
      const setCookies = responseCookies(response);
      const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
      if (!cookie) throw new Error("The test login did not return a session cookie.");
      return { cookie, email: TEST_EMAIL, password: TEST_PASSWORD, setCookies };
    })();
  }
  return sessionPromise;
}
