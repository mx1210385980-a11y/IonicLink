# Adaptive Tribopair Capsule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Nano / AFM and Macro / Tribometer contact display behavior without splitting the canonical tribology table.

**Architecture:** Add a typed contact display helper in `integratedExplorerHelpers.ts`, then render it from the existing `TribopairCapsule.vue` used by both table row implementations. Add a compact scale lane control in `IntegratedExplorerWorkspace.vue` that drives the existing `selectedExperimentScale` filter.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vitest, existing Tailwind utility classes.

---

### Task 1: Contact Display Model

**Files:**
- Modify: `frontend/src/lib/integratedExplorerHelpers.ts`
- Test: `frontend/src/lib/integratedExplorerHelpers.test.ts`

- [ ] Write failing tests for `contactDisplayModel(record)`:
  - `ball_on_disk` returns `mode: 'macro'`, `pattern: 'ball_disk'`, `primaryRole: 'Ball'`, `secondaryRole: 'Disk'`.
  - `pin_on_disk` returns `Pin` / `Disk`.
  - AFM tip records return `mode: 'nano'`, `pattern: 'probe_substrate'`, `Probe` / `Substrate`.
  - Unknown scale keeps material labels without throwing.
- [ ] Run `npm run test:run -- integratedExplorerHelpers.test.ts` and confirm the new tests fail because the helper is missing.
- [ ] Implement `ContactDisplayModel`, method/scale normalization, macro pattern mapping, and nano fallback.
- [ ] Re-run the helper test and confirm it passes.

### Task 2: Adaptive Capsule UI

**Files:**
- Modify: `frontend/src/components/integrated-explorer/TribopairCapsule.vue`
- Test: helper tests from Task 1 plus production build.

- [ ] Replace direct `tribopairParts` / `tribopairExtras` usage with `contactDisplayModel(record)`.
- [ ] Keep the current vertical visual grammar for `mode === 'nano'`.
- [ ] Add a horizontal engineering visual grammar for `mode === 'macro'`.
- [ ] Use macro role labels such as `Ball`, `Disk`, `Pin`, `Ring`, and never show `Probe` / `Substrate` for clear macro records.
- [ ] Run `npm run build`.

### Task 3: Library Lane Switch

**Files:**
- Modify: `frontend/src/components/integrated-explorer/IntegratedExplorerWorkspace.vue`
- Optional Test: source-level test if the implementation needs guardrails.

- [ ] Add a compact three-choice lane control: `All`, `Nano / AFM`, `Macro / Tribometer`.
- [ ] Wire the control to `selectedExperimentScale` and `handleSearch()`.
- [ ] Hide or disable the lane control when `fixedExperimentScale` is provided.
- [ ] Keep advanced scale filtering intact.
- [ ] Run `npm run build`.

### Task 4: Verify and Deploy

**Files:**
- No new source files expected.

- [ ] Run `npm run test:run -- integratedExplorerHelpers.test.ts`.
- [ ] Run `npm run build`.
- [ ] Deploy with `IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all`.
- [ ] Verify `http://47.82.82.215:8080/` returns 200 and backend health returns healthy.

