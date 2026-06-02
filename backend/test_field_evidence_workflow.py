from types import SimpleNamespace

import fitz

from services.file_service import (
    _annotate_review_record_with_canonical_match,
    _build_field_evidence_map,
    _extract_field_quote_from_bbox,
    _field_allows_global_context_fallback,
    _field_location_match_is_reliable,
    _field_query_variants,
    _repair_response_field_evidence_map,
    _review_canonical_match_score,
)
from routers.extraction import (
    _build_record_field_evidence_payload,
    _clamp_pdf_highlight_bbox,
    _parse_bbox_json,
    _sanitize_field_evidence_locations,
)
from utils.speed_conditions import derive_speed_conditions


def test_field_evidence_prefers_resolved_pdf_evidence_page_over_source_page():
    item = {
        "material_name": "Silicon",
        "ionic_liquid": "[HMIM][FAP]",
        "cof": "1.16",
        "source": "Fig. 1",
        "source_page": 9,
    }
    record = SimpleNamespace(
        source="Fig. 1",
        source_figure="Figure 1",
        source_page=9,
        evidence_page=10,
        evidence_bbox="[182.32, 64.0, 439.16, 312.44]",
        sample_id=None,
    )

    field_map = _build_field_evidence_map(item, record, confidence=0.9, file_path=None)

    assert field_map["cof"]["evidence"]["page"] == 10
    assert field_map["source_page"]["value"] == "Page 10"


def test_parse_bbox_accepts_query_string_coordinates():
    assert _parse_bbox_json("78.68,521.63,307.61,680.27") == [78.68, 521.63, 307.61, 680.27]
    assert _parse_bbox_json("[78.68, 521.63, 307.61, 680.27]") == [78.68, 521.63, 307.61, 680.27]


def test_load_evidence_preview_expands_small_highlight_bbox():
    page_rect = fitz.Rect(0, 0, 612, 792)

    bbox = _clamp_pdf_highlight_bbox(page_rect, [120, 300, 127, 306])

    assert bbox[0] < 120
    assert bbox[1] < 300
    assert bbox[2] > 127
    assert bbox[3] > 306
    assert bbox[2] - bbox[0] >= 12
    assert bbox[3] - bbox[1] >= 12


