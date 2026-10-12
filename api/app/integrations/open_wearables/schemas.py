"""Typed subsets of Open Wearables responses (backend/app/schemas in the OW repo).

Only the fields AMS uses are declared; everything else is ignored so OW can add fields freely.
"""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict


class OWModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class OWUser(OWModel):
    """UserRead."""

    id: uuid.UUID
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    external_user_id: str | None = None


class OWUserPage(OWModel):
    """OldPaginatedResponse[UserRead] from GET /users."""

    items: list[OWUser]
    total: int = 0


class OWProvider(OWModel):
    """ProviderSettingRead from GET /oauth/providers."""

    provider: str
    name: str
    has_cloud_api: bool
    is_enabled: bool
    icon_url: str | None = None


class OWAuthorizationURL(OWModel):
    authorization_url: str
    state: str | None = None


class OWConnection(OWModel):
    """UserConnectionWithCapabilities from GET /users/{id}/connections."""

    id: uuid.UUID
    provider: str
    status: str
    account_type: str | None = None
    account_label: str | None = None
    last_synced_at: dt.datetime | None = None
    created_at: dt.datetime | None = None
    observed_devices: list[str] = []
    device_label: str | None = None


class OWToken(OWModel):
    """TokenResponse from POST /users/{id}/token."""

    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None
    expires_in: int | None = None


class OWSource(OWModel):
    """SourceMetadata (provider, device and derived names)."""

    provider: str
    source: str | None = None
    device: str | None = None
    device_type: str | None = None
    device_name: str | None = None
    device_display_name: str | None = None
    original_source_name: str | None = None


class OWPagination(OWModel):
    next_cursor: str | None = None
    has_more: bool = False


class OWSleepStages(OWModel):
    awake_minutes: int | None = None
    light_minutes: int | None = None
    deep_minutes: int | None = None
    rem_minutes: int | None = None


class OWSleepSummary(OWModel):
    date: dt.date
    source: OWSource
    duration_minutes: int | None = None
    time_in_bed_minutes: int | None = None
    efficiency_percent: float | None = None
    stages: OWSleepStages | None = None
    resting_heart_rate_bpm: int | None = None
    avg_hrv_rmssd_ms: float | None = None
    avg_respiratory_rate: float | None = None


class OWRecoverySummary(OWModel):
    date: dt.date
    source: OWSource
    resting_heart_rate_bpm: int | None = None
    avg_hrv_rmssd_ms: float | None = None
    recovery_score: int | None = None


class OWIntensityMinutes(OWModel):
    light: int | None = None
    moderate: int | None = None
    vigorous: int | None = None


class OWActivitySummary(OWModel):
    date: dt.date
    source: OWSource
    steps: int | None = None
    distance_meters: float | None = None
    active_calories_kcal: float | None = None
    active_minutes: int | None = None
    intensity_minutes: OWIntensityMinutes | None = None


class OWTimeSeriesSample(OWModel):
    timestamp: dt.datetime
    zone_offset: str | None = None
    type: str
    value: float
    unit: str
    source: OWSource | None = None
