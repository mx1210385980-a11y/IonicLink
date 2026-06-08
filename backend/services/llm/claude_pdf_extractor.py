"""Phase 1 capture: hand the whole PDF to Claude and get raw structured rows.

This module owns the *capture* half of the two-phase extraction pipeline. It
sends the entire PDF to Anthropic Claude in one native call (each page processed
as text + image) and returns the raw model output — metadata plus one row per
quantitative tribology measurement — with NO cleaning, validation, or dedup.
Those happen later in the refine stage so the raw output stays inspectable and
re-processable without re-calling the model.

The AsyncAnthropic client is owned by ``LLMService`` and passed in; this module
never reads config or builds clients, which keeps it import-safe even when the
``anthropic`` SDK is absent.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from services.llm.prompts import CLAUDE_PDF_EXTRACTION_PROMPT, CLAUDE_PDF_OUTPUT_SCHEMA
from services.llm.utils import clean_and_parse_json

logger = logging.getLogger(__name__)

FILES_API_BETA = "files-api-2025-04-14"

# Per-request hard limits (Claude API). Page cap is 600 for >=1M-context models
# (Sonnet/Opus 4.x); request payload cap is 32 MB. We chunk conservatively below
# these so a dense paper near the edge still succeeds.
MAX_PAGES_PER_CALL = 500
MAX_BASE64_BYTES = 28 * 1024 * 1024  # ~28 MB encoded; base64 inflates ~33%

ProgressLog = Callable[[str, str], Awaitable[None]]
CancelCheck = Callable[[str], Awaitable[None]]


@dataclass
class CaptureResult:
    """Raw output of the capture phase — no cleaning applied."""

    metadata: Dict[str, Any] = field(default_factory=dict)
    raw_rows: List[Dict[str, Any]] = field(default_factory=list)
    raw_response_json: str = ""
    usage: Dict[str, Any] = field(default_factory=dict)
    stop_reason: Optional[str] = None
    model: str = ""
    document_source: str = ""  # "files_api" | "base64"
    page_count: int = 0
    chunk_count: int = 1
    error: Optional[str] = None


async def _noop_log(stage: str, message: str) -> None:  # pragma: no cover - trivial
    return None


async def _noop_cancel(stage: str) -> None:  # pragma: no cover - trivial
    return None


def _page_count(pdf_path: str) -> int:
    try:
        import fitz  # PyMuPDF, already a dependency

        with fitz.open(pdf_path) as doc:
            return int(doc.page_count)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not read page count for %s: %s", pdf_path, exc)
        return 0


def _text_blocks_to_json(message: Any) -> str:
    parts: List[str] = []
    for block in getattr(message, "content", None) or []:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", "") or "")
    return "".join(parts).strip()


def _usage_dict(message: Any) -> Dict[str, Any]:
    usage = getattr(message, "usage", None)
    if usage is None:
        return {}
    try:
        return usage.model_dump()
    except Exception:
        try:
            return dict(usage)
        except Exception:
            return {}


def _parse_capture_payload(raw_json: str) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Parse the structured-output text into (metadata, rows), tolerating truncation."""
    if not raw_json:
        return {}, []
    payload: Any = None
    try:
        payload = json.loads(raw_json)
    except Exception:
        payload = clean_and_parse_json(raw_json)
    if not isinstance(payload, dict):
        return {}, []
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    rows = payload.get("rows")
    if not isinstance(rows, list):
        rows = []
    clean_rows = [dict(r) for r in rows if isinstance(r, dict)]
    return dict(metadata or {}), clean_rows


async def _capture_single(
    client: Any,
    pdf_path: str,
    *,
    model: str,
    effort: str,
    max_tokens: int,
    use_files_api: bool,
    log: ProgressLog,
    raise_if_cancelled: CancelCheck,
) -> CaptureResult:
    """One Claude call over a single PDF file (already within page/size limits)."""
    document_source = "base64"
    document_block: Dict[str, Any]
    betas: List[str] = []

    file_id: Optional[str] = None
    if use_files_api:
        try:
            await raise_if_cancelled("stage_c.claude_pdf.upload")
            await log("stage_c.claude_pdf.upload", f"uploading {os.path.basename(pdf_path)}")
            with open(pdf_path, "rb") as handle:
                uploaded = await client.beta.files.upload(
                    file=(os.path.basename(pdf_path) or "document.pdf", handle, "application/pdf"),
                    betas=[FILES_API_BETA],
                )
            file_id = getattr(uploaded, "id", None)
        except Exception as exc:
            logger.warning("Files API upload failed, falling back to base64: %s", exc)
            file_id = None

    if file_id:
        document_source = "files_api"
        betas = [FILES_API_BETA]
        document_block = {
            "type": "document",
            "source": {"type": "file", "file_id": file_id},
            "cache_control": {"type": "ephemeral"},
        }
    else:
        with open(pdf_path, "rb") as handle:
            data_b64 = base64.standard_b64encode(handle.read()).decode("utf-8")
        document_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": data_b64},
            "cache_control": {"type": "ephemeral"},
        }

    messages = [
        {
            "role": "user",
            "content": [
                document_block,
                {"type": "text", "text": CLAUDE_PDF_EXTRACTION_PROMPT},
            ],
        }
    ]

    create_kwargs: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "thinking": {"type": "adaptive"},
        "output_config": {
            "format": {"type": "json_schema", "schema": CLAUDE_PDF_OUTPUT_SCHEMA},
            "effort": effort,
        },
        "messages": messages,
    }
    if betas:
        create_kwargs["betas"] = betas

    await raise_if_cancelled("stage_c.claude_pdf.capture")
    await log("stage_c.claude_pdf.capture", f"model={model} source={document_source}")

    async with client.beta.messages.stream(**create_kwargs) as stream:
        message = await stream.get_final_message()

    raw_json = _text_blocks_to_json(message)
    stop_reason = getattr(message, "stop_reason", None)
    metadata, rows = _parse_capture_payload(raw_json)

    result = CaptureResult(
        metadata=metadata,
        raw_rows=rows,
        raw_response_json=raw_json,
        usage=_usage_dict(message),
        stop_reason=stop_reason,
        model=model,
        document_source=document_source,
    )
    if stop_reason == "refusal":
        result.error = "refusal"
    elif stop_reason == "max_tokens" and not rows:
        result.error = "max_tokens_truncated"
    return result


