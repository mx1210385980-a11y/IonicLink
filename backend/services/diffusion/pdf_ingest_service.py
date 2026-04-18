from __future__ import annotations

import base64
import os
import re
from typing import Any

import fitz

from utils.pdf_coords import find_text_coordinates
from utils.pdf_utils import (
    classify_pdf_pages,
    render_page_preview_with_bbox_to_base64,
    render_region_preview_with_highlight_to_base64,
)

DIFFUSION_KEYWORDS = (
    "diffusion",
    "self-diffusion",
    "self diffusion",
    "diffusivity",
    "self-diffusivity",
    "pfg",
    "dosy",
    "nmr",
    "confined",
    "nanoconf",
    "pore",
    "nanochannel",
    "membrane",
    "slit",
    "pore size",
    "nano pore",
    "nanopore",
    "micro-confined",
    "channel",
)

VISUAL_SEARCH_TERMS = [
    "diffusion",
    "self-diffusion",
    "self diffusion",
    "D",
    "PFG",
    "DOSY",
    "NMR",
]


def _score_page(text: str) -> int:
    lowered = str(text or "").lower()
    score = 0
    for keyword in DIFFUSION_KEYWORDS:
        if keyword in lowered:
            score += 2
    if re.search(r"\b(?:10\^?-?\d+|cm2/s|cm\^2/s|m2/s|m\^2/s)\b", lowered):
        score += 2
    if "table" in lowered or "fig" in lowered or "figure" in lowered:
        score += 1
    if "supplementary" in lowered or "supporting information" in lowered:
        score += 1
    return score


def _select_ranked_pages(page_texts: dict[int, str], *, limit: int) -> list[int]:
    scored = []
    for page_idx, text in sorted((page_texts or {}).items()):
        page_score = _score_page(text)
        if page_score > 0:
            scored.append((page_idx, page_score))
    scored.sort(key=lambda item: (-item[1], item[0]))
    if not page_texts:
        return []

    if not scored:
        return list(sorted(page_texts.keys()))[:limit]

    ordered: list[int] = []
    seen: set[int] = set()
    total_pages = len(page_texts)

    def _append(page_idx: int) -> None:
        if page_idx < 0 or page_idx >= total_pages or page_idx in seen:
            return
        seen.add(page_idx)
        ordered.append(page_idx)

    _append(0)
    for page_idx, _score in scored:
        for neighbor in (page_idx - 1, page_idx, page_idx + 1):
            if len(ordered) >= limit:
                break
            _append(neighbor)
        if len(ordered) >= limit:
            break

    for page_idx, _score in scored:
        if len(ordered) >= limit:
            break
        _append(page_idx)

    return sorted(ordered[:limit])


def _build_text_chunks(
    selected_pages: list[int],
    page_texts: dict[int, str],
    *,
    profile: str,
) -> list[dict[str, Any]]:
    max_pages_per_chunk = 3 if str(profile or "").lower() == "high_accuracy" else 2
    max_chars = 18000 if str(profile or "").lower() == "high_accuracy" else 12000

    chunks: list[dict[str, Any]] = []
    current_pages: list[int] = []
    current_parts: list[str] = []
    current_chars = 0

    for page_idx in selected_pages:
        page_text = str(page_texts.get(page_idx) or "").strip()
        if not page_text:
            continue
        block = f"[Page {page_idx + 1}]\n{page_text[:5000]}"
        if current_pages and (len(current_pages) >= max_pages_per_chunk or (current_chars + len(block)) > max_chars):
            chunks.append({"pages": [page + 1 for page in current_pages], "content": "\n\n".join(current_parts)})
            current_pages = []
            current_parts = []
            current_chars = 0
        current_pages.append(page_idx)
        current_parts.append(block)
        current_chars += len(block)

    if current_pages:
        chunks.append({"pages": [page + 1 for page in current_pages], "content": "\n\n".join(current_parts)})
    return chunks


