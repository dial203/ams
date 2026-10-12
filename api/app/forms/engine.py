"""Form evaluation and validation, implemented literally from docs/FORMS.md "Form evaluation"."""

from __future__ import annotations

import datetime as dt
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from app.forms.expr import (
    EvalError,
    Node,
    ParseError,
    identifiers,
    is_finite_number,
    parse,
    round_half_away,
    values_equal,
)
from app.forms.expr import evaluate as eval_expr
from app.forms.schema import FieldInfo, SchemaIndex, index_schema

DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(\d{2}):(\d{2})$")


@dataclass
class Evaluation:
    visible: dict[str, bool]
    computed: dict[str, Any]
    values: dict[str, Any]
    hidden: set[str] = field(default_factory=set)


@dataclass
class Validation:
    ok: bool
    errors: dict[str, str]
    values: dict[str, Any]
    computed: dict[str, Any]
    visible: dict[str, bool]
    hidden: set[str]


@lru_cache(maxsize=4096)
def _parse_cached(text: str) -> Node | None:
    try:
        return parse(text)
    except ParseError:
        return None


def _eval_or_error(text: str | None, env: dict[str, Any]) -> tuple[bool, Any]:
    """Returns (ok, value). Parse or evaluation error -> (False, None)."""
    if not isinstance(text, str):
        return False, None
    node = _parse_cached(text)
    if node is None:
        return False, None
    try:
        return True, eval_expr(node, env)
    except EvalError:
        return False, None


def round_decimals(x: Any, d: Any) -> Any:
    if d is None or not is_finite_number(x) or isinstance(d, bool) or not isinstance(d, (int, float)):
        return x
    return round_half_away(float(x), int(d))


def _calc_order(idx: SchemaIndex) -> list[FieldInfo]:
    """Topological order of calculated fields by references; ties broken by schema order."""
    calcs = idx.calculated_fields
    calc_keys = {c.key for c in calcs}
    deps: dict[str, set[str]] = {}
    for c in calcs:
        node = _parse_cached(c.spec.get("expression")) if isinstance(c.spec.get("expression"), str) else None
        refs = identifiers(node) if node is not None else set()
        deps[c.key] = {r for r in refs if r in calc_keys and r != c.key}
    done: set[str] = set()
    order: list[FieldInfo] = []
    remaining = list(calcs)
    while remaining:
        for c in remaining:
            if deps[c.key] <= done:
                order.append(c)
                done.add(c.key)
                remaining.remove(c)
                break
        else:  # cycle: append the rest in schema order (their references will be unknown -> null)
            order.extend(remaining)
            break
    return order


def _clean_input(value: Any) -> Any:
    if value == "" or (isinstance(value, list) and not value):
        return None
    return value


def evaluate(schema: dict[str, Any], values: dict[str, Any]) -> Evaluation:
    idx = index_schema(schema)
    inputs = idx.input_fields
    values = values or {}
    input_values = {f.key: _clean_input(values.get(f.key)) for f in inputs}
    calc_order = _calc_order(idx)
    sections = schema.get("sections", []) if isinstance(schema, dict) else []

    hidden: set[str] = set()
    env: dict[str, Any] = {}
    for _ in range(len(idx.fields) + 1):
        env = {}
        for f in inputs:
            env[f.key] = None if f.key in hidden else input_values[f.key]
        for c in calc_order:
            if c.key in hidden:
                env[c.key] = None
                continue
            _ok, result = _eval_or_error(c.spec.get("expression"), env)
            env[c.key] = round_decimals(result, c.spec.get("decimals"))
        new_hidden: set[str] = set()
        section_hidden: dict[int, bool] = {}
        for si, section in enumerate(sections):
            if isinstance(section, dict) and section.get("visible_if") is not None:
                ok, result = _eval_or_error(section.get("visible_if"), env)
                section_hidden[si] = not (ok and result is True)
            else:
                section_hidden[si] = False
        for f in idx.fields:
            if section_hidden.get(f.section_index, False):
                new_hidden.add(f.key)
                continue
            if f.spec.get("visible_if") is not None:
                ok, result = _eval_or_error(f.spec.get("visible_if"), env)
                if not (ok and result is True):
                    new_hidden.add(f.key)
        if new_hidden == hidden:
            break
        hidden = new_hidden

    visible = {f.key: f.key not in hidden for f in idx.fields}
    computed = {c.key: _to_json_number(env.get(c.key)) for c in idx.calculated_fields}
    out_values = {f.key: input_values[f.key] for f in inputs if f.key not in hidden and input_values[f.key] is not None}
    return Evaluation(visible=visible, computed=computed, values=out_values, hidden=hidden)


def _to_json_number(v: Any) -> Any:
    """Integral doubles are emitted as ints so JSON reads naturally (14, not 14.0)."""
    if isinstance(v, float) and math.isfinite(v) and v.is_integer() and abs(v) < 2**53:
        return int(v)
    if isinstance(v, list):
        return [_to_json_number(x) for x in v]
    return v


