from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.forms.engine import validate
from app.forms.schema import validate_schema
from app.models import AuditLog, FormVersion
from app.templates import TEMPLATES
from tests import factories as f

API = "/api/v1"

SCHEMA_V1 = f.simple_schema(
    {"key": "rpe", "type": "scale", "label": "RPE", "required": True, "min": 0, "max": 10},
    {"key": "minutes", "type": "duration", "label": "Minutes", "required": True, "min": 0},
    {"key": "load", "type": "calculated", "label": "Load", "expression": "rpe * minutes"},
)


@pytest.mark.parametrize("key", list(TEMPLATES))
def test_templates_are_valid(key: str) -> None:
    template = TEMPLATES[key]
    assert validate_schema(template.schema) == []
    assert template.kind and template.sensitivity
    for ref in template.references:
        assert "http" in ref


def test_template_calculations() -> None:
    hooper = TEMPLATES["wellness_hooper"].schema
    r = validate(hooper, {"sleep_quality": 2, "fatigue": 3, "stress": 4, "soreness": 5, "has_pain": False})
    assert r.ok and r.computed["hooper_total"] == 14
    srpe = TEMPLATES["session_rpe"].schema
    r = validate(srpe, {"session_type": "field", "rpe": 7, "duration": 90})
    assert r.ok and r.computed["srpe"] == 630
    cmj = TEMPLATES["cmj_test"].schema
    r = validate(cmj, {"jump_height_cm": 40, "time_to_takeoff_ms": 800, "peak_power_w": 4000, "body_mass_kg": 80})
    assert r.ok and r.computed["peak_power_rel"] == 50 and r.computed["rsi_mod_calc"] == 0.5
    gps = TEMPLATES["gps_session"].schema
    r = validate(gps, {"duration_min": 80, "total_distance_m": 8000, "hsr_distance_m": 600})
    assert r.ok and r.computed["distance_per_min"] == 100 and r.computed["hsr_pct"] == 7.5
    body = TEMPLATES["body_mass"].schema
    assert validate(body, {"body_mass_kg": 80.2, "usg": 1.025}).computed["hydration"] == "check"
    assert validate(body, {"body_mass_kg": 80.2}).computed["hydration"] is None
    injury = TEMPLATES["injury_report"].schema
    r = validate(
        injury,
        {"onset_date": "2026-10-01", "problem_type": "illness", "availability": "unavailable", "expected_days_out": 10},
    )
    assert r.ok and r.computed["expected_return"] == "moderate"
    assert not validate(injury, {"onset_date": "2026-10-01", "problem_type": "injury", "availability": "full"}).ok


