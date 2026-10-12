"""Map Open Wearables daily summaries to AMS ``wearable_daily`` rows (long format).

Adding a metric: add it to ``WEARABLE_METRICS`` (key -> unit, label) and map it from the OW
summary field below; it then appears in series sources, the daily endpoint and metrics.

Source attribution: ``provider`` is OW's ingestion provider; ``device`` is OW's
``source.device_name`` (marketing name derived from the raw model string, so it is stable)
falling back to the raw ``source.device``. Baselines group days by ``provider/device``.

OW's recovery summaries are currently only produced for WHOOP, so ``hrv_rmssd_ms`` and
``resting_hr_bpm`` fall back to the nightly values from the sleep summary of the same day and
source when no recovery row exists (the recovery value wins when both exist).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from app.integrations.open_wearables.schemas import (
    OWActivitySummary,
    OWRecoverySummary,
    OWSleepSummary,
    OWSource,
    OWTimeSeriesSample,
)

WEARABLE_METRICS: dict[str, tuple[str, str]] = {
    "sleep_duration_min": ("min", "Sleep duration"),
    "sleep_efficiency_pct": ("%", "Sleep efficiency"),
    "sleep_deep_min": ("min", "Deep sleep"),
    "sleep_rem_min": ("min", "REM sleep"),
    "sleep_light_min": ("min", "Light sleep"),
    "sleep_awake_min": ("min", "Awake time in bed"),
    "time_in_bed_min": ("min", "Time in bed"),
    "sleep_hrv_rmssd_ms": ("ms", "Nightly HRV (RMSSD)"),
    "sleep_resting_hr_bpm": ("bpm", "Nightly resting HR"),
    "respiratory_rate": ("br/min", "Respiratory rate"),
    "hrv_rmssd_ms": ("ms", "HRV (RMSSD)"),
    "resting_hr_bpm": ("bpm", "Resting heart rate"),
    "recovery_score": ("score", "Recovery score"),
    "steps": ("steps", "Steps"),
    "active_energy_kcal": ("kcal", "Active energy"),
    "distance_m": ("m", "Distance"),
    "active_min": ("min", "Active minutes"),
    "moderate_min": ("min", "Moderate intensity minutes"),
    "vigorous_min": ("min", "Vigorous intensity minutes"),
    "weight_kg": ("kg", "Body weight"),
    "body_fat_pct": ("%", "Body fat"),
}


@dataclass(frozen=True)
class DailyPoint:
    local_date: dt.date
    metric: str
    value: float
    provider: str
    device: str | None

    @property
    def unit(self) -> str:
        return WEARABLE_METRICS[self.metric][0]

    @property
    def key(self) -> tuple[dt.date, str, str]:
        return (self.local_date, self.metric, self.provider)


def source_device(source: OWSource | None) -> str | None:
    if source is None:
        return None
    return source.device_name or source.device or None


def _point(day: dt.date, metric: str, value: float | int | None, source: OWSource) -> DailyPoint | None:
    if value is None:
        return None
    return DailyPoint(day, metric, float(value), source.provider, source_device(source))


def map_sleep(rows: list[OWSleepSummary]) -> list[DailyPoint]:
    out: list[DailyPoint | None] = []
    for r in rows:
        stages = r.stages
        out += [
            _point(r.date, "sleep_duration_min", r.duration_minutes, r.source),
            _point(r.date, "time_in_bed_min", r.time_in_bed_minutes, r.source),
            _point(r.date, "sleep_efficiency_pct", r.efficiency_percent, r.source),
            _point(r.date, "sleep_deep_min", stages.deep_minutes if stages else None, r.source),
            _point(r.date, "sleep_rem_min", stages.rem_minutes if stages else None, r.source),
            _point(r.date, "sleep_light_min", stages.light_minutes if stages else None, r.source),
            _point(r.date, "sleep_awake_min", stages.awake_minutes if stages else None, r.source),
            _point(r.date, "sleep_hrv_rmssd_ms", r.avg_hrv_rmssd_ms, r.source),
            _point(r.date, "sleep_resting_hr_bpm", r.resting_heart_rate_bpm, r.source),
            _point(r.date, "respiratory_rate", r.avg_respiratory_rate, r.source),
        ]
    return [p for p in out if p is not None]


def map_recovery(rows: list[OWRecoverySummary]) -> list[DailyPoint]:
    out: list[DailyPoint | None] = []
    for r in rows:
        out += [
            _point(r.date, "hrv_rmssd_ms", r.avg_hrv_rmssd_ms, r.source),
            _point(r.date, "resting_hr_bpm", r.resting_heart_rate_bpm, r.source),
            _point(r.date, "recovery_score", r.recovery_score, r.source),
        ]
    return [p for p in out if p is not None]


def map_activity(rows: list[OWActivitySummary]) -> list[DailyPoint]:
    out: list[DailyPoint | None] = []
    for r in rows:
        im = r.intensity_minutes
        out += [
            _point(r.date, "steps", r.steps, r.source),
            _point(r.date, "active_energy_kcal", r.active_calories_kcal, r.source),
            _point(r.date, "distance_m", r.distance_meters, r.source),
            _point(r.date, "active_min", r.active_minutes, r.source),
            _point(r.date, "moderate_min", im.moderate if im else None, r.source),
            _point(r.date, "vigorous_min", im.vigorous if im else None, r.source),
        ]
    return [p for p in out if p is not None]


def _sample_local_date(sample: OWTimeSeriesSample, tz: ZoneInfo) -> dt.date:
    ts = sample.timestamp if sample.timestamp.tzinfo else sample.timestamp.replace(tzinfo=dt.UTC)
    if sample.zone_offset:
        sign = -1 if sample.zone_offset.startswith("-") else 1
        hh, mm = sample.zone_offset[1:].split(":")
        offset = dt.timezone(sign * dt.timedelta(hours=int(hh), minutes=int(mm)))
        return ts.astimezone(offset).date()
    return ts.astimezone(tz).date()


def map_body(samples: list[OWTimeSeriesSample], tz: ZoneInfo) -> list[DailyPoint]:
    """Last weight / body-fat sample per local day and provider."""
    metric_for = {"weight": "weight_kg", "body_fat_percentage": "body_fat_pct"}
    latest: dict[tuple[dt.date, str, str], tuple[dt.datetime, DailyPoint]] = {}
    for s in samples:
        metric = metric_for.get(s.type)
        if metric is None or s.source is None:
            continue
        day = _sample_local_date(s, tz)
        point = DailyPoint(day, metric, float(s.value), s.source.provider, source_device(s.source))
        key = point.key
        if key not in latest or s.timestamp >= latest[key][0]:
            latest[key] = (s.timestamp, point)
    return [p for _, p in latest.values()]


def with_fallbacks(points: list[DailyPoint]) -> list[DailyPoint]:
    """Fill hrv_rmssd_ms / resting_hr_bpm from the sleep summary where recovery has nothing that day."""
    have = {(p.local_date, p.metric) for p in points}
    extra: list[DailyPoint] = []
    for p in points:
        target = {"sleep_hrv_rmssd_ms": "hrv_rmssd_ms", "sleep_resting_hr_bpm": "resting_hr_bpm"}.get(p.metric)
        if target and (p.local_date, target) not in have:
            extra.append(DailyPoint(p.local_date, target, p.value, p.provider, p.device))
            have.add((p.local_date, target))
    return points + extra


def dedupe(points: list[DailyPoint]) -> list[DailyPoint]:
    """One point per (date, metric, provider); the later one in the list wins."""
    out: dict[tuple[dt.date, str, str], DailyPoint] = {}
    for p in points:
        out[p.key] = p
    return list(out.values())


def build_daily_points(
    sleep: list[OWSleepSummary],
    recovery: list[OWRecoverySummary],
    activity: list[OWActivitySummary],
    body: list[OWTimeSeriesSample],
    tz: ZoneInfo,
) -> list[DailyPoint]:
    points = map_sleep(sleep) + map_recovery(recovery) + map_activity(activity) + map_body(body, tz)
    return dedupe(with_fallbacks(points))
