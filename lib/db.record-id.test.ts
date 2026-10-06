import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { commitDatasetImport, createRecords, getRecord, listRecords, resetAll } from "./db";
import { ingest } from "./ingest";

assert.ok(process.env.IONICLINK_DATA_DIR, "Run with the isolated test runner");
assert.notEqual(path.resolve(process.env.IONICLINK_DATA_DIR!), path.resolve("data"));

const draft = (title: string) => ingest({
  paper: { title }, cation: "[BMIM]", anion: "[PF6]", substrate: "mica",
  temperature: "298 K", load: "5 nN", cof: 0.12,
});

type Reply = { phase: string; ids: string[] };

function reply(child: ChildProcess, phase: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Worker timed out waiting for ${phase}`)), 30_000);
    const onMessage = (message: Reply) => {
      if (message.phase === phase) finish(undefined, message);
    };
    const onExit = (code: number | null) => finish(new Error(`Worker exited (${code}) before ${phase}`));
    const onError = (error: Error) => finish(error);
    function finish(error?: Error, message?: Reply) {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve(message!);
    }
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--fresh") {
    const created = createRecords("tribology", [draft("Fresh process above 1000")]);
    process.send!({ phase: "done", ids: created.map((r) => r.id) }, () => process.disconnect());
    return;
  }
  if (mode === "--worker") {
    const name = process.argv[3];
    const primed = createRecords("tribology", [draft(`${name} prime`)]);
    process.once("message", () => {
      const drafts = Array.from({ length: 20 }, (_, i) => draft(`${name} batch ${i}`));
      const ids = name === "dataset"
        ? commitDatasetImport("tribology", {
            fingerprint: "concurrent-record-id-test", filename: "fixture.json", adapter: "test", drafts,
          }).recordIds
        : createRecords("tribology", drafts).map((r) => r.id);
      process.send!({ phase: "done", ids }, () => process.disconnect());
    });
    process.send!({ phase: "ready", ids: primed.map((r) => r.id) });
    return;
  }

  resetAll("tribology");
  const [first, second] = createRecords("tribology", [draft("Boundary 999"), draft("Boundary 1000")]);
  const fixtureDb = new Database(path.join(process.env.IONICLINK_DATA_DIR!, "tribology.db"));
  for (const [record, id] of [[first, "#999"], [second, "#1000"]] as const) {
    fixtureDb.prepare("UPDATE records SET id = ?, payload = ? WHERE id = ?")
      .run(id, JSON.stringify({ ...record, id }), record.id);
  }
  fixtureDb.close();

  const children: ChildProcess[] = [];
  const start = (...args: string[]) => {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), ...args], {
      env: process.env, stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true,
    });
    children.push(child);
    return child;
  };
  try {
    const fresh = await reply(start("--fresh"), "done");
    assert.deepEqual(fresh.ids, ["#1001"], "fresh processes use numeric maximum, not lexical #999");
    assert.equal(getRecord("tribology", "#1000")?.paper.title, "Boundary 1000");

    // Both processes write once before either batch starts, reproducing stale
    // per-process counters as well as concurrent ordinary/dataset imports.
    const ordinary = start("--worker", "ordinary");
    const ordinaryReady = await reply(ordinary, "ready");
    const dataset = start("--worker", "dataset");
    const datasetReady = await reply(dataset, "ready");
    assert.deepEqual(ordinaryReady.ids, ["#1002"]);
    assert.deepEqual(datasetReady.ids, ["#1003"]);
    const completed = Promise.all([reply(ordinary, "done"), reply(dataset, "done")]);
    ordinary.send("go");
    dataset.send("go");
    const batches = await completed;
    const ids = batches.flatMap((result) => result.ids);
    assert.equal(ids.length, 40);
    assert.equal(new Set(ids).size, 40, "concurrent processes allocate distinct IDs");
    assert.deepEqual(ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      Array.from({ length: 40 }, (_, i) => `#${1004 + i}`));
    const stored = listRecords("tribology");
    assert.equal(stored.length, 45, "all existing and concurrently created records survive");
    assert.equal(new Set(stored.map((record) => record.paper.title)).size, 45);
    assert.equal(getRecord("tribology", "#999")?.paper.title, "Boundary 999");
    assert.equal(getRecord("tribology", "#1000")?.paper.title, "Boundary 1000");
    console.log("Record ID boundary and concurrent process tests passed");
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
