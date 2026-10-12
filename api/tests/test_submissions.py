from __future__ import annotations

import csv
import datetime as dt
import io

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, Submission
from tests import factories as f

API = "/api/v1"


def hooper(**kw: object) -> dict[str, object]:
    return {"sleep_quality": 2, "fatigue": 3, "stress": 2, "soreness": 4, "has_pain": False, **kw}


def test_create_submission_recomputes_and_defaults(client: TestClient, db: Session) -> None:
    org = f.org(db, timezone="America/New_York")
    admin = f.member(db, org, "admin")
    form = f.template_form(db, org, "wellness_hooper")
    athlete = f.athlete(db, org, timezone="Asia/Tokyo")
    other = f.athlete(db, org)  # no timezone -> org timezone
    url = f"{API}/orgs/{org.id}/submissions"
    # 2026-10-12T20:00Z is the 13th in Tokyo and the 12th in New York
    observed = "2026-10-12T20:00:00Z"
    r = client.post(
        url,
        headers=admin.headers,
        json={"form_id": str(form.id), "athlete_id": str(athlete.id), "observed_at": observed,
              "values": hooper(hooper_total=999, sleep_hours="")},
    )
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["local_date"] == "2026-10-13"
    assert s["computed"] == {"hooper_total": 11}  # client value ignored, recomputed
    assert "sleep_hours" not in s["values"] and "hooper_total" not in s["values"]
    assert s["form_version"] == 1 and s["source"] == "web" and s["submitted_by"] == str(admin.id)
    assert s["athlete_display_name"] == "Alex Runner"
    r = client.post(
        url,
        headers=admin.headers,
        json={"form_id": str(form.id), "athlete_id": str(other.id), "observed_at": observed, "values": hooper()},
    )
    assert r.json()["local_date"] == "2026-10-12"
    # explicit local_date wins; observed_at defaults to now
    r = client.post(
        url,
        headers=admin.headers,
        json={"form_id": str(form.id), "athlete_id": str(other.id), "local_date": "2026-01-02", "values": hooper()},
    )
    assert r.json()["local_date"] == "2026-01-02"
    assert dt.datetime.fromisoformat(r.json()["observed_at"]) > dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)


