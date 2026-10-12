"""Verification of svix-signed webhooks from Open Wearables.

Scheme (https://docs.svix.com/receiving/verifying-payloads/how-manual): the secret is
``whsec_<base64 key>``; the signed content is ``{svix-id}.{svix-timestamp}.{raw body}``; the
``svix-signature`` header holds space-separated ``v1,<base64 HMAC-SHA256>`` entries, any of
which may match. Timestamps more than 5 minutes away from now are rejected (replay window).

OW payloads look like ``{"type": "sync.completed", "data": {"user_id": "<OW user uuid>", ...}}``
(backend/app/services/outgoing_webhooks/events.py).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

TOLERANCE_SECONDS = 5 * 60

# Events after which the athlete's daily values may have changed.
REFRESH_EVENTS = frozenset(
    {
        "sync.completed",
        "connection.created",
        "sleep.created",
        "workout.created",
        "recovery_score.created",
        "heart_rate_variability.created",
        "heart_rate.created",
        "steps.created",
        "calories.created",
        "body_composition.created",
        "activity_timeseries.created",
        "respiratory_rate.created",
    }
)


class WebhookVerificationError(Exception):
    pass


def _key(secret: str) -> bytes:
    raw = secret.removeprefix("whsec_")
    try:
        return base64.b64decode(raw)
    except (ValueError, TypeError) as exc:
        raise WebhookVerificationError("webhook secret is not valid base64") from exc


def sign(secret: str, msg_id: str, timestamp: int | str, body: bytes) -> str:
    """The ``svix-signature`` header value for a payload (used by tests and tooling)."""
    content = f"{msg_id}.{timestamp}.".encode() + body
    digest = hmac.new(_key(secret), content, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode()


def verify(secret: str, headers: Mapping[str, str], body: bytes, now: float | None = None) -> None:
    """Raise WebhookVerificationError unless the svix headers prove the body is authentic and fresh."""
    msg_id = headers.get("svix-id")
    ts_header = headers.get("svix-timestamp")
    sig_header = headers.get("svix-signature")
    if not msg_id or not ts_header or not sig_header:
        raise WebhookVerificationError("missing svix headers")
    try:
        timestamp = int(ts_header)
    except ValueError as exc:
        raise WebhookVerificationError("invalid svix-timestamp") from exc
    current = time.time() if now is None else now
    if abs(current - timestamp) > TOLERANCE_SECONDS:
        raise WebhookVerificationError("timestamp outside the tolerance window")
    expected = sign(secret, msg_id, timestamp, body).split(",", 1)[1]
    for candidate in sig_header.split(" "):
        version, _, signature = candidate.partition(",")
        if version == "v1" and hmac.compare_digest(signature.encode(), expected.encode()):
            return
    raise WebhookVerificationError("no matching signature")


@dataclass(frozen=True)
class WebhookEvent:
    type: str
    ow_user_id: uuid.UUID | None
    data: dict[str, Any]


def parse_event(body: bytes) -> WebhookEvent:
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise WebhookVerificationError("body is not JSON") from exc
    if not isinstance(payload, dict):
        raise WebhookVerificationError("payload must be an object")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    raw_user = data.get("user_id") or payload.get("user_id")
    try:
        user_id = uuid.UUID(str(raw_user)) if raw_user else None
    except ValueError:
        user_id = None
    return WebhookEvent(type=str(payload.get("type") or ""), ow_user_id=user_id, data=data)
