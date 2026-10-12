"""/orgs/{org_id}/athletes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import and_, func, or_, select

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep
from app.models import Athlete, AthleteGroup, Group
from app.permissions import current_membership_clause
from app.schemas.common import AthleteStatus, Limit, Offset, Page
from app.schemas.domain import AthleteCreate, AthleteOut, AthleteUpdate
from app.services.people import (
    PII_FIELDS,
    add_to_group,
    athlete_snapshot,
    athletes_out,
    code_taken,
    current_group_ids,
    escape_like,
    get_visible_athlete,
    leave_group,
    next_athlete_code,
)

router = APIRouter(prefix="/orgs/{org_id}/athletes", tags=["athletes"])


@router.get("", response_model=Page[AthleteOut])
def list_athletes(
    p: PrincipalDep,
    db: DbSession,
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    status_: Annotated[AthleteStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[AthleteOut]:
    query = select(Athlete).where(Athlete.org_id == p.org_id, p.visible_athletes_clause(Athlete.id))
    # without ?status, archived athletes are left out
    query = query.where(Athlete.status == status_ if status_ is not None else Athlete.status != "archived")
    if group_id is not None:
        group = db.get(Group, group_id)
        if group is None or group.org_id != p.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")
        groups = list(p.tree.descendants(group_id))
        query = query.where(
            Athlete.id.in_(
                select(AthleteGroup.athlete_id).where(
                    AthleteGroup.group_id.in_(groups), current_membership_clause(p.today)
                )
            )
        )
    if q:
        pattern = f"%{escape_like(q.strip())}%"
        full = func.concat(Athlete.first_name, " ", Athlete.last_name)
        preferred = func.concat(Athlete.preferred_name, " ", Athlete.last_name)
        pii_match = or_(
            Athlete.first_name.ilike(pattern),
            Athlete.last_name.ilike(pattern),
            Athlete.preferred_name.ilike(pattern),
            Athlete.email.ilike(pattern),
            full.ilike(pattern),
            preferred.ilike(pattern),
        )
        # Names and email only match where the caller may see them; code always matches.
        query = query.where(or_(Athlete.code.ilike(pattern), and_(p.identifiable_clause(Athlete.id), pii_match)))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    athletes = list(db.scalars(query.order_by(Athlete.code).limit(limit).offset(offset)))
    return Page[AthleteOut](items=athletes_out(db, p, athletes), total=total)


@router.post("", response_model=AthleteOut, status_code=status.HTTP_201_CREATED)
def create_athlete(body: AthleteCreate, p: PrincipalDep, db: DbSession) -> AthleteOut:
    group_ids = list(dict.fromkeys(body.group_ids))
    for gid in group_ids:
        group = db.get(Group, gid)
        if group is None or group.org_id != p.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"group {gid} not found")
    if not p.is_admin and (not p.is_staff or not group_ids or not all(p.can_write_group(g) for g in group_ids)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin, or staff with write on every listed group")
    code = body.code or next_athlete_code(db, p.org_id)
    if code_taken(db, p.org_id, code):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"athlete code {code!r} already exists")
    athlete = Athlete(
        org_id=p.org_id,
        code=code,
        first_name=body.first_name,
        last_name=body.last_name,
        preferred_name=body.preferred_name,
        email=str(body.email).lower() if body.email else None,
        date_of_birth=body.date_of_birth,
        sex=body.sex,
        position=body.position,
        timezone=body.timezone,
        status="active",
        attributes=body.attributes,
    )
    db.add(athlete)
    db.flush()
    for gid in group_ids:
        add_to_group(db, p.org_id, athlete.id, gid, p.today)
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="athlete.create",
        entity_type="athlete",
        entity_id=athlete.id,
        details={"after": athlete_snapshot(athlete), "group_ids": group_ids},
    )
    db.commit()
    return athletes_out(db, p, [athlete])[0]


@router.get("/{athlete_id}", response_model=AthleteOut)
def get_athlete(athlete_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> AthleteOut:
    athlete, _ = get_visible_athlete(db, p, athlete_id)
    return athletes_out(db, p, [athlete])[0]


@router.patch("/{athlete_id}", response_model=AthleteOut)
def update_athlete(athlete_id: uuid.UUID, body: AthleteUpdate, p: PrincipalDep, db: DbSession) -> AthleteOut:
    athlete, rights = get_visible_athlete(db, p, athlete_id)
    if not rights.write:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the athlete required")
    fields = body.model_dump(exclude_unset=True)
    if not rights.identifiable and any(k in fields for k in PII_FIELDS):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="identifiable fields are masked for you")
    for key in ("first_name", "last_name", "status", "code", "attributes"):
        if key in fields and fields[key] is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key} cannot be null")
    if fields.get("status") == "archived" and not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="only admins archive athletes")
    if "code" in fields and code_taken(db, p.org_id, fields["code"], exclude=athlete.id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"athlete code {fields['code']!r} already exists")
    before = athlete_snapshot(athlete)
    group_ids = fields.pop("group_ids", None)
    for key, value in fields.items():
        if key == "email" and value is not None:
            value = str(value).lower()
        setattr(athlete, key, value)
    group_changes: dict[str, list[uuid.UUID]] = {}
    if group_ids is not None:
        wanted = list(dict.fromkeys(group_ids))
        for gid in wanted:
            group = db.get(Group, gid)
            if group is None or group.org_id != p.org_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"group {gid} not found")
        current = current_group_ids(db, [athlete.id], p.today).get(athlete.id, [])
        to_add = [g for g in wanted if g not in current]
        to_remove = [g for g in current if g not in wanted]
        if not all(p.can_write_group(g) for g in to_add + to_remove):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to every changed group required")
        for gid in to_remove:
            leave_group(db, athlete.id, gid, p.today)
        for gid in to_add:
            add_to_group(db, p.org_id, athlete.id, gid, p.today)
        group_changes = {"added": to_add, "removed": to_remove}
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="athlete.update",
        entity_type="athlete",
        entity_id=athlete.id,
        details=audit.diff(before, athlete_snapshot(athlete)) | {"groups": group_changes},
    )
    db.commit()
    return athletes_out(db, p, [athlete])[0]


@router.delete("/{athlete_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_athlete(athlete_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    athlete, _ = get_visible_athlete(db, p, athlete_id)
    previous = athlete.status
    athlete.status = "archived"
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="athlete.archive",
        entity_type="athlete",
        entity_id=athlete.id,
        details={"before": {"status": previous}, "after": {"status": "archived"}},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
