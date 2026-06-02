from models.db_models import FigureCropOverride
from routers.extraction import _apply_figure_crop_overrides_to_items, _sort_pdf_figure_preview_items


def test_figure_crop_override_replaces_preview_and_keeps_algorithm_bbox() -> None:
    items = [
        {
            "id": "figure-6-page-7",
            "label": "Figure 6",
            "page": 7,
            "caption": "Figure 6 original caption",
            "image_b64": "auto-image",
            "clip_bbox": [10.0, 20.0, 210.0, 260.0],
        }
    ]
    override = FigureCropOverride(
        id=12,
        literature_id=109,
        label="Figure 6",
        page=7,
        caption="Figure 6 corrected caption",
        bbox_json="[12.5, 24.0, 220.0, 250.0]",
        algorithm_bbox_json="[10.0, 20.0, 210.0, 260.0]",
        preview_image_b64="manual-image",
        algorithm_version="pdf-visual-segmentation.v1",
        created_by_user_id=1,
    )

    merged = _apply_figure_crop_overrides_to_items(items, [override])

    assert merged[0]["image_b64"] == "manual-image"
    assert merged[0]["clip_bbox"] == [12.5, 24.0, 220.0, 250.0]
    assert merged[0]["algorithm_bbox"] == [10.0, 20.0, 210.0, 260.0]
    assert merged[0]["caption"] == "Figure 6 corrected caption"
    assert merged[0]["has_override"] is True
    assert merged[0]["override_id"] == 12


def test_figure_crop_override_ignores_other_labels() -> None:
    items = [
        {
            "id": "figure-6-page-7",
            "label": "Figure 6",
            "page": 7,
            "caption": "Figure 6",
            "image_b64": "auto-image",
            "clip_bbox": [10.0, 20.0, 210.0, 260.0],
        }
    ]
    override = FigureCropOverride(
        id=13,
        literature_id=109,
        label="Figure 5",
        page=7,
        bbox_json="[12.5, 24.0, 220.0, 250.0]",
        algorithm_bbox_json="[10.0, 20.0, 210.0, 260.0]",
        preview_image_b64="manual-image",
        algorithm_version="pdf-visual-segmentation.v1",
        created_by_user_id=1,
    )

    merged = _apply_figure_crop_overrides_to_items(items, [override])

    assert merged[0]["image_b64"] == "auto-image"
    assert merged[0]["has_override"] is False


def test_sort_pdf_figure_preview_items_uses_label_order_before_document_order() -> None:
    items = [
        {"label": "Figure 3", "page": 3, "id": "figure-3-page-3"},
        {"label": "Figure 2", "page": 3, "id": "figure-2-page-3"},
        {"label": "Table 1", "page": 2, "id": "table-1-page-2"},
        {"label": "Figure 10", "page": 8, "id": "figure-10-page-8"},
        {"label": "Figure 1", "page": 2, "id": "figure-1-page-2"},
    ]

    sorted_items = _sort_pdf_figure_preview_items(items)

    assert [item["label"] for item in sorted_items] == [
        "Figure 1",
        "Figure 2",
        "Figure 3",
        "Figure 10",
        "Table 1",
    ]
