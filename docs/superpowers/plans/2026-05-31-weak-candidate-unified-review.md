# Weak Candidate Unified Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve useful but incomplete tribology extraction results as reviewable weak candidates and show weak candidates and formal records through one consistent user experience.

**Architecture:** Add a focused weak-candidate admission helper, integrate it into the tribology persistence path only when strict validation produces zero records, then extend existing serializers and frontend review helpers to surface candidate quality metadata. Reuse `RecordCandidate`, existing candidate approval endpoints, and existing review UI rather than adding a parallel workflow.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest, Vue 3, TypeScript, Vitest.

---

## File Structure

- Create `backend/services/weak_candidate_service.py`
  - Pure helper functions for weak admission, missing-field analysis, quality notes, and metadata decoration.
- Create `backend/test_weak_candidate_service.py`
  - Unit tests for weak admission behavior.
- Modify `backend/services/file_service.py`
  - Persist weak candidates when `records` is empty but trace candidates contain useful normalized rows.
  - Return `review_status: needs_review` in `extraction_summary`.
- Modify `backend/routers/extraction.py`
  - Add unified display metadata to `_tribology_record_api_payload`.
  - Ensure run candidate endpoints expose weak-candidate metadata.
- Modify `backend/test_extraction_pipeline_upgrade.py`
  - Add a backend serialization test for candidate/formal unified display shape.
- Modify `frontend/src/lib/api.ts`
  - Add optional weak-candidate metadata fields to `TribologyData` and extraction summary types.
- Modify `frontend/src/lib/extractionReview.ts`
  - Treat explicit backend `needs_review` and weak-candidate metadata as review-required.
  - Add helpers for confidence tier labels and missing-field labels.
- Modify `frontend/src/lib/extractionReview.test.ts`
  - Cover weak-candidate status and label helpers.
- Modify `frontend/src/App.vue`
  - In PDF upload results, show weak-candidate chips and avoid `NoData` when rows exist.

## Task 1: Weak Candidate Admission Helper

**Files:**
- Create: `backend/services/weak_candidate_service.py`
- Test: `backend/test_weak_candidate_service.py`

- [ ] **Step 1: Write failing helper tests**

Create `backend/test_weak_candidate_service.py`:

```python
from services.weak_candidate_service import build_weak_candidate_items


def test_build_weak_candidate_items_admits_metric_with_context_and_marks_missing_fields():
    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "page": 4,
            "raw": {"cof": "0.08"},
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": 4,
                "source": "Plain text",
                "evidence": "The coefficient of friction was 0.08 for [EMIM][TFSI] on graphene.",
            },
            "drop_reason": "no_target_metric",
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert summary == {"weak_candidate_count": 1}
    assert len(items) == 1
    item = items[0]
    assert item["ionic_liquid"] == "[EMIM][TFSI]"
    assert item["material_name"] == "graphene"
    assert item["cof"] == "0.08"
    assert item["record_origin"] == "weak_candidate"
    assert item["review_status"] == "needs_review"
    assert item["confidence"] == 0.52
    assert item["confidence_tier"] == "low"
    assert item["admission_reason"] == "weak_candidate"
    assert item["missing_fields"] == ["normal_load", "speed"]
    assert "load and sliding speed" in item["quality_notes"]


def test_build_weak_candidate_items_rejects_rows_without_metric_or_context_signal():
    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "raw": {"notes": "The article discusses lubrication generally."},
            "normalized": {
                "notes": "The article discusses lubrication generally.",
                "source_page": 2,
            },
            "drop_reason": "no_core_quant_signal",
        }
    ]

    items, summary = build_weak_candidate_items(trace_candidates)

    assert items == []
    assert summary == {"weak_candidate_count": 0}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_weak_candidate_service.py -q
```

Expected: import failure for `services.weak_candidate_service`.

- [ ] **Step 3: Implement the helper**

Create `backend/services/weak_candidate_service.py`:

