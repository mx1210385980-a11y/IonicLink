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


def test_validation_substages_advance_within_their_band():
    # stage_d sub-stages should each nudge the bar forward (no longer flat at 78).
    post_model = compute_extraction_progress_percent("stage_d.post_model")
    page_counts = compute_extraction_progress_percent("stage_d.page_counts")
    il_filter = compute_extraction_progress_percent("stage_d.il_filter")
    validation = compute_extraction_progress_percent("stage_d.validation")
    assert post_model < page_counts < il_filter < validation
    assert 78 <= post_model and validation <= 90


def test_finalize_substages_advance_within_their_band():
    before = compute_extraction_progress_percent("stage_e.before_finalize")
    weak = compute_extraction_progress_percent("stage_e.weak_candidates")
    finalize = compute_extraction_progress_percent("stage_e.finalize")
    review = compute_extraction_progress_percent("stage_e.review_queue")
    assert before < weak < finalize < review
    assert review <= 99


def test_bare_stage_falls_back_to_band_floor():
    # A stage with no recognized sub-stage stays at the band floor.
    assert compute_extraction_progress_percent("stage_d") == 78
    assert compute_extraction_progress_percent("stage_e") == 90


def test_running_percent_never_reaches_100():
    full = compute_extraction_progress_percent(
        "stage_c.candidate_extraction",
        page_coverage={"total_pages": 4},
        page_candidate_counts={str(i): {} for i in range(99)},
    )
    assert full <= 99
