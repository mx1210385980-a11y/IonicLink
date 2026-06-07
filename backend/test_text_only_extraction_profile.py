import asyncio

import fitz
import pytest

from services.llm import runtime_service
from services.llm.runtime_service import LLMService


@pytest.mark.asyncio
async def test_legacy_standard_profile_auto_uses_vision_when_text_has_no_records(monkeypatch, tmp_path):
    pdf_path = tmp_path / "mixed-pages.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Figure 1. Friction coefficient COF is 0.12 for [EMIM][TFSI].")
    doc.new_page().insert_text((72, 72), "The text reports COF of 0.08 for [BMIM][PF6].")
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [0],
            "text_pages": [1],
            "page_texts": {
                0: "Figure 1. Friction coefficient COF is 0.12 for [EMIM][TFSI].",
                1: "The text reports COF of 0.08 for [BMIM][PF6].",
            },
        },
    )

    service = LLMService()
    text_chunks: list[str] = []
    vision_pages: list[int] = []

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(text_chunk, _prompt):
        text_chunks.append(text_chunk)
        return []

    async def fake_process_vision(images, _prompt, content="", **_kwargs):
        page_match = content.split("]", 1)[0].replace("[Page ", "")
        vision_pages.append(int(page_match))
        if len(vision_pages) > 1:
            return []
        return [
            {
                "source_page": int(page_match),
                "source": "Fig. 1",
                "source_figure": "Fig. 1",
                "material_name": "Mica",
                "ionic_liquid": "[EMIM][TFSI]",
                "cof": "0.12",
                "evidence": "Figure 1. Friction coefficient COF is 0.12 for [EMIM][TFSI].",
            }
        ]

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_vision_timeout", fake_process_vision)
    monkeypatch.setattr(service, "_process_text", fake_process_text)
    monkeypatch.setattr(runtime_service, "resolve_and_enrich_records", lambda rows: rows)
    monkeypatch.setattr(
        runtime_service,
        "filter_to_supported_ionic_liquid_records",
        lambda rows, allow_likely=False: (rows, []),
    )

    records = await service.extract_tribology_data(pdf_path=str(pdf_path), profile="standard")

    assert len(text_chunks) == 2
    assert text_chunks[0].startswith("[Page 1]")
    assert text_chunks[1].startswith("[Page 2]")
    assert vision_pages and set(vision_pages) == {1}
    assert [record.cof for record in records] == ["0.12"]


@pytest.mark.asyncio
async def test_review_figure_estimate_caps_visual_estimate_confidence(monkeypatch, tmp_path):
    pdf_path = tmp_path / "figure-estimate.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Fig. 9. Average friction coefficients under current and Fe3O4 loading.")
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [0],
            "text_pages": [],
            "page_texts": {
                0: "Fig. 9. Average friction coefficients under current and Fe3O4 loading.",
            },
        },
    )

    service = LLMService()

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(_text_chunk, _prompt):
        return []

    async def fake_process_vision(_images, _prompt, content="", **_kwargs):
        return [
            {
                "source_page": 1,
                "source": "Fig. 9",
                "source_figure": "Fig. 9",
                "material_name": "304 stainless steel / Q345 steel",
                "ionic_liquid": "[EMIM][BF4]",
                "cof": "0.1049",
                "evidence": "Graph-estimated trace for 20 A and 30 wt% Fe3O4.",
                "confidence": 0.95,
            }
        ]

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_vision_timeout", fake_process_vision)
    monkeypatch.setattr(service, "_process_text", fake_process_text)
    monkeypatch.setattr(runtime_service, "resolve_and_enrich_records", lambda rows: rows)
    monkeypatch.setattr(
        runtime_service,
        "filter_to_supported_ionic_liquid_records",
        lambda rows, allow_likely=False: (rows, []),
    )

    records = await service.extract_tribology_data(pdf_path=str(pdf_path), profile="review_figure_estimate")

    assert records
    assert {record.value_origin for record in records} == {"figure_estimate"}
    assert all(record.confidence == pytest.approx(runtime_service.FIGURE_ESTIMATE_CONFIDENCE_CAP) for record in records)


