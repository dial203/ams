"""Metric definitions, series sources, series and the readiness board."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep, StaffDep
from app.integrations.open_wearables.daily import WEARABLE_METRICS
from app.metrics.engine import MetricEngine, numeric_form_fields
from app.models import Athlete, AthleteGroup, Form, Group, MetricDefinition
from app.permissions import current_membership_clause
from app.schemas.domain import (
    MetricCreate,
    MetricDefinitionOut,
    MetricSeries,
    MetricUpdate,
    ReadinessBoard,
    SeriesSourceOut,
)
from app.services.metrics import (
    apply_metric_fields,
    get_metric_by_slug,
    metric_out,
    metric_series,
    readiness_board,
    source_forms,
    validate_definition,
)
from app.services.people import get_visible_athlete

router = APIRouter(prefix="/orgs/{org_id}", tags=["metrics"])
MAX_SERIES_DAYS = 3 * 366


@router.get("/metrics", response_model=list[MetricDefinitionOut])
def list_metrics(p: StaffDep, db: DbSession) -> list[MetricDefinitionOut]:
    rows = db.scalars(
        select(MetricDefinition).where(MetricDefinition.org_id == p.org_id).order_by(MetricDefinition.name)
    ).all()
    return [metric_out(m) for m in rows]


@router.post("/metrics", response_model=MetricDefinitionOut, status_code=status.HTTP_201_CREATED)
def create_metric(body: MetricCreate, p: AdminDep, db: DbSession) -> MetricDefinitionOut:
    if db.scalar(
        select(MetricDefinition.id).where(MetricDefinition.org_id == p.org_id, MetricDefinition.slug == body.slug)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"metric slug {body.slug!r} already exists")
    validate_definition(db, p.org_id, body.slug, body.source, body.transform, body.params, check_source=True)
    m = MetricDefinition(org_id=p.org_id, builtin=False)
    apply_metric_fields(m, body.model_dump())
    db.add(m)
    db.flush()
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="metric.create", entity_type="metric", entity_id=m.id,
        details=body.model_dump(mode="json"),
    )
    db.commit()
    return metric_out(m)


def _get_metric(db: DbSession, org_id: uuid.UUID, metric_id: uuid.UUID) -> MetricDefinition:
    m = db.get(MetricDefinition, metric_id)
    if m is None or m.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="metric not found")
    return m


@router.patch("/metrics/{metric_id}", response_model=MetricDefinitionOut)
def update_metric(metric_id: uuid.UUID, body: MetricUpdate, p: AdminDep, db: DbSession) -> MetricDefinitionOut:
    m = _get_metric(db, p.org_id, metric_id)
    fields = body.model_dump(exclude_unset=True)
    for key in ("slug", "name", "source", "daily_agg", "fill_zero", "transform", "params", "decimals",
                "athlete_visible"):
        if key in fields and fields[key] is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key} cannot be null")
    if "slug" in fields and fields["slug"] != m.slug:
        if m.builtin:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="built-in metric slugs cannot change")
        if db.scalar(select(MetricDefinition.id).where(
            MetricDefinition.org_id == p.org_id, MetricDefinition.slug == fields["slug"]
        )):
            raise HTTPException(status.HTTP_409_CONFLICT, detail=f"metric slug {fields['slug']!r} already exists")
    source = fields.get("source", m.source)
    validate_definition(
        db,
        p.org_id,
        fields.get("slug", m.slug),
        source,
        fields.get("transform", m.transform),
        fields.get("params", m.params or {}),
        check_source="source" in fields and source != m.source,
    )
    before = metric_out(m).model_dump(mode="json")
    apply_metric_fields(m, {k: getattr(body, k) if k == "thresholds" else v for k, v in fields.items()})
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="metric.update", entity_type="metric", entity_id=m.id,
        details=audit.diff(before, metric_out(m).model_dump(mode="json")),
    )
    db.commit()
    return metric_out(m)


@router.delete("/metrics/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_metric(metric_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    m = _get_metric(db, p.org_id, metric_id)
    if m.builtin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="built-in metrics can be edited, not deleted")
    dependents = db.scalars(
        select(MetricDefinition.slug).where(
            MetricDefinition.org_id == p.org_id, MetricDefinition.source == f"metric:{m.slug}"
        )
    ).all()
    if dependents:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"metric is used by: {', '.join(dependents)}")
    db.delete(m)
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="metric.delete", entity_type="metric", entity_id=metric_id,
        details={"slug": m.slug},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/series-sources", response_model=list[SeriesSourceOut])
def series_sources(p: StaffDep, db: DbSession) -> list[SeriesSourceOut]:
    out: list[SeriesSourceOut] = []
    forms = db.scalars(
        select(Form).where(Form.org_id == p.org_id, Form.archived.is_(False)).order_by(Form.name)
    ).unique()
    for form in forms:
        if not p.can_read_form(form) or form.current_version is None:
            continue
        for key, (label, unit) in numeric_form_fields(form.current_version.schema).items():
            out.append(SeriesSourceOut(ref=f"form:{form.slug}.{key}", label=f"{form.name}: {label}", unit=unit,
                                       kind="form"))
    for key, (unit, label) in WEARABLE_METRICS.items():
        out.append(SeriesSourceOut(ref=f"wearable:{key}", label=label, unit=unit, kind="wearable"))
    for m in db.scalars(select(MetricDefinition).where(MetricDefinition.org_id == p.org_id).order_by(MetricDefinition.name)):
        out.append(SeriesSourceOut(ref=f"metric:{m.slug}", label=m.name, unit=m.unit, kind="metric"))
    return out


def _range(start: dt.date | None, end: dt.date | None, today: dt.date) -> tuple[dt.date, dt.date]:
    end = end or today
    start = start or end - dt.timedelta(days=27)
    if start > end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="start must not be after end")
    if (end - start).days > MAX_SERIES_DAYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="date range too long (max 3 years)")
    return start, end


@router.get("/metrics/{slug}/series", response_model=MetricSeries)
def get_series(
    slug: str,
    p: PrincipalDep,
    db: DbSession,
    athlete_id: Annotated[uuid.UUID, Query()],
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
) -> MetricSeries:
    athlete, _ = get_visible_athlete(db, p, athlete_id)
    m = get_metric_by_slug(db, p.org_id, slug)
    if p.is_athlete and not m.athlete_visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="metric not found")
    if not p.is_athlete:
        forms = source_forms(db, MetricEngine(db, p.org_id, [athlete.id]), m)
        if not all(p.can_read_form_data(f, athlete.id) for f in forms):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="the metric's source form is not readable for you")
    s, e = _range(start, end, p.today)
    return metric_series(db, p, m, athlete.id, s, e)


@router.get("/dashboards/readiness", response_model=ReadinessBoard)
def readiness(
    p: StaffDep,
    db: DbSession,
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    date: Annotated[dt.date | None, Query()] = None,
) -> ReadinessBoard:
    day = date or p.today
    q = select(Athlete).where(
        Athlete.org_id == p.org_id, Athlete.status == "active", p.visible_athletes_clause(Athlete.id)
    )
    if group_id is not None:
        group = db.get(Group, group_id)
        if group is None or group.org_id != p.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")
        q = q.where(
            Athlete.id.in_(
                select(AthleteGroup.athlete_id).where(
                    AthleteGroup.group_id.in_(list(p.tree.descendants(group_id))), current_membership_clause(p.today)
                )
            )
        )
    athletes = list(db.scalars(q.order_by(Athlete.code)))
    return readiness_board(db, p, athletes, day, group_id)
