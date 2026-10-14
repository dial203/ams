"""Transforms against hand-computed numbers (docs/API.md "Metric transforms")."""

from __future__ import annotations

import math
import statistics

import numpy as np
import pandas as pd
import pytest

from app.metrics import transforms as t

NAN = float("nan")


def series(values: list[float], sources: list[str | None] | None = None) -> tuple[pd.Series, pd.Series]:
    idx = pd.date_range("2026-01-01", periods=len(values), freq="D")
    src = pd.Series(sources if sources is not None else [None] * len(values), index=idx, dtype=object)
    return pd.Series(values, index=idx, dtype=float), src


def as_list(s: pd.Series) -> list[float | None]:
    return [None if pd.isna(v) else round(float(v), 6) for v in s]


def test_rolling_mean() -> None:
    x, _ = series([1, 2, 3, 4, 5])
    # window 3, min_periods ceil(0.7*3)=3
    assert as_list(t.rolling_mean(x, 3)) == [None, None, 2, 3, 4]
    x, _ = series([1, NAN, 3, 4])
    assert as_list(t.rolling_mean(x, 3, min_periods=2)) == [None, None, 2, 3.5]
    x, _ = series([1, math.e, math.e**2])
    assert as_list(t.rolling_mean(x, 2, ln=True)) == [None, 0.5, 1.5]


def test_rolling_sum() -> None:
    x, _ = series([1, 2, 3, 4, 5])
    assert as_list(t.rolling_sum(x, 3)) == [None, None, 6, 9, 12]
    x, _ = series([1, NAN, 3, 4])
    assert as_list(t.rolling_sum(x, 3)) == [None, None, None, None]  # min_periods = window by default


def test_ewma_williams() -> None:
    # span 3 -> lambda 0.5: 2, 0.5*4 + 0.5*2 = 3, 0.5*8 + 0.5*3 = 5.5
    x, _ = series([2, 4, 8])
    assert as_list(t.ewma(x, 3)) == [2, 3, 5.5]
    # missing days stay missing and are skipped by the recursion
    x, _ = series([2, NAN, 4])
    assert as_list(t.ewma(x, 3)) == [2, None, 3]


LOADS = [10, 20, 30, 40, 50, 60]


def test_acwr_rolling_coupled_and_uncoupled() -> None:
    x, _ = series(LOADS)
    coupled = as_list(t.acwr(x, acute=2, chronic=4, method="rolling", coupled=True))
    # acute = mean of last 2 days; chronic = mean of last 4 days
    assert coupled == [None, None, None, round(35 / 25, 6), round(45 / 35, 6), round(55 / 45, 6)]
    uncoupled = as_list(t.acwr(x, acute=2, chronic=4, method="rolling", coupled=False))
    # chronic = mean of the 2 days before the acute window: (10+20)/2, (20+30)/2, (30+40)/2
    assert uncoupled == [None, None, None, round(35 / 15, 6), round(45 / 25, 6), round(55 / 35, 6)]


def test_acwr_ewma_coupled_and_uncoupled() -> None:
    x, _ = series(LOADS)
    la, lc = 2 / 3, 2 / 5  # lambda = 2/(N+1) for N = 2 and 4
    acute, chronic = [10.0], [10.0]
    for v in LOADS[1:]:
        acute.append(la * v + (1 - la) * acute[-1])
        chronic.append(lc * v + (1 - lc) * chronic[-1])
    # hand values: acute_4 = 950/27, chronic_4 = 28.24, chronic_2 = 14
    assert (
        acute[3] == pytest.approx(950 / 27) and chronic[3] == pytest.approx(28.24) and chronic[1] == pytest.approx(14)
    )
    coupled = as_list(t.acwr(x, acute=2, chronic=4, method="ewma", coupled=True))
    assert coupled[:3] == [None, None, None]  # needs `chronic` observed days
    assert coupled[3:] == [round(acute[i] / chronic[i], 6) for i in (3, 4, 5)]
    uncoupled = as_list(t.acwr(x, acute=2, chronic=4, method="ewma", coupled=False))
    # uncoupled: chronic EWMA as it stood the day before the acute window (2 days earlier)
    assert uncoupled[3:] == [round(acute[i] / chronic[i - 2], 6) for i in (3, 4, 5)]
    assert uncoupled[3] == pytest.approx((950 / 27) / 14, abs=1e-6)