```python
from __future__ import annotations

from typing import Any


_EMPTY_VALUES = {"", "-", "--", "n/a", "na", "none", "null", "unknown", "unknown il", "unknown material"}
_IMPORTANT_FIELDS = ("ionic_liquid", "material_name", "cof", "normal_load", "speed")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _has_value(value: Any) -> bool:
    return _text(value).lower() not in _EMPTY_VALUES


def _first_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if _has_value(value):
            return value
    return None


def _has_performance_signal(item: dict[str, Any]) -> bool:
    if _first_value(item, "cof", "cof_raw", "friction_force", "normal_load", "load", "wear_rate"):
        return True
    combined = " ".join(_text(item.get(key)).lower() for key in ("evidence", "notes", "source"))
    return any(token in combined for token in ("friction", "coefficient of friction", "cof", "wear", "load"))


def _has_context_signal(item: dict[str, Any]) -> bool:
    if _first_value(item, "ionic_liquid", "lubricant", "material_name", "probe_material", "substrate_material"):
        return True
    combined = " ".join(_text(item.get(key)).lower() for key in ("evidence", "notes", "source", "source_figure"))
    return any(token in combined for token in ("afm", "sfa", "tribometer", "graphene", "mica", "steel", "graphite"))


def _missing_fields(item: dict[str, Any]) -> list[str]:
    aliases = {
        "ionic_liquid": ("ionic_liquid", "lubricant"),
        "material_name": ("material_name", "probe_material", "substrate_material"),
        "cof": ("cof", "cof_raw", "cof_extracted"),
        "normal_load": ("normal_load", "load"),
        "speed": ("speed", "sliding_speed"),
    }
    missing = []
    for field in _IMPORTANT_FIELDS:
        if not any(_has_value(item.get(key)) for key in aliases[field]):
            missing.append(field)
    return missing


def _quality_notes(missing: list[str]) -> str:
    if not missing:
        return "Candidate was admitted for review from weak extraction evidence."
    labels = {
        "ionic_liquid": "ionic liquid",
        "material_name": "material",
        "cof": "COF",
        "normal_load": "load",
        "speed": "sliding speed",
    }
    readable = [labels.get(field, field) for field in missing]
    if len(readable) == 1:
        missing_text = readable[0]
    else:
        missing_text = ", ".join(readable[:-1]) + f" and {readable[-1]}"
    return f"Candidate was admitted for review, but {missing_text} were not confirmed."


def _candidate_source(trace: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    page = item.get("source_page") or trace.get("page")
    return {
        "page": page,
        "label": item.get("source_figure") or item.get("source"),
        "source_type": trace.get("modality") or "text",
    }


def build_weak_candidate_items(trace_candidates: list[dict[str, Any]], *, limit: int = 50) -> tuple[list[dict[str, Any]], dict[str, int]]:
    weak_items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()

    for trace in trace_candidates or []:
        item = dict(trace.get("normalized") or trace.get("raw") or {})
        if not item:
            continue
        if not _has_performance_signal(item) or not _has_context_signal(item):
            continue

        item.setdefault("ionic_liquid", item.get("lubricant") or "Unknown IL")
        item.setdefault("material_name", _first_value(item, "material_name", "substrate_material", "probe_material") or "Unknown Material")
        item.setdefault("source_page", trace.get("page"))
        item.setdefault("source", item.get("source_figure") or "Extracted weak candidate")

        missing = _missing_fields(item)
        dedupe_key = (
            _text(item.get("ionic_liquid")).lower(),
            _text(item.get("material_name")).lower(),
            _text(item.get("cof") or item.get("friction_force") or item.get("normal_load")).lower(),
            _text(item.get("source_page")),
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        source = _candidate_source(trace, item)
        item.update(
            {
                "record_origin": "weak_candidate",
                "review_status": "needs_review",
                "confidence": min(float(item.get("confidence") or 0.52), 0.52),
                "confidence_tier": "low",
                "admission_reason": "weak_candidate",
                "missing_fields": missing,
                "quality_notes": _quality_notes(missing),
                "weak_candidate_source": source,
                "assembly_notes": _quality_notes(missing),
            }
        )
        weak_items.append(item)
        if len(weak_items) >= limit:
            break

    return weak_items, {"weak_candidate_count": len(weak_items)}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_weak_candidate_service.py -q
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/services/weak_candidate_service.py backend/test_weak_candidate_service.py
git commit -m "feat: add weak candidate admission helper"
```

