from __future__ import annotations

import datetime as dt
import json
import time
import uuid
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.integrations.open_wearables import webhooks
from app.integrations.open_wearables.client import API_KEY_HEADER, OpenWearablesClient
from app.integrations.open_wearables.errors import OpenWearablesError
from app.models import Athlete, WearableDaily
from app.timeutil import today_in
from tests import factories as f

API = "/api/v1"
OW = "http://ow.test/api/v1"
OW_USER = uuid.UUID("11111111-2222-3333-4444-555555555555")


def source(
    provider: str = "oura", device: str | None = "Oura Ring Gen3 Horizon", name: str | None = "Oura Ring Gen3"
) -> dict[str, Any]:
    return {"provider": provider, "device": device, "device_name": name, "source": provider, "device_type": "ring"}


def page(rows: list[dict[str, Any]], next_cursor: str | None = None) -> dict[str, Any]:
    return {
        "data": rows,
        "pagination": {"next_cursor": next_cursor, "has_more": next_cursor is not None},
        "metadata": {},
    }


# ----------------------------------------------------------------------------- client


@respx.mock
def test_client_sends_api_key_and_parses() -> None:
    route = respx.get(f"{OW}/oauth/providers").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "provider": "garmin",
                    "name": "Garmin",
                    "has_cloud_api": True,
                    "is_enabled": True,
                    "icon_url": "/static/provider-icons/garmin.svg",
                    "live_sync_mode": "pull",
                },
                {
                    "provider": "apple",
                    "name": "Apple Health",
                    "has_cloud_api": False,
                    "is_enabled": True,
                    "icon_url": "/static/provider-icons/apple.svg",
                },
            ],
        )
    )
    with OpenWearablesClient.from_settings() as client:
        providers = client.list_providers()
    assert [p.provider for p in providers] == ["garmin", "apple"]
    assert route.calls[0].request.headers[API_KEY_HEADER] == "ow-test-key"
    assert route.calls[0].request.url.params["enabled_only"] == "true"


@respx.mock
def test_client_errors_are_wrapped() -> None:
    respx.get(f"{OW}/users/{OW_USER}/connections").mock(return_value=httpx.Response(500, json={"detail": "boom"}))
    respx.get(f"{OW}/oauth/providers").mock(side_effect=httpx.ConnectTimeout("slow"))
    respx.get(f"{OW}/users").mock(return_value=httpx.Response(200, json={"unexpected": True}))
    with OpenWearablesClient.from_settings() as client:
        with pytest.raises(OpenWearablesError, match="500"):
            client.list_connections(OW_USER)
        with pytest.raises(OpenWearablesError, match="timed out"):
            client.list_providers()
        with pytest.raises(OpenWearablesError, match="unexpected response"):
            client.find_user_by_external_id("x")


@respx.mock
def test_summaries_follow_cursor_pagination() -> None:
    route = respx.get(f"{OW}/users/{OW_USER}/summaries/sleep").mock(
        side_effect=[
            httpx.Response(200, json=page([{"date": "2026-10-01", "source": source(), "duration_minutes": 400}], "c2")),
            httpx.Response(200, json=page([{"date": "2026-10-02", "source": source(), "duration_minutes": 410}])),
        ]
    )
    with OpenWearablesClient.from_settings() as client:
        rows = client.sleep_summaries(OW_USER, dt.date(2026, 10, 1), dt.date(2026, 10, 2))
    assert [r.duration_minutes for r in rows] == [400, 410]
    assert route.calls[0].request.url.params["start_date"] == "2026-10-01"
    assert "cursor" not in route.calls[0].request.url.params
    assert route.calls[1].request.url.params["cursor"] == "c2"


# ----------------------------------------------------------------------------- routes


def linked_world(db: Session, linked: bool = True) -> tuple:
    org = f.org(db, timezone="UTC")
    admin = f.member(db, org, "admin")
    me = f.member(db, org, "athlete")
    a = f.athlete(db, org, "Wen", "Wear", email="wen@example.com")
    a.user_id = me.id
    if linked:
        a.ow_user_id = OW_USER
    db.commit()
    return org, admin, me, a


