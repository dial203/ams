"""/orgs/{org_id}/submissions."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import Select, func, select

from app import audit
from app.database import DbSession
from app.deps import PrincipalDep
from app.models import Athlete, AthleteGroup, Form, FormVersion, Group, Submission
from app.permissions import Principal, current_membership_clause
from app.schemas.common import Limit, Offset, Page, SubmissionSource
from app.schemas.domain import (
    BulkError,
    BulkSubmissionCreate,
    BulkSubmissionResult,
    SubmissionCreate,
    SubmissionOut,
    SubmissionUpdate,
)
from app.services.forms import get_form_or_404
from app.services.people import get_visible_athlete
from app.services.submissions import (
    DuplicateSubmissionError,
    FormNotPublishedError,
    SubmissionInvalidError,
    audit_reads,
    build_csv,
    create_submission,
    submission_out,
    submissions_out,
    update_submission,
)
from app.timeutil import utcnow

router = APIRouter(prefix="/orgs/{org_id}/submissions", tags=["submissions"])


def readable_query(p: Principal) -> Select[tuple[Submission, Athlete, Form]]:
    return (
        select(Submission, Athlete, Form)
        .join(Athlete, Athlete.id == Submission.athlete_id)
        .join(Form, Form.id == Submission.form_id)
        .where(
            Submission.org_id == p.org_id,
            Submission.deleted_at.is_(None),
            p.visible_athletes_clause(Submission.athlete_id),
            p.readable_submissions_clause(Submission.athlete_id),
        )
    )


def _group_filter(db: DbSession, p: Principal, group_id: uuid.UUID) -> list[uuid.UUID]:
    group = db.get(Group, group_id)
    if group is None or group.org_id != p.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")
    return list(p.tree.descendants(group_id))


def _apply_filters(
    db: DbSession,
    p: Principal,
    q: Select[tuple[Submission, Athlete, Form]],
    form_id: uuid.UUID | None,
    athlete_id: uuid.UUID | None,
    group_id: uuid.UUID | None,
    start: dt.date | None,
    end: dt.date | None,
    source: str | None,
) -> Select[tuple[Submission, Athlete, Form]]:
    if form_id is not None:
        q = q.where(Submission.form_id == form_id)
    if athlete_id is not None:
        q = q.where(Submission.athlete_id == athlete_id)
    if group_id is not None:
        groups = _group_filter(db, p, group_id)
        q = q.where(
            Submission.athlete_id.in_(
                select(AthleteGroup.athlete_id).where(
                    AthleteGroup.group_id.in_(groups), current_membership_clause(p.today)
                )
            )
        )
    if start is not None:
        q = q.where(Submission.local_date >= start)
    if end is not None:
        q = q.where(Submission.local_date <= end)
    if source is not None:
        q = q.where(Submission.source == source)
    return q


ORDER = (Submission.local_date.desc(), Submission.observed_at.desc(), Submission.created_at.desc())


@router.get("", response_model=Page[SubmissionOut])
def list_submissions(
    p: PrincipalDep,
    db: DbSession,
    form_id: Annotated[uuid.UUID | None, Query()] = None,
    athlete_id: Annotated[uuid.UUID | None, Query()] = None,
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
    source: Annotated[SubmissionSource | None, Query()] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[SubmissionOut]:
    q = _apply_filters(db, p, readable_query(p), form_id, athlete_id, group_id, start, end, source)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.execute(q.order_by(*ORDER).limit(limit).offset(offset)).unique().all()
    audit_reads(db, p, [(s, f) for s, _, f in rows], "submission.read")
    db.commit()
    return Page[SubmissionOut](items=submissions_out(p, [(s, a) for s, a, _ in rows]), total=total)


@router.post("", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
def create(body: SubmissionCreate, p: PrincipalDep, db: DbSession) -> SubmissionOut:
    return create_for(db, p, body.form_id, body.athlete_id, body, source="mobile" if p.is_athlete else "web")


def create_for(
    db: DbSession,
    p: Principal,
    form_id: uuid.UUID,
    athlete_id: uuid.UUID,
    body: SubmissionCreate | object,
    source: str,
) -> SubmissionOut:
    form = get_form_or_404(db, p, form_id)
    athlete, rights = get_visible_athlete(db, p, athlete_id)
    if not p.can_write_form_data(form, athlete.id, rights):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to this form for this athlete required")
    try:
        sub = create_submission(
            db,
            org=p.org,
            form=form,
            athlete=athlete,
            values=body.values,  # type: ignore[attr-defined]
            user_id=p.user_id,
            source=source,
            observed_at=body.observed_at,  # type: ignore[attr-defined]
            local_date=body.local_date,  # type: ignore[attr-defined]
        )
    except (SubmissionInvalidError, DuplicateSubmissionError, FormNotPublishedError) as exc:
        raise exc.http() from exc
    db.commit()
    return submission_out(sub, athlete, rights)


@router.post("/bulk", response_model=BulkSubmissionResult)
def bulk_create(body: BulkSubmissionCreate, p: PrincipalDep, db: DbSession) -> BulkSubmissionResult:
    form = get_form_or_404(db, p, body.form_id)
    if form.current_version is None:
        raise FormNotPublishedError().http()
    if form.archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="form is archived")
    ids = [e.athlete_id for e in body.entries]
    athletes = {a.id: a for a in db.scalars(select(Athlete).where(Athlete.org_id == p.org_id, Athlete.id.in_(ids)))}
    rights = p.rights_for(ids)
    created: list[SubmissionOut] = []
    errors: list[BulkError] = []
    pending: set[tuple[uuid.UUID, dt.date]] = set()
    for entry in body.entries:
        athlete = athletes.get(entry.athlete_id)
        r = rights.get(entry.athlete_id)
        if athlete is None or r is None:
            errors.append(BulkError(athlete_id=entry.athlete_id, field_errors={"athlete_id": "not_found"}))
            continue
        if not p.can_write_form_data(form, athlete.id, r):
            errors.append(BulkError(athlete_id=entry.athlete_id, field_errors={"athlete_id": "forbidden"}))
            continue
        try:
            with db.begin_nested():
                sub = create_submission(
                    db,
                    org=p.org,
                    form=form,
                    athlete=athlete,
                    values=entry.values,
                    user_id=p.user_id,
                    source="web",
                    observed_at=body.observed_at,
                    local_date=body.local_date,
                    pending_days=pending,
                )
        except SubmissionInvalidError as exc:
            errors.append(BulkError(athlete_id=entry.athlete_id, field_errors=exc.field_errors))
            continue
        except DuplicateSubmissionError:
            errors.append(BulkError(athlete_id=entry.athlete_id, field_errors={"local_date": "duplicate"}))
            continue
        created.append(submission_out(sub, athlete, r))
    db.commit()
    return BulkSubmissionResult(created=created, errors=errors)


@router.get(
    "/export",
    response_class=Response,
    responses={200: {"content": {"text/csv": {"schema": {"type": "string"}}}, "description": "CSV file"}},
)
def export_csv(
    p: PrincipalDep,
    db: DbSession,
    form_id: Annotated[uuid.UUID, Query()],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    start: Annotated[dt.date | None, Query()] = None,
    end: Annotated[dt.date | None, Query()] = None,
    deidentified: Annotated[bool, Query()] = False,
) -> Response:
    form = get_form_or_404(db, p, form_id)
    q = _apply_filters(db, p, readable_query(p), form.id, None, group_id, start, end, None)
    rows = db.execute(q.order_by(Submission.local_date, Submission.observed_at, Submission.created_at)).unique().all()
    versions = list(db.scalars(select(FormVersion).where(FormVersion.form_id == form.id)))
    rights = p.rights_for({a.id for _, a, _ in rows})
    if deidentified:
        include_name = False
    elif rows:
        # One masked athlete in the export removes the name column for everyone (stable shape, no leak).
        include_name = all(rights.get(a.id) is not None and rights[a.id].identifiable for _, a, _ in rows)
    else:
        include_name = p.is_admin or p.is_athlete or bool(p.identifiable_group_ids)
    body = build_csv([(s, a) for s, a, _ in rows], versions, include_name)
    audit_reads(db, p, [(s, f) for s, _, f in rows], "submission.export")
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="submission.export_csv",
        entity_type="form",
        entity_id=form.id,
        details={"rows": len(rows), "deidentified": not include_name},
    )
    db.commit()
    filename = f"{form.slug}-{utcnow().date().isoformat()}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _get_readable(db: DbSession, p: Principal, submission_id: uuid.UUID) -> tuple[Submission, Athlete, Form]:
    row = db.execute(readable_query(p).where(Submission.id == submission_id)).unique().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="submission not found")
    return row[0], row[1], row[2]


@router.get("/{submission_id}", response_model=SubmissionOut)
def get_submission(submission_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> SubmissionOut:
    sub, athlete, form = _get_readable(db, p, submission_id)
    audit_reads(db, p, [(sub, form)], "submission.read")
    db.commit()
    return submission_out(sub, athlete, p.rights(athlete.id))


@router.patch("/{submission_id}", response_model=SubmissionOut)
def patch_submission(submission_id: uuid.UUID, body: SubmissionUpdate, p: PrincipalDep, db: DbSession) -> SubmissionOut:
    sub, athlete, form = _get_readable(db, p, submission_id)
    rights = p.rights(athlete.id)
    if not p.can_write_form_data(form, athlete.id, rights):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access required")
    try:
        update_submission(
            db,
            org=p.org,
            form=form,
            athlete=athlete,
            sub=sub,
            user_id=p.user_id,
            values=body.values,
            observed_at=body.observed_at,
            local_date=body.local_date,
        )
    except (SubmissionInvalidError, DuplicateSubmissionError) as exc:
        raise exc.http() from exc
    db.commit()
    return submission_out(sub, athlete, rights)


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(submission_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> Response:
    sub, athlete, form = _get_readable(db, p, submission_id)
    if not p.can_write_form_data(form, athlete.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access required")
    sub.deleted_at = utcnow()
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="submission.delete",
        entity_type="submission",
        entity_id=sub.id,
        details={"form_id": form.id, "athlete_id": athlete.id, "values": sub.values},
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