def _is_real_date(text: str) -> bool:
    if not DATE_RE.match(text):
        return False
    try:
        dt.date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _is_valid_time(text: str) -> bool:
    m = TIME_RE.match(text)
    return bool(m) and int(m.group(1)) <= 23 and int(m.group(2)) <= 59


def _is_valid_datetime(text: str) -> bool:
    if not DATETIME_RE.match(text):
        return False
    date_part, rest = text[:10], text[11:]
    if not _is_real_date(date_part):
        return False
    hh, mm = int(rest[0:2]), int(rest[3:5])
    if hh > 23 or mm > 59:
        return False
    if len(rest) > 5 and rest[5] == ":" and int(rest[6:8]) > 59:
        return False
    tz = text[-6:] if not text.endswith("Z") else None
    return not (tz is not None and (int(tz[1:3]) > 23 or int(tz[4:6]) > 59))


def _option_values(spec: dict[str, Any]) -> list[Any]:
    opts = spec.get("options")
    if not isinstance(opts, list):
        return []
    return [o.get("value") for o in opts if isinstance(o, dict)]


def _in_options(value: Any, options: list[Any]) -> bool:
    return any(values_equal(_norm(value), _norm(o)) for o in options)


def _norm(v: Any) -> Any:
    if is_finite_number(v):
        return float(v)
    return v


def _check_field(f: FieldInfo, value: Any) -> str | None:
    spec = f.spec
    t = f.type
    required = spec.get("required") is True
    if value is None:
        return "required" if required else None
    # 2. type
    if t in ("number", "scale", "duration"):
        if not is_finite_number(value):  # NaN / Infinity are not JSON numbers
            return "invalid_type"
    elif t == "select":
        if not (isinstance(value, str) or is_finite_number(value)):
            return "invalid_type"
    elif t == "multiselect":
        if not isinstance(value, list):
            return "invalid_type"
    elif t == "boolean":
        if not isinstance(value, bool):
            return "invalid_type"
    elif t in ("text", "textarea", "date", "time", "datetime") and not isinstance(value, str):
        return "invalid_type"
    # 3. format
    if (
        (t == "date" and not _is_real_date(value))
        or (t == "time" and not _is_valid_time(value))
        or (t == "datetime" and not _is_valid_datetime(value))
    ):
        return "invalid_format"
    # 4. options
    if t == "select" and not _in_options(value, _option_values(spec)):
        return "invalid_option"
    if t == "multiselect":
        options = _option_values(spec)
        if any(not _in_options(v, options) for v in value):
            return "invalid_option"
        for i, a in enumerate(value):
            if any(values_equal(_norm(a), _norm(b)) for b in value[i + 1 :]):
                return "invalid_option"
    # 5. scale grid
    if t == "scale":
        mn = spec.get("min")
        raw_step = spec.get("step")
        step = raw_step if is_finite_number(raw_step) and raw_step > 0 else 1
        if is_finite_number(mn):
            q = (float(value) - float(mn)) / float(step)
            if abs(q - round(q)) > 1e-9:
                return "invalid_step"
    # 6. range
    if t in ("number", "scale", "duration"):
        mn, mx = spec.get("min"), spec.get("max")
        if (is_finite_number(mn) and value < mn) or (is_finite_number(mx) and value > mx):
            return "out_of_range"
    if t == "date":
        mn, mx = spec.get("min"), spec.get("max")
        if (isinstance(mn, str) and value < mn) or (isinstance(mx, str) and value > mx):
            return "out_of_range"
    if t == "multiselect":
        mn, mx = spec.get("min_selected"), spec.get("max_selected")
        if (is_finite_number(mn) and len(value) < mn) or (is_finite_number(mx) and len(value) > mx):
            return "out_of_range"
    # 7. length
    if t in ("text", "textarea"):
        default = 500 if t == "text" else 5000
        max_length = spec.get("max_length") if is_finite_number(spec.get("max_length")) else default
        if len(value) > max_length:
            return "too_long"
    return None


def validate(schema: dict[str, Any], values: dict[str, Any] | None) -> Validation:
    raw = values or {}
    ev = evaluate(schema, raw)
    idx = index_schema(schema)
    errors: dict[str, str] = {}
    for key in raw:
        f = idx.by_key.get(key)
        if f is None or f.type == "info":
            errors[key] = "unknown_field"
    for f in idx.input_fields:
        if f.key in ev.hidden:
            continue
        code = _check_field(f, _clean_input(raw.get(f.key)))
        if code:
            errors[f.key] = code
    return Validation(
        ok=not errors,
        errors=errors,
        values=ev.values,
        computed=ev.computed,
        visible=ev.visible,
        hidden=ev.hidden,
    )
