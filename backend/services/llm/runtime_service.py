from __future__ import annotations

import asyncio
import base64
import copy
import json
import logging
import os
import re
import threading
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

import fitz
from dotenv import load_dotenv
from openai import AsyncOpenAI

from models.tribology import TribologyData
from services.cleaning_service import (
    calculate_missing_cof,
    normalize_ionic_liquid_terms,
    normalize_surface_terms,
    set_default_temperature,
)
from services.doi_service import DOIService
from services.il_resolver_service import (
    filter_to_supported_ionic_liquid_records,
    resolve_and_enrich_records,
)
from services.score_service import calculate_confidence
from services.llm.prompts import (
    ABBREV_MAPPING_PROMPT,
    ANTI_HALLUCINATION_PROMPT,
    CHAT_SYSTEM_PROMPT,
    FIGURE_LEGEND_COF_PROMPT,
    FIGURE_TABLE_EXTRACTION_PROMPT,
    METADATA_EXTRACTION_PROMPT,
    TEXT_EXTRACTION_PROMPT,
)
from services.normalization import normalize_extraction_row
from services.llm.utils import (
    clean_and_parse_json,
    has_core_quantitative_signal,
    has_explicit_numeric_value,
    parse_json_response,
    prepare_image_input,
)
from utils.cof_guard import unsupported_figure_cof_reason
from utils.document_context import (
    apply_experimental_document_context,
    extract_experimental_document_context,
)
from utils.pdf_utils import classify_pdf_pages

load_dotenv(override=True)
logger = logging.getLogger(__name__)
RUNTIME_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
RUNTIME_DATA_DIR = os.path.join(RUNTIME_BASE_DIR, "data")
LLM_RUNTIME_CONFIG_PATH = os.path.join(RUNTIME_DATA_DIR, "llm_runtime_config.json")
DEFAULT_LLM_PROVIDER = "openai-compatible"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_APP_NAME = "IonicLink"
DEFAULT_TEXT_MODEL = "Pro/deepseek-ai/DeepSeek-V3.2"
DEFAULT_VISION_MODEL = "Qwen/Qwen3-VL-32B-Instruct"


def _normalize_runtime_string(value: Any) -> str:
    return str(value or "").strip()


def _serialize_llm_provider(value: Any) -> str:
    normalized = _normalize_runtime_string(value).lower()
    if normalized == "openrouter":
        return "openrouter"
    return DEFAULT_LLM_PROVIDER


