import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import {
  backfillStructureKeys,
  createRecords,
  deleteRecords,
  getDataDir,
  listRecords,
} from "./db";
import { ingest } from "./ingest";
import { canonicalStructureKey } from "./structureSearch.server";
import type { ExactStructureFilter, StructureSearchTarget } from "./structureSearch";

assert.ok(
  process.env.IONICLINK_DATA_DIR,
  "DB structure-search tests require the isolated IONICLINK_DATA_DIR supplied by the test runner"
);

const MARK = "__STRUCTURE_SEARCH_MARKER__";
const REVIEW_CATION_TITLE = `${MARK}-alpha-review-cation`;
const REVIEW_OTHER_TITLE = `${MARK}-alpha-review-other`;
const REVIEW_ANION_TITLE = `${MARK}-beta-review-anion`;
const OFFICIAL_CATION_TITLE = `${MARK}-alpha-official-cation`;
const QUERY_SMILES = "CC[NH3+]";
const OTHER_CATION_SMILES = "C[N+](C)(C)C";
const OTHER_ANION_SMILES = "[B-](F)(F)(F)F";

const draft = (title: string, cationSmiles: string, anionSmiles: string) =>
  ingest({
    paper: { title },
    cation: "[StructureFixtureCation]",
    anion: "[StructureFixtureAnion]",
    cationSmiles,
    anionSmiles,
    substrate: "StructureFixtureSurface",
    temperature: "300 K",
    load: "5 nN",
    cof: 0.25,
  });

const reviewRecords = createRecords(
  "tribology",
  [
    draft(REVIEW_CATION_TITLE, QUERY_SMILES, OTHER_ANION_SMILES),
    draft(REVIEW_OTHER_TITLE, OTHER_CATION_SMILES, OTHER_ANION_SMILES),
    draft(REVIEW_ANION_TITLE, OTHER_CATION_SMILES, QUERY_SMILES),
  ],
  "review"
);
const [officialCation] = createRecords(
  "tribology",
  [draft(OFFICIAL_CATION_TITLE, QUERY_SMILES, OTHER_ANION_SMILES)],
  "official"
);
const made = [...reviewRecords, officialCation];
const queryKey = canonicalStructureKey(QUERY_SMILES);
const filter = (target: StructureSearchTarget): ExactStructureFilter => ({ key: queryKey, target });

try {
  assert.deepEqual(
    listRecords("tribology", { structure: filter("any") }).map((record) => record.id),
    [reviewRecords[0].id, reviewRecords[2].id, officialCation.id],
    "target=any matches the structure in either ion position"
  );
  assert.deepEqual(
    listRecords("tribology", { structure: filter("cation") }).map((record) => record.id),
    [reviewRecords[0].id, officialCation.id],
    "target=cation only matches cation structure keys"
  );
  assert.deepEqual(
    listRecords("tribology", { structure: filter("anion") }).map((record) => record.id),
    [reviewRecords[2].id],
    "target=anion only matches anion structure keys"
  );

  assert.deepEqual(
    listRecords("tribology", {
      status: "review",
      search: `${MARK}-alpha`,
      structure: filter("any"),
    }).map((record) => record.id),
    [reviewRecords[0].id],
    "structure, status, and text filters compose with AND semantics"
  );

  const sqlite = new Database(path.join(getDataDir(), "tribology.db"));
  try {
    sqlite
      .prepare(
        "UPDATE records SET cation_structure_key = NULL, anion_structure_key = NULL WHERE id = ?"
      )
      .run(reviewRecords[0].id);
  } finally {
    sqlite.close();
  }

  assert.deepEqual(
    listRecords("tribology", {
      search: REVIEW_CATION_TITLE,
      structure: filter("cation"),
    }),
    [],
    "a legacy row with an empty structure key is not falsely matched"
  );

  const firstBackfill = backfillStructureKeys("tribology");
  assert.equal(firstBackfill.updated, 1, "backfill restores the cleared row");
  assert.deepEqual(firstBackfill.unindexed, [], "all fixture ions can be indexed");
  assert.deepEqual(
    listRecords("tribology", {
      search: REVIEW_CATION_TITLE,
      structure: filter("cation"),
    }).map((record) => record.id),
    [reviewRecords[0].id],
    "the restored structure key is immediately searchable"
  );

  const secondBackfill = backfillStructureKeys("tribology");
  assert.equal(secondBackfill.updated, 0, "a second backfill is idempotent");
  assert.deepEqual(
    secondBackfill,
    { ...firstBackfill, updated: 0 },
    "idempotent backfill preserves coverage accounting"
  );

  console.log("DB exact structure-search tests passed");
} finally {
  deleteRecords(
    "tribology",
    made.map((record) => record.id)
  );
}
