"""Creating, updating and serializing submissions; CSV export."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.forms.engine import validate
from app.forms.schema import index_schema
from app.models import Athlete, Form, FormVersion, Organization, Submission
from app.permissions import AthleteRights, Principal
from app.schemas.domain import SubmissionOut
from app.services.people import display_name
from app.timeutil import local_date as to_local_date
from app.timeutil import utcnow

SENSITIVE = frozenset({"medical", "research"})


class SubmissionInvalid(Exception):
    def __init__(self, field_errors: dict[str, str]) -> None:
        super().__init__("invalid submission")
        self.field_errors = field_errors

    def http(self) -> HTTPException:
        return HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "invalid submission", "field_errors": self.field_errors},
        )


class DuplicateSubmission(Exception):
    def http(self) -> HTTPException:
        return HTTPException(
            status.HTTP_409_CONFLICT, detail="a submission for this form already exists for that local_date"
        )


class FormNotPublished(Exception):
    def http(self) -> HTTPException:
        return HTTPException(status.HTTP_409_CONFLICT, detail="form has no published version")


def athlete_timezone(athlete: Athlete, org: Organization) -> str:
    return athlete.timezone or org.timezone


def submission_out(sub: Submission, athlete: Athlete, rights: AthleteRights | None) -> SubmissionOut:
    return SubmissionOut(
        id=sub.id,
        org_id=sub.org_id,
        form_id=sub.form_id,
        form_version_id=sub.form_version_id,
        form_version=sub.form_version.version,
        athlete_id=sub.athlete_id,
        athlete_display_name=display_name(athlete, bool(rights and rights.identifiable)),
        submitted_by=sub.submitted_by,
        observed_at=sub.observed_at,
        local_date=sub.local_date,
        values=sub.values or {},
        computed=sub.computed or {},
        source=sub.source,  # type: ignore[arg-type]
        import_batch_id=sub.import_batch_id,
        created_at=sub.created_at,
        updated_at=sub.updated_at,
    )


def submissions_out(p: Principal, rows: Sequence[tuple[Submission, Athlete]]) -> list[SubmissionOut]:
    rights = p.rights_for(a.id for _, a in rows)
    return [submission_out(s, a, rights.get(a.id)) for s, a in rows]


def has_submission_on(
    db: Session, form_id: uuid.UUID, athlete_id: uuid.UUID, day: dt.date, exclude: uuid.UUID | None = None
) -> bool:
    q = select(Submission.id).where(
        Submission.form_id == form_id,
        Submission.athlete_id == athlete_id,
        Submission.local_date == day,
        Submission.deleted_at.is_(None),
    )
    if exclude is not None:
        q = q.where(Submission.id != exclude)
    return db.scalar(q.limit(1)) is not None


def snapshot(sub: Submission) -> dict[str, Any]:
    return {
        "values": sub.values,
        "computed": sub.computed,
        "observed_at": sub.observed_at,
        "local_date": sub.local_date,
        "form_version_id": sub.form_version_id,
    }


def create_submission(
    db: Session,
    *,
    org: Organization,
    form: Form,
    athlete: Athlete,
    values: dict[str, Any],
    user_id: uuid.UUID | None,
    source: str,
    observed_at: dt.datetime | None = None,
    local_date: dt.date | None = None,
    import_batch_id: uuid.UUID | None = None,
    pending_days: set[tuple[uuid.UUID, dt.date]] | None = None,
    dry_run: bool = False,
) -> Submission:
    """Validate with the form's current version and store. The server recomputes calculated fields.

    ``pending_days`` lets batch callers (bulk, imports) detect duplicates inside the batch itself.
    """
    if form.archived:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="form is archived")
    version = form.current_version
    if version is None:
        raise FormNotPublished()
    result = validate(version.schema, values)
    if not result.ok:
        raise SubmissionInvalid(result.errors)
    observed = observed_at or utcnow()
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=dt.UTC)
    day = local_date or to_local_date(observed, athlete_timezone(athlete, org))
    if not form.allow_multiple_per_day:
        key = (athlete.id, day)
        if has_submission_on(db, form.id, athlete.id, day) or (pending_days is not None and key in pending_days):
            raise DuplicateSubmission()
        if pending_days is not None:
            pending_days.add(key)
    sub = Submission(
        id=uuid.uuid4(),
        org_id=org.id,
        form_id=form.id,
        form_version_id=version.id,
        athlete_id=athlete.id,
        submitted_by=user_id,
        observed_at=observed,
        local_date=day,
        values=result.values,
        computed=result.computed,
        source=source,
        import_batch_id=import_batch_id,
    )
    sub.form_version = version
    if dry_run:
        return sub
    db.add(sub)
    db.flush()
    audit.record(
        db,
        org_id=org.id,
        user_id=user_id,
        action="submission.create",
        entity_type="submission",
        entity_id=sub.id,
        details={"form_id": form.id, "athlete_id": athlete.id, "local_date": day, "source": source},
    )
    return sub


def update_submission(
    db: Session,
    *,
    org: Organization,
    form: Form,
    athlete: Athlete,
    sub: Submission,
    user_id: uuid.UUID,
    values: dict[str, Any] | None,
    observed_at: dt.datetime | None,
    local_date: dt.date | None,
) -> Submission:
    """Validated against the submission's *own* form version, never the current one."""
    before = snapshot(sub)
    version = db.get(FormVersion, sub.form_version_id)
    assert version is not None
    if values is not None:
        result = validate(version.schema, values)
        if not result.ok:
            raise SubmissionInvalid(result.errors)
        sub.values = result.values
        sub.computed = result.computed
    if observed_at is not None:
        sub.observed_at = observed_at if observed_at.tzinfo else observed_at.replace(tzinfo=dt.UTC)
        if local_date is None:
            sub.local_date = to_local_date(sub.observed_at, athlete_timezone(athlete, org))
    if local_date is not None:
        sub.local_date = local_date
    if (
        not form.allow_multiple_per_day
        and sub.local_date != before["local_date"]
        and has_submission_on(db, form.id, athlete.id, sub.local_date, exclude=sub.id)
    ):
        raise DuplicateSubmission()
    sub.updated_at = utcnow()
    audit.record(
        db,
        org_id=org.id,
        user_id=user_id,
        action="submission.update",
        entity_type="submission",
        entity_id=sub.id,
        details=audit.diff(before, snapshot(sub)),
    )
    return sub


