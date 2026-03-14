from __future__ import annotations

import asyncio
import base64
import os
import re
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
    normalize_temperature,
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
from services.llm.utils import (
    clean_and_parse_json,
    has_core_quantitative_signal,
    has_explicit_numeric_value,
    parse_json_response,
    prepare_image_input,
)
from knowledge_base import normalize_ionic_liquid
from utils.pdf_utils import classify_pdf_pages

load_dotenv(override=True)


def _format_thickness_nm(value: float) -> str:
    if float(value).is_integer():
        return f"{int(value)} nm"
    return f"{value:.3f}".rstrip("0").rstrip(".") + " nm"


def _normalize_quantitative_thickness(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text or text.lower() in {"-", "--", "n/a", "none", "unknown"}:
        return None

    match = re.search(
        r"([-+]?\d*\.?\d+)\s*(nm|μm|µm|um|pm|å|a\b|angstrom(?:s)?)",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    magnitude = float(match.group(1))
    unit = match.group(2).lower()
    if unit in {"μm", "µm", "um"}:
        magnitude *= 1000.0
    elif unit == "pm":
        magnitude /= 1000.0
    elif unit in {"å", "a", "angstrom", "angstroms"}:
        magnitude /= 10.0

    return _format_thickness_nm(magnitude)


def _sanitize_thickness_fields(item: dict[str, Any]) -> None:
    for field in ("film_thickness", "residual_film_thickness_d", "layer_spacing_delta"):
        if field in item:
            item[field] = _normalize_quantitative_thickness(item.get(field))


def _normalize_range_text(text: Any, unit_hint: str = "") -> Optional[str]:
    raw = str(text or "").strip()
    if not raw:
        return None
    normalized = (
        raw.replace("–", "-")
        .replace("—", "-")
        .replace("−", "-")
        .replace(" to ", "-")
        .replace(" µ", " µ")
    )
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:-|~\s*|to\s+)\s*(\d+(?:\.\d+)?)\s*([a-zA-Zµμ/]+)?",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    low = match.group(1)
    high = match.group(2)
    unit = (match.group(3) or unit_hint or "").strip()
    return f"{low}-{high} {unit}".strip()


class LLMService:
    def __init__(self):
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.default_api_key = os.getenv("OPENAI_API_KEY", "")
        self.vision_model = os.getenv("LLM_VISION_MODEL", "Qwen/Qwen3-VL-32B-Instruct")
        self.text_model = os.getenv("LLM_TEXT_MODEL", "Pro/deepseek-ai/DeepSeek-V3.2")
        self.vision_api_key = os.getenv("LLM_VISION_API_KEY", self.default_api_key)

        self.vision_client = AsyncOpenAI(api_key=self.vision_api_key, base_url=self.base_url, timeout=240.0)
        self.text_client = AsyncOpenAI(api_key=self.default_api_key, base_url=self.base_url, timeout=180.0)

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
            print(f"[LLM Vision] {e}")
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
            print(f"[LLM Vision Timeout]{extra} timeout={timeout_s}s")
            return []
        except Exception as e:
            extra = f" [{tag}]" if tag else ""
            print(f"[LLM Vision Timeout]{extra} {e}")
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
            print(f"[LLM Text] {e}")
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
            print(f"[Abbrev] {e}")
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
        item = dict(row or {})
        # Normalize common alias fields emitted by different models/prompts.
        if not item.get("cof"):
            for alias in (
                "friction_coefficient",
                "coefficient_of_friction",
                "mu",
                "mu_value",
                "cof_value",
            ):
                if item.get(alias) not in (None, ""):
                    item["cof"] = item.get(alias)
                    break
        if not item.get("load") and item.get("load_value") not in (None, ""):
            item["load"] = item.get("load_value")
        if not item.get("speed") and item.get("speed_value") not in (None, ""):
            item["speed"] = item.get("speed_value")
        if not item.get("material_name"):
            for alias in ("surface", "substrate", "surface_material", "material"):
                if item.get(alias) not in (None, ""):
                    item["material_name"] = item.get(alias)
                    break
        if not item.get("substrate_material"):
            for alias in ("substrate", "surface", "surface_material", "material", "material_name"):
                if item.get(alias) not in (None, ""):
                    item["substrate_material"] = item.get(alias)
                    break
        if not item.get("probe_material"):
            for alias in ("probe", "slider", "upper_specimen", "counterface"):
                if item.get(alias) not in (None, ""):
                    item["probe_material"] = item.get(alias)
                    break
        if not item.get("ionic_liquid"):
            for alias in ("il", "ionicLiquid", "ionic_liquid_name"):
                if item.get(alias) not in (None, ""):
                    item["ionic_liquid"] = item.get(alias)
                    break

        # Fallback parse: extract μ=/cof values from evidence text if explicit.
        if not item.get("cof"):
            ev = " ".join([str(item.get("evidence") or ""), str(item.get("notes") or "")]).strip()
            ev_norm = ev.replace("μ", "mu").replace("µ", "mu").replace("渭", "mu").replace("碌", "mu")
            m = re.search(r"(?:\bmu\b|\bcof\b)\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)", ev_norm, re.IGNORECASE)
            if m:
                item["cof"] = m.group(1)

        # Entity inference from evidence/source when model omitted fields.
        page_ctx = str(page_context or "")[:5000]
        source_val = str(item.get("source") or "").strip()
        source_fig_val = str(item.get("source_figure") or "").strip()
        if re.search(r"\([a-z]\)|\d+[a-z]\b", source_val, flags=re.IGNORECASE):
            source_tag = source_val
        elif source_fig_val:
            source_tag = source_fig_val
        else:
            source_tag = source_val

        def _extract_panel_context(text: str, source_label: str) -> str:
            if not text or not source_label:
                return ""
            m = re.search(r"([a-z])\s*$", source_label.strip().lower())
            if not m:
                return ""
            panel = m.group(1)
            patterns = [
                rf"\({panel}\)\s*(.*?)(?=\([a-z]\)\s*|$)",
                rf"\b{panel}\)\s*(.*?)(?=\b[a-z]\)\s*|$)",
            ]
            for pat in patterns:
                hit = re.search(pat, text, flags=re.IGNORECASE | re.DOTALL)
                if hit:
                    return re.sub(r"\s+", " ", hit.group(1)).strip()[:1800]
            return ""

        panel_ctx = _extract_panel_context(page_ctx, source_tag)
        if not item.get("ionic_liquid"):
            local_space = " ".join(
                [
                    str(item.get("sample") or ""),
                    str(item.get("condition") or ""),
                    str(item.get("evidence") or ""),
                    str(item.get("notes") or ""),
                    str(item.get("source") or ""),
                    str(item.get("source_figure") or ""),
                ]
            )
            full_space = f"{local_space} {page_ctx}".strip()

            def _collect_il_candidates(text: str) -> List[str]:
                candidates: List[str] = []
                patterns = [
                    r"(\[[A-Za-z0-9,+\-]+?\]\[[A-Za-z0-9,+\-]+?\])",
                    r"(\[[A-Za-z0-9,+\-()]+?\]\s*i\s*\[[A-Za-z0-9,+\-()]+?\])",
                ]
                for pat in patterns:
                    for hit in re.findall(pat, text, flags=re.IGNORECASE):
                        il = re.sub(r"\s+", "", str(hit))
                        if il and il not in candidates:
                            candidates.append(il)
                return candidates

            local_ils = _collect_il_candidates(local_space)
            if len(local_ils) == 1:
                item["ionic_liquid"] = local_ils[0]
            else:
                panel_ils = _collect_il_candidates(f"{local_space} {panel_ctx}".strip())
                if len(panel_ils) == 1:
                    item["ionic_liquid"] = panel_ils[0]
                all_ils = _collect_il_candidates(full_space)
                if (not item.get("ionic_liquid")) and len(all_ils) == 1:
                    item["ionic_liquid"] = all_ils[0]
        if not item.get("ionic_liquid"):
            # Deterministic fallback for acronym/non-bracket notations (e.g. "EAN", "ethylammonium nitrate").
            def _canonicalize_il(value: Any) -> str:
                text = str(value or "").strip()
                if not text:
                    return ""
                text_l = text.lower()
                if "ethylammonium nitrate" in text_l or re.search(r"\bean\b", text_l):
                    return "EAN"
                if "ethaline" in text_l:
                    return "Ethaline"
                m = re.search(r"(\[[^\[\]]+?\]\s*(?:i\s*)?\[[^\[\]]+?\])", text)
                if m:
                    return re.sub(r"\s+", "", m.group(1)).replace("]i[", "][")
                if len(text) > 80:
                    return ""
                return text

            il_spaces = [
                str(item.get("sample") or ""),
                str(item.get("condition") or ""),
                str(item.get("evidence") or ""),
                str(item.get("notes") or ""),
                str(item.get("source") or ""),
                str(item.get("source_figure") or ""),
                panel_ctx,
            ]
            for space in il_spaces:
                text = str(space or "").strip()
                if len(text) < 2:
                    continue
                inferred = _canonicalize_il(normalize_ionic_liquid(text))
                inferred_l = str(inferred or "").strip().lower()
                if inferred and inferred_l not in {"unknown", "unknown il", "n/a", "-", "--"}:
                    item["ionic_liquid"] = inferred
                    break
        if not item.get("material_name"):
            local_space_l = " ".join(
                [
                    str(item.get("sample") or ""),
                    str(item.get("condition") or ""),
                    str(item.get("evidence") or ""),
                    str(item.get("notes") or ""),
                    str(item.get("source") or ""),
                    str(item.get("source_figure") or ""),
                ]
            ).lower()
            space_l = f"{local_space_l} {panel_ctx.lower()} {page_ctx.lower()}".strip()
            surface_patterns = [
                (r"\bau\s*\(?111\)?\b|\bgold\s*\(?111\)?\b", "Au(111)"),
                (r"\bmica\b", "Mica"),
                (r"\bhopg\b|\bgraphite\b", "HOPG"),
                (r"\bsilica\b|\bsio2\b", "Silica"),
            ]
            for pat, label in surface_patterns:
                if re.search(pat, space_l):
                    item["material_name"] = label
                    item.setdefault("substrate_material", label)
                    break

        tribo_space = " ".join(
            [
                str(item.get("evidence") or ""),
                str(item.get("notes") or ""),
                str(item.get("source") or ""),
                str(item.get("source_figure") or ""),
                panel_ctx,
                page_ctx[:2500],
            ]
        )
        tribo_space_norm = re.sub(r"\s+", " ", tribo_space).strip()
        tribo_l = tribo_space_norm.lower()

        if not item.get("probe_material"):
            if re.search(r"\bsilica\s+(?:colloid|sphere|probe)\b", tribo_l):
                item["probe_material"] = "Silica"
            elif re.search(r"\bsteel\s+(?:ball|sphere|probe|pin)\b", tribo_l):
                item["probe_material"] = "Steel"

        if not item.get("probe_geometry"):
            if re.search(r"\bcolloid(?:al)?\s+probe\b", tribo_l):
                item["probe_geometry"] = "Colloid probe"
            elif re.search(r"\bsilica\s+sphere\b|\bsphere\b", tribo_l):
                item["probe_geometry"] = "Sphere"
            elif re.search(r"\btip\b", tribo_l):
                item["probe_geometry"] = "Tip"

        if not item.get("probe_radius"):
            radius_match = re.search(
                r"(\d+(?:\.\d+)?)\s*-\s*(?:µ|μ|u)m\s+(?:silica\s+)?sphere",
                tribo_space_norm,
                flags=re.IGNORECASE,
            )
            if radius_match:
                item["probe_radius"] = f"{radius_match.group(1)} µm"
            else:
                diameter_match = re.search(
                    r"(\d+(?:\.\d+)?)\s*(?:µ|μ|u)m\s+(?:silica\s+)?sphere",
                    tribo_space_norm,
                    flags=re.IGNORECASE,
                )
                if diameter_match:
                    item["probe_radius"] = f"{diameter_match.group(1)} µm"

        if not item.get("substrate_material"):
            if re.search(r"\bmica\b", tribo_l):
                item["substrate_material"] = "Mica"
            elif re.search(r"\bsilica\b", tribo_l):
                item["substrate_material"] = "Silica"

        if not item.get("substrate_coating"):
            if re.search(r"\bpeg(?:-brush|-coated|-il)?\b|\bpll-g-peg\b", tribo_l):
                item["substrate_coating"] = "PEG-brush"
            elif item.get("substrate_material") and re.search(r"\bbare\b|\buncoated\b", tribo_l):
                item["substrate_coating"] = "None"

        if not item.get("substrate_roughness"):
            rough_match = re.search(r"(?:roughness|rms)\s*[:=]?\s*([<>≤≥]?\s*\d+(?:\.\d+)?\s*nm)", tribo_space_norm, flags=re.IGNORECASE)
            if rough_match:
                item["substrate_roughness"] = rough_match.group(1).strip()

        if item.get("substrate_material") and not item.get("material_name"):
            item["material_name"] = item["substrate_material"]
        if item.get("substrate_roughness") and not item.get("surface_roughness"):
            item["surface_roughness"] = item["substrate_roughness"]

        load_space = " ".join(
            [
                str(item.get("load") or ""),
                str(item.get("normal_load") or ""),
                str(item.get("evidence") or ""),
                page_ctx[:2500],
            ]
        )
        if not item.get("load"):
            load_range = _normalize_range_text(load_space, "nN")
            if load_range:
                item["load"] = load_range
        if not item.get("normal_load"):
            load_range = _normalize_range_text(load_space, "nN")
            if load_range:
                item["normal_load"] = load_range
        elif str(item.get("normal_load") or "").strip().isdigit() and "ranging from" in load_space.lower():
            load_range = _normalize_range_text(load_space, "nN")
            if load_range:
                item["normal_load"] = load_range
                item["load"] = load_range

        if not item.get("normal_load") and item.get("load"):
            item["normal_load"] = item.get("load")
        if not item.get("load") and item.get("normal_load"):
            item["load"] = item.get("normal_load")
        for key in ("cof", "load", "normal_load", "speed", "temperature", "film_thickness", "friction_force"):
            if key in item and item[key] is not None:
                item[key] = re.sub(r"\s+", " ", str(item[key]).replace("µ", "μ").replace("渭", "μ").replace("碌", "μ")).strip()
        _sanitize_thickness_fields(item)
        if item.get("temperature"):
            item["temperature"] = normalize_temperature(str(item["temperature"]))
        if fallback_page and not item.get("source_page"):
            item["source_page"] = int(fallback_page)
        if not item.get("source"):
            item["source"] = item.get("source_figure") or "Text"
        if item.get("evidence"):
            txt = re.sub(r"\s+", " ", str(item["evidence"]).replace("\u00ad", "")).strip()
            if len(txt) > 560:
                txt = re.sub(r"\s+\S*$", "", txt[:560]).strip()
            item["evidence"] = txt
        return item

    def _drop_reason_for_candidate(self, item: dict[str, Any], modality: str) -> Optional[str]:
        """Quality gate to remove common hallucinated records while preserving recall."""
        modality_l = str(modality or "").lower()
        evidence = str(item.get("evidence") or "").strip()
        source = str(item.get("source") or "")
        source_figure = str(item.get("source_figure") or "")
        cof = str(item.get("cof") or "").strip()

        is_figure_like = "figure" in modality_l or "legend" in modality_l

        if is_figure_like:
            has_source_label = bool(re.search(r"\b(fig(?:ure)?|table)\b", f"{source} {source_figure}", re.IGNORECASE))
            if not has_source_label:
                return "figure_missing_source_label"

            # For figure-derived COF records, evidence should carry direct coefficient signal.
            if cof and evidence and not re.search(r"(?:\bcof\b|friction coefficient|[μµu]\s*=|\bmu\s*=|\d)", evidence, re.IGNORECASE):
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
            await _log_progress(
                "stage_a.profile",
                f"total_pages={len(page_texts)}, visual={len(visual_idxs)}, selected_visual={len(selected_visual_idxs)}, text_only={len(text_idxs)}",
                force_emit=True,
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
                "base_oil": r.base_oil,
                "concentration": r.concentration,
                "load": r.load,
                "normal_load": r.normal_load,
                "speed": r.speed,
                "temperature": r.temperature,
                "cof": r.cof,
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
