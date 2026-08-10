# Zero-Configuration Teaching Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Implementation status (2026-08-10):** Tasks 1–9 are implemented on the feature branch, and the Task 10 documentation slice is current; Task 10 integration regressions and Task 11 browser verification remain. The unchecked boxes below preserve the original TDD execution script and expected red/green checkpoints.

**Goal:** Build a zero-configuration, two-round crossover experiment that compares manual literature extraction with AI-assisted extraction for 30 students and automatically reports paired speed, accuracy, evidence, and AI-use metrics.

**Architecture:** Keep `lib/teaching.ts` as the compatibility facade while moving new responsibilities into focused `lib/teaching/*` modules. A checked-in immutable experiment configuration bootstraps a default SQLite project, two papers, gold rules, and frozen AI suggestions; submissions carry round/mode state, and pure scoring/analytics modules drive both the dashboard and CSV export.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.7, better-sqlite3, Node `assert` tests through `scripts/run-tests.mjs`, Tailwind CSS, server-rendered SVG/CSS charts.

---

## File map

New files:

- `config/teaching/default-experiment.v1.json` — immutable paper pair, task prompts, AI snapshots, gold answers, and scoring rules.
- `lib/teaching/config.ts` — parse, validate, checksum, and bootstrap the default experiment.
- `lib/teaching/store.ts` — own the teaching SQLite connection and run migrations.
- `lib/teaching/migrations.ts` — idempotent schema upgrades that preserve legacy rows.
- `lib/teaching/scoring.ts` — deterministic value/evidence normalization and AI-behavior scoring.
- `lib/teaching/answerComparison.ts` — client-safe answer normalization shared by UI edit markers and AI-behavior scoring.
- `lib/teaching/assignment.ts` — balanced sequence assignment and two-round creation/restoration.
- `lib/teaching/activity.ts` — idempotent heartbeat handling and active-time accumulation.
- `lib/teaching/analytics.ts` — paired summaries, bootstrap intervals, Wilcoxon detail, and quality flags.
- `lib/teaching/config.test.ts`, `migrations.test.ts`, `scoring.test.ts`, `assignment.test.ts`, `activity.test.ts`, `analytics.test.ts` — focused TDD coverage.
- `lib/teaching/testFixtures.ts` — shared SQLite/query and deterministic analysis fixtures used only by teaching tests.
- `components/teaching/TeachingGateway.test.tsx`, `StudentWorkspace.test.tsx`, `TeacherDashboard.test.tsx` — static UI contract tests.
- `components/teaching/studentWorkspaceModel.ts` — pure heartbeat, submit-payload, idle, and answer-comparison helpers.
- `app/api/teaching/_route.ts` — bounded JSON parsing and public-safe teaching error responses.
- `app/api/teaching/teachingRoutes.test.ts` — route-level role, leakage, heartbeat, and transition tests.

Modified files:

- `lib/teachingShared.ts` — client-safe experiment, round, scoring, and dashboard types.
- `lib/teaching.ts` — compatibility facade plus default-experiment service entry points.
- `lib/teaching.test.ts` — preserve legacy behavior and add full two-round integration coverage.
- `lib/teachingCsv.ts`, `lib/teachingCsv.test.ts` — paired export built from the same analytics result.
- `app/api/teaching/session/route.ts` — student login requires only an alias; teacher login remains unchanged.
- `app/api/teaching/student/route.ts` — current-round GET, draft PATCH, heartbeat and submit actions.
- `app/api/teaching/admin/route.ts` — read-only default dashboard plus optional legacy review compatibility.
- `app/api/teaching/admin/export/route.ts` — export paired experiment rows and summary.
- `app/teaching/student/page.tsx`, `app/teaching/admin/page.tsx` — render default experiment state.
- `components/teaching/TeachingGateway.tsx` — single-field student entry and experiment disclosure.
- `components/teaching/StudentWorkspace.tsx` — round-aware manual/AI-assisted workspaces and activity heartbeat.
- `components/teaching/TeacherDashboard.tsx` — zero-setup result dashboard with direct comparisons.

## Task 1: Add the immutable default experiment configuration

**Files:**

- Create: `config/teaching/default-experiment.v1.json`
- Create: `lib/teaching/config.ts`
- Create: `lib/teaching/config.test.ts`
- Modify: `lib/teachingShared.ts`

- [ ] **Step 1: Write the failing configuration test**

Create `lib/teaching/config.test.ts` with these complete assertions:

```ts
import assert from "node:assert/strict";
import { DEFAULT_EXPERIMENT, defaultExperimentChecksum, validateExperimentConfig } from "./teaching/config";
import { TEACHING_FIELDS, type TeachingExperimentConfig } from "./teachingShared";

assert.deepEqual(validateExperimentConfig(DEFAULT_EXPERIMENT), []);
assert.equal(DEFAULT_EXPERIMENT.id, "tribology-crossover-2026-v1");
assert.equal(DEFAULT_EXPERIMENT.papers.length, 2);
assert.equal(DEFAULT_EXPERIMENT.papers[0].code, "A");
assert.equal(DEFAULT_EXPERIMENT.papers[1].code, "B");
for (const paper of DEFAULT_EXPERIMENT.papers) {
  assert.match(paper.sourceUrl, /^https:\/\/www\.mdpi\.com\//);
  assert.ok(paper.taskPrompt.length >= 40);
  assert.deepEqual(Object.keys(paper.aiInitial).sort(), TEACHING_FIELDS.map((field) => field.key).sort());
  assert.deepEqual(Object.keys(paper.gold).sort(), TEACHING_FIELDS.map((field) => field.key).sort());
}
assert.match(defaultExperimentChecksum(), /^[a-f0-9]{64}$/);
assert.equal(
  defaultExperimentChecksum(),
  "a36d0f9be5be402f2510f8919cacd6228e333ad975683e21033ea5acebf1058d",
  "versioned config checksum must not drift"
);

const invalid = structuredClone(DEFAULT_EXPERIMENT);
delete (invalid.papers[0].gold as Partial<typeof invalid.papers[0]["gold"]>).cof;
assert.match(validateExperimentConfig(invalid as TeachingExperimentConfig).join("\n"), /paper A.*cof/i);
console.log("Teaching default experiment config tests passed");
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/config.test.ts`

Expected: FAIL with `Cannot find module './teaching/config'`.

- [ ] **Step 3: Add client-safe experiment types**

Append these types to `lib/teachingShared.ts`:

```ts
export type TeachingMode = "manual" | "ai_assisted";
export type TeachingSequence = "manual_then_ai" | "ai_then_manual";

export type TeachingEvidenceRule = {
  pages: number[];
  anyKeywordSets: string[][];
  notReported?: boolean;
};

export type TeachingValueRule =
  | { kind: "text"; expected: string; aliases: string[] }
  | { kind: "number"; expected: number; tolerance: number; aliases: string[] }
  | { kind: "temperature"; kelvin: number; toleranceKelvin: number; aliases: string[] }
  | { kind: "force-range"; min: number; max: number; unit: "nN"; tolerance: number; aliases: string[] }
  | { kind: "not_reported"; aliases: string[] };

export type TeachingGoldRule = {
  value: TeachingValueRule;
  evidence: TeachingEvidenceRule;
};

export type TeachingExperimentPaper = {
  id: string;
  code: "A" | "B";
  title: string;
  doi: string;
  journal: string;
  sourceUrl: string;
  taskPrompt: string;
  aiModel: string;
  aiInitial: TeachingAnswers;
  gold: Record<TeachingFieldKey, TeachingGoldRule>;
};

export type TeachingExperimentConfig = {
  id: string;
  name: string;
  version: string;
  scoringVersion: string;
  fields: typeof TEACHING_FIELDS;
  papers: [TeachingExperimentPaper, TeachingExperimentPaper];
};
```

- [ ] **Step 4: Create the real two-paper configuration**

Create `config/teaching/default-experiment.v1.json` with the following values. Keep each evidence excerpt short; do not add publisher PDFs to the repository.

