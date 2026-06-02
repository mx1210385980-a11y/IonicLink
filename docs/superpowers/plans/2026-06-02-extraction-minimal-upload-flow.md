# Extraction Minimal Upload Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the PDF extraction modal into a minimal public upload flow: add papers, choose mode, extract, then review in Database.

**Architecture:** Keep existing extraction state and backend calls in `frontend/src/App.vue`, but reshape the modal template and helper copy into four clear user-facing steps. Use focused source tests in `frontend/src/App.home-shell.test.ts` to lock the flow, because the existing tests already inspect this large shell component by source contract.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Vite, Tailwind CSS, Vitest source-contract tests.

---

## File Structure

- Modify `frontend/src/App.home-shell.test.ts`
  - Add source-contract tests for the minimal extraction modal.
  - Update existing assertions that intentionally refer to old copy.
- Modify `frontend/src/App.vue`
  - Add small computed helpers for modal title, step labels, extraction summary, and visible extraction modes.
  - Remove discovery navigation from the extraction modal.
  - Fold `setup` into the visible Choose Mode step while preserving the existing `pdfUploadModalStep` values if needed.
  - Replace the visible `results` table-first template with a compact review summary.
  - Keep Database handoff functions intact.
- Do not modify backend files for this feature.
- Do not modify `frontend/src/pages/pipeline/PipelinePage.vue` for this feature unless verification reveals the Extract top-nav no longer opens the modal.

---

### Task 1: Lock the Minimal Modal Contract

**Files:**
- Modify: `frontend/src/App.home-shell.test.ts`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside `describe('App home shell', () => { ... })`, near the existing PDF upload extraction tests:

```ts
const sourceSliceAfter = (start: string, end: string) => {
  const startIndex = source.indexOf(start)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  const endIndex = source.indexOf(end, startIndex)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

  it('presents PDF extraction as a minimal add mode run review flow', () => {
    const modalSource = sourceSliceAfter(
      'v-if="pdfUploadModalOpen"',
      '<!-- Workspace top bar -->',
    )

    expect(source).toContain("const pdfUploadStepLabels = ['Add papers', 'Choose mode', 'Extracting', 'Review']")
    expect(source).toContain('const pdfUploadVisibleExtractionPresetOptions')
    expect(source).toContain('const pdfUploadReviewSummaryStats')
    expect(modalSource).toContain('Extract papers')
    expect(modalSource).toContain('Add papers')
    expect(modalSource).toContain('Choose mode')
    expect(modalSource).toContain('Review')
    expect(modalSource).toContain('Review in Database')
    expect(modalSource).toContain('No reviewable data found')
    expect(modalSource).not.toContain('Explore the scientific literature')
    expect(modalSource).not.toContain('Find papers')
    expect(modalSource).not.toContain('List of concepts')
  })

  it('only exposes supported extraction modes in the public PDF extraction flow', () => {
    const modalSource = sourceSliceAfter(
      'v-if="pdfUploadModalOpen"',
      '<!-- Workspace top bar -->',
    )

    expect(source).toContain('pdfUploadVisibleExtractionPresetOptions = computed')
    expect(source).toContain("option.value !== 'conductivity'")
    expect(modalSource).toContain('pdfUploadVisibleExtractionPresetOptions')
    expect(modalSource).not.toContain('Conductivity')
    expect(modalSource).not.toContain('Coming soon')
    expect(modalSource).not.toContain('Choose Lubrication or Diffusion')
  })

  it('keeps failed and empty extraction outcomes actionable without a table-first results page', () => {
    const resultsSource = sourceSliceAfter(
      'v-else-if="pdfUploadModalStep === \\'results\\'"',
      '<!-- Workspace top bar -->',
    )

    expect(resultsSource).toContain('Review in Database')
    expect(resultsSource).toContain('Retry failed')
    expect(resultsSource).toContain('Change mode')
    expect(resultsSource).toContain('Upload another PDF')
    expect(resultsSource).not.toContain('<table')
    expect(resultsSource).not.toContain('Extracted table')
    expect(resultsSource).not.toContain('Review status')
  })
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: the new tests fail because `pdfUploadStepLabels`, `pdfUploadVisibleExtractionPresetOptions`, `pdfUploadReviewSummaryStats`, and the minimal modal copy do not exist yet.

- [ ] **Step 3: Commit the failing tests only if the team accepts red commits**

Default for this repository: do not commit red tests alone. Keep them unstaged until Task 4 passes.

---

### Task 2: Add Minimal Flow Helpers

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Add helper constants and computed values**

In `frontend/src/App.vue`, after `const pdfUploadExtractionPresetOptions = [...]`, add:

```ts
const pdfUploadVisibleExtractionPresetOptions = computed(() =>
  pdfUploadExtractionPresetOptions.filter((option) => option.value !== 'conductivity'),
)

