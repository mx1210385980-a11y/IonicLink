import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { createTestAppSession } from "@/lib/auth.test-helpers";
import { GET } from "./route";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ioniclink-afm-source-"));
  const previousRoot = process.env.AFM_CURVE_ROOT;
  try {
    const folder = path.join(root, "26-07-28", "07");
    await mkdir(folder, { recursive: true });
    const expected = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(path.join(folder, "QQ20260730-113643.png"), expected);
    process.env.AFM_CURVE_ROOT = root;
    const { cookie } = await createTestAppSession();
    const response = await GET(new NextRequest("http://localhost/api/afm/source-image?curveId=AFM-26-07-28-07-C001", {
      headers: { cookie, origin: "http://localhost" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);

    const missing = await GET(new NextRequest("http://localhost/api/afm/source-image?curveId=legacy-001", {
      headers: { cookie, origin: "http://localhost" },
    }));
    assert.equal(missing.status, 404);
  } finally {
    if (previousRoot === undefined) delete process.env.AFM_CURVE_ROOT;
    else process.env.AFM_CURVE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
  console.log("AFM source image API tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