```json
{
  "id": "tribology-crossover-2026-v1",
  "name": "人工提取与 AI 辅助提取对比实验",
  "version": "2026.1",
  "scoringVersion": "teaching-score-v1",
  "fields": [
    { "key": "cation", "label": "Cation" },
    { "key": "anion", "label": "Anion" },
    { "key": "substrate", "label": "Substrate" },
    { "key": "temperature", "label": "Temperature" },
    { "key": "load", "label": "Load" },
    { "key": "cof", "label": "COF" }
  ],
  "papers": [
    {
      "id": "mdpi-lubricants-2018-6-64",
      "code": "A",
      "title": "Molecular Mechanisms Underlying Lubrication by Ionic Liquids: Activated Slip and Flow",
      "doi": "10.3390/lubricants6030064",
      "journal": "Lubricants",
      "sourceUrl": "https://www.mdpi.com/2075-4442/6/3/64/pdf",
      "taskPrompt": "提取文中 IL-44% 体系在 Figure 3 所述载荷依赖摩擦实验中的六个目标字段；不要把 IL-0% 或 PEG-IL 的结果混入答案。",
      "aiModel": "ioniclink-frozen-teaching-snapshot-2026.1",
      "aiInitial": {
        "cation": { "value": "EMIM", "page": "2", "evidence": "[EMIM][TFSI]" },
        "anion": { "value": "TFSI", "page": "2", "evidence": "[EMIM][TFSI]" },
        "substrate": { "value": "mica", "page": "14", "evidence": "freshly cleaved mica surface" },
        "temperature": { "value": "298.15 K", "page": "", "evidence": "default room-temperature condition" },
        "load": { "value": "15–75 nN", "page": "5", "evidence": "normal load ranging from 15 to 75 nN" },
        "cof": { "value": "0.04", "page": "5", "evidence": "IL-44% (μ = 0.04)" }
      },
      "gold": {
        "cation": { "value": { "kind": "text", "expected": "EMIM", "aliases": ["[EMIM]", "1-ethyl-3-methylimidazolium", "1-ethyl-3-methyl imidazolium"] }, "evidence": { "pages": [2], "anyKeywordSets": [["emim"], ["1-ethyl-3-methyl"]] } },
        "anion": { "value": { "kind": "text", "expected": "TFSI", "aliases": ["[TFSI]", "NTf2", "bis(trifluoromethylsulfonyl)imide"] }, "evidence": { "pages": [2], "anyKeywordSets": [["tfsi"], ["trifluoromethylsulfonyl"]] } },
        "substrate": { "value": { "kind": "text", "expected": "mica", "aliases": ["freshly cleaved mica"] }, "evidence": { "pages": [14], "anyKeywordSets": [["mica"]] } },
        "temperature": { "value": { "kind": "not_reported", "aliases": ["not reported", "未报告", "未说明", "NR", "N/A"] }, "evidence": { "pages": [], "anyKeywordSets": [["not reported"], ["未报告"]], "notReported": true } },
        "load": { "value": { "kind": "force-range", "min": 5, "max": 75, "unit": "nN", "tolerance": 1, "aliases": ["5-75 nN", "5 to 75 nN"] }, "evidence": { "pages": [14], "anyKeywordSets": [["load", "5", "75", "nN"]] } },
        "cof": { "value": { "kind": "number", "expected": 0.04, "tolerance": 0.005, "aliases": ["μ = 0.04", "COF 0.04"] }, "evidence": { "pages": [5], "anyKeywordSets": [["0.04"], ["IL-44%", "coefficient"]] } }
      }
    },
    {
      "id": "mdpi-lubricants-2023-11-376",
      "code": "B",
      "title": "Investigation of Programmable Friction with Ionic Liquid Mixtures at the Nano- and Macroscales",
      "doi": "10.3390/lubricants11090376",
      "journal": "Lubricants",
      "sourceUrl": "https://www.mdpi.com/2075-4442/11/9/376/pdf",
      "taskPrompt": "提取 Figure 4a 中开路电位 OCP、静摩擦、宏观 ball-on-three-pins 条件对应的六个字段；不要使用 −4 V、+4 V 或滑动末期数据。",
      "aiModel": "ioniclink-frozen-teaching-snapshot-2026.1",
      "aiInitial": {
        "cation": { "value": "P66614", "page": "4", "evidence": "[P66614][BTA] and [P66614][Doc]" },
        "anion": { "value": "BTA/Doc (4:1)", "page": "4", "evidence": "BTA to Doc mass ratio 4:1" },
        "substrate": { "value": "100Cr6 steel pins", "page": "6", "evidence": "100Cr6 steel ball on stationary pins" },
        "temperature": { "value": "298.15 K", "page": "", "evidence": "default room-temperature condition" },
        "load": { "value": "5 N total load", "page": "6", "evidence": "normal load was increased to 5 N" },
        "cof": { "value": "0.17", "page": "11", "evidence": "mean value was COF = 0.17" }
      },
      "gold": {
        "cation": { "value": { "kind": "text", "expected": "P66614", "aliases": ["[P66614]", "trihexyltetradecylphosphonium"] }, "evidence": { "pages": [4], "anyKeywordSets": [["p66614"], ["phosphonium"]] } },
        "anion": { "value": { "kind": "text", "expected": "BTA/Doc (4:1)", "aliases": ["BTA/Doc", "BTA:Doc 4:1", "[BTA]/[Doc] = 4:1"] }, "evidence": { "pages": [4], "anyKeywordSets": [["bta", "doc", "4:1"]] } },
        "substrate": { "value": { "kind": "text", "expected": "100Cr6 steel pins", "aliases": ["100Cr6 steel", "stationary steel pins"] }, "evidence": { "pages": [6], "anyKeywordSets": [["100cr6", "pins"]] } },
        "temperature": { "value": { "kind": "text", "expected": "room temperature", "aliases": ["at room temperature", "ambient temperature", "室温"] }, "evidence": { "pages": [6, 11], "anyKeywordSets": [["room", "temperature"]] } },
        "load": { "value": { "kind": "text", "expected": "5 N total load", "aliases": ["5 N", "5N total", "total load 5 N"] }, "evidence": { "pages": [6, 11], "anyKeywordSets": [["5", "N", "normal force"]] } },
        "cof": { "value": { "kind": "number", "expected": 0.17, "tolerance": 0.005, "aliases": ["μ = 0.17", "COF 0.17"] }, "evidence": { "pages": [11, 12], "anyKeywordSets": [["cof", "0.17"], ["mean", "0.17"]] } }
      }
    }
  ]
}
```

The frozen AI snapshots intentionally remain different from the gold rules in useful places:
paper A suggests `15–75 nN` on page 5 while the gold load is `5–75 nN` on page 14, and paper B
suggests `298.15 K` without a page while its gold temperature is `room temperature` on pages
6 or 11. Do not “correct” these frozen suggestions; they create observable AI-error correction
and error-adoption cases. The complete JSON above has checksum
`a36d0f9be5be402f2510f8919cacd6228e333ad975683e21033ea5acebf1058d`.

- [ ] **Step 5: Implement parsing, validation, and checksum**

In `lib/teaching/config.ts`, export exactly:

```ts
import { createHash } from "node:crypto";
import rawConfig from "../../config/teaching/default-experiment.v1.json";
import { TEACHING_FIELDS, type TeachingExperimentConfig } from "../teachingShared";

export const DEFAULT_EXPERIMENT = rawConfig as TeachingExperimentConfig;

export function validateExperimentConfig(config: TeachingExperimentConfig): string[] {
  const errors: string[] = [];
  if (!config.id.trim()) errors.push("experiment id is required");
  if (config.papers.length !== 2) errors.push("exactly two papers are required");
  const keys = TEACHING_FIELDS.map((field) => field.key);
  for (const paper of config.papers) {
    if (!/^https:\/\//.test(paper.sourceUrl)) errors.push(`paper ${paper.code} requires an HTTPS source URL`);
    if (!paper.taskPrompt.trim()) errors.push(`paper ${paper.code} requires a task prompt`);
    for (const key of keys) {
      if (!paper.aiInitial[key]) errors.push(`paper ${paper.code} is missing AI field ${key}`);
      if (!paper.gold[key]) errors.push(`paper ${paper.code} is missing gold field ${key}`);
    }
  }
  return errors;
}

export function defaultExperimentChecksum(): string {
  return createHash("sha256").update(JSON.stringify(DEFAULT_EXPERIMENT)).digest("hex");
}
```

- [ ] **Step 6: Validate the answer key against both official PDFs**

Use the PDF inspection workflow on the two configured MDPI PDF URLs. Independently compare every configured gold value, page, and short evidence keyword against the source and against the approved local extraction records used to draft the configuration. Confirm that the target prompts uniquely select IL-44%/Figure 3 for paper A and OCP/static/Figure 4a for paper B. If a page number or value differs, correct the JSON and its test expectation before any student data exists. Record no long source quotation in the repository.

- [ ] **Step 7: Run the focused test and typecheck**

