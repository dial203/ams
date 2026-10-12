"""Form schema model helpers and schema validation (docs/FORMS.md "Schema validation")."""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from app.forms.expr import RESERVED_WORDS, Node, ParseError, identifiers, is_finite_number, is_number, parse

KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,62}$")

FIELD_TYPES = frozenset(
    {
        "number",
        "scale",
        "select",
        "multiselect",
        "boolean",
        "text",
        "textarea",
        "date",
        "time",
        "datetime",
        "duration",
        "calculated",
        "info",
    }
)
NON_VALUE_TYPES = frozenset({"calculated", "info"})
NUMERIC_TYPES = frozenset({"number", "scale", "duration"})


@dataclass(frozen=True)
class SchemaError:
    path: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "message": self.message}


@dataclass
class FieldInfo:
    key: str
    type: str
    section_index: int
    field_index: int
    spec: dict[str, Any]
    section_key: str | None = None

    @property
    def holds_value(self) -> bool:
        return self.type != "info"

    @property
    def is_input(self) -> bool:
        """A non-calculated field that holds a value."""
        return self.type not in NON_VALUE_TYPES


@dataclass
class SchemaIndex:
    """A flattened view of a schema that the engine and the API use."""

    fields: list[FieldInfo] = field(default_factory=list)
    by_key: dict[str, FieldInfo] = field(default_factory=dict)
    section_visible_if: dict[int, str | None] = field(default_factory=dict)

    @property
    def input_fields(self) -> list[FieldInfo]:
        return [f for f in self.fields if f.is_input]

    @property
    def calculated_fields(self) -> list[FieldInfo]:
        return [f for f in self.fields if f.type == "calculated"]


def index_schema(schema: dict[str, Any]) -> SchemaIndex:
    """Flatten a (valid or almost valid) schema. Later duplicates of a key are ignored."""
    idx = SchemaIndex()
    sections = schema.get("sections") if isinstance(schema, dict) else None
    if not isinstance(sections, list):
        return idx
    for si, section in enumerate(sections):
        if not isinstance(section, dict):
            continue
        vis = section.get("visible_if")
        idx.section_visible_if[si] = vis if isinstance(vis, str) else None
        fields = section.get("fields")
        if not isinstance(fields, list):
            continue
        for fi, f in enumerate(fields):
            if not isinstance(f, dict):
                continue
            key = f.get("key")
            ftype = f.get("type")
            if not isinstance(key, str) or not isinstance(ftype, str) or key in idx.by_key:
                continue
            info = FieldInfo(
                key=key, type=ftype, section_index=si, field_index=fi, spec=f, section_key=section.get("key")
            )
            idx.fields.append(info)
            idx.by_key[key] = info
    return idx


def _is_date(value: Any) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _check_options(f: dict[str, Any]) -> str | None:
    options = f.get("options")
    if not isinstance(options, list) or not options:
        return "options must be a non-empty list"
    values: list[Any] = []
    for opt in options:
        if not isinstance(opt, dict) or "value" not in opt or not isinstance(opt.get("label"), str):
            return "each option needs a value and a label"
        values.append(opt["value"])
    all_str = all(isinstance(v, str) for v in values)
    all_num = all(is_finite_number(v) for v in values)
    if not (all_str or all_num):
        return "option values must be all strings or all numbers"
    normalized = [float(v) for v in values] if all_num else values
    if len(set(normalized)) != len(normalized):
        return "option values must be unique"
    return None