def test_acwr_zero_chronic_is_null() -> None:
    x, _ = series([0, 0, 0, 0, 10])
    assert as_list(t.acwr(x, acute=2, chronic=4, method="rolling", coupled=True))[3] is None


def test_zscore_basic() -> None:
    x, src = series([10, 12, 11, 13, 20])
    z = as_list(t.zscore(x, src, baseline=4, min_periods=3))
    # day 4: baseline [10,12,11] mean 11 sd 1 -> 2; day 5: baseline mean 11.5, sd sqrt(5/3)
    assert z[:3] == [None, None, None]
    assert z[3] == 2.0
    assert z[4] == round((20 - 11.5) / math.sqrt(5 / 3), 6)


def test_zscore_smooth_and_ln() -> None:
    x, src = series([10, 12, 11, 13, 20, 22])
    z = as_list(t.zscore(x, src, baseline=4, min_periods=3, smooth=2))
    # day 6: smooth mean (20+22)/2 = 21; baseline days 2..5 = [12,11,13,20] mean 14, sd sqrt(50/3)
    assert z[5] == round((21 - 14) / math.sqrt(50 / 3), 6)
    zl = as_list(t.zscore(x, src, baseline=4, min_periods=3, smooth=1, ln=True))
    base = [math.log(v) for v in (10, 12, 11)]
    assert zl[3] == round((math.log(13) - statistics.mean(base)) / statistics.stdev(base), 6)


def test_zscore_baseline_never_mixes_sources() -> None:
    values = [10, 12, 11, 13, 50, 52, 51]
    sources = ["oura/Ring", "oura/Ring", "oura/Ring", "oura/Ring", "garmin/Fenix", "garmin/Fenix", "garmin/Fenix"]
    x, src = series(values, sources)
    z = as_list(t.zscore(x, src, baseline=6, min_periods=2))
    # device switch on day 5: no same-source baseline yet -> null (a mixed baseline would give ~29.8)
    assert z[4] is None and z[5] is None
    # day 7: baseline = garmin days 50, 52 -> mean 51, sd sqrt(2) -> (51 - 51) / sqrt(2) = 0
    assert z[6] == 0.0
    mixed = (50 - statistics.mean(values[:4])) / statistics.stdev(values[:4])
    assert mixed > 25  # what the guard prevents


def test_pct_change() -> None:
    x, src = series([10, 20, 30, 33])
    p = as_list(t.pct_change(x, src, baseline=3, min_periods=2))
    assert p == [None, None, 100.0, 65.0]
    x, src = series([5, 5, 6], ["a", "a", "b"])
    assert as_list(t.pct_change(x, src, baseline=3, min_periods=1))[2] is None


def test_monotony_and_strain_foster() -> None:
    week = [300, 0, 450, 0, 600, 300, 0]
    x, _ = series(week)
    mono = statistics.mean(week) / statistics.stdev(week)
    assert as_list(t.monotony(x, 7))[-1] == round(mono, 6)
    assert as_list(t.strain(x, 7))[-1] == round(sum(week) * mono, 6)
    x, _ = series([100, 0, 50])
    assert as_list(t.monotony(x, 3)) == [None, None, 1.0]
    assert as_list(t.strain(x, 3)) == [None, None, 150.0]
    x, _ = series([2, 2, 2])
    assert as_list(t.monotony(x, 3))[-1] is None  # sd = 0