Run: `npm run test:file -- lib/teaching/config.test.ts && npm run typecheck`

Expected: test prints `Teaching default experiment config tests passed`; typecheck exits 0.

- [ ] **Step 8: Commit the configuration slice**

```bash
git add config/teaching/default-experiment.v1.json lib/teaching/config.ts lib/teaching/config.test.ts lib/teachingShared.ts
git commit -m "feat: define default teaching crossover experiment"
```

## Task 2: Add compatibility-safe schema migrations and bootstrap

**Files:**

- Create: `lib/teaching/migrations.ts`
- Create: `lib/teaching/store.ts`
- Create: `lib/teaching/migrations.test.ts`
- Create: `lib/teaching/testFixtures.ts`
- Modify: `lib/teaching/config.ts`
- Modify: `lib/teaching.ts`

- [ ] **Step 1: Write a failing legacy migration test**

Create `lib/teaching/testFixtures.ts` with reusable query helpers:

```ts
import Database from "better-sqlite3";

export function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)
  );
}

export function tableNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
      .map((row) => row.name)
  );
}

export function sequenceCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries(
    (db.prepare("SELECT sequence_code AS code, COUNT(*) AS n FROM teaching_participants WHERE sequence_code IS NOT NULL GROUP BY sequence_code").all() as Array<{ code: string; n: number }>)
      .map((row) => [row.code, row.n])
  );
}

export function participants(db: Database.Database): Array<{ id: string; student_alias: string }> {
  return db.prepare("SELECT id, student_alias FROM teaching_participants WHERE sequence_code IS NOT NULL ORDER BY created_at, id").all() as Array<{ id: string; student_alias: string }>;
}

export function submissionsFor(db: Database.Database, participantId: string): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM teaching_submissions WHERE participant_id = ? ORDER BY round_no").all(participantId) as Array<Record<string, unknown>>;
}
```

In `migrations.test.ts`, create a temporary legacy database with the exact schema copied from the current `db()` initialization in `lib/teaching.ts`, insert one project, paper, participant, submission, and review, open it through the new store, and assert:

```ts
assert.equal(columnNames(db, "teaching_projects").has("config_checksum"), true);
assert.equal(columnNames(db, "teaching_papers").has("gold_snapshot_json"), true);
assert.equal(columnNames(db, "teaching_participants").has("sequence_code"), true);
assert.equal(columnNames(db, "teaching_participants").has("identity_key"), true);
assert.equal(columnNames(db, "teaching_submissions").has("active_seconds"), true);
assert.equal(tableNames(db).has("teaching_activity_events"), true);
assert.equal(db.prepare("SELECT name FROM teaching_projects WHERE id = 'legacy-project'").pluck().get(), "Legacy");
assert.equal(db.prepare("SELECT reviewer_id FROM teaching_reviews WHERE submission_id = 'legacy-submission'").pluck().get(), "teacher");
assert.equal(db.pragma("quick_check", { simple: true }), "ok");
```

