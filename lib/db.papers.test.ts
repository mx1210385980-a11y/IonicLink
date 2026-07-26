import assert from "node:assert/strict";
import { createRecords, deleteRecords, listPapers, listRecords } from "./db";
import { ingest as triboIngest } from "./ingest";

/**
 * Locks the source-filter contract behind the database view's source picker:
 * `listRecords({paper})` returns only that paper's records, and `listPapers`
 * reports each source with its per-queue record count.
 *
 * Non-destructive: creates marker records, asserts, deletes them in finally.
 */
const MARK = "__PAPER_FILTER_MARKER__";
const PAPER_A = MARK + "-A";
const PAPER_B = MARK + "-B";

const fields = (title: string) => ({
  paper: { title },
  cation: "[ZtestM]",
  anion: "[Ztest]",
  substrate: "TestSurface",
  temperature: "300 K",
  load: "5 nN",
  cof: 0.5,
});

const made = createRecords(
  "tribology",
  [fields(PAPER_A), fields(PAPER_B), fields(PAPER_B)].map((f) => triboIngest(f)),
  "review"
);

try {
  // paper filter returns exactly that source's records
  const onlyA = listRecords("tribology", { status: "review", paper: PAPER_A });
  assert.equal(onlyA.length, 1, "paper filter: one record for source A");
  assert.ok(onlyA.every((r) => r.paper.title === PAPER_A), "paper filter: only A's records");

  const onlyB = listRecords("tribology", { status: "review", paper: PAPER_B });
  assert.equal(onlyB.length, 2, "paper filter: two records for source B");
  assert.ok(onlyB.every((r) => r.paper.title === PAPER_B), "paper filter: only B's records");

  // paper filter composes with the other clauses (search)
  const searched = listRecords("tribology", { status: "review", paper: PAPER_B, search: "[ZtestM]" });
  assert.equal(searched.length, 2, "paper filter composes with search");

  // listPapers reports each source with its count, scoped to the queue
  const reviewPapers = listPapers("tribology", "review");
  assert.equal(reviewPapers.find((p) => p.title === PAPER_A)?.n, 1, "listPapers counts source A");
  assert.equal(reviewPapers.find((p) => p.title === PAPER_B)?.n, 2, "listPapers counts source B");

  const officialPapers = listPapers("tribology", "official");
  assert.ok(
    !officialPapers.some((p) => p.title === PAPER_A || p.title === PAPER_B),
    "listPapers scopes to the requested status"
  );

  console.log("DB paper filter tests passed");
} finally {
  deleteRecords(
    "tribology",
    made.map((r) => r.id)
  );
}