@pytest.mark.asyncio
async def test_text_page_extraction_uses_bounded_concurrency_without_reordering_candidates(
    monkeypatch,
    tmp_path,
):
    pdf_path = tmp_path / "text-pages.pdf"
    doc = fitz.open()
    for page_num in range(1, 5):
        doc.new_page().insert_text(
            (72, 72),
            f"Page {page_num}. COF is 0.{page_num} for [BMIM][PF6] on steel.",
        )
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setenv("LLM_TEXT_PAGE_CONCURRENCY", "2")
    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [],
            "text_pages": [0, 1, 2, 3],
            "page_texts": {
                idx: f"Page {idx + 1}. COF is 0.{idx + 1} for [BMIM][PF6] on steel."
                for idx in range(4)
            },
        },
    )
    monkeypatch.setattr(runtime_service, "resolve_and_enrich_records", lambda rows: rows)
    monkeypatch.setattr(
        runtime_service,
        "filter_to_supported_ionic_liquid_records",
        lambda rows, allow_likely=False: (rows, []),
    )

    service = LLMService()
    active = 0
    max_active = 0

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(text_chunk, _prompt):
        nonlocal active, max_active
        page_num = int(text_chunk.split("]", 1)[0].replace("[Page ", ""))
        active += 1
        max_active = max(max_active, active)
        try:
            await asyncio.sleep({1: 0.04, 2: 0.01, 3: 0.03, 4: 0.01}[page_num])
            return [
                {
                    "source_page": page_num,
                    "material_name": "steel",
                    "ionic_liquid": "[BMIM][PF6]",
                    "cof": f"0.{page_num}",
                }
            ]
        finally:
            active -= 1

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_text", fake_process_text)

    await service.extract_tribology_data(pdf_path=str(pdf_path), profile="standard")

    assert max_active == 2
    assert [
        candidate["page"]
        for candidate in service._last_extraction_debug["candidates"]
        if candidate["modality"] == "text"
    ] == [1, 2, 3, 4]
    assert [
        entry["page"]
        for entry in service._last_extraction_debug["progress_log"]
        if entry["stage"] == "stage_c.text"
    ] == [1, 2, 3, 4]
    assert service._last_extraction_debug["page_candidate_counts"] == {
        str(page_num): {
            "total": 2,
            "figure": 0,
            "text": 2,
            "other": 0,
            "kept_after_validation": 1,
            "dropped_after_validation": 0,
        }
        for page_num in range(1, 5)
    }


@pytest.mark.asyncio
async def test_text_page_extraction_emits_progress_before_page_calls_finish(monkeypatch, tmp_path):
    pdf_path = tmp_path / "text-progress.pdf"
    doc = fitz.open()
    for page_num in range(1, 3):
        doc.new_page().insert_text(
            (72, 72),
            f"Page {page_num}. COF is 0.{page_num} for [BMIM][PF6] on steel.",
        )
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setenv("LLM_TEXT_PAGE_CONCURRENCY", "2")
    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [],
            "text_pages": [0, 1],
            "page_texts": {
                idx: f"Page {idx + 1}. COF is 0.{idx + 1} for [BMIM][PF6] on steel."
                for idx in range(2)
            },
        },
    )

    service = LLMService()
    progress_events: list[dict] = []
    page_two_reported = asyncio.Event()
    release_page_one = asyncio.Event()

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(text_chunk, _prompt):
        page_num = int(text_chunk.split("]", 1)[0].replace("[Page ", ""))
        if page_num == 1:
            await release_page_one.wait()
        return []

    async def capture_progress(payload):
        progress_events.append(dict(payload))
        if payload.get("stage") == "stage_c.fast_text_done" and payload.get("page") == 2:
            page_two_reported.set()

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_text", fake_process_text)

    task = asyncio.create_task(
        service.extract_tribology_data(
            pdf_path=str(pdf_path),
            profile="standard",
            progress_callback=capture_progress,
        )
    )
    try:
        await asyncio.wait_for(page_two_reported.wait(), timeout=0.2)
        assert not release_page_one.is_set()
    finally:
        release_page_one.set()

    await task

    text_progress = [event for event in progress_events if str(event.get("stage", "")).startswith("stage_c.fast_text")]
    assert text_progress[0]["stage"] == "stage_c.fast_text_start"
    assert text_progress[0]["message"] == "chunk=0/2 text_pages=2 concurrency=2"
    assert any(
        event["stage"] == "stage_c.fast_text_done"
        and event["page"] == 2
        and event["message"] == "chunk=1/2 raw_candidates=0"
        for event in text_progress
    )
    assert text_progress[-1]["message"].startswith("chunk=2/2")


