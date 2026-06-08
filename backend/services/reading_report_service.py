from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import Literature, LiteratureReadingReport, RecordCandidate, TribologyData
from services.llm_service import llm_service
from services.record_correction_service import refresh_tribology_schema_layers

READING_REPORT_PROMPT_VERSION = "reading-report-v3-general-table"
EMPTY_REPORT_VALUE_LABELS = {
    "",
    "-",
    "--",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "unspecified",
    "not specified",
    "not stated",
    "not reported",
    "not provided",
    "not given",
    "review required",
}


def _metadata_summary(metadata: dict[str, Any]) -> str:
    parts = []
    for key in ("journal", "year", "doi"):
        value = metadata.get(key)
        if value not in (None, ""):
            parts.append(f"{key}: {value}")
    return "; ".join(parts)


def build_reading_report_prompt(*, title: str, metadata: dict[str, Any] | None = None) -> str:
    meta = _metadata_summary(metadata or {})
    return f"""
Read this paper for IonicLink and produce a general-purpose Markdown reading report.

Title: {title or "Untitled"}
Metadata: {meta or "not provided"}

Write like a normal large-model response to an uploaded paper: summarize the paper's question,
system, methods, main findings, important evidence, and limitations in readable prose.

Keep the report broadly useful across papers. Do not force a fixed extraction checklist, and do not
single out narrow domain variables or template-specific fields unless the paper itself makes them
central to the story. If a specialized detail appears, fold it into the relevant method or finding
instead of creating a dedicated field-style section for it.
Do not create dedicated sections named "Operating conditions", "Additives", "Electric/current",
"Water/humidity", or similar narrow buckets; only mention those details inside the general system,
method, results, or evidence rows when they are actually important.

Start with a compact "Snapshot table" using this general shape:
| Topic | What to capture |
| --- | --- |
| Research question | ... |
| System studied | ... |
| Method / setup | ... |
| Main results | ... |
| Evidence to verify | ... |

After the table, use short Markdown headings and bullets for interpretation and caveats. Include
a short "Possible follow-up extraction" section only when the paper clearly contains structured
values worth reviewing.
""".strip()


def _preview_field(
    *,
    key: str,
    label: str,
    layer: str,
    value: Any,
    note: str,
) -> dict[str, Any]:
    text = "" if value is None else str(value).strip()
    has_value = text.lower() not in EMPTY_REPORT_VALUE_LABELS
    return {
        "key": key,
        "label": label,
        "layer": layer,
        "status": "ready" if has_value else "review",
        "value": text or None,
        "note": note,
    }