def test_record_field_evidence_payload_maps_normal_load_alias_to_load():
    record = SimpleNamespace(
        id=610,
        literature_id=120,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_raw="0.08",
        cof_value=0.08,
        cof_operator=None,
        load_raw="30 nN",
        load_value="30 nN",
        speed_value=None,
        speed_conditions_json=None,
        temperature="298 K",
        potential=None,
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material="Si3N4",
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material="Mica",
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=4,
        source_figure=None,
        evidence="Normal load was 30 nN during the AFM measurement.",
        evidence_page=4,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "normal_load": {
            "value": "30 nN",
            "confidence": 0.92,
            "evidence": {
              "source_type": "text",
              "page": 4,
              "source_label": "Methods",
              "quote": "Normal load was 30 nN during the AFM measurement.",
              "matched_text": "30 nN",
              "bbox": null
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.92,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    load = payload["fields"]["load"]
    assert load["value"] == "30 nN"
    assert load["evidence"]["quote"] == "Normal load was 30 nN during the AFM measurement."
    assert load["evidence"]["matched_text"] == "30 nN"
    assert load["status"] == "grounded"


def test_record_field_evidence_payload_maps_camel_load_alias_to_load():
    record = SimpleNamespace(
        id=611,
        literature_id=120,
        material_name="Mica",
        lubricant="[BMIM][BF4]",
        cof_raw="0.08",
        cof_value=0.08,
        cof_operator=None,
        load_raw="45 nN",
        load_value="45 nN",
        speed_value=None,
        speed_conditions_json=None,
        temperature="298 K",
        potential=None,
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material="Si3N4",
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material="Mica",
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=4,
        source_figure=None,
        evidence="The applied normal loadValue was 45 nN.",
        evidence_page=4,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "loadValue": {
            "value": "45 nN",
            "confidence": 0.91,
            "evidence": {
              "source_type": "text",
              "page": 4,
              "source_label": "Methods",
              "quote": "The applied normal loadValue was 45 nN.",
              "matched_text": "45 nN",
              "bbox": null
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.91,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    load = payload["fields"]["load"]
    assert load["value"] == "45 nN"
    assert load["evidence"]["quote"] == "The applied normal loadValue was 45 nN."
    assert load["evidence"]["matched_text"] == "45 nN"


def test_field_evidence_global_fallbacks_cover_metric_context_fields():
    assert _field_allows_global_context_fallback("cof", "1.16")
    assert _field_allows_global_context_fallback("speed", "6.5 μm/s")
    assert _field_allows_global_context_fallback("substrate_roughness", "RMS 0.89 nm")

    roughness_queries = _field_query_variants("substrate_roughness", "RMS 0.89 nm")
    assert "roughness RMS 0.89 nm" in roughness_queries


def test_derived_speed_conditions_keep_scan_context_as_raw_text():
    conditions = derive_speed_conditions(
        "6 μm/s",
        context="The scan size was 500 nm, and scan rate was 6 Hz.",
    )

    assert conditions["value_type"] == "derived"
    assert conditions["raw_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert conditions["calculation"] == "v = 2 x 0.5 μm x 6 Hz = 6 μm/s"


def test_response_field_evidence_relocates_bare_roughness_number_to_context(tmp_path):
    pdf_path = tmp_path / "roughness_context.pdf"
    doc = fitz.open()
    page = doc.new_page(width=1000, height=220)
    page.insert_text((40, 72), "The probe RMS roughness was smaller than 2 nm after cleaning.", fontsize=12)
    doc.save(pdf_path)
    doc.close()

    record = SimpleNamespace(
        speed_conditions_json=None,
        speed_value=None,
        evidence=None,
        source="Methods",
        source_figure=None,
        literature=SimpleNamespace(file_path=str(pdf_path)),
    )
    field_map = {
        "probe_roughness": {
            "value": "RMS 2 nm",
            "evidence": {
                "source_type": "text",
                "page": 1,
                "source_label": "Methods",
                "quote": "2",
                "matched_text": "2",
                "bbox": [206.0, 60.0, 212.0, 74.0],
            },
        },
    }

    repaired, _ = _repair_response_field_evidence_map(record, field_map)

    roughness = repaired["probe_roughness"]
    assert "RMS roughness" in roughness["evidence"]["quote"]
    assert roughness["evidence"]["matched_text"] == "2 nm"
    assert roughness["evidence"]["bbox"] is None
    assert "roughness/unit context" not in str(roughness.get("grounding_note") or "")


def test_derived_speed_evidence_locates_scan_conditions_and_explains_calculation(monkeypatch):
    located_values = []

    def fake_locate(**kwargs):
        if kwargs["field_key"] == "speed":
            located_values.append(kwargs["field_value"])
            return {
                "source_type": "text",
                "page": 3,
                "source_label": "Methods",
                "quote": "The scan size was 500 nm, and scan rate was 6 Hz.",
                "bbox": [100.0, 120.0, 104.0, 130.0],
                "matched_text": "scan size was 500 nm, and scan rate was 6 Hz",
            }
        return None

    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", fake_locate)
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)

    record = SimpleNamespace(
        source="Methods",
        source_figure=None,
        source_page=3,
        evidence_page=3,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.1",
        "speed": "6 μm/s",
        "speed_conditions": {
            "raw_text": "The scan size was 500 nm, and scan rate was 6 Hz.",
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
        },
        "source": "Methods",
        "source_page": 3,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    assert located_values == ["The scan size was 500 nm, and scan rate was 6 Hz."]
    assert field_map["speed"]["grounding_mode"] == "derived"
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in field_map["speed"]["grounding_note"]
    assert field_map["speed"]["evidence"]["matched_text"] == "scan size was 500 nm, and scan rate was 6 Hz"


def test_speed_evidence_derives_from_scan_conditions_in_source_quote(monkeypatch):
    located_values = []

    def fake_locate(**kwargs):
        if kwargs["field_key"] == "speed":
            located_values.append(kwargs["field_value"])
            return {
                "source_type": "text",
                "page": 3,
                "source_label": "Methods",
                "quote": "The scan size was 500 nm, and scan rate was 6 Hz.",
                "bbox": [100.0, 120.0, 240.0, 132.0],
                "matched_text": "The scan size was 500 nm, and scan rate was 6 Hz.",
            }
        return None

    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", fake_locate)
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)

    record = SimpleNamespace(
        source="Methods",
        source_figure=None,
        source_page=3,
        evidence_page=3,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.1",
        "speed": "6",
        "evidence": "The scan size was 500 nm, and scan rate was 6 Hz.",
        "source": "Methods",
        "source_page": 3,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    assert located_values == ["The scan size was 500 nm, and scan rate was 6 Hz."]
    assert field_map["speed"]["value"] == "6 μm/s"
    assert field_map["speed"]["grounding_mode"] == "derived"
    assert field_map["speed"]["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in field_map["speed"]["grounding_note"]


def test_field_evidence_map_uses_pdf_scan_context_when_source_row_is_table(monkeypatch):
    located_calls = []
    scan_text = "The scan size was 500 nm, and scan rate was 6 Hz."

    def fake_locate(**kwargs):
        if kwargs["field_key"] == "speed":
            located_calls.append(kwargs)
            return {
                "source_type": "text",
                "page": 3,
                "source_label": "Materials and methods",
                "quote": scan_text,
                "bbox": [100.0, 120.0, 240.0, 132.0],
                "matched_text": scan_text,
            }
        return None

    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)
    monkeypatch.setattr(
        "services.file_service._derive_speed_conditions_from_pdf_scan_context",
        lambda _path, _speed: {
            "raw_text": scan_text,
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
            "source_page": 3,
            "source_label": "Materials and methods",
        },
    )
    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", fake_locate)

    record = SimpleNamespace(
        source="Table 1",
        source_figure="Table 1",
        source_page=4,
        evidence_page=4,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.524",
        "speed": "6",
        "evidence": "Table 1 Friction coefficient of 1.6 M [BMIm][AOT] on Au(111).",
        "source": "Table 1",
        "source_page": 4,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    assert located_calls[0]["field_value"] == scan_text
    assert located_calls[0]["page_hint"] == 3
    assert located_calls[0]["source_label"] == "Materials and methods"
    assert field_map["speed"]["value"] == "6 μm/s"
    assert field_map["speed"]["grounding_mode"] == "derived"
    assert field_map["speed"]["evidence"]["matched_text"] == scan_text
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in field_map["speed"]["grounding_note"]


def test_roughness_evidence_rejects_single_number_match_without_unit_context():
    assert not _field_location_match_is_reliable(
        "substrate_roughness",
        "2 nm RMS",
        {
            "source_type": "text",
            "page": 3,
            "bbox": [10, 20, 14, 30],
            "matched_text": "2",
            "quote": "2",
        },
    )


def test_field_quote_expands_short_numeric_bbox_to_pdf_line_context(monkeypatch):
    class FakePage:
        def get_text(self, mode, clip=None):
            if mode == "words":
                return [
                    (20.0, 100.0, 42.0, 112.0, "The", 0, 0, 0),
                    (46.0, 100.0, 72.0, 112.0, "RMS", 0, 0, 1),
                    (76.0, 100.0, 126.0, 112.0, "roughness", 0, 0, 2),
                    (130.0, 100.0, 158.0, 112.0, "was", 0, 0, 3),
                    (162.0, 100.0, 208.0, 112.0, "smaller", 0, 0, 4),
                    (212.0, 100.0, 242.0, 112.0, "than", 0, 0, 5),
                    (246.0, 100.0, 252.0, 112.0, "2", 0, 0, 6),
                    (256.0, 100.0, 274.0, 112.0, "nm.", 0, 0, 7),
                ]
            return "2"

        rect = SimpleNamespace(width=500, height=700)

    class FakeDoc:
        def __getitem__(self, _index):
            return FakePage()

        def close(self):
            pass

    monkeypatch.setattr("services.file_service.os.path.exists", lambda _path: True)
    monkeypatch.setattr("services.file_service.fitz.open", lambda _path: FakeDoc())

    quote = _extract_field_quote_from_bbox("/tmp/fake.pdf", 3, [246.0, 100.0, 252.0, 112.0], fallback_term="2")

    assert quote == "The RMS roughness was smaller than 2 nm."


def test_record_field_evidence_payload_repairs_legacy_unstructured_scan_speed():
    record = SimpleNamespace(
        id=501,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value="6",
        speed_conditions_json=None,
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material=None,
        substrate_coating=None,
        substrate_roughness="0.2 nm",
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=3,
        source_figure=None,
        evidence="The scan size was 500 nm, and scan rate was 6 Hz.",
        evidence_page=3,
        evidence_bbox=None,
        field_evidence_json='{"speed":{"value":"6","evidence":{"quote":"The scan size was 500 nm, and scan rate was 6 Hz.","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    speed = payload["fields"]["speed"]
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert speed["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_record_field_evidence_payload_repairs_legacy_derived_speed_bare_raw_text(monkeypatch):
    def fake_pdf_scan_context(_pdf_path, _speed_value=None):
        return {
            "raw_text": "The scan size was 500 nm, and scan rate was 6 Hz.",
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
            "source_page": 3,
            "source_label": "Materials and methods",
        }

    monkeypatch.setattr("routers.extraction._derive_speed_conditions_from_pdf_scan_context", fake_pdf_scan_context)

    record = SimpleNamespace(
        id=505,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value="6",
        speed_conditions_json='{"raw_text":"6","value_type":"derived","scan_length_um":0.5,"scan_rate_hz":6,"sliding_velocity_um_s":6}',
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material=None,
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=3,
        source_figure=None,
        evidence=None,
        evidence_page=3,
        evidence_bbox=None,
        field_evidence_json='{"speed":{"value":"6","grounding_mode":"derived","evidence":{"source_type":"text","quote":"6","matched_text":"6","page":3,"bbox":[10,20,14,30]}}}',
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=SimpleNamespace(file_path="/tmp/fake.pdf"),
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    speed = payload["fields"]["speed"]
    assert speed["value"] == "6 μm/s"
    assert speed["evidence"]["quote"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["bbox"] is None
    assert speed["evidence"]["source_label"] == "Materials and methods"
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_record_field_evidence_payload_derives_speed_from_field_quote():
    record = SimpleNamespace(
        id=502,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value="6",
        speed_conditions_json=None,
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material=None,
        substrate_coating=None,
        substrate_roughness="0.2 nm",
        sample_id=None,
        series_id=None,
        source="Table 1",
        source_page=4,
        source_figure="Table 1",
        evidence="Table 1 Friction coefficient of 1.6 M [BMIm][AOT] on Au(111).",
        evidence_page=4,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "speed": {
            "value": "6",
            "grounding_mode": "source_anchor",
            "evidence": {
              "source_type": "visual",
              "page": 3,
              "source_label": "AFM methods",
              "quote": "Friction forces were obtained by AFM scans; the scan size was 500 nm, and scan rate was 6 Hz.",
              "matched_text": "scan rate was 6 Hz",
              "bbox": [306.6, 652.2, 560.0, 738.5]
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    speed = payload["fields"]["speed"]
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert speed["evidence"]["matched_text"] == "Friction forces were obtained by AFM scans; the scan size was 500 nm, and scan rate was 6 Hz."
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_record_field_evidence_payload_derives_speed_from_pdf_methods_when_table_evidence_is_wrong(monkeypatch):
    scan_text = "The scan size was 500 nm, and scan rate was 6 Hz."
    monkeypatch.setattr(
        "routers.extraction._derive_speed_conditions_from_pdf_scan_context",
        lambda _path, _speed: {
            "raw_text": scan_text,
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
            "source_page": 3,
            "source_label": "Materials and methods",
        },
    )
    record = SimpleNamespace(
        id=505,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value="6",
        speed_conditions_json=None,
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material="Au(111)",
        substrate_coating=None,
        substrate_roughness="0.2 nm",
        sample_id=None,
        series_id=None,
        source="Table 1",
        source_page=4,
        source_figure="Table 1",
        evidence="Table 1 Friction coefficient of 1.6 M [BMIm][AOT] on Au(111).",
        evidence_page=4,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "speed": {
            "value": "6",
            "evidence": {
              "source_type": "table",
              "page": 4,
              "source_label": "Table 1",
              "quote": "Table 1 Friction coefficient of 1.6 M [BMIm][AOT] on Au(111).",
              "matched_text": "6"
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=SimpleNamespace(file_path="/tmp/fake.pdf"),
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    speed = payload["fields"]["speed"]
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert speed["evidence"]["page"] == 3
    assert speed["evidence"]["source_type"] == "text"
    assert speed["evidence"]["source_label"] == "Materials and methods"
    assert speed["evidence"]["matched_text"] == scan_text
    assert speed["evidence"]["quote"] == scan_text
    assert speed["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_record_field_evidence_payload_clears_bare_roughness_number_quote():
    record = SimpleNamespace(
        id=503,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value=None,
        speed_conditions_json=None,
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness="RMS 2 nm",
        substrate_material=None,
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=3,
        source_figure=None,
        evidence=None,
        evidence_page=3,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "probe_roughness": {
            "value": "RMS 2 nm",
            "evidence": {
              "source_type": "text",
              "page": 3,
              "quote": "2",
              "matched_text": "2"
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    roughness = payload["fields"]["probe_roughness"]
    assert roughness["evidence"]["quote"] is None
    assert roughness["evidence"]["matched_text"] is None
    assert "roughness/unit context" in roughness["grounding_note"]


def test_record_field_evidence_payload_relocates_legacy_bare_roughness_quote(monkeypatch):
    located_calls = []

    def fake_locate(**kwargs):
        located_calls.append(kwargs)
        return {
            "source_type": "text",
            "page": 3,
            "source_label": "Methods",
            "quote": "The RMS roughness was smaller than 2 nm.",
            "matched_text": "2 nm",
            "bbox": [46.0, 100.0, 274.0, 112.0],
        }

    monkeypatch.setattr("routers.extraction._locate_field_evidence_for_value", fake_locate)

    record = SimpleNamespace(
        id=504,
        literature_id=86,
        material_name="Au(111)",
        lubricant="[BMIM][AOT]",
        cof_raw="0.524",
        cof_value=0.524,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value=None,
        speed_conditions_json=None,
        temperature="298 K",
        potential="OCP",
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material=None,
        probe_geometry=None,
        probe_radius=None,
        probe_roughness="RMS 2 nm",
        substrate_material=None,
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=3,
        source_figure=None,
        evidence=None,
        evidence_page=3,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "probe_roughness": {
            "value": "RMS 2 nm",
            "evidence": {
              "source_type": "text",
              "page": 3,
              "source_label": "Methods",
              "quote": "2",
              "matched_text": "2"
            }
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=SimpleNamespace(file_path="/tmp/fake.pdf"),
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    roughness = payload["fields"]["probe_roughness"]
    assert located_calls[0]["field_key"] == "probe_roughness"
    assert located_calls[0]["field_value"] == "RMS 2 nm"
    assert roughness["evidence"]["quote"] == "The RMS roughness was smaller than 2 nm."
    assert roughness["evidence"]["matched_text"] == "2 nm"
    assert roughness["evidence"]["bbox"] == [46.0, 100.0, 274.0, 112.0]


def test_record_field_evidence_keeps_probe_and_substrate_evidence_separate():
    record = SimpleNamespace(
        id=44,
        literature_id=8,
        material_name="Steel / Mica",
        lubricant="[EMIM][TFSI]",
        cof_raw="0.10",
        cof_value=0.10,
        cof_operator=None,
        load_raw=None,
        load_value=None,
        speed_value=None,
        speed_conditions_json=None,
        temperature=None,
        potential=None,
        water_content=None,
        surface_roughness=None,
        residual_film_thickness_d=None,
        layer_spacing_delta=None,
        film_thickness=None,
        probe_material="Steel",
        probe_geometry=None,
        probe_radius=None,
        probe_roughness=None,
        substrate_material="Mica",
        substrate_coating=None,
        substrate_roughness=None,
        sample_id=None,
        series_id=None,
        source="Methods",
        source_page=4,
        source_figure=None,
        evidence="A steel probe was slid against mica.",
        evidence_page=4,
        evidence_bbox=None,
        field_evidence_json="""
        {
          "probe_material": {
            "value": "Steel",
            "evidence": {"quote": "A steel probe", "matched_text": "steel probe", "page": 4}
          },
          "substrate_material": {
            "value": "Mica",
            "evidence": {"quote": "against mica", "matched_text": "mica", "page": 4}
          },
          "material": {
            "value": "Steel / Mica",
            "evidence": {"quote": "A steel probe was slid against mica.", "matched_text": "steel probe was slid against mica", "page": 4}
          }
        }
        """,
        review_status="pending_review",
        record_origin="published",
        assembly_notes=None,
        confidence=0.9,
        lubricant_components_json=None,
        literature=None,
        regime=None,
        shear_rate=None,
    )

    payload = _build_record_field_evidence_payload(record)

    assert payload["fields"]["probe_material"]["value"] == "Steel"
    assert payload["fields"]["probe_material"]["evidence"]["matched_text"] == "steel probe"
    assert payload["fields"]["substrate_material"]["value"] == "Mica"
    assert payload["fields"]["substrate_material"]["evidence"]["matched_text"] == "mica"


def test_sanitizer_preserves_derived_speed_scan_condition_bbox(monkeypatch):
    monkeypatch.setattr(
        "routers.extraction._extract_text_from_bbox",
        lambda _pdf_path, _page_num, _bbox: "The scan size was 500 nm, and scan rate was 6 Hz.",
    )

    field_map = {
        "speed": {
            "value": "6 μm/s",
            "grounding_mode": "derived",
            "grounding_note": "Derived sliding speed from scan size and scan rate: v = 2 x 0.5 μm x 6 Hz = 6 μm/s.",
            "evidence": {
                "source_type": "text",
                "page": 3,
                "quote": "The scan size was 500 nm, and scan rate was 6 Hz.",
                "matched_text": "scan size was 500 nm, and scan rate was 6 Hz",
                "bbox": [100.0, 120.0, 160.0, 132.0],
            },
        },
    }

    sanitized = _sanitize_field_evidence_locations(field_map, pdf_path="/tmp/fake.pdf")

    assert sanitized["speed"]["evidence"]["bbox"] == [100.0, 120.0, 160.0, 132.0]
    assert sanitized["speed"]["evidence"]["matched_text"] == "scan size was 500 nm, and scan rate was 6 Hz"


def test_sanitizer_clears_roughness_bbox_when_bbox_text_is_bare_number(monkeypatch):
    monkeypatch.setattr(
        "routers.extraction._extract_text_from_bbox",
        lambda _pdf_path, _page_num, _bbox: "2",
    )
    monkeypatch.setattr(
        "routers.extraction._extract_text_snippet",
        lambda _pdf_path, _page_num, _bbox, fallback_term=None, prefer_term_context=False: None,
    )

    field_map = {
        "substrate_roughness": {
            "value": "2 nm RMS",
            "evidence": {
                "source_type": "text",
                "page": 3,
                "quote": "2",
                "matched_text": "2",
                "bbox": [100.0, 120.0, 104.0, 132.0],
            },
        },
    }

    sanitized = _sanitize_field_evidence_locations(field_map, pdf_path="/tmp/fake.pdf")

    assert sanitized["substrate_roughness"]["evidence"]["bbox"] is None
    assert sanitized["substrate_roughness"]["evidence"]["matched_text"] is None
    assert "roughness/unit context" in sanitized["substrate_roughness"]["grounding_note"]


def test_sanitizer_expands_short_roughness_hit_to_local_context(monkeypatch):
    monkeypatch.setattr(
        "routers.extraction._extract_text_from_bbox",
        lambda _pdf_path, _page_num, _bbox: "2",
    )
    monkeypatch.setattr(
        "routers.extraction._extract_text_snippet",
        lambda _pdf_path, _page_num, _bbox, fallback_term=None, prefer_term_context=False: "The RMS roughness was smaller than 2 nm.",
    )

    field_map = {
        "substrate_roughness": {
            "value": "2 nm RMS",
            "evidence": {
                "source_type": "text",
                "page": 3,
                "matched_text": "2",
                "bbox": [100.0, 120.0, 104.0, 132.0],
            },
        },
    }

    sanitized = _sanitize_field_evidence_locations(field_map, pdf_path="/tmp/fake.pdf")

    assert sanitized["substrate_roughness"]["evidence"]["quote"] == "The RMS roughness was smaller than 2 nm."
    assert sanitized["substrate_roughness"]["evidence"]["matched_text"] == "2 nm"
    assert sanitized["substrate_roughness"]["evidence"]["bbox"] is None


def test_sanitizer_expands_short_roughness_hit_with_line_quote_fallback(monkeypatch):
    monkeypatch.setattr(
        "routers.extraction._extract_text_from_bbox",
        lambda _pdf_path, _page_num, _bbox: "2",
    )
    monkeypatch.setattr(
        "routers.extraction._extract_text_snippet",
        lambda _pdf_path, _page_num, _bbox, fallback_term=None, prefer_term_context=False: None,
    )
    monkeypatch.setattr(
        "routers.extraction._extract_field_quote_from_bbox",
        lambda _pdf_path, _page_num, _bbox, fallback_term=None: "The RMS roughness was smaller than 2 nm.",
        raising=False,
    )

    field_map = {
        "probe_roughness": {
            "value": "RMS 2 nm",
            "evidence": {
                "source_type": "text",
                "page": 3,
                "matched_text": "2",
                "bbox": [100.0, 120.0, 104.0, 132.0],
            },
        },
    }

    sanitized = _sanitize_field_evidence_locations(field_map, pdf_path="/tmp/fake.pdf")

    assert sanitized["probe_roughness"]["evidence"]["quote"] == "The RMS roughness was smaller than 2 nm."
    assert sanitized["probe_roughness"]["evidence"]["matched_text"] == "2 nm"
    assert sanitized["probe_roughness"]["evidence"]["bbox"] is None


def test_build_field_evidence_map_discards_bare_numeric_bbox_for_derived_speed(monkeypatch):
    def fake_locate(**kwargs):
        if kwargs["field_key"] == "speed":
            return {
                "source_type": "text",
                "page": 3,
                "source_label": "Methods",
                "quote": "The scan size was 500 nm, and scan rate was 6 Hz.",
                "bbox": [100.0, 120.0, 104.0, 132.0],
                "matched_text": "6",
            }
        return None

    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", fake_locate)
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)

    record = SimpleNamespace(
        source="Methods",
        source_figure=None,
        source_page=3,
        evidence_page=3,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.1",
        "speed": "6 μm/s",
        "speed_conditions": {
            "raw_text": "The scan size was 500 nm, and scan rate was 6 Hz.",
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
        },
        "source": "Methods",
        "source_page": 3,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    assert field_map["speed"]["evidence"]["bbox"] is None
    assert field_map["speed"]["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in field_map["speed"]["grounding_note"]


def test_build_field_evidence_map_clears_provided_bare_numeric_roughness_location(monkeypatch):
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)

    record = SimpleNamespace(
        source="Methods",
        source_figure=None,
        source_page=3,
        evidence_page=3,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.1",
        "probe_roughness": "RMS 2 nm",
        "field_evidence_json": {
            "probe_roughness": {
                "value": "RMS 2 nm",
                "evidence": {
                    "source_type": "text",
                    "page": 3,
                    "quote": "2",
                    "matched_text": "2",
                    "bbox": [100.0, 120.0, 104.0, 132.0],
                },
            },
        },
        "source": "Methods",
        "source_page": 3,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    roughness = field_map["probe_roughness"]
    assert roughness["evidence"]["bbox"] is None
    assert roughness["evidence"]["matched_text"] is None
    assert roughness["evidence"]["quote"] is None
    assert "roughness/unit context" in roughness["grounding_note"]


def test_roughness_query_variants_never_search_for_bare_numeric_value():
    queries = _field_query_variants("probe_roughness", "2")

    assert queries
    assert "2" not in queries
    assert all(query != "2" for query in queries)
    assert all("roughness" in query.lower() or "rms" in query.lower() for query in queries)


def test_derived_speed_overwrites_provided_short_numeric_evidence_with_context(monkeypatch):
    monkeypatch.setattr("services.file_service._resolve_existing_path", lambda path: path)
    monkeypatch.setattr("services.file_service._locate_field_evidence_for_value", lambda **kwargs: None)

    record = SimpleNamespace(
        source="Table 1",
        source_figure="Table 1",
        source_page=4,
        evidence_page=4,
        evidence_bbox=None,
        sample_id=None,
    )
    item = {
        "material_name": "Au(111)",
        "ionic_liquid": "[BMIM][AOT]",
        "cof": "0.524",
        "speed": "6",
        "speed_conditions": {
            "raw_text": "The scan size was 500 nm, and scan rate was 6 Hz.",
            "value_type": "derived",
            "scan_length_um": 0.5,
            "scan_rate_hz": 6,
            "sliding_velocity_um_s": 6,
            "calculation": "v = 2 x 0.5 μm x 6 Hz = 6 μm/s",
        },
        "field_evidence_json": {
            "speed": {
                "value": "6",
                "evidence": {
                    "source_type": "text",
                    "page": 4,
                    "quote": "6",
                    "matched_text": "6",
                    "bbox": [100.0, 120.0, 104.0, 132.0],
                },
            },
        },
        "source": "Table 1",
        "source_page": 4,
    }

    field_map = _build_field_evidence_map(item, record, confidence=0.91, file_path="/tmp/fake.pdf")

    speed = field_map["speed"]
    assert speed["value"] == "6 μm/s"
    assert speed["grounding_mode"] == "derived"
    assert speed["evidence"]["quote"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["matched_text"] == "The scan size was 500 nm, and scan rate was 6 Hz."
    assert speed["evidence"]["bbox"] is None
    assert "v = 2 x 0.5 μm x 6 Hz = 6 μm/s" in speed["grounding_note"]


def test_review_secondary_match_links_to_canonical_source_metadata():
    review_item = {
        "material_name": "Mica",
        "ionic_liquid": "[EMIM][EtSO4]",
        "probe_material": "Mica",
        "substrate_material": "Mica",
        "cof": "0.009 ± 0.002",
        "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
        "field_evidence_json": {
            "cof": {
                "value": "0.009 ± 0.002",
                "evidence": {"source_label": "Fig. 15d"},
            },
        },
    }
    canonical = {
        "entity_type": "candidate",
        "record_id": 141,
        "literature_id": 61,
        "title": "Layering and shear properties of an ionic liquid, 1-ethyl-3-methylimidazolium ethylsulfate, confined to nano-films between mica surfaces",
        "doi": "10.1039/b920571c",
        "lubricant": "[EMIM][EtSO4]",
        "probe_material": "Mica",
        "substrate_material": "Mica",
        "cof": "0.009 ± 0.002",
        "regime": "n = 3 layers (D = 1.08 ± 0.15 nm)",
    }

    score, fields = _review_canonical_match_score(review_item, canonical)
    _annotate_review_record_with_canonical_match(review_item, canonical, score, fields)

    assert score >= 0.78
    assert review_item["record_origin"] == "review_secondary"
    assert "canonical literature #61" in review_item["assembly_notes"]
    canonical_source = review_item["field_evidence_json"]["_canonical_source"]
    assert canonical_source["grounding_mode"] == "secondary_source"
    assert canonical_source["canonical"]["canonical_record"]["record_id"] == 141
    assert review_item["field_evidence_json"]["cof"]["canonical"]["kind"] == "review_secondary_source"
