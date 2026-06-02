import pytest

from services.file_service import (
    _allow_likely_ils_for_persistence,
    _infer_ionic_liquid_from_pdf,
    _is_unknown_il,
    _maybe_retry_tribology_visual_fallback,
    _should_retry_tribology_visual_fallback,
)
from services.llm.runtime_service import LLMService


def test_standard_profile_retries_visual_when_short_visual_pdf_has_only_weak_text_candidates(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    result = {
        "data": [],
        "trace_candidates": [{"raw": {"load": "20 nN"}}],
        "extraction_summary": {
            "candidate_count": 1,
            "page_coverage": {
                "total_pages": 3,
                "visual_pages": [1, 2, 3],
                "selected_visual_pages": [],
                "text_pages": [1, 2, 3],
            },
        },
    }

    assert _should_retry_tribology_visual_fallback(result, profile="standard")


def test_standard_profile_retries_visual_when_data_rows_have_no_primary_metric(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    result = {
        "data": [
            {
                "material_name": "Silica",
                "ionic_liquid": "[HMIm][FAP]",
                "load": "20 nN",
                "potential": "0 V",
            }
        ],
        "trace_candidates": [{"raw": {"load": "20 nN"}}],
        "extraction_summary": {
            "candidate_count": 3,
            "dropped_by_reason": {"missing_primary_metric": 1},
            "page_coverage": {
                "total_pages": 3,
                "visual_pages": [1, 2, 3],
                "selected_visual_pages": [],
                "text_pages": [1, 2, 3],
            },
        },
    }

    assert _should_retry_tribology_visual_fallback(result, profile="standard")


def test_standard_profile_retries_visual_for_typical_eleven_page_article_by_default(monkeypatch):
    monkeypatch.delenv("LLM_VISUAL_FALLBACK_MAX_PAGES", raising=False)
    result = {
        "data": [
            {
                "material_name": "BB IL on graphene surface",
                "ionic_liquid": "[BMIM][BF4]",
                "load": "19-21 nN",
                "speed": "2 μm/s",
                "source_figure": "Fig. 4",
            }
        ],
        "trace_candidates": [{"raw": {"source_figure": "Fig. 4"}}],
        "extraction_summary": {
            "candidate_count": 8,
            "dropped_by_reason": {"no_core_quant_signal": 20},
            "page_coverage": {
                "total_pages": 11,
                "visual_pages": list(range(1, 12)),
                "selected_visual_pages": [],
                "text_pages": list(range(1, 12)),
            },
        },
    }

    assert _should_retry_tribology_visual_fallback(result, profile="standard")


def test_standard_profile_does_not_retry_visual_when_text_has_primary_metric(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    result = {
        "data": [
            {
                "material_name": "Silica",
                "ionic_liquid": "[HMIm][FAP]",
                "load": "20 nN",
                "cof": "0.01",
            }
        ],
        "trace_candidates": [],
        "extraction_summary": {
            "candidate_count": 1,
            "page_coverage": {
                "total_pages": 3,
                "visual_pages": [1, 2, 3],
                "selected_visual_pages": [],
                "text_pages": [1, 2, 3],
            },
        },
    }

    assert not _should_retry_tribology_visual_fallback(result, profile="standard")


def test_standard_profile_retries_visual_when_primary_metric_rows_are_low_quality(monkeypatch):
    monkeypatch.delenv("LLM_VISUAL_FALLBACK_MAX_PAGES", raising=False)
    result = {
        "data": [
            {
                "material_name": "Unknown Material",
                "ionic_liquid": "Unknown IL",
                "cof": "0.080",
                "source_page": 5,
            }
        ],
        "trace_candidates": [
            {"page": 2, "raw": {"load": "19-21 nN"}},
            {"page": 4, "raw": {"source_figure": "Fig. 4"}},
        ],
        "extraction_summary": {
            "candidate_count": 14,
            "dropped_by_reason": {"no_core_quant_signal": 9, "missing_primary_metric": 4},
            "page_coverage": {
                "total_pages": 11,
                "visual_pages": list(range(1, 12)),
                "selected_visual_pages": [],
                "text_pages": list(range(1, 12)),
            },
        },
    }

    assert _should_retry_tribology_visual_fallback(result, profile="standard")


def test_standard_profile_keeps_likely_ils_after_visual_fallback():
    assert _allow_likely_ils_for_persistence(
        profile="standard",
        visual_fallback_used=True,
        extraction_summary={"visual_fallback": {"used": True}},
    )


def test_ionic_liquid_inference_ignores_reference_noise_and_uses_page_context():
    inferred = _infer_ionic_liquid_from_pdf(
        source_page=1,
        source="Fig. 4",
        source_figure="Fig. 4",
        evidence="The extracted label was [5][to] near a figure caption.",
        page_text_cache={
            1: (
                "The extensively studied 1-butyl-3-methylimidazolium "
                "tetrafluoroborate ([BMIM][BF4], BB) was employed as a "
                "well-defined model imidazolium IL. Fig. 4 shows friction force."
            )
        },
    )

    assert inferred == "[BMIM][BF4]"


def test_reference_marker_pair_is_treated_as_unknown_ionic_liquid():
    assert _is_unknown_il("[5][to]")


def test_standard_profile_does_not_retry_visual_for_long_papers(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    result = {
        "data": [],
        "trace_candidates": [{"raw": {"load": "20 nN"}}],
        "extraction_summary": {
            "candidate_count": 1,
            "page_coverage": {
                "total_pages": 12,
                "visual_pages": [1, 2, 3, 4, 5],
                "selected_visual_pages": [],
                "text_pages": list(range(1, 13)),
            },
        },
    }

    assert not _should_retry_tribology_visual_fallback(result, profile="standard")


@pytest.mark.asyncio
async def test_visual_fallback_replaces_empty_text_result_with_visual_records(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    original = {
        "metadata": {"title": "Text pass"},
        "data": [],
        "trace_candidates": [{"stage": "stage_c", "raw": {"load": "20 nN"}}],
        "extraction_summary": {
            "candidate_count": 1,
            "progress_log": [{"stage": "stage_c.text", "message": "raw_candidates=1"}],
            "page_coverage": {
                "total_pages": 3,
                "visual_pages": [1, 2, 3],
                "selected_visual_pages": [],
                "text_pages": [1, 2, 3],
            },
        },
    }
    calls: list[dict] = []

    async def fake_extract_with_metadata(**kwargs):
        calls.append(kwargs)
        return {
            "metadata": {"title": "Visual pass"},
            "data": [{"ionic_liquid": "[HMIM][FAP]", "material_name": "HOPG", "cof": "0.003"}],
            "trace_candidates": [{"stage": "stage_c", "modality": "figure", "raw": {"cof": "0.003"}}],
            "extraction_summary": {
                "candidate_count": 2,
                "final_count": 1,
                "progress_log": [{"stage": "stage_c.figure", "message": "raw_candidates=1"}],
                "page_coverage": {
                    "total_pages": 3,
                    "visual_pages": [1, 2, 3],
                    "selected_visual_pages": [2],
                    "text_pages": [1, 2, 3],
                },
            },
        }

    result, used = await _maybe_retry_tribology_visual_fallback(
        original,
        content="paper text",
        images=None,
        pdf_path="/tmp/paper.pdf",
        profile="standard",
        strict_cof_mode=False,
        progress_callback=None,
        extract_with_metadata=fake_extract_with_metadata,
    )

    assert used is True
    assert calls
    assert calls[0]["extraction_profile"] == "review_figure_estimate"
    assert calls[0]["strict_cof_mode"] is True
    assert result["data"][0]["cof"] == "0.003"
    assert result["extraction_summary"]["visual_fallback"]["used"] is True
    assert result["extraction_summary"]["visual_fallback"]["replaced_empty_text_result"] is True


@pytest.mark.asyncio
async def test_visual_fallback_passes_text_candidate_pages_as_visual_hints(monkeypatch):
    monkeypatch.delenv("LLM_VISUAL_FALLBACK_MAX_PAGES", raising=False)
    original = {
        "metadata": {"title": "Wu 2025 style text pass"},
        "data": [],
        "trace_candidates": [
            {"page": 2, "raw": {"load": "19-21 nN"}},
            {"raw": {"source_page": 4, "source_figure": "Fig. 2"}},
            {"raw": {"source_page": "8", "potential": "+1 V"}},
        ],
        "extraction_summary": {
            "candidate_count": 14,
            "page_candidate_counts": {
                "2": {"total": 5},
                "4": {"total": 3},
                "5": {"total": 3},
                "6": {"total": 1},
                "8": {"total": 2},
            },
            "page_coverage": {
                "total_pages": 11,
                "visual_pages": list(range(1, 12)),
                "selected_visual_pages": [],
                "text_pages": list(range(1, 12)),
            },
            "dropped_by_reason": {"no_core_quant_signal": 9},
        },
    }
    calls: list[dict] = []

    async def fake_extract_with_metadata(**kwargs):
        calls.append(kwargs)
        return {"metadata": {}, "data": [], "trace_candidates": [], "extraction_summary": {"candidate_count": 0}}

    await _maybe_retry_tribology_visual_fallback(
        original,
        content="paper text",
        images=None,
        pdf_path="/tmp/wu-2025.pdf",
        profile="standard",
        strict_cof_mode=False,
        progress_callback=None,
        extract_with_metadata=fake_extract_with_metadata,
    )

    assert calls
    assert calls[0]["visual_page_hints"] == [2, 4, 5, 6, 8]


def test_review_figure_estimate_uses_visual_page_hints_to_avoid_full_article_visual_sweep():
    service = LLMService()
    selected = service._select_visual_pages(
        list(range(11)),
        {
            1: "normal load and friction candidates",
            3: "Fig. 2 friction force and potential",
            4: "Table 1 coefficient of friction",
            5: "methods",
            7: "Fig. 4 superlubricity",
        },
        high_accuracy=True,
        profile="review_figure_estimate",
        visual_page_hints=[2, 4, 5, 6, 8],
    )

    assert selected == [1, 3, 4, 5, 7]


@pytest.mark.asyncio
async def test_visual_fallback_preserves_text_candidates_when_visual_still_finds_no_records(monkeypatch):
    monkeypatch.setenv("LLM_VISUAL_FALLBACK_MAX_PAGES", "4")
    original = {
        "metadata": {},
        "data": [],
        "trace_candidates": [{"stage": "stage_c", "raw": {"load": "20 nN"}}],
        "extraction_summary": {
            "candidate_count": 1,
            "progress_log": [{"stage": "stage_c.text", "message": "raw_candidates=1"}],
            "page_coverage": {
                "total_pages": 3,
                "visual_pages": [1, 2, 3],
                "selected_visual_pages": [],
                "text_pages": [1, 2, 3],
            },
        },
    }

    async def fake_extract_with_metadata(**_kwargs):
        return {
            "metadata": {},
            "data": [],
            "trace_candidates": [{"stage": "stage_c", "modality": "figure", "raw": {"potential": "+1 V"}}],
            "extraction_summary": {
                "candidate_count": 1,
                "progress_log": [{"stage": "stage_c.figure", "message": "raw_candidates=1"}],
            },
        }

    result, used = await _maybe_retry_tribology_visual_fallback(
        original,
        content="paper text",
        images=None,
        pdf_path="/tmp/paper.pdf",
        profile="standard",
        strict_cof_mode=False,
        progress_callback=None,
        extract_with_metadata=fake_extract_with_metadata,
    )

    assert used is True
    assert result["data"] == []
    assert len(result["trace_candidates"]) == 2
    assert result["extraction_summary"]["candidate_count"] == 2
    assert result["extraction_summary"]["visual_fallback"]["used"] is True
