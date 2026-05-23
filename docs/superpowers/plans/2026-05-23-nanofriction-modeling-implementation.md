# Nanofriction Modeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent “纳米摩擦智能建模” module inside the Modeling page that loads the built-in thesis dataset, starts the partitioned hybrid model reproduction, and presents the final research evidence in simple professional language.

**Architecture:** Reuse the existing built-in dataset import and model-training endpoints. Add a focused frontend module and small typed helpers for public copy, thesis target metrics, model recipes, and evidence content. Update visible labels in existing modeling surfaces so internal file/person shorthand does not appear to materials students or enterprise users.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vite/Vitest, FastAPI/Python existing services, Chart.js already present in the project.

---

### Task 1: Route And Copy Guard

**Files:**
- Modify: `frontend/src/lib/platform.ts`
- Create: `frontend/src/lib/nanofrictionModule.ts`
- Create: `frontend/src/lib/nanofrictionModule.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Create `frontend/src/lib/nanofrictionModule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_PUBLIC_TERMS,
  NANOFriction_PUBLIC_COPY,
  NANOFriction_TARGET_METRICS,
  containsForbiddenPublicTerm,
} from './nanofrictionModule'
import { normalizeSection, SECTION_OPTIONS_BY_VIEW } from './platform'

describe('nanofriction modeling public module', () => {
  it('registers a dedicated modeling section', () => {
    expect(SECTION_OPTIONS_BY_VIEW.modeling).toContain('nanofriction')
    expect(normalizeSection('modeling', 'nanofriction')).toBe('nanofriction')
  })

  it('keeps public module copy free of internal shorthand', () => {
    const visibleText = JSON.stringify(NANOFriction_PUBLIC_COPY)
    expect(FORBIDDEN_PUBLIC_TERMS.some((term) => visibleText.includes(term))).toBe(false)
    expect(containsForbiddenPublicTerm(visibleText)).toBe(false)
  })

  it('captures the thesis target metrics used by the dashboard', () => {
    expect(NANOFriction_TARGET_METRICS.dataset.totalRows).toBe(212)
    expect(NANOFriction_TARGET_METRICS.dataset.trainingRows).toBe(169)
    expect(NANOFriction_TARGET_METRICS.dataset.testingRows).toBe(37)
    expect(NANOFriction_TARGET_METRICS.dataset.externalRows).toBe(6)
    expect(NANOFriction_TARGET_METRICS.testing.r2).toBe(0.991)
    expect(NANOFriction_TARGET_METRICS.external.r2).toBe(0.985)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: FAIL because `nanofrictionModule.ts` does not exist and the `nanofriction` section is not registered.

- [ ] **Step 3: Add route section and public constants**

In `frontend/src/lib/platform.ts`, add `nanofriction` to `AppSection` and put it in `SECTION_OPTIONS_BY_VIEW.modeling` after `training`.

Create `frontend/src/lib/nanofrictionModule.ts` with:

```ts
export const FORBIDDEN_PUBLIC_TERMS = ['WFF'] as const

export const NANOFriction_PUBLIC_COPY = {
  moduleTitle: '纳米摩擦智能建模',
  moduleShortTitle: '纳米摩擦建模',
  moduleSubtitle: '复现含界面膜厚数据下的分区混合预测模型，并用固定划分、外部文献验证和超低摩擦趋势确认可信度。',
  primaryAction: '开始复现论文模型',
  prepareAction: '载入论文数据',
  evidenceTabs: ['成果总览', '固定划分', '候选模型', '外部验证', '影响因素'],
  steps: ['载入内置数据', '校验固定划分', '复现候选模型', '确认最优模型'],
  status: {
    notReady: '尚未载入数据',
    ready: '数据已准备',
    running: '正在复现模型',
    completed: '复现完成',
    failed: '结果未达到论文目标，建议检查依赖或重新运行',
  },
}

export const NANOFriction_TARGET_METRICS = {
  dataset: {
    totalRows: 212,
    trainingRows: 169,
    testingRows: 37,
    externalRows: 6,
    featureCount: 31,
  },
  testing: { r2: 0.991, mae: 0.057, rmse: 0.089 },
  external: { r2: 0.985, mae: 0.040, rmse: 0.046 },
}

export function containsForbiddenPublicTerm(value: string): boolean {
  return FORBIDDEN_PUBLIC_TERMS.some((term) => value.includes(term))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/platform.ts frontend/src/lib/nanofrictionModule.ts frontend/src/lib/nanofrictionModule.test.ts
git commit -m "Add nanofriction modeling route constants"
```

### Task 2: Training Task Polling Helper

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/nanofrictionModule.test.ts`

- [ ] **Step 1: Write failing API-helper test**

Append this test to `frontend/src/lib/nanofrictionModule.test.ts`:

```ts
import { buildNanofrictionStartPayload } from './nanofrictionModule'

it('builds the fixed reproduction payload for the built-in dataset', () => {
  const payload = buildNanofrictionStartPayload(42, 'μ')

  expect(payload.cleaned_dataset_id).toBe(42)
  expect(payload.target).toBe('μ')
  expect(payload.algorithm).toBe('high_cof_segmented')
  expect(payload.data_options.split_strategy).toBe('wff_thesis')
  expect(payload.data_options.training_view).toBe('all')
  expect(payload.data_options.target_outlier_strategy).toBe('off')
  expect(payload.hyperparameters.base_models).toEqual(['catboost', 'random_forest', 'xgboost'])
  expect(payload.hyperparameters.meta_model).toBe('catboost')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: FAIL because `buildNanofrictionStartPayload` is not defined.

- [ ] **Step 3: Add payload builder and task polling API**

In `frontend/src/lib/nanofrictionModule.ts`, add `buildNanofrictionStartPayload(cleanedDatasetId: number, target = 'μ')`.

In `frontend/src/lib/api.ts`, add:

```ts
export async function getModelTrainingTask(taskId: string) {
    const response = await api.get(`/api/model-training/tasks/${taskId}`)
    return response.data as { task: ModelTrainingTaskSnapshot }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/nanofrictionModule.ts frontend/src/lib/nanofrictionModule.test.ts
git commit -m "Add nanofriction reproduction payload"
```

### Task 3: Dedicated Modeling Page Section

**Files:**
- Modify: `frontend/src/pages/modeling/ModelingPage.vue`
- Create: `frontend/src/components/NanofrictionModelingWorkbench.vue`
- Modify: `frontend/src/lib/nanofrictionModule.ts`

- [ ] **Step 1: Write failing copy test for evidence content**

Append to `frontend/src/lib/nanofrictionModule.test.ts`:

```ts
import {
  NANOFriction_CANDIDATE_MODELS,
  NANOFriction_EXTERNAL_SAMPLES,
  NANOFriction_FEATURE_INSIGHTS,
} from './nanofrictionModule'

it('provides candidate, external validation, and feature insight content', () => {
  expect(NANOFriction_CANDIDATE_MODELS).toHaveLength(3)
  expect(NANOFriction_CANDIDATE_MODELS.find((item) => item.key === 'three_model_fusion')?.external.r2).toBe(0.985)
  expect(NANOFriction_EXTERNAL_SAMPLES).toHaveLength(6)
  expect(NANOFriction_FEATURE_INSIGHTS.map((item) => item.region)).toEqual(['低摩擦区间', '中摩擦区间', '高摩擦区间'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: FAIL because evidence constants are not defined.

- [ ] **Step 3: Add evidence constants**

Add candidate model metrics, six external validation samples, and three region insight summaries to `frontend/src/lib/nanofrictionModule.ts`.

- [ ] **Step 4: Add the Vue module**

Create `frontend/src/components/NanofrictionModelingWorkbench.vue` as a full-screen work surface with:

- A dark scientific header.
- Metric cards for total rows, fixed split, testing R2, external R2, and model structure.
- A left rail showing the four research steps.
- Evidence tabs for “成果总览 / 固定划分 / 候选模型 / 外部验证 / 影响因素”.
- Actions for “载入论文数据” and “开始复现论文模型”.
- No public `WFF` text.

- [ ] **Step 5: Wire the Modeling page**

Update `frontend/src/pages/modeling/ModelingPage.vue`:

- Add a small modeling subnavigation with “通用训练” and “纳米摩擦建模”.
- Render `NanofrictionModelingWorkbench` when `currentSection === 'nanofriction'`.
- Keep `ModelTrainingWorkbench` for other modeling sections.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/NanofrictionModelingWorkbench.vue frontend/src/pages/modeling/ModelingPage.vue frontend/src/lib/nanofrictionModule.ts frontend/src/lib/nanofrictionModule.test.ts
git commit -m "Build nanofriction modeling workbench"
```

### Task 4: Remove Visible Internal Shorthand From Existing Modeling Surfaces

**Files:**
- Modify: `frontend/src/components/ModelTrainingWorkbench.vue`
- Modify: `backend/services/model_cleaning_service.py`
- Modify: `backend/services/model_training_service.py`

- [ ] **Step 1: Search for visible shorthand**

Run:

```bash
rg -n "WFF" frontend/src/components/ModelTrainingWorkbench.vue backend/services/model_cleaning_service.py backend/services/model_training_service.py
```

Expected: shows current user-facing labels that need neutral research wording.

- [ ] **Step 2: Replace public wording**

Change visible labels:

- “WFF 论文数据” → “论文复现数据”
- “WFF 论文固定划分” → “论文固定划分”
- “WFF 论文门控分区复刻” → “论文门控分区复刻”
- “导入 WFF 论文数据” → “导入论文复现数据”
- Dataset names beginning with “WFF 论文复刻” → “论文复现数据集”

Keep internal function names and metadata keys unchanged where they are not displayed.

- [ ] **Step 3: Verify public source copy**

Run:

```bash
rg -n "WFF" frontend/src/components/*.vue frontend/src/pages backend/services/model_cleaning_service.py backend/services/model_training_service.py
```

Expected: no user-facing string remains. Internal function names may remain in `frontend/src/lib/api.ts` and tests may still mention metadata keys.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ModelTrainingWorkbench.vue backend/services/model_cleaning_service.py backend/services/model_training_service.py
git commit -m "Use neutral thesis reproduction wording"
```

### Task 5: Full Verification And Server Sync

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run frontend focused tests**

```bash
npm --prefix frontend run test:run -- src/lib/nanofrictionModule.test.ts src/lib/session.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

```bash
npm --prefix frontend run build
```

Expected: PASS.

- [ ] **Step 3: Run backend syntax check for touched Python services**

```bash
python3 -m py_compile backend/services/model_cleaning_service.py backend/services/model_training_service.py
```

Expected: PASS.

- [ ] **Step 4: Inspect final public copy**

```bash
rg -n "WFF|前端组件|后端接口|数据流|异常处理|测试" frontend/src/components/NanofrictionModelingWorkbench.vue frontend/src/pages/modeling/ModelingPage.vue
```

Expected: no matches.

- [ ] **Step 5: Commit any verification fixes**

```bash
git status --short
git add <changed files>
git commit -m "Polish nanofriction modeling verification"
```

Only run this commit step if Step 1-4 revealed changes.

- [ ] **Step 6: Merge branch back to main**

```bash
cd /Users/julyanffzz/项目/Ioniclink
git merge --no-ff codex/nanofriction-modeling
```

Expected: merge succeeds without touching unrelated uncommitted files.

- [ ] **Step 7: Sync to remote server**

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

Expected: rsync and remote compose complete successfully.

---

## Self-Review

- Spec coverage: route, public naming, no internal shorthand, one-click data/model reproduction, fixed split metrics, candidate comparison, external validation, and factor explanation are covered by Tasks 1-4.
- No placeholders: every task has exact files and commands.
- Type consistency: new route key is `nanofriction`; public constants use `NANOFriction_*`; the training payload uses the existing `high_cof_segmented` algorithm and `wff_thesis` split internally while keeping those strings out of the public module.