Then call `ensureDefaultTeachingExperiment(db)` twice and assert one default project, two default papers, the same checksum, and no changes to legacy business rows.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/migrations.test.ts`

Expected: FAIL because `migrations.ts`, `store.ts`, and `ensureDefaultTeachingExperiment` do not exist.

- [ ] **Step 3: Implement idempotent migrations**

`lib/teaching/migrations.ts` must export `migrateTeachingSchema(db)`. Use `PRAGMA user_version`, `PRAGMA table_info`, and `ALTER TABLE ... ADD COLUMN` only when absent. Add these columns and indexes:

```sql
ALTER TABLE teaching_projects ADD COLUMN experiment_kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE teaching_projects ADD COLUMN config_version TEXT;
ALTER TABLE teaching_projects ADD COLUMN config_checksum TEXT;
ALTER TABLE teaching_projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teaching_papers ADD COLUMN task_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE teaching_papers ADD COLUMN gold_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE teaching_papers ADD COLUMN scoring_rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE teaching_papers ADD COLUMN config_version TEXT;
ALTER TABLE teaching_participants ADD COLUMN sequence_code TEXT;
ALTER TABLE teaching_participants ADD COLUMN identity_key TEXT;
ALTER TABLE teaching_participants ADD COLUMN completed_at TEXT;
ALTER TABLE teaching_participants ADD COLUMN excluded_at TEXT;
ALTER TABLE teaching_participants ADD COLUMN exclusion_reason TEXT;
ALTER TABLE teaching_submissions ADD COLUMN round_no INTEGER;
ALTER TABLE teaching_submissions ADD COLUMN mode TEXT;
ALTER TABLE teaching_submissions ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teaching_submissions ADD COLUMN ai_initial_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE teaching_submissions ADD COLUMN auto_value_scores_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE teaching_submissions ADD COLUMN auto_evidence_scores_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE teaching_submissions ADD COLUMN scoring_version TEXT;
ALTER TABLE teaching_submissions ADD COLUMN scoring_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE teaching_submissions ADD COLUMN auto_scored_at TEXT;
CREATE TABLE IF NOT EXISTS teaching_activity_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES teaching_submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  field_key TEXT,
  client_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  active_delta_seconds INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(submission_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_default_identity
  ON teaching_participants(project_id, identity_key) WHERE sequence_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_participant_round
  ON teaching_submissions(participant_id, round_no) WHERE round_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teaching_activity_submission
  ON teaching_activity_events(submission_id, received_at);
```

Run the full migration inside one transaction and set `user_version = 2` only after success.

- [ ] **Step 4: Move database ownership to `store.ts`**

Export `getTeachingDb()`, `teachingDataDir()`, and `closeTeachingStoreForTests()`. `getTeachingDb()` must create the current base schema, call `migrateTeachingSchema`, enable WAL and foreign keys, and cache exactly one connection. In `lib/teaching.ts`, replace the private connection with:

```ts
import { closeTeachingStoreForTests, getTeachingDb, teachingDataDir } from "./teaching/store";
const db = getTeachingDb;
const DATA_DIR = teachingDataDir();
export function closeTeachingDatabaseForTests(): void {
  closeTeachingStoreForTests();
}
```

- [ ] **Step 5: Implement idempotent default bootstrap**

Add `ensureDefaultTeachingExperiment(store = getTeachingDb())` to `config.ts`. It must validate first, compute the checksum, and use stable IDs:

```ts
const DEFAULT_PROJECT_ID = DEFAULT_EXPERIMENT.id;
const DEFAULT_INVITE = "AUTO-CROSSOVER-2026-V1";
```

Within a transaction, reject checksum drift once a participant exists; otherwise upsert the project and two papers. Persist `aiInitial` in `ai_snapshot_json`, gold values in `gold_snapshot_json`, full field rules in `scoring_rules_json`, and `taskPrompt`. Never query or mutate `tribology.db` during bootstrap.

- [ ] **Step 6: Run migration and legacy tests**

Run: `npm run test:file -- lib/teaching/migrations.test.ts lib/teaching.test.ts`

Expected: both test files pass; SQLite `quick_check` reports `ok`.

- [ ] **Step 7: Commit the storage slice**

```bash
git add lib/teaching/migrations.ts lib/teaching/store.ts lib/teaching/migrations.test.ts lib/teaching/testFixtures.ts lib/teaching/config.ts lib/teaching.ts
git commit -m "feat: bootstrap teaching experiment with safe migrations"
```

## Task 3: Implement deterministic automatic scoring

**Files:**

- Create: `lib/teaching/scoring.ts`
- Create: `lib/teaching/scoring.test.ts`
- Modify: `lib/teachingShared.ts`

- [ ] **Step 1: Define result types and failing tests**

Add these shared types:

```ts
export type TeachingFieldScore = {
  correct: boolean;
  normalized: string;
  reason: string;
};
export type TeachingAutoScore = {
  values: Record<TeachingFieldKey, TeachingFieldScore>;
  evidence: Record<TeachingFieldKey, TeachingFieldScore>;
  valueCorrect: number;
  valueAccuracy: number;
  valueCoverage: number;
  evidenceCorrect: number;
  evidenceAccuracy: number;
  evidenceCoverage: number;
};
export type TeachingAiBehavior = {
  suggested: number;
  adopted: number;
  modified: number;
  initiallyIncorrect: number;
  corrected: number;
  incorrectlyAdopted: number;
  adoptionRate: number | null;
  modificationRate: number | null;
  correctionRate: number | null;
  incorrectAdoptionRate: number | null;
};
```

Create `scoring.test.ts` to assert:

```ts
import assert from "node:assert/strict";
import { DEFAULT_EXPERIMENT } from "./config";
import { scoreAiBehavior, scoreEvidence, scoreSubmission, scoreValue } from "./scoring";
import type { TeachingGoldRule } from "../teachingShared";

const paperA = DEFAULT_EXPERIMENT.papers[0];
const paperB = DEFAULT_EXPERIMENT.papers[1];
const roomTemperatureRule: TeachingGoldRule = {
  value: { kind: "temperature", kelvin: 298.15, toleranceKelvin: 0.5, aliases: ["room temperature"] },
  evidence: { pages: [1], anyKeywordSets: [["temperature"]] }
};

assert.equal(scoreValue("[EMIM]", paperA.gold.cation).correct, true);
assert.equal(scoreValue("1-ethyl-3-methylimidazolium", paperA.gold.cation).correct, true);
assert.equal(scoreValue("25 C", roomTemperatureRule).correct, true);
assert.equal(scoreValue("15 to 75 nN", paperA.gold.load).correct, true);
assert.equal(scoreValue("0.045", paperA.gold.cof).correct, true);
assert.equal(scoreValue("", paperA.gold.cof).correct, false);
assert.equal(scoreValue("未报告", paperB.gold.temperature).correct, true);
assert.equal(scoreEvidence({ value: "0.04", page: "5", evidence: "IL-44% μ = 0.04" }, paperA.gold.cof).correct, true);
assert.equal(scoreEvidence({ value: "0.04", page: "9", evidence: "0.04" }, paperA.gold.cof).correct, false);
assert.equal(scoreSubmission({}, paperA).valueAccuracy, 0, "blank answers count against all six fields");
assert.equal(scoreSubmission({}, paperA).valueCoverage, 0);

const correctedFinalAnswers = structuredClone(paperA.aiInitial);
correctedFinalAnswers.temperature = {
  value: "not reported",
  page: "",
  evidence: "temperature not reported"
};
const behavior = scoreAiBehavior(paperA.aiInitial, correctedFinalAnswers, scoreSubmission(paperA.aiInitial, paperA), scoreSubmission(correctedFinalAnswers, paperA));
assert.equal(behavior.initiallyIncorrect, 1);
assert.equal(behavior.corrected, 1);
assert.equal(behavior.correctionRate, 1);
console.log("Teaching deterministic scoring tests passed");
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/scoring.test.ts`

Expected: FAIL because scoring exports are missing.

- [ ] **Step 3: Implement normalization and value rules**

`scoring.ts` must export:

```ts
export function normalizeTeachingText(value: string): string;
export function scoreValue(value: string, rule: TeachingGoldRule): TeachingFieldScore;
export function scoreEvidence(answer: TeachingAnswer | undefined, rule: TeachingGoldRule): TeachingFieldScore;
export function scoreSubmission(answers: TeachingAnswers, paper: TeachingExperimentPaper): TeachingAutoScore;
export function scoreAiBehavior(ai: TeachingAnswers, final: TeachingAnswers, aiScore: TeachingAutoScore, finalScore: TeachingAutoScore): TeachingAiBehavior;
```

Normalization must use `NFKC`, lowercase, normalize Greek `μ` to `u`, replace Unicode dashes, remove brackets/punctuation for text aliases, and collapse whitespace. Parse Celsius/Kelvin, scalar numbers, and `min-max` force ranges; never infer an absent unit except for dimensionless COF. Return an explicit `reason` such as `alias_match`, `within_tolerance`, `page_mismatch`, `keyword_match`, or `blank`.

- [ ] **Step 4: Implement fixed-denominator submission and AI metrics**

`scoreSubmission` must iterate all six `TEACHING_FIELDS`; accuracy denominator is always six and coverage only counts non-empty values. Evidence is correct only when both page and configured keyword rules match; `notReported` accepts an empty page only when the evidence text explicitly states that the value was not reported. Count an AI suggestion as adopted only when normalized value, page, and evidence are all unchanged; count it as modified when any of those three changes. Correction/error-adoption use value correctness, not evidence correctness. AI behavior denominators return `null` when zero.

- [ ] **Step 5: Run scoring tests and typecheck**

Run: `npm run test:file -- lib/teaching/scoring.test.ts && npm run typecheck`

Expected: all assertions pass; typecheck exits 0.

- [ ] **Step 6: Commit the scoring slice**

```bash
git add lib/teaching/scoring.ts lib/teaching/scoring.test.ts lib/teachingShared.ts
git commit -m "feat: add deterministic teaching answer scoring"
```

## Task 4: Add balanced assignment and two-round state transitions

**Files:**

- Create: `lib/teaching/assignment.ts`
- Create: `lib/teaching/assignment.test.ts`
- Modify: `lib/teaching.ts`
- Modify: `lib/teachingShared.ts`

- [ ] **Step 1: Write failing assignment tests**

Using a fresh temp database, call `joinDefaultTeachingExperiment` for `S001` through `S030`. Assert:

```ts
import assert from "node:assert/strict";
import { getTeachingDb } from "./store";
import { participants, sequenceCounts, submissionsFor } from "./testFixtures";
import { joinDefaultTeachingExperiment } from "./assignment";

const db = getTeachingDb();
const joinedByAlias = new Map<string, ReturnType<typeof joinDefaultTeachingExperiment>>();
for (let index = 1; index <= 30; index += 1) {
  const alias = `S${String(index).padStart(3, "0")}`;
  joinedByAlias.set(alias, joinDefaultTeachingExperiment(alias));
}
assert.deepEqual(sequenceCounts(db), { manual_then_ai: 15, ai_then_manual: 15 });
for (const participant of participants(db)) {
  const rounds = submissionsFor(db, participant.id);
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds.map((round) => round.round_no), [1, 2]);
  assert.deepEqual(new Set(rounds.map((round) => round.paper_id)).size, 2);
}
const first = joinedByAlias.get("S001")!;
const again = joinDefaultTeachingExperiment("s001");
assert.equal(again.participantId, first.participantId);
assert.equal(submissionsFor(db, first.participantId).length, 2);
```

Assert that `manual` round answers start `{}`, `ai_assisted` answers equal `ai_initial_json`, round 2 cannot be saved or submitted before round 1, round 1 submission advances to round 2, and round 2 sets `completed_at`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/assignment.test.ts`

Expected: FAIL because assignment functions are missing.

- [ ] **Step 3: Implement atomic balanced joining**

Export:

```ts
export function normalizeStudentAlias(value: string): string;
export function joinDefaultTeachingExperiment(studentAlias: string): { projectId: string; participantId: string };
export function getCurrentTeachingRound(participantId: string): TeachingStudentState | null;
export function saveCurrentTeachingDraft(participantId: string, expectedVersion: number, answers: TeachingAnswers): { version: number; updatedAt: string };
export function submitCurrentTeachingRound(participantId: string): TeachingRoundTransition;
export function rescoreTeachingSubmission(submissionId: string): TeachingAutoScore;
export function rescoreErroredTeachingSubmissions(limit?: number): number;
```

Use one `BEGIN IMMEDIATE` transaction for lookup, sequence count, participant insert, and both submission inserts. If counts tie choose `manual_then_ai`; otherwise choose the smaller sequence. Map rounds exactly:

```ts
const rounds = sequence === "manual_then_ai"
  ? [{ round: 1, paper: paperA, mode: "manual" }, { round: 2, paper: paperB, mode: "ai_assisted" }]
  : [{ round: 1, paper: paperA, mode: "ai_assisted" }, { round: 2, paper: paperB, mode: "manual" }];
```

Normalize identity with `NFKC`, trim/collapse whitespace, and lowercase it into `identity_key`; keep the trimmed entered spelling in `student_alias` for display. Reject aliases shorter than 2 or longer than 80 characters. Insert AI answers only for `ai_assisted`; do not insert gold rules into submissions.

- [ ] **Step 4: Implement current-round serialization and submission scoring**

Add these exact state types to `lib/teachingShared.ts`:

```ts
type TeachingStudentActiveBase = {
  status: "active";
  project: { id: string; name: string; fields: typeof TEACHING_FIELDS };
  participant: { studentAlias: string };
  paper: {
    id: string;
    code: "A" | "B";
    title: string;
    doi: string;
    journal: string;
    sourceUrl: string;
    taskPrompt: string;
  };
  roundNo: 1 | 2;
  totalRounds: 2;
  startedAt: string;
  answers: TeachingAnswers;
  activeSeconds: number;
  version: number;
};

export type TeachingStudentState =
  | (TeachingStudentActiveBase & { mode: "manual" })
  | (TeachingStudentActiveBase & { mode: "ai_assisted"; aiInitial: TeachingAnswers })
  | { status: "complete"; participant: { studentAlias: string }; completedAt: string };

export type TeachingRoundTransition =
  | { status: "next_round"; roundNo: 2 }
  | { status: "complete"; completedAt: string };
```