def _render_visual_focus(pdf_path: str, page_num: int) -> list[str]:
    hits = find_text_coordinates(
        pdf_path,
        [
            {
                "id": f"page-{page_num}-diffusion",
                "queries": VISUAL_SEARCH_TERMS,
                "page_hint": page_num,
                "restrict_to_page_hint": True,
            }
        ],
    )
    images: list[str] = []
    for hit in hits[:2]:
        width = float(hit.get("w") or 0)
        height = float(hit.get("h") or 0)
        if width <= 0 or height <= 0:
            continue
        bbox = [
            float(hit.get("x") or 0),
            float(hit.get("y") or 0),
            float(hit.get("x") or 0) + width,
            float(hit.get("y") or 0) + height,
        ]
        region = render_region_preview_with_highlight_to_base64(
            pdf_path=pdf_path,
            page_num=page_num,
            region_bbox=bbox,
            highlight_bbox=bbox,
            padding=28,
            dpi=180,
        )
        if region:
            images.append(f"data:image/png;base64,{region}")

    if images:
        return images

    preview = render_page_preview_with_bbox_to_base64(
        pdf_path=pdf_path,
        page_num=page_num,
        bbox=None,
        dpi=120,
        max_width=1000,
    )
    return [f"data:image/png;base64,{preview}"] if preview else []


def _fallback_page_preview(pdf_path: str, page_num: int) -> str | None:
    if not os.path.exists(pdf_path):
        return None
    try:
        with fitz.open(pdf_path) as doc:
            page = doc[page_num - 1]
            pix = page.get_pixmap(matrix=fitz.Matrix(140 / 72.0, 140 / 72.0), alpha=False)
            return "data:image/jpeg;base64," + base64.b64encode(pix.tobytes(output="jpg", jpg_quality=84)).decode()
    except Exception:
        return None


def build_diffusion_ingest_payload(
    *,
    content: str,
    pdf_path: str | None,
    profile: str = "high_accuracy",
) -> dict[str, Any]:
    base_content = str(content or "").strip()
    if not pdf_path or not os.path.exists(pdf_path):
        return {
            "content": base_content[:30000],
            "images": [],
            "page_coverage": {},
            "selected_pages": [],
            "document_profile": {},
        }

    classified = classify_pdf_pages(pdf_path)
    page_texts: dict[int, str] = classified.get("page_texts") or {}
    selected_pages = _select_ranked_pages(
        page_texts,
        limit=16 if str(profile or "").lower() == "high_accuracy" else 8,
    )

    selected_visual_pages = [
        page_idx
        for page_idx in selected_pages
        if page_idx in set(classified.get("visual_pages") or [])
    ][: 8 if str(profile or "").lower() == "high_accuracy" else 4]

    selected_text_blocks = [
        f"[Page {page_idx + 1}]\n{(page_texts.get(page_idx) or '')[:5000]}"
        for page_idx in selected_pages
    ]
    images: list[str] = []
    page_images: dict[int, list[str]] = {}
    for page_idx in selected_visual_pages:
        page_num = page_idx + 1
        rendered = _render_visual_focus(pdf_path, page_num)
        if not rendered:
            fallback = _fallback_page_preview(pdf_path, page_num)
            if fallback:
                rendered = [fallback]
        if rendered:
            page_images[page_num] = rendered[:2]
            images.extend(rendered[:2])

    page_coverage = {
        "total_pages": len(page_texts),
        "visual_pages": [page_idx + 1 for page_idx in classified.get("visual_pages") or []],
        "selected_pages": [page_idx + 1 for page_idx in selected_pages],
        "selected_visual_pages": [page_idx + 1 for page_idx in selected_visual_pages],
    }

    document_profile = {
        "pdf_name": os.path.basename(pdf_path),
        "total_pages": len(page_texts),
        "selected_page_count": len(selected_pages),
        "selected_visual_page_count": len(selected_visual_pages),
    }

    return {
        "content": "\n\n".join(selected_text_blocks)[:40000] or base_content[:30000],
        "images": images[:8],
        "page_images": page_images,
        "text_chunks": _build_text_chunks(selected_pages, page_texts, profile=profile),
        "page_coverage": page_coverage,
        "selected_pages": [page_idx + 1 for page_idx in selected_pages],
        "document_profile": document_profile,
    }
