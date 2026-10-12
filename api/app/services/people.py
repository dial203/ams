"""Groups, athletes, memberships and staff assignments."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Athlete, AthleteGroup, Group
from app.permissions import AthleteRights, Principal, current_membership_clause
from app.schemas.domain import AthleteOut
from app.schemas.identity import GroupOut

PII_FIELDS = ("first_name", "last_name", "preferred_name", "email", "date_of_birth")


def display_name(athlete: Athlete, identifiable: bool = True) -> str:
    if not identifiable:
        return athlete.code
    first = athlete.preferred_name or athlete.first_name
    return f"{first} {athlete.last_name}".strip()


def full_name(athlete: Athlete) -> str:
    return f"{athlete.first_name} {athlete.last_name}".strip()


def current_group_ids(db: Session, athlete_ids: Iterable[uuid.UUID], today: dt.date) -> dict[uuid.UUID, list[uuid.UUID]]:
    ids = list(athlete_ids)
    out: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not ids:
        return out
    rows = db.execute(
        select(AthleteGroup.athlete_id, AthleteGroup.group_id)
        .where(AthleteGroup.athlete_id.in_(ids), current_membership_clause(today))
        .order_by(AthleteGroup.joined_on, AthleteGroup.created_at)
    ).all()
    for aid, gid in rows:
        if gid not in out[aid]:
            out[aid].append(gid)
    return out


def athlete_out(athlete: Athlete, rights: AthleteRights | None, group_ids: list[uuid.UUID]) -> AthleteOut:
    identifiable = bool(rights and rights.identifiable)
    return AthleteOut(
        id=athlete.id,
        org_id=athlete.org_id,
        code=athlete.code,
        first_name=athlete.first_name if identifiable else None,
        last_name=athlete.last_name if identifiable else None,
        preferred_name=athlete.preferred_name if identifiable else None,
        email=athlete.email if identifiable else None,
        date_of_birth=athlete.date_of_birth if identifiable else None,
        display_name=display_name(athlete, identifiable),
        masked=not identifiable,
        sex=athlete.sex,  # type: ignore[arg-type]
        position=athlete.position,
        timezone=athlete.timezone,
        status=athlete.status,  # type: ignore[arg-type]
        attributes=athlete.attributes or {},
        group_ids=group_ids,
        user_id=athlete.user_id,
        ow_user_id=athlete.ow_user_id,
        created_at=athlete.created_at,
    )


def athletes_out(db: Session, p: Principal, athletes: list[Athlete]) -> list[AthleteOut]:
    rights = p.rights_for(a.id for a in athletes)
    groups = current_group_ids(db, [a.id for a in athletes], p.today)
    return [athlete_out(a, rights.get(a.id), groups.get(a.id, [])) for a in athletes]


def get_visible_athlete(db: Session, p: Principal, athlete_id: uuid.UUID) -> tuple[Athlete, AthleteRights]:
    """The athlete if the caller may see it, else 404."""
    athlete = db.get(Athlete, athlete_id)
    if athlete is None or athlete.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
    rights = p.rights(athlete.id)
    if rights is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
    return athlete, rights


def next_athlete_code(db: Session, org_id: uuid.UUID) -> str:
    codes = db.scalars(select(Athlete.code).where(Athlete.org_id == org_id, Athlete.code.op("~")(r"^A-\d+$"))).all()
    highest = max((int(c[2:]) for c in codes), default=0)
    return f"A-{highest + 1:04d}"


def code_taken(db: Session, org_id: uuid.UUID, code: str, exclude: uuid.UUID | None = None) -> bool:
    q = select(Athlete.id).where(Athlete.org_id == org_id, func.lower(Athlete.code) == code.lower())
    if exclude is not None:
        q = q.where(Athlete.id != exclude)
    return db.scalar(q.limit(1)) is not None


# ----------------------------------------------------------------------------- groups


def get_group_or_404(db: Session, p: Principal, group_id: uuid.UUID, *, for_read: bool = True) -> Group:
    group = db.get(Group, group_id)
    if group is None or group.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")
    if for_read:
        allowed = p.visible_group_ids_for_listing()
        if allowed is not None and group.id not in allowed:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")
    return group


def group_counts(db: Session, p: Principal, group_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not group_ids:
        return {}
    q = (
        select(AthleteGroup.group_id, func.count(func.distinct(AthleteGroup.athlete_id)))
        .join(Athlete, Athlete.id == AthleteGroup.athlete_id)
        .where(
            AthleteGroup.group_id.in_(group_ids),
            current_membership_clause(p.today),
            Athlete.status != "archived",
            p.visible_athletes_clause(AthleteGroup.athlete_id),
        )
        .group_by(AthleteGroup.group_id)
    )
    return {gid: int(n) for gid, n in db.execute(q).all()}


def group_out(group: Group, count: int) -> GroupOut:
    return GroupOut(
        id=group.id,
        org_id=group.org_id,
        parent_id=group.parent_id,
        name=group.name,
        kind=group.kind,  # type: ignore[arg-type]
        description=group.description,
        archived=group.archived,
        athlete_count=count,
        created_at=group.created_at,
    )


def groups_out(db: Session, p: Principal, groups: list[Group]) -> list[GroupOut]:
    counts = group_counts(db, p, [g.id for g in groups])
    return [group_out(g, counts.get(g.id, 0)) for g in groups]


def add_to_group(db: Session, org_id: uuid.UUID, athlete_id: uuid.UUID, group_id: uuid.UUID, joined_on: dt.date) -> bool:
    """Add a current membership unless one already exists. Returns True when added."""
    existing = db.scalar(
        select(AthleteGroup.id).where(
            AthleteGroup.athlete_id == athlete_id,
            AthleteGroup.group_id == group_id,
            AthleteGroup.left_on.is_(None),
        )
    )
    if existing is not None:
        return False
    db.add(AthleteGroup(org_id=org_id, athlete_id=athlete_id, group_id=group_id, joined_on=joined_on))
    return True


def leave_group(db: Session, athlete_id: uuid.UUID, group_id: uuid.UUID, left_on: dt.date) -> bool:
    rows = db.scalars(
        select(AthleteGroup).where(
            AthleteGroup.athlete_id == athlete_id,
            AthleteGroup.group_id == group_id,
            AthleteGroup.left_on.is_(None),
        )
    ).all()
    for r in rows:
        r.left_on = max(left_on, r.joined_on)
    return bool(rows)


def would_cycle(db: Session, org_id: uuid.UUID, group_id: uuid.UUID, new_parent: uuid.UUID | None) -> bool:
    cur = new_parent
    seen: set[uuid.UUID] = set()
    while cur is not None and cur not in seen:
        if cur == group_id:
            return True
        seen.add(cur)
        cur = db.scalar(select(Group.parent_id).where(Group.id == cur, Group.org_id == org_id))
    return False


def athlete_snapshot(a: Athlete) -> dict[str, Any]:
    return {
        "code": a.code,
        "first_name": a.first_name,
        "last_name": a.last_name,
        "preferred_name": a.preferred_name,
        "email": a.email,
        "date_of_birth": a.date_of_birth,
        "sex": a.sex,
        "position": a.position,
        "timezone": a.timezone,
        "status": a.status,
        "attributes": a.attributes,
    }


def escape_like(text: str) -> str:
    return re.sub(r"([\\%_])", r"\\\1", text)