The active serializer contains project display data, paper metadata, round/mode, answers, active seconds, and version. Only the AI-assisted union member may contain `aiInitial`.

On submit, validate six non-empty values, lock the current row, call `scoreSubmission`, set `scoring_status='scored'`, and return `{ status: "next_round", roundNo: 2 }` or `{ status: "complete", completedAt }`. Scoring failure locks the submission with `scoring_status='scoring_error'`. `rescoreTeachingSubmission` reloads the immutable paper rules and locked answers, overwrites only automatic-score columns, and never changes answers or timestamps; the batch function retries at most 20 errored rows by default.

- [ ] **Step 5: Preserve legacy facade exports**

Keep `joinTeachingProject`, `getStudentWorkspace`, `saveStudentDraft`, and `submitStudentWork` unchanged for legacy tests. Re-export all new functions through `lib/teaching.ts`; default routes will switch later.

- [ ] **Step 6: Run assignment and legacy integration tests**

Run: `npm run test:file -- lib/teaching/assignment.test.ts lib/teaching.test.ts`

Expected: 30-way balance, round transitions, and all prior legacy assertions pass.

- [ ] **Step 7: Commit the assignment slice**

```bash
git add lib/teaching/assignment.ts lib/teaching/assignment.test.ts lib/teaching.ts lib/teachingShared.ts
git commit -m "feat: assign balanced two-round teaching tasks"
```

## Task 5: Track active time with idempotent heartbeats

**Files:**

- Create: `lib/teaching/activity.ts`
- Create: `lib/teaching/activity.test.ts`
- Modify: `lib/teaching/assignment.ts`
- Modify: `lib/teaching.ts`

- [ ] **Step 1: Write failing activity tests**

Create an active round and assert:

```ts
assert.deepEqual(recordTeachingHeartbeat(participantId, {
  eventId: "hb-1", roundNo: 1, clientAt: "2026-08-09T00:00:15.000Z", activeDeltaSeconds: 15, visible: true
}), { activeSeconds: 15 });
assert.deepEqual(recordTeachingHeartbeat(participantId, {
  eventId: "hb-1", roundNo: 1, clientAt: "2026-08-09T00:00:15.000Z", activeDeltaSeconds: 15, visible: true
}), { activeSeconds: 15 }, "duplicate heartbeat must not double count");
assert.equal(recordTeachingHeartbeat(participantId, {
  eventId: "hb-2", roundNo: 1, clientAt: "2026-08-09T00:00:30.000Z", activeDeltaSeconds: 99, visible: true
}).activeSeconds, 35, "server caps each heartbeat at 20 seconds");
assert.equal(recordTeachingHeartbeat(participantId, {
  eventId: "hb-3", roundNo: 1, clientAt: "2026-08-09T00:00:45.000Z", activeDeltaSeconds: 15, visible: false
}).activeSeconds, 35);
```

Also assert heartbeats reject a submitted round and never update round 2 while round 1 is active.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/activity.test.ts`

Expected: FAIL because `recordTeachingHeartbeat` is missing.

- [ ] **Step 3: Implement server heartbeat handling**

Export `recordTeachingHeartbeat(participantId, input)`. Validate a safe non-empty event ID, `roundNo` 1 or 2, ISO timestamp, nonnegative finite integer delta, visible state, and the participant's matching current unlocked round. Credit at most 20 seconds per visible event. In one transaction, `INSERT OR IGNORE` the activity event and increment `active_seconds` only when insertion succeeds and `visible === true`.

Edit events use `event_type='edit'` and `field_key`; heartbeat metadata must not contain answer text, clipboard content, or PDF content.

- [ ] **Step 4: Add an activity-quality helper**

Export `teachingTimingQuality(activeSeconds, wallSeconds)` returning `valid`, `zero_active`, or `excessive_idle`; mark excessive idle when wall time is at least 20 minutes and greater than five times active time. This flag informs the dashboard but does not silently exclude records.

- [ ] **Step 5: Run the focused tests**

Run: `npm run test:file -- lib/teaching/activity.test.ts lib/teaching/assignment.test.ts`

Expected: heartbeat, lock, and transition assertions pass.

- [ ] **Step 6: Commit the activity slice**

```bash
git add lib/teaching/activity.ts lib/teaching/activity.test.ts lib/teaching/assignment.ts lib/teaching.ts
git commit -m "feat: track active teaching experiment time"
```

## Task 6: Build paired analytics and shared CSV data

**Files:**

- Create: `lib/teaching/analytics.ts`
- Create: `lib/teaching/analytics.test.ts`
- Modify: `lib/teachingShared.ts`
- Modify: `lib/teachingCsv.ts`
- Modify: `lib/teachingCsv.test.ts`

- [ ] **Step 1: Define dashboard types and failing analytics tests**

Add these shared analysis/result types:

```ts
export type TeachingTimingQuality = "valid" | "zero_active" | "excessive_idle";
export type TeachingRoundAnalysis = {
  submissionId: string;
  paperCode: "A" | "B";
  mode: TeachingMode;
  activeSeconds: number;
  wallSeconds: number;
  score: TeachingAutoScore;
  aiBehavior: TeachingAiBehavior | null;
  timingQuality: TeachingTimingQuality;
};
export type TeachingExperimentAnalysisRow = {
  participantId: string;
  studentAlias: string;
  sequence: TeachingSequence;
  completed: boolean;
  exclusionReason: string | null;
  manual: TeachingRoundAnalysis | null;
  aiAssisted: TeachingRoundAnalysis | null;
};
export type TeachingModeSummary = {
  n: number;
  medianActiveSeconds: number | null;
  medianAccuracy: number | null;
  meanAccuracy: number | null;
  medianCoverage: number | null;
  medianEvidenceAccuracy: number | null;
  medianEvidenceCoverage: number | null;
};
export type TeachingDifferenceSummary = {
  median: number | null;
  ci95: { low: number; high: number } | null;
  wilcoxonP: number | null;
};
export type TeachingExperimentSummary = {
  completion: { total: number; completed: number; paired: number; incomplete: number; excluded: number };
  sequenceCounts: Record<TeachingSequence, number>;
  manual: TeachingModeSummary;
  aiAssisted: TeachingModeSummary;
  timeSavedRate: number | null;
  accuracyDelta: number | null;
  fasterAndMoreAccurate: number;
  timeDifference: TeachingDifferenceSummary;
  accuracyDifference: TeachingDifferenceSummary;
  aiBehavior: TeachingAiBehavior;
};
export type TeachingPairedResult = TeachingExperimentAnalysisRow & {
  activeTimeDifference: number | null;
  accuracyDifference: number | null;
};
export type TeachingExperimentDashboard = {
  experiment: { id: string; name: string; version: string; scoringVersion: string };
  summary: TeachingExperimentSummary;
  participants: TeachingPairedResult[];
};
```

Build 30 deterministic fixture pairs where manual takes 1,200 seconds at 4/6 accuracy and AI takes 600 seconds at 5/6 accuracy. Put this complete fixture factory at the top of `analytics.test.ts`:

```ts
import assert from "node:assert/strict";
import { summarizeTeachingExperiment } from "./analytics";
import { TEACHING_FIELDS, type TeachingAutoScore, type TeachingExperimentAnalysisRow } from "../teachingShared";

function autoScore(correctCount: number): TeachingAutoScore {
  const values = Object.fromEntries(TEACHING_FIELDS.map((field, index) => [
    field.key,
    { correct: index < correctCount, normalized: index < correctCount ? "correct" : "wrong", reason: index < correctCount ? "alias_match" : "mismatch" }
  ])) as TeachingAutoScore["values"];
  const evidence = Object.fromEntries(TEACHING_FIELDS.map((field, index) => [
    field.key,
    { correct: index < correctCount, normalized: index < correctCount ? "evidence" : "", reason: index < correctCount ? "keyword_match" : "blank" }
  ])) as TeachingAutoScore["evidence"];
  return {
    values,
    evidence,
    valueCorrect: correctCount,
    valueAccuracy: correctCount / 6,
    valueCoverage: 1,
    evidenceCorrect: correctCount,
    evidenceAccuracy: correctCount / 6,
    evidenceCoverage: 1
  };
}

