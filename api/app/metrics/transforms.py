"""Metric transforms over a daily series (docs/API.md "Metric transforms").

Inputs are a float ``pd.Series`` on a contiguous daily ``DatetimeIndex`` with NaN for days without
data, plus (for zscore / pct_change) a same-index series of source labels (provider/device for
wearable data, None otherwise). Missing data stays missing: windows honour ``min_periods`` and a
day with insufficient data yields NaN, never zero.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

TRANSFORMS = ("none", "rolling_mean", "rolling_sum", "ewma", "acwr", "zscore", "pct_change", "monotony", "strain")

# Transforms whose value depends on the whole history (EWMA recursion).
UNBOUNDED = "all"


class TransformError(ValueError):
    pass


def _int(params: Mapping[str, Any], key: str, default: int, minimum: int = 1) -> int:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or float(value) != int(value):
        raise TransformError(f"{key} must be an integer")
    if int(value) < minimum:
        raise TransformError(f"{key} must be >= {minimum}")
    return int(value)


def _bool(params: Mapping[str, Any], key: str, default: bool) -> bool:
    value = params.get(key, default)
    if not isinstance(value, bool):
        raise TransformError(f"{key} must be a boolean")
    return value


def _log(x: pd.Series) -> pd.Series:
    return pd.Series(np.where(x > 0, np.log(x.where(x > 0)), np.nan), index=x.index, dtype=float)


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    out = num / den.where(den != 0)
    return out.replace([np.inf, -np.inf], np.nan)


# ----------------------------------------------------------------------------- transforms


def rolling_mean(x: pd.Series, window: int = 7, min_periods: int | None = None, ln: bool = False) -> pd.Series:
    mp = min_periods if min_periods is not None else math.ceil(window * 0.7)
    y = _log(x) if ln else x
    return y.rolling(window, min_periods=min(mp, window)).mean()


def rolling_sum(x: pd.Series, window: int = 7, min_periods: int | None = None) -> pd.Series:
    mp = min_periods if min_periods is not None else window
    return x.rolling(window, min_periods=min(mp, window)).sum()


def _ewm(x: pd.Series, span: int) -> pd.Series:
    """Williams et al. (2017): EWMA_t = lambda * x_t + (1 - lambda) * EWMA_{t-1}, lambda = 2 / (span + 1).

    Seeded with the first observation; days without data are skipped (not treated as zero).
    """
    return x.ewm(alpha=2.0 / (span + 1.0), adjust=False, ignore_na=True).mean()


def ewma(x: pd.Series, span: int = 7, min_periods: int = 1) -> pd.Series:
    out = _ewm(x, span)
    count = x.notna().cumsum()
    return out.where(x.notna() & (count >= min_periods))


def acwr(
    x: pd.Series,
    acute: int = 7,
    chronic: int = 28,
    method: str = "ewma",
    coupled: bool = False,
    min_periods: int | None = None,
) -> pd.Series:
    """Acute:chronic workload ratio.

    * ``rolling``: acute = mean of the last ``acute`` days (incl. today). Coupled chronic = mean of the
      last ``chronic`` days; uncoupled chronic = mean of the ``chronic - acute`` days before the acute
      window (Lolli et al. 2019).
    * ``ewma``: acute / chronic EWMAs with lambda = 2/(N+1) (Williams et al. 2017). Uncoupled uses the
      chronic EWMA as it stood on the day before the acute window (``acute`` days ago).

    Values need ``min_periods`` (default ``chronic``) observed days up to the scored day; chronic 0 -> null.
    """
    if chronic <= acute:
        raise TransformError("chronic must be greater than acute")
    if method == "rolling":
        acute_load = x.rolling(acute, min_periods=acute).mean()
        if coupled:
            chronic_load = x.rolling(chronic, min_periods=chronic).mean()
        else:
            span = chronic - acute
            chronic_load = x.rolling(span, min_periods=span).mean().shift(acute)
    elif method == "ewma":
        acute_load = _ewm(x, acute)
        chronic_ewm = _ewm(x, chronic)
        chronic_load = chronic_ewm if coupled else chronic_ewm.shift(acute)
    else:
        raise TransformError("method must be 'rolling' or 'ewma'")
    ratio = _safe_div(acute_load, chronic_load)
    needed = min_periods if min_periods is not None else chronic
    count = x.notna().cumsum()
    return ratio.where(x.notna() & (count >= needed))


def _same_source_stats(
    y: np.ndarray,
    sources: list[Any],
    t: int,
    lo: int,
    hi: int,
) -> np.ndarray:
    """Non-NaN values of y in [lo, hi] (inclusive, clipped) whose source equals sources[t]."""
    lo = max(lo, 0)
    if hi < lo:
        return np.array([], dtype=float)
    src = sources[t]
    idx = [i for i in range(lo, hi + 1) if not np.isnan(y[i]) and sources[i] == src]
    return y[idx] if idx else np.array([], dtype=float)


def zscore(
    x: pd.Series,
    sources: pd.Series | None = None,
    baseline: int = 28,
    min_periods: int = 14,
    smooth: int = 1,
    ln: bool = False,
) -> pd.Series:
    """(mean_smooth - mean_baseline) / sd_baseline using same-source days only.

    mean_smooth: mean of the (ln) values over the ``smooth`` days ending today (needs ceil(0.7*smooth)
    same-source values, and today's value). Baseline: the ``baseline`` days before today (excluding
    today), same source as today, at least ``min_periods`` values; sample SD (ddof=1); SD 0 -> null.
    A device change therefore restarts the baseline instead of producing a spurious deviation.
    """
    y = (_log(x) if ln else x).to_numpy(dtype=float)
    src = list(sources) if sources is not None else [None] * len(y)
    smooth_mp = max(1, math.ceil(smooth * 0.7))
    out = np.full(len(y), np.nan)
    for t in range(len(y)):
        if np.isnan(y[t]):
            continue
        recent = _same_source_stats(y, src, t, t - smooth + 1, t)
        if len(recent) < smooth_mp:
            continue
        base = _same_source_stats(y, src, t, t - baseline, t - 1)
        if len(base) < max(min_periods, 2):
            continue
        sd = float(np.std(base, ddof=1))
        if sd == 0 or not np.isfinite(sd):
            continue
        out[t] = (float(np.mean(recent)) - float(np.mean(base))) / sd
    return pd.Series(out, index=x.index)


def pct_change(x: pd.Series, sources: pd.Series | None = None, baseline: int = 28, min_periods: int = 14) -> pd.Series:
    """100 x (x - mean_baseline) / mean_baseline, baseline as in :func:`zscore` (same source, excl. today)."""
    y = x.to_numpy(dtype=float)
    src = list(sources) if sources is not None else [None] * len(y)
    out = np.full(len(y), np.nan)
    for t in range(len(y)):
        if np.isnan(y[t]):
            continue
        base = _same_source_stats(y, src, t, t - baseline, t - 1)
        if len(base) < max(min_periods, 1):
            continue
        mean = float(np.mean(base))
        if mean == 0:
            continue
        out[t] = 100.0 * (y[t] - mean) / mean
    return pd.Series(out, index=x.index)


def monotony(x: pd.Series, window: int = 7, min_periods: int | None = None) -> pd.Series:
    """Mean / SD (sample, ddof=1) of daily load over the window (Foster 1998); null when SD = 0."""
    mp = min_periods if min_periods is not None else window
    roll = x.rolling(window, min_periods=min(mp, window))
    return _safe_div(roll.mean(), roll.std(ddof=1))


def strain(x: pd.Series, window: int = 7, min_periods: int | None = None) -> pd.Series:
    """Weekly load sum x monotony (Foster 1998)."""
    mp = min_periods if min_periods is not None else window
    total = x.rolling(window, min_periods=min(mp, window)).sum()
    return total * monotony(x, window, min_periods)


# ----------------------------------------------------------------------------- data requirements


@dataclass(frozen=True)
class Shortfall:
    """A data requirement a transform has not met on a day: ``have`` of ``need`` observed days."""

    have: int
    need: int
    window: int | None  # days the count is taken over (ending on the day); None = all history
    same_source: bool  # only days from the day's own provider/device count


def shortfall(
    transform: str, params: Mapping[str, Any], x: pd.Series, sources: pd.Series | None, t: int
) -> Shortfall | None:
    """Why ``transform`` is null on day ``t`` (an index position where ``x`` has a value), or None
    when every data requirement is met (the value may still be null, e.g. a zero SD).

    Mirrors the requirements of the transforms above; a baseline shortfall is reported before a
    smoothing one because it is the longer wait.
    """
    p = dict(params)

    def observed(lo: int, hi: int) -> int:
        return int(x.iloc[max(lo, 0) : hi + 1].notna().sum())

    def short(have: int, need: int, window: int | None, same_source: bool = False) -> Shortfall | None:
        return Shortfall(have, need, window, same_source) if have < need else None

    if transform in ("rolling_mean", "rolling_sum", "monotony", "strain"):
        window = _int(p, "window", 7)
        mp = p.get("min_periods")
        default = math.ceil(window * 0.7) if transform == "rolling_mean" else window
        need = min(default if mp is None else int(mp), window)
        if transform == "rolling_mean" and _bool(p, "ln", False):
            x = _log(x)
        return short(observed(t - window + 1, t), need, window)
    if transform in ("ewma", "acwr"):
        if transform == "ewma":
            need = _int(p, "min_periods", 1)
        else:
            mp = p.get("min_periods")
            need = _int(p, "chronic", 28) if mp is None else int(mp)
        return short(observed(0, t), need, None)
    if transform in ("zscore", "pct_change"):
        baseline = _int(p, "baseline", 28)
        min_periods = _int(p, "min_periods", 14, minimum=0)
        y = (_log(x) if transform == "zscore" and _bool(p, "ln", False) else x).to_numpy(dtype=float)
        src = list(sources) if sources is not None else [None] * len(y)
        base = len(_same_source_stats(y, src, t, t - baseline, t - 1))
        need = max(min_periods, 2) if transform == "zscore" else max(min_periods, 1)
        if base < need:
            return Shortfall(base, need, baseline, True)
        if transform == "zscore":
            smooth = _int(p, "smooth", 1)
            recent = len(_same_source_stats(y, src, t, t - smooth + 1, t))
            return short(recent, max(1, math.ceil(smooth * 0.7)), smooth, True)
    return None


# ----------------------------------------------------------------------------- dispatch


def validate_params(transform: str, params: Mapping[str, Any]) -> None:
    """Raise TransformError for bad parameters (used when saving definitions)."""
    if transform not in TRANSFORMS:
        raise TransformError(f"unknown transform {transform!r}")
    lookback(transform, params)
    if transform == "acwr":
        method = params.get("method", "ewma")
        if method not in ("rolling", "ewma"):
            raise TransformError("method must be 'rolling' or 'ewma'")
        _bool(params, "coupled", False)
        if _int(params, "chronic", 28) <= _int(params, "acute", 7):
            raise TransformError("chronic must be greater than acute")
    if transform in ("rolling_mean", "zscore"):
        _bool(params, "ln", False)


def lookback(transform: str, params: Mapping[str, Any]) -> int | str:
    """Days of history needed before the first output day (or UNBOUNDED for EWMA recursions)."""
    if transform == "none":
        return 0
    if transform in ("rolling_mean", "rolling_sum", "monotony", "strain"):
        if "min_periods" in params:
            _int(params, "min_periods", 1, minimum=0)
        return _int(params, "window", 7) - 1
    if transform == "ewma":
        _int(params, "span", 7)
        return UNBOUNDED
    if transform == "acwr":
        acute, chronic = _int(params, "acute", 7), _int(params, "chronic", 28)
        if params.get("method", "ewma") == "ewma":
            return UNBOUNDED
        return max(chronic, acute) - 1
    if transform == "zscore":
        _int(params, "min_periods", 14, minimum=0)
        return max(_int(params, "baseline", 28), _int(params, "smooth", 1) - 1)
    if transform == "pct_change":
        _int(params, "min_periods", 14, minimum=0)
        return _int(params, "baseline", 28)
    raise TransformError(f"unknown transform {transform!r}")


def apply(transform: str, params: Mapping[str, Any], x: pd.Series, sources: pd.Series | None) -> pd.Series:
    p = dict(params)
    if transform == "none":
        return x.astype(float)
    if transform == "rolling_mean":
        mp = p.get("min_periods")
        return rolling_mean(x, _int(p, "window", 7), None if mp is None else int(mp), _bool(p, "ln", False))
    if transform == "rolling_sum":
        mp = p.get("min_periods")
        return rolling_sum(x, _int(p, "window", 7), None if mp is None else int(mp))
    if transform == "ewma":
        return ewma(x, _int(p, "span", 7), _int(p, "min_periods", 1))
    if transform == "acwr":
        mp = p.get("min_periods")
        return acwr(
            x,
            _int(p, "acute", 7),
            _int(p, "chronic", 28),
            str(p.get("method", "ewma")),
            _bool(p, "coupled", False),
            None if mp is None else int(mp),
        )
    if transform == "zscore":
        return zscore(
            x,
            sources,
            _int(p, "baseline", 28),
            _int(p, "min_periods", 14, minimum=0),
            _int(p, "smooth", 1),
            _bool(p, "ln", False),
        )
    if transform == "pct_change":
        return pct_change(x, sources, _int(p, "baseline", 28), _int(p, "min_periods", 14, minimum=0))
    if transform == "monotony":
        mp = p.get("min_periods")
        return monotony(x, _int(p, "window", 7), None if mp is None else int(mp))
    if transform == "strain":
        mp = p.get("min_periods")
        return strain(x, _int(p, "window", 7), None if mp is None else int(mp))
    raise TransformError(f"unknown transform {transform!r}")


def flag(value: float | None, thresholds: Mapping[str, Any] | None) -> str | None:
    """high_bad: >= red red, >= amber amber, else green; low_bad mirrored; both_bad compares |value|."""
    if value is None or not thresholds or (isinstance(value, float) and math.isnan(value)):
        return None
    amber, red = thresholds.get("amber"), thresholds.get("red")
    if amber is None and red is None:
        return None
    direction = thresholds.get("direction", "high_bad")
    v = value
    if direction == "both_bad":
        v = abs(value)
        direction = "high_bad"
    if direction == "high_bad":
        if red is not None and v >= red:
            return "red"
        if amber is not None and v >= amber:
            return "amber"
        return "green"
    if direction == "low_bad":
        if red is not None and v <= red:
            return "red"
        if amber is not None and v <= amber:
            return "amber"
        return "green"
    return None
