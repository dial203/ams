"""Forms, versions, schedules, submissions, imports, wearable cache, metrics, audit, reminders."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, utcnow
from app.models.core import _in

FORM_KINDS = ("questionnaire", "session", "test", "medical", "profile", "import")
SENSITIVITIES = ("general", "medical", "research")
SUBMISSION_SOURCES = ("mobile", "web", "import", "api")
RECURRENCES = ("daily", "weekly", "once")


class Form(Base):
    __tablename__ = "form"
    __table_args__ = (
        UniqueConstraint("org_id", "slug"),
        CheckConstraint(_in("kind", FORM_KINDS), name="kind"),
        CheckConstraint(_in("sensitivity", SENSITIVITIES), name="sensitivity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16))
    sensitivity: Mapped[str] = mapped_column(String(16), default="general")
    athlete_can_submit: Mapped[bool] = mapped_column(Boolean, default=False)
    athlete_can_view: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_multiple_per_day: Mapped[bool] = mapped_column(Boolean, default=True)
    draft_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("form_version.id", ondelete="SET NULL", use_alter=True)
    )
    template_key: Mapped[str | None] = mapped_column(String(64))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow
    )

    current_version: Mapped[FormVersion | None] = relationship(
        foreign_keys=[current_version_id], lazy="joined", post_update=True
    )


class FormVersion(Base):
    __tablename__ = "form_version"
    __table_args__ = (UniqueConstraint("form_id", "version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    schema: Mapped[dict[str, Any]] = mapped_column(JSONB)
    published_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow
    )
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"))


class FormSchedule(Base):
    __tablename__ = "form_schedule"
    __table_args__ = (CheckConstraint(_in("recurrence", RECURRENCES), name="recurrence"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("org_group.id", ondelete="CASCADE"), index=True)
    recurrence: Mapped[str] = mapped_column(String(16))
    days_of_week: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    due_time: Mapped[str] = mapped_column(String(5), default="09:00")
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    remind: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)


class ImportUpload(Base):
    __tablename__ = "import_upload"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(1024))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class ImportBatch(Base):
    __tablename__ = "import_batch"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"), index=True)
    upload_id: Mapped[uuid.UUID | None] = mapped_column()
    filename: Mapped[str] = mapped_column(String(255))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # mapping + match settings (reusable)
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Submission(Base):
    __tablename__ = "submission"
    __table_args__ = (
        CheckConstraint(_in("source", SUBMISSION_SOURCES), name="source"),
        Index("ix_submission_org_form_date", "org_id", "form_id", "local_date"),
        Index("ix_submission_athlete_form_date", "athlete_id", "form_id", "local_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"))
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"))
    form_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form_version.id", ondelete="RESTRICT"))
    athlete_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("athlete.id", ondelete="CASCADE"))
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_account.id", ondelete="SET NULL"))
    observed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    local_date: Mapped[dt.date] = mapped_column(Date)
    values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    computed: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    source: Mapped[str] = mapped_column(String(16))
    import_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("import_batch.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    form_version: Mapped[FormVersion] = relationship(lazy="joined")


class WearableDaily(Base):
    """Long-format cache of per-day wearable values pulled from Open Wearables."""

    __tablename__ = "wearable_daily"
    __table_args__ = (
        UniqueConstraint("athlete_id", "local_date", "metric", "provider"),
        Index("ix_wearable_daily_athlete_metric_date", "athlete_id", "metric", "local_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("athlete.id", ondelete="CASCADE"))
    local_date: Mapped[dt.date] = mapped_column(Date)
    metric: Mapped[str] = mapped_column(String(40))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    provider: Mapped[str] = mapped_column(String(64))
    device: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow
    )


class MetricDefinition(Base):
    __tablename__ = "metric_definition"
    __table_args__ = (UniqueConstraint("org_id", "slug"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(300))
    daily_agg: Mapped[str] = mapped_column(String(8), default="last")
    fill_zero: Mapped[bool] = mapped_column(Boolean, default=False)
    transform: Mapped[str] = mapped_column(String(16), default="none")
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    thresholds: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    decimals: Mapped[int] = mapped_column(Integer, default=1)
    athlete_visible: Mapped[bool] = mapped_column(Boolean, default=False)
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=utcnow, onupdate=utcnow
    )


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_org_at", "org_id", "at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column()  # no FK: audit outlives users
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[uuid.UUID | None] = mapped_column()
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ReminderSent(Base):
    __tablename__ = "reminder_sent"
    __table_args__ = (UniqueConstraint("athlete_id", "form_id", "local_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("athlete.id", ondelete="CASCADE"))
    form_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("form.id", ondelete="CASCADE"))
    local_date: Mapped[dt.date] = mapped_column(Date)
    sent_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=utcnow)
