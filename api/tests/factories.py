"""Builders for test data (direct DB access through the services)."""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import (
    Athlete,
    AthleteGroup,
    Form,
    Group,
    Organization,
    StaffAssignment,
    Submission,
    User,
    WearableDaily,
)
from app.security import create_access_token
from app.services.forms import install_template, publish
from app.services.orgs import add_member, create_org, create_user
from app.services.submissions import create_submission
from app.templates import TEMPLATES

PASSWORD = "correct-horse-battery"


def headers_for(user: User) -> dict[str, str]:
    token, _ = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


@dataclass
class Actor:
    user: User
    headers: dict[str, str]

    @property
    def id(self) -> uuid.UUID:
        return self.user.id


def org(db: Session, name: str = "Test Org", timezone: str = "UTC") -> Organization:
    o = create_org(db, name, timezone)
    db.commit()
    return o


def member(db: Session, o: Organization, role: str, email: str | None = None, name: str = "Person") -> Actor:
    email = email or f"{role}-{uuid.uuid4().hex[:8]}@example.com"
    u = create_user(db, email, PASSWORD, name)
    add_member(db, o, u, role)
    db.commit()
    return Actor(u, headers_for(u))


def group(db: Session, o: Organization, name: str, parent: Group | None = None, kind: str = "team") -> Group:
    g = Group(org_id=o.id, name=name, kind=kind, parent_id=parent.id if parent else None)
    db.add(g)
    db.commit()
    return g


def athlete(
    db: Session,
    o: Organization,
    first: str = "Alex",
    last: str = "Runner",
    code: str | None = None,
    groups: tuple[Group, ...] = (),
    email: str | None = None,
    joined_on: dt.date | None = None,
    timezone: str | None = None,
    attributes: dict[str, Any] | None = None,
    position: str | None = None,
) -> Athlete:
    a = Athlete(
        org_id=o.id,
        code=code or f"T-{uuid.uuid4().hex[:6].upper()}",
        first_name=first,
        last_name=last,
        email=email,
        timezone=timezone,
        attributes=attributes or {},
        status="active",
        position=position,
    )
    db.add(a)
    db.flush()
    for g in groups:
        db.add(
            AthleteGroup(
                org_id=o.id, athlete_id=a.id, group_id=g.id, joined_on=joined_on or dt.date(2020, 1, 1)
            )
        )
    db.commit()
    return a


def assign(
    db: Session, actor: Actor, g: Group, access_role: str, identifiable: bool = True
) -> StaffAssignment:
    a = StaffAssignment(
        org_id=g.org_id, user_id=actor.id, group_id=g.id, access_role=access_role, can_view_identifiable=identifiable
    )
    db.add(a)
    db.commit()
    return a


def template_form(db: Session, o: Organization, key: str, slug: str | None = None) -> Form:
    f = install_template(db, o, TEMPLATES[key], None, slug=slug)
    db.commit()
    return f


def form(
    db: Session,
    o: Organization,
    slug: str,
    schema: dict[str, Any],
    *,
    sensitivity: str = "general",
    kind: str = "questionnaire",
    multiple: bool = True,
    athlete_can_submit: bool = True,
    athlete_can_view: bool = True,
    published: bool = True,
) -> Form:
    f = Form(
        org_id=o.id,
        slug=slug,
        name=slug.replace("_", " ").title(),
        kind=kind,
        sensitivity=sensitivity,
        athlete_can_submit=athlete_can_submit,
        athlete_can_view=athlete_can_view,
        allow_multiple_per_day=multiple,
        draft_schema=schema,
    )
    db.add(f)
    db.flush()
    if published:
        publish(db, f, None)
    db.commit()
    return f


def simple_schema(*fields: dict[str, Any]) -> dict[str, Any]:
    return {"schema_version": 1, "sections": [{"key": "main", "title": "Main", "fields": list(fields)}]}


NUMBER_SCHEMA = simple_schema({"key": "value", "type": "number", "label": "Value", "required": True})


def submit(
    db: Session,
    o: Organization,
    f: Form,
    a: Athlete,
    values: dict[str, Any],
    day: dt.date,
    source: str = "web",
) -> Submission:
    s = create_submission(
        db,
        org=o,
        form=f,
        athlete=a,
        values=values,
        user_id=None,
        source=source,
        observed_at=dt.datetime.combine(day, dt.time(8, 0), tzinfo=dt.UTC),
        local_date=day,
    )
    db.commit()
    return s


def wearable(
    db: Session,
    a: Athlete,
    day: dt.date,
    metric: str,
    value: float,
    provider: str = "oura",
    device: str | None = "Oura Ring Gen3",
    unit: str = "ms",
) -> WearableDaily:
    w = WearableDaily(
        org_id=a.org_id,
        athlete_id=a.id,
        local_date=day,
        metric=metric,
        value=value,
        unit=unit,
        provider=provider,
        device=device,
    )
    db.add(w)
    db.commit()
    return w
