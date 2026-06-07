import pytest

from models.db_models import RecordCandidate
from models.tribology import TribologyData
from services import file_service
from services.llm import runtime_service
from services.file_service import _build_db_record_from_item
from services.llm.fast_table_extractor import (
    normalize_fast_table_rows,
    parse_fast_table_response,
)
from services.llm.runtime_service import LLMService


SAMPLE_GEMINI_TABLE = """
| 离子液体 (IL) | 摩擦副 (对偶件 / 实验系统) | 实验工况 (偏置电压等) | 摩擦系数 (μ) | 数据来源类型 | 数据来源 |
| --- | --- | --- | --- | --- | --- |
| [BMIM][BF4] | 石墨烯胶体探针/HOPG | -1 V 偏置电压 | 0.0073 | 实验测量 (AFM) | PDF+1 |
| [BMIM][BF4] | 单层石墨烯之间 | +1 V 偏置电压 | 0.046 | 分子动力学模拟 (NEMD) | PDF |
"""


def test_parse_gemini_markdown_table_to_review_candidates():
    raw_rows = parse_fast_table_response(SAMPLE_GEMINI_TABLE)

    assert len(raw_rows) == 2
    assert raw_rows[0]["离子液体 (IL)"] == "[BMIM][BF4]"

    rows = normalize_fast_table_rows(raw_rows)

    assert [row["record_origin"] for row in rows] == ["fast_table_extraction", "fast_table_extraction"]
    assert [row["review_status"] for row in rows] == ["needs_review", "needs_review"]
    assert rows[0]["ionic_liquid"] == "[BMIM][BF4]"
    assert rows[0]["cof"] == "0.0073"
    assert rows[0]["potential"] == "-1 V"
    assert rows[0]["source_page"] == 1
    assert "石墨烯胶体探针" in rows[0]["material_name"]
    assert "实验测量 (AFM)" in rows[0]["notes"]
    assert rows[1]["cof"] == "0.046"


@pytest.mark.asyncio
async def test_extract_with_metadata_uses_fast_table_without_legacy_page_pipeline(monkeypatch):
    monkeypatch.setenv("LLM_FAST_TABLE_ENABLED", "1")
    service = LLMService()
    captured = {}

    async def fake_call_fast_table_model(document_text: str):
        captured["document_text"] = document_text
        return SAMPLE_GEMINI_TABLE

    async def fail_metadata(*_args, **_kwargs):
        raise AssertionError("fast table extraction should skip metadata-only LLM call")

    async def fail_legacy_pipeline(*_args, **_kwargs):
        raise AssertionError("fast table extraction should skip legacy page pipeline")

    monkeypatch.setattr(service, "_call_fast_table_model", fake_call_fast_table_model, raising=False)
    monkeypatch.setattr(service, "_extract_metadata_only", fail_metadata)
    monkeypatch.setattr(service, "extract_tribology_data", fail_legacy_pipeline)

    result = await service.extract_with_metadata(
        content="Paper text with [BMIM][BF4] friction coefficient table.",
        extraction_profile="standard",
    )

    assert "Paper text" in captured["document_text"]
    assert result["metadata"] == {}
    assert len(result["data"]) == 2
    assert result["data"][0]["record_origin"] == "fast_table_extraction"
    assert result["data"][0]["review_status"] == "needs_review"
    assert result["extraction_summary"]["pipeline"] == "fast_table"
    assert result["extraction_summary"]["candidate_count"] == 2


@pytest.mark.asyncio
async def test_review_figure_estimate_profile_skips_fast_table_for_visual_pipeline(monkeypatch):
    monkeypatch.setenv("LLM_FAST_TABLE_ENABLED", "1")
    service = LLMService()
    captured = {}

    async def fail_fast_table(_document_text: str):
        raise AssertionError("review_figure_estimate should not be short-circuited by fast table extraction")

    async def fake_metadata(*_args, **_kwargs):
        return {}

    async def fake_legacy_pipeline(**kwargs):
        captured.update(kwargs)
        return [
            TribologyData(
                material_name="Steel",
                ionic_liquid="[EMIM][BF4]",
                cof="0.12",
                value_origin="figure_estimate",
                source="Fig. 9",
            )
        ]

    monkeypatch.setattr(service, "_call_fast_table_model", fail_fast_table, raising=False)
    monkeypatch.setattr(service, "_extract_metadata_only", fake_metadata)
    monkeypatch.setattr(service, "extract_tribology_data", fake_legacy_pipeline)

    result = await service.extract_with_metadata(
        content="Fig. 9 reports average friction coefficients under different currents.",
        extraction_profile="review_figure_estimate",
    )

    assert captured["profile"] == "review_figure_estimate"
    assert result["data"][0]["value_origin"] == "figure_estimate"
    assert result["extraction_summary"]["requested_profile"] == "review_figure_estimate"


