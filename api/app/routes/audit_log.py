"""/orgs/{org_id}/audit."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.database import DbSession
from app.deps import AdminDep
from app.models import AuditLog
from app.schemas.common import Limit, Offset, Page
from app.schemas.domain import AuditEntryOut

router = APIRouter(prefix="/orgs/{org_id}", tags=["audit"])


@router.get("/audit", response_model=Page[AuditEntryOut])
def list_audit(
    p: AdminDep,
    db: DbSession,
    entity_type: Annotated[str | None, Query()] = None,
    entity_id: Annotated[uuid.UUID | None, Query()] = None,
    action: Annotated[str | None, Query()] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[AuditEntryOut]:
    q = select(AuditLog).where(AuditLog.org_id == p.org_id)
    if entity_type is not None:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        q = q.where(AuditLog.entity_id == entity_id)
    if action is not None:
        q = q.where(AuditLog.action == action)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(AuditLog.at.desc(), AuditLog.id).limit(limit).offset(offset)).all()
    return Page[AuditEntryOut](
        items=[
            AuditEntryOut(
                id=r.id,
                user_id=r.user_id,
                action=r.action,
                entity_type=r.entity_type,
                entity_id=r.entity_id,
                at=r.at,
                details=r.details or {},
            )
            for r in rows
        ],
        total=total,
    )