## Task 2: Persist Weak Candidates Instead Of NoData

**Files:**
- Modify: `backend/services/file_service.py`
- Test: `backend/test_weak_candidate_persistence.py`

- [ ] **Step 1: Write failing persistence tests**

Create `backend/test_weak_candidate_persistence.py`:

```python
import pytest
from sqlalchemy import select

from models.db_models import Literature, RecordCandidate
from services.file_service import _persist_weak_candidates_for_review


@pytest.mark.anyio
async def test_persist_weak_candidates_marks_literature_completed_for_review(db_session):
    literature = Literature(
        title="Weak candidate paper",
        content="Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
        status="extracting",
    )
    db_session.add(literature)
    await db_session.flush()

    trace_candidates = [
        {
            "stage": "stage_c",
            "modality": "text",
            "page": 2,
            "normalized": {
                "ionic_liquid": "[EMIM][TFSI]",
                "material_name": "graphene",
                "cof": "0.08",
                "source_page": 2,
                "evidence": "Friction coefficient was 0.08 for [EMIM][TFSI] on graphene.",
            },
            "drop_reason": "no_target_metric",
        }
    ]

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=trace_candidates,
        file_path=None,
    )

    rows = (
        await db_session.execute(
            select(RecordCandidate).where(RecordCandidate.literature_id == literature.id)
        )
    ).scalars().all()

    assert literature.status == "completed"
    assert literature.error_message is None
    assert weak_summary["review_status"] == "needs_review"
    assert weak_summary["weak_candidate_count"] == 1
    assert len(rows) == 1
    assert rows[0].record_origin == "weak_candidate"
    assert rows[0].review_status == "needs_review"
    assert rows[0].confidence <= 0.52
    assert response_rows[0]["review_entity_type"] == "candidate"
    assert response_rows[0]["admission_reason"] == "weak_candidate"
    assert response_rows[0]["confidence_tier"] == "low"
    assert response_rows[0]["missing_fields"] == ["normal_load", "speed"]


@pytest.mark.anyio
async def test_persist_weak_candidates_returns_empty_for_true_no_data(db_session):
    literature = Literature(title="No data paper", content="Background only.", status="extracting")
    db_session.add(literature)
    await db_session.flush()

    response_rows, weak_summary = await _persist_weak_candidates_for_review(
        db_session,
        literature=literature,
        trace_candidates=[],
        file_path=None,
    )

    assert response_rows == []
    assert weak_summary == {"weak_candidate_count": 0}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_weak_candidate_persistence.py -q
```

Expected: import failure for `_persist_weak_candidates_for_review`.

- [ ] **Step 3: Add persistence helper to `file_service.py`**

Add imports near existing service imports:

```python
from services.weak_candidate_service import build_weak_candidate_items
```

Add this helper near `_build_db_record_from_item`:

```python
async def _persist_weak_candidates_for_review(
    db: AsyncSession,
    *,
    literature: Literature,
    trace_candidates: list[dict[str, Any]],
    file_path: Optional[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    weak_items, weak_summary = build_weak_candidate_items(trace_candidates)
    if not weak_items:
        return [], weak_summary

    await db.execute(delete(RecordCandidate).where(RecordCandidate.literature_id == literature.id))
    await db.execute(delete(TribologyData).where(TribologyData.literature_id == literature.id))

    db_rows: list[RecordCandidate] = []
    response_rows: list[tuple[RecordCandidate, dict[str, Any]]] = []
    for item in weak_items:
        db_record, response_item = _build_db_record_from_item(
            literature_id=literature.id,
            item=item,
            file_path=file_path,
            record_origin="weak_candidate",
            model_cls=RecordCandidate,
        )
        db_record.review_status = "needs_review"
        db_record.record_origin = "weak_candidate"
        db_record.confidence = min(float(getattr(db_record, "confidence", 0.52) or 0.52), 0.52)
        db_record.assembly_notes = item.get("quality_notes") or db_record.assembly_notes
        response_item.update(
            {
                "review_status": "needs_review",
                "record_origin": "weak_candidate",
                "review_entity_type": "candidate",
                "confidence": db_record.confidence,
                "confidence_tier": item.get("confidence_tier") or "low",
                "admission_reason": item.get("admission_reason") or "weak_candidate",
                "missing_fields": item.get("missing_fields") or [],
                "quality_notes": item.get("quality_notes"),
            }
        )
        db_rows.append(db_record)
        response_rows.append((db_record, response_item))

    db.add_all(db_rows)
    await db.flush()

    data: list[dict[str, Any]] = []
    for db_record, response_item in response_rows:
        response_item["id"] = str(db_record.id)
        data.append(response_item)

    literature.status = "completed"
    literature.error_message = None

    return data, {
        **weak_summary,
        "review_status": "needs_review",
        "candidate_count": len(data),
        "final_count": 0,
        "admission_reason": "weak_candidate",
    }
```

