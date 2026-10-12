"""Conformance against spec/*.json (shared with the TypeScript engine)."""

import json
import math
from pathlib import Path
from typing import Any

import pytest

from app.forms.engine import validate
from app.forms.expr import EvalError, ParseError, evaluate, parse
from app.forms.schema import validate_schema

SPEC_DIR = Path(__file__).resolve().parents[2] / "spec"


def _load(name: str) -> dict[str, Any]:
    return json.loads((SPEC_DIR / name).read_text())


EXPR = _load("expr-cases.json")
FORMS = _load("form-cases.json")
SCHEMAS = _load("schema-cases.json")


def _close(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b:
            return True
        return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=0.0)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    return a == b and type(a) is type(b)


@pytest.mark.parametrize("case", EXPR["cases"], ids=[c["expr"] for c in EXPR["cases"]])
def test_expression_case(case: dict[str, Any]) -> None:
    if case.get("parse_error"):
        with pytest.raises(ParseError):
            parse(case["expr"])
        return
    node = parse(case["expr"])
    if case.get("error"):
        with pytest.raises(EvalError):
            evaluate(node, case.get("vars", {}))
        return
    result = evaluate(node, case.get("vars", {}))
    assert _close(result, case["result"]), f"{case['expr']!r}: got {result!r}, expected {case['result']!r}"


@pytest.mark.parametrize("case", FORMS["cases"], ids=[c["name"] for c in FORMS["cases"]])
def test_form_case(case: dict[str, Any]) -> None:
    schema = FORMS["schemas"][case["schema"]]
    assert validate_schema(schema) == [], "spec schemas must themselves be valid"
    result = validate(schema, case["values"])
    expected = case["expected"]
    assert result.ok is expected["ok"]
    assert result.errors == expected["errors"]
    assert _close(result.values, expected["values"]), result.values
    assert _close(result.computed, expected["computed"]), result.computed
    assert result.hidden == set(expected["hidden"])


@pytest.mark.parametrize("case", SCHEMAS["cases"], ids=[c["name"] for c in SCHEMAS["cases"]])
def test_schema_case(case: dict[str, Any]) -> None:
    paths = sorted({e.path for e in validate_schema(case["schema"])})
    assert paths == sorted(case["error_paths"])
