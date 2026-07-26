import type { ReactNode } from "react";

type ErrorPayload = { error?: unknown; message?: unknown };

/** Fetch JSON, turning network, HTTP, and malformed-response failures into user-facing errors. */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  failureMessage: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new Error(`${failureMessage}. Check your connection and try again.`, { cause: error });
  }

  const payload = (await response.json().catch(() => null)) as ErrorPayload | T | null;
  if (!response.ok) {
    const detail = errorDetail(payload);
    throw new Error(detail || `${failureMessage} (HTTP ${response.status}).`);
  }
  if (payload === null) {
    throw new Error(`${failureMessage}: the server returned an unreadable response.`);
  }
  return payload as T;
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function RequestError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
    >
      {children}
    </div>
  );
}

function errorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const { error, message } = payload as ErrorPayload;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof message === "string" && message.trim()) return message;
  return null;
}