def test_validation_errors_and_duplicates(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    form = f.template_form(db, org, "wellness_hooper")
    athlete = f.athlete(db, org)
    url = f"{API}/orgs/{org.id}/submissions"
    body = {"form_id": str(form.id), "athlete_id": str(athlete.id), "local_date": "2026-10-12"}
    r = client.post(url, headers=admin.headers, json={**body, "values": {"sleep_quality": 9, "mood": 1}})
    assert r.status_code == 422
    assert r.json()["detail"]["message"] == "invalid submission"
    assert r.json()["detail"]["field_errors"] == {
        "sleep_quality": "out_of_range",
        "fatigue": "required",
        "stress": "required",
        "soreness": "required",
        "has_pain": "required",
        "mood": "unknown_field",
    }
    assert client.post(url, headers=admin.headers, json={**body, "values": hooper()}).status_code == 201
    # allow_multiple_per_day = false
    dup = client.post(url, headers=admin.headers, json={**body, "values": hooper()})
    assert dup.status_code == 409
    # a deleted submission no longer blocks the day
    sid = db.scalar(select(Submission.id))
    assert client.delete(f"{url}/{sid}", headers=admin.headers).status_code == 204
    assert client.post(url, headers=admin.headers, json={**body, "values": hooper()}).status_code == 201
    # unpublished form
    draft = f.form(db, org, "draft_only", f.NUMBER_SCHEMA, published=False)
    r = client.post(url, headers=admin.headers, json={"form_id": str(draft.id), "athlete_id": str(athlete.id), "values": {}})
    assert r.status_code == 409


def test_bulk_entry(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    form = f.template_form(db, org, "session_rpe")
    hooper_form = f.template_form(db, org, "wellness_hooper")
    a, b, c = (f.athlete(db, org, code=f"B-{i}") for i in range(3))
    r = client.post(
        f"{API}/orgs/{org.id}/submissions/bulk",
        headers=admin.headers,
        json={
            "form_id": str(form.id),
            "local_date": "2026-10-10",
            "entries": [
                {"athlete_id": str(a.id), "values": {"session_type": "field", "rpe": 6, "duration": 60}},
                {"athlete_id": str(b.id), "values": {"session_type": "field", "rpe": 12, "duration": 60}},
                {"athlete_id": str(c.id), "values": {"session_type": "gym", "rpe": 4, "duration": 45}},
                {"athlete_id": "00000000-0000-0000-0000-000000000001", "values": {}},
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert sorted(s["computed"]["srpe"] for s in body["created"]) == [180, 360]
    assert {e["athlete_id"]: e["field_errors"] for e in body["errors"]} == {
        str(b.id): {"rpe": "invalid_option"},
        "00000000-0000-0000-0000-000000000001": {"athlete_id": "not_found"},
    }
    assert all(s["local_date"] == "2026-10-10" for s in body["created"])
    # single-per-day form: duplicates inside the batch and against stored rows are reported
    entries = [{"athlete_id": str(a.id), "values": hooper()}, {"athlete_id": str(a.id), "values": hooper()}]
    r = client.post(
        f"{API}/orgs/{org.id}/submissions/bulk",
        headers=admin.headers,
        json={"form_id": str(hooper_form.id), "local_date": "2026-10-10", "entries": entries},
    )
    assert len(r.json()["created"]) == 1
    assert r.json()["errors"] == [{"athlete_id": str(a.id), "field_errors": {"local_date": "duplicate"}}]


def test_patch_validates_against_own_version(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    v1 = f.simple_schema({"key": "rpe", "type": "number", "label": "RPE", "required": True},
                         {"key": "x2", "type": "calculated", "label": "x2", "expression": "rpe * 2"})
    form = f.form(db, org, "log", v1)
    athlete = f.athlete(db, org)
    sub = f.submit(db, org, form, athlete, {"rpe": 3}, dt.date(2026, 10, 1))
    # publish v2 where rpe is replaced by a required select
    v2 = f.simple_schema({"key": "effort", "type": "select", "label": "Effort", "required": True,
                          "options": [{"value": "easy", "label": "Easy"}]})
    client.patch(f"{API}/orgs/{org.id}/forms/{form.id}", headers=admin.headers, json={"draft_schema": v2})
    assert client.post(f"{API}/orgs/{org.id}/forms/{form.id}/publish", headers=admin.headers).json()["version"] == 2
    url = f"{API}/orgs/{org.id}/submissions/{sub.id}"
    r = client.patch(url, headers=admin.headers, json={"values": {"rpe": 5}})
    assert r.status_code == 200, r.text
    assert r.json()["form_version"] == 1 and r.json()["computed"] == {"x2": 10}
    assert client.patch(url, headers=admin.headers, json={"values": {"effort": "easy"}}).status_code == 422
    r = client.patch(url, headers=admin.headers, json={"local_date": "2026-09-30"})
    assert r.json()["local_date"] == "2026-09-30"
    # new submissions use v2
    r = client.post(
        f"{API}/orgs/{org.id}/submissions",
        headers=admin.headers,
        json={"form_id": str(form.id), "athlete_id": str(athlete.id), "values": {"effort": "easy"}},
    )
    assert r.json()["form_version"] == 2
    audit = db.scalars(select(AuditLog).where(AuditLog.action == "submission.update")).all()
    assert audit and audit[0].details["before"]["values"] == {"rpe": 3}
    assert audit[0].details["after"]["values"] == {"rpe": 5}


def test_soft_delete_and_listing(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    form = f.form(db, org, "log", f.NUMBER_SCHEMA)
    team = f.group(db, org, "Team")
    a = f.athlete(db, org, code="L-1", groups=(team,))
    b = f.athlete(db, org, code="L-2")
    s1 = f.submit(db, org, form, a, {"value": 1}, dt.date(2026, 10, 1))
    f.submit(db, org, form, a, {"value": 2}, dt.date(2026, 10, 3))
    f.submit(db, org, form, b, {"value": 3}, dt.date(2026, 10, 2), source="api")
    url = f"{API}/orgs/{org.id}/submissions"
    items = client.get(url, headers=admin.headers).json()["items"]
    assert [i["values"]["value"] for i in items] == [2, 3, 1]  # newest local_date first
    assert client.get(url, headers=admin.headers, params={"athlete_id": str(a.id)}).json()["total"] == 2
    assert client.get(url, headers=admin.headers, params={"group_id": str(team.id)}).json()["total"] == 2
    assert client.get(url, headers=admin.headers, params={"start": "2026-10-02", "end": "2026-10-02"}).json()["total"] == 1
    assert client.get(url, headers=admin.headers, params={"source": "api"}).json()["total"] == 1
    assert client.delete(f"{url}/{s1.id}", headers=admin.headers).status_code == 204
    assert client.get(url, headers=admin.headers).json()["total"] == 2
    assert client.get(f"{url}/{s1.id}", headers=admin.headers).status_code == 404
    db.expire_all()
    assert db.get(Submission, s1.id).deleted_at is not None  # type: ignore[union-attr]
    assert db.scalar(select(AuditLog).where(AuditLog.action == "submission.delete")) is not None


def _csv(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def test_export_csv(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    researcher = f.member(db, org, "staff")
    study = f.group(db, org, "Study", kind="study")
    f.assign(db, researcher, study, "researcher", identifiable=False)
    v1 = f.simple_schema(
        {"key": "a", "type": "number", "label": "A"},
        {"key": "old", "type": "text", "label": "Old"},
        {"key": "tags", "type": "multiselect", "label": "Tags",
         "options": [{"value": "x", "label": "X"}, {"value": "y", "label": "Y"}]},
        {"key": "double", "type": "calculated", "label": "Double", "expression": "a * 2"},
    )
    form = f.form(db, org, "battery", v1)
    p1 = f.athlete(db, org, "Pia", "One", code="P-1", groups=(study,))
    f.submit(db, org, form, p1, {"a": 1.5, "old": "legacy", "tags": ["x", "y"]}, dt.date(2026, 10, 1))
    # v2: new field 'b' first, drops 'old'
    v2 = f.simple_schema(
        {"key": "b", "type": "boolean", "label": "B"},
        {"key": "a", "type": "number", "label": "A"},
        {"key": "double", "type": "calculated", "label": "Double", "expression": "a * 2"},
    )
    client.patch(f"{API}/orgs/{org.id}/forms/{form.id}", headers=admin.headers, json={"draft_schema": v2})
    client.post(f"{API}/orgs/{org.id}/forms/{form.id}/publish", headers=admin.headers)
    db.refresh(form)
    f.submit(db, org, form, p1, {"a": 2, "b": True}, dt.date(2026, 10, 2))

    url = f"{API}/orgs/{org.id}/submissions/export"
    r = client.get(url, headers=admin.headers, params={"form_id": str(form.id)})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    header = r.text.splitlines()[0].split(",")
    assert header == ["submission_id", "athlete_code", "athlete_name", "local_date", "observed_at", "source",
                      "form_version", "b", "a", "old", "tags", "double"]
    rows = _csv(r.text)
    assert [(x["local_date"], x["form_version"], x["a"], x["b"], x["old"], x["tags"], x["double"]) for x in rows] == [
        ("2026-10-01", "1", "1.5", "", "legacy", "x;y", "3"),
        ("2026-10-02", "2", "2", "true", "", "", "4"),
    ]
    assert rows[0]["athlete_name"] == "Pia One"
    # de-identified export drops the name column
    r = client.get(url, headers=admin.headers, params={"form_id": str(form.id), "deidentified": True})
    assert "athlete_name" not in r.text.splitlines()[0]
    assert _csv(r.text)[0]["athlete_code"] == "P-1"
    # masked staff never get names, even without asking
    r = client.get(url, headers=researcher.headers, params={"form_id": str(form.id)})
    assert r.status_code == 200
    assert "athlete_name" not in r.text.splitlines()[0] and "Pia" not in r.text
    assert len(_csv(r.text)) == 2
    assert client.get(url, headers=admin.headers, params={"form_id": str(form.id), "start": "2026-10-02"}).text.count("\n") == 2