def test_runtime_config_can_hot_swap_fast_table_model(monkeypatch, tmp_path):
    config_path = tmp_path / "llm_runtime_config.json"
    monkeypatch.setattr(runtime_service, "LLM_RUNTIME_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(runtime_service, "RUNTIME_DATA_DIR", str(tmp_path))

    service = LLMService()
    snapshot = service.update_runtime_config(
        {
            "provider": "openai-compatible",
            "openai_base_url": "https://nowcoding.ai/v1",
            "openai_api_key": "test-key",
            "fast_table_model": "claude-sonnet-4-6",
        }
    )

    assert snapshot["config"]["fast_table_model"] == "claude-sonnet-4-6"
    assert snapshot["runtime"]["active_fast_table_model"] == "claude-sonnet-4-6"
    assert service.fast_table_model == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_fast_table_model_call_retries_without_json_mode_and_max_tokens(monkeypatch):
    service = LLMService()
    calls = []

    class FakeMessage:
        content = '{"data":[]}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if "response_format" in kwargs:
                raise RuntimeError("response_format unsupported")
            if "max_tokens" in kwargs:
                raise RuntimeError("max_tokens unsupported")
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    service.text_client = FakeClient()

    result = await service._call_fast_table_model("paper text")

    assert result == '{"data":[]}'
    assert "response_format" in calls[0]
    assert "max_tokens" in calls[1]
    assert "max_completion_tokens" in calls[2]
    assert "max_tokens" not in calls[2]


def test_gemini_table_db_rows_remain_review_candidates():
    db_record, response_item = _build_db_record_from_item(
        literature_id=1,
        item={
            "ionic_liquid": "[BMIM][BF4]",
            "material_name": "石墨烯胶体探针/HOPG",
            "cof": "0.0073",
            "potential": "-1 V",
            "source": "PDF+1",
            "source_page": 1,
            "evidence": "IL: [BMIM][BF4] | 摩擦副: 石墨烯胶体探针/HOPG | μ: 0.0073",
            "record_origin": "fast_table_extraction",
            "review_status": "needs_review",
        },
        file_path=None,
        record_origin="llm_extraction",
        model_cls=RecordCandidate,
    )

    assert db_record.record_origin == "fast_table_extraction"
    assert db_record.review_status == "needs_review"
    assert response_item["record_origin"] == "fast_table_extraction"
    assert response_item["review_status"] == "needs_review"


def test_fast_table_does_not_infer_speed_from_document_context():
    rows = normalize_fast_table_rows(
        [
            {
                "离子液体 (IL)": "[BMIM][BF4]",
                "摩擦副 (对偶件 / 实验系统)": "石墨烯胶体探针/HOPG",
                "实验工况 (偏置电压等)": "0 V 偏置电压",
                "摩擦系数 (μ)": "0.0087",
                "数据来源": "PDF+5",
            }
        ],
        page_context=(
            "ToF-SIMS sputter rate was 0.29 nm/s. "
            "AFM scan range was 500 nm x 500 nm at a scan rate of 2 Hz. "
            "Other model velocities mentioned in the paper are 2 μm/s and 1 m/s."
        ),
    )

    assert len(rows) == 1
    assert rows[0].get("speed") in (None, "")
    assert rows[0].get("speed_value") in (None, "")
    assert rows[0].get("speed_conditions") in (None, {})


def test_fast_table_preserves_explicit_row_speed_only():
    rows = normalize_fast_table_rows(
        [
            {
                "离子液体 (IL)": "[BMIM][BF4]",
                "摩擦副 (对偶件 / 实验系统)": "单层石墨烯之间",
                "实验工况 (偏置电压等)": "+1 V 偏置电压, sliding velocity 1 m/s",
                "摩擦系数 (μ)": "0.046",
                "数据来源": "PDF",
            }
        ],
        page_context="Unrelated sputter rate 0.29 nm/s.",
    )

    assert len(rows) == 1
    assert rows[0]["speed"] == "1 m/s"
    assert rows[0]["speed_value"] == "1 m/s"


def test_fast_table_extracts_multiple_temperature_conditions():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "ethylammonium nitrate (EAN)",
                "friction_pair": "silica colloid probe / mica surface",
                "conditions": (
                    "AFM nanotribology; EAN confined between mica and a silica colloid "
                    "probe at 25 °C, 50 °C, and 80 °C; normal loads 10-40 nN"
                ),
                "cof": "0.12",
                "source": "Abstract",
                "evidence": (
                    "Atomic force microscopy was used to study friction for EAN "
                    "confined between mica and a silica colloid probe at 25 °C, "
                    "50 °C, and 80 °C."
                ),
            }
        ]
    )

    assert rows[0]["temperature"] == "298.15 K; 323.15 K; 353.15 K"


