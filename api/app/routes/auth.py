"""/auth and /me."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, select

from app.database import DbSession
from app.deps import CurrentUser, athlete_id_for
from app.models import OrgMembership, PushToken
from app.schemas.identity import (
    AcceptInviteRequest,
    InviteInfo,
    LoginRequest,
    LoginResponse,
    MembershipOut,
    MeOut,
    MeUpdate,
    PushTokenIn,
    RefreshRequest,
    TokenPair,
    UserOut,
)
from app.security import hash_password, verify_password
from app.services import auth as auth_service
from app.services.orgs import org_out, user_out
from app.timeutil import utcnow

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginResponse)
def login(body: LoginRequest, db: DbSession) -> LoginResponse:
    user = auth_service.authenticate(db, body.email, body.password)
    pair, _ = auth_service.issue_tokens(db, user)
    db.commit()
    return LoginResponse(**pair.model_dump(), user=user_out(user))


@router.post("/auth/refresh", response_model=TokenPair)
def refresh(body: RefreshRequest, db: DbSession) -> TokenPair:
    pair = auth_service.rotate_refresh_token(db, body.refresh_token)
    db.commit()
    return pair


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(body: RefreshRequest, db: DbSession) -> Response:
    auth_service.logout(db, body.refresh_token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/auth/invite/{token}", response_model=InviteInfo)
def invite_info(token: str, db: DbSession) -> InviteInfo:
    inv = auth_service.find_invitation(db, token)
    return InviteInfo(email=inv.email, org_name=inv.org.name, role=inv.role, expires_at=inv.expires_at)  # type: ignore[arg-type]


@router.post("/auth/accept-invite", response_model=LoginResponse)
def accept_invite(body: AcceptInviteRequest, db: DbSession) -> LoginResponse:
    user = auth_service.accept_invitation(db, body.token, body.password, body.full_name)
    pair, _ = auth_service.issue_tokens(db, user)
    db.commit()
    return LoginResponse(**pair.model_dump(), user=user_out(user))


@router.get("/me", response_model=MeOut, tags=["me"])
def get_me(user: CurrentUser, db: DbSession) -> MeOut:
    memberships = db.scalars(
        select(OrgMembership).where(OrgMembership.user_id == user.id).order_by(OrgMembership.created_at)
    ).all()
    return MeOut(
        user=user_out(user),
        memberships=[
            MembershipOut(org=org_out(m.org), role=m.role, athlete_id=athlete_id_for(db, m.org_id, user.id))  # type: ignore[arg-type]
            for m in memberships
        ],
    )


@router.patch("/me", response_model=UserOut, tags=["me"])
def update_me(body: MeUpdate, user: CurrentUser, db: DbSession) -> UserOut:
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.password is not None:
        if body.current_password is None or not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="current_password is incorrect")
        user.password_hash = hash_password(body.password)
    db.commit()
    return user_out(user)


@router.post("/me/push-tokens", status_code=status.HTTP_204_NO_CONTENT, tags=["me"])
def register_push_token(body: PushTokenIn, user: CurrentUser, db: DbSession) -> Response:
    existing = db.scalar(select(PushToken).where(PushToken.token == body.token))
    if existing is None:
        db.add(PushToken(user_id=user.id, token=body.token, platform=body.platform))
    else:  # a device that changed hands moves to the new user
        existing.user_id = user.id
        existing.platform = body.platform
        existing.updated_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/push-tokens/{token}", status_code=status.HTTP_204_NO_CONTENT, tags=["me"])
def delete_push_token(token: str, user: CurrentUser, db: DbSession) -> Response:
    db.execute(delete(PushToken).where(PushToken.token == token, PushToken.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
