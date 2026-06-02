# Extraction Minimal Upload Flow Design

## Purpose

Make the extraction module small, clear, and publicly usable by turning the current mixed literature/extraction modal into a focused PDF-to-review flow. A first-time user should understand the path without knowing IonicLink internals: add papers, choose extraction mode, run extraction, then review results in Database.

This design follows the approved **A: minimal upload flow** direction.

## Current Problem

The existing PDF extraction entry in `frontend/src/App.vue` already supports upload, metadata parsing, mode selection, extraction progress, retries, and Database handoff. The problem is presentation and flow clarity:

- The modal mixes extraction with literature discovery language such as "Explore the scientific literature", "Find papers", and "List of concepts".
- It exposes placeholder or internal choices, including the unavailable Conductivity mode.
- The extracting state competes for attention with multiple actions, per-paper technical status, and repeated result paths.
- Completed extraction can still lead to a large preview table, while the product direction is Database review as the durable review surface.
- Internal concepts such as run stages, candidates, diagnostics, and backend behavior leak into user-facing copy.

## Goals

- The extraction module reads as one focused tool, not a platform control panel.
- The first screen answers: what do I add, what is selected, and what is the next action?
- A user can process multiple PDFs without understanding agents, queues, run IDs, or backend stages.
- Results move naturally into Database review.
- Retry and change-mode paths remain available for failed or no-data papers.
- Existing backend extraction, polling, cancel, retry, hydration, and Database APIs are preserved.

## Non-Goals

- Do not change extraction backend behavior.
- Do not redesign the full Database modal.
- Do not remove advanced diagnostics from the codebase; hide them from the primary flow.
- Do not implement Conductivity extraction.
- Do not replace the existing app shell or home/library navigation.

## User Flow

### 1. Add Papers

The first modal state is a calm upload surface:

- Title: `Extract papers`
- Large PDF dropzone.
- Selected file list with upload progress and upload errors.
- Primary action: `Continue`.
- Secondary action: close the modal when upload/extraction is not active.

Remove public discovery language from this flow. The user should not see "Find papers", "List of concepts", or "Explore the scientific literature" while using the extraction tool.

### 2. Choose Mode

After upload and metadata parsing, the user sees a compact list of papers:

- Paper title and author line.
- Per-paper segmented control or select with only `Lubrication` and `Diffusion`.
- Auto-selected default based on existing inference.
- Primary action: `Start extraction`.
- Secondary action: `Add more PDFs`.

Conductivity remains unsupported and should not be visible in the main extraction UI.

### 3. Extracting

The extraction screen should feel like progress through a readable task:

- Overall progress bar.
- Human-readable status message.
- One compact card per paper.
- Per-paper states: queued, extracting, ready for review, no reviewable data, failed, stopped.
- Completed paper cards can open Database directly.
- Primary completed action: `Review in Database`.
- Failed/no-data action: `Retry failed`.
- Secondary action: `Change mode`.
- Optional low-emphasis action: `Continue in background`.

Technical logs, run IDs, backend stage names, agent panels, and database metrics are not shown in the primary path. If diagnostics are needed, expose them behind a small `Show diagnostics` affordance.

### 4. Review

The finished state is a summary, not a table-first review workspace:

- Summary: number of papers processed, reviewable rows, rows needing review, and failed/no-data count when relevant.
- Primary action: `Review in Database`.
- Secondary actions: `Upload another PDF`, `Retry failed`, `Change mode`.

The existing extracted-table preview should no longer be the default completion destination. Database review is the canonical review surface.

## Component Boundaries

The current implementation lives mostly in `frontend/src/App.vue`. The first implementation may keep the state in `App.vue`, but the template should be separated into smaller, readable surfaces. Preferred components:

- `ExtractionUploadStep`: dropzone, queued files, upload progress, upload errors.
- `ExtractionModeStep`: parsed paper list and extraction mode selection.
- `ExtractionRunStep`: extraction progress, paper status cards, cancel/background/retry controls.
- `ExtractionReviewStep`: completed summary and Database handoff.

If creating components adds too much churn in the first pass, use clearly named computed helpers and local template sections as an intermediate step. The end state should still have four understandable step boundaries.

## State Model

Keep the existing modal state values if that minimizes risk, but rename the user-facing meaning:

- `upload` maps to Add Papers.
- `select` maps to Choose Mode.
- `setup` should be removed or folded into Choose Mode.
- `extracting` maps to Extracting.
- `results` maps to Review Summary, not table preview.

Existing data sources remain:

- `queuedPdfUploadFiles`
- `uploadedPdfPapers`
- `uploadedPdfPaperExtractionPresets`
- `pdfUploadExtractionItems`
- `pdfUploadExtracting`
- `pdfUploadCompletedExtractionItems`
- `pdfUploadRecoverableExtractionItems`

## Copy Rules

Use research-facing language:

- `Lubrication`, not `Tribology Schema`.
- `Review in Database`, not `Sync to DB`.
- `Rows to review`, not `candidate_count`.
- `No reviewable data found`, not bare `no_data`.
- `Reading tables and figure captions`, not `stage_c.fast_table_wait`.

## Error Handling

- Upload errors stay next to the file that failed.
- Recoverable extraction failures show a concise reason and `Retry failed`.
- No-data papers show `No reviewable data found` and offer `Change mode`.
- Cancelled papers show `Stopped` and offer retry.
- Raw backend error details are available only in diagnostics.

## Testing

Add or update focused frontend tests that assert:

- The extraction modal no longer presents `Find papers`, `List of concepts`, or `Explore the scientific literature` in the primary extraction path.
- Conductivity is not a visible selectable mode.
- The mode step exposes only Lubrication and Diffusion as active choices.
- The completed extraction state emphasizes `Review in Database`.
- Failed, cancelled, and no-data states keep retry or change-mode actions.
- The old table preview is not the default completed extraction destination.

Run:

```bash
cd frontend
npm run test:run
npm run build
```

After implementation verification, synchronize local changes to the remote server using the project deploy command:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

## Acceptance Criteria

- A first-time user can open Extract, upload PDFs, choose Lubrication or Diffusion, start extraction, and land in Database review without encountering internal platform language.
- The extraction modal has a single primary action per step.
- Unavailable Conductivity extraction is not presented as a normal user choice.
- Engineering diagnostics are hidden from the primary flow.
- Existing extraction, retry, cancel, and Database handoff capabilities continue to work.
- Frontend tests and production build pass before deployment.