def _build_cleaning_preview(
    *,
    literature_id: int | None = None,
    extractor_type: str | None = None,
    report_id: int | None = None,
    prompt_version: str | None = None,
    title: str | None,
    report_text: str,
    lubricant: str | None,
    cation: str | None,
    anion: str | None,
    substrate_material: str | None,
    temperature: str | None,
    load: str | None,
    cof_raw: str | None,
    speed: str | None = None,
    additive: str | None = None,
    surface_roughness: str | None = None,
    test_duration: str | None = None,
    source_label: str | None,
) -> dict[str, Any]:
    excerpt = re.sub(r"\s+", " ", report_text).strip()[:700]
    extended_context = {
        key: value
        for key, value in {
            "speed": speed,
            "additive": additive,
            "surface_roughness": surface_roughness,
            "test_duration": test_duration,
        }.items()
        if value
    }
    core_fields = [
        _preview_field(
            key="cation",
            label="Cation",
            layer="core",
            value=cation,
            note="Required before promotion. Split from the ionic-liquid label when possible.",
        ),
        _preview_field(
            key="anion",
            label="Anion",
            layer="core",
            value=anion,
            note="Required before promotion. Split from the ionic-liquid label when possible.",
        ),
        _preview_field(
            key="substrate_material",
            label="Substrate",
            layer="core",
            value=substrate_material,
            note="Required before promotion. Confirm the actual counter surface or substrate.",
        ),
        _preview_field(
            key="temperature",
            label="Temperature",
            layer="core",
            value=temperature,
            note="Required before promotion. Use an explicit reported value or a reviewed ambient assumption.",
        ),
        _preview_field(
            key="load",
            label="Load",
            layer="core",
            value=load,
            note="Required before promotion. Keep raw text if conversion is not yet reviewed.",
        ),
        _preview_field(
            key="cof",
            label="COF",
            layer="core",
            value=cof_raw,
            note="Required before promotion. Verify against the PDF source.",
        ),
    ]
    missing_core = [field for field in core_fields if field["status"] != "ready"]
    return {
        "core_fields": core_fields,
        "core_summary": {
            "total": len(core_fields),
            "ready": len(core_fields) - len(missing_core),
            "missing_keys": [field["key"] for field in missing_core],
            "missing_labels": [field["label"] for field in missing_core],
            "can_promote": not missing_core,
        },
        "extended_fields": [
            _preview_field(
                key="material_name",
                label="Paper / system",
                layer="extended",
                value=title,
                note="Use as a draft row label until the review sheet normalizes the actual system.",
            ),
            _preview_field(
                key="lubricant",
                label="Ionic liquid label",
                layer="extended",
                value=lubricant,
                note="Human-readable IL label; normalized cation and anion remain the core fields.",
            ),
            _preview_field(
                key="speed",
                label="Speed",
                layer="extended",
                value=speed,
                note="Optional context. Capture if the paper reports sliding speed, scan rate, or shear rate.",
            ),
            _preview_field(
                key="additive",
                label="Additive",
                layer="extended",
                value=additive,
                note="Optional context. Use for lubricant additives or blend components when clearly reported.",
            ),
            _preview_field(
                key="surface_roughness",
                label="Roughness",
                layer="extended",
                value=surface_roughness,
                note="Optional context. Keep numeric or descriptive roughness evidence when available.",
            ),
            _preview_field(
                key="test_duration",
                label="Test duration",
                layer="extended",
                value=test_duration,
                note="Optional context. Capture test time, sliding time, cycles, or scan duration when reported.",
            ),
            _preview_field(
                key="method_context",
                label="Method context",
                layer="extended",
                value="Report paragraph",
                note="Use the reading report to recover method, apparatus, and condition details during review.",
            ),
            _preview_field(
                key="source_location",
                label="Source location",
                layer="extended",
                value=source_label,
                note="Confirm exact page, figure, or table before accepting the candidate.",
            ),
        ],
        "raw_flexible_json": {
            "source": "reading_report",
            "schema": "core_extended_raw",
            "literature_id": literature_id,
            "extractor_type": extractor_type,
            "report_id": report_id,
            "prompt_version": prompt_version,
            "evidence_excerpt": excerpt,
            "extended_context": extended_context,
        },
}


def _split_ionic_liquid_pair(lubricant: str | None) -> tuple[str | None, str | None]:
    text = (lubricant or "").strip()
    match = re.match(r"^\[([^\[\]]+)\]\[([^\[\]]+)\]$", text)
    if not match:
        return None, None
    return match.group(1).strip() or None, match.group(2).strip() or None


def _clean_report_candidate_value(value: str | None) -> str | None:
    text = re.sub(r"\s+", " ", value or "").strip()
    text = text.strip(" |;,.")
    return text or None


def _first_report_match(report_text: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, report_text, re.IGNORECASE)
        if not match:
            continue
        value = match.groupdict().get("value") or match.group(1)
        cleaned = _clean_report_candidate_value(value)
        if cleaned:
            return cleaned
    return None