class LLMService:
    def __init__(self):
        self._config_lock = threading.RLock()
        os.makedirs(RUNTIME_DATA_DIR, exist_ok=True)
        self._config = self._load_runtime_config()
        self._last_extraction_debug: Dict[str, Any] = {
            "candidate_count": 0,
            "kept_count": 0,
            "dropped_by_reason": {},
            "candidates": [],
            "page_coverage": {},
            "abbrev_map": {},
            "document_profile": {},
            "page_candidate_counts": {},
            "progress_log": [],
        }
        self._apply_runtime_config(self._config)

    def _build_default_headers(self) -> Dict[str, str]:
        if self.provider != "openrouter":
            return {}

        headers: Dict[str, str] = {}
        if self.openrouter_site_url:
            headers["HTTP-Referer"] = self.openrouter_site_url
        if self.openrouter_app_name:
            headers["X-OpenRouter-Title"] = self.openrouter_app_name
        return headers

    def _default_runtime_config(self) -> Dict[str, Any]:
        provider = _serialize_llm_provider(os.getenv("LLM_PROVIDER"))
        openai_api_key = _normalize_runtime_string(os.getenv("OPENAI_API_KEY", ""))
        openai_base_url = _normalize_runtime_string(os.getenv("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL)) or DEFAULT_OPENAI_BASE_URL
        openrouter_api_key = _normalize_runtime_string(os.getenv("OPENROUTER_API_KEY", ""))

        if provider != "openrouter" and openrouter_api_key and not openai_api_key and openai_base_url == DEFAULT_OPENAI_BASE_URL:
            provider = "openrouter"

        return {
            "provider": provider,
            "openai_base_url": openai_base_url,
            "openai_api_key": openai_api_key,
            "openrouter_base_url": _normalize_runtime_string(os.getenv("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL)) or DEFAULT_OPENROUTER_BASE_URL,
            "openrouter_api_key": openrouter_api_key,
            "openrouter_site_url": _normalize_runtime_string(os.getenv("OPENROUTER_SITE_URL", "")),
            "openrouter_app_name": _normalize_runtime_string(os.getenv("OPENROUTER_APP_NAME", DEFAULT_OPENROUTER_APP_NAME)) or DEFAULT_OPENROUTER_APP_NAME,
            "text_model": _normalize_runtime_string(os.getenv("LLM_TEXT_MODEL", DEFAULT_TEXT_MODEL)) or DEFAULT_TEXT_MODEL,
            "vision_model": _normalize_runtime_string(os.getenv("LLM_VISION_MODEL", DEFAULT_VISION_MODEL)) or DEFAULT_VISION_MODEL,
            "vision_api_key": _normalize_runtime_string(os.getenv("LLM_VISION_API_KEY", "")),
            "updated_at": None,
        }

    def _serialize_runtime_config(self, value: Any, existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
        raw = value if isinstance(value, dict) else {}
        current = copy.deepcopy(existing or self._default_runtime_config())

        openai_api_key = current.get("openai_api_key", "")
        if raw.get("clear_openai_api_key"):
            openai_api_key = ""
        elif raw.get("openai_api_key") is not None and _normalize_runtime_string(raw.get("openai_api_key")):
            openai_api_key = _normalize_runtime_string(raw.get("openai_api_key"))

        openrouter_api_key = current.get("openrouter_api_key", "")
        if raw.get("clear_openrouter_api_key"):
            openrouter_api_key = ""
        elif raw.get("openrouter_api_key") is not None and _normalize_runtime_string(raw.get("openrouter_api_key")):
            openrouter_api_key = _normalize_runtime_string(raw.get("openrouter_api_key"))

        vision_api_key = current.get("vision_api_key", "")
        if raw.get("clear_vision_api_key"):
            vision_api_key = ""
        elif raw.get("vision_api_key") is not None and _normalize_runtime_string(raw.get("vision_api_key")):
            vision_api_key = _normalize_runtime_string(raw.get("vision_api_key"))

        return {
            "provider": _serialize_llm_provider(raw.get("provider", current.get("provider"))),
            "openai_base_url": _normalize_runtime_string(raw.get("openai_base_url", current.get("openai_base_url", DEFAULT_OPENAI_BASE_URL))) or DEFAULT_OPENAI_BASE_URL,
            "openai_api_key": openai_api_key,
            "openrouter_base_url": _normalize_runtime_string(raw.get("openrouter_base_url", current.get("openrouter_base_url", DEFAULT_OPENROUTER_BASE_URL))) or DEFAULT_OPENROUTER_BASE_URL,
            "openrouter_api_key": openrouter_api_key,
            "openrouter_site_url": _normalize_runtime_string(raw.get("openrouter_site_url", current.get("openrouter_site_url", ""))),
            "openrouter_app_name": _normalize_runtime_string(raw.get("openrouter_app_name", current.get("openrouter_app_name", DEFAULT_OPENROUTER_APP_NAME))) or DEFAULT_OPENROUTER_APP_NAME,
            "text_model": _normalize_runtime_string(raw.get("text_model", current.get("text_model", DEFAULT_TEXT_MODEL))) or DEFAULT_TEXT_MODEL,
            "vision_model": _normalize_runtime_string(raw.get("vision_model", current.get("vision_model", DEFAULT_VISION_MODEL))) or DEFAULT_VISION_MODEL,
            "vision_api_key": vision_api_key,
            "updated_at": current.get("updated_at"),
        }

    def _load_runtime_config(self) -> Dict[str, Any]:
        defaults = self._default_runtime_config()
        if not os.path.exists(LLM_RUNTIME_CONFIG_PATH):
            return defaults
        try:
            with open(LLM_RUNTIME_CONFIG_PATH, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return self._serialize_runtime_config(payload, defaults)
        except Exception as exc:
            logger.warning("Failed to load LLM runtime config: %s", exc)
            return defaults

    def _save_runtime_config(self) -> None:
        payload = copy.deepcopy(self._config)
        with open(LLM_RUNTIME_CONFIG_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _apply_runtime_config(self, config: Dict[str, Any]) -> None:
        self.provider = _serialize_llm_provider(config.get("provider"))
        self.openrouter_base_url = _normalize_runtime_string(config.get("openrouter_base_url")) or DEFAULT_OPENROUTER_BASE_URL
        self.openrouter_api_key = _normalize_runtime_string(config.get("openrouter_api_key"))
        self.openrouter_site_url = _normalize_runtime_string(config.get("openrouter_site_url"))
        self.openrouter_app_name = _normalize_runtime_string(config.get("openrouter_app_name")) or DEFAULT_OPENROUTER_APP_NAME
        self.openai_base_url = _normalize_runtime_string(config.get("openai_base_url")) or DEFAULT_OPENAI_BASE_URL
        self.openai_api_key = _normalize_runtime_string(config.get("openai_api_key"))

        if self.provider == "openrouter":
            self.base_url = self.openrouter_base_url
            self.default_api_key = self.openrouter_api_key
        else:
            self.base_url = self.openai_base_url
            self.default_api_key = self.openai_api_key

        self.vision_model = _normalize_runtime_string(config.get("vision_model")) or DEFAULT_VISION_MODEL
        self.text_model = _normalize_runtime_string(config.get("text_model")) or DEFAULT_TEXT_MODEL
        self.vision_api_key = _normalize_runtime_string(config.get("vision_api_key")) or self.default_api_key
        self.default_headers = self._build_default_headers()

        self.vision_client = AsyncOpenAI(
            api_key=self.vision_api_key,
            base_url=self.base_url,
            timeout=240.0,
            default_headers=self.default_headers,
        )
        self.text_client = AsyncOpenAI(
            api_key=self.default_api_key,
            base_url=self.base_url,
            timeout=180.0,
            default_headers=self.default_headers,
        )

        logger.info(
            "LLM service initialized provider=%s text_model=%s vision_model=%s base_url=%s",
            self.provider,
            self.text_model,
            self.vision_model,
            self.base_url,
        )

    def get_runtime_snapshot(self) -> Dict[str, Any]:
        with self._config_lock:
            config = copy.deepcopy(self._config)
        return {
            "config": {
                "provider": config.get("provider", DEFAULT_LLM_PROVIDER),
                "openai_base_url": config.get("openai_base_url", DEFAULT_OPENAI_BASE_URL),
                "openrouter_base_url": config.get("openrouter_base_url", DEFAULT_OPENROUTER_BASE_URL),
                "openrouter_site_url": config.get("openrouter_site_url", ""),
                "openrouter_app_name": config.get("openrouter_app_name", DEFAULT_OPENROUTER_APP_NAME),
                "text_model": config.get("text_model", DEFAULT_TEXT_MODEL),
                "vision_model": config.get("vision_model", DEFAULT_VISION_MODEL),
                "has_openai_api_key": bool(config.get("openai_api_key")),
                "has_openrouter_api_key": bool(config.get("openrouter_api_key")),
                "has_vision_api_key": bool(config.get("vision_api_key")),
                "updated_at": config.get("updated_at"),
            },
            "runtime": {
                "active_provider": self.provider,
                "active_base_url": self.base_url,
                "active_text_model": self.text_model,
                "active_vision_model": self.vision_model,
                "default_headers": copy.deepcopy(self.default_headers),
            },
            "notes": [
                "Blank secret fields keep the existing stored key.",
                "Saving here hot-reloads the in-process LLM clients; backend restart is not required.",
                "OpenRouter uses OpenAI-compatible chat endpoints and supports HTTP-Referer plus X-OpenRouter-Title headers.",
            ],
        }

    def update_runtime_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._config_lock:
            next_config = self._serialize_runtime_config(payload, self._config)
            next_config["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._config = next_config
            self._save_runtime_config()
            self._apply_runtime_config(self._config)
        return self.get_runtime_snapshot()

    async def _process_vision(self, images: List[str], prompt: str, content: str = "", max_side: int = 2000) -> List[dict]:
        try:
            user_content: List[Dict[str, Any]] = [{"type": "text", "text": prompt + "\n\n" + (content or "")}]
            for raw in images or []:
                url = prepare_image_input(raw, max_side=max_side, jpeg_quality=88)
                if url:
                    user_content.append({"type": "image_url", "image_url": {"url": url}})

            messages = [
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user", "content": user_content},
            ]

            try:
                resp = await self.vision_client.chat.completions.create(
                    model=self.vision_model,
                    messages=messages,
                    temperature=0.0,
                    max_tokens=8192,
                )
            except Exception:
                resp = await self.text_client.chat.completions.create(
                    model=self.text_model,
                    messages=messages,
                    temperature=0.0,
                    max_tokens=8192,
                )

            return parse_json_response(resp.choices[0].message.content)
        except Exception as e:
            logger.warning("Vision request failed: %s", e)
            return []

    async def _process_vision_timeout(
        self,
        images: List[str],
        prompt: str,
        content: str = "",
        *,
        max_side: int = 2000,
        timeout_s: float = 180.0,
        tag: str = "",
    ) -> List[dict]:
        try:
            return await asyncio.wait_for(
                self._process_vision(images, prompt, content, max_side=max_side),
                timeout=timeout_s,
            )
        except asyncio.TimeoutError:
            extra = f" [{tag}]" if tag else ""
            logger.warning("Vision request timed out%s timeout=%ss", extra, timeout_s)
            return []
        except Exception as e:
            extra = f" [{tag}]" if tag else ""
            logger.warning("Vision timeout wrapper failed%s: %s", extra, e)
            return []

    async def _process_text(self, text_chunk: str, prompt: str) -> List[dict]:
        try:
            resp = await self.text_client.chat.completions.create(
                model=self.text_model,
                messages=[
                    {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                    {"role": "user", "content": prompt + "\n\n" + (text_chunk or "")},
                ],
                temperature=0.0,
                max_tokens=4096,
            )
            return parse_json_response(resp.choices[0].message.content)
        except Exception as e:
            logger.warning("Text request failed: %s", e)
            return []

    async def _extract_abbrev_map(self, page_texts: dict[int, str]) -> dict[str, dict[str, Any]]:
        chunks = []
        code_re = re.compile(r"\b[A-Z]{2,}\d*(?:-\d+)+(?:-[A-Z])?\b")
        for pidx, text in sorted(page_texts.items()):
            if code_re.search(text or "") or "table" in (text or "").lower():
                chunks.append(f"[Page {pidx+1}]\\n{(text or '')[:2200]}")
            if len(chunks) >= 8:
                break
        if not chunks:
            return {}

        try:
            resp = await self.text_client.chat.completions.create(
                model=self.text_model,
                messages=[
                    {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                    {"role": "user", "content": ABBREV_MAPPING_PROMPT + "\\n\\n" + "\\n\\n".join(chunks)},
                ],
                temperature=0.0,
                max_tokens=4096,
            )
            parsed = clean_and_parse_json(resp.choices[0].message.content)
            rows = parsed.get("sample_map") if isinstance(parsed, dict) else None
            if not isinstance(rows, list):
                return {}
            out = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sid = str(row.get("sample_id") or "").strip()
                if sid:
                    mapped = {
                        "ionic_liquid": row.get("ionic_liquid"),
                        "material_name": row.get("material_name"),
                        "condition": row.get("condition"),
                    }
                    out[sid] = mapped
                    sid_trim = sid.rstrip("%")
                    if sid_trim and sid_trim != sid:
                        out[sid_trim] = mapped
            return out
        except Exception as e:
            logger.warning("Abbreviation extraction failed: %s", e)
            return {}

    def _apply_abbrev(self, record: dict[str, Any], abbrev_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if not abbrev_map:
            return record
        sample_re = re.compile(r"\b[A-Z]{2,}\d*(?:-\d+)+(?:-[A-Z])?\b")
        space = " ".join(
            [
                str(record.get("sample") or ""),
                str(record.get("condition") or ""),
                str(record.get("evidence") or ""),
                str(record.get("notes") or ""),
                str(record.get("film_thickness") or ""),
                str(record.get("source") or ""),
                str(record.get("source_figure") or ""),
            ]
        )

        # Direct IL bracket notation from sample field (e.g. "[BMIM][PF6]").
        if not record.get("ionic_liquid"):
            sample_field = str(record.get("sample") or "")
            il_match = re.search(r"(\[[A-Za-z0-9,+\-]+?\]\[[A-Za-z0-9,+\-]+?\])", sample_field)
            if il_match:
                record["ionic_liquid"] = il_match.group(1)

        # Prefer exact key matching against abbrev_map keys (supports EAN / IL-0 / BB5-1-M ...).
        matched_sid: Optional[str] = None
        for sid in sorted(abbrev_map.keys(), key=len, reverse=True):
            if not sid:
                continue
            if re.search(rf"(?<![A-Za-z0-9]){re.escape(sid)}(?![A-Za-z0-9])", space, flags=re.IGNORECASE):
                matched_sid = sid
                break

        # Fallback to pattern scanning for sample-like IDs.
        if not matched_sid:
            for sid in sample_re.findall(space):
                sid_norm = sid.strip().rstrip(".,;:%)]")
                if sid_norm in abbrev_map:
                    matched_sid = sid_norm
                    break

        if matched_sid:
            mapped = abbrev_map.get(matched_sid, {})
            if not record.get("ionic_liquid") and mapped.get("ionic_liquid"):
                record["ionic_liquid"] = mapped["ionic_liquid"]
            if not record.get("material_name") and mapped.get("material_name"):
                record["material_name"] = mapped["material_name"]
        return record

    def _split_legend_entries(self, row: dict[str, Any]) -> List[dict[str, Any]]:
        """
        Fallback split for dense legend lines:
        e.g. "in air μ=0.013; 0 V μ=0.019; +1.5 V μ=0.001"
        """
        base = dict(row or {})
        text_space = " ".join(
            [
                str(base.get("evidence") or ""),
                str(base.get("notes") or ""),
                str(base.get("source") or ""),
                str(base.get("source_figure") or ""),
            ]
        )
        text_norm = re.sub(r"\s+", " ", text_space.replace("µ", "μ").replace("渭", "μ").replace("碌", "μ")).strip()
        if not text_norm:
            return [base]

        legend_re = re.compile(
            r"(?P<label>in\s+air|[+-]?\d+(?:\.\d+)?\s*V|OCP)\s*[,;:]?\s*"
            r"(?:μ|u|mu|cof)\s*[:=~]?\s*(?P<cof>\d+(?:\.\d+)?)",
            re.IGNORECASE,
        )
        hits = list(legend_re.finditer(text_norm))
        if not hits:
            return [base]

        if len(hits) == 1 and not base.get("cof"):
            m = hits[0]
            base["cof"] = m.group("cof")
            label = re.sub(r"\s+", " ", m.group("label")).strip()
            if re.search(r"\b(?:[+-]?\d+(?:\.\d+)?\s*V|OCP)\b", label, re.IGNORECASE):
                base.setdefault("potential", label)
            else:
                base.setdefault("water_content", label)
            base.setdefault("evidence", m.group(0))
            return [base]

        out: List[dict[str, Any]] = []
        for m in hits:
            label = re.sub(r"\s+", " ", m.group("label")).strip()
            rec = dict(base)
            rec["cof"] = m.group("cof")
            if re.search(r"\b(?:[+-]?\d+(?:\.\d+)?\s*V|OCP)\b", label, re.IGNORECASE):
                rec["potential"] = label
            else:
                rec["water_content"] = label
            rec["evidence"] = m.group(0)
            out.append(rec)
        return out or [base]

    def _normalize_row(
        self,
        row: dict[str, Any],
        fallback_page: Optional[int],
        page_context: Optional[str] = None,
    ) -> dict[str, Any]:
        return normalize_extraction_row(row, fallback_page, page_context)

    def _drop_reason_for_candidate(self, item: dict[str, Any], modality: str) -> Optional[str]:
        """Quality gate to remove common hallucinated records while preserving recall."""
        modality_l = str(modality or "").lower()
        evidence = str(item.get("evidence") or "").strip()
        notes = str(item.get("notes") or "").strip()
        source = str(item.get("source") or "")
        source_figure = str(item.get("source_figure") or "")
        cof = str(item.get("cof") or "").strip()

        is_figure_like = "figure" in modality_l or "legend" in modality_l

        if is_figure_like:
            has_source_label = bool(re.search(r"\b(fig(?:ure)?|table)\b", f"{source} {source_figure}", re.IGNORECASE))
            if not has_source_label:
                return "figure_missing_source_label"

            unsupported_reason = unsupported_figure_cof_reason(item)
            if unsupported_reason:
                return unsupported_reason

            # For figure-derived COF records, evidence should carry direct coefficient signal.
            support_text = " ".join(part for part in (evidence, notes) if part).strip()
            if cof and support_text and not re.search(
                r"(?:\bcof\b|friction coefficient|coefficient of friction|[μµu]\s*=|\bmu\s*=|\d|linear fit|slope)",
                support_text,
                re.IGNORECASE,
            ):
                return "weak_evidence_no_numeric"

        return None

    def _build_document_profile(self, pdf_path: str, page_texts: dict[int, str]) -> dict[str, Any]:
        total_pages = len(page_texts or {})
        profile: dict[str, Any] = {
            "pdf_name": os.path.basename(pdf_path) if pdf_path else "",
            "total_pages": total_pages,
            "text_chars": 0,
            "avg_text_chars_per_page": 0.0,
            "sparse_text_pages": [],
            "caption_pages": [],
        }
        if not total_pages:
            return profile

        caption_re = re.compile(r"\b(fig(?:ure)?\.?\s*\d+[a-z]?)\b|\btable\s*\d+\b", re.IGNORECASE)
        for pidx, text in sorted((page_texts or {}).items()):
            text_str = (text or "").strip()
            text_len = len(text_str)
            profile["text_chars"] += text_len

            if text_len < 120:
                profile["sparse_text_pages"].append(pidx + 1)
            if caption_re.search(text_str):
                profile["caption_pages"].append(pidx + 1)

        profile["avg_text_chars_per_page"] = round(float(profile["text_chars"]) / float(total_pages), 2)
        return profile

    def _select_visual_pages(
        self,
        visual_idxs: List[int],
        page_texts: dict[int, str],
        high_accuracy: bool,
    ) -> List[int]:
        if not visual_idxs:
            return []

        limit = 18 if high_accuracy else 8
        if len(visual_idxs) <= limit:
            return visual_idxs

        must_include: list[int] = []
        if high_accuracy:
            # Keep early figure pages and caption-bearing pages to avoid missing core figures.
            for p in visual_idxs[:6]:
                if p not in must_include:
                    must_include.append(p)
            caption_re = re.compile(r"\bfig(?:ure)?\.?\s*\d+[a-z]?\b|\btable\s*\d+\b", re.IGNORECASE)
            for pidx in visual_idxs:
                text = (page_texts.get(pidx, "") or "")
                if caption_re.search(text):
                    if pidx not in must_include:
                        must_include.append(pidx)
        else:
            # Standard mode still needs deterministic coverage of early/caption pages.
            for p in visual_idxs[:3]:
                if p not in must_include:
                    must_include.append(p)
            key_figure_re = re.compile(r"\bfig(?:ure)?\.?\s*[1-3][a-z]?\b", re.IGNORECASE)
            table_re = re.compile(r"\btable\s*\d+\b", re.IGNORECASE)
            added_table = False
            for pidx in visual_idxs:
                text = (page_texts.get(pidx, "") or "")
                if key_figure_re.search(text):
                    if pidx not in must_include:
                        must_include.append(pidx)
                elif (not added_table) and table_re.search(text):
                    if pidx not in must_include:
                        must_include.append(pidx)
                    added_table = True

        scored: List[tuple[int, int]] = []
        for pidx in visual_idxs:
            text = (page_texts.get(pidx, "") or "").lower()
            score = 0
            if "figure" in text or re.search(r"\bfig\.?\s*\d+", text):
                score += 4
            if "table" in text:
                score += 3
            if any(k in text for k in ("cof", "friction", "load", "speed", "roughness", "thickness", "nm", "um/s", "μm/s")):
                score += 3
            score += min(4, len(re.findall(r"\d+(?:\.\d+)?", text)))
            if len(text.strip()) > 120:
                score += 1
            scored.append((score, pidx))

        scored.sort(key=lambda x: (x[0], -x[1]), reverse=True)
        selected: set[int] = set()
        for p in must_include:
            if len(selected) >= limit:
                break
            selected.add(p)
        for _, p in scored:
            if len(selected) >= limit:
                break
            selected.add(p)
        return [p for p in visual_idxs if p in selected]

    async def extract_tribology_data(
        self,
        content: str = "",
        images: Optional[List[str]] = None,
        pdf_path: Optional[str] = None,
        vision_concurrency: int = 2,
        profile: str = "high_accuracy",
        progress_callback: Optional[Callable[[dict[str, Any]], Awaitable[None]]] = None,
        strict_cof_mode: bool = False,
    ) -> List[TribologyData]:
        profile = (profile or "high_accuracy").lower()
        high_accuracy = profile == "high_accuracy"

        candidates: List[dict[str, Any]] = []
        dropped_by_reason: Dict[str, int] = {}
        page_texts: dict[int, str] = {}
        page_coverage = {"total_pages": 0, "visual_pages": [], "text_pages": []}
        abbrev_map: dict[str, dict[str, Any]] = {}
        document_context: dict[str, Any] = {}
        page_candidate_counts: Dict[str, Dict[str, int]] = {}
        progress_log: List[Dict[str, Any]] = []

        last_progress_emit_at = 0.0

        async def _log_progress(
            stage: str,
            message: str,
            page: Optional[int] = None,
            *,
            force_emit: bool = False,
        ) -> None:
            nonlocal last_progress_emit_at
            entry: Dict[str, Any] = {"stage": stage, "message": message}
            if page is not None:
                entry["page"] = int(page)
            progress_log.append(entry)
            if page is not None:
                print(f"[Progress][{stage}][Page {page}] {message}")
            else:
                print(f"[Progress][{stage}] {message}")

            if not progress_callback:
                return
            now_mono = time.monotonic()
            if not force_emit and (now_mono - last_progress_emit_at) < 5.0:
                return
            try:
                await progress_callback(
                    {
                        "stage": stage,
                        "message": message,
                        "page": int(page) if page is not None else None,
                        "candidate_count": len(candidates),
                        "kept_count": 0,
                        "dropped_by_reason": dict(dropped_by_reason),
                        "page_coverage": dict(page_coverage),
                        "page_candidate_counts": page_candidate_counts,
                        "progress_log": progress_log[-120:],
                        "force": bool(force_emit),
                    }
                )
                last_progress_emit_at = now_mono
            except Exception as cb_err:
                print(f"[ProgressCallback] {cb_err}")

        def _bump_page_count(page: Optional[int], modality: str, *, kept: bool = False, dropped: bool = False) -> None:
            if page is None:
                return
            key = str(int(page))
            bucket = page_candidate_counts.setdefault(
                key,
                {
                    "total": 0,
                    "figure": 0,
                    "text": 0,
                    "other": 0,
                    "kept_after_validation": 0,
                    "dropped_after_validation": 0,
                },
            )
            mod = str(modality or "").lower()
            if mod.startswith("figure"):
                bucket["figure"] += 1
            elif mod.startswith("text"):
                bucket["text"] += 1
            else:
                bucket["other"] += 1
            bucket["total"] += 1
            if kept:
                bucket["kept_after_validation"] += 1
            if dropped:
                bucket["dropped_after_validation"] += 1

        if pdf_path and os.path.exists(pdf_path):
            cls = classify_pdf_pages(pdf_path)
            visual_idxs = sorted(cls.get("visual_pages", []))
            text_idxs = sorted(cls.get("text_pages", []))
            page_texts = cls.get("page_texts", {}) or {}
            selected_visual_idxs = self._select_visual_pages(visual_idxs, page_texts, high_accuracy)

            page_coverage = {
                "total_pages": len(page_texts),
                "visual_pages": [p + 1 for p in visual_idxs],
                "selected_visual_pages": [p + 1 for p in selected_visual_idxs],
                "text_pages": [p + 1 for p in text_idxs],
            }
            document_context = extract_experimental_document_context(page_texts)
            await _log_progress(
                "stage_a.profile",
                f"total_pages={len(page_texts)}, visual={len(visual_idxs)}, selected_visual={len(selected_visual_idxs)}, text_only={len(text_idxs)}",
                force_emit=True,
            )
            if document_context:
                await _log_progress(
                    "stage_a.context",
                    ", ".join(f"{key}={value}" for key, value in sorted(document_context.items())),
                )
            abbrev_map = await self._extract_abbrev_map(page_texts)
            await _log_progress("stage_b.abbrev", f"abbrev_map_count={len(abbrev_map)}")

            # Stage C1: Figure/table extraction
            if selected_visual_idxs:
                doc = fitz.open(pdf_path)
                if high_accuracy:
                    sem = asyncio.Semaphore(max(1, vision_concurrency))
                    timed_out_pages: List[int] = []

                    async def _ingest_figure_rows(pidx: int, rows: List[dict]) -> None:
                        page_num = pidx + 1
                        await _log_progress("stage_c.figure", f"raw_candidates={len(rows or [])}", page=page_num)
                        page_text = page_texts.get(pidx, "") or ""
                        fig_match = re.search(r"\bfig(?:ure)?\.?\s*([0-9]+[a-z]?)\b", page_text, re.IGNORECASE)
                        table_match = re.search(r"\btable\s*([0-9]+[a-z]?)\b", page_text, re.IGNORECASE)
                        fallback_label = None
                        if fig_match:
                            fallback_label = f"Fig. {fig_match.group(1).upper()}"
                        elif table_match:
                            fallback_label = f"Table {table_match.group(1).upper()}"
                        for row in rows:
                            row = dict(row or {})
                            row.setdefault("source_page", pidx + 1)
                            if fallback_label:
                                row.setdefault("source_figure", fallback_label)
                                row.setdefault("source", fallback_label)
                            expanded_rows = self._split_legend_entries(row)
                            for expanded in expanded_rows:
                                _bump_page_count(page_num, "figure")
                                candidates.append({
                                    "stage": "stage_c",
                                    "modality": "figure",
                                    "page": pidx + 1,
                                    "source_figure": expanded.get("source_figure"),
                                    "raw": expanded,
                                })

                    async def _run_figure_page(pidx: int) -> tuple[int, List[dict]]:
                        async with sem:
                            page = doc[pidx]
                            def _pix_to_data_url(pix: fitz.Pixmap, quality: int = 90) -> str:
                                return "data:image/jpeg;base64," + base64.b64encode(
                                    pix.tobytes(output="jpg", jpg_quality=quality)
                                ).decode()

                            scale = 240 / 72.0
                            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                            image_b64 = _pix_to_data_url(pix, quality=90)
                            ctx = f"[Page {pidx + 1}]\\n{(page_texts.get(pidx, '') or '')[:2600]}"
                            rows = await self._process_vision_timeout(
                                [image_b64],
                                FIGURE_TABLE_EXTRACTION_PROMPT,
                                ctx,
                                max_side=2200,
                                timeout_s=160.0,
                                tag=f"page={pidx + 1}/figure",
                            )
                            # Second-pass legend extraction recovers μ=... entries often missed
                            # by general figure extraction on dense multi-trace plots.
                            page_text_l = (page_texts.get(pidx, "") or "").lower()
                            legend_hint = any(
                                token in page_text_l
                                for token in ("friction", "coefficient", "cof", "mu", "normal load", "lateral force")
                            )
                            if len(rows or []) < 4 and (pidx < 14 or legend_hint):
                                legend_rows = await self._process_vision_timeout(
                                    [image_b64],
                                    FIGURE_LEGEND_COF_PROMPT,
                                    ctx,
                                    max_side=2200,
                                    timeout_s=120.0,
                                    tag=f"page={pidx + 1}/legend-full",
                                )
                                if legend_rows:
                                    rows = [*(rows or []), *legend_rows]

                            # Third-pass: localized high-res crops for dense legends.
                            cof_count = sum(1 for r in (rows or []) if isinstance(r, dict) and r.get("cof") not in (None, ""))
                            dense_hint = any(
                                token in page_text_l
                                for token in ("friction", "coefficient", "cof", "normal load", "lateral force", "figure")
                            )
                            if cof_count < 2 and dense_hint and pidx <= 20:
                                r = page.rect
                                clips = [
                                    fitz.Rect(r.width * 0.45, r.height * 0.08, r.width * 0.99, r.height * 0.95),  # right legend area
                                    fitz.Rect(r.width * 0.00, r.height * 0.35, r.width * 1.00, r.height * 0.99),  # lower figure area
                                ]
                                for clip_idx, clip_rect in enumerate(clips, start=1):
                                    try:
                                        clip_pix = page.get_pixmap(
                                            matrix=fitz.Matrix(300 / 72.0, 300 / 72.0),
                                            clip=clip_rect,
                                            alpha=False,
                                        )
                                        clip_b64 = _pix_to_data_url(clip_pix, quality=92)
                                        clip_ctx = f"{ctx}\\n[Crop {clip_idx}] Focus on legend labels and μ/COF values."
                                        clip_rows = await self._process_vision_timeout(
                                            [clip_b64],
                                            FIGURE_LEGEND_COF_PROMPT,
                                            clip_ctx,
                                            max_side=2600,
                                            timeout_s=95.0,
                                            tag=f"page={pidx + 1}/legend-crop-{clip_idx}",
                                        )
                                        if clip_rows:
                                            rows = [*(rows or []), *clip_rows]
                                    except Exception as clip_err:
                                        print(f"[FigureCrop] page={pidx + 1} crop={clip_idx} error: {clip_err}")
                            return pidx, rows

                    async def _run_figure_page_guarded(pidx: int) -> tuple[int, List[dict]]:
                        try:
                            return await asyncio.wait_for(_run_figure_page(pidx), timeout=260.0)
                        except asyncio.TimeoutError:
                            timed_out_pages.append(pidx)
                            await _log_progress(
                                "stage_c.figure_timeout",
                                "page_timeout_skipped",
                                page=pidx + 1,
                                force_emit=True,
                            )
                            return pidx, []
                        except Exception as page_err:
                            await _log_progress(
                                "stage_c.figure_error",
                                f"{type(page_err).__name__}: {page_err}",
                                page=pidx + 1,
                                force_emit=True,
                            )
                            return pidx, []

                    tasks = [asyncio.create_task(_run_figure_page_guarded(pidx)) for pidx in selected_visual_idxs]
                    for done in asyncio.as_completed(tasks):
                        pidx, rows = await done
                        await _ingest_figure_rows(pidx, rows)

                    # Retry a subset of timeout pages serially with smaller image + stricter timeout.
                    if timed_out_pages:
                        await _log_progress(
                            "stage_c.figure_retry",
                            f"retry_timeout_pages={len(timed_out_pages)}",
                            force_emit=True,
                        )
                    for pidx in timed_out_pages[:6]:
                        try:
                            page = doc[pidx]
                            scale = 170 / 72.0
                            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                            retry_b64 = "data:image/jpeg;base64," + base64.b64encode(
                                pix.tobytes(output="jpg", jpg_quality=80)
                            ).decode()
                            retry_ctx = f"[Page {pidx + 1}]\\n{(page_texts.get(pidx, '') or '')[:2200]}"
                            rows = await self._process_vision_timeout(
                                [retry_b64],
                                FIGURE_TABLE_EXTRACTION_PROMPT,
                                retry_ctx,
                                max_side=1500,
                                timeout_s=85.0,
                                tag=f"page={pidx + 1}/figure-retry",
                            )
                            await _ingest_figure_rows(pidx, rows)
                        except Exception as retry_err:
                            await _log_progress(
                                "stage_c.figure_retry_error",
                                f"{type(retry_err).__name__}: {retry_err}",
                                page=pidx + 1,
                            )
                else:
                    for pidx in selected_visual_idxs:
                        page = doc[pidx]
                        scale = 180 / 72.0
                        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                        image_b64 = "data:image/jpeg;base64," + base64.b64encode(
                            pix.tobytes(output="jpg", jpg_quality=84)
                        ).decode()
                        rows = await self._process_vision_timeout(
                            [image_b64],
                            FIGURE_TABLE_EXTRACTION_PROMPT,
                            "",
                            max_side=1600,
                            timeout_s=75.0,
                            tag=f"page={pidx + 1}/figure-standard",
                        )
                        page_num = pidx + 1
                        await _log_progress("stage_c.figure", f"raw_candidates={len(rows or [])}", page=page_num)
                        page_text = page_texts.get(pidx, "") or ""
                        fig_match = re.search(r"\bfig(?:ure)?\.?\s*([0-9]+[a-z]?)\b", page_text, re.IGNORECASE)
                        table_match = re.search(r"\btable\s*([0-9]+[a-z]?)\b", page_text, re.IGNORECASE)
                        fallback_label = None
                        if fig_match:
                            fallback_label = f"Fig. {fig_match.group(1).upper()}"
                        elif table_match:
                            fallback_label = f"Table {table_match.group(1).upper()}"
                        for row in rows:
                            row = dict(row or {})
                            row.setdefault("source_page", pidx + 1)
                            if fallback_label:
                                row.setdefault("source_figure", fallback_label)
                                row.setdefault("source", fallback_label)
                            expanded_rows = self._split_legend_entries(row)
                            for expanded in expanded_rows:
                                _bump_page_count(page_num, "figure")
                                candidates.append({
                                    "stage": "stage_c",
                                    "modality": "figure",
                                    "page": pidx + 1,
                                    "source_figure": expanded.get("source_figure"),
                                    "raw": expanded,
                                })
                doc.close()

            # Stage C2: Text extraction
            for pidx in text_idxs:
                text = (page_texts.get(pidx, "") or "").strip()
                if not text:
                    continue
                rows = await self._process_text(f"[Page {pidx + 1}]\\n{text[:9000]}", TEXT_EXTRACTION_PROMPT)
                page_num = pidx + 1
                await _log_progress("stage_c.text", f"raw_candidates={len(rows or [])}", page=page_num)
                for row in rows:
                    row = dict(row or {})
                    row.setdefault("source_page", pidx + 1)
                    _bump_page_count(page_num, "text")
                    candidates.append({
                        "stage": "stage_c",
                        "modality": "text",
                        "page": pidx + 1,
                        "source_figure": row.get("source_figure"),
                        "raw": row,
                    })
        else:
            # Legacy fallback without PDF structure
            rows = []
            if images:
                rows = await self._process_vision_timeout(
                    images,
                    FIGURE_TABLE_EXTRACTION_PROMPT,
                    content or "",
                    max_side=1800,
                    timeout_s=150.0,
                    tag="legacy",
                )
            elif content:
                rows = await self._process_text(content, TEXT_EXTRACTION_PROMPT)
            for row in rows:
                candidates.append({
                    "stage": "stage_c",
                    "modality": "legacy",
                    "page": row.get("source_page"),
                    "source_figure": row.get("source_figure"),
                    "raw": dict(row or {}),
                })

        # Stage D normalize + validate
        normalized_rows: List[dict] = []
        for c in candidates:
            page_num = c.get("page")
            page_context = ""
            try:
                if page_num:
                    page_context = page_texts.get(int(page_num) - 1, "") or ""
            except Exception:
                page_context = ""
            norm = self._normalize_row(
                self._apply_abbrev(dict(c.get("raw") or {}), abbrev_map),
                page_num,
                page_context=page_context,
            )
            norm["_modality"] = c.get("modality")
            c["normalized"] = norm
            if not has_core_quantitative_signal(norm):
                reason = "no_core_quant_signal"
                c["drop_reason"] = reason
                dropped_by_reason[reason] = dropped_by_reason.get(reason, 0) + 1
                _bump_page_count(c.get("page"), str(c.get("modality") or "unknown"), dropped=True)
                continue
            modality_l = str(c.get("modality") or "").lower()
            needs_target_metric = bool(strict_cof_mode or modality_l.startswith("figure"))
            if needs_target_metric:
                has_cof = has_explicit_numeric_value(norm.get("cof"))
                has_force = has_explicit_numeric_value(norm.get("friction_force"))
                has_load = has_explicit_numeric_value(norm.get("normal_load") or norm.get("load"))
                if (not has_cof) and (not (has_force and has_load)):
                    reason = "no_target_metric"
                    c["drop_reason"] = reason
                    dropped_by_reason[reason] = dropped_by_reason.get(reason, 0) + 1
                    _bump_page_count(c.get("page"), modality_l, dropped=True)
                    continue
            quality_drop = self._drop_reason_for_candidate(norm, str(c.get("modality") or ""))
            if quality_drop:
                c["drop_reason"] = quality_drop
                dropped_by_reason[quality_drop] = dropped_by_reason.get(quality_drop, 0) + 1
                _bump_page_count(c.get("page"), str(c.get("modality") or "unknown"), dropped=True)
                continue
            _bump_page_count(c.get("page"), str(c.get("modality") or "unknown"), kept=True)
            normalized_rows.append(norm)
        await _log_progress(
            "stage_d.validation",
            f"candidates={len(candidates)}, kept={len(normalized_rows)}, dropped={len(candidates) - len(normalized_rows)}",
        )
        for page_key in sorted(page_candidate_counts.keys(), key=lambda x: int(x)):
            stats = page_candidate_counts[page_key]
            await _log_progress(
                "stage_d.page_counts",
                (
                    f"total={stats.get('total', 0)}, figure={stats.get('figure', 0)}, "
                    f"text={stats.get('text', 0)}, kept={stats.get('kept_after_validation', 0)}, "
                    f"dropped={stats.get('dropped_after_validation', 0)}"
                ),
                page=int(page_key),
            )

        converted_data = calculate_missing_cof(normalized_rows)
        converted_data = set_default_temperature(converted_data)
        converted_data = normalize_surface_terms(converted_data)
        converted_data = normalize_ionic_liquid_terms(converted_data)
        if document_context:
            converted_data = [
                apply_experimental_document_context(item, document_context)
                for item in converted_data
            ]

        def _is_unknown_il(val: Any) -> bool:
            s = str(val or "").strip().lower()
            return s in {"", "unknown", "unknown il", "n/a", "none", "-", "--"}

        # Backfill unknown IL/material within same figure group when the group has a unique known value.
        group_il: Dict[str, set[str]] = {}
        group_surface: Dict[str, set[str]] = {}
        for item in converted_data:
            group_key = f"{item.get('source_page') or ''}|{item.get('source_figure') or item.get('source') or ''}"
            il_val = str(item.get("ionic_liquid") or "").strip()
            mat_val = str(item.get("material_name") or "").strip()
            if not _is_unknown_il(il_val):
                group_il.setdefault(group_key, set()).add(il_val)
            if mat_val and mat_val.lower() not in {"unknown", "unknown material", "n/a", "-", "--"}:
                group_surface.setdefault(group_key, set()).add(mat_val)

        for item in converted_data:
            group_key = f"{item.get('source_page') or ''}|{item.get('source_figure') or item.get('source') or ''}"
            if _is_unknown_il(item.get("ionic_liquid")):
                il_candidates = list(group_il.get(group_key, set()))
                if len(il_candidates) == 1:
                    item["ionic_liquid"] = il_candidates[0]
            mat_now = str(item.get("material_name") or "").strip().lower()
            if mat_now in {"", "unknown", "unknown material", "n/a", "-", "--"}:
                mat_candidates = list(group_surface.get(group_key, set()))
                if len(mat_candidates) == 1:
                    item["material_name"] = mat_candidates[0]

        converted_data = resolve_and_enrich_records(converted_data)
        converted_data, dropped_non_il = filter_to_supported_ionic_liquid_records(converted_data)
        if dropped_non_il:
            await _log_progress(
                "stage_d.il_filter",
                f"dropped_non_il={len(dropped_non_il)}, kept_il={len(converted_data)}",
            )

        valid_records: List[TribologyData] = []
        for item in converted_data:
            if not has_core_quantitative_signal(item):
                continue
            item.setdefault("material_name", "Unknown Material")
            item.setdefault("ionic_liquid", "Unknown IL")
            try:
                valid_records.append(TribologyData(**item))
            except Exception as e:
                print(f"[LLM Skip] {e}")

        # Stage A profile for tracing
        document_profile = self._build_document_profile(pdf_path, page_texts) if (pdf_path and os.path.exists(pdf_path)) else {}
        self._last_extraction_debug = {
            "candidate_count": len(candidates),
            "kept_count": len(valid_records),
            "dropped_by_reason": dropped_by_reason,
            "candidates": candidates,
            "page_coverage": page_coverage,
            "abbrev_map": abbrev_map,
            "document_context": document_context,
            "document_profile": document_profile,
            "page_candidate_counts": page_candidate_counts,
            "progress_log": progress_log[-300:],
            "strict_cof_mode": bool(strict_cof_mode),
        }
        await _log_progress(
            "stage_e.finalize",
            f"validated_records={len(valid_records)}",
            force_emit=True,
        )

        return valid_records

    async def _extract_metadata_only(self, content: str, images: Optional[List[str]] = None) -> dict:
        header = (content or "")[:4500]
        default = {
            "title": "",
            "authors": "",
            "doi": "",
            "journal": "",
            "issn": None,
            "year": None,
            "volume": None,
            "issue": None,
            "pages": None,
        }

        user_content: List[Dict[str, Any]] = [{"type": "text", "text": f"Extract metadata from this paper header:\\n\\n{header}"}]
        if images:
            url = prepare_image_input(images[0], max_side=1600, jpeg_quality=85)
            if url:
                user_content.append({"type": "image_url", "image_url": {"url": url}})

        try:
            resp = await self.vision_client.chat.completions.create(
                model=self.vision_model,
                messages=[
                    {"role": "system", "content": METADATA_EXTRACTION_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.1,
                max_tokens=2048,
            )
            parsed = clean_and_parse_json(resp.choices[0].message.content)
            if not isinstance(parsed, dict):
                return default
            out = {**default, **parsed}
            if isinstance(out.get("year"), str):
                try:
                    out["year"] = int(out["year"])
                except Exception:
                    out["year"] = None
            return out
        except Exception as e:
            print(f"[Metadata] {e}")
            return default

    async def extract_with_metadata(
        self,
        content: str,
        images: Optional[List[str]] = None,
        pdf_path: Optional[str] = None,
        extraction_profile: str = "high_accuracy",
        progress_callback: Optional[Callable[[dict[str, Any]], Awaitable[None]]] = None,
        strict_cof_mode: bool = False,
    ) -> dict:
        metadata = await self._extract_metadata_only(content, images)
        final_metadata = metadata.copy()

        doi = (metadata.get("doi") or "").strip()
        if doi:
            try:
                crossref = await DOIService().resolve_doi(doi)
                if crossref:
                    final_metadata = {
                        "title": crossref.title or metadata.get("title", ""),
                        "authors": crossref.authors or metadata.get("authors", ""),
                        "doi": crossref.doi,
                        "journal": crossref.journal or metadata.get("journal", ""),
                        "issn": crossref.issn or metadata.get("issn"),
                        "year": crossref.year or metadata.get("year"),
                        "volume": crossref.volume or metadata.get("volume"),
                        "issue": crossref.issue or metadata.get("issue"),
                        "pages": crossref.pages or metadata.get("pages"),
                    }
            except Exception as e:
                print(f"[DOI Resolve] {e}")

        records = await self.extract_tribology_data(
            content=content,
            images=images,
            pdf_path=pdf_path,
            profile=extraction_profile,
            progress_callback=progress_callback,
            strict_cof_mode=strict_cof_mode,
        )

        data = []
        for r in records:
            row = {
                "material_name": r.material_name,
                "ionic_liquid": r.ionic_liquid,
                "lubricant_components": r.lubricant_components,
                "lubricant_alias": r.lubricant_alias,
                "ionic_liquid_display": r.ionic_liquid_display,
                "lubricant_tooltip": r.lubricant_tooltip,
                "base_oil": r.base_oil,
                "concentration": r.concentration,
                "load": r.load,
                "normal_load": r.normal_load,
                "speed": r.speed,
                "shear_rate": r.shear_rate,
                "temperature": r.temperature,
                "cof": r.cof,
                "cof_extracted": r.cof_extracted,
                "wear_rate": r.wear_rate,
                "test_duration": r.test_duration,
                "contact_type": r.contact_type,
                "potential": r.potential,
                "water_content": r.water_content,
                "probe_material": r.probe_material,
                "probe_geometry": r.probe_geometry,
                "probe_radius": r.probe_radius,
                "probe_roughness": r.probe_roughness,
                "substrate_material": r.substrate_material,
                "substrate_coating": r.substrate_coating,
                "substrate_roughness": r.substrate_roughness,
                "surface_roughness": r.surface_roughness,
                "residual_film_thickness_d": r.residual_film_thickness_d,
                "layer_spacing_delta": r.layer_spacing_delta,
                "film_thickness": r.film_thickness,
                "regime": r.regime,
                "tribological_system": r.tribological_system,
                "experiment_scale": r.experiment_scale,
                "experiment_method": r.experiment_method,
                "measurement_type": r.measurement_type,
                "training_view": r.training_view,
                "mol_ratio": r.mol_ratio,
                "cation": r.cation,
                "anion": r.anion,
                "cation_smiles": r.cation_smiles,
                "anion_smiles": r.anion_smiles,
                "il_smiles": r.il_smiles,
                "il_inchikey": r.il_inchikey,
                "alkyl_chain_length": r.alkyl_chain_length,
                "source": r.source,
                "source_page": r.source_page,
                "source_figure": r.source_figure,
                "notes": r.notes,
                "friction_force": r.friction_force,
                "value_origin": r.value_origin,
                "evidence": r.evidence,
            }
            row["confidence"] = calculate_confidence(row)
            data.append(row)

        debug = self._last_extraction_debug or {}
        extraction_summary = {
            "candidate_count": int(debug.get("candidate_count") or 0),
            "final_count": len(data),
            "dropped_by_reason": debug.get("dropped_by_reason") or {},
            "page_coverage": debug.get("page_coverage") or {},
            "abbrev_count": len(debug.get("abbrev_map") or {}),
            "page_candidate_counts": debug.get("page_candidate_counts") or {},
            "progress_log": debug.get("progress_log") or [],
            "strict_cof_mode": bool(debug.get("strict_cof_mode")),
        }

        return {
            "metadata": final_metadata,
            "data": data,
            "extraction_summary": extraction_summary,
            "trace_candidates": debug.get("candidates") or [],
            "document_profile": debug.get("document_profile") or {},
        }

    async def chat(self, message: str, context: Optional[str] = None) -> str:
        messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        if context:
            messages.append({"role": "user", "content": f"Context:\\n{context[:2000]}..."})
        messages.append({"role": "user", "content": message})

        try:
            resp = await self.text_client.chat.completions.create(
                model=self.text_model,
                messages=messages,
                temperature=0.5,
                max_tokens=2048,
            )
            return resp.choices[0].message.content
        except Exception as e:
            return f"Request failed: {e}"


llm_service = LLMService()
