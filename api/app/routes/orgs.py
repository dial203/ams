"""/orgs/{org_id}: organization, members, invitations."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, select

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep, StaffDep
from app.models import Athlete, Invitation, OrgMembership, StaffAssignment
from app.schemas.identity import (
    AthleteInviteRequest,
    InvitationCreate,
    InvitationOut,
    MemberOut,
    MemberUpdate,
    OrganizationOut,
    OrganizationUpdate,
)
from app.services import auth as auth_service
from app.services.orgs import get_membership_or_404, member_out, org_out, org_settings, owner_count
from app.services.people import get_visible_athlete
from app.timeutil import utcnow

router = APIRouter(prefix="/orgs/{org_id}", tags=["organization"])


@router.get("", response_model=OrganizationOut)
def get_org(p: PrincipalDep) -> OrganizationOut:
    return org_out(p.org)


@router.patch("", response_model=OrganizationOut)
def update_org(body: OrganizationUpdate, p: AdminDep, db: DbSession) -> OrganizationOut:
    org = p.org
    before = {"name": org.name, "timezone": org.timezone, "settings": org.settings}
    if body.name is not None:
        org.name = body.name
    if body.timezone is not None:
        org.timezone = body.timezone
    if body.settings is not None:
        current = org_settings(org).model_dump()
        if body.settings.terminology is not None:
            current["terminology"].update(body.settings.terminology.model_dump(exclude_none=True))
        if body.settings.readiness_metrics is not None:
            current["readiness_metrics"] = list(dict.fromkeys(body.settings.readiness_metrics))
        org.settings = current
    audit.record(
        db,
        org_id=org.id,
        user_id=p.user_id,
        action="organization.update",
        entity_type="organization",
        entity_id=org.id,
        details=audit.diff(before, {"name": org.name, "timezone": org.timezone, "settings": org.settings}),
    )
    db.commit()
    return org_out(org)


@router.get("/members", response_model=list[MemberOut])
def list_members(p: StaffDep, db: DbSession) -> list[MemberOut]:
    members = db.scalars(
        select(OrgMembership).where(OrgMembership.org_id == p.org_id).order_by(OrgMembership.created_at)
    ).all()
    return [member_out(db, m) for m in members]


@router.patch("/members/{user_id}", response_model=MemberOut)
def update_member(user_id: uuid.UUID, body: MemberUpdate, p: AdminDep, db: DbSession) -> MemberOut:
    m = get_membership_or_404(db, p.org_id, user_id)
    if (m.role == "owner" or body.role == "owner") and not p.is_owner and m.role != body.role:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="only an owner can grant or revoke the owner role")
    if m.role == "owner" and body.role != "owner" and owner_count(db, p.org_id) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="cannot demote the last owner")
    if body.role == "athlete" and db.scalar(
        select(Athlete.id).where(Athlete.org_id == p.org_id, Athlete.user_id == user_id)
    ) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="the athlete role needs a linked athlete record")
    old = m.role
    m.role = body.role
    if body.role == "athlete":
        db.execute(delete(StaffAssignment).where(StaffAssignment.org_id == p.org_id, StaffAssignment.user_id == user_id))
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="member.update",
        entity_type="user",
        entity_id=user_id,
        details={"before": {"role": old}, "after": {"role": body.role}},
    )
    db.commit()
    return member_out(db, m)


@router.delete("/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    m = get_membership_or_404(db, p.org_id, user_id)
    if m.role == "owner":
        if not p.is_owner:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="only an owner can remove an owner")
        if owner_count(db, p.org_id) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="cannot remove the last owner")
    db.execute(delete(StaffAssignment).where(StaffAssignment.org_id == p.org_id, StaffAssignment.user_id == user_id))
    for athlete in db.scalars(select(Athlete).where(Athlete.org_id == p.org_id, Athlete.user_id == user_id)):
        athlete.user_id = None
    db.delete(m)
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="member.remove", entity_type="user", entity_id=user_id
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(p: AdminDep, db: DbSession) -> list[InvitationOut]:
    invs = db.scalars(
        select(Invitation)
        .where(Invitation.org_id == p.org_id, Invitation.accepted_at.is_(None), Invitation.expires_at > utcnow())
        .order_by(Invitation.created_at.desc())
    ).all()
    return [auth_service.invitation_out(i) for i in invs]


@router.post("/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def create_invitation(body: InvitationCreate, p: AdminDep, db: DbSession) -> InvitationOut:
    if body.role == "owner" and not p.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="only an owner can invite an owner")
    if body.athlete_id is not None:
        athlete = db.get(Athlete, body.athlete_id)
        if athlete is None or athlete.org_id != p.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
        if athlete.user_id is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="athlete already has a login")
    inv = auth_service.create_invitation(db, p.org, body.email, body.role, body.athlete_id, p.user_id)
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="invitation.create",
        entity_type="invitation",
        entity_id=inv.id,
        details={"email": inv.email, "role": inv.role, "athlete_id": inv.athlete_id},
    )
    db.commit()
    return auth_service.invitation_out(inv)


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invitation(invitation_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    inv = db.get(Invitation, invitation_id)
    if inv is None or inv.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="invitation not found")
    db.delete(inv)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/athletes/{athlete_id}/invite",
    response_model=InvitationOut,
    status_code=status.HTTP_201_CREATED,
    tags=["athletes"],
)
def invite_athlete(
    athlete_id: uuid.UUID, body: AthleteInviteRequest, p: PrincipalDep, db: DbSession
) -> InvitationOut:
    athlete, rights = get_visible_athlete(db, p, athlete_id)
    if not (p.is_admin or (p.is_staff and rights.write)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the athlete required")
    if athlete.user_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="athlete already has a login")
    if body.email is None and not rights.identifiable:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="athlete details are masked for you; provide an email")
    email = body.email or athlete.email
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="athlete has no email; provide one")
    inv = auth_service.create_invitation(db, p.org, email, "athlete", athlete.id, p.user_id)
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="invitation.create",
        entity_type="invitation",
        entity_id=inv.id,
        details={"role": "athlete", "athlete_id": athlete.id},
    )
    db.commit()
    return auth_service.invitation_out(inv)
