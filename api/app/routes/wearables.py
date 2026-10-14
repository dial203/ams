"""Wearables (staff) and the Open Wearables webhook receiver."""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select

from app import audit
from app.config import settings
from app.database import DbSession
from app.deps import PrincipalDep, StaffDep
from app.integrations.open_wearables.client import OpenWearablesClient
from app.integrations.open_wearables.daily import WEARABLE_METRICS
from app.integrations.open_wearables.errors import OpenWearablesNotConfiguredError
from app.integrations.open_wearables.webhooks import (
    HISTORY_SOURCES,
    REFRESH_EVENTS,
    WebhookVerificationError,
    parse_event,
    verify,
)
from app.models import Athlete
from app.permissions import Principal
from app.schemas.domain import (
    ConnectRequest,
    ConnectResponse,
    HistoryPullOut,
    RefreshResult,
    WearableDailyPoint,
    WearablePriorityUpdate,
    WearableProviderOut,
    WearableStatus,
)
from app.services import wearables as svc
from app.services.people import get_visible_athlete

log = logging.getLogger(__name__)
router = APIRouter(tags=["wearables"])


def _require_write(p: Principal, athlete_id: uuid.UUID, db: DbSession) -> Athlete:
    athlete, rights = get_visible_athlete(db, p, athlete_id)
    if not rights.write:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the athlete required")
    return athlete


def connect_athlete(db: DbSession, athlete: Athlete, body: ConnectRequest) -> ConnectResponse:
    with OpenWearablesClient.from_settings() as client:
        ow_user_id = svc.link_athlete(db, client, athlete)
        db.commit()
        url = client.authorization_url(
            body.provider,
            ow_user_id,
            redirect_uri=body.redirect_uri,
            new_account=body.new_account,
            account_type=body.account_type,
            account_label=body.account_label,
        )
    return ConnectResponse(authorization_url=url)


@router.get("/orgs/{org_id}/wearables/providers", response_model=list[WearableProviderOut])
def list_providers(p: StaffDep) -> list[WearableProviderOut]:
    with OpenWearablesClient.from_settings() as client:
        return svc.providers(client)


@router.get("/orgs/{org_id}/athletes/{athlete_id}/wearables", response_model=WearableStatus)
def athlete_wearables(athlete_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> WearableStatus:
    athlete, _ = get_visible_athlete(db, p, athlete_id)
    return _status(db, p, athlete)


def _status(db: DbSession, p: Principal, athlete: Athlete) -> WearableStatus:
    if athlete.ow_user_id is None:
        return svc.wearable_status(db, None, athlete, p.org)
    with OpenWearablesClient.from_settings() as client:
        return svc.wearable_status(db, client, athlete, p.org)


@router.put("/orgs/{org_id}/athletes/{athlete_id}/wearables/priority", response_model=WearableStatus)
def set_priority(athlete_id: uuid.UUID, body: WearablePriorityUpdate, p: PrincipalDep, db: DbSession) -> WearableStatus:
    athlete = _require_write(p, athlete_id, db)
    before = athlete.wearable_priority
    athlete.wearable_priority = body.providers or None
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="athlete.wearable_priority",
        entity_type="athlete",
        entity_id=athlete.id,
        details={"before": before, "after": athlete.wearable_priority},
    )
    db.commit()
    return _status(db, p, athlete)


@router.post(
    "/orgs/{org_id}/athletes/{athlete_id}/wearables/history",
    response_model=HistoryPullOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def pull_history(athlete_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> HistoryPullOut:
    athlete = _require_write(p, athlete_id, db)
    if athlete.ow_user_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="athlete is not linked to Open Wearables")
    if not settings.ow_configured:
        raise OpenWearablesNotConfiguredError("OW_BASE_URL / OW_API_KEY are not configured")
    from app.tasks import refresh_athlete_wearables

    refresh_athlete_wearables.delay(str(athlete.id), history=True)
    return HistoryPullOut(days=settings.wearable_history_days)


@router.post("/orgs/{org_id}/athletes/{athlete_id}/wearables/link", response_model=WearableStatus)
def link(athlete_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> WearableStatus:
    athlete = _require_write(p, athlete_id, db)
    with OpenWearablesClient.from_settings() as client:
        svc.link_athlete(db, client, athlete)
        db.commit()
        return svc.wearable_status(db, client, athlete, p.org)


@router.post("/orgs/{org_id}/athletes/{athlete_id}/wearables/connect", response_model=ConnectResponse)
def connect(athlete_id: uuid.UUID, body: ConnectRequest, p: PrincipalDep, db: DbSession) -> ConnectResponse:
    athlete = _require_write(p, athlete_id, db)
    return connect_athlete(db, athlete, body)


@router.post("/orgs/{org_id}/athletes/{athlete_id}/wearables/refresh", response_model=RefreshResult)
def refresh(
    athlete_id: uuid.UUID,
    p: PrincipalDep,
    db: DbSession,
    days: Annotated[int, Query(ge=1, le=365)] = 7,
) -> RefreshResult:
    athlete = _require_write(p, athlete_id, db)
    if athlete.ow_user_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="athlete is not linked to Open Wearables")
    with OpenWearablesClient.from_settings() as client:
        updated = svc.refresh_athlete(db, client, athlete, p.org, days)
    db.commit()
    return RefreshResult(updated=updated)


@router.get("/orgs/{org_id}/athletes/{athlete_id}/wearables/daily", response_model=list[WearableDailyPoint])
def daily(
    athlete_id: uuid.UUID,
    p: PrincipalDep,
    db: DbSession,
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
    metrics: Annotated[str | None, Query(description="Comma-separated WearableMetric names")] = None,
    all_sources: Annotated[bool, Query(description="Every provider's value, not only the best ranked")] = False,
) -> list[WearableDailyPoint]:
    athlete, _ = get_visible_athlete(db, p, athlete_id)
    end = end or p.today
    start = start or end - dt.timedelta(days=27)
    names = [m.strip() for m in metrics.split(",") if m.strip()] if metrics else None
    if names:
        unknown = [m for m in names if m not in WEARABLE_METRICS]
        if unknown:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"unknown wearable metric(s): {', '.join(unknown)}")
    return svc.daily_points(db, athlete, p.org, start, end, names, all_sources)


async def _raw_body(request: Request) -> bytes:
    return await request.body()


@router.post("/integrations/open-wearables/webhook", status_code=status.HTTP_204_NO_CONTENT)
def ow_webhook(request: Request, db: DbSession, body: Annotated[bytes, Depends(_raw_body)]) -> Response:
    secret = settings.ow_webhook_secret
    if not secret:
        raise OpenWearablesNotConfiguredError("OW_WEBHOOK_SECRET is not configured")
    try:
        verify(secret, {k.lower(): v for k, v in request.headers.items()}, body)
        event = parse_event(body)
    except WebhookVerificationError as exc:
        log.warning("rejected OW webhook: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid webhook signature") from exc
    if event.type not in REFRESH_EVENTS or event.ow_user_id is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    athletes = db.scalars(
        select(Athlete).where(Athlete.ow_user_id == event.ow_user_id, Athlete.status != "archived")
    ).all()
    from app.tasks import refresh_athlete_wearables

    if event.type == "connection.created":
        # the new provider's history reaches OW over the next minutes to hours: copy history on the
        # next event for this athlete (or the nightly run), not now
        for a in athletes:
            a.wearable_history_at = None
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    history = True if event.type == "sync.completed" and event.data.get("source") in HISTORY_SOURCES else None
    for a in athletes:  # unknown OW users: nothing to do
        refresh_athlete_wearables.delay(str(a.id), 7, history)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
