"""Celery tasks. Each task opens its own DB session; the functions are plain callables in tests."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from app.database import SessionLocal
from app.integrations.open_wearables.client import OpenWearablesClient
from app.integrations.open_wearables.errors import OpenWearablesError, OpenWearablesNotConfiguredError
from app.models import Athlete, Organization
from app.services import reminders, wearables
from app.worker import celery_app

log = logging.getLogger(__name__)


@celery_app.task(name="ams.refresh_athlete_wearables")
def refresh_athlete_wearables(
    athlete_id: str, days: int = 7, history: bool | None = None, check_connections: bool = False
) -> int:
    """Pull the last ``days`` days of OW summaries for one athlete into wearable_daily.

    ``history`` True copies ``settings.wearable_history_days`` instead; None does so when the athlete's
    history was never copied, or (``check_connections``) a provider was connected since the last copy.
    """
    db = SessionLocal()
    try:
        athlete = db.get(Athlete, uuid.UUID(str(athlete_id)))
        if athlete is None or athlete.ow_user_id is None:
            return 0
        org = db.get(Organization, athlete.org_id)
        assert org is not None
        with OpenWearablesClient.from_settings() as client:
            if history is None:
                last = athlete.wearable_history_at
                history = last is None or (
                    check_connections
                    and any(
                        c.created_at is not None and c.created_at > last
                        for c in client.list_connections(athlete.ow_user_id)
                    )
                )
            if history:
                updated = wearables.pull_history(db, client, athlete, org)
            else:
                updated = wearables.refresh_athlete(db, client, athlete, org, days)
        db.commit()
        log.info("refreshed %d wearable rows for athlete %s%s", updated, athlete_id, " (history)" if history else "")
        return updated
    except (OpenWearablesError, OpenWearablesNotConfiguredError) as exc:
        db.rollback()
        log.warning("wearable refresh for athlete %s failed: %s", athlete_id, exc)
        return 0
    finally:
        db.close()


@celery_app.task(name="ams.refresh_all_wearables")
def refresh_all_wearables(days: int = 7) -> int:
    """Nightly safety net: re-pull the last ``days`` days for every linked, non-archived athlete, and
    their full history when it was never copied or a provider was connected since."""
    db = SessionLocal()
    try:
        ids = db.scalars(select(Athlete.id).where(Athlete.ow_user_id.is_not(None), Athlete.status != "archived")).all()
    finally:
        db.close()
    for aid in ids:
        refresh_athlete_wearables.delay(str(aid), days, check_connections=True)
    return len(ids)


@celery_app.task(name="ams.send_due_reminders")
def send_due_reminders() -> int:
    """Push a reminder once per athlete/form/day for schedules with ``remind=true``."""
    db = SessionLocal()
    try:
        sent = reminders.send_due_reminders(db)
        db.commit()
        return sent
    finally:
        db.close()


@celery_app.task(name="ams.cleanup_uploads")
def cleanup_uploads() -> int:
    """Delete import uploads older than their 24 h retention."""
    from app.services.imports import cleanup_expired_uploads

    db = SessionLocal()
    try:
        removed = cleanup_expired_uploads(db)
        db.commit()
        return removed
    finally:
        db.close()
