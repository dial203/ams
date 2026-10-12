"""Built-in metric definitions seeded into every new organization (editable, not deletable).

Threshold choices (starting points; every org can edit them):

* ``wellness_hooper``: sum of four 1-7 items (4 = best, 28 = worst). Amber from 18 (item mean 4.5,
  past the scale midpoint), red from 22 (item mean 5.5). Fixed cut-offs are crude; individual
  baselines are preferable once enough history exists.
* ``hrv_z``: 7-day rolling mean of ln RMSSD against a 60-day same-device baseline (Plews et al.
  2013). Amber at -0.5 (the 0.5 x SD "smallest worthwhile change" convention), red at -1.0. The
  7-day mean varies less than single days, so -1.0 is a large deviation.
* ``rhr_z``: daily resting HR against a 28-day same-device baseline; amber +1 SD, red +2 SD.
* ``sleep_duration``: amber under 7 h (420 min), red under 6 h (360 min).
* ``acwr``: thresholds off on purpose (see description).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MetricDefinition, Organization

ACWR_DESCRIPTION = (
    "Acute:chronic workload ratio of daily sRPE load: 7-day acute EWMA divided by a 28-day chronic EWMA "
    "taken from before the acute window (uncoupled; Williams et al. 2017 EWMA with lambda = 2/(N+1)). "
    "Interpret with care: the ratio suffers from mathematical coupling and ratio-scaling problems "
    "(Lolli et al. 2019; Impellizzeri et al. 2020) and is not a validated injury predictor, so no "
    "thresholds are set by default."
)

BUILTIN_METRICS: list[dict[str, Any]] = [
    {
        "slug": "wellness_hooper",
        "name": "Wellness (Hooper index)",
        "description": "Daily Hooper index: sleep quality, fatigue, stress and soreness, each 1-7 (Hooper & Mackinnon "
        "1995). Higher is worse.",
        "unit": "AU",
        "source": "form:wellness_hooper.hooper_total",
        "daily_agg": "last",
        "fill_zero": False,
        "transform": "none",
        "params": {},
        "thresholds": {"direction": "high_bad", "amber": 18, "red": 22},
        "decimals": 0,
        "athlete_visible": True,
    },
    {
        "slug": "srpe_load",
        "name": "Session load (sRPE)",
        "description": "Daily sum of session RPE x duration (Foster et al. 2001). Days without a session count as 0 "
        "from the athlete's first logged session.",
        "unit": "AU",
        "source": "form:session_rpe.srpe",
        "daily_agg": "sum",
        "fill_zero": True,
        "transform": "none",
        "params": {},
        "thresholds": None,
        "decimals": 0,
        "athlete_visible": True,
    },
    {
        "slug": "acute_load_7d",
        "name": "Acute load (7 d)",
        "description": "Rolling 7-day sum of daily sRPE load.",
        "unit": "AU",
        "source": "metric:srpe_load",
        "daily_agg": "sum",
        "fill_zero": False,
        "transform": "rolling_sum",
        "params": {"window": 7},
        "thresholds": None,
        "decimals": 0,
        "athlete_visible": False,
    },
    {
        "slug": "chronic_load_28d",
        "name": "Chronic load (28 d mean)",
        "description": "Rolling 28-day mean of daily sRPE load.",
        "unit": "AU",
        "source": "metric:srpe_load",
        "daily_agg": "sum",
        "fill_zero": False,
        "transform": "rolling_mean",
        "params": {"window": 28},
        "thresholds": None,
        "decimals": 0,
        "athlete_visible": False,
    },
    {
        "slug": "acwr",
        "name": "ACWR (EWMA, uncoupled)",
        "description": ACWR_DESCRIPTION,
        "unit": None,
        "source": "metric:srpe_load",
        "daily_agg": "sum",
        "fill_zero": False,
        "transform": "acwr",
        "params": {"acute": 7, "chronic": 28, "method": "ewma", "coupled": False},
        "thresholds": None,
        "decimals": 2,
        "athlete_visible": False,
    },
    {
        "slug": "monotony_7d",
        "name": "Training monotony (7 d)",
        "description": "Mean / SD of daily sRPE load over 7 days (Foster 1998).",
        "unit": None,
        "source": "metric:srpe_load",
        "daily_agg": "sum",
        "fill_zero": False,
        "transform": "monotony",
        "params": {"window": 7},
        "thresholds": None,
        "decimals": 2,
        "athlete_visible": False,
    },
    {
        "slug": "strain_7d",
        "name": "Training strain (7 d)",
        "description": "Weekly sRPE load x monotony (Foster 1998).",
        "unit": "AU",
        "source": "metric:srpe_load",
        "daily_agg": "sum",
        "fill_zero": False,
        "transform": "strain",
        "params": {"window": 7},
        "thresholds": None,
        "decimals": 0,
        "athlete_visible": False,
    },
    {
        "slug": "hrv_z",
        "name": "HRV (ln RMSSD 7-d mean, z)",
        "description": "7-day rolling mean of ln RMSSD as a z-score against the previous 60 days from the same "
        "device (Plews et al. 2013). Needs 21 baseline days; a device change restarts the baseline.",
        "unit": "z",
        "source": "wearable:hrv_rmssd_ms",
        "daily_agg": "last",
        "fill_zero": False,
        "transform": "zscore",
        "params": {"ln": True, "smooth": 7, "baseline": 60, "min_periods": 21},
        "thresholds": {"direction": "low_bad", "amber": -0.5, "red": -1.0},
        "decimals": 2,
        "athlete_visible": False,
    },
    {
        "slug": "rhr_z",
        "name": "Resting HR (z)",
        "description": "Resting heart rate as a z-score against the previous 28 days from the same device.",
        "unit": "z",
        "source": "wearable:resting_hr_bpm",
        "daily_agg": "last",
        "fill_zero": False,
        "transform": "zscore",
        "params": {"baseline": 28},
        "thresholds": {"direction": "high_bad", "amber": 1, "red": 2},
        "decimals": 2,
        "athlete_visible": False,
    },
    {
        "slug": "sleep_duration",
        "name": "Sleep duration",
        "description": "Total sleep time from the athlete's wearable (main sleep, naps excluded).",
        "unit": "min",
        "source": "wearable:sleep_duration_min",
        "daily_agg": "last",
        "fill_zero": False,
        "transform": "none",
        "params": {},
        "thresholds": {"direction": "low_bad", "amber": 420, "red": 360},
        "decimals": 0,
        "athlete_visible": True,
    },
]


def seed_builtin_metrics(db: Session, org: Organization) -> list[MetricDefinition]:
    existing = set(db.scalars(select(MetricDefinition.slug).where(MetricDefinition.org_id == org.id)))
    created: list[MetricDefinition] = []
    for spec in BUILTIN_METRICS:
        if spec["slug"] in existing:
            continue
        m = MetricDefinition(org_id=org.id, builtin=True, **spec)
        db.add(m)
        created.append(m)
    db.flush()
    return created