const fixtures: TeachingExperimentAnalysisRow[] = Array.from({ length: 30 }, (_, index) => ({
  participantId: `p-${index + 1}`,
  studentAlias: `S${String(index + 1).padStart(3, "0")}`,
  sequence: index % 2 === 0 ? "manual_then_ai" : "ai_then_manual",
  completed: true,
  exclusionReason: null,
  manual: {
    submissionId: `m-${index + 1}`, paperCode: index % 2 === 0 ? "A" : "B", mode: "manual",
    activeSeconds: 1200, wallSeconds: 1300, score: autoScore(4), aiBehavior: null, timingQuality: "valid"
  },
  aiAssisted: {
    submissionId: `a-${index + 1}`, paperCode: index % 2 === 0 ? "B" : "A", mode: "ai_assisted",
    activeSeconds: 600, wallSeconds: 650, score: autoScore(5),
    aiBehavior: { suggested: 6, adopted: 5, modified: 1, initiallyIncorrect: 1, corrected: 1, incorrectlyAdopted: 0, adoptionRate: 5 / 6, modificationRate: 1 / 6, correctionRate: 1, incorrectAdoptionRate: 0 },
    timingQuality: "valid"
  }
}));
```

Then assert:

```ts
const result = summarizeTeachingExperiment(fixtures);
assert.equal(result.completion.total, 30);
assert.equal(result.completion.paired, 30);
assert.equal(result.sequenceCounts.manual_then_ai, 15);
assert.equal(result.sequenceCounts.ai_then_manual, 15);
assert.equal(result.manual.medianActiveSeconds, 1200);
assert.equal(result.aiAssisted.medianActiveSeconds, 600);
assert.equal(result.timeSavedRate, 0.5);
assert.equal(result.accuracyDelta, 1 / 6);
assert.equal(result.fasterAndMoreAccurate, 30);
assert.equal(result.timeDifference.ci95.low, -600);
assert.equal(result.timeDifference.ci95.high, -600);
assert.ok((result.timeDifference.wilcoxonP ?? 1) < 0.001);
```

Add incomplete, zero-active, excluded, and no-AI-error fixtures; assert exact counts and `null` denominators.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- lib/teaching/analytics.test.ts`

Expected: FAIL because analytics functions are missing.

- [ ] **Step 3: Implement deterministic statistics**

Export pure functions:

```ts
export function median(values: number[]): number | null;
export function bootstrapMedianCi(values: number[], seed = 20260809, iterations = 2000): { low: number; high: number } | null;
export function wilcoxonSignedRank(differences: number[]): number | null;
export function summarizeTeachingExperiment(rows: TeachingExperimentAnalysisRow[]): TeachingExperimentSummary;
```

Use an internal seeded LCG for bootstrap reproducibility. Wilcoxon must drop zero differences, average tied absolute ranks, apply tie correction and continuity-corrected normal approximation, and return a two-sided p-value. Return `null` for fewer than five non-zero pairs; the dashboard labels that as insufficient sample rather than `p=1`.

- [ ] **Step 4: Query analysis rows from the database**

Add `getDefaultTeachingDashboard()` to `lib/teaching.ts`. Query both submissions per participant, parse saved automatic scores, compute AI behavior from frozen snapshots, attach timing quality, and pass rows to the pure summarizer. Keep incomplete participants in completion counts, but only valid complete pairs in primary metrics.

- [ ] **Step 5: Make CSV consume the same dashboard object**

Add `teachingExperimentToCsv(dashboard, { anonymize?: boolean })`. Include experiment/scoring versions, alias or deterministic `S001` anonymized label, sequence, both modes' active/wall time, correct/6, coverage, evidence, AI adoption/modification/correction/error-adoption values, quality flags, and an exclusion flag. Export no participant ID, free-text exclusion reason, answer/evidence text, AI initial text, gold, or scoring rules. Keep UTF-8 BOM and spreadsheet-formula escaping.

- [ ] **Step 6: Run analytics and CSV tests**

Run: `npm run test:file -- lib/teaching/analytics.test.ts lib/teachingCsv.test.ts`

Expected: paired statistics and CSV safety tests pass.

- [ ] **Step 7: Commit the analytics slice**

```bash
git add lib/teaching/analytics.ts lib/teaching/analytics.test.ts lib/teachingShared.ts lib/teaching.ts lib/teachingCsv.ts lib/teachingCsv.test.ts
git commit -m "feat: summarize paired teaching experiment outcomes"
```

## Task 7: Switch API routes to the zero-configuration workflow

**Files:**

- Create: `app/api/teaching/teachingRoutes.test.ts`
- Modify: `app/api/teaching/session/route.ts`
- Modify: `app/api/teaching/student/route.ts`
- Modify: `app/api/teaching/admin/route.ts`
- Modify: `app/api/teaching/admin/export/route.ts`
- Modify: `app/teaching/student/page.tsx`
- Modify: `app/teaching/admin/page.tsx`

- [ ] **Step 1: Write failing route tests**

Construct `NextRequest` objects and assert:

```ts
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as sessionPost } from "./session/route";
import { GET as studentGet, POST as studentPost } from "./student/route";

function request(path: string, method: string, body?: unknown, cookie?: string): NextRequest {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const studentLogin = await sessionPost(request("/api/teaching/session", "POST", {
  role: "student", studentAlias: "S001"
}));
assert.equal(studentLogin.status, 200);
assert.match(studentLogin.headers.get("set-cookie") ?? "", /ioniclink_teaching_session/);
const cookie = (studentLogin.headers.get("set-cookie") ?? "").split(";")[0];

const manualResponse = await studentGet(request("/api/teaching/student", "GET", undefined, cookie));
const manualPayload = await manualResponse.json();
assert.equal(manualPayload.status, "active");
assert.equal(manualPayload.mode, "manual");
assert.equal("aiInitial" in manualPayload, false);
assert.equal(JSON.stringify(manualPayload).includes("gold"), false);

const heartbeat = await studentPost(request("/api/teaching/student", "POST", {
  action: "heartbeat", eventId: "route-hb-1", roundNo: 1, clientAt: new Date().toISOString(), activeDeltaSeconds: 15, visible: true
}, cookie));
assert.equal(heartbeat.status, 200);
```

Also test cross-origin rejection, wrong role, version conflict, first-round transition, second-round completion, admin summary, and CSV response headers.

- [ ] **Step 2: Run the route test and verify it fails**

Run: `npm run test:file -- app/api/teaching/teachingRoutes.test.ts`

Expected: FAIL because session still requires invite/group and student POST has no action routing.

- [ ] **Step 3: Simplify student login**

In `session/route.ts`, student payload accepts only `{ role: "student", studentAlias: string }`, calls `joinDefaultTeachingExperiment`, and creates the same secure role session. Teacher password behavior and CSRF protection stay unchanged.

- [ ] **Step 4: Route student actions explicitly**

`GET` returns `getCurrentTeachingRound`; `PATCH` uses `saveCurrentTeachingDraft`; `POST` parses a discriminated union:

```ts
type StudentAction =
  | { action: "heartbeat"; eventId: string; roundNo: 1 | 2; clientAt: string; activeDeltaSeconds: number; visible: boolean; fieldKey?: TeachingFieldKey }
  | { action: "submit"; roundNo: 1 | 2; version: number };
```

`PATCH` uses `{ version, answers }`. Return 409 for locked, stale-round, or version conflicts, 400 for malformed actions, and no sensitive scoring fields in student responses. Binding submit to both round and version prevents a delayed round-1 retry from submitting the prefilled round 2.

- [ ] **Step 5: Make admin and export read-only by default**

`GET /api/teaching/admin` first calls `rescoreErroredTeachingSubmissions(20)`, then returns `getDefaultTeachingDashboard()`. Retain the legacy `review` POST action only; remove default UI dependencies on project creation and paper insertion. Export calls `teachingExperimentToCsv` with `anonymize=1` support. Route tests must force one `scoring_error`, open the dashboard, and verify it becomes `scored` without changing the locked answer JSON.

- [ ] **Step 6: Update server pages**

The student page obtains `TeachingStudentState`; complete state renders the completion panel. The admin page calls `getDefaultTeachingDashboard`. Do not pass gold rules to client components.

- [ ] **Step 7: Run route, auth, and type tests**

Run: `npm run test:file -- app/api/teaching/teachingRoutes.test.ts lib/teaching.test.ts && npm run typecheck`

Expected: all route/security assertions pass; typecheck exits 0.

- [ ] **Step 8: Commit the route slice**

