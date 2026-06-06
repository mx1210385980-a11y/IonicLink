"""Tests for clean_and_parse_json — the payload extractor used by every LLM extractor.

Focus: cases where the model *did* return data but the old parser returned None
(braces inside strings, truncated output, trailing commas).
"""
from __future__ import annotations

from services.llm.utils import clean_and_parse_json


def test_parses_plain_object_and_array():
    assert clean_and_parse_json('{"data": [{"cof": "0.1"}]}') == {"data": [{"cof": "0.1"}]}
    assert clean_and_parse_json('[{"cof": "0.1"}, {"cof": "0.2"}]') == [
        {"cof": "0.1"},
        {"cof": "0.2"},
    ]


def test_strips_code_fence():
    text = '```json\n{"data": [{"cof": "0.1"}]}\n```'
    assert clean_and_parse_json(text) == {"data": [{"cof": "0.1"}]}


def test_ignores_prose_around_json():
    text = 'Sure! Here is the extraction:\n{"data": [{"cof": "0.1"}]}\nLet me know if you need more.'
    assert clean_and_parse_json(text) == {"data": [{"cof": "0.1"}]}


def test_tolerates_trailing_commas():
    text = '{"data": [{"cof": "0.1",}, {"cof": "0.2"},],}'
    assert clean_and_parse_json(text) == {"data": [{"cof": "0.1"}, {"cof": "0.2"}]}


def test_unbalanced_brace_inside_string_does_not_truncate_payload():
    # An evidence quote containing a lone '}' used to make the brace counter
    # close the object early and the whole parse fail.
    text = '{"evidence": "COF rises then } drops", "cof": "0.14"}'
    assert clean_and_parse_json(text) == {"evidence": "COF rises then } drops", "cof": "0.14"}


def test_bracket_inside_string_does_not_break_array_scan():
    text = '[{"note": "see Fig. 3 [panel a]", "cof": "0.1"}]'
    assert clean_and_parse_json(text) == [{"note": "see Fig. 3 [panel a]", "cof": "0.1"}]


def test_recovers_complete_rows_from_truncated_array():
    # Model hit max_tokens mid-way through the third row. The old parser returned
    # None (balance never reached 0); now we keep the two complete rows.
    text = '{"reasoning": "x", "data": [{"cof": "0.1"}, {"cof": "0.2"}, {"cof": "0.3'
    result = clean_and_parse_json(text)
    assert result == {"reasoning": "x", "data": [{"cof": "0.1"}, {"cof": "0.2"}]}


def test_recovers_when_truncated_inside_a_string_value():
    text = '{"data": [{"cof": "0.1"}, {"evidence": "the friction coefficient was meas'
    result = clean_and_parse_json(text)
    assert result == {"data": [{"cof": "0.1"}]}


def test_closes_object_truncated_after_complete_value():
    # Cut right after a complete value (no partial row to drop) — close the object.
    text = '{"reasoning": "done", "count": 2'
    assert clean_and_parse_json(text) == {"reasoning": "done", "count": 2}


def test_bare_truncated_array_recovers_complete_elements():
    text = '[{"cof": "0.1"}, {"cof": "0.2"}, {"cof":'
    assert clean_and_parse_json(text) == [{"cof": "0.1"}, {"cof": "0.2"}]


def test_returns_none_for_non_json():
    assert clean_and_parse_json("no json here at all") is None
    assert clean_and_parse_json("") is None


def test_returns_none_when_nothing_complete_to_recover():
    # Truncated before any element closed and ending on a dangling key.
    assert clean_and_parse_json('{"data": [{"cof":') is None
