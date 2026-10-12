"""Daily metric series per athlete, computed on demand with pandas.

A definition's ``source`` gives a base daily series:

* ``form:<slug>.<field>``: the field (input or calculated) of non-deleted submissions, collapsed per
  ``local_date`` with ``daily_agg`` (``last`` = latest ``observed_at``). Booleans count as 1/0.
* ``wearable:<metric>``: ``wearable_daily`` rows; one value per day (the most recently refreshed
  provider), with ``provider/device`` kept as the day's source label for same-source baselines.
* ``metric:<slug>``: another definition's transformed output (cycles are rejected).

With ``fill_zero`` days without data count as 0 from the athlete's first observation onwards
(before that the series is missing). The transform is then applied over enough history before
``start`` (all history for EWMA-based transforms) and the result is sliced to [start, end].
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.forms.expr import round_half_away
from app.forms.schema import index_schema
from app.integrations.open_wearables.daily import WEARABLE_METRICS
from app.metrics import transforms
from app.models import Form, MetricDefinition, Submission, WearableDaily

SourceKind = Literal["form", "wearable", "metric"]


class MetricError(ValueError):
    pass


class CycleError(MetricError):
    pass


@dataclass(frozen=True)
class SeriesRef:
    kind: SourceKind
    name: str  # form slug / wearable metric / metric slug
    field: str | None = None

    def __str__(self) -> str:
        if self.kind == "form":
            return f"form:{self.name}.{self.field}"
        return f"{self.kind}:{self.name}"


def parse_ref(text: str) -> SeriesRef:
    kind, sep, rest = text.partition(":")
    if not sep or not rest:
        raise MetricError(f"invalid source {text!r}; expected form:<slug>.<field>, wearable:<metric> or metric:<slug>")
    if kind == "form":
        slug, dot, fld = rest.rpartition(".")
        if not dot or not slug or not fld:
            raise MetricError(f"invalid form source {text!r}; expected form:<form_slug>.<field_key>")
        return SeriesRef("form", slug, fld)
    if kind in ("wearable", "metric"):
        return SeriesRef(kind, rest)  # type: ignore[arg-type]
    raise MetricError(f"unknown source kind {kind!r}")


@dataclass
class Series:
    values: pd.Series  # float, daily DatetimeIndex
    sources: pd.Series  # object labels (None when not wearable-based)


@dataclass
class PointOut:
    date: dt.date
    value: float | None
    flag: str | None
    source: str | None


def _empty() -> Series:
    idx = pd.DatetimeIndex([], freq="D")
    return Series(pd.Series([], index=idx, dtype=float), pd.Series([], index=idx, dtype=object))


def _numeric(v: Any) -> float | None:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)) and np.isfinite(v):
        return float(v)
    return None


def _agg(values: list[float], how: str) -> float:
    if how == "sum":
        return float(sum(values))
    if how == "mean":
        return float(sum(values) / len(values))
    if how == "max":
        return float(max(values))
    if how == "min":
        return float(min(values))
    return float(values[-1])  # last (values are ordered by observed_at)


def round_value(value: float, decimals: int) -> float:
    rounded = round_half_away(float(value), int(decimals))
    return float(rounded) if rounded is not None else float("nan")


class MetricEngine:
    """Computes metrics for a fixed set of athletes. One instance per request (memoizes loads)."""

    def __init__(self, db: Session, org_id: uuid.UUID, athlete_ids: list[uuid.UUID]) -> None:
        self.db = db
        self.org_id = org_id
        self.athlete_ids = list(dict.fromkeys(athlete_ids))
        self._defs: dict[str, MetricDefinition] | None = None
        self._memo: dict[tuple[str, dt.date | None, dt.date], dict[uuid.UUID, Series]] = {}

    # ------------------------------------------------------------------ definitions
    @property
    def definitions(self) -> dict[str, MetricDefinition]:
        if self._defs is None:
            rows = self.db.scalars(select(MetricDefinition).where(MetricDefinition.org_id == self.org_id))
            self._defs = {m.slug: m for m in rows}
        return self._defs

    def lookback(self, defn: MetricDefinition, stack: tuple[str, ...] = ()) -> int | None:
        """Days of history needed before ``start``; None = all history."""
        if defn.slug in stack:
            raise CycleError(f"circular metric reference: {' -> '.join([*stack, defn.slug])}")
        own = transforms.lookback(defn.transform, defn.params or {})
        if own == transforms.UNBOUNDED:
            return None
        ref = parse_ref(defn.source)
        if ref.kind != "metric":
            return int(own)
        src = self.definitions.get(ref.name)
        if src is None:
            return int(own)
        inner = self.lookback(src, (*stack, defn.slug))
        return None if inner is None else int(own) + inner

    def form_refs(self, defn: MetricDefinition, stack: tuple[str, ...] = ()) -> list[SeriesRef]:
        """Every form source this metric depends on (through metric: references)."""
        if defn.slug in stack:
            raise CycleError(f"circular metric reference: {' -> '.join([*stack, defn.slug])}")
        ref = parse_ref(defn.source)
        if ref.kind == "form":
            return [ref]
        if ref.kind == "metric" and ref.name in self.definitions:
            return self.form_refs(self.definitions[ref.name], (*stack, defn.slug))
        return []

    # ------------------------------------------------------------------ loading
    def _calendar(self, first: dt.date | None, start: dt.date | None, end: dt.date) -> pd.DatetimeIndex:
        lo = start if start is not None else first
        if lo is None or lo > end:
            return pd.DatetimeIndex([], freq="D")
        return pd.date_range(lo, end, freq="D")

    def _form_daily(
        self, ref: SeriesRef, agg: str, start: dt.date | None, end: dt.date
    ) -> tuple[dict[uuid.UUID, dict[dt.date, float]], dict[uuid.UUID, dt.date]]:
        form_id = self.db.scalar(select(Form.id).where(Form.org_id == self.org_id, Form.slug == ref.name))
        if form_id is None or not self.athlete_ids:
            return {}, {}
        key = ref.field or ""
        numeric_types = ("number", "boolean")
        observed = or_(
            func.jsonb_typeof(Submission.values[key]).in_(numeric_types),
            func.jsonb_typeof(Submission.computed[key]).in_(numeric_types),
        )
        scope = (
            Submission.form_id == form_id,
            Submission.athlete_id.in_(self.athlete_ids),
            Submission.deleted_at.is_(None),
            observed,
        )
        q = (
            select(Submission.athlete_id, Submission.local_date, Submission.values[key], Submission.computed[key])
            .where(*scope, Submission.local_date <= end)
            .order_by(Submission.local_date, Submission.observed_at, Submission.created_at)
        )
        if start is not None:
            q = q.where(Submission.local_date >= start)
        per_day: dict[uuid.UUID, dict[dt.date, list[float]]] = defaultdict(lambda: defaultdict(list))
        for aid, day, v, c in self.db.execute(q):
            num = _numeric(v if v is not None else c)
            if num is not None:
                per_day[aid][day].append(num)
        daily = {aid: {d: _agg(vals, agg) for d, vals in days.items()} for aid, days in per_day.items()}
        # first observation of the field (for fill_zero), possibly before the loaded window
        first_q = select(Submission.athlete_id, func.min(Submission.local_date)).where(*scope).group_by(
            Submission.athlete_id
        )
        firsts = {aid: day for aid, day in self.db.execute(first_q)}
        return daily, firsts

    def _wearable_daily(
        self, ref: SeriesRef, start: dt.date | None, end: dt.date
    ) -> tuple[dict[uuid.UUID, dict[dt.date, tuple[float, str]]], dict[uuid.UUID, dt.date]]:
        if ref.name not in WEARABLE_METRICS or not self.athlete_ids:
            return {}, {}
        q = (
            select(
                WearableDaily.athlete_id,
                WearableDaily.local_date,
                WearableDaily.value,
                WearableDaily.provider,
                WearableDaily.device,
            )
            .where(
                WearableDaily.athlete_id.in_(self.athlete_ids),
                WearableDaily.metric == ref.name,
                WearableDaily.local_date <= end,
            )
            .order_by(WearableDaily.local_date, WearableDaily.updated_at, WearableDaily.provider)
        )
        if start is not None:
            q = q.where(WearableDaily.local_date >= start)
        out: dict[uuid.UUID, dict[dt.date, tuple[float, str]]] = defaultdict(dict)
        for aid, day, value, provider, device in self.db.execute(q):
            out[aid][day] = (float(value), f"{provider}/{device}" if device else provider)  # latest refresh wins
        firsts: dict[uuid.UUID, dt.date] = {}
        first_q = (
            select(WearableDaily.athlete_id, func.min(WearableDaily.local_date))
            .where(WearableDaily.athlete_id.in_(self.athlete_ids), WearableDaily.metric == ref.name)
            .group_by(WearableDaily.athlete_id)
        )
        for aid, day in self.db.execute(first_q):
            firsts[aid] = day
        return out, firsts

    def _base(
        self, defn: MetricDefinition, start: dt.date | None, end: dt.date, stack: tuple[str, ...]
    ) -> dict[uuid.UUID, Series]:
        ref = parse_ref(defn.source)
        out: dict[uuid.UUID, Series] = {}
        if ref.kind == "metric":
            src = self.definitions.get(ref.name)
            if src is None:
                return {aid: _empty() for aid in self.athlete_ids}
            inner = self.series(src, start, end, stack)
            for aid, s in inner.items():
                out[aid] = self._fill(s, None, defn.fill_zero)
            return out
        if ref.kind == "form":
            daily, firsts = self._form_daily(ref, defn.daily_agg, start, end)
            for aid in self.athlete_ids:
                days = daily.get(aid, {})
                first = min(days) if (start is None and days) else firsts.get(aid)
                idx = self._calendar(first, start, end)
                values = pd.Series([days.get(d.date(), np.nan) for d in idx], index=idx, dtype=float)
                out[aid] = self._fill(Series(values, pd.Series([None] * len(idx), index=idx, dtype=object)),
                                      firsts.get(aid), defn.fill_zero)
            return out
        wdaily, firsts = self._wearable_daily(ref, start, end)
        for aid in self.athlete_ids:
            days = wdaily.get(aid, {})
            first = min(days) if (start is None and days) else firsts.get(aid)
            idx = self._calendar(first, start, end)
            values = pd.Series([days[d.date()][0] if d.date() in days else np.nan for d in idx], index=idx, dtype=float)
            labels = pd.Series([days[d.date()][1] if d.date() in days else None for d in idx], index=idx, dtype=object)
            out[aid] = self._fill(Series(values, labels), firsts.get(aid), defn.fill_zero)
        return out

    @staticmethod
    def _fill(s: Series, first: dt.date | None, fill_zero: bool) -> Series:
        if not fill_zero or s.values.empty:
            return s
        if first is None:
            observed = s.values.dropna()
            if observed.empty:
                return s
            first_ts = observed.index[0]
        else:
            first_ts = pd.Timestamp(first)
        mask = (s.values.index >= first_ts) & s.values.isna().to_numpy()
        values = s.values.copy()
        values[mask] = 0.0
        return Series(values, s.sources)

    # ------------------------------------------------------------------ public
    def series(
        self, defn: MetricDefinition, start: dt.date | None, end: dt.date, stack: tuple[str, ...] = ()
    ) -> dict[uuid.UUID, Series]:
        """Unrounded transformed series per athlete over [start, end] (start None = all history)."""
        if defn.slug in stack:
            raise CycleError(f"circular metric reference: {' -> '.join([*stack, defn.slug])}")
        key = (defn.slug, start, end)
        if key in self._memo:
            return self._memo[key]
        lb = self.lookback(defn, stack)
        hist_start = None if (start is None or lb is None) else start - dt.timedelta(days=lb)
        base = self._base(defn, hist_start, end, (*stack, defn.slug))
        out: dict[uuid.UUID, Series] = {}
        for aid, s in base.items():
            if s.values.empty:
                out[aid] = s
                continue
            values = transforms.apply(defn.transform, defn.params or {}, s.values, s.sources)
            values = values.replace([np.inf, -np.inf], np.nan)
            if start is not None:
                values = values[values.index >= pd.Timestamp(start)]
                labels = s.sources[s.sources.index >= pd.Timestamp(start)]
            else:
                labels = s.sources
            out[aid] = Series(values.astype(float), labels)
        self._memo[key] = out
        return out

    def points(self, defn: MetricDefinition, start: dt.date, end: dt.date) -> dict[uuid.UUID, list[PointOut]]:
        """Rounded points for every day in [start, end] with flags and source labels."""
        computed = self.series(defn, start, end)
        idx = pd.date_range(start, end, freq="D")
        wearable_based = self.is_wearable_based(defn)
        out: dict[uuid.UUID, list[PointOut]] = {}
        for aid in self.athlete_ids:
            s = computed.get(aid) or _empty()
            values = s.values.reindex(idx)
            labels = s.sources.reindex(idx)
            pts: list[PointOut] = []
            for ts, v in values.items():
                value = None if pd.isna(v) else round_value(float(v), defn.decimals)
                if value is not None and np.isnan(value):
                    value = None
                label = labels.get(ts)
                pts.append(
                    PointOut(
                        date=ts.date(),
                        value=value,
                        flag=transforms.flag(value, defn.thresholds),
                        source=label if (wearable_based and isinstance(label, str)) else None,
                    )
                )
            out[aid] = pts
        return out

    def is_wearable_based(self, defn: MetricDefinition, stack: tuple[str, ...] = ()) -> bool:
        ref = parse_ref(defn.source)
        if ref.kind == "wearable":
            return True
        if ref.kind == "metric" and ref.name in self.definitions and defn.slug not in stack:
            return self.is_wearable_based(self.definitions[ref.name], (*stack, defn.slug))
        return False


# ----------------------------------------------------------------------------- validation


def numeric_form_fields(schema: dict[str, Any]) -> dict[str, tuple[str, str | None]]:
    """field key -> (label, unit) for numeric/boolean/calculated fields usable as metric sources."""
    out: dict[str, tuple[str, str | None]] = {}
    for f in index_schema(schema).fields:
        spec = f.spec
        numeric_select = f.type == "select" and all(
            isinstance(o.get("value"), (int, float)) and not isinstance(o.get("value"), bool)
            for o in spec.get("options", []) or []
            if isinstance(o, dict)
        )
        if f.type in ("number", "scale", "duration", "boolean", "calculated") or numeric_select:
            out[f.key] = (str(spec.get("label") or f.key), spec.get("unit"))
    return out


def validate_source(db: Session, org_id: uuid.UUID, source: str) -> SeriesRef:
    ref = parse_ref(source)
    if ref.kind == "wearable":
        if ref.name not in WEARABLE_METRICS:
            raise MetricError(f"unknown wearable metric {ref.name!r}")
        return ref
    if ref.kind == "metric":
        if db.scalar(select(MetricDefinition.id).where(
            MetricDefinition.org_id == org_id, MetricDefinition.slug == ref.name
        )) is None:
            raise MetricError(f"unknown metric {ref.name!r}")
        return ref
    form = db.scalar(select(Form).where(Form.org_id == org_id, Form.slug == ref.name))
    if form is None:
        raise MetricError(f"unknown form {ref.name!r}")
    fields: dict[str, tuple[str, str | None]] = {}
    if form.current_version is not None:
        fields |= numeric_form_fields(form.current_version.schema)
    fields |= numeric_form_fields(form.draft_schema or {})
    if ref.field not in fields:
        raise MetricError(f"form {ref.name!r} has no numeric field {ref.field!r}")
    return ref


def check_cycles(db: Session, org_id: uuid.UUID, slug: str, source: str) -> None:
    """Reject a definition whose ``metric:`` chain leads back to itself."""
    sources = dict(
        db.execute(select(MetricDefinition.slug, MetricDefinition.source).where(MetricDefinition.org_id == org_id)).all()
    )
    sources[slug] = source
    seen = [slug]
    cur = source
    while True:
        ref = parse_ref(cur)
        if ref.kind != "metric":
            return
        if ref.name in seen:
            raise CycleError(f"circular metric reference: {' -> '.join([*seen, ref.name])}")
        seen.append(ref.name)
        nxt = sources.get(ref.name)
        if nxt is None:
            return
        cur = nxt
