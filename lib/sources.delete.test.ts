import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSource, getDataDir, getSource } from "./db";
import { deleteSourceDocument } from "./sources";

async function main() {
  const sourceId = "33333333-3333-4333-8333-333333333333";
  const sourceDir = path.join(getDataDir(), "tribology", "sources", sourceId);
  createSource("tribology", {
    id: sourceId,
    filename: "stored-source.pdf",
    pageCount: 1,
    createdAt: "2026-08-17T00:00:00.000Z",
    pages: [{ page: 1, text: "stored source" }],
  });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "source.pdf"), "%PDF fixture");
  assert.equal(existsSync(sourceDir), true);

  const deleted = await deleteSourceDocument("tribology", sourceId);
  assert.deepEqual(deleted, {
    sourceId,
    filename: "stored-source.pdf",
    deletedJobs: 0,
    deletedJobEvents: 0,
    deletedRecords: 0,
    storedFilesRemoved: true,
  });
  assert.equal(getSource("tribology", sourceId), null);
  assert.equal(existsSync(sourceDir), false, "the stored PDF directory is removed");
  assert.equal(await deleteSourceDocument("tribology", sourceId), null);
  assert.equal(await deleteSourceDocument("tribology", "../outside"), null, "non-UUID paths are rejected");

  console.log("Stored source deletion tests passed");
}

void main();
