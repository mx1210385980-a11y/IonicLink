from routers.extraction import (
    _choose_pdf_figure_preview_candidate,
    _match_pdf_caption_start,
    _is_probable_pdf_caption_remainder,
    _merge_figure_preview_segments,
    _prefer_visual_figure_preview_clip,
    _trim_pdf_table_preview_clip_at_body_text,
)


def test_merge_figure_preview_segments_keeps_sparse_top_panel() -> None:
    segments = [
        (9, 69, 16808),
        (135, 272, 18211),
        (275, 295, 2925),
        (299, 416, 17568),
        (419, 431, 322),
        (445, 447, 29),
        (449, 451, 38),
        (462, 581, 23788),
        (583, 595, 1972),
        (603, 606, 48),
    ]

    assert _merge_figure_preview_segments(segments, scale=2.0) == (9, 606)


def test_merge_figure_preview_segments_stops_at_previous_caption_region() -> None:
    segments = [
        (10, 45, 1200),
        (190, 230, 1500),
        (238, 320, 2400),
    ]

    assert _merge_figure_preview_segments(segments, scale=2.0) == (190, 320)


def test_prefers_visual_clip_when_image_block_cuts_off_top_panel() -> None:
    image_clip = (298.09, 107.82, 558.62, 365.42)
    visual_clip = (295.0, 16.5, 572.0, 365.42)

    assert _prefer_visual_figure_preview_clip(image_clip, visual_clip)


def test_rejects_visual_clip_when_it_expands_to_whole_page() -> None:
    image_clip = (298.09, 107.82, 558.62, 365.42)
    visual_clip = (20.0, 0.0, 590.0, 760.0)

    assert not _prefer_visual_figure_preview_clip(image_clip, visual_clip)


def test_rejects_visual_clip_when_it_swallows_neighbor_table() -> None:
    image_clip = (36.09, 275.45, 554.64, 587.59)
    visual_clip = (32.0, 75.07, 563.0, 587.59)

    assert not _prefer_visual_figure_preview_clip(image_clip, visual_clip)


def test_candidate_scoring_prefers_local_crop_over_full_page_like_visual() -> None:
    page_clip = (0.0, 0.0, 600.0, 800.0)
    caption_clip = (80.0, 650.0, 520.0, 700.0)
    candidates = [
        {
            "strategy": "visual_segment",
            "clip": (18.0, 80.0, 585.0, 712.0),
        },
        {
            "strategy": "image_block",
            "clip": (126.0, 328.0, 492.0, 712.0),
        },
    ]
    body_text_clips = [
        (48.0, 112.0, 552.0, 150.0),
        (50.0, 170.0, 548.0, 210.0),
        (52.0, 248.0, 550.0, 292.0),
    ]
    other_caption_clips = [
        (70.0, 95.0, 535.0, 132.0),
    ]

    selected = _choose_pdf_figure_preview_candidate(
        page_clip,
        caption_clip,
        candidates,
        body_text_clips=body_text_clips,
        other_caption_clips=other_caption_clips,
    )

    assert selected["strategy"] == "image_block"
    assert "full_page_like" not in selected["flags"]
    assert "neighbor_caption_inside" not in selected["flags"]


def test_candidate_scoring_prefers_reasonable_visual_top_extension() -> None:
    page_clip = (0.0, 0.0, 600.0, 760.0)
    caption_clip = (308.0, 356.0, 570.0, 408.0)
    candidates = [
        {
            "strategy": "image_block",
            "clip": (298.09, 107.82, 558.62, 420.0),
        },
        {
            "strategy": "visual_segment",
            "clip": (295.0, 16.5, 572.0, 420.0),
        },
    ]

    selected = _choose_pdf_figure_preview_candidate(
        page_clip,
        caption_clip,
        candidates,
        body_text_clips=[],
        other_caption_clips=[],
    )

    assert selected["strategy"] == "visual_segment"


def test_candidate_scoring_keeps_visual_preferred_when_image_block_cuts_top() -> None:
    page_clip = (0.0, 0.0, 594.0, 792.0)
    caption_clip = (310.09, 333.43, 546.62, 353.42)
    candidates = [
        {
            "strategy": "image_block",
            "clip": (298.09, 107.82, 558.62, 365.42),
        },
        {
            "strategy": "visual_preferred",
            "clip": (295.0, 16.5, 572.0, 365.42),
        },
    ]
    body_text_clips = [
        (303.0, 41.0, 548.0, 53.0),
        (305.0, 66.0, 550.0, 84.0),
    ]

    selected = _choose_pdf_figure_preview_candidate(
        page_clip,
        caption_clip,
        candidates,
        body_text_clips=body_text_clips,
        other_caption_clips=[(48.09, 442.36, 284.62, 488.38)],
    )

    assert selected["strategy"] == "visual_preferred"


def test_trim_table_preview_stops_before_following_body_text() -> None:
    caption_clip = (51.48, 56.77, 530.46, 81.68)
    table_clip = (41.0, 48.77, 565.5, 353.68)
    body_text_clips = [
        (51.48, 300.89, 291.48, 438.11),
        (315.44, 290.51, 445.56, 322.51),
    ]

    trimmed = _trim_pdf_table_preview_clip_at_body_text(caption_clip, table_clip, body_text_clips)

    assert trimmed[3] == 282.51


def test_caption_filter_rejects_body_reference_sentence() -> None:
    assert not _is_probable_pdf_caption_remainder("shows friction as a function of normal load", has_separator=False)


def test_caption_filter_accepts_caption_like_remainder_without_period() -> None:
    assert _is_probable_pdf_caption_remainder("Force-distance profiles for a silica colloid probe", has_separator=False)


def test_caption_match_accepts_caption_line_from_merged_text_block() -> None:
    match = _match_pdf_caption_start("Figure 6. Friction force data vs applied load for the Si substrate")

    assert match is not None
    assert match["label"] == "Figure 6"
    assert match["caption"].startswith("Figure 6. Friction force")


def test_caption_match_rejects_body_reference_line() -> None:
    assert _match_pdf_caption_start("Figure 7a shows the variation in the friction coefficient") is None


def test_caption_match_rejects_parenthesized_reference_tail() -> None:
    assert _match_pdf_caption_start("Figure 2).") is None


def test_line_level_caption_match_rejects_body_table_reference() -> None:
    assert _match_pdf_caption_start(
        "Table II. The diffusion coefficients with index I, II, or III are summarized",
        line_level=True,
        has_nearby_visual=False,
    ) is None


def test_line_level_caption_match_accepts_merged_figure_caption_near_visual() -> None:
    match = _match_pdf_caption_start(
        "Figure 6. Friction force data vs applied load for the Si substrate",
        line_level=True,
        has_nearby_visual=True,
    )

    assert match is not None
    assert match["label"] == "Figure 6"