def _extract_core_context_from_report(report_text: str) -> dict[str, str | None]:
    force_unit_pattern = r"(?:mN|µN|μN|uN|nN|N|g|kgf)"
    substrate_terms = (
        r"highly oriented pyrolytic graphite",
        r"HOPG(?:\s+graphite)?",
        r"graphite",
        r"graphene",
        r"mica",
        r"silica",
        r"SiO2",
        r"silicon dioxide",
        r"silicon",
        r"steel",
        r"gold",
        r"Au",
        r"glass",
        r"sapphire",
        r"MoS2",
        r"PTFE",
    )
    substrate_value = rf"(?:{'|'.join(substrate_terms)})(?:\s+(?:substrate|surface|counterface|counter\s+surface))?"
    substrate = _first_report_match(
        report_text,
        (
            rf"\b(?:on|onto|over|against|supported\s+on)\s+(?P<value>{substrate_value})\b",
            rf"\b(?:substrate|surface|counterface|counter\s+surface)\s*(?:is|was|:|=)?\s*(?P<value>{substrate_value})\b",
        ),
    )
    temperature = _first_report_match(
        report_text,
        (
            r"\btemperature\s*(?:is|was|of|:|=)?\s*(?P<value>[+-]?\d+(?:\.\d+)?\s*(?:K|°C|℃|C))\b",
            r"\bat\s+(?P<value>[+-]?\d+(?:\.\d+)?\s*(?:K|°C|℃|C))\b",
            r"\b(?P<value>room\s+temperature|ambient\s+temperature)\b",
        ),
    )
    load = _first_report_match(
        report_text,
        (
            rf"\b(?:normal\s+)?load(?:s| range)?\s*(?:is|was|of|:|=|under|exceeds?|exceeding|above|over|greater\s+than|reaches?|reached)?\s*(?P<value>[~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*{force_unit_pattern})\b",
            rf"\bunder\s+(?P<value>[~≈<>≤≥]?\s*\d+(?:\.\d+)?\s*{force_unit_pattern})\s+(?:normal\s+)?load\b",
        ),
    )
    return {
        "substrate_material": substrate,
        "temperature": temperature,
        "load": load,
    }


def _extract_extended_context_from_report(report_text: str) -> dict[str, str | None]:
    speed = _first_report_match(
        report_text,
        (
            r"\b(?:sliding\s+speed|scan\s+rate|shear\s+rate|speed)\s*(?:is|was|of|:|=|at)?\s*(?P<value>[~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*(?:nm/s|µm/s|μm/s|um/s|mm/s|m/s|Hz|s-1|s−1|s\^-1))\b",
        ),
    )
    surface_roughness = _first_report_match(
        report_text,
        (
            r"\b(?:surface\s+roughness|substrate\s+roughness|probe\s+roughness|roughness)\s*(?:is|was|of|:|=)?\s*(?P<value>[~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*(?:nm|µm|μm|um|angstrom|Å))\b",
        ),
    )
    test_duration = _first_report_match(
        report_text,
        (
            r"\b(?:test\s+duration|sliding\s+time|scan\s+duration|test\s+time|duration)\s*(?:is|was|of|:|=)?\s*(?P<value>[~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*(?:-|to|–|—)\s*[~≈<>≤≥]?\s*\d+(?:\.\d+)?)?\s*(?:s|sec|seconds?|min|minutes?|h|hr|hours?|cycles?))\b",
        ),
    )
    additive = _first_report_match(
        report_text,
        (
            r"\badditive(?:s)?\s*(?:is|was|of|:|=)?\s*(?P<value>[^|;\n.]{2,80})",
        ),
    )
    return {
        "speed": speed,
        "additive": additive,
        "surface_roughness": surface_roughness,
        "test_duration": test_duration,
    }