def validate_schema(schema: Any) -> list[SchemaError]:
    """Validate a form schema. Returns a list of errors (empty when valid)."""
    errors: list[SchemaError] = []

    def err(path: str, message: str) -> None:
        errors.append(SchemaError(path, message))

    if not isinstance(schema, dict):
        return [SchemaError("", "schema must be an object")]
    if schema.get("schema_version") != 1 or isinstance(schema.get("schema_version"), bool):
        err("schema_version", "schema_version must be 1")
    sections = schema.get("sections")
    if not isinstance(sections, list):
        err("sections", "sections must be a list")
        return errors

    section_keys: set[str] = set()
    field_keys: set[str] = set()
    # (path_prefix, field dict) for every structurally valid field, in schema order
    fields_seen: list[tuple[str, dict[str, Any], int]] = []
    value_keys: set[str] = set()  # keys of fields that hold a value (anything but info)
    info_keys: set[str] = set()
    section_field_keys: dict[int, set[str]] = {}

    for si, section in enumerate(sections):
        sp = f"sections/{si}"
        if not isinstance(section, dict):
            err(sp, "section must be an object")
            continue
        skey = section.get("key")
        if not isinstance(skey, str) or not KEY_PATTERN.match(skey):
            err(f"{sp}/key", "section key must match ^[a-z][a-z0-9_]{0,62}$")
        elif skey in section_keys:
            err(f"{sp}/key", f"duplicate section key {skey!r}")
        else:
            section_keys.add(skey)
        if not isinstance(section.get("title"), str):
            err(f"{sp}/title", "section title is required")
        if "description" in section and section["description"] is not None and not isinstance(
            section["description"], str
        ):
            err(f"{sp}/description", "description must be a string")
        fields = section.get("fields")
        section_field_keys[si] = set()
        if not isinstance(fields, list) or not fields:
            err(f"{sp}/fields", "a section needs at least one field")
            continue
        for fi, f in enumerate(fields):
            fp = f"{sp}/fields/{fi}"
            if not isinstance(f, dict):
                err(fp, "field must be an object")
                continue
            key = f.get("key")
            key_ok = False  # a valid key (duplicates included: they still name a field)
            if not isinstance(key, str) or not KEY_PATTERN.match(key):
                err(f"{fp}/key", "field key must match ^[a-z][a-z0-9_]{0,62}$")
            elif key in RESERVED_WORDS:
                err(f"{fp}/key", f"{key!r} is a reserved word")
            elif key in field_keys:
                err(f"{fp}/key", f"duplicate field key {key!r}")
                key_ok = True
            else:
                key_ok = True
                field_keys.add(key)
            ftype = f.get("type")
            if ftype not in FIELD_TYPES:
                err(f"{fp}/type", f"unknown field type {ftype!r}")
            if not isinstance(f.get("label"), str):
                err(f"{fp}/label", "label is required")
            _validate_field_extras(f, ftype, fp, err)
            if key_ok:
                section_field_keys[si].add(key)
                if ftype == "info":
                    info_keys.add(key)
                else:
                    value_keys.add(key)
            fields_seen.append((fp, f, si))

    # Expressions: parse, references, cycles, visible_if self references.
    calc_refs: dict[str, set[str]] = {}
    calc_paths: dict[str, list[str]] = {}
    for fp, f, _si in fields_seen:
        key = f.get("key")
        if f.get("type") == "calculated":
            expr_text = f.get("expression")
            node = _parse_or_report(expr_text, f"{fp}/expression", err, required=True)
            if node is not None:
                refs = identifiers(node)
                bad = sorted(r for r in refs if r not in value_keys)
                if bad:
                    err(f"{fp}/expression", f"unknown or non-value field reference(s): {', '.join(bad)}")
                # every parsed calculation joins the cycle graph, even with a bad reference
                if isinstance(key, str) and KEY_PATTERN.match(key) and key not in RESERVED_WORDS:
                    calc_refs.setdefault(key, set()).update(refs)
                    calc_paths.setdefault(key, []).append(f"{fp}/expression")
        if "visible_if" in f and f["visible_if"] is not None:
            node = _parse_or_report(f["visible_if"], f"{fp}/visible_if", err, required=False)
            if node is not None:
                refs = identifiers(node)
                bad = sorted(r for r in refs if r not in value_keys)
                if bad:
                    err(f"{fp}/visible_if", f"unknown or non-value field reference(s): {', '.join(bad)}")
                if isinstance(key, str) and key in refs:
                    err(f"{fp}/visible_if", "visible_if may not reference its own field")

    for si, section in enumerate(sections):
        if not isinstance(section, dict) or section.get("visible_if") is None:
            continue
        sp = f"sections/{si}/visible_if"
        node = _parse_or_report(section.get("visible_if"), sp, err, required=False)
        if node is None:
            continue
        refs = identifiers(node)
        bad = sorted(r for r in refs if r not in value_keys)
        if bad:
            err(sp, f"unknown or non-value field reference(s): {', '.join(bad)}")
        own = sorted(refs & section_field_keys.get(si, set()))
        if own:
            err(sp, f"section visible_if may not reference fields inside the section: {', '.join(own)}")

    for key in _cyclic_nodes(calc_refs):
        for path in calc_paths[key]:
            err(path, "calculated fields form a dependency cycle")

    return _first_per_path(errors)


def _first_per_path(errors: list[SchemaError]) -> list[SchemaError]:
    """One error per offending path (the first problem found there), like the TypeScript engine."""
    seen: set[str] = set()
    out: list[SchemaError] = []
    for e in errors:
        if e.path not in seen:
            seen.add(e.path)
            out.append(e)
    return out


