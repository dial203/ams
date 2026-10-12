"""HTTP client for the Open Wearables REST API (server-to-server, ``X-Open-Wearables-API-Key``).

Every failure surfaces as :class:`OpenWearablesError` (the API answers 502); a missing
configuration as :class:`OpenWearablesNotConfigured` (503).
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from collections.abc import Iterator
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, TypeAdapter, ValidationError

from app.config import Settings, settings
from app.integrations.open_wearables.errors import (
    OpenWearablesConflict,
    OpenWearablesError,
    OpenWearablesNotConfigured,
)
from app.integrations.open_wearables.schemas import (
    OWActivitySummary,
    OWAuthorizationURL,
    OWConnection,
    OWPagination,
    OWProvider,
    OWRecoverySummary,
    OWSleepSummary,
    OWTimeSeriesSample,
    OWToken,
    OWUser,
    OWUserPage,
)

log = logging.getLogger(__name__)
API_KEY_HEADER = "X-Open-Wearables-API-Key"
PAGE_LIMIT = 100
MAX_PAGES = 50

M = TypeVar("M", bound=BaseModel)


class OpenWearablesClient:
    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        *,
        app_id: str | None = None,
        app_secret: str | None = None,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.app_id = app_id
        self.app_secret = app_secret
        self._http = httpx.Client(
            base_url=f"{self.base_url}/api/v1",
            timeout=httpx.Timeout(timeout, connect=min(timeout, 5.0)),
            transport=transport,
            headers={"Accept": "application/json", "User-Agent": "ams-api"},
        )

    @classmethod
    def from_settings(cls, cfg: Settings | None = None) -> OpenWearablesClient:
        cfg = cfg or settings
        if not cfg.ow_configured:
            raise OpenWearablesNotConfigured("Open Wearables is not configured (OW_BASE_URL / OW_API_KEY)")
        return cls(
            cfg.ow_base_url or "",
            cfg.ow_api_key,
            app_id=cfg.ow_app_id,
            app_secret=cfg.ow_app_secret,
            timeout=cfg.ow_timeout_seconds,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> OpenWearablesClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------ transport
    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        auth: bool = True,
    ) -> Any:
        headers = {API_KEY_HEADER: self.api_key} if auth and self.api_key else {}
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        try:
            resp = self._http.request(method, path, params=clean, json=json, headers=headers)
        except httpx.TimeoutException as exc:
            raise OpenWearablesError(f"{method} {path} timed out") from exc
        except httpx.HTTPError as exc:
            raise OpenWearablesError(f"{method} {path} failed: {exc.__class__.__name__}") from exc
        if resp.status_code >= 400:
            detail = _detail(resp)
            log.warning("OW %s %s -> %s %s", method, path, resp.status_code, detail)
            if resp.status_code == 409:
                raise OpenWearablesConflict(detail, resp.status_code)
            raise OpenWearablesError(f"{method} {path} returned {resp.status_code}: {detail}", resp.status_code)
        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise OpenWearablesError(f"{method} {path} returned invalid JSON") from exc

    @staticmethod
    def _parse(model: type[M], data: Any) -> M:
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            raise OpenWearablesError(f"unexpected response shape for {model.__name__}: {exc.error_count()} errors") from exc

    @staticmethod
    def _parse_list(model: type[M], data: Any) -> list[M]:
        try:
            return TypeAdapter(list[model]).validate_python(data)  # type: ignore[valid-type]
        except ValidationError as exc:
            raise OpenWearablesError(f"unexpected response shape for list[{model.__name__}]") from exc

    # ------------------------------------------------------------------ users
    def find_user_by_external_id(self, external_id: str) -> OWUser | None:
        data = self._request("GET", "/users", params={"external_user_id": external_id, "limit": 1})
        page = self._parse(OWUserPage, data)
        return page.items[0] if page.items else None

    def get_user(self, user_id: uuid.UUID) -> OWUser:
        return self._parse(OWUser, self._request("GET", f"/users/{user_id}"))

    def create_user(
        self,
        *,
        external_user_id: str,
        first_name: str | None = None,
        last_name: str | None = None,
        email: str | None = None,
    ) -> OWUser:
        body = {
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "external_user_id": external_user_id,
        }
        return self._parse(OWUser, self._request("POST", "/users", json={k: v for k, v in body.items() if v is not None}))

    # ------------------------------------------------------------------ providers / connections
    def list_providers(self, enabled_only: bool = True) -> list[OWProvider]:
        data = self._request("GET", "/oauth/providers", params={"enabled_only": str(enabled_only).lower()})
        return self._parse_list(OWProvider, data)

    def authorization_url(
        self,
        provider: str,
        user_id: uuid.UUID,
        *,
        redirect_uri: str | None = None,
        new_account: bool | None = None,
        account_type: str | None = None,
        account_label: str | None = None,
    ) -> str:
        params = {
            "user_id": str(user_id),
            "redirect_uri": redirect_uri,
            "new_account": None if new_account is None else str(new_account).lower(),
            "account_type": account_type,
            "account_label": account_label,
        }
        data = self._request("GET", f"/oauth/{provider}/authorize", params=params)
        return self._parse(OWAuthorizationURL, data).authorization_url

    def list_connections(self, user_id: uuid.UUID) -> list[OWConnection]:
        return self._parse_list(OWConnection, self._request("GET", f"/users/{user_id}/connections"))

    def create_sdk_token(self, user_id: uuid.UUID) -> OWToken:
        if not (self.app_id and self.app_secret):
            raise OpenWearablesNotConfigured("OW_APP_ID / OW_APP_SECRET are not configured")
        data = self._request(
            "POST",
            f"/users/{user_id}/token",
            json={"app_id": self.app_id, "app_secret": self.app_secret},
            auth=False,
        )
        return self._parse(OWToken, data)

    # ------------------------------------------------------------------ daily data
    def _paged(self, path: str, params: dict[str, Any]) -> Iterator[Any]:
        cursor: str | None = None
        for _ in range(MAX_PAGES):
            data = self._request("GET", path, params={**params, "cursor": cursor, "limit": PAGE_LIMIT})
            if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                raise OpenWearablesError(f"GET {path}: expected a paginated response")
            yield from data["data"]
            pagination = self._parse(OWPagination, data.get("pagination") or {})
            if not pagination.has_more or not pagination.next_cursor:
                return
            cursor = pagination.next_cursor
        log.warning("OW %s: stopped after %d pages", path, MAX_PAGES)

    def _summaries(self, kind: str, model: type[M], user_id: uuid.UUID, start: dt.date, end: dt.date) -> list[M]:
        rows = list(
            self._paged(
                f"/users/{user_id}/summaries/{kind}",
                {"start_date": start.isoformat(), "end_date": end.isoformat()},
            )
        )
        return self._parse_list(model, rows)

    def sleep_summaries(self, user_id: uuid.UUID, start: dt.date, end: dt.date) -> list[OWSleepSummary]:
        return self._summaries("sleep", OWSleepSummary, user_id, start, end)

    def recovery_summaries(self, user_id: uuid.UUID, start: dt.date, end: dt.date) -> list[OWRecoverySummary]:
        return self._summaries("recovery", OWRecoverySummary, user_id, start, end)

    def activity_summaries(self, user_id: uuid.UUID, start: dt.date, end: dt.date) -> list[OWActivitySummary]:
        return self._summaries("activity", OWActivitySummary, user_id, start, end)

    def body_samples(self, user_id: uuid.UUID, start: dt.date, end: dt.date) -> list[OWTimeSeriesSample]:
        """Weight and body-fat samples. OW's /summaries/body has no measurement dates, so use timeseries."""
        rows = list(
            self._paged(
                f"/users/{user_id}/timeseries",
                {
                    "start_time": start.isoformat(),
                    "end_time": end.isoformat(),
                    "types": "weight,body_fat_percentage",
                    "resolution": "raw",
                },
            )
        )
        return self._parse_list(OWTimeSeriesSample, rows)


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200]
    if isinstance(body, dict) and "detail" in body:
        return str(body["detail"])[:300]
    return str(body)[:300]


def get_client() -> OpenWearablesClient:
    """FastAPI dependency / factory. Overridable in tests."""
    return OpenWearablesClient.from_settings()
