from routers.extraction import _no_data_message_for_run, _should_wait_for_fresh_extractor_run


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
