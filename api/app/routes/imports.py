"""CSV/XLSX imports."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select, update

from app import audit
from app.database import DbSession
from app.deps import AdminDep, PrincipalDep
from app.models import Form, ImportBatch, Submission
from app.permissions import Principal
from app.schemas.domain import ImportBatchOut, ImportCommit, ImportPreview
from app.services import imports as svc
from app.services.forms import get_form_or_404
from app.timeutil import utcnow

router = APIRouter(prefix="/orgs/{org_id}", tags=["imports"])


def _writable_form(db: DbSession, p: Principal, form_id: uuid.UUID) -> Form:
    form = get_form_or_404(db, p, form_id)
    if p.is_athlete or not p.can_write_form_somewhere(form):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="write access to the form required")
    return form


@router.post("/forms/{form_id}/imports/preview", response_model=ImportPreview)
def preview(form_id: uuid.UUID, p: PrincipalDep, db: DbSession, file: Annotated[UploadFile, File()]) -> ImportPreview:
    form = _writable_form(db, p, form_id)
    data = file.file.read(svc.MAX_UPLOAD_BYTES + 1)
    result = svc.preview(db, p, form, file.filename or "upload.csv", data)
    db.commit()
    return result


@router.post("/forms/{form_id}/imports", response_model=ImportBatchOut, status_code=status.HTTP_201_CREATED)
def commit(form_id: uuid.UUID, body: ImportCommit, p: PrincipalDep, db: DbSession) -> ImportBatchOut:
    form = _writable_form(db, p, form_id)
    batch = svc.commit(db, p, form, body)
    db.commit()
    return svc.batch_out(batch)


@router.get("/imports", response_model=list[ImportBatchOut])
def list_batches(
    p: PrincipalDep, db: DbSession, form_id: Annotated[uuid.UUID | None, Query()] = None
) -> list[ImportBatchOut]:
    if p.is_athlete:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="staff role required")
    q = select(ImportBatch).where(ImportBatch.org_id == p.org_id, ImportBatch.deleted_at.is_(None))
    if form_id is not None:
        q = q.where(ImportBatch.form_id == form_id)
    batches = db.scalars(q.order_by(ImportBatch.created_at.desc())).all()
    forms = {f.id: f for f in db.scalars(select(Form).where(Form.org_id == p.org_id)).unique()}
    return [svc.batch_out(b) for b in batches if b.form_id in forms and p.can_read_form(forms[b.form_id])]


@router.delete("/imports/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_batch(batch_id: uuid.UUID, p: AdminDep, db: DbSession) -> Response:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or batch.org_id != p.org_id or batch.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="import batch not found")
    now = utcnow()
    result = db.execute(
        update(Submission)
        .where(Submission.import_batch_id == batch.id, Submission.deleted_at.is_(None))
        .values(deleted_at=now)
    )
    batch.deleted_at = now
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="import.delete",
        entity_type="import_batch",
        entity_id=batch.id,
        details={"submissions_deleted": result.rowcount},  # type: ignore[attr-defined]
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
