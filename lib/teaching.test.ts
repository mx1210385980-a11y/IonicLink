import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  TEACHING_FIELDS,
  addTeachingPaper,
  calculateTeachingMetrics,
  closeTeachingDatabaseForTests,
  createTeachingProject,
  getStudentWorkspace,
  getTeachingAdminDashboard,
  joinTeachingProject,
  reviewTeachingSubmission,
  saveStudentDraft,
  submitStudentWork,
} from "./teaching";
import { teachingRowsToCsv } from "./teachingCsv";

const dataDir = path.resolve(process.env.IONICLINK_DATA_DIR!);
mkdirSync(dataDir, { recursive: true });

function fixtureDb(domain: string) {
  const store = new Database(path.join(dataDir, `${domain}.db`));
  store.exec(`
    CREATE TABLE records (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE sources (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  const record = {
    id: "#001",
    status: "official",
    createdAt: "2026-01-01T00:00:00.000Z",
    paper: { title: `${domain} fixture`, doi: "10.0000/fixture", journal: "Fixture Journal" },
    core: {
      ionicLiquid: { cation: "[BMIM]", anion: "[BF4]" },
      substrate: "HOPG",
      temperature: { raw: "298.15 K", value: 298.15, unit: "K" },
      load: { raw: "10 nN", value: 1e-8, unit: "N" },
      cof: 0.12,
    },
    extraction: { model: "fixture-model" },
  };
  store
    .prepare("INSERT INTO records VALUES (?, 'official', ?, ?)")
    .run("#001", record.createdAt, JSON.stringify(record));
  if (domain === "tribology") {
    store
      .prepare("INSERT INTO records VALUES (?, 'official', ?, ?)")
      .run("#002", record.createdAt, JSON.stringify({ ...record, id: "#002" }));
  }
  store.prepare("INSERT INTO sources VALUES ('source-1', ?)").run(JSON.stringify({ fixture: domain }));
  store.prepare("INSERT INTO jobs VALUES ('job-1', 'committed', ?)").run(JSON.stringify({ fixture: domain }));
  store.close();
}

for (const domain of ["tribology", "conductivity", "diffusion"]) fixtureDb(domain);

function businessHash(domain: string): string {
  const store = new Database(path.join(dataDir, `${domain}.db`), { readonly: true });
  const rows = {
    records: store.prepare("SELECT * FROM records ORDER BY id").all(),
    sources: store.prepare("SELECT * FROM sources ORDER BY id").all(),
    jobs: store.prepare("SELECT * FROM jobs ORDER BY id").all(),
  };
  assert.equal(store.pragma("quick_check", { simple: true }), "ok");
  store.close();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const before = Object.fromEntries(
  ["tribology", "conductivity", "diffusion"].map((domain) => [domain, businessHash(domain)])
);

const projectId = createTeachingProject({ name: "课改测试", inviteCode: "CLASS2026" });
const paperId = addTeachingPaper({
  projectId,
  recordId: "#001",
  paperNo: "03",
  sourceUrl: "https://doi.org/10.0000/fixture",
});
assert.equal(
  addTeachingPaper({
    projectId,
    recordId: "#001",
    paperNo: "03",
    sourceUrl: "https://doi.org/10.0000/fixture",
  }),
  paperId,
  "repeating the same paper configuration should be idempotent"
);
assert.throws(
  () =>
    addTeachingPaper({
      projectId,
      recordId: "#002",
      paperNo: "03",
      sourceUrl: "https://doi.org/10.0000/fixture",
    }),
  /文献编号 03 已经使用，请换一个编号/,
  "reusing a paper number for a different source should have a friendly error"
);
const joined = joinTeachingProject({
  inviteCode: "class2026",
  groupCode: "第 1 组",
  studentAlias: "S001",
});
const workspace = getStudentWorkspace(joined.participantId);
assert.ok(workspace);
assert.equal(workspace.paper.paperNo, "03");
assert.equal("aiSnapshot" in workspace, false, "student payload must never expose AI answers");

const answers = Object.fromEntries(
  TEACHING_FIELDS.map((field) => [field.key, { value: `${field.label} answer`, page: "5" }])
);
const saved = saveStudentDraft(joined.participantId, 0, answers);
assert.equal(saved.version, 1);
const submitted = submitStudentWork(joined.participantId);
assert.match(submitted.submittedAt, /^20/);

let dashboard = getTeachingAdminDashboard(projectId);
assert.equal(dashboard.officialRecords.length, 1, "the same paper should only appear once");
assert.equal(dashboard.officialRecords[0].id, "#002", "the newest record should represent the paper");
assert.equal(dashboard.rows.length, 1);
assert.equal(dashboard.rows[0].metrics.humanCoverage, 1);
assert.equal(dashboard.rows[0].metrics.aiCoverage, 1);
reviewTeachingSubmission(
  dashboard.rows[0].submissionId,
  Object.fromEntries(TEACHING_FIELDS.map((field) => [field.key, "correct"])),
  Object.fromEntries(TEACHING_FIELDS.map((field) => [field.key, "correct"]))
);
dashboard = getTeachingAdminDashboard(projectId);
assert.equal(dashboard.rows[0].metrics.humanAccuracy, 1);
assert.equal(dashboard.rows[0].metrics.aiAccuracy, 1);
assert.equal(dashboard.rows[0].status, "reviewed");

const csv = teachingRowsToCsv(dashboard.rows);
assert.ok(csv.startsWith("\uFEFF"));
assert.match(csv, /人工覆盖率/);
assert.match(csv, /100\.0%/);

for (const domain of ["tribology", "conductivity", "diffusion"]) {
  assert.equal(businessHash(domain), before[domain], `${domain} business data changed`);
}
assert.ok(existsSync(path.join(dataDir, "teaching.db")));

const emptyMetrics = calculateTeachingMetrics(TEACHING_FIELDS, {}, {}, {}, {});
assert.equal(emptyMetrics.humanAccuracy, null);
assert.equal(emptyMetrics.aiAccuracy, null);
assert.equal(emptyMetrics.humanCoverage, 0);

closeTeachingDatabaseForTests();
console.log("Teaching workflow and database isolation tests passed");