def test_apply_dispatch_defaults() -> None:
    x, src = series(list(range(1, 31)))
    assert as_list(t.apply("rolling_sum", {}, x, src))[6] == 28  # window 7
    assert as_list(t.apply("none", {}, x, src)) == list(range(1, 31))
    with pytest.raises(t.TransformError):
        t.apply("acwr", {"acute": 7, "chronic": 7}, x, src)
    with pytest.raises(t.TransformError):
        t.validate_params("rolling_mean", {"window": 0})
    with pytest.raises(t.TransformError):
        t.validate_params("acwr", {"method": "magic"})
    assert t.lookback("acwr", {"method": "ewma"}) == t.UNBOUNDED
    assert t.lookback("zscore", {"baseline": 60, "smooth": 7}) == 60
    assert t.lookback("rolling_mean", {"window": 28}) == 27


@pytest.mark.parametrize(
    ("value", "thresholds", "expected"),
    [
        (17, {"direction": "high_bad", "amber": 18, "red": 22}, "green"),
        (18, {"direction": "high_bad", "amber": 18, "red": 22}, "amber"),
        (22, {"direction": "high_bad", "amber": 18, "red": 22}, "red"),
        (-0.4, {"direction": "low_bad", "amber": -0.5, "red": -1}, "green"),
        (-0.5, {"direction": "low_bad", "amber": -0.5, "red": -1}, "amber"),
        (-1.2, {"direction": "low_bad", "amber": -0.5, "red": -1}, "red"),
        (-1.5, {"direction": "both_bad", "amber": 1, "red": 2}, "amber"),
        (2.5, {"direction": "both_bad", "amber": 1, "red": 2}, "red"),
        (0.5, {"direction": "both_bad", "amber": 1, "red": 2}, "green"),
        (5, {"direction": "high_bad", "amber": 3, "red": None}, "amber"),
        (5, {"direction": "high_bad", "amber": None, "red": None}, None),
        (None, {"direction": "high_bad", "amber": 3, "red": 4}, None),
        (5, None, None),
        (np.nan, {"direction": "high_bad", "amber": 3, "red": 4}, None),
    ],
)
def test_flags(value: float | None, thresholds: dict | None, expected: str | None) -> None:
    assert t.flag(value, thresholds) == expected


@pytest.mark.parametrize(
    ("transform", "params"),
    [
        ("rolling_mean", {"window": 7}),
        ("rolling_sum", {"window": 5}),
        ("monotony", {"window": 7}),
        ("ewma", {"span": 7, "min_periods": 4}),
        ("acwr", {"acute": 3, "chronic": 9}),
        ("zscore", {"baseline": 10, "min_periods": 6, "smooth": 3}),
        ("pct_change", {"baseline": 10, "min_periods": 6}),
    ],
)
def test_shortfall_matches_the_transform(transform: str, params: dict) -> None:
    """Wherever a day has data, the transform is null exactly when shortfall names a requirement
    (or the value is undefined for another reason, which these varying inputs avoid)."""
    values = [NAN if n % 4 == 3 else 50 + (n * 7) % 11 for n in range(30)]
    sources = ["a" if n < 16 else "b" for n in range(30)]
    x, src = series(values, sources)
    out = t.apply(transform, params, x, src)
    for i in range(len(values)):
        if math.isnan(values[i]):
            continue
        gap = t.shortfall(transform, params, x, src, i)
        assert (gap is not None) == bool(pd.isna(out.iloc[i])), (transform, i, gap, out.iloc[i])
        if gap is not None:
            assert gap.have < gap.need


def test_shortfall_reports_baseline_before_smoothing() -> None:
    x, src = series([60.0] * 3 + [61.0, 59.0, 62.0], ["old"] * 3 + ["new"] * 3)
    params = {"baseline": 60, "min_periods": 21, "smooth": 7, "ln": True}
    # day 5 on the new device: 2 same-device baseline days of 21, though smoothing also falls short
    assert t.shortfall("zscore", params, x, src, 5) == t.Shortfall(have=2, need=21, window=60, same_source=True)
    x, src = series([60.0, 61.0, 59.0, NAN, NAN, 62.0])
    params = {"baseline": 60, "min_periods": 2, "smooth": 7}
    assert t.shortfall("zscore", params, x, src, 5) == t.Shortfall(have=4, need=5, window=7, same_source=True)
    assert t.shortfall("none", {}, x, src, 5) is None
