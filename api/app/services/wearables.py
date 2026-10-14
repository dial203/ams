"""Linking athletes to Open Wearables, connections, SDK tokens and the ``wearable_daily`` cache."""

from __future__ import annotations

import datetime as dt
import logging
import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations.open_wearables.client import OpenWearablesClient
from app.integrations.open_wearables.daily import (
    WEARABLE_METRICS,
    DailyPoint,
    build_daily_points,
    provider_order,
    provider_rank,
)
from app.integrations.open_wearables.errors import OpenWearablesConflictError, OpenWearablesNotConfiguredError
from app.models import Athlete, Organization, WearableDaily
from app.schemas.domain import (
    SdkTokenResponse,
    WearableConnectionOut,
    WearableDailyPoint,
    WearableProviderOut,
    WearableStatus,
)
from app.timeutil import today_in, utcnow, zone

log = logging.getLogger(__name__)


def link_athlete(db: Session, client: OpenWearablesClient, athlete: Athlete) -> uuid.UUID:
    """Idempotent: reuse athlete.ow_user_id, else an OW user with external_user_id = athlete id, else create."""
    if athlete.ow_user_id is not None:
        return athlete.ow_user_id
    external = str(athlete.id)
    user = client.find_user_by_external_id(external)
    if user is None:
        try:
            user = client.create_user(
                external_user_id=external,
                first_name=athlete.first_name,
                last_name=athlete.last_name,
                email=athlete.email,
            )
        except OpenWearablesConflictError:
            # OW enforces unique emails across its users; link without the email instead of
            # attaching this athlete to someone else's OW user.
            log.info("OW user email conflict for athlete %s; creating without email", athlete.id)
            user = client.create_user(
                external_user_id=external, first_name=athlete.first_name, last_name=athlete.last_name
            )
    athlete.ow_user_id = user.id
    db.flush()
    return user.id


def athlete_provider_order(athlete: Athlete, org: Organization) -> list[str]:
    from app.services.orgs import org_settings

    return provider_order(athlete.wearable_priority, org_settings(org).wearable_priority)


def wearable_status(
    db: Session, client: OpenWearablesClient | None, athlete: Athlete, org: Organization
) -> WearableStatus:
    order = athlete_provider_order(athlete, org)
    have = db.scalars(select(WearableDaily.provider).where(WearableDaily.athlete_id == athlete.id).distinct()).all()
    common = {
        "priority": athlete.wearable_priority,
        "effective_priority": order,
        "sources": sorted(have, key=lambda p: provider_rank(order, p)),
        "history_synced_at": athlete.wearable_history_at,
    }
    if athlete.ow_user_id is None or client is None:
        return WearableStatus(
            linked=athlete.ow_user_id is not None, ow_user_id=athlete.ow_user_id, connections=[], **common
        )
    connections = client.list_connections(athlete.ow_user_id)
    return WearableStatus(
        linked=True,
        ow_user_id=athlete.ow_user_id,
        **common,
        connections=[
            WearableConnectionOut(
                connection_id=c.id,
                provider=c.provider,
                status=c.status,
                account_type=c.account_type,
                account_label=c.account_label,
                last_synced_at=c.last_synced_at,
                created_at=c.created_at,
                devices=list(c.observed_devices) or ([c.device_label] if c.device_label else []),
            )
            for c in connections
        ],
    )


