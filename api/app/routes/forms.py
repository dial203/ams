"""/orgs/{org_id}/forms, versions, templates, schedules."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep
from app.forms.schema import empty_schema, validate_schema
from app.models import Form, FormSchedule, FormVersion, Group
from app.schemas.common import FormKind
from app.schemas.domain import (
    FormCreate,
    FormOut,
    FormScheduleCreate,
    FormScheduleOut,
    FormScheduleUpdate,
    FormTemplateOut,
    FormUpdate,
    FormVersionOut,
    SchemaErrorOut,
    TemplateInstallRequest,
    ValidateSchemaRequest,
    ValidateSchemaResponse,
)
from app.services.forms import (
    form_out,
    form_snapshot,
    get_form_or_404,
    get_template_or_404,
    install_template,
    new_form_slug,
    publish,
    schedule_out,
    slug_taken,
    version_out,
)
from app.templates import TEMPLATES

router = APIRouter(prefix="/orgs/{org_id}", tags=["forms"])


@router.get("/forms", response_model=list[FormOut])
def list_forms(
    p: PrincipalDep,
    db: DbSession,
    kind: Annotated[FormKind | None, Query()] = None,
    include_archived: Annotated[bool, Query()] = False,
) -> list[FormOut]:
    q = select(Form).where(Form.org_id == p.org_id)
    if kind is not None:
        q = q.where(Form.kind == kind)
    if not include_archived:
        q = q.where(Form.archived.is_(False))
    forms = [f for f in db.scalars(q.order_by(Form.name)).unique() if p.can_read_form(f)]
    return [form_out(f) for f in forms]


@router.post("/forms", response_model=FormOut, status_code=status.HTTP_201_CREATED)
def create_form(body: FormCreate, p: AdminDep, db: DbSession) -> FormOut:
    if body.slug is not None and slug_taken(db, p.org_id, body.slug):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"form slug {body.slug!r} already exists")
    form = Form(
        org_id=p.org_id,
        slug=body.slug or new_form_slug(db, p.org_id, body.name),
        name=body.name,
        description=body.description,
        kind=body.kind,
        sensitivity=body.sensitivity,
        athlete_can_submit=body.athlete_can_submit,
        athlete_can_view=body.athlete_can_view,
        allow_multiple_per_day=body.allow_multiple_per_day,
        draft_schema=body.draft_schema if body.draft_schema is not None else empty_schema(),
    )
    db.add(form)
    db.flush()
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="form.create", entity_type="form", entity_id=form.id,
        details={"after": form_snapshot(form)},
    )
    db.commit()
    return form_out(form)


@router.post("/forms/validate-schema", response_model=ValidateSchemaResponse)
def validate_schema_route(body: ValidateSchemaRequest, p: AdminDep) -> ValidateSchemaResponse:
    errors = validate_schema(body.schema_)
    return ValidateSchemaResponse(
        valid=not errors, errors=[SchemaErrorOut(path=e.path, message=e.message) for e in errors]
    )


@router.get("/forms/{form_id}", response_model=FormOut)
def get_form(form_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> FormOut:
    return form_out(get_form_or_404(db, p, form_id))


@router.patch("/forms/{form_id}", response_model=FormOut)
def update_form(form_id: uuid.UUID, body: FormUpdate, p: AdminDep, db: DbSession) -> FormOut:
    form = get_form_or_404(db, p, form_id)
    fields = body.model_dump(exclude_unset=True)
    for key in ("name", "slug", "kind", "sensitivity", "athlete_can_submit", "athlete_can_view",
                "allow_multiple_per_day", "archived", "draft_schema"):
        if key in fields and fields[key] is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key} cannot be null")
    if "slug" in fields and slug_taken(db, p.org_id, fields["slug"], exclude=form.id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"form slug {fields['slug']!r} already exists")
    before = form_snapshot(form)
    draft_changed = "draft_schema" in fields and fields["draft_schema"] != form.draft_schema
    for key, value in fields.items():
        setattr(form, key, value)
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="form.update", entity_type="form", entity_id=form.id,
        details=audit.diff(before, form_snapshot(form)) | {"draft_schema_changed": draft_changed},
    )
    db.commit()
    return form_out(form)


@router.post("/forms/{form_id}/publish", response_model=FormVersionOut)
def publish_form(form_id: uuid.UUID, p: AdminDep, db: DbSession) -> FormVersionOut:
    form = get_form_or_404(db, p, form_id)
    version, _created = publish(db, form, p.user_id)
    db.commit()
    return version_out(version)


@router.get("/forms/{form_id}/versions", response_model=list[FormVersionOut])
def list_versions(form_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> list[FormVersionOut]:
    form = get_form_or_404(db, p, form_id)
    versions = db.scalars(
        select(FormVersion).where(FormVersion.form_id == form.id).order_by(FormVersion.version.desc())
    ).all()
    return [version_out(v) for v in versions]


@router.get("/form-templates", response_model=list[FormTemplateOut])
def list_templates(p: AdminDep) -> list[FormTemplateOut]:
    return [
        FormTemplateOut(
            key=t.key,
            name=t.name,
            description=t.description,
            kind=t.kind,  # type: ignore[arg-type]
            sensitivity=t.sensitivity,  # type: ignore[arg-type]
            schema=t.schema_copy(),
            references=list(t.references),
        )
        for t in TEMPLATES.values()
    ]


@router.post("/form-templates/{key}/install", response_model=FormOut, status_code=status.HTTP_201_CREATED)
def install(key: str, p: AdminDep, db: DbSession, body: TemplateInstallRequest | None = None) -> FormOut:
    template = get_template_or_404(key)
    body = body or TemplateInstallRequest()
    form = install_template(db, p.org, template, p.user_id, name=body.name, slug=body.slug)
    db.commit()
    return form_out(form)


# ----------------------------------------------------------------------------- schedules


@router.get("/forms/{form_id}/schedules", response_model=list[FormScheduleOut])
def list_schedules(form_id: uuid.UUID, p: PrincipalDep, db: DbSession) -> list[FormScheduleOut]:
    form = get_form_or_404(db, p, form_id)
    rows = db.scalars(
        select(FormSchedule).where(FormSchedule.form_id == form.id).order_by(FormSchedule.created_at)
    ).all()
    return [schedule_out(s) for s in rows]


def _check_group(db: DbSession, org_id: uuid.UUID, group_id: uuid.UUID) -> None:
    group = db.get(Group, group_id)
    if group is None or group.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="group not found")


@router.post("/forms/{form_id}/schedules", response_model=FormScheduleOut, status_code=status.HTTP_201_CREATED)
def create_schedule(form_id: uuid.UUID, body: FormScheduleCreate, p: AdminDep, db: DbSession) -> FormScheduleOut:
    form = get_form_or_404(db, p, form_id)
    _check_group(db, p.org_id, body.group_id)
    s = FormSchedule(org_id=p.org_id, form_id=form.id, **body.model_dump())
    db.add(s)
    db.flush()
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="schedule.create", entity_type="form_schedule",
        entity_id=s.id, details=body.model_dump() | {"form_id": form.id},
    )
    db.commit()
    return schedule_out(s)


def _get_schedule(db: DbSession, org_id: uuid.UUID, schedule_id: uuid.UUID) -> FormSchedule:
    s = db.get(FormSchedule, schedule_id)
    if s is None or s.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="schedule not found")
    return s


@router.patch("/form-schedules/{schedule_id}", response_model=FormScheduleOut)
def update_schedule(
    schedule_id: uuid.UUID, body: FormScheduleUpdate, p: AdminDep, db: DbSession
) -> FormScheduleOut:
    s = _get_schedule(db, p.org_id, schedule_id)
    fields = body.model_dump(exclude_unset=True)
    for key in ("group_id", "recurrence", "days_of_week", "due_time", "start_date", "remind", "active"):
        if key in fields and fields[key] is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key} cannot be null")
    if "group_id" in fields:
        _check_group(db, p.org_id, fields["group_id"])
    for key, value in fields.items():
        setattr(s, key, value)
    if s.recurrence == "weekly" and not s.days_of_week:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="weekly schedules need days_of_week")
    if s.end_date is not None and s.end_date < s.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="end_date must not be before start_date")
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="schedule.update", entity_type="form_schedule",
        entity_id=s.id, details=audit.jsonable(fields),
    )
    db.commit()
    return schedule_out(s)


@router.delete("/form-schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    s = _get_schedule(db, p.org_id, schedule_id)
    db.delete(s)
    audit.record(
        db, org_id=p.org_id, user_id=p.user_id, action="schedule.delete", entity_type="form_schedule",
        entity_id=schedule_id,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