const pdfUploadStepLabels = ['Add papers', 'Choose mode', 'Extracting', 'Review']

const pdfUploadModalTitle = computed(() => 'Extract papers')

const pdfUploadModalSubtitle = computed(() => {
  if (pdfUploadModalStep.value === 'upload') return 'Add PDF papers and prepare them for extraction.'
  if (pdfUploadModalStep.value === 'select' || pdfUploadModalStep.value === 'setup') return 'Choose what kind of data to extract from each paper.'
  if (pdfUploadModalStep.value === 'extracting') return 'IonicLink is reading the papers and preparing rows for review.'
  return 'Open the extracted rows in Database review.'
})

const pdfUploadReviewSummaryStats = computed(() => {
  const processed = pdfUploadExtractionItems.value.length
  const ready = pdfUploadExtractionItems.value.filter((item) => item.status === 'completed' && item.records > 0).length
  const records = pdfUploadExtractionItems.value.reduce((sum, item) => sum + Math.max(0, Number(item.records || 0)), 0)
  const recoverable = pdfUploadExtractionItems.value.filter((item) => ['no_data', 'failed', 'cancelled'].includes(item.status)).length
  return { processed, ready, records, recoverable }
})
```

- [ ] **Step 2: Update unsupported mode handling to rely on the hidden option**

Keep `pdfUploadExtractionPresetOptions` unchanged so existing logic can still recognize unsupported `conductivity` if stale state exists. Do not render it in the modal. Leave `pdfUploadSelectionHasUnsupportedPreset` and the defensive failed-job branch in `submitPdfUploadExtractionJobs` intact.

- [ ] **Step 3: Run focused tests and verify the helper assertions improve**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: failures now move from missing helper names to missing template/copy changes.

- [ ] **Step 4: Do not deploy during intermediate red/green tasks**

Remote synchronization happens only after full frontend verification in Task 10. Do not run `scripts/deploy-server.sh` while focused tests are intentionally red.

---

### Task 3: Simplify the Modal Shell and Add Papers Step

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Replace the modal header**

In the `v-if="pdfUploadModalOpen"` section, replace the current header title block:

```vue
<h2 id="pdf-upload-modal-title" class="text-lg font-extrabold tracking-tight text-slate-900">
  {{ pdfUploadModalStep === 'upload' ? 'Upload papers' : 'Explore the scientific literature' }}
</h2>
```

with:

```vue
<div class="min-w-0">
  <h2 id="pdf-upload-modal-title" class="truncate text-xl font-black tracking-[-0.03em] text-slate-950">
    {{ pdfUploadModalTitle }}
  </h2>
  <p class="mt-1 text-sm font-semibold text-slate-500">
    {{ pdfUploadModalSubtitle }}
  </p>
</div>
```

- [ ] **Step 2: Add a compact step indicator below the header**

Immediately after the header closing `</div>`, add:

```vue
<div class="mb-4 grid grid-cols-4 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 text-xs font-black text-slate-500">
  <span
    v-for="label in pdfUploadStepLabels"
    :key="label"
    class="rounded-xl px-3 py-2 text-center"
    :class="(
      (label === 'Add papers' && pdfUploadModalStep === 'upload')
      || (label === 'Choose mode' && ['select', 'setup'].includes(pdfUploadModalStep))
      || (label === 'Extracting' && pdfUploadModalStep === 'extracting')
      || (label === 'Review' && pdfUploadModalStep === 'results')
    ) ? 'bg-white text-[#0f7c82] shadow-sm' : 'text-slate-400'"
  >
    {{ label }}
  </span>
</div>
```

- [ ] **Step 3: Update Add Papers copy and primary action**

In the `pdfUploadModalStep === 'upload'` block:

Replace:

```vue
<p class="mt-4 text-base font-extrabold text-violet-600">Drag and drop PDFs</p>
<p class="mt-1 text-sm font-semibold text-violet-500/80">Or click to browse files</p>
```

with:

```vue
<p class="mt-4 text-base font-extrabold text-slate-900">Add PDF papers</p>
<p class="mt-1 text-sm font-semibold text-slate-500">Drop files here or click to browse.</p>
```

Replace the `Upload PDFs` button label:

```vue
{{ pdfUploadUploading ? 'Uploading...' : 'Upload PDFs' }}
```

with:

```vue
{{ pdfUploadUploading ? 'Uploading...' : 'Upload selected PDFs' }}
```

Replace the circular continue button with a text button:

```vue
<button
  type="button"
  class="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0f7c82] px-5 text-sm font-black text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870] disabled:cursor-not-allowed disabled:opacity-55"
  :disabled="pdfUploadUploading || !pdfUploadCanContinueFromUpload"
  @click="continueFromPdfUploadModal"
