"""Due-form computation (athlete-local) and Expo push reminders."""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Athlete,
    AthleteGroup,
    Form,
    FormSchedule,
    Organization,
    PushToken,
    ReminderSent,
    Submission,
)
from app.permissions import GroupTree, current_membership_clause, load_group_tree
from app.services.forms import schedule_applies
from app.timeutil import utcnow, zone

log = logging.getLogger(__name__)


def athlete_schedule_groups(db: Session, athlete_id: uuid.UUID, tree: GroupTree, day: dt.date) -> set[uuid.UUID]:
    """Groups whose schedules apply to the athlete: current groups and all their ancestors."""
    own = set(
        db.scalars(
            select(AthleteGroup.group_id).where(AthleteGroup.athlete_id == athlete_id, current_membership_clause(day))
        )
    )
    return tree.with_ancestors(own)


def schedules_for(db: Session, org_id: uuid.UUID, group_ids: set[uuid.UUID], day: dt.date) -> list[FormSchedule]:
    if not group_ids:
        return []
    rows = db.scalars(
        select(FormSchedule).where(
            FormSchedule.org_id == org_id, FormSchedule.group_id.in_(list(group_ids)), FormSchedule.active.is_(True)
        )
    ).all()
    return [s for s in rows if schedule_applies(s, day)]


def due_today(
    db: Session, org_id: uuid.UUID, athlete_id: uuid.UUID, day: dt.date, tree: GroupTree | None = None
) -> dict[uuid.UUID, str]:
    """form_id -> earliest due_time for forms scheduled for the athlete on ``day``."""
    tree = tree or load_group_tree(db, org_id)
    out: dict[uuid.UUID, str] = {}
    for s in schedules_for(db, org_id, athlete_schedule_groups(db, athlete_id, tree, day), day):
        if s.form_id not in out or s.due_time < out[s.form_id]:
            out[s.form_id] = s.due_time
    return out


def completed_forms(db: Session, athlete_id: uuid.UUID, form_ids: list[uuid.UUID], day: dt.date) -> set[uuid.UUID]:
    if not form_ids:
        return set()
    return set(
        db.scalars(
            select(Submission.form_id).where(
                Submission.athlete_id == athlete_id,
                Submission.form_id.in_(form_ids),
                Submission.local_date == day,
                Submission.deleted_at.is_(None),
            )
        )
    )


def count_due_open(db: Session, org: Organization, athlete_id: uuid.UUID, day: dt.date, tree: GroupTree) -> int:
    due = due_today(db, org.id, athlete_id, day, tree)
    if not due:
        return 0
    live = set(
        db.scalars(
            select(Form.id).where(
                Form.id.in_(list(due)), Form.archived.is_(False), Form.current_version_id.is_not(None)
            )
        )
    )
    return len(live - completed_forms(db, athlete_id, list(live), day))


@dataclass
class Reminder:
    org_id: uuid.UUID
    athlete: Athlete
    form: Form
    local_date: dt.date


def pending_reminders(db: Session, now: dt.datetime | None = None) -> list[Reminder]:
    now = now or utcnow()
    lead = dt.timedelta(minutes=settings.reminder_lead_minutes)
    out: list[Reminder] = []
    schedules = db.scalars(
        select(FormSchedule).where(FormSchedule.active.is_(True), FormSchedule.remind.is_(True))
    ).all()
    by_org: dict[uuid.UUID, list[FormSchedule]] = defaultdict(list)
    for s in schedules:
        by_org[s.org_id].append(s)
    for org_id, org_schedules in by_org.items():
        org = db.get(Organization, org_id)
        if org is None:
            continue
        tree = load_group_tree(db, org_id)
        seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
        for s in org_schedules:
            form = db.get(Form, s.form_id)
            if form is None or form.archived or form.current_version_id is None or not form.athlete_can_submit:
                continue
            groups = list(tree.descendants(s.group_id))
            org_today = now.astimezone(zone(org.timezone)).date()
            athletes = db.scalars(
                select(Athlete).where(
                    Athlete.org_id == org_id,
                    Athlete.status == "active",
                    Athlete.user_id.is_not(None),
                    Athlete.id.in_(
                        select(AthleteGroup.athlete_id).where(
                            AthleteGroup.group_id.in_(groups), current_membership_clause(org_today)
                        )
                    ),
                )
            ).all()
            for athlete in athletes:
                if (athlete.id, form.id) in seen:
                    continue
                tz = zone(athlete.timezone, org.timezone)
                local_now = now.astimezone(tz)
                day = local_now.date()
                if not schedule_applies(s, day):
                    continue
                hh, mm = (int(x) for x in s.due_time.split(":"))
                due_at = dt.datetime.combine(day, dt.time(hh, mm), tzinfo=tz)
                if local_now < due_at - lead:
                    continue
                if completed_forms(db, athlete.id, [form.id], day):
                    continue
                already = db.scalar(
                    select(ReminderSent.id).where(
                        ReminderSent.athlete_id == athlete.id,
                        ReminderSent.form_id == form.id,
                        ReminderSent.local_date == day,
                    )
                )
                if already is not None:
                    continue
                seen.add((athlete.id, form.id))
                out.append(Reminder(org_id, athlete, form, day))
    return out


def _push(messages: list[dict[str, object]]) -> list[dict[str, object]]:
    resp = httpx.post(
        settings.expo_push_url,
        json=messages,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        timeout=10.0,
    )
    resp.raise_for_status()
    data = resp.json().get("data", [])
    return data if isinstance(data, list) else []


def send_due_reminders(db: Session, now: dt.datetime | None = None) -> int:
    """Send pending reminders. Returns the number of (athlete, form, day) reminders recorded."""
    reminders = pending_reminders(db, now)
    if not reminders:
        return 0
    if not settings.expo_push_enabled:
        for r in reminders:
            log.info("reminder (push disabled): athlete %s form %s on %s", r.athlete.id, r.form.slug, r.local_date)
        return 0
    sent = 0
    for r in reminders:
        tokens = db.scalars(select(PushToken).where(PushToken.user_id == r.athlete.user_id)).all()
        if not tokens:
            continue
        messages: list[dict[str, object]] = [
            {
                "to": t.token,
                "title": r.form.name,
                "body": f"{r.form.name} is due today.",
                "sound": "default",
                "data": {"org_id": str(r.org_id), "form_id": str(r.form.id), "local_date": r.local_date.isoformat()},
            }
            for t in tokens
        ]
        try:
            tickets = _push(messages)
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("expo push failed for athlete %s: %s", r.athlete.id, exc)
            continue
        for token, ticket in zip(tokens, tickets, strict=False):
            details = ticket.get("details") if isinstance(ticket, dict) else None
            if isinstance(details, dict) and details.get("error") == "DeviceNotRegistered":
                db.execute(delete(PushToken).where(PushToken.id == token.id))
        db.execute(
            insert(ReminderSent)
            .values(
                id=uuid.uuid4(),
                org_id=r.org_id,
                athlete_id=r.athlete.id,
                form_id=r.form.id,
                local_date=r.local_date,
                sent_at=utcnow(),
            )
            .on_conflict_do_nothing(index_elements=["athlete_id", "form_id", "local_date"])
        )
        sent += 1
    return sent
