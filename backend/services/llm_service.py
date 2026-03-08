import os
import json
import asyncio
import base64
import re
from typing import List, Optional
from openai import AsyncOpenAI
from dotenv import load_dotenv
from models.tribology import TribologyData
from services.doi_service import DOIService
from services.score_service import calculate_confidence
from services.cleaning_service import (
    calculate_missing_cof,
    normalize_temperature,
    set_default_temperature,
    normalize_surface_terms,
    normalize_ionic_liquid_terms
)
from services.il_resolver_service import resolve_and_enrich_records

from services.llm.prompts import (
    ANTI_HALLUCINATION_PROMPT,
    TRIBOLOGY_EXTRACTION_PROMPT,
    FOCUSED_EVIDENCE_EXTRACTION_PROMPT,
    METADATA_EXTRACTION_PROMPT,
    CHAT_SYSTEM_PROMPT
)
from services.llm.utils import (
    prepare_image_input,
    parse_json_response,
    clean_and_parse_json,
    has_core_quantitative_signal,
)
from services.llm.deduplication import deduplicate_records

load_dotenv(override=True)


class LLMService:
    """LLM鏈嶅姟锛岀敤浜庝粠鏂囩尞涓彁鍙栨懇鎿﹀鏁版嵁"""

    def __init__(self):
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.default_api_key = os.getenv("OPENAI_API_KEY", "")

        self.vision_model = os.getenv("LLM_VISION_MODEL", "Qwen/Qwen3-VL-32B-Instruct")
        self.text_model   = os.getenv("LLM_TEXT_MODEL",   "Pro/deepseek-ai/DeepSeek-V3.2")
        self.vision_api_key = os.getenv("LLM_VISION_API_KEY", self.default_api_key)
        self.default_model  = os.getenv("LLM_MODEL", "Pro/deepseek-ai/DeepSeek-V3.2")

        # Vision client 鈥?longer timeout for large multimodal calls
        self.vision_client = AsyncOpenAI(
            api_key=self.vision_api_key,
            base_url=self.base_url,
            timeout=180.0
        )

        # Text client 鈥?shorter timeout, cheaper model
        self.text_client = AsyncOpenAI(
            api_key=self.default_api_key,
            base_url=self.base_url,
            timeout=120.0
        )

        print(f"[LLM Config] Vision Model: {self.vision_model}")
        print(f"[LLM Config] Text Model:   {self.text_model}")

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # Internal: Vision batch (images 鈫?Qwen-VL)
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def _process_batch(
        self,
        batch_idx: int,
        total_batches: int,
        batch_images: List[str],
        content: str,
        base_prompt: str,
    ) -> List[dict]:
        """Process a batch of page images with the VISION LLM (Qwen-VL)."""
        try:
            print(f"[Vision {batch_idx + 1}/{total_batches}] Starting ({len(batch_images or [])} images)...")

            user_content = [{"type": "text", "text": base_prompt + content}]
            if batch_images:
                for img_input in batch_images:
                    url = prepare_image_input(img_input)
                    if url:
                        user_content.append({"type": "image_url", "image_url": {"url": url}})

            messages = [
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user",   "content": user_content},
            ]

            try:
                resp = await self.vision_client.chat.completions.create(
                    model=self.vision_model,
                    messages=messages,
                    temperature=0.0,
                    max_tokens=8192,
                )
            except Exception as e:
                print(f"[Vision {batch_idx + 1}] Primary model failed: {e}")
                if any(c in str(e) for c in ("model_not_found", "404", "400")):
                    print(f"[Vision {batch_idx + 1}] Falling back to text model")
                    resp = await self.text_client.chat.completions.create(
                        model=self.text_model,
                        messages=messages,
                        temperature=0.0,
                        max_tokens=8192,
                    )
                else:
                    raise

            return parse_json_response(resp.choices[0].message.content)

        except Exception as e:
            print(f"[Vision {batch_idx + 1}] Error: {e}")
            return []

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # Internal: Text batch (plain text 鈫?DeepSeek-V3 text model)
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def _process_text_batch(
        self,
        batch_idx: int,
        total_batches: int,
        page_text: str,
        base_prompt: str,
    ) -> List[dict]:
        """Process a chunk of plain text with the fast TEXT LLM (DeepSeek-V3)."""
        try:
            print(f"[Text  {batch_idx + 1}/{total_batches}] Starting ({len(page_text)} chars, text model)...")
            messages = [
                {"role": "system", "content": ANTI_HALLUCINATION_PROMPT},
                {"role": "user",   "content": base_prompt + page_text},
            ]
            resp = await self.text_client.chat.completions.create(
                model=self.text_model,
                messages=messages,
                temperature=0.0,
                max_tokens=4096,
            )
            return parse_json_response(resp.choices[0].message.content)
        except Exception as e:
            print(f"[Text  {batch_idx + 1}] Error: {e}")
            return []

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    def _locate_focus_pages(self, page_texts: dict) -> List[int]:
        """
        Generic focus-page selector for Stage-1 extraction.
        Scores pages by evidence density (figure/table anchors, numeric richness,
        friction-domain keywords, and abbreviation/mapping signals), then expands
        neighbors to preserve caption-body continuity.
        """
        if not page_texts:
            return []

        fig_table_pattern = re.compile(r"\b(?:fig(?:ure)?|tab(?:le)?)\.?\s*\d+[a-z]?\b", re.IGNORECASE)
        panel_pattern = re.compile(r"\b(?:fig(?:ure)?\s*\d+[a-z]|[a-z]\))\b", re.IGNORECASE)
        coded_sample_pattern = re.compile(r"\b[A-Z]{2,}\d*(?:-\d+)+(?:-[A-Z])?\b")
        numeric_unit_pattern = re.compile(
            r"\b\d+(?:\.\d+)?\s*(?:nm|μm|um|nN|mN|N|V|K|°C|wt%|ppm|rpm|m/s|mm/s|MPa)?\b",
            re.IGNORECASE,
        )

        domain_keywords = (
            "friction",
            "cof",
            "coefficient",
            "tribolog",
            "wear",
            "sliding",
            "load",
            "speed",
            "viscos",
            "potential",
            "water content",
            "roughness",
            "film thickness",
            "apparent thickness",
            "layering thickness",
            "hard wall",
            "layer spacing",
        )
        mapping_keywords = (
            "abbreviation",
            "nomenclature",
            "sample code",
            "sample id",
            "defined as",
            "denoted as",
            "where",
        )

        scores: dict[int, int] = {}
        for pidx, raw_text in page_texts.items():
            text = str(raw_text or "")
            if not text.strip():
                continue
            lower = text.lower()
            score = 0

            if fig_table_pattern.search(text):
                score += 3
            if panel_pattern.search(text):
                score += 1
            if any(k in lower for k in domain_keywords):
                score += 2
            if coded_sample_pattern.search(text):
                score += 1
            if "table" in lower and any(k in lower for k in mapping_keywords):
                score += 2

            numeric_count = len(numeric_unit_pattern.findall(text[:8000]))
            if numeric_count >= 12:
                score += 2
            elif numeric_count >= 6:
                score += 1

            if score > 0:
                scores[int(pidx)] = score

        if not scores:
            return []

        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        # Seed pages = top evidence-dense pages
        seed_pages = [p for p, _ in ranked[:6]]

        focus_pages_set = set()
        for pidx in seed_pages:
            focus_pages_set.add(pidx)
            focus_pages_set.add(pidx - 1)
            focus_pages_set.add(pidx + 1)

        focus_pages = sorted(p for p in focus_pages_set if p in page_texts)
        if len(focus_pages) > 10:
            focus_pages = focus_pages[:10]
        return focus_pages

    async def _extract_focus_evidence_records(self, pdf_path: str, page_texts: dict) -> List[dict]:
        """
        Stage-1 focused extraction for generic complex papers.
        Produces intermediate JSON from high-information evidence pages.
        """
        if not pdf_path or not os.path.exists(pdf_path):
            return []

        focus_pages = self._locate_focus_pages(page_texts)
        if not focus_pages:
            print("[Focused Stage] No high-information evidence pages detected.")
            return []

        print(f"[Focused Stage] Target pages (1-based): {[p + 1 for p in focus_pages]}")

        focus_images: List[str] = []
        try:
            import fitz as _fitz
            doc = _fitz.open(pdf_path)
            for pidx in focus_pages:
                if pidx < 0 or pidx >= len(doc):
                    continue
                page = doc[pidx]
                pix = page.get_pixmap(matrix=_fitz.Matrix(2.4, 2.4), alpha=False)
                img_bytes = pix.tobytes(output="jpg", jpg_quality=86)
                focus_images.append(
                    "data:image/jpeg;base64," + base64.b64encode(img_bytes).decode()
                )
            doc.close()
        except Exception as e:
            print(f"[Focused Stage] Render error: {e}")
            return []

        context_chunks = []
        for pidx in focus_pages:
            txt = str(page_texts.get(pidx, "") or "").strip()
            if txt:
                context_chunks.append(f"[Page {pidx + 1}]\n{txt[:3200]}")
        focus_context = "\n\n".join(context_chunks)

        focused_records = await self._process_batch(
            batch_idx=0,
            total_batches=1,
            batch_images=focus_images,
            content=focus_context,
            base_prompt=FOCUSED_EVIDENCE_EXTRACTION_PROMPT,
        )
        print(f"[Focused Stage] Extracted {len(focused_records)} intermediate records.")
        return focused_records
    # Public: Extract tribology data (smart routing or legacy)
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def extract_tribology_data(
        self,
        content: str = "",
        images: List[str] = None,
        pdf_path: Optional[str] = None,   # NEW: enables smart page routing
        vision_concurrency: int = 2,       # max parallel vision tasks
    ) -> List[TribologyData]:
        """
        Extract tribology data from a PDF.

        Smart-routing mode (when pdf_path is provided):
          鈥?Visual pages (figures/tables) 鈫?Qwen-VL-32B (sequential, rate-limited)
          鈥?Text-only pages              鈫?DeepSeek-V3  (parallel, fast, cheap)

        Legacy mode (no pdf_path): all images 鈫?vision model as before.
        """
        from utils.pdf_utils import classify_pdf_pages

        base_prompt = TRIBOLOGY_EXTRACTION_PROMPT
        all_raw: List[dict] = []
        VISION_BATCH = 2     # pages per vision call  (down from 3 鈫?safer for 32B)
        TEXT_CHUNK   = 8000  # chars per text-model call

        # 鈹€鈹€ SMART ROUTING 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        if pdf_path:
            cls = classify_pdf_pages(pdf_path)
            visual_idxs = cls["visual_pages"]
            text_idxs   = cls["text_pages"]
            page_texts  = cls["page_texts"]

            print(f"[SmartRoute] Visual={len(visual_idxs)} pages 鈫?{self.vision_model}")
            print(f"[SmartRoute] Text  ={len(text_idxs )} pages 鈫?{self.text_model}")

            # Stage 1: Focused extraction (generic evidence pages) -> intermediate JSON
            focused_raw = await self._extract_focus_evidence_records(pdf_path, page_texts)
            if focused_raw:
                all_raw.extend(focused_raw)

            # 鈹€鈹€ A. Render only visual pages to JPEG 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
            vision_tasks = []
            if visual_idxs:
                import fitz as _fitz
                doc = _fitz.open(pdf_path)
                visual_images: List[str] = []
                for pidx in visual_idxs:
                    if pidx >= len(doc):
                        continue
                    page = doc[pidx]
                    mat  = _fitz.Matrix(2.0, 2.0)          # ~144 DPI
                    pix  = page.get_pixmap(matrix=mat)
                    img_bytes = pix.tobytes(output="jpg", jpg_quality=80)
                    visual_images.append(
                        "data:image/jpeg;base64," + base64.b64encode(img_bytes).decode()
                    )
                doc.close()

                # Rate-limit via semaphore; vision model is expensive
                sem = asyncio.Semaphore(vision_concurrency)

                async def _run_vision(bidx, batch_imgs, total):
                    async with sem:
                        return await self._process_batch(bidx, total, batch_imgs, "", base_prompt)

                batches = [visual_images[i:i + VISION_BATCH]
                           for i in range(0, len(visual_images), VISION_BATCH)]
                vision_tasks = [_run_vision(i, b, len(batches)) for i, b in enumerate(batches)]

            # 鈹€鈹€ B. Combine text-only pages and chunk 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
            text_tasks = []
            if text_idxs:
                combined = "\n\n".join(page_texts.get(p, "") for p in sorted(text_idxs))
                chunks = [combined[i:i + TEXT_CHUNK]
                          for i in range(0, max(1, len(combined)), TEXT_CHUNK)]
                text_tasks = [
                    self._process_text_batch(i, len(chunks), chunk, base_prompt)
                    for i, chunk in enumerate(chunks)
                ]

            # 鈹€鈹€ C. Run both paths simultaneously 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
            results = await asyncio.gather(*vision_tasks, *text_tasks)
            for res in results:
                all_raw.extend(res)

        # 鈹€鈹€ LEGACY MODE (original behaviour; no pdf_path) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        else:
            if images and len(images) > 0:
                BATCH_SIZE = 3
                batches = [images[i:i + BATCH_SIZE] for i in range(0, len(images), BATCH_SIZE)]
                print(f"[Legacy] {len(images)} images 鈫?{len(batches)} vision batches (parallel)")
                tasks = [
                    self._process_batch(i, len(batches), b, content, base_prompt)
                    for i, b in enumerate(batches)
                ]
            else:
                # Pure text fallback
                tasks = [self._process_text_batch(0, 1, content, base_prompt)]

            results = await asyncio.gather(*tasks)
            for res in results:
                all_raw.extend(res)

        # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        # Post-processing (identical for both paths)
        # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        print(f"[LLM Service] Total raw records: {len(all_raw)}")

        string_fields = [
            'load', 'speed', 'temperature', 'cof', 'wear_rate',
            'test_duration', 'concentration', 'base_oil', 'contact_type',
            'material_name', 'ionic_liquid', 'source', 'notes',
            'source_figure',
            'friction_force', 'normal_load', 'value_origin',
            'potential', 'water_content', 'surface_roughness',
            'residual_film_thickness_d', 'layer_spacing_delta', 'film_thickness',
            'mol_ratio', 'cation', 'anion',
            'cation_smiles', 'anion_smiles', 'il_smiles', 'il_inchikey',
            'evidence',
        ]

        converted_data = []
        for item in all_raw:
            if not item:
                continue

            # Normalize synonymous load fields early so AFM records survive later
            # validation and DB persistence.
            if not item.get('load') and item.get('normal_load'):
                item['load'] = item.get('normal_load')
            if not item.get('normal_load') and item.get('load'):
                item['normal_load'] = item.get('load')

            for field in string_fields:
                if field in item and item[field] is not None:
                    if not isinstance(item[field], str):
                        item[field] = str(item[field])

            if item.get('temperature'):
                item['temperature'] = normalize_temperature(str(item['temperature']))

            converted_data.append(item)

        converted_data = calculate_missing_cof(converted_data)
        converted_data = set_default_temperature(converted_data)
        converted_data = normalize_surface_terms(converted_data)
        converted_data = normalize_ionic_liquid_terms(converted_data)
        converted_data = resolve_and_enrich_records(converted_data)

        valid_records = []
        for item in converted_data:
            if not has_core_quantitative_signal(item):
                continue
            if not item.get('material_name'):
                item['material_name'] = "Unknown Material"
            if not item.get('ionic_liquid'):
                item['ionic_liquid'] = "Unknown IL"
            try:
                valid_records.append(TribologyData(**item))
            except Exception as e:
                print(f"[Warning] Skipping invalid record: {e}")

        deduplicated = deduplicate_records(valid_records)
        print(f"[Deduplication] {len(valid_records) - len(deduplicated)} duplicates removed. Final: {len(deduplicated)}")
        return deduplicated

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # Pass 1: Metadata extraction (first page only)
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def _extract_metadata_only(self, content: str, images: List[str] = None) -> dict:
        """浠庢枃鐚椤垫彁鍙栧厓鏁版嵁 (浠呭墠4000瀛楃 鎴?棣栭〉鍥惧儚)"""
        header_content = content[:4000] if content else ""

        default_metadata = {
            "title": "", "authors": "", "doi": "", "journal": "",
            "issn": None, "year": None, "volume": None, "issue": None, "pages": None
        }

        user_content = [
            {"type": "text", "text": f"Extract metadata from this paper header:\n\n{header_content}"}
        ]
        if images and len(images) > 0:
            url = prepare_image_input(images[0])
            if url:
                user_content.append({"type": "image_url", "image_url": {"url": url}})

        try:
            strict_system = (
                METADATA_EXTRACTION_PROMPT
                + "\n\nIMPORTANT: Output ONLY valid JSON. No markdown code blocks. Start with {."
            )
            resp = await self.vision_client.chat.completions.create(
                model=self.vision_model,
                messages=[
                    {"role": "system", "content": strict_system},
                    {"role": "user",   "content": user_content},
                ],
                temperature=0.1,
                max_tokens=4096,
                timeout=30,
            )
            parsed = clean_and_parse_json(resp.choices[0].message.content)
            if parsed is None:
                return default_metadata

            if isinstance(parsed, dict):
                for k, v in default_metadata.items():
                    if k not in parsed or parsed[k] is None:
                        parsed[k] = v
                if isinstance(parsed.get("year"), str):
                    try:
                        parsed["year"] = int(parsed["year"])
                    except Exception:
                        parsed["year"] = None
                return parsed

            return default_metadata

        except Exception as e:
            print(f"[Pass 1] Metadata extraction error: {e}")
            return default_metadata

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # Main entry: Two-pass extraction with smart routing
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def extract_with_metadata(
        self,
        content: str,
        images: List[str] = None,
        pdf_path: Optional[str] = None,   # NEW: forwarded to extract_tribology_data
    ) -> dict:
        """
        Two-pass extraction:
          Pass 1   鈥?metadata from first page
          Pass 1.5 鈥?DOI enrichment via Crossref
          Pass 2   鈥?tribology data (smart routing or legacy)
        """
        print("[Two-Pass] Pass 1: Metadata extraction...")
        llm_metadata = await self._extract_metadata_only(content, images)
        print(f"[Two-Pass] Pass 1 done. Title: {llm_metadata.get('title', 'N/A')[:50]}...")

        # Pass 1.5: DOI Enrichment
        final_metadata = llm_metadata.copy()
        doi_str = llm_metadata.get('doi', '')
        if doi_str and doi_str.strip():
            print(f"[Two-Pass] Pass 1.5: Crossref lookup for DOI={doi_str}")
            try:
                crossref = await DOIService().resolve_doi(doi_str)
                if crossref:
                    print(f"[Two-Pass] Crossref match: {crossref.title[:50] if crossref.title else 'N/A'}...")
                    final_metadata = {
                        "title":   crossref.title   or llm_metadata.get("title", ""),
                        "authors": crossref.authors or llm_metadata.get("authors", ""),
                        "doi":     crossref.doi,
                        "journal": crossref.journal or llm_metadata.get("journal", ""),
                        "issn":    crossref.issn    or llm_metadata.get("issn"),
                        "year":    crossref.year    or llm_metadata.get("year"),
                        "volume":  crossref.volume  or llm_metadata.get("volume"),
                        "issue":   crossref.issue   or llm_metadata.get("issue"),
                        "pages":   crossref.pages   or llm_metadata.get("pages"),
                    }
                else:
                    print("[Two-Pass] Crossref resolution failed, using LLM metadata")
            except Exception as e:
                print(f"[Two-Pass] DOI resolution error: {e}")
        else:
            print("[Two-Pass] No DOI found, skipping Crossref")

        # Pass 2: Tribology data (smart routing)
        print("[Two-Pass] Pass 2: Tribology data extraction (smart routing)...")
        records = await self.extract_tribology_data(content, images, pdf_path=pdf_path)
        print(f"[Two-Pass] Pass 2 done. Records: {len(records)}")

        # Global deduplication
        records = deduplicate_records(records)
        print(f"[Global] Final unique records: {len(records)}")

        # Convert to dicts for serialization
        records_dict = []
        for record in records:
            rd = {
                "material_name":           record.material_name,
                "ionic_liquid":            record.ionic_liquid,
                "base_oil":                record.base_oil,
                "concentration":           record.concentration,
                "load":                    record.load,
                "normal_load":             record.normal_load,
                "speed":                   record.speed,
                "temperature":             record.temperature,
                "cof":                     record.cof,
                "wear_rate":               record.wear_rate,
                "test_duration":           record.test_duration,
                "contact_type":            record.contact_type,
                "potential":               record.potential,
                "water_content":           record.water_content,
                "surface_roughness":       record.surface_roughness,
                "residual_film_thickness_d": record.residual_film_thickness_d,
                "layer_spacing_delta":     record.layer_spacing_delta,
                "film_thickness":          record.film_thickness,
                "mol_ratio":               record.mol_ratio,
                "cation":                  record.cation,
                "anion":                   record.anion,
                "cation_smiles":           record.cation_smiles,
                "anion_smiles":            record.anion_smiles,
                "il_smiles":               record.il_smiles,
                "il_inchikey":             record.il_inchikey,
                "alkyl_chain_length":      record.alkyl_chain_length,
                "source":                  record.source,
                "source_page":             record.source_page,
                "source_figure":           record.source_figure,
                "notes":                   record.notes,
                "friction_force":          record.friction_force,
                "normal_load":             record.normal_load,
                "value_origin":            record.value_origin,
                "evidence":                record.evidence,
                }
            rd["confidence"] = calculate_confidence(rd)
            print(f"[Confidence] material={str(record.material_name)[:30]}, score={rd['confidence']}")
            records_dict.append(rd)

        print(f"[Two-Pass] Applied confidence to {len(records_dict)} records")
        return {
            "metadata": final_metadata,
            "data":     records_dict,
        }

    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # Chat
    # 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    async def chat(self, message: str, context: Optional[str] = None) -> str:
        """Chat with user."""
        messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
        if context:
            messages.append({"role": "user", "content": f"褰撳墠鏂囩尞鍐呭鍙傝€冿細\n{context[:2000]}..."})
        messages.append({"role": "user", "content": message})
        try:
            resp = await self.text_client.chat.completions.create(
                model=self.text_model,
                messages=messages,
                temperature=0.7,
                max_tokens=4096,
            )
            return resp.choices[0].message.content
        except Exception as e:
            return f"Request failed: {str(e)}"


# Global singleton
llm_service = LLMService()