- [ ] **Step 4: Integrate helper in `process_file_safe`**

In `process_file_safe`, after the `if records:` persistence block and before the current no-data finalization branch, add:

```python
            if not records:
                weak_rows, weak_summary = await _persist_weak_candidates_for_review(
                    db,
                    literature=literature,
                    trace_candidates=trace_candidates,
                    file_path=resolved_file_path,
                )
                if weak_rows:
                    await add_extraction_candidates(db, run_id=run_id, candidates=trace_candidates)
                    extraction_summary = {
                        "run_id": run_id,
                        "candidate_count": len(weak_rows),
                        "final_count": 0,
                        "weak_candidate_count": len(weak_rows),
                        "review_status": "needs_review",
                        "status": "needs_review",
                        "dropped_by_reason": llm_summary.get("dropped_by_reason") or {},
                        "page_coverage": llm_summary.get("page_coverage") or {},
                        "page_candidate_counts": llm_summary.get("page_candidate_counts") or {},
                        "progress_log": [
                            *list(llm_summary.get("progress_log") or []),
                            {
                                "stage": "stage_e.weak_candidates",
                                "message": f"{len(weak_rows)} weak candidates need review.",
                            },
                        ],
                        "current_stage": "stage_e.weak_candidates",
                        "current_message": f"{len(weak_rows)} weak candidates need review.",
                        "admission_reason": "weak_candidate",
                    }
                    await finalize_extraction_run(
                        db,
                        run_id=run_id,
                        status="completed",
                        candidate_count=len(weak_rows),
                        final_count=0,
                        dropped_by_reason=extraction_summary["dropped_by_reason"],
                        summary=extraction_summary,
                        error_message=None,
                    )
                    await db.commit()
                    return metadata, weak_rows, extraction_summary
```

Stored run status remains `completed` for compatibility; `extraction_summary.review_status` and `status` carry the user-facing `needs_review` meaning.

- [ ] **Step 5: Run backend tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_weak_candidate_service.py backend/test_weak_candidate_persistence.py -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/file_service.py backend/test_weak_candidate_persistence.py
git commit -m "feat: persist weak candidates for review"
```

## Task 3: Unified Backend Serialization Metadata

**Files:**
- Modify: `backend/routers/extraction.py`
- Test: `backend/test_extraction_pipeline_upgrade.py`

- [ ] **Step 1: Write failing serializer tests**

Append to `backend/test_extraction_pipeline_upgrade.py`:

```python
from models.db_models import RecordCandidate, TribologyData as TribologyDataDB
from routers.extraction import _tribology_record_api_payload


def test_tribology_payload_exposes_unified_weak_candidate_metadata():
    candidate = RecordCandidate(
        id=17,
        literature_id=124,
        material_name="graphene",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.08",
        source_page=4,
        evidence="COF was 0.08 for [EMIM][TFSI] on graphene.",
        confidence=0.52,
        review_status="needs_review",
        record_origin="weak_candidate",
        assembly_notes="Candidate was admitted for review, but load and sliding speed were not confirmed.",
    )

    payload = _tribology_record_api_payload(candidate)

    assert payload["entity_type"] == "candidate"
    assert payload["entity_id"] == 17
    assert payload["review_entity_type"] == "candidate"
    assert payload["confidence_tier"] == "low"
    assert payload["admission_reason"] == "weak_candidate"
    assert payload["missing_fields"] == ["normal_load", "speed"]
    assert payload["quality_notes"].startswith("Candidate was admitted")
    assert payload["fields"]["ionic_liquid"] == "[EMIM][TFSI]"
    assert payload["fields"]["cof"] == "0.08"
    assert payload["source"]["page"] == 4