>
  Continue
  <ArrowRight class="h-4 w-4 stroke-[2.4]" />
</button>
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: tests still fail because the old discovery nav and results table are still present.

---

### Task 4: Fold Select and Setup Into Choose Mode

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Remove discovery navigation bars from select, setup, and extracting templates**

Delete each repeated block shaped like:

```vue
<div class="mb-4 flex overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-sm font-extrabold text-slate-500">
  <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
    <Search class="h-4 w-4" />
    Find papers
  </button>
  <button type="button" class="flex flex-1 items-center justify-center gap-2 bg-white px-4 py-3 text-violet-600 shadow-sm">
    <Upload class="h-4 w-4" />
    Extract data from PDFs
  </button>
  <button type="button" class="flex flex-1 items-center justify-center gap-2 px-4 py-3">
    <LayoutGrid class="h-4 w-4" />
    List of concepts
  </button>
</div>
```

Remove all three occurrences from the modal.

- [ ] **Step 2: Rename the select step content**

In `v-else-if="pdfUploadModalStep === 'select'"`, replace:

```vue
<h3 class="text-xl font-extrabold text-slate-900">Select or upload papers</h3>
```

with:

```vue
<h3 class="text-xl font-extrabold text-slate-900">Choose papers</h3>
```

Replace the paragraph below it with:

```vue
<p class="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">
  {{ uploadedPdfPapers.length }} paper{{ uploadedPdfPapers.length === 1 ? '' : 's' }} ready<span v-if="pdfUploadPendingFileNames.length">, {{ pdfUploadPendingFileNames.length }} still parsing</span>. Select the papers to extract.
</p>
```

- [ ] **Step 3: Make the next action enter mode selection**

Keep `@click="openPdfUploadExtractionSetup"` on the primary button. Change its visible label from:

```vue
Start extraction
```

to:

```vue
Choose mode
```

- [ ] **Step 4: Render only visible extraction modes**

In the `setup` step `<select>`, replace:

```vue
v-for="option in pdfUploadExtractionPresetOptions"
```

with:

```vue
v-for="option in pdfUploadVisibleExtractionPresetOptions"
```

Replace the option text:

```vue
{{ option.label }}{{ option.disabled ? ' · Coming soon' : '' }}
```

with:

```vue
{{ option.label }}
```

- [ ] **Step 5: Update setup step heading**

In the `setup` step, replace:

```vue
<p class="text-xs font-black uppercase tracking-[0.18em] text-violet-500">Extraction mode</p>
<h3 class="mt-1 text-xl font-extrabold text-slate-900">Start extraction</h3>
<p class="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
  Choose how these newly added Library papers should be processed before extraction starts.
</p>
```

with:

```vue
<p class="text-xs font-black uppercase tracking-[0.18em] text-[#0f7c82]">Choose mode</p>
<h3 class="mt-1 text-xl font-extrabold text-slate-900">What should IonicLink extract?</h3>
<p class="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
  Pick Lubrication for COF and tribological conditions, or Diffusion for confined transport values.
</p>
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: discovery-language and Conductivity assertions pass; results-step assertions may still fail.

---

### Task 5: Make Extracting State Readable and Actionable

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Change no-data labels**

In `pdfUploadExtractionStatusLabel`, use this implementation:

```ts
function pdfUploadExtractionStatusLabel(status: PdfUploadExtractionStatus) {
  if (status === 'extracting') return 'Extracting'
  if (status === 'completed') return 'Ready for review'
  if (status === 'no_data') return 'No reviewable data found'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Stopped'
  return 'Queued'
}
```

- [ ] **Step 2: Rename completed card action**

In extracting paper cards, replace the inline completed action text:

```vue
Open in Database
```

with:

```vue
Ready for review
```

Keep the `@click="openPdfUploadResultsInDatabase(item)"` handler unchanged.

- [ ] **Step 3: Reduce competing active-run actions**

In the extracting header actions:

Keep:

```vue
Stop extraction
Continue in background
```

Remove the visible active-run button:

```vue
Stop and upload new PDF
```

Keep `stopPdfUploadExtractionAndUploadNew()` in script for future or non-primary usage.

- [ ] **Step 4: Rename recoverable action**

Replace every visible:

```vue
Review setup
```

with:

```vue
Change mode
```

Replace every visible:

```vue
Retry fresh run
```

with:

```vue
Retry failed
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: only results-table assertions remain if the table template still exists.

