"""Metric definitions, series and the readiness board."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.metrics.engine import CycleError, MetricEngine, MetricError, parse_ref
from app.metrics.transforms import TransformError
from app.models import Athlete, Form, MetricDefinition
from app.permissions import Principal
from app.schemas.domain import (
    MetricDefinitionOut,
    MetricPoint,
    MetricSeries,
    ReadinessAthlete,
    ReadinessBoard,
    ReadinessCell,
    ReadinessRow,
    Thresholds,
)
from app.services.orgs import org_settings
from app.services.people import display_name
from app.services.reminders import count_due_open

READINESS_WINDOW_DAYS = 3


def metric_out(m: MetricDefinition) -> MetricDefinitionOut:
    th = m.thresholds
    return MetricDefinitionOut(
        id=m.id,
        org_id=m.org_id,
        slug=m.slug,
        name=m.name,
        description=m.description,
        unit=m.unit,
        source=m.source,
        daily_agg=m.daily_agg,  # type: ignore[arg-type]
        fill_zero=m.fill_zero,
        transform=m.transform,  # type: ignore[arg-type]
        params=m.params or {},
        thresholds=Thresholds(**th) if th else None,
        decimals=m.decimals,
        athlete_visible=m.athlete_visible,
        builtin=m.builtin,
    )


def unprocessable(message: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message)


def get_metric_by_slug(db: Session, org_id: uuid.UUID, slug: str) -> MetricDefinition:
    m = db.scalar(select(MetricDefinition).where(MetricDefinition.org_id == org_id, MetricDefinition.slug == slug))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="metric not found")
    return m


def source_forms(db: Session, engine: MetricEngine, defn: MetricDefinition) -> list[Form]:
    """Forms whose data the metric reads (through metric: chains). Missing forms are skipped."""
    try:
        refs = engine.form_refs(defn)
    except (CycleError, MetricError) as exc:
        raise unprocessable(str(exc)) from exc
    forms: list[Form] = []
    for ref in refs:
        form = db.scalar(select(Form).where(Form.org_id == engine.org_id, Form.slug == ref.name))
        if form is not None:
            forms.append(form)
    return forms


def can_read_metric(p: Principal, forms: list[Form], athlete_id: uuid.UUID) -> bool:
    return all(p.can_read_form_data(f, athlete_id) for f in forms)


def series_points(
    engine: MetricEngine, defn: MetricDefinition, start: dt.date, end: dt.date
) -> dict[uuid.UUID, list[MetricPoint]]:
    try:
        computed = engine.points(defn, start, end)
    except (CycleError, MetricError, TransformError) as exc:
        raise unprocessable(f"metric {defn.slug}: {exc}") from exc
    return {
        aid: [MetricPoint(date=pt.date, value=pt.value, flag=pt.flag, source=pt.source) for pt in pts]  # type: ignore[arg-type]
        for aid, pts in computed.items()
    }


def metric_series(
    db: Session, p: Principal, defn: MetricDefinition, athlete_id: uuid.UUID, start: dt.date, end: dt.date
) -> MetricSeries:
    engine = MetricEngine(db, p.org_id, [athlete_id])
    points = series_points(engine, defn, start, end)
    return MetricSeries(metric=metric_out(defn), athlete_id=athlete_id, points=points.get(athlete_id, []))


def readiness_board(
    db: Session, p: Principal, athletes: list[Athlete], day: dt.date, group_id: uuid.UUID | None
) -> ReadinessBoard:
    slugs = org_settings(p.org).readiness_metrics
    defs = {
        m.slug: m
        for m in db.scalars(
            select(MetricDefinition).where(MetricDefinition.org_id == p.org_id, MetricDefinition.slug.in_(slugs))
        )
    }
    columns = [defs[s] for s in slugs if s in defs]
    ids = [a.id for a in athletes]
    engine = MetricEngine(db, p.org_id, ids)
    rights = p.rights_for(ids)
    start = day - dt.timedelta(days=READINESS_WINDOW_DAYS)
    cells: dict[str, dict[uuid.UUID, ReadinessCell]] = {}
    for m in columns:
        forms = source_forms(db, engine, m)
        try:
            pts = series_points(engine, m, start, day)
        except HTTPException:
            pts = {}
        per_athlete: dict[uuid.UUID, ReadinessCell] = {}
        for aid in ids:
            if not all(p.can_read_form_data(f, aid, rights.get(aid)) for f in forms):
                per_athlete[aid] = ReadinessCell(value=None, flag=None, date=None)
                continue
            latest = next((pt for pt in reversed(pts.get(aid, [])) if pt.value is not None), None)
            per_athlete[aid] = (
                ReadinessCell(value=latest.value, flag=latest.flag, date=latest.date)
                if latest
                else ReadinessCell(value=None, flag=None, date=None)
            )
        cells[m.slug] = per_athlete
    from app.permissions import load_group_tree

    tree = load_group_tree(db, p.org_id)
    rows = [
        ReadinessRow(
            athlete=ReadinessAthlete(
                id=a.id,
                display_name=display_name(a, bool(rights.get(a.id) and rights[a.id].identifiable)),
                code=a.code,
                position=a.position,
            ),
            cells={m.slug: cells[m.slug][a.id] for m in columns},
            due_forms=count_due_open(db, p.org, a.id, day, tree),
        )
        for a in athletes
    ]
    return ReadinessBoard(date=day, group_id=group_id, columns=[metric_out(m) for m in columns], rows=rows)


def apply_metric_fields(m: MetricDefinition, fields: dict[str, Any]) -> None:
    for key, value in fields.items():
        if key == "thresholds":
            value = value if value is None or isinstance(value, dict) else value.model_dump()
        setattr(m, key, value)


def validate_definition(
    db: Session, org_id: uuid.UUID, slug: str, source: str, transform: str, params: dict[str, Any], check_source: bool
) -> None:
    from app.metrics.engine import check_cycles, validate_source
    from app.metrics.transforms import validate_params

    try:
        parse_ref(source)
        if check_source:
            validate_source(db, org_id, source)
        check_cycles(db, org_id, slug, source)
        validate_params(transform, params)
    except (MetricError, TransformError) as exc:
        raise unprocessable(str(exc)) from exc
