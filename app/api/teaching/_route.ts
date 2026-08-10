import { NextRequest, NextResponse } from "next/server";

export const MAX_TEACHING_REQUEST_BYTES = 64 * 1024;

export class TeachingRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413
  ) {
    super(message);
    this.name = "TeachingRequestError";
  }
}

export async function readTeachingJson(
  request: NextRequest,
  maxBytes = MAX_TEACHING_REQUEST_BYTES
): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new TeachingRequestError("请求长度无效。", 400);
    }
    if (declaredBytes > maxBytes) {
      throw new TeachingRequestError("请求内容过大。", 413);
    }
  }

  if (!request.body) throw new TeachingRequestError("请求体必须是 JSON。", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TeachingRequestError("请求内容过大。", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new TeachingRequestError("请求体必须是有效 JSON。", 400);
  }
}

export function teachingRequestErrorResponse(error: unknown): NextResponse | null {
  return error instanceof TeachingRequestError
    ? NextResponse.json({ error: error.message }, { status: error.status })
    : null;
}

export function internalTeachingErrorResponse(
  context: string,
  error: unknown,
  options: { status?: 500 | 503; message: string }
): NextResponse {
  console.error(`[teaching] ${context}`, error);
  return NextResponse.json(
    { error: options.message },
    { status: options.status ?? 500 }
  );
}
