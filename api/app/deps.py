"""FastAPI dependencies: authentication, org membership and role checks."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.database import DbSession
from app.models import Athlete, Organization, OrgMembership, User
from app.permissions import Principal
from app.security import TokenError, decode_access_token

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        user_id = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise _unauthorized("invalid or expired token") from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("invalid or expired token")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def athlete_id_for(db: DbSession, org_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID | None:
    return db.scalar(select(Athlete.id).where(Athlete.org_id == org_id, Athlete.user_id == user_id).limit(1))


def get_principal(db: DbSession, user: CurrentUser, org_id: Annotated[uuid.UUID, Path()]) -> Principal:
    membership = db.scalar(
        select(OrgMembership).where(OrgMembership.org_id == org_id, OrgMembership.user_id == user.id)
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="organization not found")
    org = db.get(Organization, org_id)
    if org is None:  # pragma: no cover - FK guarantees it
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="organization not found")
    return Principal(db, user, org, membership, athlete_id_for(db, org_id, user.id))


PrincipalDep = Annotated[Principal, Depends(get_principal)]


def require_admin(p: PrincipalDep) -> Principal:
    if not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin role required")
    return p


def require_staff(p: PrincipalDep) -> Principal:
    if not p.is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="staff role required")
    return p


def require_athlete(p: PrincipalDep) -> Principal:
    """Self-service routes act *as the athlete*, even for a staff member who also has an athlete record."""
    if p.athlete_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="caller is not an athlete in this organization")
    if p.is_athlete:
        return p
    return Principal(p.db, p.user, p.org, p.membership, p.athlete_id, role="athlete")


AdminDep = Annotated[Principal, Depends(require_admin)]
StaffDep = Annotated[Principal, Depends(require_staff)]
AthleteSelfDep = Annotated[Principal, Depends(require_athlete)]


def not_found(what: str = "not found") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=what)


def forbidden(what: str = "not allowed") -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=what)
