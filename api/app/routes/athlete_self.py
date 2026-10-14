"""/orgs/{org_id}/me/...: athlete self-service (mobile). The caller must be an athlete in the org."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.database import DbSession
from app.deps import AthleteSelfDep
from app.integrations.open_wearables.client import OpenWearablesClient
from app.models import Athlete, Form, MetricDefinition, Submission
from app.permissions import Principal, load_group_tree
from app.routes.submissions import create_for
from app.routes.wearables import connect_athlete
from app.schemas.common import Limit, Offset, Page
from app.schemas.domain import (
    AthleteOut,
    ConnectRequest,
    ConnectResponse,
    DueForm,
    MetricSeries,
    SdkTokenResponse,
    SelfSubmissionCreate,
    SubmissionOut,
    WearableProviderOut,
    WearableStatus,
)
from app.services import wearables as wsvc
from app.services.forms import form_out, version_out
from app.services.metrics import metric_out, series_points
from app.services.people import athletes_out
from app.services.reminders import due_today
from app.services.submissions import submissions_out
from app.timeutil import today_in

router = APIRouter(prefix="/orgs/{org_id}/me", tags=["athlete self-service"])


def _self(db: DbSession, p: Principal) -> Athlete:
    athlete = db.get(Athlete, p.athlete_id)
    if athlete is None:  # pragma: no cover - require_athlete guarantees it
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="athlete not found")
    return athlete


def _athlete_today(p: Principal, athlete: Athlete) -> dt.date:
    return today_in(athlete.timezone or p.org.timezone)


@router.get("/athlete", response_model=AthleteOut)
def me_athlete(p: AthleteSelfDep, db: DbSession) -> AthleteOut:
    return athletes_out(db, p, [_self(db, p)])[0]


@router.get("/forms", response_model=list[DueForm])
def me_forms(p: AthleteSelfDep, db: DbSession, date: Annotated[dt.date | None, Query()] = None) -> list[DueForm]:
    athlete = _self(db, p)
    day = date or _athlete_today(p, athlete)
    forms = list(
        db.scalars(
            select(Form).where(
                Form.org_id == p.org_id,
                Form.athlete_can_submit.is_(True),
                Form.archived.is_(False),
                Form.current_version_id.is_not(None),
            )
        ).unique()
    )
    due = due_today(db, p.org_id, athlete.id, day, load_group_tree(db, p.org_id))
    form_ids = [f.id for f in forms]
    done = set(
        db.scalars(
            select(Submission.form_id).where(
                Submission.athlete_id == athlete.id,
                Submission.form_id.in_(form_ids),
                Submission.local_date == day,
                Submission.deleted_at.is_(None),
            )
        )
    )
    last = dict(
        db.execute(
            select(Submission.form_id, func.max(Submission.created_at))
            .where(
                Submission.athlete_id == athlete.id,
                Submission.form_id.in_(form_ids),
                Submission.deleted_at.is_(None),
            )
            .group_by(Submission.form_id)
        ).all()
    )
    forms.sort(key=lambda f: (f.id not in due, due.get(f.id, "99:99"), f.name.lower()))
    return [
        DueForm(
            form=form_out(f),
            version=version_out(f.current_version),  # type: ignore[arg-type]
            due_time=due.get(f.id),
            completed=f.id in done,
            last_submitted_at=last.get(f.id),
        )
        for f in forms
        if f.current_version is not None
    ]


@router.get("/submissions", response_model=Page[SubmissionOut])
def me_submissions(
    p: AthleteSelfDep,
    db: DbSession,
    form_id: Annotated[uuid.UUID | None, Query()] = None,
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[SubmissionOut]:
    athlete = _self(db, p)
    q = (
        select(Submission, Athlete)
        .join(Athlete, Athlete.id == Submission.athlete_id)
        .join(Form, Form.id == Submission.form_id)
        .where(
            Submission.org_id == p.org_id,
            Submission.athlete_id == athlete.id,
            Submission.deleted_at.is_(None),
            Form.athlete_can_view.is_(True),
        )
    )
    if form_id is not None:
        q = q.where(Submission.form_id == form_id)
    if start is not None:
        q = q.where(Submission.local_date >= start)
    if end is not None:
        q = q.where(Submission.local_date <= end)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.execute(
        q.order_by(Submission.local_date.desc(), Submission.observed_at.desc()).limit(limit).offset(offset)
    ).all()
    return Page[SubmissionOut](items=submissions_out(p, [(s, a) for s, a in rows]), total=total)


@router.post("/submissions", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
def me_submit(body: SelfSubmissionCreate, p: AthleteSelfDep, db: DbSession) -> SubmissionOut:
    athlete = _self(db, p)
    form = db.get(Form, body.form_id)
    if form is None or form.org_id != p.org_id or not form.athlete_can_submit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="form not found")
    return create_for(db, p, body.form_id, athlete.id, body, source="mobile")


@router.get("/metrics", response_model=list[MetricSeries])
def me_metrics(
    p: AthleteSelfDep,
    db: DbSession,
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
) -> list[MetricSeries]:
    from app.metrics.engine import MetricEngine

    athlete = _self(db, p)
    end = end or _athlete_today(p, athlete)
    start = start or end - dt.timedelta(days=27)
    if start > end or (end - start).days > 3 * 366:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="invalid date range")
    defs = db.scalars(
        select(MetricDefinition)
        .where(MetricDefinition.org_id == p.org_id, MetricDefinition.athlete_visible.is_(True))
        .order_by(MetricDefinition.name)
    ).all()
    engine = MetricEngine(db, p.org_id, [athlete.id])
    out: list[MetricSeries] = []
    for m in defs:
        try:
            pts = series_points(engine, m, start, end)
        except HTTPException:
            continue
        out.append(MetricSeries(metric=metric_out(m), athlete_id=athlete.id, points=pts.get(athlete.id, [])))
    return out


@router.get("/wearables", response_model=WearableStatus)
def me_wearables(p: AthleteSelfDep, db: DbSession) -> WearableStatus:
    athlete = _self(db, p)
    with OpenWearablesClient.from_settings() as client:
        wsvc.link_athlete(db, client, athlete)
        db.commit()
        return wsvc.wearable_status(db, client, athlete, p.org)


@router.get("/wearables/providers", response_model=list[WearableProviderOut])
def me_wearable_providers(p: AthleteSelfDep) -> list[WearableProviderOut]:
    with OpenWearablesClient.from_settings() as client:
        return wsvc.providers(client)


@router.post("/wearables/connect", response_model=ConnectResponse)
def me_connect(body: ConnectRequest, p: AthleteSelfDep, db: DbSession) -> ConnectResponse:
    return connect_athlete(db, _self(db, p), body)


@router.post("/wearables/sdk-token", response_model=SdkTokenResponse)
def me_sdk_token(p: AthleteSelfDep, db: DbSession) -> SdkTokenResponse:
    from app.config import settings
    from app.integrations.open_wearables.errors import OpenWearablesNotConfiguredError

    if not settings.ow_sdk_configured:
        raise OpenWearablesNotConfiguredError("OW_APP_ID / OW_APP_SECRET are not configured")
    athlete = _self(db, p)
    with OpenWearablesClient.from_settings() as client:
        token = wsvc.sdk_token(db, client, athlete)
    db.commit()
    return token