@pytest.mark.asyncio
async def test_text_page_extraction_times_out_one_slow_page_and_continues(monkeypatch, tmp_path):
    pdf_path = tmp_path / "text-timeout.pdf"
    doc = fitz.open()
    for page_num in range(1, 3):
        doc.new_page().insert_text(
            (72, 72),
            f"Page {page_num}. COF is 0.{page_num} for [BMIM][PF6] on steel.",
        )
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setenv("LLM_TEXT_PAGE_CONCURRENCY", "2")
    monkeypatch.setenv("LLM_TEXT_PAGE_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [],
            "text_pages": [0, 1],
            "page_texts": {
                idx: f"Page {idx + 1}. COF is 0.{idx + 1} for [BMIM][PF6] on steel."
                for idx in range(2)
            },
        },
    )
    monkeypatch.setattr(runtime_service, "resolve_and_enrich_records", lambda rows: rows)
    monkeypatch.setattr(
        runtime_service,
        "filter_to_supported_ionic_liquid_records",
        lambda rows, allow_likely=False: (rows, []),
    )

    service = LLMService()
    progress_events: list[dict] = []
    cancelled_pages: set[int] = set()

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(text_chunk, _prompt):
        page_num = int(text_chunk.split("]", 1)[0].replace("[Page ", ""))
        if page_num == 1:
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled_pages.add(page_num)
                raise
        return [
            {
                "source_page": page_num,
                "material_name": "steel",
                "ionic_liquid": "[BMIM][PF6]",
                "cof": f"0.{page_num}",
            }
        ]

    async def capture_progress(payload):
        progress_events.append(dict(payload))

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_text", fake_process_text)

    await asyncio.wait_for(
        service.extract_tribology_data(
            pdf_path=str(pdf_path),
            profile="standard",
            progress_callback=capture_progress,
        ),
        timeout=0.5,
    )

    assert cancelled_pages == {1}
    text_progress = [event for event in progress_events if str(event.get("stage", "")).startswith("stage_c.fast_text")]
    assert any(event["stage"] == "stage_c.fast_text_timeout" and event["page"] == 1 for event in text_progress)
    assert any(
        event["stage"] == "stage_c.fast_text_done"
        and event["page"] == 2
        and event["message"] == "chunk=1/2 raw_candidates=1"
        for event in text_progress
    )
    assert text_progress[-1]["message"].startswith("chunk=2/2")
    assert [
        candidate["page"]
        for candidate in service._last_extraction_debug["candidates"]
        if candidate["modality"] == "text"
    ] == [2]


@pytest.mark.asyncio
async def test_text_page_extraction_cancels_in_flight_page_tasks(monkeypatch, tmp_path):
    pdf_path = tmp_path / "cancel-text-pages.pdf"
    doc = fitz.open()
    for page_num in range(1, 4):
        doc.new_page().insert_text(
            (72, 72),
            f"Page {page_num}. COF is 0.{page_num} for [BMIM][PF6] on steel.",
        )
    doc.save(pdf_path)
    doc.close()

    monkeypatch.setenv("LLM_TEXT_PAGE_CONCURRENCY", "3")
    monkeypatch.setattr(
        runtime_service,
        "classify_pdf_pages",
        lambda _path: {
            "visual_pages": [],
            "text_pages": [0, 1, 2],
            "page_texts": {
                idx: f"Page {idx + 1}. COF is 0.{idx + 1} for [BMIM][PF6] on steel."
                for idx in range(3)
            },
        },
    )

    service = LLMService()
    started: set[int] = set()
    cancelled: set[int] = set()

    async def fake_abbrev_map(_page_texts):
        return {}

    async def fake_process_text(text_chunk, _prompt):
        page_num = int(text_chunk.split("]", 1)[0].replace("[Page ", ""))
        started.add(page_num)
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.add(page_num)
            raise
        return []

    monkeypatch.setattr(service, "_extract_abbrev_map", fake_abbrev_map)
    monkeypatch.setattr(service, "_process_text", fake_process_text)

    task = asyncio.create_task(service.extract_tribology_data(pdf_path=str(pdf_path), profile="standard"))
    for _ in range(20):
        if started == {1, 2, 3}:
            break
        await asyncio.sleep(0.01)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert started == {1, 2, 3}
    assert cancelled == {1, 2, 3}
