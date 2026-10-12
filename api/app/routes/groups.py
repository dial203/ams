"""/orgs/{org_id}/groups and staff assignments."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep
from app.models import Athlete, Group, OrgMembership, StaffAssignment
from app.schemas.identity import (
    GroupAthletesAdd,
    GroupCreate,
    GroupOut,
    GroupUpdate,
    StaffAssignmentCreate,
    StaffAssignmentOut,
)
from app.services.people import (
    add_to_group,
    get_group_or_404,
    groups_out,
    leave_group,
    would_cycle,
)

router = APIRouter(prefix="/orgs/{org_id}", tags=["groups"])


@router.get("/groups", response_model=list[GroupOut])
def list_groups(p: PrincipalDep, db: DbSession, include_archived: Annotated[bool, Query()] = False) -> list[GroupOut]:
    q = select(Group).where(Group.org_id == p.org_id)
    if not include_archived:
        q = q.where(Group.archived.is_(False))
    allowed = p.visible_group_ids_for_listing()
    if allowed is not None:
        q = q.where(Group.id.in_(list(allowed)))
    groups = list(db.scalars(q.order_by(Group.name)))
    return groups_out(db, p, groups)


def _check_parent(db: DbSession, p: AdminDep, parent_id: uuid.UUID | None) -> None:
    if parent_id is None:
        return
    parent = db.get(Group, parent_id)
    if parent is None or parent.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="parent group not found")


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(body: GroupCreate, p: AdminDep, db: DbSession) -> GroupOut:
    _check_parent(db, p, body.parent_id)
    group = Group(
        org_id=p.org_id, parent_id=body.parent_id, name=body.name, kind=body.kind, description=body.description
    )
    db.add(group)
    db.flush()
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="group.create",
        entity_type="group",
        entity_id=group.id,
        details={"name": group.name, "parent_id": group.parent_id},
    )
    db.commit()
    return groups_out(db, p, [group])[0]


@router.get("/groups/{group_id}", response_model=GroupOut)
def get_group(group_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> GroupOut:
    return groups_out(db, p, [get_group_or_404(db, p, group_id)])[0]


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(group_id: uuid.UUID, body: GroupUpdate, p: AdminDep, db: DbSession) -> GroupOut:
    group = get_group_or_404(db, p, group_id)
    fields = body.model_dump(exclude_unset=True)
    if "parent_id" in fields:
        _check_parent(db, p, body.parent_id)
        if would_cycle(db, p.org_id, group.id, body.parent_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="a group cannot be moved under itself")
    for key in ("name", "kind", "archived"):
        if key in fields and fields[key] is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key} cannot be null")
    before = {k: getattr(group, k) for k in fields}
    for key, value in fields.items():
        setattr(group, key, value)
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="group.update",
        entity_type="group",
        entity_id=group.id,
        details=audit.diff(before, fields),
    )
    db.commit()
    return groups_out(db, p, [group])[0]


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_group(group_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    group = get_group_or_404(db, p, group_id)
    group.archived = True
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="group.archive", entity_type="group", entity_id=group.id
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/groups/{group_id}/athletes", response_model=GroupOut)
def add_group_athletes(group_id: uuid.UUID, body: GroupAthletesAdd, p: PrincipalDep, db: DbSession) -> GroupOut:
    group = get_group_or_404(db, p, group_id)
    if not p.can_write_group(group.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the group required")
    ids = list(dict.fromkeys(body.athlete_ids))
    athletes = {a.id: a for a in db.scalars(select(Athlete).where(Athlete.org_id == p.org_id, Athlete.id.in_(ids)))}
    visible = p.rights_for(ids)
    for aid in ids:
        if aid not in athletes or aid not in visible:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"athlete {aid} not found")
    joined_on = body.joined_on or p.today
    added = [aid for aid in ids if add_to_group(db, p.org_id, aid, group.id, joined_on)]
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="group.athletes_add",
        entity_type="group",
        entity_id=group.id,
        details={"athlete_ids": added, "joined_on": joined_on},
    )
    db.commit()
    return groups_out(db, p, [group])[0]


@router.delete("/groups/{group_id}/athletes/{athlete_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_athlete(
    group_id: uuid.UUID,
    athlete_id: uuid.UUID,
    p: PrincipalDep,
    db: DbSession,
    left_on: Annotated[dt.date | None, Query()] = None,
) -> Response:
    group = get_group_or_404(db, p, group_id)
    if not p.can_write_group(group.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the group required")
    athlete = db.get(Athlete, athlete_id)
    if athlete is None or athlete.org_id != p.org_id or p.rights(athlete_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
    day = left_on or p.today
    if not leave_group(db, athlete_id, group.id, day):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete is not a current member of the group")
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="group.athlete_remove",
        entity_type="athlete",
        entity_id=athlete_id,
        details={"group_id": group.id, "left_on": day},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/groups/{group_id}/staff", response_model=list[StaffAssignmentOut])
def list_group_staff(group_id: uuid.UUID, p: AdminDep, db: DbSession) -> list[StaffAssignmentOut]:
    group = get_group_or_404(db, p, group_id)
    rows = db.scalars(
        select(StaffAssignment).where(StaffAssignment.group_id == group.id).order_by(StaffAssignment.created_at)
    ).all()
    return [StaffAssignmentOut.model_validate(a) for a in rows]


@router.post("/groups/{group_id}/staff", response_model=StaffAssignmentOut, status_code=status.HTTP_201_CREATED)
def assign_staff(group_id: uuid.UUID, body: StaffAssignmentCreate, p: AdminDep, db: DbSession) -> StaffAssignmentOut:
    group = get_group_or_404(db, p, group_id)
    m = db.scalar(select(OrgMembership).where(OrgMembership.org_id == p.org_id, OrgMembership.user_id == body.user_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="member not found")
    if m.role == "athlete":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="athletes cannot be assigned as staff")
    a = db.scalar(
        select(StaffAssignment).where(StaffAssignment.group_id == group.id, StaffAssignment.user_id == body.user_id)
    )
    if a is None:
        a = StaffAssignment(org_id=p.org_id, user_id=body.user_id, group_id=group.id)
        db.add(a)
    a.access_role = body.access_role
    a.can_view_identifiable = body.can_view_identifiable
    db.flush()
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="staff_assignment.upsert",
        entity_type="staff_assignment",
        entity_id=a.id,
        details=body.model_dump() | {"group_id": group.id},
    )
    db.commit()
    return StaffAssignmentOut.model_validate(a)


@router.delete("/staff-assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    a = db.get(StaffAssignment, assignment_id)
    if a is None or a.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="assignment not found")
    db.delete(a)
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="staff_assignment.delete",
        entity_type="staff_assignment",
        entity_id=assignment_id,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