```bash
git add app/api/teaching app/teaching/student/page.tsx app/teaching/admin/page.tsx
git commit -m "feat: expose zero-config teaching experiment APIs"
```

## Task 8: Build the round-aware student experience

**Files:**

- Create: `components/teaching/TeachingGateway.test.tsx`
- Create: `components/teaching/StudentWorkspace.test.tsx`
- Create: `components/teaching/studentWorkspaceModel.ts`
- Modify: `components/teaching/TeachingGateway.tsx`
- Modify: `components/teaching/StudentWorkspace.tsx`
- Create: `lib/teaching/answerComparison.ts`
- Modify: `lib/teaching/scoring.ts`

- [ ] **Step 1: Write failing static component tests**

Render `TeachingGateway` in both modes and both active workspace modes using `renderToStaticMarkup`. Add an optional `initialMode?: "student" | "teacher"` prop solely to make the initial tab deterministic in server/static tests. Assert the student render contains one text field and the experiment recording disclosure; the teacher render contains only the password field. Assert:

```ts
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StudentWorkspace } from "./StudentWorkspace";
import { TeachingGateway } from "./TeachingGateway";
import { TEACHING_FIELDS, type TeachingAnswers, type TeachingStudentState } from "../../lib/teachingShared";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const studentGatewayHtml = renderToStaticMarkup(createElement(TeachingGateway, { initialMode: "student" }));
const teacherGatewayHtml = renderToStaticMarkup(createElement(TeachingGateway, { initialMode: "teacher" }));
assert.equal((studentGatewayHtml.match(/<input/g) ?? []).length, 1);
assert.match(studentGatewayHtml, /有效时间|操作记录/);
assert.doesNotMatch(studentGatewayHtml, /name="inviteCode"|name="groupCode"|name="password"/);
assert.match(teacherGatewayHtml, /name="password"/);
assert.doesNotMatch(teacherGatewayHtml, /name="studentAlias"/);

const answers: TeachingAnswers = {
  cation: { value: "EMIM", page: "2", evidence: "[EMIM][TFSI]" },
  anion: { value: "TFSI", page: "2", evidence: "[EMIM][TFSI]" },
  substrate: { value: "mica", page: "14", evidence: "mica" },
  temperature: { value: "not reported", page: "", evidence: "not reported" },
  load: { value: "15-75 nN", page: "5", evidence: "15 to 75 nN" },
  cof: { value: "0.04", page: "5", evidence: "mu = 0.04" }
};
const base = {
  status: "active" as const,
  project: { id: "p", name: "教学实验", fields: TEACHING_FIELDS },
  participant: { studentAlias: "S001" },
  paper: { id: "paper-a", code: "A" as const, title: "Paper A", doi: "10.0000/a", journal: "Journal", sourceUrl: "https://example.test/a", taskPrompt: "Extract the specified condition." },
  totalRounds: 2 as const,
  startedAt: "2026-08-09T00:00:00.000Z",
  activeSeconds: 30,
  version: 0
};
const manual: TeachingStudentState = { ...base, roundNo: 1, mode: "manual", answers: {} };
const assisted: TeachingStudentState = { ...base, roundNo: 2, mode: "ai_assisted", answers, aiInitial: answers };
const complete: TeachingStudentState = { status: "complete", participant: { studentAlias: "S001" }, completedAt: "2026-08-09T01:00:00.000Z" };
const manualHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: manual }));
const aiHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: assisted }));
const completeHtml = renderToStaticMarkup(createElement(StudentWorkspace, { initial: complete }));

assert.match(manualHtml, /第 1 \/ 2 轮/);
assert.match(manualHtml, /纯人工提取/);
assert.doesNotMatch(manualHtml, /AI 建议|已采用|已修改/);
assert.match(aiHtml, /AI 辅助提取/);
assert.match(aiHtml, /逐项核对 AI 建议/);
assert.match(aiHtml, /已核对全部字段/);
assert.match(completeHtml, /两轮实验已完成/);
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm run test:file -- components/teaching/TeachingGateway.test.tsx components/teaching/StudentWorkspace.test.tsx`

Expected: FAIL because current UI describes a one-round manual task.

- [ ] **Step 3: Simplify the gateway**

Change the component signature to `TeachingGateway({ initialMode = "student" }: { initialMode?: Mode })` and initialize state from that prop. Student tab fields: only `studentAlias`. Explain automatic two-round assignment, active-time tracking, answer/edit collection, and no real-name requirement. Keep teacher access available but visually secondary. Submit the new session payload.

- [ ] **Step 4: Make `StudentWorkspace` consume the discriminated state**

Show round progress, mode badge, task prompt, paper title/DOI, a primary publisher-PDF link, a DOI fallback link, six rows, completed fields, and effective time. Manual mode starts blank and contains no AI styling. AI-assisted mode starts from `aiInitial`, marks fields as unchanged or modified by normalized comparison, and requires a single confirmation checkbox before submit.

After a successful round-1 submit, call `window.location.reload()` to obtain a fresh server-filtered round-2 payload. After round 2, reload into the completion panel. Preserve the existing 800 ms ordered autosave and optimistic version handling.

- [ ] **Step 5: Add the client activity loop**

Track `pointerdown`, `keydown`, `input`, `scroll`, and `touchstart` timestamps without storing event content. Every 15 seconds, when `document.visibilityState === "visible"` and the last activity is within 120 seconds, send a unique heartbeat with delta capped at 15. Stop on locked/complete state and send no heartbeat while hidden. Display “闲置，计时已暂停” after 120 seconds.

- [ ] **Step 6: Run student component tests and lint**

Run: `npm run test:file -- components/teaching/TeachingGateway.test.tsx components/teaching/StudentWorkspace.test.tsx && npm run lint`

Expected: component contracts pass; lint exits 0.

- [ ] **Step 7: Commit the student UI slice**

```bash
git add components/teaching/TeachingGateway.tsx components/teaching/TeachingGateway.test.tsx components/teaching/StudentWorkspace.tsx components/teaching/StudentWorkspace.test.tsx components/teaching/studentWorkspaceModel.ts lib/teaching/answerComparison.ts lib/teaching/scoring.ts
git commit -m "feat: add two-round teaching experiment workspace"
```

## Task 9: Build the zero-operation teacher dashboard

**Files:**

- Create: `components/teaching/TeacherDashboard.test.tsx`
- Modify: `components/teaching/TeacherDashboard.tsx`
- Modify: `app/teaching/admin/page.tsx`
- Modify: `lib/teaching.ts`
- Modify: `lib/teaching/analytics.ts`
- Modify: `lib/teaching/analytics.test.ts`
- Modify: `lib/teachingShared.ts`
- Modify: `lib/teachingCsv.ts`
- Modify: `lib/teachingCsv.test.ts`

- [ ] **Step 1: Write a failing dashboard component test**

Render a 30-student fixture dashboard and assert visible text includes:

```ts
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeacherDashboard } from "./TeacherDashboard";
import type { TeachingExperimentDashboard } from "../../lib/teachingShared";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const mode = (n: number, seconds: number, accuracy: number) => ({
  n,
  medianActiveSeconds: seconds,
  medianAccuracy: accuracy,
  meanAccuracy: accuracy,
  medianCoverage: 1,
  medianEvidenceAccuracy: accuracy,
  medianEvidenceCoverage: 1
});
const dashboard: TeachingExperimentDashboard = {
  experiment: {
    id: "p", name: "教学实验", version: "2026.1", scoringVersion: "teaching-score-v1",
    papers: []
  },
  summary: {
    completion: { total: 30, completed: 28, paired: 28, incomplete: 2, excluded: 0 },
    sequenceCounts: { manual_then_ai: 15, ai_then_manual: 15 },
    manual: mode(28, 1120, 0.78),
    aiAssisted: mode(28, 552, 0.91),
    timeSavedRate: 0.507,
    accuracyDelta: 0.13,
    fasterAndMoreAccurate: 24,
    timeDifference: { median: -568, ci95: { low: -700, high: -420 }, wilcoxonP: 0.001 },
    accuracyDifference: { median: 1 / 6, ci95: { low: 0, high: 1 / 3 }, wilcoxonP: 0.004 },
    aiBehavior: { suggested: 168, adopted: 121, modified: 47, initiallyIncorrect: 28, corrected: 18, incorrectlyAdopted: 10, adoptionRate: 0.72, modificationRate: 0.28, correctionRate: 0.64, incorrectAdoptionRate: 0.36 }
  },
  diagnostics: {
    byPaper: {
      A: { manual: mode(14, 1120, 0.78), aiAssisted: mode(14, 552, 0.91) },
      B: { manual: mode(14, 1120, 0.78), aiAssisted: mode(14, 552, 0.91) }
    },
    bySequence: {
      manual_then_ai: { total: 15, completed: 14, paired: 14, manual: mode(14, 1120, 0.78), aiAssisted: mode(14, 552, 0.91) },
      ai_then_manual: { total: 15, completed: 14, paired: 14, manual: mode(14, 1120, 0.78), aiAssisted: mode(14, 552, 0.91) }
    },
    timingQuality: { valid: 28, zero_active: 0, excessive_idle: 0, unavailable: 2 }
  },
  participants: []
};
const html = renderToStaticMarkup(createElement(TeacherDashboard, { initial: dashboard }));

assert.match(html, /28 \/ 30/);
assert.match(html, /主分析/);
assert.match(html, /中位有效时间/);
assert.match(html, /中位值准确率/);
assert.match(html, /更快且更准确/);
assert.match(html, /AI 建议如何被使用/);
assert.match(html, /初始错误/);
assert.match(html, /设计平衡与计时诊断/);
assert.doesNotMatch(html, /新建项目|配置文献|邀请码/);
```

