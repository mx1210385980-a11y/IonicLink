# Weak Candidate Unified Review Design

## Goal

Make tribology extraction succeed more often on newly uploaded literature by admitting useful but incomplete extraction candidates, marking them clearly as low-confidence, and showing candidate rows and formal records through one user-friendly review surface.

## Background

Recent production evidence showed that the extractor can produce many raw candidates while still finalizing as `no_data`. For example, literature `124` in `standard` profile produced raw text candidates on multiple pages, but strict validation kept zero records and returned `no_data`.

That behavior is too brittle for new literature testing. A user should not see an empty result when the model found plausible friction-performance information. The system should instead preserve those candidates, explain what is missing, and let the user review, edit, and publish them.

## Success Criteria

- New tribology extractions return one of three clear outcomes:
  - `completed`: high-confidence records were extracted.
  - `needs_review`: weak candidates were extracted and need user confirmation.
  - `no_data`: no raw candidates or fallback candidates were found.
- `raw_candidates > 0` no longer collapses directly into `no_data` only because strict validation rejected every item.
- Candidate rows and formal records render in a unified result list with consistent field names, evidence display, status labels, and actions.
- Users can edit weak candidate fields, inspect source evidence, and publish a candidate into the formal table.
- Formal records remain distinguishable from candidates for training, export, and quality control.

## Data Model Semantics

The existing two-layer storage model remains:

- `RecordCandidate`: broad intake layer. It may contain incomplete records, low-confidence values, extracted text snippets, and review metadata.
- `TribologyDataDB`: formal data layer. It contains confirmed or high-confidence records suitable for ordinary data exploration and model training.

The extractor should write weak results to `RecordCandidate`, not directly to `TribologyDataDB`.

Each candidate should carry review metadata:

- `review_status`: `needs_review`, `ready`, `confirmed`, or `published`.
- `confidence_tier`: `low`, `medium`, or `high`.
- `admission_reason`: `strict_validated`, `weak_candidate`, `fallback_table`, or `visual_estimate`.
- `missing_fields`: list of important absent fields such as `ionic_liquid`, `material_name`, `cof`, `normal_load`, or `speed`.
- `quality_notes`: concise user-facing explanation of why the row needs review.

Existing JSON fields such as `field_evidence_json`, `cof_extracted_json`, and candidate metadata fields can hold this information if the current schema already supports them. New columns should only be added if serialization from existing fields becomes awkward or query-heavy.

## Extraction Admission Policy

Strict validation remains the preferred path. Rows that satisfy the current core quantitative and ionic-liquid checks can continue through the existing high-confidence route.

When strict validation rejects all rows, the pipeline should run a weak-candidate admission pass over normalized raw candidates.

A weak candidate can be admitted when it has at least one credible performance signal and at least one material or context signal:

- Performance signal examples:
  - explicit `cof`
  - explicit `friction_force`
  - explicit `normal_load`
  - explicit `wear`
  - explicit friction-relevant comparison such as lower/higher friction tied to a named system
- Context signal examples:
  - ionic liquid or lubricant name
  - substrate or probe material
  - figure/table/source page with friction context
  - method context such as AFM, SFA, tribometer, ball-on-disk, or colloid probe

Weak admission must not invent missing values. It preserves what was found, marks missing fields, and gives the user a clear review task.

`no_data` should only be used when all extraction channels find nothing useful:

- no raw LLM candidates
- no weak candidates
- no fallback table records
- no canonical cache recovery

## Unified API Shape

Backend serializers should expose candidates and records through one display shape:

```json
{
  "entity_type": "candidate",
  "entity_id": 123,
  "literature_id": 124,
  "review_status": "needs_review",
  "confidence_tier": "low",
  "admission_reason": "weak_candidate",
  "missing_fields": ["normal_load", "speed"],
  "quality_notes": "COF was extracted, but load and sliding speed were not confirmed.",
  "fields": {
    "ionic_liquid": "[EMIM][TFSI]",
    "material_name": "graphene",
    "cof": "0.08",
    "normal_load": null,
    "speed": null,
    "temperature": "298.15 K",
    "evidence": "The friction coefficient was approximately 0.08..."
  },
  "source": {
    "page": 4,
    "label": "Fig. 2",
    "source_type": "text"
  }
}
```

Formal records use the same shape with `entity_type: "record"` and suitable status values such as `published` or `confirmed`.

Existing endpoints can be extended if they already return review rows. A new endpoint should only be introduced if it avoids forcing unrelated consumers to handle mixed candidate/record payloads.

## Frontend Experience

The user should see one extraction result list.

Each row should make its state obvious:

- `Needs review`: extracted as a weak candidate.
- `Ready`: candidate has enough required fields to publish after review.
- `Published`: formal record already exists.
- `Low confidence`: evidence or fields are incomplete.
- Missing-field chips such as `Missing load`, `Missing speed`, or `Missing IL`.

Users should be able to:

- edit candidate fields inline or in the existing review editor,
- open source evidence,
- confirm a candidate,
- publish a candidate into the formal table,
- distinguish weak candidates from formal records without switching pages.

No result view should simply show `NoData` when weak candidates exist. The message should say that candidates were found and need review.

## Status Semantics

Extraction runs should use these result semantics:

- `completed`: at least one formal record was produced or cached.
- `needs_review`: at least one weak candidate was produced and no formal records were produced.
- `no_data`: no formal records, no weak candidates, and no fallback records were produced.
- `failed`: infrastructure or unrecoverable processing error.
- `cancelled`: user stopped the run.

If the existing `ExtractionRun.status` enum or frontend status handling cannot accept `needs_review` safely, the backend may keep the stored run status as `completed` while setting `extraction_summary.review_status = "needs_review"` and `candidate_count > 0`. The API response should still make the user-facing status unambiguous.

## Testing Strategy

Backend tests should cover:

- raw candidates rejected by strict validation are saved as weak candidates instead of returning `no_data`;
- weak candidates include `review_status`, `confidence_tier`, `admission_reason`, `missing_fields`, and evidence;
- true empty extraction still returns `no_data`;
- mixed candidate and formal record serialization uses one display shape;
- candidate publish flow creates or updates a formal `TribologyDataDB` record without losing evidence.

Frontend tests should cover:

- extraction result panels render candidate and record rows together;
- weak candidates display user-friendly labels and missing-field chips;
- publish/confirm actions are shown for candidates and not for already published records;
- `NoData` empty states are not shown when candidate rows exist.

## Rollout Plan

Ship this behind existing extraction behavior without changing the user's workflow:

1. Add backend weak-candidate admission and serialization tests.
2. Save weak candidates from tribology extraction when strict validation yields zero records.
3. Extend API response summaries so the frontend can distinguish `needs_review` from true `no_data`.
4. Update the extraction/review UI to render mixed candidate and record rows consistently.
5. Verify on literature `124` and at least two additional new tribology PDFs.

## Non-Goals

- Do not auto-promote low-confidence weak candidates into the formal training dataset.
- Do not weaken diffusion extraction rules in this design.
- Do not redesign the whole review page layout.
- Do not require visual extraction for text-only success.