@respx.mock
def test_link_creates_ow_user_and_is_idempotent(client: TestClient, db: Session) -> None:
    org, admin, _me, a = linked_world(db, linked=False)
    lookup = respx.get(f"{OW}/users").mock(
        return_value=httpx.Response(200, json={"items": [], "total": 0, "page": 1, "limit": 1})
    )
    create = respx.post(f"{OW}/users").mock(
        return_value=httpx.Response(
            201, json={"id": str(OW_USER), "created_at": "2026-10-12T00:00:00Z", "external_user_id": str(a.id)}
        )
    )
    respx.get(f"{OW}/users/{OW_USER}/connections").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": "aaaaaaaa-0000-0000-0000-000000000001",
                    "user_id": str(OW_USER),
                    "provider": "garmin",
                    "status": "active",
                    "account_type": "personal",
                    "account_label": "Main watch",
                    "last_synced_at": "2026-10-11T22:00:00Z",
                    "created_at": "2026-10-01T10:00:00Z",
                    "updated_at": "2026-10-01T10:00:00Z",
                    "observed_devices": ["Forerunner 265"],
                }
            ],
        )
    )
    url = f"{API}/orgs/{org.id}/athletes/{a.id}/wearables"
    assert client.get(url, headers=admin.headers).json() == {"linked": False, "ow_user_id": None, "connections": []}
    r = client.post(f"{url}/link", headers=admin.headers)
    assert r.status_code == 200, r.text
    status = r.json()
    assert status["linked"] is True and status["ow_user_id"] == str(OW_USER)
    assert status["connections"][0] == {
        "connection_id": "aaaaaaaa-0000-0000-0000-000000000001",
        "provider": "garmin",
        "status": "active",
        "account_type": "personal",
        "account_label": "Main watch",
        "last_synced_at": "2026-10-11T22:00:00Z",
        "created_at": "2026-10-01T10:00:00Z",
        "devices": ["Forerunner 265"],
    }
    body = json.loads(create.calls[0].request.content)
    assert body == {"first_name": "Wen", "last_name": "Wear", "email": "wen@example.com", "external_user_id": str(a.id)}
    assert lookup.calls[0].request.url.params["external_user_id"] == str(a.id)
    db.expire_all()
    assert db.get(Athlete, a.id).ow_user_id == OW_USER  # type: ignore[union-attr]
    # idempotent: no second create
    client.post(f"{url}/link", headers=admin.headers)
    assert create.call_count == 1


@respx.mock
def test_link_reuses_existing_and_handles_email_conflict(client: TestClient, db: Session) -> None:
    org, admin, _me, a = linked_world(db, linked=False)
    respx.get(f"{OW}/users").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [{"id": str(OW_USER), "created_at": "2026-10-01T00:00:00Z", "external_user_id": str(a.id)}],
                "total": 1,
                "page": 1,
                "limit": 1,
            },
        )
    )
    create = respx.post(f"{OW}/users")
    respx.get(f"{OW}/users/{OW_USER}/connections").mock(return_value=httpx.Response(200, json=[]))
    r = client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/link", headers=admin.headers)
    assert r.json()["ow_user_id"] == str(OW_USER) and not create.called

    b = f.athlete(db, org, "Dup", "Mail", email="taken@example.com")
    respx.get(f"{OW}/users").mock(
        return_value=httpx.Response(200, json={"items": [], "total": 0, "page": 1, "limit": 1})
    )
    new_id = uuid.uuid4()
    create = respx.post(f"{OW}/users").mock(
        side_effect=[
            httpx.Response(409, json={"detail": "User with this email already exists."}),
            httpx.Response(201, json={"id": str(new_id), "created_at": "2026-10-12T00:00:00Z"}),
        ]
    )
    respx.get(f"{OW}/users/{new_id}/connections").mock(return_value=httpx.Response(200, json=[]))
    r = client.post(f"{API}/orgs/{org.id}/athletes/{b.id}/wearables/link", headers=admin.headers)
    assert r.status_code == 200 and r.json()["ow_user_id"] == str(new_id)
    assert "email" not in json.loads(create.calls[1].request.content)


