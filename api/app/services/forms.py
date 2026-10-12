"""Forms, immutable versions, templates and schedules."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit
from app.forms.schema import empty_schema, validate_schema
from app.models import Form, FormSchedule, FormVersion, Organization
from app.permissions import Principal
from app.schemas.domain import FormOut, FormScheduleOut, FormVersionOut
from app.services.orgs import slugify
from app.templates import TEMPLATES, FormTemplate


def version_out(v: FormVersion) -> FormVersionOut:
    return FormVersionOut(id=v.id, form_id=v.form_id, version=v.version, schema=v.schema, published_at=v.published_at)


def form_out(form: Form) -> FormOut:
    return FormOut(
        id=form.id,
        org_id=form.org_id,
        slug=form.slug,
        name=form.name,
        description=form.description,
        kind=form.kind,  # type: ignore[arg-type]
        sensitivity=form.sensitivity,  # type: ignore[arg-type]
        athlete_can_submit=form.athlete_can_submit,
        athlete_can_view=form.athlete_can_view,
        allow_multiple_per_day=form.allow_multiple_per_day,
        draft_schema=form.draft_schema or empty_schema(),
        current_version=version_out(form.current_version) if form.current_version else None,
        archived=form.archived,
        created_at=form.created_at,
        updated_at=form.updated_at,
    )


def schedule_out(s: FormSchedule) -> FormScheduleOut:
    return FormScheduleOut(
        id=s.id,
        form_id=s.form_id,
        group_id=s.group_id,
        recurrence=s.recurrence,  # type: ignore[arg-type]
        days_of_week=list(s.days_of_week or []),
        due_time=s.due_time,
        start_date=s.start_date,
        end_date=s.end_date,
        remind=s.remind,
        active=s.active,
    )


def get_form_or_404(db: Session, p: Principal, form_id: uuid.UUID) -> Form:
    form = db.get(Form, form_id)
    if form is None or form.org_id != p.org_id or not p.can_read_form(form):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="form not found")
    return form


def unique_form_slug(db: Session, org_id: uuid.UUID, base: str) -> str:
    candidate, n = base, 1
    while db.scalar(select(Form.id).where(Form.org_id == org_id, Form.slug == candidate)) is not None:
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def slug_taken(db: Session, org_id: uuid.UUID, slug: str, exclude: uuid.UUID | None = None) -> bool:
    q = select(Form.id).where(Form.org_id == org_id, Form.slug == slug)
    if exclude is not None:
        q = q.where(Form.id != exclude)
    return db.scalar(q.limit(1)) is not None


def form_snapshot(form: Form) -> dict[str, Any]:
    return {
        "slug": form.slug,
        "name": form.name,
        "description": form.description,
        "kind": form.kind,
        "sensitivity": form.sensitivity,
        "athlete_can_submit": form.athlete_can_submit,
        "athlete_can_view": form.athlete_can_view,
        "allow_multiple_per_day": form.allow_multiple_per_day,
        "archived": form.archived,
    }


def publish(db: Session, form: Form, user_id: uuid.UUID | None) -> tuple[FormVersion, bool]:
    """Publish the draft. Returns (version, created). Raises 422 with schema_errors when invalid."""
    draft = form.draft_schema or empty_schema()
    errors = validate_schema(draft)
    if errors:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "invalid schema", "schema_errors": [e.as_dict() for e in errors]},
        )
    if form.current_version is not None and form.current_version.schema == draft:
        return form.current_version, False
    latest = db.scalar(select(func.max(FormVersion.version)).where(FormVersion.form_id == form.id)) or 0
    version = FormVersion(form_id=form.id, version=latest + 1, schema=draft, published_by=user_id)
    db.add(version)
    db.flush()
    form.current_version_id = version.id
    form.current_version = version
    audit.record(
        db,
        org_id=form.org_id,
        user_id=user_id,
        action="form.publish",
        entity_type="form",
        entity_id=form.id,
        details={"version": version.version, "form_version_id": version.id},
    )
    return version, True


def install_template(
    db: Session,
    org: Organization,
    template: FormTemplate,
    user_id: uuid.UUID | None,
    name: str | None = None,
    slug: str | None = None,
) -> Form:
    if slug is not None and slug_taken(db, org.id, slug):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"form slug {slug!r} already exists")
    final_slug = slug or unique_form_slug(db, org.id, template.key)
    form = Form(
        org_id=org.id,
        slug=final_slug,
        name=name or template.name,
        description=template.description,
        kind=template.kind,
        sensitivity=template.sensitivity,
        athlete_can_submit=template.athlete_can_submit,
        athlete_can_view=template.athlete_can_view,
        allow_multiple_per_day=template.allow_multiple_per_day,
        draft_schema=template.schema_copy(),
        template_key=template.key,
    )
    db.add(form)
    db.flush()
    audit.record(
        db,
        org_id=org.id,
        user_id=user_id,
        action="form.create",
        entity_type="form",
        entity_id=form.id,
        details={"template": template.key, "after": form_snapshot(form)},
    )
    publish(db, form, user_id)
    return form


def get_template_or_404(key: str) -> FormTemplate:
    template = TEMPLATES.get(key)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="template not found")
    return template


def new_form_slug(db: Session, org_id: uuid.UUID, name: str) -> str:
    return unique_form_slug(db, org_id, slugify(name, sep="_")[:90] or "form")


def schedule_applies(s: FormSchedule, day: dt.date) -> bool:
    if not s.active or day < s.start_date or (s.end_date is not None and day > s.end_date):
        return False
    if s.recurrence == "daily":
        return True
    if s.recurrence == "weekly":
        return day.isoweekday() in (s.days_of_week or [])
    if s.recurrence == "once":
        return day == s.start_date
    return False
