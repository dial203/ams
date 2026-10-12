"""Behaviour pinned to match the TypeScript engine in @ams/shared (beyond spec/*.json)."""

from __future__ import annotations

import math
from typing import Any

import pytest

from app.forms.engine import evaluate, validate
from app.forms.expr import evaluate_text
from app.forms.schema import validate_schema


def schema_with(*fields: dict[str, Any], section: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"schema_version": 1, "sections": [{"key": "s", "title": "S", "fields": list(fields), **(section or {})}]}


def paths(schema: Any) -> set[str]:
    return {e.path for e in validate_schema(schema)}


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        ({"key": "a", "type": "number", "label": "A", "step": 0}, {"sections/0/fields/0/step"}),
        ({"key": "a", "type": "number", "label": "A", "decimals": 1.5}, {"sections/0/fields/0/decimals"}),
        ({"key": "a", "type": "number", "label": "A", "decimals": 11}, {"sections/0/fields/0/decimals"}),
        ({"key": "a", "type": "number", "label": "A", "min": 5, "max": 1}, {"sections/0/fields/0/max"}),
        ({"key": "a", "type": "number", "label": "A", "min": None}, {"sections/0/fields/0/min"}),
        ({"key": "a", "type": "duration", "label": "A", "min": 10, "max": 1}, {"sections/0/fields/0/max"}),
        ({"key": "a", "type": "text", "label": "A", "max_length": 0}, {"sections/0/fields/0/max_length"}),
        ({"key": "a", "type": "date", "label": "A", "min": "2024-02-30"}, {"sections/0/fields/0/min"}),
        ({"key": "a", "type": "date", "label": "A", "min": "2025-01-01", "max": "2024-01-01"},
         {"sections/0/fields/0/max"}),
        ({"key": "a", "type": "multiselect", "label": "A", "options": [{"value": "x", "label": "X"}],
          "min_selected": 1.5}, {"sections/0/fields/0/min_selected"}),
        ({"key": "a", "type": "multiselect", "label": "A", "options": [{"value": "x", "label": "X"}],
          "min_selected": 3, "max_selected": 2}, {"sections/0/fields/0/max_selected"}),
        ({"key": "a", "type": "scale", "label": "A", "max": 5}, {"sections/0/fields/0/min"}),
        ({"key": "a", "type": "scale", "label": "A", "min": 1, "max": 5, "display": "dial"},
         {"sections/0/fields/0/display"}),
        ({"key": "a", "type": "scale", "label": "A", "min": 1, "max": 5, "anchors": {"min": 1}},
         {"sections/0/fields/0/anchors"}),
        ({"key": "a", "type": "number", "label": ""}, set()),
        ({"key": "a", "type": "number", "label": 3}, {"sections/0/fields/0/label"}),
        ({"key": "a", "type": "number", "label": "A", "visible_if": ""}, {"sections/0/fields/0/visible_if"}),
        ({"key": "c", "type": "calculated", "label": "C", "expression": "sum + 1"},
         {"sections/0/fields/0/expression"}),
    ],
)
def test_schema_validation_matches_ts(field: dict[str, Any], expected: set[str]) -> None:
    assert paths(schema_with(field)) == expected


def test_structural_paths_and_reserved_section_keys() -> None:
    assert paths([]) == {""}
    assert paths({"schema_version": 1, "sections": {}}) == {"sections"}
    assert paths({"schema_version": 1, "sections": ["x"]}) == {"sections/0"}
    assert paths({"schema_version": 1, "sections": [{"key": "s", "title": "S", "fields": [1]}]}) == {
        "sections/0/fields/0"
    }
    # reserved words are allowed for section keys
    assert paths({"schema_version": 1, "sections": [{"key": "sum", "title": "", "fields": [
        {"key": "a", "type": "number", "label": "A"}]}]}) == set()


def test_bad_reference_still_joins_cycle_detection() -> None:
    schema = schema_with(
        {"key": "x", "type": "calculated", "label": "X", "expression": "y + missing"},
        {"key": "y", "type": "calculated", "label": "Y", "expression": "x * 2"},
    )
    assert paths(schema) == {"sections/0/fields/0/expression", "sections/0/fields/1/expression"}


def test_nan_and_infinity_are_invalid_type() -> None:
    schema = schema_with({"key": "a", "type": "number", "label": "A"}, {"key": "b", "type": "scale", "label": "B",
                                                                        "min": 1, "max": 5})
    result = validate(schema, {"a": math.nan, "b": math.inf})
    assert result.errors == {"a": "invalid_type", "b": "invalid_type"}


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("0000-01-01", False),
        ("0001-01-01", True),
    ],
)
def test_date_year_at_least_one(value: str, ok: bool) -> None:
    schema = schema_with({"key": "d", "type": "date", "label": "D"})
    assert validate(schema, {"d": value}).ok is ok


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("2026-10-12T06:31:59Z", True),
        ("2026-10-12T06:31:60Z", False),
        ("2026-10-12T06:31:00+23:59", True),
        ("2026-10-12T06:31:00+24:00", False),
        ("2026-10-12T06:31:00-05:60", False),
        ("2026-10-12T06:31:00.123456789+02:00", True),
    ],
)
def test_datetime_bounds(value: str, ok: bool) -> None:
    schema = schema_with({"key": "t", "type": "datetime", "label": "T"})
    assert validate(schema, {"t": value}).ok is ok


def test_unsettled_visibility_uses_last_pass() -> None:
    # a <-> b toggle each other's visibility through calculations: never settles
    schema = schema_with(
        {"key": "flag", "type": "boolean", "label": "F"},
        {"key": "a", "type": "calculated", "label": "A", "expression": "1", "visible_if": "isnull(b)"},
        {"key": "b", "type": "calculated", "label": "B", "expression": "2", "visible_if": "not isnull(a)"},
    )
    ev = evaluate(schema, {"flag": True})
    assert set(ev.visible) == {"flag", "a", "b"}
    # whatever the final state, computed values of hidden fields are those of the last calculation pass
    assert ev.values == {"flag": True}


@pytest.mark.parametrize(
    ("expr", "result"),
    [
        ("null + 'a'", None),
        ("round(null, 'x')", None),
        ("clamp(15, null, 10)", 10),
        ("ceil(-0.5)", 0),
        ("sum(0.1, 0.2)", 0.30000000000000004),
        ("len('héllo')", 5),
    ],
)
def test_pinned_expression_rules(expr: str, result: Any) -> None:
    value = evaluate_text(expr)
    assert value == result
    if result == 0:
        assert math.copysign(1.0, value) == 1.0  # -0 normalised