@respx.mock
def test_connect_providers_and_athlete_self_service(client: TestClient, db: Session) -> None:
    org, admin, me, a = linked_world(db)
    authorize = respx.get(f"{OW}/oauth/garmin/authorize").mock(
        return_value=httpx.Response(
            200, json={"authorization_url": "https://connect.garmin.com/oauth?x=1", "state": "s"}
        )
    )
    respx.get(f"{OW}/oauth/providers").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "provider": "oura",
                    "name": "Oura",
                    "has_cloud_api": True,
                    "is_enabled": True,
                    "icon_url": "/static/provider-icons/oura.svg",
                }
            ],
        )
    )
    respx.get(f"{OW}/users/{OW_USER}/connections").mock(return_value=httpx.Response(200, json=[]))
    r = client.post(
        f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/connect",
        headers=admin.headers,
        json={
            "provider": "garmin",
            "account_type": "validation",
            "account_label": "P01 arm A",
            "redirect_uri": "ams://wearables/done",
            "new_account": True,
        },
    )
    assert r.status_code == 200 and r.json() == {"authorization_url": "https://connect.garmin.com/oauth?x=1"}
    params = authorize.calls[0].request.url.params
    assert params["user_id"] == str(OW_USER) and params["account_type"] == "validation"
    assert params["account_label"] == "P01 arm A" and params["new_account"] == "true"
    assert params["redirect_uri"] == "ams://wearables/done"
    providers = client.get(f"{API}/orgs/{org.id}/wearables/providers", headers=admin.headers).json()
    assert providers == [
        {
            "provider": "oura",
            "name": "Oura",
            "enabled": True,
            "kind": "cloud",
            "icon_url": "http://ow.test/static/provider-icons/oura.svg",
        }
    ]
    assert client.get(f"{API}/orgs/{org.id}/me/wearables/providers", headers=me.headers).status_code == 200
    assert client.get(f"{API}/orgs/{org.id}/me/wearables", headers=me.headers).json()["linked"] is True
    r = client.post(f"{API}/orgs/{org.id}/me/wearables/connect", headers=me.headers, json={"provider": "garmin"})
    assert r.status_code == 200
    assert "new_account" not in authorize.calls[1].request.url.params
    # staff without write cannot connect
    viewer = f.member(db, org, "staff")
    assert (
        client.post(
            f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/connect",
            headers=viewer.headers,
            json={"provider": "garmin"},
        ).status_code
        == 404
    )


@respx.mock
def test_sdk_token(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    org, _admin, me, _a = linked_world(db)
    token = respx.post(f"{OW}/users/{OW_USER}/token").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "sdk-access",
                "token_type": "bearer",
                "refresh_token": "sdk-refresh",
                "expires_in": 3600,
            },
        )
    )
    r = client.post(f"{API}/orgs/{org.id}/me/wearables/sdk-token", headers=me.headers)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "access_token": "sdk-access",
        "refresh_token": "sdk-refresh",
        "expires_in": 3600,
        "ow_base_url": "http://ow.test",
        "ow_user_id": str(OW_USER),
    }
    request = token.calls[0].request
    assert json.loads(request.content) == {"app_id": "app-id", "app_secret": "app-secret"}
    assert API_KEY_HEADER not in request.headers  # app credentials, not the API key
    monkeypatch.setattr(settings, "ow_app_secret", None)
    r = client.post(f"{API}/orgs/{org.id}/me/wearables/sdk-token", headers=me.headers)
    assert r.status_code == 503


