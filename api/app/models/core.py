"""Organizations, users, memberships, auth tokens, invitations, groups, athletes and staff."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow

ORG_ROLES = ("owner", "admin", "staff", "athlete")
ACCESS_ROLES = ("viewer", "coach", "practitioner", "medical", "researcher")
GROUP_KINDS = ("team", "squad", "unit", "section", "study", "cohort", "other")
ATHLETE_STATUSES = ("active", "inactive", "archived")
SEXES = ("female", "male", "other", "undisclosed")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


class Organization(Base):
    __tablename__ = "organization"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class User(Base):
    __tablename__ = "user_account"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    full_name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class OrgMembership(Base):
    __tablename__ = "org_membership"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id"),
        CheckConstraint(_in("role", ORG_ROLES), name="role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user_account.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)

    org: Mapped[Organization] = relationship(lazy="joined")
    user: Mapped[User] = relationship(lazy="joined")


class RefreshToken(Base):
    __tablename__ = "refresh_token"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user_account.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column()


class Invitation(Base):
    __tablename__ = "invitation"
    __table_args__ = (CheckConstraint(_in("role", ORG_ROLES), name="role"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(16))
    athlete_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("athlete.id", ondelete="CASCADE"))
    token_salt: Mapped[str] = mapped_column(String(64))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)

    org: Mapped[Organization] = relationship(lazy="joined")


class PushToken(Base):
    __tablename__ = "push_token"
    __table_args__ = (CheckConstraint(_in("platform", ("ios", "android")), name="platform"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user_account.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class Group(Base):
    __tablename__ = "org_group"
    __table_args__ = (CheckConstraint(_in("kind", GROUP_KINDS), name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("org_group.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="team")
    description: Mapped[str | None] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class Athlete(Base):
    __tablename__ = "athlete"
    __table_args__ = (
        UniqueConstraint("org_id", "code"),
        CheckConstraint(_in("status", ATHLETE_STATUSES), name="status"),
        Index("ix_athlete_org_status", "org_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(50))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    preferred_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(320))
    date_of_birth: Mapped[dt.date | None] = mapped_column(Date)
    sex: Mapped[str | None] = mapped_column(String(16))
    position: Mapped[str | None] = mapped_column(String(100))
    timezone: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="active")
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"), index=True)
    ow_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    # wearable provider ranking for this athlete (null: the organization's)
    wearable_priority: Mapped[list[str] | None] = mapped_column(JSONB)
    # last time wearable history (settings.wearable_history_days) was copied from Open Wearables
    wearable_history_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow
    )


class AthleteGroup(Base):
    """Time-bounded group membership. Current = joined_on <= today and (left_on is null or left_on > today)."""

    __tablename__ = "athlete_group"
    __table_args__ = (Index("ix_athlete_group_group_athlete", "group_id", "athlete_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("athlete.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("org_group.id", ondelete="CASCADE"))
    joined_on: Mapped[dt.date] = mapped_column(Date)
    left_on: Mapped[dt.date | None] = mapped_column(Date)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class StaffAssignment(Base):
    __tablename__ = "staff_assignment"
    __table_args__ = (
        UniqueConstraint("user_id", "group_id"),
        CheckConstraint(_in("access_role", ACCESS_ROLES), name="access_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user_account.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("org_group.id", ondelete="CASCADE"), index=True)
    access_role: Mapped[str] = mapped_column(String(16))
    can_view_identifiable: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