def _absolute_icon(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith(("http://", "https://")):
        return url
    base = settings.ow_public_url
    return f"{base}{url if url.startswith('/') else '/' + url}" if base else url


def providers(client: OpenWearablesClient) -> list[WearableProviderOut]:
    return [
        WearableProviderOut(
            provider=p.provider,
            name=p.name,
            enabled=p.is_enabled,
            kind="cloud" if p.has_cloud_api else "sdk",
            icon_url=_absolute_icon(p.icon_url),
        )
        for p in client.list_providers(enabled_only=True)
    ]


def sdk_token(db: Session, client: OpenWearablesClient, athlete: Athlete) -> SdkTokenResponse:
    if not settings.ow_sdk_configured:
        raise OpenWearablesNotConfiguredError("OW_APP_ID / OW_APP_SECRET are not configured")
    ow_user_id = link_athlete(db, client, athlete)
    token = client.create_sdk_token(ow_user_id)
    return SdkTokenResponse(
        access_token=token.access_token,
        refresh_token=token.refresh_token or "",
        expires_in=token.expires_in or 3600,
        ow_base_url=settings.ow_public_url or "",
        ow_user_id=ow_user_id,
    )


def store_points(
    db: Session,
    athlete: Athlete,
    points: list[DailyPoint],
    start: dt.date,
    end: dt.date,
) -> int:
    """Replace the athlete's rows in [start, end] with ``points`` (upsert, then drop superseded rows)."""
    keys = {(p.local_date, p.metric, p.provider) for p in points}
    existing = db.execute(
        select(WearableDaily.id, WearableDaily.local_date, WearableDaily.metric, WearableDaily.provider).where(
            WearableDaily.athlete_id == athlete.id,
            WearableDaily.local_date >= start,
            WearableDaily.local_date <= end,
        )
    ).all()
    stale = [row.id for row in existing if (row.local_date, row.metric, row.provider) not in keys]
    if stale:
        db.execute(delete(WearableDaily).where(WearableDaily.id.in_(stale)))
    now = utcnow()
    for chunk_start in range(0, len(points), 500):
        chunk = points[chunk_start : chunk_start + 500]
        stmt = insert(WearableDaily).values(
            [
                {
                    "id": uuid.uuid4(),
                    "org_id": athlete.org_id,
                    "athlete_id": athlete.id,
                    "local_date": p.local_date,
                    "metric": p.metric,
                    "value": p.value,
                    "unit": p.unit,
                    "provider": p.provider,
                    "device": p.device,
                    "updated_at": now,
                }
                for p in chunk
            ]
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["athlete_id", "local_date", "metric", "provider"],
            set_={
                "value": stmt.excluded.value,
                "unit": stmt.excluded.unit,
                "device": stmt.excluded.device,
                "updated_at": stmt.excluded.updated_at,
            },
        )
        db.execute(stmt)
    return len(points)


def refresh_athlete(
    db: Session, client: OpenWearablesClient, athlete: Athlete, org: Organization, days: int = 7
) -> int:
    """Pull the last ``days`` days of OW summaries into ``wearable_daily``. Returns rows upserted."""
    if athlete.ow_user_id is None:
        return 0
    tz_name = athlete.timezone or org.timezone
    end = today_in(tz_name)
    start = end - dt.timedelta(days=max(days, 1) - 1)
    uid = athlete.ow_user_id
    sleep = client.sleep_summaries(uid, start, end)
    recovery = client.recovery_summaries(uid, start, end)
    activity = client.activity_summaries(uid, start, end)
    body = client.body_samples(uid, start, end)
    points = [
        p for p in build_daily_points(sleep, recovery, activity, body, zone(tz_name)) if start <= p.local_date <= end
    ]
    return store_points(db, athlete, points, start, end)


def pull_history(db: Session, client: OpenWearablesClient, athlete: Athlete, org: Organization) -> int:
    """Copy ``settings.wearable_history_days`` of Open Wearables data and record when."""
    updated = refresh_athlete(db, client, athlete, org, settings.wearable_history_days)
    athlete.wearable_history_at = utcnow()
    return updated


def daily_points(
    db: Session,
    athlete: Athlete,
    org: Organization,
    start: dt.date,
    end: dt.date,
    metrics: list[str] | None,
    all_sources: bool = False,
) -> list[WearableDailyPoint]:
    """One point per day and metric from the best-ranked provider, or every provider's."""
    q = select(WearableDaily).where(
        WearableDaily.athlete_id == athlete.id, WearableDaily.local_date >= start, WearableDaily.local_date <= end
    )
    if metrics:
        q = q.where(WearableDaily.metric.in_(metrics))
    rows = list(db.scalars(q.order_by(WearableDaily.local_date, WearableDaily.metric, WearableDaily.provider)))
    if not all_sources:
        order = athlete_provider_order(athlete, org)
        best: dict[tuple[dt.date, str], WearableDaily] = {}
        for r in rows:
            cur = best.get((r.local_date, r.metric))
            if cur is None or provider_rank(order, r.provider) < provider_rank(order, cur.provider):
                best[(r.local_date, r.metric)] = r
        rows = [r for r in rows if best[(r.local_date, r.metric)] is r]
    return [
        WearableDailyPoint(
            local_date=r.local_date, metric=r.metric, value=r.value, unit=r.unit, provider=r.provider, device=r.device
        )
        for r in rows
    ]


def known_metric(name: str) -> bool:
    return name in WEARABLE_METRICS