class ReadingReportService:
    def __init__(self, runtime: Any | None = None) -> None:
        self.runtime = runtime or llm_service

    async def get_latest(
        self,
        session: AsyncSession,
        literature_id: int,
        *,
        extractor_type: str = "tribology",
    ) -> LiteratureReadingReport | None:
        result = await session.execute(
            select(LiteratureReadingReport)
            .where(
                LiteratureReadingReport.literature_id == literature_id,
                LiteratureReadingReport.extractor_type == extractor_type,
            )
            .order_by(LiteratureReadingReport.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def generate_for_literature(
        self,
        session: AsyncSession,
        literature: Literature,
        *,
        extractor_type: str = "tribology",
        force: bool = False,
    ) -> LiteratureReadingReport:
        report, should_start = await self.start_for_literature(
            session,
            literature,
            extractor_type=extractor_type,
            force=force,
        )
        if not should_start:
            return report
        return await self.run_report(session, report, literature)

    async def start_for_literature(
        self,
        session: AsyncSession,
        literature: Literature,
        *,
        extractor_type: str = "tribology",
        force: bool = False,
    ) -> tuple[LiteratureReadingReport, bool]:
        cached = await self.get_latest(session, literature.id, extractor_type=extractor_type)
        if (
            cached
            and not force
            and cached.status == "completed"
            and cached.prompt_version == READING_REPORT_PROMPT_VERSION
        ):
            return cached, False
        if (
            cached
            and not force
            and cached.status == "running"
            and cached.prompt_version == READING_REPORT_PROMPT_VERSION
        ):
            return cached, False

        report = cached
        if not report or report.prompt_version != READING_REPORT_PROMPT_VERSION:
            report = LiteratureReadingReport(
                literature_id=literature.id,
                extractor_type=extractor_type,
                status="running",
                report_markdown="",
                prompt_version=READING_REPORT_PROMPT_VERSION,
            )
            session.add(report)
            await session.flush()
        else:
            report.status = "running"
            report.report_markdown = ""
            report.error_message = None
            await session.flush()

        return report, True

    async def run_report(
        self,
        session: AsyncSession,
        report: LiteratureReadingReport,
        literature: Literature,
    ) -> LiteratureReadingReport:
        report.status = "running"
        report.report_markdown = ""
        report.error_message = None
        await session.flush()

        prompt = build_reading_report_prompt(
            title=literature.title,
            metadata={
                "journal": literature.journal,
                "year": literature.year,
                "doi": literature.doi,
            },
        )
        try:
            response = await self.runtime.generate_reading_report(
                prompt=prompt,
                content=literature.content or "",
                pdf_path=literature.file_path,
            )
        except Exception as exc:
            report.status = "failed"
            report.error_message = str(exc) or exc.__class__.__name__
            report.report_markdown = ""
            await session.flush()
            return report

        report.status = "completed"
        report.report_markdown = str(response.get("report_markdown") or "").strip()
        report.model = response.get("model")
        report.provider = response.get("provider")
        report.error_message = None
        report.source_summary_json = json.dumps(
            {
                "content_chars": len(literature.content or ""),
                "has_pdf": bool(literature.file_path),
            },
            ensure_ascii=False,
        )
        await session.flush()
        return report

    async def update_markdown(
        self,
        session: AsyncSession,
        literature: Literature,
        *,
        markdown: str,
        extractor_type: str = "tribology",
    ) -> LiteratureReadingReport:
        report = await self.get_latest(session, literature.id, extractor_type=extractor_type)
        previous_markdown = report.report_markdown if report else None
        markdown_changed = (previous_markdown or "").strip() != (markdown or "").strip()
        if not report or report.prompt_version != READING_REPORT_PROMPT_VERSION:
            report = LiteratureReadingReport(
                literature_id=literature.id,
                extractor_type=extractor_type,
                status="completed",
                report_markdown=markdown,
                prompt_version=READING_REPORT_PROMPT_VERSION,
            )
            session.add(report)
        else:
            report.status = "completed"
            report.report_markdown = markdown
            report.error_message = None
        literature.error_message = None
        if markdown_changed:
            await session.execute(
                delete(RecordCandidate).where(
                    RecordCandidate.literature_id == literature.id,
                    RecordCandidate.record_origin == "reading_report_draft",
                    RecordCandidate.promoted_record_id.is_(None),
                )
            )
        await session.flush()
        return report

    async def generate_candidate_draft(
        self,
        session: AsyncSession,
        literature: Literature,
        *,
        extractor_type: str = "tribology",
    ) -> dict[str, Any]:
        report = await self.get_latest(session, literature.id, extractor_type=extractor_type)
        if not report or report.status != "completed" or not report.report_markdown.strip():
            return {
                "success": False,
                "candidate_count": 0,
                "status": report.status if report else "missing",
                "message": (report.error_message if report else None) or "Reading report is not ready.",
            }

        await session.execute(
            delete(RecordCandidate).where(
                RecordCandidate.literature_id == literature.id,
                RecordCandidate.promoted_record_id.is_(None),
            )
        )

        report_text = report.report_markdown.strip()
        il_match = re.search(r"(\[[A-Za-z0-9,+\-\s]+\]\s*\[[A-Za-z0-9,+\-\s]+\])", report_text)
        cof_match = re.search(r"(?:cof|friction coefficient|μ|mu)\D{0,24}([0-9]+(?:\.[0-9]+)?)", report_text, re.IGNORECASE)
        page_match = re.search(r"\bpage\s+([0-9]+)\b", report_text, re.IGNORECASE)
        source_match = re.search(
            r"\b(?:fig(?:ure)?|table)\.?\s*([0-9]+[A-Za-z]?)"
            r"|\bgraphical\s+abstract\b"
            r"|\babstract\s+(?:figure|graphic|image|plot|visual)\b"
            r"|\b(?:summary|toc)\s+(?:figure|graphic|image|visual)\b",
            report_text,
            re.IGNORECASE,
        )
        evidence = report_text[:900]
        lubricant = il_match.group(1).replace(" ", "") if il_match else None
        cation, anion = _split_ionic_liquid_pair(lubricant)
        cof_raw = cof_match.group(1) if cof_match else None
        source_label = source_match.group(0).strip() if source_match else None
        core_context = _extract_core_context_from_report(report_text)
        extended_context = _extract_extended_context_from_report(report_text)
        cleaning_preview = _build_cleaning_preview(
            literature_id=literature.id,
            extractor_type=extractor_type,
            report_id=report.id,
            prompt_version=report.prompt_version,
            title=literature.title,
            report_text=report_text,
            lubricant=lubricant,
            cation=cation,
            anion=anion,
            substrate_material=core_context["substrate_material"],
            temperature=core_context["temperature"],
            load=core_context["load"],
            cof_raw=cof_raw,
            speed=extended_context["speed"],
            additive=extended_context["additive"],
            surface_roughness=extended_context["surface_roughness"],
            test_duration=extended_context["test_duration"],
            source_label=source_label,
        )
        final_count = (
            await session.execute(
                select(func.count(TribologyData.id)).where(TribologyData.literature_id == literature.id)
            )
        ).scalar_one()
        if int(final_count or 0) > 0:
            literature.status = "completed"
            literature.error_message = None
            await session.flush()
            return {
                "success": True,
                "candidate_count": 0,
                "official_record_count": int(final_count or 0),
                "status": "already_promoted",
                "candidate_ids": [],
                "cleaning_preview": cleaning_preview,
                "message": "This paper already has official records. No duplicate review candidates were generated.",
            }
        field_evidence_map = {
            "_schema_layers": cleaning_preview,
            "material_name": {"raw_text": literature.title, "source": "reading_report"},
            "lubricant": {"raw_text": lubricant, "source": "reading_report"},
            "cation": {"raw_text": cation, "source": "reading_report"},
            "anion": {"raw_text": anion, "source": "reading_report"},
            "substrate_material": {"raw_text": core_context["substrate_material"], "source": "reading_report"},
            "temperature": {"raw_text": core_context["temperature"], "source": "reading_report"},
            "load": {"raw_text": core_context["load"], "source": "reading_report"},
            "speed": {"raw_text": extended_context["speed"], "source": "reading_report"},
            "additive": {"raw_text": extended_context["additive"], "source": "reading_report"},
            "surface_roughness": {"raw_text": extended_context["surface_roughness"], "source": "reading_report"},
            "test_duration": {"raw_text": extended_context["test_duration"], "source": "reading_report"},
            "cof": {"raw_text": cof_raw, "source": "reading_report"},
        }
        candidate = RecordCandidate(
            literature_id=literature.id,
            material_name=literature.title[:255] if literature.title else "Reading report candidate",
            lubricant=lubricant or "Review required",
            cation=cation,
            anion=anion,
            substrate_material=core_context["substrate_material"],
            temperature=core_context["temperature"],
            load_raw=core_context["load"],
            speed_value=extended_context["speed"],
            surface_roughness=extended_context["surface_roughness"],
            cof_raw=cof_raw,
            cof_value=float(cof_raw) if cof_raw else None,
            source="Reading report",
            source_page=int(page_match.group(1)) if page_match else None,
            source_figure=source_label,
            evidence=evidence,
            field_evidence_json=json.dumps(field_evidence_map, ensure_ascii=False),
            confidence=0.35,
            review_status="needs_review",
            record_origin="reading_report_draft",
            assembly_notes=(
                "Reading report draft. Review against the PDF before promotion; "
                "this lightweight path intentionally skips deep visual/evidence relocation."
            ),
        )
        field_evidence_map = refresh_tribology_schema_layers(field_evidence_map, candidate)
        cleaning_preview = field_evidence_map["_schema_layers"]
        candidate.field_evidence_json = json.dumps(field_evidence_map, ensure_ascii=False)
        session.add(candidate)
        literature.status = "completed"
        literature.error_message = None
        await session.flush()
        return {
            "success": True,
            "candidate_count": 1,
            "status": "needs_review",
            "candidate_ids": [candidate.id],
            "cleaning_preview": cleaning_preview,
            "message": "Generated 1 reading-report draft candidate.",
        }


reading_report_service = ReadingReportService()
