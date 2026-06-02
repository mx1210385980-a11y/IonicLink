# Control Strip Grouped Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse repeated same-system control experiments into compact response strips inside the existing grouped IL card UI.

**Architecture:** Extend the shared tribology grouping helper so both Database records and upload-preview candidate rows can produce control strips. Keep existing card components and interactions, rendering a strip only when exactly one supported control variable varies.

**Tech Stack:** Vue 3, TypeScript, Vitest, existing `RecordTable.vue`, `BatchDataPreview.vue`, and `tribologyGrouping.ts`.

---

### Task 1: Add Control Strip Data Model And Tests

**Files:**
- Modify: `frontend/src/lib/tribologyGrouping.ts`
- Modify: `frontend/src/lib/tribologyGrouping.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests that call the grouping helper with same-system records where only `potential`, `load`, or `water` varies and expect one control strip. Add one test where both `potential` and `load` vary and expect unmerged rows.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm run test:run -- src/lib/tribologyGrouping.test.ts
```

Expected: FAIL because `controlStrips`, `looseRecords`, or equivalent properties do not exist.

- [ ] **Step 3: Implement helper model**

Add exported types:

```ts
export type ControlVariableKey =
  | 'potential'
  | 'load'
  | 'speed'
  | 'temperature'
  | 'water'
  | 'concentration'
  | 'film'
  | 'duration'

export type GroupedControlPoint<TRecord> = {
  key: string
  value: string
  label: string
  records: TRecord[]
  count: number
  responseLabel: string
  tone: 'low' | 'medium' | 'high' | 'unknown'
}

export type GroupedControlStrip<TRecord> = {
  key: string
  variable: ControlVariableKey
  variableLabel: string
  systemLabel: string
  summaryLabel: string
  stableConditions: GroupedCondition[]
  points: GroupedControlPoint<TRecord>[]
  records: TRecord[]
}
```

For Database systems and preview systems, add:

```ts
controlStrips: GroupedControlStrip<RecordResponse>[]
looseRecords: RecordResponse[]
```

and:

```ts
controlStrips: GroupedControlStrip<TribologyData>[]
looseRows: GroupedTribologyRow[]
```

- [ ] **Step 4: Run helper tests to verify GREEN**

Run the same `npm run test:run` command. Expected: PASS.

### Task 2: Render Control Strips In Database Merged IL Cards

**Files:**
- Modify: `frontend/src/components/integrated-explorer/RecordTable.vue`
- Modify: `frontend/src/components/integrated-explorer/RecordTable.structure.test.ts`

- [ ] **Step 1: Write failing structure test**

Add assertions for `controlStrips`, `Control response`, and clickable strip points that call `openEvidenceModal(point.records[0]!)`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm run test:run -- src/components/integrated-explorer/RecordTable.structure.test.ts
```

Expected: FAIL because the component does not render control strips.

- [ ] **Step 3: Implement Database strip rendering**

Inside each grouped system, render `system.controlStrips` before `system.looseRecords`. Preserve existing compact row rendering for `looseRecords`. Each strip point is a button with the original evidence/workspace click path.

- [ ] **Step 4: Run structure and helper tests**

Run:

```bash
cd frontend
npm run test:run -- src/lib/tribologyGrouping.test.ts src/components/integrated-explorer/RecordTable.structure.test.ts
```

Expected: PASS.

### Task 3: Render Control Strips In Upload Preview Grouped Cards

**Files:**
- Modify: `frontend/src/components/BatchDataPreview.vue`
- Modify: `frontend/src/components/BatchDataPreview.grouped.test.ts`

- [ ] **Step 1: Write failing preview structure test**

Assert preview grouped view renders `controlStrips`, uses `point.records`, and keeps `updateRecordField` / `verifyRecord` access for strip points.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm run test:run -- src/components/BatchDataPreview.grouped.test.ts
```

Expected: FAIL because preview grouped cards do not render control strips.

- [ ] **Step 3: Implement preview strip rendering**

Render strip rows with compact chips. Each point button toggles the first record detail. Keep editable fields and verification inside an expanded detail region.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/lib/tribologyGrouping.test.ts src/components/integrated-explorer/RecordTable.structure.test.ts src/components/BatchDataPreview.grouped.test.ts
```

Expected: PASS.

### Task 4: Verify Build And Deploy

**Files:**
- No additional source files expected.

- [ ] **Step 1: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS, allowing existing chunk-size/RDKit warnings.

- [ ] **Step 2: Synchronize remote server**

Run from repo root:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

Expected: frontend/backend containers rebuild and restart.

- [ ] **Step 3: Remote smoke checks**

Run:

```bash
ssh ioniclink "cd /opt/ioniclink/repo && grep -R \"controlStrips\" -n frontend/src/lib/tribologyGrouping.ts frontend/src/components/integrated-explorer/RecordTable.vue frontend/src/components/BatchDataPreview.vue"
curl -fsS http://47.82.82.215/health
```

Expected: grep finds strip code and health returns `{"status":"healthy"}`.

## Self-Review

- Spec coverage: The plan covers generic single-variable controls, Database UI, preview UI, tests, build, and remote sync.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: The plan uses the same `GroupedControlStrip<TRecord>` model in helper and UI tasks.
