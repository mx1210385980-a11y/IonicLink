/** Bound multipart streams before parsing, including requests without Content-Length. */
export async function readLiveForm(request: Request, maxFileBytes: number): Promise<FormData> {
  const limit = maxFileBytes + 65536;
  const tooLarge = () => Object.assign(new Error(`Upload exceeds ${Math.round(maxFileBytes / 1024 / 1024)} MB.`), { status: 413 });
  if (Number(request.headers.get("content-length")) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Select an upload file.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
}