def _split_pdf(pdf_path: str, pages_per_chunk: int) -> List[tuple[str, int]]:
    """Split into temp sub-PDFs of <= pages_per_chunk; returns [(path, page_offset)]."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(pdf_path)
    total = len(reader.pages)
    chunks: List[tuple[str, int]] = []
    for start in range(0, total, pages_per_chunk):
        writer = PdfWriter()
        for idx in range(start, min(start + pages_per_chunk, total)):
            writer.add_page(reader.pages[idx])
        fd, tmp_path = tempfile.mkstemp(suffix=".pdf", prefix="claudepdf_chunk_")
        with os.fdopen(fd, "wb") as out:
            writer.write(out)
        chunks.append((tmp_path, start))
    return chunks


async def capture(
    client: Any,
    pdf_path: str,
    *,
    model: str,
    effort: str = "high",
    max_tokens: int = 32000,
    use_files_api: bool = True,
    log: Optional[ProgressLog] = None,
    raise_if_cancelled: Optional[CancelCheck] = None,
) -> CaptureResult:
    """Capture raw tribology rows + metadata from a PDF using Claude native PDF input.

    Oversized PDFs (> MAX_PAGES_PER_CALL pages, or base64 payloads over the request
    cap) are split with pypdf into page chunks, each captured separately; rows are
    concatenated with absolute ``source_page`` offsets and metadata is taken from
    the first chunk.
    """
    if client is None:
        raise RuntimeError(
            "Claude PDF extraction requires an Anthropic client. Set ANTHROPIC_API_KEY."
        )
    log = log or _noop_log
    raise_if_cancelled = raise_if_cancelled or _noop_cancel

    page_count = _page_count(pdf_path)
    file_size = os.path.getsize(pdf_path) if os.path.exists(pdf_path) else 0
    oversized = page_count > MAX_PAGES_PER_CALL or (
        not use_files_api and file_size * 4 / 3 > MAX_BASE64_BYTES
    )

    if not oversized:
        result = await _capture_single(
            client,
            pdf_path,
            model=model,
            effort=effort,
            max_tokens=max_tokens,
            use_files_api=use_files_api,
            log=log,
            raise_if_cancelled=raise_if_cancelled,
        )
        result.page_count = page_count
        return result

    # Oversized: chunk by pages and merge.
    await log(
        "stage_c.claude_pdf.chunking",
        f"pages={page_count} size={file_size} -> splitting into {MAX_PAGES_PER_CALL}-page chunks",
    )
    chunks = _split_pdf(pdf_path, MAX_PAGES_PER_CALL)
    merged = CaptureResult(model=model, page_count=page_count, chunk_count=len(chunks))
    response_parts: List[str] = []
    try:
        for chunk_idx, (chunk_path, page_offset) in enumerate(chunks):
            await raise_if_cancelled(f"stage_c.claude_pdf.chunk.{chunk_idx}")
            part = await _capture_single(
                client,
                chunk_path,
                model=model,
                effort=effort,
                max_tokens=max_tokens,
                use_files_api=use_files_api,
                log=log,
                raise_if_cancelled=raise_if_cancelled,
            )
            if chunk_idx == 0:
                merged.metadata = part.metadata
                merged.document_source = part.document_source
            for row in part.raw_rows:
                sp = row.get("source_page")
                if isinstance(sp, int):
                    row["source_page"] = sp + page_offset
                merged.raw_rows.append(row)
            response_parts.append(part.raw_response_json or "")
            if part.error and not merged.error:
                merged.error = part.error
    finally:
        for chunk_path, _ in chunks:
            try:
                os.remove(chunk_path)
            except Exception:
                pass

    merged.raw_response_json = "\n".join(p for p in response_parts if p)
    return merged