def test_tribology_payload_exposes_formal_record_as_same_display_shape():
    record = TribologyDataDB(
        id=33,
        literature_id=124,
        material_name="graphene",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.08",
        source_page=4,
        confidence=0.91,
        review_status="approved",
        record_origin="llm_extraction",
    )

    payload = _tribology_record_api_payload(record)

    assert payload["entity_type"] == "record"
    assert payload["entity_id"] == 33
    assert payload["review_entity_type"] == "record"
    assert payload["confidence_tier"] == "high"
    assert payload["fields"]["material_name"] == "graphene"
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_extraction_pipeline_upgrade.py::test_tribology_payload_exposes_unified_weak_candidate_metadata backend/test_extraction_pipeline_upgrade.py::test_tribology_payload_exposes_formal_record_as_same_display_shape -q
```

Expected: KeyError for the new display keys.

- [ ] **Step 3: Add display metadata helpers in `routers/extraction.py`**

Add helper functions near `_tribology_record_api_payload`:

```python
def _confidence_tier(score: Any) -> str:
    try:
        value = float(score)
    except Exception:
        value = 0.0
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


def _tribology_missing_fields(payload: dict[str, Any]) -> list[str]:
    groups = {
        "ionic_liquid": ("ionic_liquid", "lubricant"),
        "material_name": ("material_name", "probe_material", "substrate_material"),
        "cof": ("cof", "cof_raw", "cof_extracted"),
        "normal_load": ("normal_load", "load"),
        "speed": ("speed",),
    }
    missing = []
    for label, keys in groups.items():
        if not any(str(payload.get(key) or "").strip() for key in keys):
            missing.append(label)
    return missing


def _quality_notes_for_payload(payload: dict[str, Any], missing: list[str]) -> str | None:
    existing = str(payload.get("assembly_notes") or "").strip()
    if existing:
        return existing
    if payload.get("record_origin") != "weak_candidate":
        return None
    if not missing:
        return "Weak candidate is ready for review."
    labels = {
        "ionic_liquid": "ionic liquid",
        "material_name": "material",
        "cof": "COF",
        "normal_load": "load",
        "speed": "sliding speed",
    }
    readable = [labels.get(field, field) for field in missing]
    if len(readable) == 1:
        missing_text = readable[0]
    else:
        missing_text = ", ".join(readable[:-1]) + f" and {readable[-1]}"
    return f"Candidate needs review because {missing_text} were not confirmed."
```

- [ ] **Step 4: Extend `_tribology_record_api_payload`**

Before `return annotate_tribology_payload_quality(payload)`, add:

```python
    missing_fields = _tribology_missing_fields(payload)
    confidence_tier = _confidence_tier(payload.get("confidence") or getattr(record, "confidence", None))
    admission_reason = "weak_candidate" if payload.get("record_origin") == "weak_candidate" else "strict_validated"
    quality_notes = _quality_notes_for_payload(payload, missing_fields)
    payload.update(
        {
            "entity_type": review_entity_type,
            "entity_id": record_id,
            "entityType": review_entity_type,
            "entityId": record_id,
            "confidence_tier": confidence_tier,
            "confidenceTier": confidence_tier,
            "admission_reason": admission_reason,
            "admissionReason": admission_reason,
            "missing_fields": missing_fields,
            "missingFields": missing_fields,
            "quality_notes": quality_notes,
            "qualityNotes": quality_notes,
            "fields": {
                "ionic_liquid": payload.get("ionic_liquid"),
                "material_name": payload.get("material_name"),
                "cof": payload.get("cof"),
                "normal_load": payload.get("normal_load") or payload.get("load"),
                "speed": payload.get("speed"),
                "temperature": payload.get("temperature"),
                "evidence": payload.get("evidence"),
            },
            "source": {
                "page": payload.get("source_page"),
                "label": payload.get("source_figure") or payload.get("source"),
                "source_type": "text",
            },
        }
    )
