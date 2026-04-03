from __future__ import annotations

from utils.cof_guard import (
    cof_search_context_is_compatible,
    cof_value_supported_in_text,
    unsupported_figure_cof_reason,
)


def test_cof_value_supported_in_text_matches_close_numeric_value() -> None:
    assert cof_value_supported_in_text("0.120", "The friction coefficient (COF) was 0.121 at steady state.")


def test_unsupported_figure_cof_reason_rejects_ambiguous_legends_without_numeric_support() -> None:
    record = {
        "source": "Figure 2",
        "source_figure": "Fig. 2a",
        "cof": "0.12",
        "evidence": "Dry / 1.0 V / OCP",
        "notes": "",
    }

    assert unsupported_figure_cof_reason(record) == "figure_legend_without_numeric_support"


def test_unsupported_figure_cof_reason_accepts_supported_metric_context() -> None:
    record = {
        "source": "Figure 3",
        "source_figure": "Fig. 3b",
        "cof": "0.12",
        "evidence": "COF = 0.12 at 1.0 V after 20 cycles.",
        "notes": "",
    }

    assert unsupported_figure_cof_reason(record) is None


def test_cof_search_context_is_compatible_flags_non_cof_context() -> None:
    assert not cof_search_context_is_compatible("Residual film thickness was 12 nm across the scan.")
    assert cof_search_context_is_compatible("Friction coefficient remained near 0.08 during the test.")
