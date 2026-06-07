from services.extraction_trace_service import compute_extraction_progress_percent


def test_unknown_stage_returns_small_floor():
    assert compute_extraction_progress_percent(None) == 3
    assert compute_extraction_progress_percent("") == 3


def test_stage_bands_are_monotonic_across_pipeline():
    a = compute_extraction_progress_percent("stage_a.queued")
    b = compute_extraction_progress_percent("stage_b.pdf_scan")
    c = compute_extraction_progress_percent("stage_c.candidate_extraction")
    d = compute_extraction_progress_percent("stage_d.validation")
    e = compute_extraction_progress_percent("stage_e.finalize")
    assert a < b < c < d < e
    assert 1 <= a and e <= 99


def test_stage_c_interpolates_by_page_coverage():
    # 5 of 10 pages processed → midpoint of the 30–78 extraction band.
    mid = compute_extraction_progress_percent(
        "stage_c.candidate_extraction",
        page_coverage={"total_pages": 10},
        page_candidate_counts={str(i): {} for i in range(5)},
    )
    assert mid == 54
    # No page data → band floor, never above 99.
    floor = compute_extraction_progress_percent(
        "stage_c.candidate_extraction", page_coverage={"total_pages": 0}
    )
    assert floor == 30


def test_running_percent_never_reaches_100():
    full = compute_extraction_progress_percent(
        "stage_c.candidate_extraction",
        page_coverage={"total_pages": 4},
        page_candidate_counts={str(i): {} for i in range(99)},
    )
    assert full <= 99
