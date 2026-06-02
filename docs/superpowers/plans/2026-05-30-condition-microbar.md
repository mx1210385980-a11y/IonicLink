# Condition Microbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bulky condition chips in the integrated explorer with a compact, readable microbar that emphasizes experimental parameters.

**Architecture:** Reuse the existing `detailedConditionChips()` data model and add a small view helper that selects the most important parameters for dense table rows. Render those parameters through a focused Vue component shared by `RecordTable.vue` and `VirtualRecordRow.vue`.

**Tech Stack:** Vue 3 SFCs, TypeScript helpers, Vitest source/behavior tests, Tailwind utility classes.

---

### Task 1: Condition Display Helper

**Files:**
- Modify: `frontend/src/lib/integratedExplorerHelpers.ts`
- Test: `frontend/src/lib/integratedExplorerHelpers.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for `conditionMicrobarItems(record)` that require priority ordering (`load`, `speed`, `potential` first), compact labels (`F`, `v`, `ψ`, `T`), and overflow count.

- [x] **Step 2: Implement helper**

Create `ConditionMicrobarItem` and `conditionMicrobarItems(record, maxVisible = 4)`. Do not include surface roughness, because surface details belong to Tribopair.

### Task 2: Condition Microbar Component

**Files:**
- Create: `frontend/src/components/integrated-explorer/ConditionMicrobar.vue`
- Test: `frontend/src/components/integrated-explorer/ConditionMicrobar.source.test.ts`

- [x] **Step 1: Write source guard tests**

Assert the component uses `conditionMicrobarItems`, renders `item.symbol`, `item.value`, `item.unit`, `+overflow`, and keeps `surfaceRoughnessBadge` out.

- [x] **Step 2: Implement component**

Render a quiet one-line parameter rail with small symbols, number/unit split, and an overflow marker.

### Task 3: Integrate Table Rows

**Files:**
- Modify: `frontend/src/components/integrated-explorer/RecordTable.vue`
- Modify: `frontend/src/components/integrated-explorer/VirtualRecordRow.vue`

- [x] **Step 1: Replace old chips**

Use `<ConditionMicrobar :record="record" />` in both row components and remove old `conditionGroups` / roughness chip imports from those files.

### Task 4: Verify and Deploy

**Files:**
- Run tests and build
- Deploy frontend to `root@47.82.82.215`

- [x] **Step 1: Verify locally**

Run:

```bash
cd frontend && npm run test:run -- integratedExplorerHelpers.test.ts ConditionMicrobar.source.test.ts
cd frontend && npm run build
```

- [x] **Step 2: Sync remote**

Run:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh frontend
```
