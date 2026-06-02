# Literature IL Grouped Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a paper-level grouped card view that organizes one literature's tribology rows by ionic liquid and compares the systems tested for each liquid.

**Architecture:** Add a shared frontend grouping helper for `TribologyData[]`, then render a grouped mode in `BatchDataPreview.vue`. The helper is data-only so Review can reuse it later without backend changes.

**Tech Stack:** Vue 3, TypeScript, Vitest, existing Tailwind/ui components.

---

### Task 1: Shared Grouping Helper

**Files:**
- Create: `frontend/src/lib/tribologyGrouping.ts`
- Create: `frontend/src/lib/tribologyGrouping.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests that call `groupTribologyRecordsByIonicLiquid(records)` with:

- two `[BMIM][BF4]` rows in different tribopairs
- one `[EMIM][TFSI]` weak candidate
- one unknown-IL row

Assert that `[BMIM][BF4]` becomes one group with two systems, review counts include weak candidates, and unknown rows are labeled `Unknown IL`.

- [ ] **Step 2: Run helper test red**

Run: `cd frontend && npm run test:run -- src/lib/tribologyGrouping.test.ts`

Expected: fail because `tribologyGrouping.ts` does not exist.

- [ ] **Step 3: Implement minimal helper**

Create `groupTribologyRecordsByIonicLiquid`, `recordNeedsGroupedReview`, `comparisonConditionsForRecord`, and `systemKeyForRecord`. Reuse `formatTribopairLabel` from `api.ts`.

- [ ] **Step 4: Run helper test green**

Run: `cd frontend && npm run test:run -- src/lib/tribologyGrouping.test.ts`

Expected: pass.

### Task 2: Grouped Preview UI

**Files:**
- Modify: `frontend/src/components/BatchDataPreview.vue`
- Create: `frontend/src/components/BatchDataPreview.grouped.test.ts`

- [ ] **Step 1: Write failing static test**

Assert that `BatchDataPreview.vue` imports `groupTribologyRecordsByIonicLiquid`, exposes `previewViewMode`, renders `By ionic liquid`, and iterates `groupedLiquidCards`.

- [ ] **Step 2: Run static test red**

Run: `cd frontend && npm run test:run -- src/components/BatchDataPreview.grouped.test.ts`

Expected: fail until the component is updated.

- [ ] **Step 3: Implement grouped mode**

Add `previewViewMode`, `groupedLiquidCards`, and a compact card template. Keep the existing row list as the default `Rows` mode. Use current buttons and badges; do not create nested cards.

- [ ] **Step 4: Run component test green**

Run: `cd frontend && npm run test:run -- src/components/BatchDataPreview.grouped.test.ts src/lib/tribologyGrouping.test.ts`

Expected: pass.

### Task 3: Verification and Deploy

**Files:**
- No new production files beyond Tasks 1-2.

- [ ] **Step 1: Run focused frontend tests**

Run: `cd frontend && npm run test:run -- src/lib/tribologyGrouping.test.ts src/components/BatchDataPreview.grouped.test.ts`

Expected: pass.

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: pass.

- [ ] **Step 3: Sync to server**

Run: `IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all`

Expected: backend and frontend containers rebuild and start.

- [ ] **Step 4: Remote smoke test**

Run remote health and frontend HTTP checks:

`ssh ioniclink 'cd /opt/ioniclink/repo && docker compose ps && curl -fsS http://127.0.0.1:8000/health && curl -fsSI http://127.0.0.1:80 | head -5'`

Expected: backend healthy and frontend HTTP 200.

