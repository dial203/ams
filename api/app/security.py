"""Password hashing (argon2id), JWT access tokens and opaque token helpers."""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets
import uuid
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import settings

_hasher = PasswordHasher()  # argon2id with library defaults (RFC 9106 low-memory profile)
JWT_ALGORITHM = "HS256"
MIN_PASSWORD_LENGTH = 8


class TokenError(Exception):
    pass


def _secret() -> str:
    key = settings.ams_secret_key
    if not key or len(key) < 32:
        raise RuntimeError("AMS_SECRET_KEY must be set to at least 32 characters")
    return key


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        # Spend comparable time so missing users are not distinguishable by timing.
        _hasher.hash(password)
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    now = dt.datetime.now(dt.UTC)
    expires_in = settings.access_token_minutes * 60
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=expires_in)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM), expires_in


def decode_access_token(token: str) -> uuid.UUID:
    try:
        payload: dict[str, Any] = jwt.decode(
            token, _secret(), algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]}
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    if payload.get("type") != "access":
        raise TokenError("not an access token")
    try:
        return uuid.UUID(payload["sub"])
    except (ValueError, TypeError) as exc:
        raise TokenError("invalid subject") from exc


def new_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def token_hash(token: str) -> str:
    """SHA-256 hex digest; tokens are high-entropy so a fast hash is appropriate for lookup."""
    return hashlib.sha256(token.encode()).hexdigest()


def derive_invite_token(invitation_id: uuid.UUID, salt: str) -> str:
    """Invitation tokens are derived with HMAC(secret, id, salt).

    Only their SHA-256 is stored, so a database leak alone does not reveal usable tokens,
    while admins listing pending invitations can still be shown the invite URL.
    """
    digest = hmac.new(_secret().encode(), f"invite:{invitation_id}:{salt}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