def _parse_or_report(text: Any, path: str, err: Any, *, required: bool) -> Node | None:
    if text is None or (isinstance(text, str) and not text.strip() and required):
        if required:
            err(path, "expression is required")
        return None
    if not isinstance(text, str):
        err(path, "expression must be a string")
        return None
    try:
        return parse(text)
    except ParseError as exc:
        err(path, f"cannot parse expression: {exc}")
        return None


def _validate_field_extras(f: dict[str, Any], ftype: Any, fp: str, err: Any) -> None:
    """Type-specific keys: required ones (rule 3) and optional ones *when present* (same as @ams/shared)."""

    def present(k: str) -> bool:
        return k in f

    def optional_number(k: str) -> None:
        if present(k) and not is_finite_number(f[k]):
            err(f"{fp}/{k}", f"{k} must be a number")

    def optional_positive(k: str) -> None:
        if present(k) and not (is_finite_number(f[k]) and f[k] > 0):
            err(f"{fp}/{k}", f"{k} must be a number greater than 0")

    def optional_count(k: str, minimum: int) -> None:
        if present(k) and not (_is_int(f[k]) and f[k] >= minimum):
            err(f"{fp}/{k}", f"{k} must be a whole number of at least {minimum}")

    def optional_decimals() -> None:
        if present("decimals") and not _is_small_int(f["decimals"]):
            err(f"{fp}/decimals", "decimals must be a whole number from 0 to 10")

    def min_not_above_max() -> None:
        if is_finite_number(f.get("min")) and is_finite_number(f.get("max")) and f["min"] > f["max"]:
            err(f"{fp}/max", "max must not be less than min")

    if ftype == "number":
        optional_number("min")
        optional_number("max")
        optional_positive("step")
        optional_decimals()
        min_not_above_max()
    elif ftype == "duration":
        optional_number("min")
        optional_number("max")
        min_not_above_max()
    elif ftype == "scale":
        mn, mx = f.get("min"), f.get("max")
        if not is_finite_number(mn):
            err(f"{fp}/min", "a scale needs a numeric min")
        if not is_finite_number(mx):
            err(f"{fp}/max", "a scale needs a numeric max")
        elif is_finite_number(mn) and mn >= mx:
            err(f"{fp}/max", "scale max must be greater than min")
        optional_positive("step")
        if present("anchors"):
            anchors = f["anchors"]
            if not isinstance(anchors, dict) or any(
                k in anchors and not isinstance(anchors[k], str) for k in ("min", "max", "mid")
            ):
                err(f"{fp}/anchors", "anchors must be an object with optional text min, mid and max")
        if present("display") and f["display"] not in ("buttons", "slider"):
            err(f"{fp}/display", "display must be 'buttons' or 'slider'")
    elif ftype in ("select", "multiselect"):
        problem = _check_options(f)
        if problem:
            err(f"{fp}/options", problem)
        if ftype == "multiselect":
            optional_count("min_selected", 0)
            optional_count("max_selected", 1)
            mn, mx = f.get("min_selected"), f.get("max_selected")
            if is_finite_number(mn) and is_finite_number(mx) and mn > mx:
                err(f"{fp}/max_selected", "max_selected must not be less than min_selected")
    elif ftype in ("text", "textarea"):
        optional_count("max_length", 1)
    elif ftype == "date":
        for k in ("min", "max"):
            if present(k) and not _is_date(f[k]):
                err(f"{fp}/{k}", f"{k} must be a YYYY-MM-DD date")
        if _is_date(f.get("min")) and _is_date(f.get("max")) and f["min"] > f["max"]:
            err(f"{fp}/max", "max must not be before min")
    elif ftype == "calculated":
        optional_decimals()


def _is_int(v: Any) -> bool:
    return is_finite_number(v) and float(v).is_integer()


def _is_small_int(v: Any) -> bool:
    return _is_int(v) and 0 <= v <= 10


def _cyclic_nodes(graph: dict[str, set[str]]) -> set[str]:
    """Nodes that are part of a cycle (Tarjan SCC: size > 1 or self loop)."""
    index_of: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: set[str] = set()
    counter = [0]

    def strongconnect(v: str) -> None:
        index_of[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in graph.get(v, set()):
            if w not in graph:
                continue
            if w not in index_of:
                strongconnect(w)
                low[v] = min(low[v], low[w])
            elif w in on_stack:
                low[v] = min(low[v], index_of[w])
        if low[v] == index_of[v]:
            component: list[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                component.append(w)
                if w == v:
                    break
            if len(component) > 1 or v in graph.get(v, set()):
                result.update(component)

    for node in graph:
        if node not in index_of:
            strongconnect(node)
    return result


def is_valid_schema(schema: Any) -> bool:
    return not validate_schema(schema)


def empty_schema() -> dict[str, Any]:
    return {"schema_version": 1, "sections": []}