```

- [ ] **Step 5: Run serializer tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/test_extraction_pipeline_upgrade.py::test_tribology_payload_exposes_unified_weak_candidate_metadata backend/test_extraction_pipeline_upgrade.py::test_tribology_payload_exposes_formal_record_as_same_display_shape -q
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/extraction.py backend/test_extraction_pipeline_upgrade.py
git commit -m "feat: serialize unified review rows"
```

## Task 4: Frontend Types And Review Labels

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/extractionReview.ts`
- Test: `frontend/src/lib/extractionReview.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Append to `frontend/src/lib/extractionReview.test.ts`:

```ts
import {
  confidenceTierLabel,
  extractionReviewStatusForRow,
  missingFieldLabels,
} from './extractionReview'

describe('weak candidate review metadata', () => {
  it('marks backend weak candidates as needing review', () => {
    expect(extractionReviewStatusForRow({
      review_status: 'needs_review',
      record_origin: 'weak_candidate',
      confidence_tier: 'low',
      missing_fields: ['normal_load', 'speed'],
      field_evidence_json: {},
    } as any)).toBe('needs_review')
  })

  it('formats missing field chips for users', () => {
    expect(missingFieldLabels(['normal_load', 'speed', 'ionic_liquid'])).toEqual([
      'Missing load',
      'Missing speed',
      'Missing IL',
    ])
  })

  it('formats confidence tiers', () => {
    expect(confidenceTierLabel('low')).toBe('Low confidence')
    expect(confidenceTierLabel('medium')).toBe('Medium confidence')
    expect(confidenceTierLabel('high')).toBe('High confidence')
  })
})
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd frontend && npm test -- extractionReview.test.ts --run
```

Expected: missing exports for `confidenceTierLabel` and `missingFieldLabels`, or status not handled.

- [ ] **Step 3: Extend `TribologyData` type in `frontend/src/lib/api.ts`**

Add these optional fields to the `TribologyData` interface:

```ts
    entity_type?: 'candidate' | 'record' | string | null
    entityType?: 'candidate' | 'record' | string | null
    entity_id?: number | string | null
    entityId?: number | string | null
    confidence_tier?: 'low' | 'medium' | 'high' | string | null
    confidenceTier?: 'low' | 'medium' | 'high' | string | null
    admission_reason?: string | null
    admissionReason?: string | null
    missing_fields?: string[] | null
    missingFields?: string[] | null
    quality_notes?: string | null
    qualityNotes?: string | null
    fields?: Record<string, unknown> | null
    source?: Record<string, unknown> | null
```

Add these optional fields to the extraction summary type:

```ts
    review_status?: string
    weak_candidate_count?: number
    admission_reason?: string
```

- [ ] **Step 4: Update review helpers**

Modify `frontend/src/lib/extractionReview.ts`:

```ts
export function confidenceTierOf(row: Pick<TribologyData, 'confidence_tier' | 'confidenceTier' | 'confidence'>) {
  const explicit = normalizeReviewState(row.confidence_tier ?? row.confidenceTier)
  if (explicit === 'low' || explicit === 'medium' || explicit === 'high') return explicit
  const numeric = Number(row.confidence)
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.8) return 'high'
    if (numeric >= 0.6) return 'medium'
  }
  return 'low'
}

export function confidenceTierLabel(tier: unknown) {
  const normalized = normalizeReviewState(tier)
  if (normalized === 'high') return 'High confidence'
  if (normalized === 'medium') return 'Medium confidence'
  return 'Low confidence'
}

export function missingFieldsOf(row: Pick<TribologyData, 'missing_fields' | 'missingFields'>) {
  const fields = row.missing_fields ?? row.missingFields ?? []
  return Array.isArray(fields) ? fields.filter((field) => String(field || '').trim()) : []
}

export function missingFieldLabels(fields: unknown[]) {
  const labels: Record<string, string> = {
    ionic_liquid: 'Missing IL',
    material_name: 'Missing material',
    cof: 'Missing COF',
    normal_load: 'Missing load',
    speed: 'Missing speed',
  }
  return fields.map((field) => labels[String(field || '').trim()] || `Missing ${String(field || '').trim()}`)
}
```

