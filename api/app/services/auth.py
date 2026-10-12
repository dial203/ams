"""Login, rotating refresh tokens with reuse detection, invitations."""

from __future__ import annotations

import datetime as dt
import logging
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Athlete, Invitation, Organization, OrgMembership, RefreshToken, User
from app.schemas.identity import InvitationOut, TokenPair
from app.security import (
    create_access_token,
    derive_invite_token,
    hash_password,
    new_opaque_token,
    token_hash,
    verify_password,
)
from app.services.orgs import add_member, get_user_by_email, normalize_email
from app.timeutil import utcnow

log = logging.getLogger(__name__)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail)


def authenticate(db: Session, email: str, password: str) -> User:
    user = get_user_by_email(db, email)
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise _unauthorized("invalid email or password")
    return user


def issue_tokens(db: Session, user: User, family_id: uuid.UUID | None = None) -> tuple[TokenPair, RefreshToken]:
    access, expires_in = create_access_token(user.id)
    raw = new_opaque_token()
    rt = RefreshToken(
        user_id=user.id,
        token_hash=token_hash(raw),
        family_id=family_id or uuid.uuid4(),
        expires_at=utcnow() + dt.timedelta(days=settings.refresh_token_days),
    )
    db.add(rt)
    db.flush()
    return TokenPair(access_token=access, refresh_token=raw, expires_in=expires_in), rt


def revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


def rotate_refresh_token(db: Session, raw: str) -> TokenPair:
    """Exchange a refresh token for a new pair. Re-use of a revoked token revokes the whole family."""
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)).with_for_update())
    if rt is None:
        raise _unauthorized("invalid refresh token")
    if rt.revoked_at is not None:
        log.warning("refresh token reuse detected; revoking family %s (user %s)", rt.family_id, rt.user_id)
        revoke_family(db, rt.family_id)
        db.commit()
        raise _unauthorized("refresh token reuse detected")
    if rt.expires_at <= utcnow():
        raise _unauthorized("refresh token expired")
    user = db.get(User, rt.user_id)
    if user is None or not user.is_active:
        raise _unauthorized("invalid refresh token")
    pair, new_rt = issue_tokens(db, user, family_id=rt.family_id)
    rt.revoked_at = utcnow()
    rt.replaced_by_id = new_rt.id
    return pair


def logout(db: Session, raw: str) -> None:
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))
    if rt is not None:
        revoke_family(db, rt.family_id)


# ----------------------------------------------------------------------------- invitations


def invite_url(inv: Invitation) -> str:
    token = derive_invite_token(inv.id, inv.token_salt)
    return f"{settings.web_base_url.rstrip('/')}/accept-invite?token={token}"


def invitation_out(inv: Invitation) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role=inv.role,  # type: ignore[arg-type]
        athlete_id=inv.athlete_id,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
        invite_url=invite_url(inv),
    )


def create_invitation(
    db: Session,
    org: Organization,
    email: str,
    role: str,
    athlete_id: uuid.UUID | None,
    created_by: uuid.UUID | None,
) -> Invitation:
    inv = Invitation(
        id=uuid.uuid4(),
        org_id=org.id,
        email=normalize_email(email),
        role=role,
        athlete_id=athlete_id,
        token_salt=secrets.token_hex(16),
        token_hash="",
        expires_at=utcnow() + dt.timedelta(days=settings.invitation_days),
        created_by=created_by,
    )
    inv.token_hash = token_hash(derive_invite_token(inv.id, inv.token_salt))
    db.add(inv)
    db.flush()
    # Email delivery is out of scope: log the link so operators can pass it on.
    log.info("invitation for %s to %s as %s: %s", inv.email, org.name, role, invite_url(inv))
    return inv


def find_invitation(db: Session, token: str) -> Invitation:
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == token_hash(token)))
    if inv is None or inv.accepted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="invitation not found")
    if inv.expires_at <= utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invitation expired")
    return inv


def accept_invitation(db: Session, token: str, password: str, full_name: str) -> User:
    inv = find_invitation(db, token)
    user = get_user_by_email(db, inv.email)
    if user is None:
        user = User(email=inv.email, full_name=full_name, password_hash=hash_password(password), is_active=True)
        db.add(user)
        db.flush()
    else:
        # An existing account must prove ownership with its current password.
        if not user.is_active or not verify_password(password, user.password_hash):
            raise _unauthorized("an account with this email exists; use its current password to accept")
    membership = db.scalar(
        select(OrgMembership).where(OrgMembership.org_id == inv.org_id, OrgMembership.user_id == user.id)
    )
    if membership is None:
        add_member(db, inv.org, user, inv.role)
    if inv.role == "athlete" and inv.athlete_id is not None:
        athlete = db.get(Athlete, inv.athlete_id)
        if athlete is None or athlete.org_id != inv.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
        if athlete.user_id is not None and athlete.user_id != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="athlete already has a login")
        other = db.scalar(
            select(Athlete.id).where(Athlete.org_id == inv.org_id, Athlete.user_id == user.id, Athlete.id != athlete.id)
        )
        if other is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="user is already linked to another athlete")
        athlete.user_id = user.id
    inv.accepted_at = utcnow()
    return user