def audit_reads(db: Session, p: Principal, rows: Iterable[tuple[Submission, Form]], action: str) -> None:
    """Record reads of medical/research submissions (one entry per request)."""
    sensitive = [(s, f) for s, f in rows if f.sensitivity in SENSITIVE]
    if not sensitive:
        return
    ids = [s.id for s, _ in sensitive]
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action=action,
        entity_type="submission",
        entity_id=ids[0] if len(ids) == 1 else None,
        details={
            "submission_ids": ids,
            "form_ids": sorted({str(f.id) for _, f in sensitive}),
            "athlete_ids": sorted({str(s.athlete_id) for s, _ in sensitive}),
        },
    )


# ----------------------------------------------------------------------------- export


def export_columns(versions: Sequence[FormVersion], rows: Sequence[Submission]) -> tuple[list[str], list[str]]:
    """Field and calculated columns: the latest version's order, then any extra keys seen in older data."""
    ordered = sorted(versions, key=lambda v: -v.version)
    fields: list[str] = []
    calcs: list[str] = []
    for v in ordered:
        idx = index_schema(v.schema)
        for f in idx.input_fields:
            if f.key not in fields:
                fields.append(f.key)
        for c in idx.calculated_fields:
            if c.key not in calcs:
                calcs.append(c.key)
    for s in rows:
        for k in (s.values or {}):
            if k not in fields and k not in calcs:
                fields.append(k)
        for k in (s.computed or {}):
            if k not in calcs and k not in fields:
                calcs.append(k)
    return fields, calcs


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, list):
        return ";".join(_cell(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return str(value)


def build_csv(
    rows: Sequence[tuple[Submission, Athlete]],
    versions: Sequence[FormVersion],
    include_name: bool,
) -> str:
    fields, calcs = export_columns(versions, [s for s, _ in rows]) if versions else ([], [])
    header = ["submission_id", "athlete_code"]
    if include_name:
        header.append("athlete_name")
    header += ["local_date", "observed_at", "source", "form_version", *fields, *calcs]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for s, a in rows:
        line = [str(s.id), a.code]
        if include_name:
            line.append(display_name(a, True))
        line += [s.local_date.isoformat(), s.observed_at.isoformat(), s.source, str(s.form_version.version)]
        line += [_cell((s.values or {}).get(k)) for k in fields]
        line += [_cell((s.computed or {}).get(k)) for k in calcs]
        writer.writerow(line)
    return buf.getvalue()