def test_ow_not_configured_is_503(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    org, admin, _me, a = linked_world(db)
    monkeypatch.setattr(settings, "ow_base_url", None)
    assert client.get(f"{API}/orgs/{org.id}/wearables/providers", headers=admin.headers).status_code == 503
    assert (
        client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/refresh", headers=admin.headers).status_code == 503
    )


@respx.mock
def test_ow_failure_is_502(client: TestClient, db: Session) -> None:
    org, admin, _me, a = linked_world(db)
    respx.get(f"{OW}/users/{OW_USER}/connections").mock(return_value=httpx.Response(503, text="down"))
    r = client.get(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables", headers=admin.headers)
    assert r.status_code == 502 and "Open Wearables" in r.json()["detail"]


def mock_summaries(
    today: dt.date,
    *,
    sleep: list | None = None,
    recovery: list | None = None,
    activity: list | None = None,
    body: list | None = None,
) -> None:
    respx.get(f"{OW}/users/{OW_USER}/summaries/sleep").mock(return_value=httpx.Response(200, json=page(sleep or [])))
    respx.get(f"{OW}/users/{OW_USER}/summaries/recovery").mock(
        return_value=httpx.Response(200, json=page(recovery or []))
    )
    respx.get(f"{OW}/users/{OW_USER}/summaries/activity").mock(
        return_value=httpx.Response(200, json=page(activity or []))
    )
    respx.get(f"{OW}/users/{OW_USER}/timeseries").mock(return_value=httpx.Response(200, json=page(body or [])))


@respx.mock
def test_refresh_maps_summaries_into_wearable_daily(client: TestClient, db: Session) -> None:
    org, admin, _me, a = linked_world(db)
    today = today_in("UTC")
    d1, d2 = (today - dt.timedelta(days=1)).isoformat(), today.isoformat()
    whoop = {"provider": "whoop", "device": None, "device_name": None}
    mock_summaries(
        today,
        sleep=[
            {
                "date": d1,
                "source": source(),
                "duration_minutes": 431,
                "time_in_bed_minutes": 470,
                "efficiency_percent": 91.7,
                "stages": {"deep_minutes": 80, "rem_minutes": 95, "light_minutes": 256, "awake_minutes": 39},
                "resting_heart_rate_bpm": 52,
                "avg_hrv_rmssd_ms": 68.5,
                "avg_respiratory_rate": 14.2,
            },
            {
                "date": d2,
                "source": source(),
                "duration_minutes": 402,
                "avg_hrv_rmssd_ms": 60.0,
                "resting_heart_rate_bpm": 55,
            },
        ],
        recovery=[
            {"date": d2, "source": whoop, "avg_hrv_rmssd_ms": 75.0, "resting_heart_rate_bpm": 50, "recovery_score": 66}
        ],
        activity=[
            {
                "date": d1,
                "source": source("garmin", "Forerunner 265", "Forerunner 265"),
                "steps": 10234,
                "distance_meters": 7800.5,
                "active_calories_kcal": 540.0,
                "active_minutes": 75,
                "intensity_minutes": {"moderate": 30, "vigorous": 15},
            }
        ],
        body=[
            {
                "timestamp": f"{d1}T06:00:00Z",
                "type": "weight",
                "value": 72.4,
                "unit": "kg",
                "source": source("withings", "Body+", "Body+"),
            },
            {
                "timestamp": f"{d1}T07:00:00Z",
                "type": "weight",
                "value": 72.1,
                "unit": "kg",
                "source": source("withings", "Body+", "Body+"),
            },
        ],
    )
    r = client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/refresh", headers=admin.headers, params={"days": 3})
    assert r.status_code == 200, r.text
    rows = {(w.local_date.isoformat(), w.metric): w for w in db.scalars(select(WearableDaily))}
    assert r.json()["updated"] == len(rows)
    assert rows[(d1, "sleep_duration_min")].value == 431
    assert rows[(d1, "sleep_deep_min")].value == 80 and rows[(d1, "sleep_efficiency_pct")].value == 91.7
    assert rows[(d1, "respiratory_rate")].unit == "br/min"
    # HRV / RHR: the recovery value wins where present, otherwise the nightly value from sleep
    assert rows[(d2, "hrv_rmssd_ms")].value == 75 and rows[(d2, "hrv_rmssd_ms")].provider == "whoop"
    assert rows[(d1, "hrv_rmssd_ms")].value == 68.5 and rows[(d1, "hrv_rmssd_ms")].provider == "oura"
    assert rows[(d1, "hrv_rmssd_ms")].device == "Oura Ring Gen3"
    assert rows[(d1, "resting_hr_bpm")].value == 52
    assert rows[(d2, "recovery_score")].value == 66
    assert rows[(d1, "steps")].value == 10234 and rows[(d1, "steps")].device == "Forerunner 265"
    assert rows[(d1, "vigorous_min")].value == 15 and rows[(d1, "distance_m")].unit == "m"
    assert rows[(d1, "weight_kg")].value == 72.1  # last sample of the day
    # daily endpoint
    pts = client.get(
        f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/daily",
        headers=admin.headers,
        params={"start": d1, "end": d2, "metrics": "hrv_rmssd_ms,steps"},
    ).json()
    assert [(p["local_date"], p["metric"], p["value"], p["provider"]) for p in pts] == [
        (d1, "hrv_rmssd_ms", 68.5, "oura"),
        (d1, "steps", 10234.0, "garmin"),
        (d2, "hrv_rmssd_ms", 75.0, "whoop"),
    ]
    assert (
        client.get(
            f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/daily", headers=admin.headers, params={"metrics": "bogus"}
        ).status_code
        == 400
    )
    # a second refresh replaces the window: changed values upsert, vanished rows are removed
    respx.reset()
    mock_summaries(today, sleep=[{"date": d1, "source": source(), "duration_minutes": 440}])
    r = client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/refresh", headers=admin.headers, params={"days": 3})
    db.expire_all()
    rows = {(w.local_date.isoformat(), w.metric): w for w in db.scalars(select(WearableDaily))}
    assert set(rows) == {(d1, "sleep_duration_min")} and rows[(d1, "sleep_duration_min")].value == 440


def test_refresh_requires_link(client: TestClient, db: Session) -> None:
    org, admin, _me, a = linked_world(db, linked=False)
    assert (
        client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/wearables/refresh", headers=admin.headers).status_code == 409
    )


# ----------------------------------------------------------------------------- webhooks

SECRET = "whsec_dGVzdC13ZWJob29rLXNlY3JldC0wMTIzNDU2Nzg5"


def signed(body: bytes, ts: int | None = None, msg_id: str = "msg_1") -> dict[str, str]:
    stamp = ts if ts is not None else int(time.time())
    return {
        "svix-id": msg_id,
        "svix-timestamp": str(stamp),
        "svix-signature": webhooks.sign(SECRET, msg_id, stamp, body),
        "content-type": "application/json",
    }


def test_signature_verification_unit() -> None:
    body = b'{"type":"sync.completed","data":{"user_id":"x"}}'
    headers = signed(body)
    webhooks.verify(SECRET, headers, body)
    # multiple signatures (key rotation): any match is enough
    webhooks.verify(SECRET, {**headers, "svix-signature": "v1,bogus " + headers["svix-signature"]}, body)
    with pytest.raises(webhooks.WebhookVerificationError):
        webhooks.verify(SECRET, headers, body + b" ")
    with pytest.raises(webhooks.WebhookVerificationError):
        webhooks.verify(SECRET, signed(body, ts=int(time.time()) - 301), body)
    with pytest.raises(webhooks.WebhookVerificationError):
        webhooks.verify(SECRET, signed(body, ts=int(time.time()) + 301), body)
    with pytest.raises(webhooks.WebhookVerificationError):
        webhooks.verify(SECRET, {"svix-id": "x"}, body)
    with pytest.raises(webhooks.WebhookVerificationError):
        webhooks.verify("whsec_b3RoZXItc2VjcmV0", headers, body)


@respx.mock
def test_webhook_endpoint(client: TestClient, db: Session) -> None:
    _org, _admin, _me, a = linked_world(db)
    url = f"{API}/integrations/open-wearables/webhook"
    today = today_in("UTC")
    mock_summaries(today, sleep=[{"date": today.isoformat(), "source": source(), "duration_minutes": 400}])
    payload = json.dumps(
        {
            "type": "sync.completed",
            "data": {"user_id": str(OW_USER), "provider": "oura", "source": "pull", "run_id": "r1", "status": "ok"},
        }
    ).encode()
    # bad signature
    bad = signed(payload)
    bad["svix-signature"] = "v1,AAAA"
    assert client.post(url, content=payload, headers=bad).status_code == 401
    # stale timestamp
    assert client.post(url, content=payload, headers=signed(payload, ts=int(time.time()) - 600)).status_code == 401
    # valid: the refresh task runs (eagerly in tests) and fills wearable_daily
    r = client.post(url, content=payload, headers=signed(payload))
    assert r.status_code == 204
    rows = db.scalars(select(WearableDaily).where(WearableDaily.athlete_id == a.id)).all()
    assert [(w.metric, w.value) for w in rows] == [("sleep_duration_min", 400)]
    # unknown OW user: accepted, no-op
    other = json.dumps({"type": "sync.completed", "data": {"user_id": str(uuid.uuid4())}}).encode()
    assert client.post(url, content=other, headers=signed(other, msg_id="msg_2")).status_code == 204
    # events that do not change daily values are ignored
    started = json.dumps({"type": "sync.started", "data": {"user_id": str(OW_USER)}}).encode()
    assert client.post(url, content=started, headers=signed(started, msg_id="msg_3")).status_code == 204


def test_webhook_without_secret_is_503(client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ow_webhook_secret", None)
    body = b"{}"
    r = client.post(f"{API}/integrations/open-wearables/webhook", content=body, headers=signed(body))
    assert r.status_code == 503


@respx.mock
def test_nightly_refresh_task(db: Session) -> None:
    from app.tasks import refresh_all_wearables

    org, _admin, _me, _a = linked_world(db)
    f.athlete(db, org, "Not", "Linked")
    today = today_in("UTC")
    mock_summaries(
        today, activity=[{"date": today.isoformat(), "source": source("garmin", "Fenix 8", "Fenix 8"), "steps": 5000}]
    )
    assert refresh_all_wearables.delay(7).get() == 1
    rows = db.scalars(select(WearableDaily)).all()
    assert [(w.metric, w.value, w.device) for w in rows] == [("steps", 5000, "Fenix 8")]
