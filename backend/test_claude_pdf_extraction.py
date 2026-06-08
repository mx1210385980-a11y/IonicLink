"""Tests for the Claude native full-PDF extraction path (capture + refine + wiring).

These tests never hit the network: the Anthropic SDK is faked and the IL-resolver
enrichment is monkeypatched to identity.
"""

import json
from types import SimpleNamespace

import fitz
import pytest

from services.llm import claude_pdf_extractor, runtime_service
from services.llm.runtime_service import LLMService


# --------------------------------------------------------------------------- #
# Fake Anthropic SDK surface                                                    #
# --------------------------------------------------------------------------- #
class _FakeStream:
    def __init__(self, message):
        self._message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get_final_message(self):
        return self._message


class _FakeMessages:
    def __init__(self, payload):
        self._payload = payload
        self.last_kwargs = None

    def stream(self, **kwargs):
        self.last_kwargs = kwargs
        message = SimpleNamespace(
            content=[SimpleNamespace(type="text", text=json.dumps(self._payload))],
            stop_reason="end_turn",
            usage=SimpleNamespace(model_dump=lambda: {"input_tokens": 100, "output_tokens": 20}),
        )
        return _FakeStream(message)


class _FakeFiles:
    def __init__(self):
        self.uploaded = False

    async def upload(self, **kwargs):
        self.uploaded = True
        return SimpleNamespace(id="file_fake123")


class _FakeBeta:
    def __init__(self, payload):
        self.messages = _FakeMessages(payload)
        self.files = _FakeFiles()


class _FakeAnthropic:
    def __init__(self, payload):
        self.beta = _FakeBeta(payload)


def _sample_payload():
    return {
        "metadata": {
            "title": "Ionic liquid lubricants",
            "authors": "A. Author, B. Author",
            "doi": "",
            "journal": "Tribology Letters",
            "issn": None,
            "year": 2022,
            "volume": "70",
            "issue": None,
            "pages": "12-20",
        },
        "rows": [
            {
                "material_name": "Steel",
                "ionic_liquid": "[EMIM][TFSI]",
                "cof": "0.08",
                "normal_load": "5 N",
                "speed": "0.1 m/s",
                "source": "Table 1",
                "source_page": 1,
                "source_figure": None,
                "evidence": "Table 1 reports a COF of 0.08 at 5 N for [EMIM][TFSI].",
            }
        ],
    }


def _make_pdf(tmp_path):
    pdf_path = tmp_path / "paper.pdf"
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Table 1. COF 0.08 at 5 N for [EMIM][TFSI].")
    doc.save(pdf_path)
    doc.close()
    return str(pdf_path)


def _patch_resolvers(monkeypatch):
    monkeypatch.setattr(runtime_service, "resolve_and_enrich_records", lambda rows: rows)
    monkeypatch.setattr(
        runtime_service,
        "filter_to_supported_ionic_liquid_records",
        lambda rows, allow_likely=False: (rows, []),
    )


# --------------------------------------------------------------------------- #
# refine_raw_rows — pure, no network                                           #
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_refine_raw_rows_produces_records_without_network(monkeypatch):
    _patch_resolvers(monkeypatch)
    service = LLMService()
    raw_rows = _sample_payload()["rows"]

    records, candidates, debug = service.refine_raw_rows(raw_rows)

    assert len(candidates) == 1
    assert candidates[0]["modality"] == "claude_pdf"
    assert candidates[0]["raw"]["cof"] == "0.08"
    assert [r.cof for r in records] == ["0.08"]
    assert debug["kept_count"] == 1
    assert debug["candidate_count"] == 1


@pytest.mark.asyncio
async def test_refine_raw_rows_is_rerunnable_from_persisted_raw(monkeypatch):
    """The same persisted raw rows refine identically with no LLM call."""
    _patch_resolvers(monkeypatch)
    service = LLMService()
    raw_rows = _sample_payload()["rows"]

    r1, _, _ = service.refine_raw_rows([dict(r) for r in raw_rows])
    r2, _, _ = service.refine_raw_rows([dict(r) for r in raw_rows])
    assert [r.cof for r in r1] == [r.cof for r in r2] == ["0.08"]


# --------------------------------------------------------------------------- #
# capture — mocked SDK                                                          #
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_capture_uploads_and_parses_rows(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    client = _FakeAnthropic(_sample_payload())

    result = await claude_pdf_extractor.capture(
        client, pdf_path, model="claude-sonnet-4-6", use_files_api=True
    )

    assert result.document_source == "files_api"
    assert client.beta.files.uploaded is True
    assert len(result.raw_rows) == 1
    assert result.raw_rows[0]["cof"] == "0.08"
    assert result.metadata["title"] == "Ionic liquid lubricants"
    assert result.usage.get("input_tokens") == 100

    # The request must carry a document block, the structured-output schema, and stream.
    kwargs = client.beta.messages.last_kwargs
    blocks = kwargs["messages"][0]["content"]
    assert blocks[0]["type"] == "document"
    assert blocks[0]["source"]["type"] == "file"
    assert kwargs["output_config"]["format"]["type"] == "json_schema"
    assert "files-api-2025-04-14" in kwargs["betas"]


@pytest.mark.asyncio
async def test_capture_base64_fallback(tmp_path):
    pdf_path = _make_pdf(tmp_path)
    client = _FakeAnthropic(_sample_payload())

    result = await claude_pdf_extractor.capture(
        client, pdf_path, model="claude-sonnet-4-6", use_files_api=False
    )

    assert result.document_source == "base64"
    assert client.beta.files.uploaded is False
    blocks = client.beta.messages.last_kwargs["messages"][0]["content"]
    assert blocks[0]["source"]["type"] == "base64"


@pytest.mark.asyncio
async def test_capture_requires_client():
    with pytest.raises(RuntimeError):
        await claude_pdf_extractor.capture(None, "x.pdf", model="claude-sonnet-4-6")


# --------------------------------------------------------------------------- #
# end-to-end wiring through extract_with_metadata                              #
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_extract_with_metadata_uses_claude_path(monkeypatch, tmp_path):
    _patch_resolvers(monkeypatch)
    pdf_path = _make_pdf(tmp_path)

    service = LLMService()
    service.anthropic_client = _FakeAnthropic(_sample_payload())
    service.anthropic_api_key = "test-key"
    service.extraction_mode = "claude_pdf"

    result = await service.extract_with_metadata(content="", pdf_path=pdf_path)

    assert result["extraction_summary"]["pipeline"] == "claude_pdf"
    assert result["metadata"]["title"] == "Ionic liquid lubricants"
    assert result["metadata"]["journal"] == "Tribology Letters"
    assert len(result["data"]) == 1
    assert result["data"][0]["cof"] == "0.08"
    # Raw rows are persisted as trace candidates for the raw-view endpoint.
    assert result["trace_candidates"]
    assert result["trace_candidates"][0]["modality"] == "claude_pdf"
    assert "claude_pdf" in result["extraction_summary"]


@pytest.mark.asyncio
async def test_claude_pdf_unavailable_without_key():
    service = LLMService()
    service.anthropic_client = None
    service.anthropic_api_key = ""
    assert service._claude_pdf_available() is False
