# Fast Reading Report Dual Channel Design

## Purpose

Rebuild the extraction module around the experience the user expects after uploading a paper: the platform should quickly show a normal LLM reading response, similar to uploading the PDF directly to a large-model website.

The current extraction flow is optimized for structured database production. It runs a slow, strict, JSON-oriented pipeline with validation, filtering, candidate persistence, evidence work, and optional visual fallback. That is useful as a later review path, but it is the wrong first experience because it delays visible model output and often spends a lot of time without producing useful records.

## Approved Direction

Use a dual-channel flow, but make the fast reading report the default channel and make structured extraction opt-in.

1. First channel: automatic LLM reading report.
2. Second channel: lightweight candidate generation on demand.
3. Existing deep structured extraction: keep as an advanced manual action, not the default upload behavior.

## Goals

- Show a readable LLM response soon after upload.
- Base the report prompt on IonicLink's accumulated extraction knowledge.
- Preserve the option to create review candidates without forcing it on every upload.
- Stop automatically running the current heavy structured pipeline after upload or first extraction start.
- Make the UI honest about speed and accuracy: report first, candidates later, deep extraction only when requested.
- Persist report output so refreshes and later review sessions can see it.

## Non-Goals

- Do not delete the existing structured extraction pipeline.
- Do not promise automatic high-accuracy database records from the first report.
- Do not make deep visual evidence location part of the default upload path.
- Do not block the user on Database review before they can read the model's output.
- Do not force every report into the fixed tribology schema.

## User Flow

### 1. Upload PDF

The user uploads one or more PDFs as today. Upload still creates or reuses a `Literature` record and stores PDF text/file metadata.

After upload, the frontend immediately opens the reading state for the selected paper.

### 2. Automatic Reading Report

The backend starts a fast `reading_report` job for each newly uploaded paper unless a fresh report already exists.

The UI shows:

- Paper title and basic metadata.
- Report generation state.
- The model's natural language answer as soon as it is ready.

The report should read like a normal LLM answer, not raw JSON or debug telemetry.

### 3. Report Actions

After the report is available, the UI offers:

- `Generate candidates`: run lightweight candidate extraction from the report plus PDF text.
- `Deep extraction`: run the existing heavy pipeline manually.
- `Review in Database`: available only when candidates or records exist.

The default next step should be reading and deciding, not waiting.

### 4. Lightweight Candidate Generation

When the user clicks `Generate candidates`, the backend extracts tentative review candidates using the report and text context. This path should avoid full visual fallback, heavy evidence relocation, and exhaustive page-by-page model calls.

Candidates are saved as review-first rows with conservative status such as `needs_review`. They should be useful starting points, not treated as validated database facts.

### 5. Deep Extraction

`Deep extraction` keeps the existing pipeline available for cases where the user wants the old structured route. The UI must label it as slower and more expensive.

## Reading Report Prompt

Create a dedicated prompt that reuses platform knowledge without requiring JSON:

- Summarize the paper's main topic and contribution.
- Identify the ionic liquids, additives, base oils, substrates, probes, and test systems.
- Extract the important experimental conditions and reported friction/wear/layering/film-thickness signals.
- Highlight rows that may be worth turning into review candidates.
- Preserve rare but meaningful variables, such as current, current density, iron-oxide additive ratio, particle loading, potential, water content, and load/speed ranges.
- State uncertainty clearly when values are inferred, visually estimated, missing, or trend-only.
- Keep evidence references lightweight: page, figure/table label, and short supporting phrase when available.
- End with a concise "candidate extraction plan" describing what the platform could generate next.

The model should respond in readable Markdown. It may include compact tables, but it must not be forced into strict JSON.

## Backend Design

### New Service Boundary

Add a reading-report service near the LLM layer, for example:

- `services/llm/reading_report_service.py`
- prompt constants in `services/llm/prompts.py`

The service should accept:

- `Literature` metadata
- PDF text/content
- optional `pdf_path`
- extractor type, initially `tribology`

It should return:

- report Markdown
- model name/provider
- status
- timing
- optional lightweight source summary

### Persistence

Persist reading reports instead of keeping them only in memory. Prefer a dedicated table if migration cost is acceptable:

- `literature_reading_reports`
- `id`
- `literature_id`
- `extractor_type`
- `status`
- `report_markdown`
- `prompt_version`
- `model`
- `error_message`
- `created_at`
- `updated_at`

If a table migration is too large for the first pass, store a versioned report object inside an existing JSON-capable field only as a temporary bridge. A dedicated table is cleaner because reports have lifecycle, status, and retry behavior.

### API

Add APIs that are separate from the existing heavy extraction endpoint:

- `POST /api/literature/{id}/reading-report`
  Starts or refreshes the report job.
- `GET /api/literature/{id}/reading-report`
  Returns current status and report content.
- `POST /api/literature/{id}/candidate-draft`
  Generates lightweight review candidates from the report and PDF text.
- Keep `POST /api/extract/{id}` as the deep extraction path.

### Job Behavior

Reading reports should run through a lightweight background job path or a small queue lane. It should not wait behind deep extraction if avoidable.

Recommended defaults:

- Reading report timeout: short enough to fail visibly, around 120-240 seconds.
- Candidate draft timeout: moderate, around 180-300 seconds.
- Deep extraction timeout: existing behavior.

### Cache Policy

Use cached reports by default. Regenerate only when:

- user clicks refresh
- prompt version changes
- report failed
- source PDF/content changed

## Frontend Design

### Upload Modal

The extraction modal should move from "Extracting data" as the primary state to "Reading paper".

Primary surface after upload:

- Report status
- Report Markdown viewer
- Paper selector for multi-upload batches
- Lightweight action buttons

Avoid showing raw candidate debug views in the primary flow. Diagnostics can stay behind a low-emphasis control.

### Report UI

Use a readable document-like panel with compact sections and tables. The user should feel that the model has read the paper.

Expected actions:

- `Generate candidates`
- `Deep extraction`
- `Open Database` when review rows exist
- `Retry report` if failed

### Status Language

Use user-facing language:

- `Reading paper`
- `Report ready`
- `Generating candidate rows`
- `Deep extraction running`
- `No candidate rows generated`

Avoid primary-path labels such as:

- `stage_c.claude_pdf`
- `trace_candidates`
- `dropped_by_reason`
- `raw rows`

## Data Flow

1. `uploadFile` creates or reuses a `Literature`.
2. Frontend calls `startReadingReport(literatureId)`.
3. Frontend polls `getReadingReport(literatureId)`.
4. Backend creates or reuses a report job.
5. LLM creates a Markdown report from PDF text and, when supported, PDF file context.
6. Backend persists the report.
7. User reads the report.
8. User optionally clicks `Generate candidates`.
9. Backend creates tentative review candidates from report/text.
10. User optionally goes to Database review.
11. User optionally runs `Deep extraction` for the old heavyweight route.

## Error Handling

- Upload failures remain file-specific.
- Reading report failures show retry and the concise backend error.
- If the report succeeds but candidate generation fails, keep the report visible.
- Candidate generation should not erase existing reviewed records.
- Deep extraction cancellation and failure behavior remains unchanged.

## Testing

Backend tests:

- Starting a report creates or reuses a reading-report record.
- Cached reports are returned without re-calling the model.
- Prompt-version changes can force regeneration.
- Report failures persist status and error message.
- Candidate draft generation does not invoke the heavy extraction pipeline.
- Deep extraction endpoint remains available separately.

Frontend tests:

- Upload flow shows the reading report state before Database review.
- Report Markdown is displayed when available.
- `Generate candidates` is available after report readiness.
- `Deep extraction` is visible as a slower manual action.
- The default upload flow does not automatically present raw structured candidates as the primary output.

Verification commands:

```bash
cd backend
python -m pytest
cd ../frontend
npm run test:run
npm run build
```

After implementation verification, synchronize local changes to the remote server:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

## Acceptance Criteria

- Uploading a literature quickly leads to a visible natural-language LLM report.
- The report is persisted and survives refresh.
- The existing heavy extraction pipeline does not start by default after upload.
- Lightweight candidate generation is user-triggered and produces review-first rows only.
- Deep extraction is still available as an explicit slower action.
- The UI presents report-first language instead of pipeline telemetry in the primary path.