def test_draft_publish_versioning(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    url = f"{API}/orgs/{org.id}/forms"
    r = client.post(url, headers=admin.headers, json={"name": "Session Log", "kind": "session"})
    assert r.status_code == 201, r.text
    form = r.json()
    assert form["slug"] == "session_log"
    assert form["current_version"] is None
    assert form["draft_schema"] == {"schema_version": 1, "sections": []}
    assert form["sensitivity"] == "general"
    fid = form["id"]
    # saving an invalid draft is allowed
    bad = {"schema_version": 1, "sections": [{"key": "s", "title": "S", "fields": [{"key": "Bad", "type": "x"}]}]}
    assert client.patch(f"{url}/{fid}", headers=admin.headers, json={"draft_schema": bad}).status_code == 200
    r = client.post(f"{url}/{fid}/publish", headers=admin.headers)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["message"] == "invalid schema"
    assert {e["path"] for e in detail["schema_errors"]} == {
        "sections/0/fields/0/key",
        "sections/0/fields/0/type",
        "sections/0/fields/0/label",
    }
    # valid draft publishes v1
    client.patch(f"{url}/{fid}", headers=admin.headers, json={"draft_schema": SCHEMA_V1})
    v1 = client.post(f"{url}/{fid}/publish", headers=admin.headers).json()
    assert v1["version"] == 1 and v1["schema"] == SCHEMA_V1
    # republishing an unchanged draft is a no-op
    again = client.post(f"{url}/{fid}/publish", headers=admin.headers).json()
    assert again["id"] == v1["id"]
    # editing the draft does not touch the published version
    v2_schema = f.simple_schema(*SCHEMA_V1["sections"][0]["fields"], {"key": "note", "type": "text", "label": "Note"})
    client.patch(f"{url}/{fid}", headers=admin.headers, json={"draft_schema": v2_schema})
    got = client.get(f"{url}/{fid}", headers=admin.headers).json()
    assert got["current_version"]["version"] == 1 and got["draft_schema"] == v2_schema
    v2 = client.post(f"{url}/{fid}/publish", headers=admin.headers).json()
    assert v2["version"] == 2
    versions = client.get(f"{url}/{fid}/versions", headers=admin.headers).json()
    assert [v["version"] for v in versions] == [2, 1]
    # published versions are immutable (stored separately from the draft)
    stored_v1 = db.get(FormVersion, v1["id"])
    assert stored_v1 is not None and stored_v1.schema == SCHEMA_V1
    # slug conflicts, archived listing
    assert (
        client.post(
            url, headers=admin.headers, json={"name": "x", "slug": "session_log", "kind": "session"}
        ).status_code
        == 409
    )
    assert (
        client.post(url, headers=admin.headers, json={"name": "x", "slug": "Bad Slug", "kind": "session"}).status_code
        == 422
    )
    client.patch(f"{url}/{fid}", headers=admin.headers, json={"archived": True})
    assert client.get(url, headers=admin.headers).json() == []
    assert len(client.get(url, headers=admin.headers, params={"include_archived": True}).json()) == 1
    actions = {e.action for e in db.scalars(select(AuditLog).where(AuditLog.entity_type == "form"))}
    assert {"form.create", "form.update", "form.publish"} <= actions


def test_validate_schema_endpoint(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    url = f"{API}/orgs/{org.id}/forms/validate-schema"
    r = client.post(url, headers=admin.headers, json={"schema": SCHEMA_V1})
    assert r.json() == {"valid": True, "errors": []}
    r = client.post(url, headers=admin.headers, json={"schema": {"schema_version": 2, "sections": []}})
    assert r.json()["valid"] is False and r.json()["errors"][0]["path"] == "schema_version"


def test_template_list_and_install(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    templates = client.get(f"{API}/orgs/{org.id}/form-templates", headers=admin.headers).json()
    assert {t["key"] for t in templates} == {
        "wellness_hooper",
        "session_rpe",
        "injury_report",
        "cmj_test",
        "gps_session",
        "body_mass",
    }
    hooper = next(t for t in templates if t["key"] == "wellness_hooper")
    assert hooper["references"] and hooper["schema"]["schema_version"] == 1
    r = client.post(f"{API}/orgs/{org.id}/form-templates/wellness_hooper/install", headers=admin.headers, json={})
    assert r.status_code == 201, r.text
    form = r.json()
    assert form["slug"] == "wellness_hooper" and form["current_version"]["version"] == 1
    assert form["athlete_can_submit"] is True and form["allow_multiple_per_day"] is False
    injury = client.post(f"{API}/orgs/{org.id}/form-templates/injury_report/install", headers=admin.headers).json()
    assert injury["sensitivity"] == "medical" and injury["kind"] == "medical"
    # second install gets a unique slug; explicit slug conflicts are 409
    again = client.post(
        f"{API}/orgs/{org.id}/form-templates/wellness_hooper/install", headers=admin.headers, json={"name": "Copy"}
    )
    assert again.json()["slug"] == "wellness_hooper_2" and again.json()["name"] == "Copy"
    conflict = client.post(
        f"{API}/orgs/{org.id}/form-templates/wellness_hooper/install",
        headers=admin.headers,
        json={"slug": "wellness_hooper"},
    )
    assert conflict.status_code == 409
    assert client.post(f"{API}/orgs/{org.id}/form-templates/nope/install", headers=admin.headers).status_code == 404


def test_schedules_crud(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    coach = f.member(db, org, "staff")
    team = f.group(db, org, "Team")
    f.assign(db, coach, team, "coach")
    form = f.template_form(db, org, "wellness_hooper")
    url = f"{API}/orgs/{org.id}/forms/{form.id}/schedules"
    body = {
        "group_id": str(team.id),
        "recurrence": "weekly",
        "days_of_week": [3, 1],
        "due_time": "07:30",
        "start_date": "2026-01-01",
        "remind": True,
    }
    r = client.post(url, headers=admin.headers, json=body)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["days_of_week"] == [1, 3] and s["active"] is True and s["end_date"] is None
    assert client.post(url, headers=admin.headers, json={**body, "days_of_week": []}).status_code == 422
    assert client.post(url, headers=admin.headers, json={**body, "due_time": "25:00"}).status_code == 422
    assert client.post(url, headers=admin.headers, json={**body, "days_of_week": [8]}).status_code == 422
    assert client.post(url, headers=coach.headers, json=body).status_code == 403
    assert client.get(url, headers=coach.headers).json()[0]["id"] == s["id"]
    patch_url = f"{API}/orgs/{org.id}/form-schedules/{s['id']}"
    r = client.patch(patch_url, headers=admin.headers, json={"recurrence": "daily", "active": False})
    assert r.status_code == 200 and r.json()["recurrence"] == "daily" and r.json()["active"] is False
    assert client.patch(patch_url, headers=admin.headers, json={"end_date": "2025-01-01"}).status_code == 400
    assert client.delete(patch_url, headers=admin.headers).status_code == 204
    assert client.get(url, headers=admin.headers).json() == []
