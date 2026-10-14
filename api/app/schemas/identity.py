"""Auth, users, organizations, members, invitations, groups, staff assignments."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.common import AccessRole, ApiModel, GroupKind, OrgRole, check_provider_order
from app.security import MIN_PASSWORD_LENGTH
from app.timeutil import is_valid_timezone


class UserOut(ApiModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    created_at: dt.datetime


class Terminology(BaseModel):
    athlete: str = "Athlete"
    athletes: str = "Athletes"
    group: str = "Group"
    groups: str = "Groups"


class OrgSettings(BaseModel):
    terminology: Terminology = Field(default_factory=Terminology)
    readiness_metrics: list[str] = Field(default_factory=list)
    # wearable provider ranking for every athlete without their own (empty: Open Wearables' default order)
    wearable_priority: list[str] = Field(default_factory=list)


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    timezone: str
    settings: OrgSettings
    created_at: dt.datetime


class TerminologyUpdate(BaseModel):
    athlete: str | None = None
    athletes: str | None = None
    group: str | None = None
    groups: str | None = None


class OrgSettingsUpdate(BaseModel):
    terminology: TerminologyUpdate | None = None
    readiness_metrics: list[str] | None = None
    wearable_priority: list[str] | None = None

    _providers = field_validator("wearable_priority")(check_provider_order)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    timezone: str | None = None
    settings: OrgSettingsUpdate | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is not None and not is_valid_timezone(v):
            raise ValueError("unknown IANA time zone")
        return v


class MembershipOut(BaseModel):
    org: OrganizationOut
    role: OrgRole
    athlete_id: uuid.UUID | None


class MeOut(BaseModel):
    user: UserOut
    memberships: list[MembershipOut]


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class LoginResponse(TokenPair):
    user: UserOut


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class InviteInfo(BaseModel):
    email: str
    org_name: str
    role: OrgRole
    expires_at: dt.datetime


class AcceptInviteRequest(BaseModel):
    token: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
    full_name: str = Field(min_length=1, max_length=200)


class MeUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=200)
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=256)
    current_password: str | None = None


class PushTokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=255)
    platform: Literal["ios", "android"]


class StaffAssignmentOut(ApiModel):
    id: uuid.UUID
    user_id: uuid.UUID
    group_id: uuid.UUID
    access_role: AccessRole
    can_view_identifiable: bool


class StaffAssignmentCreate(BaseModel):
    user_id: uuid.UUID
    access_role: AccessRole
    can_view_identifiable: bool = True


class MemberOut(BaseModel):
    user: UserOut
    role: OrgRole
    athlete_id: uuid.UUID | None
    assignments: list[StaffAssignmentOut]


class MemberUpdate(BaseModel):
    role: OrgRole


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: OrgRole
    athlete_id: uuid.UUID | None
    expires_at: dt.datetime
    accepted_at: dt.datetime | None
    invite_url: str


class InvitationCreate(BaseModel):
    email: EmailStr
    role: OrgRole
    athlete_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _athlete_role(self) -> InvitationCreate:
        if self.role == "athlete" and self.athlete_id is None:
            raise ValueError("role 'athlete' requires athlete_id")
        if self.role != "athlete" and self.athlete_id is not None:
            raise ValueError("athlete_id is only valid with role 'athlete'")
        return self


class AthleteInviteRequest(BaseModel):
    email: EmailStr | None = None


class GroupOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    kind: GroupKind
    description: str | None
    archived: bool
    athlete_count: int
    created_at: dt.datetime


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: GroupKind
    parent_id: uuid.UUID | None = None
    description: str | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    kind: GroupKind | None = None
    parent_id: uuid.UUID | None = None
    description: str | None = None
    archived: bool | None = None


class GroupAthletesAdd(BaseModel):
    athlete_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)
    joined_on: dt.date | None = None