At the start of `extractionReviewStatusForRow`, after `reviewStatus` is computed, add:

```ts
  if (reviewStatus === 'needs_review' || reviewStatus === 'pending_review') return 'needs_review'
  if (normalizeReviewState((row as any).record_origin) === 'weak_candidate') return 'needs_review'
  if (missingFieldsOf(row as any).length > 0 && confidenceTierOf(row as any) === 'low') return 'needs_review'
```

- [ ] **Step 5: Run frontend tests**

Run:

```bash
cd frontend && npm test -- extractionReview.test.ts --run
```

Expected: all `extractionReview` tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/extractionReview.ts frontend/src/lib/extractionReview.test.ts
git commit -m "feat: label weak extraction candidates"
```

## Task 5: PDF Upload Result UI Shows Weak Candidates

**Files:**
- Modify: `frontend/src/App.vue`
- Test: `frontend/src/App.home-shell.test.ts` or add `frontend/src/App.weak-candidates.test.ts`

- [ ] **Step 1: Write failing UI behavior test**

Create `frontend/src/App.weak-candidates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  confidenceTierLabel,
  extractionReviewStatusForRow,
  missingFieldLabels,
} from '@/lib/extractionReview'

describe('PDF upload weak candidate display helpers', () => {
  it('keeps weak candidates visible as review rows instead of no-data', () => {
    const row = {
      review_status: 'needs_review',
      record_origin: 'weak_candidate',
      confidence_tier: 'low',
      missing_fields: ['normal_load', 'speed'],
      field_evidence_json: {},
    } as any

    expect(extractionReviewStatusForRow(row)).toBe('needs_review')
    expect(confidenceTierLabel(row.confidence_tier)).toBe('Low confidence')
    expect(missingFieldLabels(row.missing_fields)).toEqual(['Missing load', 'Missing speed'])
  })
})
```

- [ ] **Step 2: Run test to verify RED or helper coverage**

Run:

```bash
cd frontend && npm test -- App.weak-candidates.test.ts --run
```

Expected before Task 4 is complete: helper export failures. Expected after Task 4 is complete: pass. If it already passes after Task 4, keep it as regression coverage.

- [ ] **Step 3: Update PDF upload status handling in `App.vue`**

Import the new helpers:

```ts
  confidenceTierLabel,
  missingFieldLabels,
  missingFieldsOf,
```

from `@/lib/extractionReview`.

Add helpers near other PDF upload result helpers:

```ts
function pdfUploadRowConfidenceLabel(row: TribologyData) {
  return confidenceTierLabel(row.confidence_tier ?? row.confidenceTier ?? row.confidence)
}

function pdfUploadRowMissingLabels(row: TribologyData) {
  return missingFieldLabels(missingFieldsOf(row))
}

function pdfUploadHasWeakCandidates(rows: TribologyData[]) {
  return rows.some((row) => String(row.record_origin || '').trim().toLowerCase() === 'weak_candidate')
}
```

In `applyPdfUploadExtractionResponse`, replace the status selection with:

```ts
  const hasRows = initialRecords > 0
  const hasWeakRows = pdfUploadHasWeakCandidates(initialRows)
  updatePdfUploadExtractionItem(paperId, {
    status: hasRows || initialStatus === 'completed' ? 'completed' : 'no_data',
    records: initialRecords,
    extractedRows: initialRows,
    progress: 100,
    message: hasRows
      ? (hasWeakRows ? `${initialRecords} candidates need review.` : `${initialRecords} ${label} records extracted.`)
      : (initialResponse.message || `No extractable ${label.toLowerCase()} records found.`),
  })
