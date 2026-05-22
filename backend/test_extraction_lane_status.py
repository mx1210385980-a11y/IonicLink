from routers.extraction import (
    ManualDiffusionCandidatePayload,
    _build_manual_diffusion_candidate_field_map,
    _no_data_message_for_run,
    _should_wait_for_fresh_extractor_run,
)


def test_terminal_requested_extractor_run_is_not_masked_by_shared_literature_status():
    for run_status in ("no_data", "completed", "success", "failed", "error", "cancelled"):
        assert _should_wait_for_fresh_extractor_run("extracting", run_status) is False


def test_missing_requested_extractor_run_can_show_processing_hint_from_shared_literature_status():
    assert _should_wait_for_fresh_extractor_run("extracting", "") is True
    assert _should_wait_for_fresh_extractor_run("completed", "") is False


def test_no_data_message_prefers_requested_extractor_run_over_shared_literature_error():
    message = _no_data_message_for_run(
        literature_message="摩擦通道没有结构化数据",
        run_message="扩散通道没有明确数值和单位",
        summary={"current_message": "扩散 summary"},
    )

    assert message == "扩散通道没有明确数值和单位"


def test_manual_diffusion_candidate_field_map_marks_graph_estimates_as_figure_evidence():
    payload = ManualDiffusionCandidatePayload(
        systemName="[BuPy][NTf2] in graphene slit",
        ionicLiquid="[BuPy][NTf2]",
        diffusingIon="cation",
        dCation=1.2,
        dUnit="10^-10 m2/s",
        sourcePage=6,
        sourceFigure="Fig. 10",
        evidence="Estimated from cation curve at d = 4 nm.",
    )

    field_map = _build_manual_diffusion_candidate_field_map(payload)

    assert field_map["d_cation"]["value"] == 1.2
    assert field_map["d_cation"]["evidence"]["source_type"] == "figure"
    assert field_map["d_cation"]["evidence"]["source_label"] == "Fig. 10"
    assert field_map["d_unit"]["value"] == "10^-10 m2/s"
    assert field_map["diffusing_ion"]["value"] == "cation"
