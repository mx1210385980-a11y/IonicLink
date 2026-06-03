# Candidate Review Sheet Design

## Goal

Make the Review Queue useful before records enter the official database. A reviewer should be able to open one tribology candidate, fix obvious extraction mistakes, inspect the supporting evidence, and approve it into the official library without learning the full database editing surface.

## Scope

This iteration only covers tribology Review Queue candidates.

In scope:

- Add a compact `Review` action for candidate rows in the tribology Review Queue.
- Open a right-side candidate review sheet from the table.
- Let the reviewer edit a small set of high-value extracted fields.
- Show field evidence beside the editable fields.
- Save corrections, then approve the candidate through the existing promotion API.
- Show approval blockers and save failures in the sheet.

Out of scope:

- Editing official database records.
- Diffusion candidate correction.
- Batch spreadsheet editing.
- Full evidence relabeling or PDF crop editing.
- Replacing the existing field evidence modal.

## User Experience

The Review Queue remains the entry point. Candidate rows gain a `Review` action near the existing literature and approve controls. Clicking it opens a right-side sheet over the table, leaving the current queue visible in the background.

The sheet has three zones:

1. Candidate header:
   Shows the candidate id, literature title, review status, and a compact readiness state: `Ready` or `Needs fix`.

2. Editable review form:
   Shows only the fields most likely to block or distort a tribology candidate:
   - Ionic liquid / lubricant
   - Probe material
   - Probe geometry
   - Substrate material
   - Substrate coating
   - Load raw/value
   - Speed raw/value
   - Temperature
   - COF raw/value
   - Evidence text
   - Source page

3. Evidence rail:
   Shows the selected field's evidence quote, page, confidence, review state, and available PDF preview. It should default to the first field with a flagged or missing-looking value, otherwise the COF field.

The primary action is `Save & approve`. It first persists corrections, then calls the existing candidate approval endpoint. If approval fails, the sheet remains open and displays the backend reason.

## Data Flow

The sheet receives the selected `RecordResponse` candidate from `IntegratedExplorerWorkspace`.

Opening the sheet:

- Stores the selected candidate in local state.
- Builds an editable draft from the candidate payload.
- Hydrates candidate field evidence with `getCandidateFieldEvidence(candidateId)` using the existing candidate evidence API.

Saving corrections:

- Converts the draft into the backend's existing structured candidate review update calls where possible:
  - COF fields use `updateReviewCandidateCofExtracted`.
  - Load fields use `updateReviewCandidateLoadConditions`.
  - Speed fields use `updateReviewCandidateSpeedConditions`.
  - Probe/substrate fields use `updateReviewCandidateTribologicalSystem`.
- For simple scalar fields that do not fit those structured endpoints, the first implementation should keep them editable only if an existing endpoint supports them. If not, leave them read-only with an evidence-focused message rather than adding a broad backend write API in this iteration.

Approving:

- After successful saves, call `approveReviewCandidate(candidateId)`.
- On success, close the sheet, clear evidence popovers, and refresh the Review Queue with `fetchData()`.
- On failure, show the backend `detail` message in the sheet.

## Readiness

The readiness state is a small helper derived on the frontend for guidance only. Backend approval remains authoritative.

`Needs fix` appears when any of these are true:

- Candidate is missing lubricant / ionic liquid display.
- Candidate has no COF value or raw COF.
- Candidate has neither probe material nor substrate material.
- Required field evidence is flagged.

`Ready` appears when no local blockers are detected.

## Error Handling

Save errors:

- Keep the sheet open.
- Preserve the draft.
- Show the failing field group and backend message when available.

Approve errors:

- Keep the saved draft visible.
- Show the backend approval blocker in an amber message.
- Keep `Save & approve` available after the reviewer changes the draft.

Loading errors:

- Show a compact evidence loading error in the evidence rail.
- Do not block basic field editing.

## Components

New frontend component:

- `frontend/src/components/integrated-explorer/CandidateReviewSheet.vue`

Responsibilities:

- Render the side sheet.
- Own the draft form state.
- Hydrate and display candidate field evidence.
- Emit `saved-and-approved` after successful approval.
- Emit `close` when dismissed.

Existing component changes:

- `RecordTable.vue`: add a `Review` button for candidate rows and emit/call `reviewCandidateRecord(record)`.
- `IntegratedExplorerWorkspace.vue`: own selected candidate state, render `CandidateReviewSheet`, wire save/approve callbacks, refresh data on success.

## Testing

Frontend tests should cover:

- Candidate rows expose a `Review` action in Review Queue.
- `IntegratedExplorerWorkspace` renders `CandidateReviewSheet` with the selected candidate.
- The sheet calls candidate evidence hydration when opened.
- The sheet uses existing structured update APIs before approval when editable groups changed.
- `Save & approve` calls `approveReviewCandidate` only after saves complete.
- Backend approval errors stay visible and keep the sheet open.
- The official database view does not expose candidate correction actions.

Backend tests are not required for this iteration if no backend endpoints are added.

## Acceptance Criteria

- A reviewer can open a candidate review sheet from the tribology Review Queue.
- The reviewer can correct at least COF, load, speed, and tribological system groups using existing APIs.
- The reviewer can see evidence while editing.
- `Save & approve` promotes the corrected candidate into the official database when backend validation passes.
- Approval blockers are understandable without inspecting network logs.
- Official database records remain separate and are not editable through this sheet.