---

### Task 6: Replace Table-First Results With Review Summary

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Replace the results template body**

Replace the entire `v-else-if="pdfUploadModalStep === 'results'"` template block with:

```vue
<div v-else-if="pdfUploadModalStep === 'results'">
  <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-xs font-black uppercase tracking-[0.16em] text-[#0f7c82]">Review</p>
        <h3 class="mt-1 text-2xl font-black tracking-tight text-slate-950">Extraction is ready</h3>
        <p class="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
          Open Database to review extracted rows, confirm evidence, and publish clean records.
        </p>
      </div>
      <span class="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-[#0f7c82]">
        {{ pdfUploadReviewSummaryStats.records }} rows to review
      </span>
    </div>

    <div class="mt-6 grid gap-3 sm:grid-cols-4">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Processed</span>
        <strong class="mt-1 block text-2xl font-black text-slate-950">{{ pdfUploadReviewSummaryStats.processed }}</strong>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Ready</span>
        <strong class="mt-1 block text-2xl font-black text-slate-950">{{ pdfUploadReviewSummaryStats.ready }}</strong>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Rows</span>
        <strong class="mt-1 block text-2xl font-black text-slate-950">{{ pdfUploadReviewSummaryStats.records }}</strong>
      </div>
      <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Needs action</span>
        <strong class="mt-1 block text-2xl font-black text-slate-950">{{ pdfUploadReviewSummaryStats.recoverable }}</strong>
      </div>
    </div>

    <div v-if="pdfUploadRecoverableExtractionItems.length > 0" class="mt-5 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3">
      <p class="text-sm font-semibold text-amber-800">
        {{ pdfUploadRecoverableSummaryLabel }}
      </p>
    </div>

    <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
      <button
        type="button"
        class="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:border-teal-300 hover:text-[#0f7c82]"
        @click="uploadAnotherPdfAfterExtraction"
      >
        Upload another PDF
        <Upload class="h-4 w-4" />
      </button>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="pdfUploadRecoverableExtractionItems.length > 0"
          type="button"
          class="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-5 text-sm font-extrabold text-amber-800 transition hover:bg-amber-100"
          @click="changePdfUploadExtractionType"
        >
          Change mode
          <ArrowRight class="h-4 w-4" />
        </button>
        <button
          v-if="pdfUploadRecoverableExtractionItems.length > 0"
          type="button"
          class="inline-flex h-11 items-center gap-2 rounded-xl bg-amber-600 px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-amber-700"
          @click="retryPdfUploadRecoverableExtraction"
        >
          Retry failed
          <ArrowRight class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0f7c82] px-5 text-sm font-extrabold text-white shadow-lg shadow-teal-100 transition hover:bg-[#0b6870]"
          @click="openPdfUploadResultsInDatabase()"
        >
          Review in Database
          <ArrowRight class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Preserve evidence preview functions**

Do not delete `openPdfUploadCellEvidence`, `pdfUploadResultRows`, or row-formatting helpers in this task. They may still be used by source evidence workflows or future diagnostics. This task only removes the table from the primary `results` template.

- [ ] **Step 3: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: all tests in `App.home-shell.test.ts` pass or reveal old assertions that need wording updates.

---

### Task 7: Update Existing Source Tests for New Copy

**Files:**
- Modify: `frontend/src/App.home-shell.test.ts`
- Test: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Update old assertions that conflict with approved copy**

In the existing test `submits uploaded text extractions in parallel and treats transient status errors as retryable`, replace expectations for old copy:

```ts
expect(source).toContain('Stop and upload new PDF')
expect(source).toContain('Retry fresh run')
expect(source).toContain('changePdfUploadExtractionType')
expect(source).not.toContain('Change extraction type')
expect(source).toContain('need retry or a new upload')
```

with:

```ts
expect(source).not.toContain('Stop and upload new PDF')
expect(source).toContain('Retry failed')
expect(source).toContain('changePdfUploadExtractionType')
expect(source).toContain('Change mode')
expect(source).toContain('need retry or a new upload')
```

If this test also expects old discovery copy, replace it with minimal-flow copy:

```ts
expect(source).toContain('Add PDF papers')
expect(source).toContain('Choose mode')
expect(source).toContain('Review in Database')
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm run test:run -- src/App.home-shell.test.ts
```

Expected: `App.home-shell.test.ts` passes.

---

### Task 8: Full Frontend Verification

**Files:**
- Verify: `frontend/src/App.vue`
- Verify: `frontend/src/App.home-shell.test.ts`

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
cd frontend
npm run test:run
```