def test_fast_table_uses_main_celsius_value_not_plus_minus_uncertainty():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[EMIM][BF4]",
                "friction_pair": "steel ball / steel disk",
                "conditions": (
                    "IL lubrication; reciprocating frequency 1 Hz; stroke 5 mm; "
                    "load 10 N; test temperature was 25 ± 3 °C"
                ),
                "cof": "0.0688",
                "source": "Fig. 3",
                "evidence": (
                    "The test was conducted at room temperature, which was 25 ± 3 °C."
                ),
            }
        ]
    )

    assert rows[0]["temperature"] == "298.15 K"


def test_fast_table_extracts_relative_humidity_series_as_water_content():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[BMIM][FAP]",
                "friction_pair": "SUJ2 steel ball / SUJ2 steel disk",
                "conditions": (
                    "ball-on-disk tribology; relative humidity levels 15, 50, "
                    "and 80% RH; room temperature"
                ),
                "cof": "0.05",
                "source": "Abstract",
                "evidence": (
                    "Lubricating properties were investigated at different relative "
                    "humidity (RH) levels (15, 50, and 80%)."
                ),
            }
        ]
    )

    assert rows[0]["temperature"] == "298.15 K"
    assert rows[0]["water_content"] == "15% RH; 50% RH; 80% RH"


def test_fast_table_normalizes_open_circuit_potential_millivolts():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[P6,6,6,14][Cl] in dodecane",
                "friction_pair": "silica colloid probe / Au(111)",
                "conditions": (
                    "AFM nanotribology in dry and ambient lubricant mixtures; "
                    "the open circuit potential (OCP) was -160 mV"
                ),
                "cof": "0.12",
                "source": "Methods",
                "evidence": (
                    "The open circuit potential (OCP) of the dry and ambient "
                    "solutions was -160 mV."
                ),
            }
        ]
    )

    assert rows[0]["potential"] == "-0.16 V vs OCP"


def test_fast_table_uses_page_context_to_classify_colloid_probe_afm_rows():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[BMIM] I",
                "friction_pair": "silica colloid probe–Au(111)",
                "conditions": "20 °C; surface potential +0.5 V; sliding speed 2 μm s−1",
                "cof": "0.12",
                "data_source_type": "table",
                "source_page": "4",
                "source": "Table 2",
                "evidence": "Table 2: [BMIM] I, +0.5 V = 0.12",
            }
        ],
        page_context=(
            "[Page 3] Friction measurements using colloid probes were acquired using "
            "a Digital Instruments NanoScope IV Multimode AFM. "
            "[Page 4] Table 2 friction coefficients of [BMIM] I on Au(111)."
        ),
    )

    assert rows[0]["experiment_scale"] == "nanoscale"
    assert rows[0]["experiment_method"] == "afm_colloidal_probe"
    assert rows[0]["tribological_system"]["instrument"] == "afm"
    assert rows[0]["probe_material"] == "Silica"
    assert rows[0]["substrate_material"] == "Au(111)"
    assert "probe" not in rows[0]["substrate_material"].lower()


def test_fast_table_extracts_normal_load_from_tribotest_conditions():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "1-Butyl-3-methylimidazolium hexafluorophosphate (BMIMPF6)",
                "friction_pair": "100Cr6 steel ball / 100Cr6 steel disc",
                "conditions": (
                    "TRB3 ball-on-disc tribometer; Load (P) = 10 N; "
                    "Sliding velocity (v) = 0.1 m/s; Test execution temperatures: "
                    "ambient (25 ± 1.5 °C) and 40 °C; Humidity: 40 ± 0.5%."
                ),
                "cof": "0.08",
                "source": "Materials and Methods",
                "evidence": (
                    "Tribological tests were performed under Load (P) = 10 N, "
                    "Sliding velocity (v) = 0.1 m/s, ambient (25 ± 1.5 °C) "
                    "and 40 °C, and Humidity: 40 ± 0.5%."
                ),
            }
        ]
    )

    assert rows[0]["load"] == "10 N"
    assert rows[0]["load_value"] == "10 N"


def test_fast_table_extracts_entrainment_speed_with_si_negative_exponent_unit():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[C6mim][TfO] as 2 wt% additive in PEG 200",
                "friction_pair": "ASTM 52100 steel ball / ASTM 52100 steel disk",
                "conditions": (
                    "MTM ball-on-disk; all other measurements were carried out "
                    "at an entrainment speed of 10 mm·s−1; applied load of 50 N; "
                    "60 °C; SRR of 50%."
                ),
                "cof": "0.09",
                "source": "Experimental Section",
                "evidence": (
                    "All other MTM measurements were carried out at an entrainment "
                    "speed of 10 mm·s−1."
                ),
            }
        ]
    )

    assert rows[0]["speed"] == "10 mm/s"
    assert rows[0]["speed_value"] == "10 mm/s"