Assert empty and sample-insufficient states show `—` and the actual `n`, never fabricated zeroes.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:file -- components/teaching/TeacherDashboard.test.tsx`

Expected: FAIL because the current dashboard is project-setup and row-review oriented.

- [ ] **Step 3: Replace setup controls with direct summary cards**

Top cards: completion, median active time comparison and saved percentage, median accuracy comparison and percentage-point delta, and faster-plus-more-accurate count. Every card includes effective paired `n`; null metrics render `—`.

- [ ] **Step 4: Add accessible comparison graphics**

Use semantic HTML plus inline SVG/CSS, without a new chart dependency:

- two horizontal bars for manual vs AI time;
- two bars for accuracy;
- a paired-change table/mini-line view for each student;
- six AI behavior tiles: suggested, adopted, modified, initially incorrect, corrected, and incorrectly adopted;
- paper A/B and sequence balance table;
- completion/exclusion/quality breakdown.

Charts require text equivalents and `aria-label`; color is supplementary, not the only encoding.

- [ ] **Step 5: Keep optional drill-down compact**

Filters cover alias, paper, sequence, completion and timing quality. A detail dialog shows both rounds, field-level automatic score/reason, initial AI value, final value, and any historical manual override side by side. No required review/save action appears in the main flow.

- [ ] **Step 6: Add automatic refresh and export controls**

Refresh dashboard data every 30 seconds while visible, plus manual refresh. Provide normal and anonymized CSV links. Ensure refresh preserves filters and selected detail when the row still exists.

- [ ] **Step 7: Run dashboard, CSV, and accessibility-oriented tests**

Run: `npm run test:file -- components/teaching/TeacherDashboard.test.tsx lib/teachingCsv.test.ts && npm run lint`

Expected: all display/null/export assertions pass; lint exits 0.

- [ ] **Step 8: Commit the dashboard slice**

```bash
git add components/teaching/TeacherDashboard.tsx components/teaching/TeacherDashboard.test.tsx app/teaching/admin/page.tsx lib/teaching.ts lib/teaching/analytics.ts lib/teaching/analytics.test.ts lib/teachingShared.ts lib/teachingCsv.ts lib/teachingCsv.test.ts
git commit -m "feat: show paired teaching experiment dashboard"
```

## Task 10: Complete integration, compatibility, and regression coverage

**Files:**

- Modify: `lib/teaching.test.ts`
- Modify: `app/api/teaching/teachingRoutes.test.ts`
- Modify: `README.md`
- Modify: `.env.local.example`
- Modify: `docs/deployment.md`
- Modify: `docs/superpowers/specs/2026-08-09-zero-config-teaching-experiment-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-zero-config-teaching-experiment.md`

- [ ] **Step 1: Add the 30-student end-to-end service scenario**

In `lib/teaching.test.ts`, preserve every legacy assertion, then create 30 default students. For each student, save and submit both rounds with deterministic answers and heartbeats. Assert 15/15 sequence balance, 60 locked submissions, 30 completed participants, correct automatic field scores, correct completion/paired counts, and SQLite `quick_check = ok`.

- [ ] **Step 2: Add explicit confidentiality regressions**

Serialize the manual workspace and assert it contains none of: `aiInitial`, `ai_snapshot`, `gold`, `scoringRules`, expected values, or the other round's answers. Assert an AI-assisted workspace exposes its own frozen AI suggestion but not gold rules.

- [ ] **Step 3: Add migration re-open and retry coverage**

Close/reopen the teaching database after round 1, restore the same student, and finish round 2. Re-run migrations twice, replay a heartbeat event, replay submit, and assert no duplicate time, participants, submissions, or scores.

- [ ] **Step 4: Document operation, deployment, metrics, and privacy behavior**

Add a concise README section:

```md
### Zero-configuration teaching experiment

Open `/teaching`. Students enter only a pseudonymous ID and complete two automatically assigned rounds; no invite or group code is needed. The server bootstraps the versioned experiment from `config/teaching/default-experiment.v1.json`; teachers do not create projects or grade fields manually. `/teaching/admin` uses `TEACHING_TEACHER_PASSWORD` and shows paired results. Frozen teaching AI suggestions do not need a live AI key.

Runtime submissions remain in `${IONICLINK_DATA_DIR:-<repository>/data}/teaching.db` and are not committed. Teaching migrations are automatic; domain migration/seed/reset commands do not operate on this database. Use a new empty `IONICLINK_DATA_DIR` for a fresh local trial.

The primary analysis uses valid completed pairs and reports active-time/accuracy differences as `AI - manual`, paired medians, bootstrap 95% CIs, Wilcoxon detail, evidence metrics, and AI adoption/correction behavior. Normal CSV includes the entered alias and anonymized CSV uses stable `S001` labels; both exports contain aggregate metrics only, never answer/evidence text, AI suggestions, gold, or scoring rules.
```

- [ ] **Step 5: Run the complete automated verification**

Run: `npm run check`

Expected: lint passes, typecheck passes, every test file passes, and the production build exits 0.

- [ ] **Step 6: Commit integration and documentation**

```bash
git add lib/teaching.test.ts app/api/teaching/teachingRoutes.test.ts README.md .env.local.example docs/deployment.md docs/superpowers/specs/2026-08-09-zero-config-teaching-experiment-design.md docs/superpowers/plans/2026-08-09-zero-config-teaching-experiment.md
git commit -m "test: verify zero-config teaching experiment end to end"
```

## Task 11: Browser verification and final evidence

**Files:**

- Modify only files required by defects found during verification.

- [ ] **Step 1: Start with isolated runtime data**

Run the dev server with a new `IONICLINK_DATA_DIR` created by `mktemp -d`, and set a temporary `TEACHING_TEACHER_PASSWORD`. Do not point browser verification at the user's production `data/teaching.db`.

- [ ] **Step 2: Verify both student sequences**

Using the frontend testing/debugging browser workflow, join two pseudonymous students. Confirm one receives manual→AI and the other AI→manual; manual network/UI payload contains no AI/gold; AI fields are editable; idle/visibility status changes; autosave survives reload; both round transitions and completion work.

- [ ] **Step 3: Seed a complete 30-student fixture through service APIs**

Use the test helper or a dedicated local-only script, not production UI shortcuts. Confirm the dashboard shows 15/15, effective N, time/accuracy deltas, AI behavior, paper/sequence diagnostics, incomplete counts, and null denominators correctly.

- [ ] **Step 4: Verify exports**

Download normal and anonymized CSVs. Confirm BOM, formula escaping, 30 participant rows covering 60 round metric sets, scoring/config versions, paired metrics, and absence of `undefined`/`null` strings. Confirm neither export contains final answer/evidence text, frozen AI text, gold, scoring rules, participant IDs, or free-text exclusion reasons.

- [ ] **Step 5: Re-run the full verification after any browser fix**

Run: `npm run check && git status --short`

Expected: full check exits 0; status contains only intentional implementation changes.

- [ ] **Step 6: Commit verification fixes, if any**

```bash
git add config/teaching lib/teaching lib/teaching.ts lib/teachingShared.ts lib/teachingCsv.ts app/api/teaching app/teaching components/teaching README.md
git commit -m "fix: resolve teaching experiment verification issues"
```

If browser verification found no defect, do not create an empty commit.
