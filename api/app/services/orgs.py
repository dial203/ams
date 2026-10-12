"""Organizations, users and memberships."""

from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Athlete, OrgMembership, Organization, StaffAssignment, User
from app.schemas.identity import MemberOut, OrganizationOut, OrgSettings, StaffAssignmentOut, Terminology, UserOut
from app.security import hash_password
from app.timeutil import is_valid_timezone

DEFAULT_READINESS_METRICS = ["wellness_hooper", "hrv_z", "rhr_z", "sleep_duration", "acwr"]


def slugify(text: str, sep: str = "-") -> str:
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", sep, norm.lower()).strip(sep)
    return slug[:90] or "org"


def default_settings() -> dict[str, Any]:
    return {"terminology": Terminology().model_dump(), "readiness_metrics": list(DEFAULT_READINESS_METRICS)}


def org_settings(org: Organization) -> OrgSettings:
    raw = org.settings or {}
    term = {**Terminology().model_dump(), **(raw.get("terminology") or {})}
    readiness = raw.get("readiness_metrics")
    return OrgSettings(
        terminology=Terminology(**term),
        readiness_metrics=list(readiness) if isinstance(readiness, list) else list(DEFAULT_READINESS_METRICS),
    )


def org_out(org: Organization) -> OrganizationOut:
    return OrganizationOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        timezone=org.timezone,
        settings=org_settings(org),
        created_at=org.created_at,
    )


def user_out(user: User) -> UserOut:
    return UserOut.model_validate(user)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == normalize_email(email)))


def create_org(db: Session, name: str, timezone: str = "UTC", slug: str | None = None) -> Organization:
    """Create an organization with default settings and the built-in metric definitions."""
    from app.metrics.builtins import seed_builtin_metrics

    if not is_valid_timezone(timezone):
        raise ValueError(f"unknown time zone {timezone!r}")
    base = slug or slugify(name)
    candidate, n = base, 1
    while db.scalar(select(Organization.id).where(Organization.slug == candidate)) is not None:
        if slug:
            raise ValueError(f"organization slug {slug!r} already exists")
        n += 1
        candidate = f"{base}-{n}"
    org = Organization(name=name, slug=candidate, timezone=timezone, settings=default_settings())
    db.add(org)
    db.flush()
    seed_builtin_metrics(db, org)
    return org


def create_user(db: Session, email: str, password: str | None, full_name: str) -> User:
    if get_user_by_email(db, email) is not None:
        raise ValueError(f"user {email} already exists")
    user = User(
        email=normalize_email(email),
        full_name=full_name,
        password_hash=hash_password(password) if password else None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def add_member(db: Session, org: Organization, user: User, role: str) -> OrgMembership:
    existing = db.scalar(
        select(OrgMembership).where(OrgMembership.org_id == org.id, OrgMembership.user_id == user.id)
    )
    if existing is not None:
        existing.role = role
        return existing
    m = OrgMembership(org_id=org.id, user_id=user.id, role=role)
    db.add(m)
    db.flush()
    return m


def owner_count(db: Session, org_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).where(OrgMembership.org_id == org_id, OrgMembership.role == "owner")
        )
        or 0
    )


def member_out(db: Session, m: OrgMembership) -> MemberOut:
    assignments = db.scalars(
        select(StaffAssignment)
        .where(StaffAssignment.org_id == m.org_id, StaffAssignment.user_id == m.user_id)
        .order_by(StaffAssignment.created_at)
    ).all()
    athlete_id = db.scalar(select(Athlete.id).where(Athlete.org_id == m.org_id, Athlete.user_id == m.user_id))
    return MemberOut(
        user=user_out(m.user),
        role=m.role,  # type: ignore[arg-type]
        athlete_id=athlete_id,
        assignments=[StaffAssignmentOut.model_validate(a) for a in assignments],
    )


def get_membership_or_404(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> OrgMembership:
    m = db.scalar(select(OrgMembership).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="member not found")
    return m
