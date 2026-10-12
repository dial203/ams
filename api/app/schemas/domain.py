"""Athletes, forms, schedules, submissions, imports, wearables, metrics, readiness, audit."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.common import (
    AthleteStatus,
    Flag,
    FormKind,
    Recurrence,
    Sensitivity,
    Sex,
    SubmissionSource,
)
from app.timeutil import is_valid_timezone

FormSchema = dict[str, Any]
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _check_tz(v: str | None) -> str | None:
    if v is not None and not is_valid_timezone(v):
        raise ValueError("unknown IANA time zone")
    return v


# ----------------------------------------------------------------------------- athletes


class AthleteOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    code: str
    first_name: str | None
    last_name: str | None
    preferred_name: str | None
    email: str | None
    date_of_birth: dt.date | None
    display_name: str
    masked: bool
    sex: Sex | None
    position: str | None
    timezone: str | None
    status: AthleteStatus
    attributes: dict[str, Any]
    group_ids: list[uuid.UUID]
    user_id: uuid.UUID | None
    ow_user_id: uuid.UUID | None
    created_at: dt.datetime


class AthleteCreate(BaseModel):
    code: str | None = None
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    preferred_name: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    date_of_birth: dt.date | None = None
    sex: Sex | None = None
    position: str | None = Field(None, max_length=100)
    timezone: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    group_ids: list[uuid.UUID] = Field(default_factory=list)

    _tz = field_validator("timezone")(_check_tz)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        if v is not None and not CODE_RE.match(v):
            raise ValueError("code may contain letters, digits, '.', '_' and '-' (max 50)")
        return v


class AthleteUpdate(BaseModel):
    code: str | None = None
    first_name: str | None = Field(None, min_length=1, max_length=100)
    last_name: str | None = Field(None, min_length=1, max_length=100)
    preferred_name: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    date_of_birth: dt.date | None = None
    sex: Sex | None = None
    position: str | None = Field(None, max_length=100)
    timezone: str | None = None
    attributes: dict[str, Any] | None = None
    group_ids: list[uuid.UUID] | None = None
    status: AthleteStatus | None = None

    _tz = field_validator("timezone")(_check_tz)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str | None) -> str | None:
        if v is not None and not CODE_RE.match(v):
            raise ValueError("code may contain letters, digits, '.', '_' and '-' (max 50)")
        return v


# ----------------------------------------------------------------------------- forms


class FormVersionOut(BaseModel):
    id: uuid.UUID
    form_id: uuid.UUID
    version: int
    schema_: FormSchema = Field(alias="schema", serialization_alias="schema")
    published_at: dt.datetime

    model_config = {"populate_by_name": True}


class FormOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    name: str
    description: str | None
    kind: FormKind
    sensitivity: Sensitivity
    athlete_can_submit: bool
    athlete_can_view: bool
    allow_multiple_per_day: bool
    draft_schema: FormSchema
    current_version: FormVersionOut | None
    archived: bool
    created_at: dt.datetime
    updated_at: dt.datetime


class FormCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str | None = None
    description: str | None = None
    kind: FormKind
    sensitivity: Sensitivity = "general"
    athlete_can_submit: bool = False
    athlete_can_view: bool = False
    allow_multiple_per_day: bool = True
    draft_schema: FormSchema | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9][a-z0-9_-]{0,99}$")
        return v


class FormUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    slug: str | None = None
    description: str | None = None
    kind: FormKind | None = None
    sensitivity: Sensitivity | None = None
    athlete_can_submit: bool | None = None
    athlete_can_view: bool | None = None
    allow_multiple_per_day: bool | None = None
    draft_schema: FormSchema | None = None
    archived: bool | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9][a-z0-9_-]{0,99}$")
        return v


class SchemaErrorOut(BaseModel):
    path: str
    message: str


class ValidateSchemaRequest(BaseModel):
    schema_: Any = Field(alias="schema")


class ValidateSchemaResponse(BaseModel):
    valid: bool
    errors: list[SchemaErrorOut]


class FormTemplateOut(BaseModel):
    key: str
    name: str
    description: str
    kind: FormKind
    sensitivity: Sensitivity
    schema_: FormSchema = Field(alias="schema", serialization_alias="schema")
    references: list[str]

    model_config = {"populate_by_name": True}


class TemplateInstallRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    slug: str | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9][a-z0-9_-]{0,99}$")
        return v


class FormScheduleOut(BaseModel):
    id: uuid.UUID
    form_id: uuid.UUID
    group_id: uuid.UUID
    recurrence: Recurrence
    days_of_week: list[int]
    due_time: str
    start_date: dt.date
    end_date: dt.date | None
    remind: bool
    active: bool


def _check_days(v: list[int] | None) -> list[int] | None:
    if v is not None and any(d < 1 or d > 7 for d in v):
        raise ValueError("days_of_week are ISO weekdays 1 (Mon) to 7 (Sun)")
    return sorted(set(v)) if v is not None else v


def _check_time(v: str | None) -> str | None:
    if v is not None and not TIME_RE.match(v):
        raise ValueError("due_time must be HH:MM (24 h)")
    return v


class FormScheduleCreate(BaseModel):
    group_id: uuid.UUID
    recurrence: Recurrence
    days_of_week: list[int] = Field(default_factory=list)
    due_time: str = "09:00"
    start_date: dt.date
    end_date: dt.date | None = None
    remind: bool = False
    active: bool = True

    _days = field_validator("days_of_week")(_check_days)
    _time = field_validator("due_time")(_check_time)

    @model_validator(mode="after")
    def _consistency(self) -> FormScheduleCreate:
        if self.recurrence == "weekly" and not self.days_of_week:
            raise ValueError("weekly schedules need days_of_week")
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


class FormScheduleUpdate(BaseModel):
    group_id: uuid.UUID | None = None
    recurrence: Recurrence | None = None
    days_of_week: list[int] | None = None
    due_time: str | None = None
    start_date: dt.date | None = None
    end_date: dt.date | None = None
    remind: bool | None = None
    active: bool | None = None

    _days = field_validator("days_of_week")(_check_days)
    _time = field_validator("due_time")(_check_time)


# ----------------------------------------------------------------------------- submissions


class SubmissionOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    form_id: uuid.UUID
    form_version_id: uuid.UUID
    form_version: int
    athlete_id: uuid.UUID
    athlete_display_name: str
    submitted_by: uuid.UUID | None
    observed_at: dt.datetime
    local_date: dt.date
    values: dict[str, Any]
    computed: dict[str, Any]
    source: SubmissionSource
    import_batch_id: uuid.UUID | None
    created_at: dt.datetime
    updated_at: dt.datetime


class SubmissionCreate(BaseModel):
    form_id: uuid.UUID
    athlete_id: uuid.UUID
    values: dict[str, Any] = Field(default_factory=dict)
    observed_at: dt.datetime | None = None
    local_date: dt.date | None = None


class SelfSubmissionCreate(BaseModel):
    form_id: uuid.UUID
    values: dict[str, Any] = Field(default_factory=dict)
    observed_at: dt.datetime | None = None
    local_date: dt.date | None = None


class BulkEntry(BaseModel):
    athlete_id: uuid.UUID
    values: dict[str, Any] = Field(default_factory=dict)


class BulkSubmissionCreate(BaseModel):
    form_id: uuid.UUID
    local_date: dt.date
    observed_at: dt.datetime | None = None
    entries: list[BulkEntry] = Field(min_length=1, max_length=500)


class BulkError(BaseModel):
    athlete_id: uuid.UUID
    field_errors: dict[str, str]


class BulkSubmissionResult(BaseModel):
    created: list[SubmissionOut]
    errors: list[BulkError]


class SubmissionUpdate(BaseModel):
    values: dict[str, Any] | None = None
    observed_at: dt.datetime | None = None
    local_date: dt.date | None = None


# ----------------------------------------------------------------------------- imports


class ImportPreview(BaseModel):
    upload_id: uuid.UUID
    columns: list[str]
    row_count: int
    sample_rows: list[dict[str, str]]
    suggested_mapping: dict[str, str]
    suggested_athlete_column: str | None
    suggested_date_column: str | None


class ImportCommit(BaseModel):
    upload_id: uuid.UUID
    mapping: dict[str, str]
    athlete_column: str
    athlete_match: Literal["code", "email", "name", "external_id"]
    date_column: str | None = None
    date_format: str | None = None
    default_date: dt.date | None = None
    timezone: str | None = None
    dry_run: bool = False

    _tz = field_validator("timezone")(_check_tz)


class ImportError_(BaseModel):
    row: int
    message: str


class ImportBatchOut(BaseModel):
    id: uuid.UUID
    form_id: uuid.UUID
    filename: str
    created_by: uuid.UUID | None
    created_at: dt.datetime
    row_count: int
    created_count: int
    skipped_count: int
    errors: list[ImportError_]
    dry_run: bool


# ----------------------------------------------------------------------------- wearables

WearableMetric = Literal[
    "sleep_duration_min",
    "sleep_efficiency_pct",
    "sleep_deep_min",
    "sleep_rem_min",
    "sleep_light_min",
    "sleep_awake_min",
    "time_in_bed_min",
    "sleep_hrv_rmssd_ms",
    "sleep_resting_hr_bpm",
    "respiratory_rate",
    "hrv_rmssd_ms",
    "resting_hr_bpm",
    "recovery_score",
    "steps",
    "active_energy_kcal",
    "distance_m",
    "active_min",
    "moderate_min",
    "vigorous_min",
    "weight_kg",
    "body_fat_pct",
]


class WearableProviderOut(BaseModel):
    provider: str
    name: str
    enabled: bool
    kind: Literal["cloud", "sdk"]
    icon_url: str | None


class WearableConnectionOut(BaseModel):
    connection_id: uuid.UUID
    provider: str
    status: str
    account_type: str | None
    account_label: str | None
    last_synced_at: dt.datetime | None
    created_at: dt.datetime | None
    devices: list[str]


class WearableStatus(BaseModel):
    linked: bool
    ow_user_id: uuid.UUID | None
    connections: list[WearableConnectionOut]


class ConnectRequest(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    account_type: str | None = None
    account_label: str | None = Field(None, max_length=100)
    redirect_uri: str | None = None
    new_account: bool | None = None


class ConnectResponse(BaseModel):
    authorization_url: str


class SdkTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    ow_base_url: str
    ow_user_id: uuid.UUID


class WearableDailyPoint(BaseModel):
    local_date: dt.date
    metric: str
    value: float
    unit: str
    provider: str
    device: str | None


class RefreshResult(BaseModel):
    updated: int


# ----------------------------------------------------------------------------- metrics

DailyAgg = Literal["sum", "mean", "last", "max", "min"]
Transform = Literal["none", "rolling_mean", "rolling_sum", "ewma", "acwr", "zscore", "pct_change", "monotony", "strain"]


class Thresholds(BaseModel):
    direction: Literal["high_bad", "low_bad", "both_bad"]
    amber: float | None = None
    red: float | None = None


class MetricDefinitionOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    name: str
    description: str | None
    unit: str | None
    source: str
    daily_agg: DailyAgg
    fill_zero: bool
    transform: Transform
    params: dict[str, float | int | str | bool]
    thresholds: Thresholds | None
    decimals: int
    athlete_visible: bool
    builtin: bool


class MetricCreate(BaseModel):
    slug: str
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    unit: str | None = Field(None, max_length=32)
    source: str = Field(min_length=1, max_length=300)
    daily_agg: DailyAgg = "last"
    fill_zero: bool = False
    transform: Transform = "none"
    params: dict[str, float | int | str | bool] = Field(default_factory=dict)
    thresholds: Thresholds | None = None
    decimals: int = Field(1, ge=0, le=10)
    athlete_visible: bool = False

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9][a-z0-9_-]{0,99}$")
        return v


class MetricUpdate(BaseModel):
    slug: str | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    unit: str | None = Field(None, max_length=32)
    source: str | None = Field(None, min_length=1, max_length=300)
    daily_agg: DailyAgg | None = None
    fill_zero: bool | None = None
    transform: Transform | None = None
    params: dict[str, float | int | str | bool] | None = None
    thresholds: Thresholds | None = None
    decimals: int | None = Field(None, ge=0, le=10)
    athlete_visible: bool | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must match ^[a-z0-9][a-z0-9_-]{0,99}$")
        return v


class SeriesSourceOut(BaseModel):
    ref: str
    label: str
    unit: str | None
    kind: Literal["form", "wearable", "metric"]


class MetricPoint(BaseModel):
    date: dt.date
    value: float | None
    flag: Flag
    source: str | None


class MetricSeries(BaseModel):
    metric: MetricDefinitionOut
    athlete_id: uuid.UUID
    points: list[MetricPoint]


class ReadinessCell(BaseModel):
    value: float | None
    flag: Flag
    date: dt.date | None


class ReadinessAthlete(BaseModel):
    id: uuid.UUID
    display_name: str
    code: str
    position: str | None


class ReadinessRow(BaseModel):
    athlete: ReadinessAthlete
    cells: dict[str, ReadinessCell]
    due_forms: int


class ReadinessBoard(BaseModel):
    date: dt.date
    group_id: uuid.UUID | None
    columns: list[MetricDefinitionOut]
    rows: list[ReadinessRow]


class DueForm(BaseModel):
    form: FormOut
    version: FormVersionOut
    due_time: str | None
    completed: bool
    last_submitted_at: dt.datetime | None


class AuditEntryOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    at: dt.datetime
    details: dict[str, Any]
