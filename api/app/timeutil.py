"""Time zone helpers: athlete-local calendar days."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def is_valid_timezone(name: str | None) -> bool:
    if not name:
        return False
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def zone(name: str | None, fallback: str = "UTC") -> ZoneInfo:
    for candidate in (name, fallback, "UTC"):
        if candidate and is_valid_timezone(candidate):
            return ZoneInfo(candidate)
    return ZoneInfo("UTC")


def local_date(moment: dt.datetime, tz_name: str | None, fallback: str = "UTC") -> dt.date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.UTC)
    return moment.astimezone(zone(tz_name, fallback)).date()


def today_in(tz_name: str | None, fallback: str = "UTC") -> dt.date:
    return local_date(utcnow(), tz_name, fallback)


def local_noon(day: dt.date, tz_name: str | None, fallback: str = "UTC") -> dt.datetime:
    """A representative instant for a calendar day without a time (12:00 local)."""
    return dt.datetime.combine(day, dt.time(12, 0), tzinfo=zone(tz_name, fallback))


def ensure_aware(moment: dt.datetime, tz_name: str | None = None, fallback: str = "UTC") -> dt.datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=zone(tz_name, fallback))
    return moment