def test_fast_table_extracts_speed_when_pdf_uses_control_char_negative_exponent():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "[HMIM][FAP]",
                "friction_pair": "silica AFM tip / HOPG surface",
                "conditions": (
                    "AFM FFM; scan size of 100 nm and scan speed of "
                    "6.5 μm s\x021 as the load was increased from 0 to 40 nN."
                ),
                "cof": "0.001",
                "source": "Fig. 2",
                "evidence": (
                    "Measurements were performed using a scan size of 100 nm "
                    "and scan speed of 6.5 μm s\x021."
                ),
            }
        ]
    )

    assert rows[0]["speed"] == "6.5 μm/s"
    assert rows[0]["speed_value"] == "6.5 μm/s"


def test_fast_table_extracts_load_when_applied_appears_between_load_and_value():
    rows = normalize_fast_table_rows(
        [
            {
                "ionic_liquid": "1 wt% tributylmethylphosphonium dimethylphosphate (PP) in water-glycol",
                "friction_pair": "alumina ball / AISI 52100 steel disk",
                "conditions": (
                    "rotating ball-on-disk tribometer; normal load applied was 20 N; "
                    "disk rotation speed 40 rpm; track diameter 10 mm; "
                    "sliding speed of 2.09 cm/s; room temperature"
                ),
                "cof": "0.19",
                "source": "Testing and Characterization Methods",
                "evidence": (
                    "The normal load applied was 20 N, resulting in an initial "
                    "maximum Hertzian contact pressure of 1.96 GPa."
                ),
            }
        ]
    )

    assert rows[0]["load"] == "20 N"
    assert rows[0]["load_value"] == "20 N"


def test_fast_table_derives_speed_from_row_local_scan_conditions_only():
    rows = normalize_fast_table_rows(
        [
            {
                "离子液体 (IL)": "[BMIM][BF4]",
                "摩擦副 (对偶件 / 实验系统)": "石墨烯胶体探针/HOPG",
                "实验工况 (偏置电压等)": "AFM; scan range 500 nm × 500 nm; scan rate 2 Hz; -2 V",
                "摩擦系数 (μ)": "0.0065",
                "数据来源": "PDF+5",
            }
        ],
        page_context="Unrelated ToF-SIMS sputter rate was 0.29 nm/s.",
    )

    assert len(rows) == 1
    assert rows[0]["speed"] == "2 μm/s"
    assert rows[0]["speed_value"] == "2 μm/s"
    assert rows[0].get("speed_conditions") in (None, {})


def test_fast_table_db_rows_skip_pdf_coordinate_resolution(monkeypatch):
    def fail_coordinate_resolution(*_args, **_kwargs):
        raise AssertionError("fast table candidates should stay page-level until reviewed")

    def fail_field_location(*_args, **_kwargs):
        raise AssertionError("fast table candidates should not run field-level PDF matching")

    monkeypatch.setattr(file_service, "_resolve_existing_path", lambda path: path)
    monkeypatch.setattr(file_service, "_try_resolve_evidence_coords", fail_coordinate_resolution)
    monkeypatch.setattr(file_service, "_locate_field_evidence_for_value", fail_field_location)

    db_record, response_item = _build_db_record_from_item(
        literature_id=1,
        item={
            "ionic_liquid": "[BMIM][BF4]",
            "material_name": "石墨烯胶体探针/HOPG",
            "cof": "0.0087",
            "source": "PDF+5",
            "source_page": 5,
            "evidence": "IL: [BMIM][BF4] | 摩擦副: 石墨烯胶体探针/HOPG | μ: 0.0087",
            "record_origin": "fast_table_extraction",
            "review_status": "needs_review",
        },
        file_path="/tmp/paper.pdf",
        record_origin="llm_extraction",
        model_cls=RecordCandidate,
    )

    assert db_record.evidence_bbox is None
    assert response_item["review_status"] == "needs_review"


def test_fast_table_db_rows_keep_explicit_speed_unit():
    db_record, response_item = _build_db_record_from_item(
        literature_id=1,
        item={
            "ionic_liquid": "[BMIM][BF4]",
            "material_name": "单层石墨烯之间",
            "cof": "0.046",
            "potential": "+1 V",
            "speed": "1 m/s",
            "source": "PDF+5",
            "source_page": 5,
            "evidence": "sliding velocity 1 m/s; μ: 0.046",
            "record_origin": "fast_table_extraction",
            "review_status": "needs_review",
        },
        file_path=None,
        record_origin="llm_extraction",
        model_cls=RecordCandidate,
    )

    assert db_record.speed_value == "1 m/s"
    assert db_record.speed_conditions_json is None
    assert response_item["speed"] == "1 m/s"