```

In `applyPdfUploadRun`, when `runStatus === 'completed'`, make message candidate-aware:

```ts
      message: records > 0
        ? (String((run.extraction_summary as any)?.review_status || '').toLowerCase() === 'needs_review'
            ? `${records} candidates need review.`
            : `${records} ${label} records extracted.`)
        : (message || `No extractable ${label.toLowerCase()} records found.`),
```

In the result table status cell, under the status pill, add:

```vue
                          <span
                            v-if="pdfUploadRowConfidenceLabel(row)"
                            class="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500"
                          >
                            {{ pdfUploadRowConfidenceLabel(row) }}
                          </span>
                          <span
                            v-for="label in pdfUploadRowMissingLabels(row)"
                            :key="`${pdfUploadResultId(row, index)}-${label}`"
                            class="mt-1 mr-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700"
                          >
                            {{ label }}
                          </span>
```

- [ ] **Step 4: Run frontend tests**

Run:

```bash
cd frontend && npm test -- extractionReview.test.ts App.weak-candidates.test.ts --run
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.vue frontend/src/App.weak-candidates.test.ts
git commit -m "feat: show weak candidates in upload results"
```

## Task 6: End-To-End Verification And Deployment

**Files:**
- No new files expected.
- Uses existing backend and frontend test commands.

- [ ] **Step 1: Run backend targeted tests**

Run:

```bash
backend/.venv/bin/python -m pytest \
  backend/test_weak_candidate_service.py \
  backend/test_weak_candidate_persistence.py \
  backend/test_extraction_pipeline_upgrade.py \
  backend/test_extraction_cancel.py \
  backend/test_extraction_queue_service.py \
  backend/test_extraction_lane_status.py \
  backend/test_upload_doi_candidates.py \
  -q
```

Expected: all selected backend tests pass.

- [ ] **Step 2: Run frontend targeted tests**

Run:

```bash
cd frontend && npm test -- extractionReview.test.ts App.weak-candidates.test.ts --run
```

Expected: all selected frontend tests pass.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: build exits `0`. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 4: Deploy to server**

Run:

```bash
IONICLINK_HOST=ioniclink IONICLINK_REMOTE_DIR=/opt/ioniclink/repo scripts/deploy-server.sh all
```

Expected: backend and frontend containers rebuild and restart.

- [ ] **Step 5: Verify remote tests and health**

Run:

```bash
ssh ioniclink 'docker exec ioniclink-backend pytest test_weak_candidate_service.py test_weak_candidate_persistence.py test_extraction_pipeline_upgrade.py -q'
curl -fsS http://47.82.82.215/health
```

Expected: remote tests pass and health returns `{"status":"healthy"}`.

- [ ] **Step 6: Verify literature 124 behavior**

Run a fresh standard tribology extraction for literature `124` from the UI or API. Then inspect the latest run:

```bash
ssh ioniclink 'docker exec -i ioniclink-backend python -' <<'PY'
import asyncio, json
from sqlalchemy import select
from database import async_session_maker
from models.db_models import ExtractionRun, RecordCandidate

async def main():
    async with async_session_maker() as db:
        run = (await db.execute(
            select(ExtractionRun)
            .where(ExtractionRun.literature_id == 124, ExtractionRun.extractor_type == "tribology")
            .order_by(ExtractionRun.id.desc())
            .limit(1)
        )).scalar_one()
        summary = json.loads(run.summary_json or "{}")
        candidates = (await db.execute(
            select(RecordCandidate).where(RecordCandidate.literature_id == 124)
        )).scalars().all()
        print("run", run.id, run.status, summary.get("review_status"), summary.get("weak_candidate_count"))
        print("candidate_count", len(candidates))
        for row in candidates[:5]:
            print(row.id, row.record_origin, row.review_status, row.confidence, row.cof_raw, row.lubricant)
asyncio.run(main())
PY
```

Expected: latest run has `status=completed`, summary `review_status=needs_review`, at least one `RecordCandidate` with `record_origin=weak_candidate`, and the UI shows reviewable rows instead of `NoData`.

- [ ] **Step 7: Commit final integration if any fixes were required**

If verification required additional fixes:

```bash
git add backend frontend
git commit -m "fix: complete weak candidate review integration"
```

If no fixes were required, do not create an empty commit.