Expected: Vitest exits with code 0. If unrelated existing tests fail, capture the failing test names and determine whether failures come from this extraction modal change before modifying additional files.

- [ ] **Step 2: Run production build**

Run:

```bash
cd frontend
npm run build
```

Expected: `vue-tsc -b && vite build` exits with code 0.

- [ ] **Step 3: Inspect source for removed primary-path copy**

Run:

```bash
rg -n "Explore the scientific literature|Find papers|List of concepts|Conductivity|Extracted table|Review status|Stop and upload new PDF" frontend/src/App.vue
```

Expected: no matches in the primary modal template. A match is acceptable only if it is in a test, a defensive script branch, or non-rendered historical text; document any acceptable match before finalizing.

---

### Task 9: Browser Verification

**Files:**
- Verify: local frontend app

- [ ] **Step 1: Start the frontend dev server**

Run:

```bash
cd frontend
npm run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173/`.

- [ ] **Step 2: Open the app in the in-app browser**

Open the Vite URL. If login is required and no session exists, use the existing local app flow available in this workspace; do not change authentication code for this feature.

- [ ] **Step 3: Open Extract from the top nav**

Expected:

- Modal title is `Extract papers`.
- Step indicator shows Add papers, Choose mode, Extracting, Review.
- First screen has a PDF dropzone and one clear Continue action.
- There is no `Find papers`, `List of concepts`, or `Explore the scientific literature` text in the modal.

- [ ] **Step 4: Inspect Choose Mode visually**

Use an existing uploaded/cached PDF if available, or upload a small PDF from the repository such as one file under `export/`.

Expected:

- The mode selector only shows Lubrication and Diffusion.
- Conductivity is not visible.
- The primary action is Start extraction.

- [ ] **Step 5: Inspect completion or recoverable state**

Use a cached paper if possible to avoid waiting on a fresh LLM run. If no cached paper is available, verify the static completed/recoverable UI by source and defer live extraction until backend credentials are available.

Expected:

- Completed state emphasizes Review in Database.
- Failed/no-data items offer Retry failed or Change mode.
- No table-first result preview appears as the default completed UI.

---

### Task 10: Commit and Deploy

**Files:**
- Stage only files changed for this feature:
  - `frontend/src/App.vue`
  - `frontend/src/App.home-shell.test.ts`
  - optionally `docs/superpowers/plans/2026-06-02-extraction-minimal-upload-flow.md`

- [ ] **Step 1: Review diff**

Run:

```bash
git diff -- frontend/src/App.vue frontend/src/App.home-shell.test.ts docs/superpowers/plans/2026-06-02-extraction-minimal-upload-flow.md
```

Expected: diff only contains the minimal extraction modal work and this plan.

- [ ] **Step 2: Commit feature changes**

Run:

```bash
git add frontend/src/App.vue frontend/src/App.home-shell.test.ts docs/superpowers/plans/2026-06-02-extraction-minimal-upload-flow.md
git commit -m "feat: simplify extraction upload flow"
```

Expected: commit succeeds without staging unrelated backend or library changes.

- [ ] **Step 3: Deploy to remote server**

Run from repository root:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

Expected: deploy script completes successfully and synchronizes local verified changes to `root@47.82.82.215` through the `ioniclink` SSH alias.

---

## Self-Review

Spec coverage:

- Add Papers is covered by Tasks 3 and 9.
- Choose Mode is covered by Task 4.
- Extracting is covered by Task 5.
- Review Summary and Database handoff are covered by Task 6.
- Copy rules are covered by Tasks 3, 4, 5, 6, and 8.
- Error handling is covered by Tasks 5 and 6.
- Tests, build, browser verification, commit, and deployment are covered by Tasks 1, 7, 8, 9, and 10.

Placeholder scan:

- This plan contains no undefined implementation markers.
- Every code-changing step includes the exact code or exact replacement text.

Type consistency:

- `pdfUploadVisibleExtractionPresetOptions`, `pdfUploadStepLabels`, `pdfUploadModalTitle`, `pdfUploadModalSubtitle`, and `pdfUploadReviewSummaryStats` are introduced before template usage.
- The plan preserves existing `UploadExtractionPreset`, `PdfUploadExtractionStatus`, and `pdfUploadModalStep` types.
