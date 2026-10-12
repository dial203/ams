from __future__ import annotations

import datetime as dt
import io
from typing import Any

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ImportBatch, Submission
from tests import factories as f

API = "/api/v1"

GPS_CSV = """Player ID,Date,Total Distance (m),HSR Distance,Sprint Distance,Accels,Decels,Player Load,Duration,Notes
P-1,2026-10-01,8123,610,120,45,40,812.5,82,ok
p-2,2026-10-01,7001,1,0,30,28,700,75,
P-9,2026-10-01,5000,0,0,0,0,0,60,unknown athlete
P-1,2026-10-02,abc,0,0,0,0,0,60,bad number
P-2,2026-10-02,9000,500,50,40,40,900,,missing duration
"""


def preview(client: TestClient, org_id: Any, form_id: Any, headers: dict[str, str], name: str, data: bytes) -> dict:
    r = client.post(
        f"{API}/orgs/{org_id}/forms/{form_id}/imports/preview",
        headers=headers,
        files={"file": (name, data, "application/octet-stream")},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_csv_preview_commit_and_rollback(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    form = f.template_form(db, org, "gps_session")
    p1 = f.athlete(db, org, code="P-1")
    p2 = f.athlete(db, org, code="P-2")
    pv = preview(client, org.id, form.id, admin.headers, "gps.csv", GPS_CSV.encode())
    assert pv["row_count"] == 5 and len(pv["sample_rows"]) == 5
    assert pv["columns"][0] == "Player ID"
    assert pv["suggested_athlete_column"] == "Player ID"
    assert pv["suggested_date_column"] == "Date"
    mapping = {
        "Total Distance (m)": "total_distance_m",
        "HSR Distance": "hsr_distance_m",
        "Sprint Distance": "sprint_distance_m",
        "Accels": "accelerations",
        "Decels": "decelerations",
        "Player Load": "player_load",
        "Duration": "duration_min",
        "Notes": "notes",
    }
    assert pv["suggested_mapping"] == mapping
    commit = {
        "upload_id": pv["upload_id"],
        "mapping": mapping,
        "athlete_column": "Player ID",
        "athlete_match": "code",
        "date_column": "Date",
    }
    # dry run: nothing saved, same report
    dry = client.post(f"{API}/orgs/{org.id}/forms/{form.id}/imports", headers=admin.headers,
                      json={**commit, "dry_run": True})
    assert dry.status_code == 201, dry.text
    assert dry.json()["dry_run"] is True and dry.json()["created_count"] == 2
    assert db.scalar(select(Submission.id)) is None
    r = client.post(f"{API}/orgs/{org.id}/forms/{form.id}/imports", headers=admin.headers, json=commit)
    assert r.status_code == 201, r.text
    batch = r.json()
    assert batch["row_count"] == 5 and batch["created_count"] == 2 and batch["skipped_count"] == 3
    assert batch["filename"] == "gps.csv"
    errors = {e["row"]: e["message"] for e in batch["errors"]}
    assert set(errors) == {3, 4, 5}
    assert "no athlete matches 'P-9'" in errors[3]
    assert "Total Distance (m)" in errors[4]
    assert "duration_min: required" in errors[5]
    subs = db.scalars(select(Submission).order_by(Submission.athlete_id)).all()
    assert {s.athlete_id for s in subs} == {p1.id, p2.id}
    s1 = next(s for s in subs if s.athlete_id == p1.id)
    assert s1.source == "import" and str(s1.import_batch_id) == batch["id"]
    assert s1.values["total_distance_m"] == 8123 and s1.values["player_load"] == 812.5
    assert s1.computed["distance_per_min"] == round(8123 / 82, 1)
    assert s1.local_date == dt.date(2026, 10, 1)
    # listing
    listed = client.get(f"{API}/orgs/{org.id}/imports", headers=admin.headers, params={"form_id": str(form.id)}).json()
    assert {b["dry_run"] for b in listed} == {True, False}
    # rollback: delete the batch soft-deletes its submissions
    assert client.delete(f"{API}/orgs/{org.id}/imports/{batch['id']}", headers=admin.headers).status_code == 204
    db.expire_all()
    assert all(s.deleted_at is not None for s in db.scalars(select(Submission)))
    assert db.get(ImportBatch, batch["id"]).deleted_at is not None  # type: ignore[union-attr]
    assert client.get(f"{API}/orgs/{org.id}/submissions", headers=admin.headers).json()["total"] == 0
    assert len(client.get(f"{API}/orgs/{org.id}/imports", headers=admin.headers).json()) == 1  # only the dry run


def _xlsx(rows: list[list[Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_xlsx_with_name_email_and_external_id_matching(client: TestClient, db: Session) -> None:
    org = f.org(db, timezone="America/New_York")
    admin = f.member(db, org, "admin")
    form = f.template_form(db, org, "cmj_test")
    f.athlete(db, org, "Maria", "Garcia", code="C-1", email="maria@example.com", attributes={"external_id": "VALD-1"})
    f.athlete(db, org, "John", "Smith", code="C-2", email="john@example.com", attributes={"external_id": 2002})
    data = _xlsx(
        [
            ["Athlete", "Email", "Ext", "Test Date", "Jump Height (cm)", "RSI mod", "Body Mass", "Peak Power"],
            ["Garcia, Maria", "MARIA@example.com", "VALD-1", dt.datetime(2026, 10, 5, 9, 30), 38.4, 0.52, 81.2, 4100],
            ["john smith", "john@example.com", "2002", dt.datetime(2026, 10, 5, 0, 0), 41, 0.61, 90, 4600.0],
            ["Nobody", "x@example.com", "999", dt.datetime(2026, 10, 5), 30, 0.4, 70, 3000],
        ]
    )
    pv = preview(client, org.id, form.id, admin.headers, "cmj.xlsx", data)
    assert pv["row_count"] == 3
    assert pv["sample_rows"][0]["Test Date"] == "2026-10-05T09:30:00"
    assert pv["sample_rows"][1]["Test Date"] == "2026-10-05"
    assert pv["suggested_mapping"].get("Jump Height (cm)") == "jump_height_cm"
    assert pv["suggested_mapping"].get("Body Mass") == "body_mass_kg"
    mapping = {"Jump Height (cm)": "jump_height_cm", "RSI mod": "rsi_mod", "Body Mass": "body_mass_kg",
               "Peak Power": "peak_power_w"}
    url = f"{API}/orgs/{org.id}/forms/{form.id}/imports"
    for column, mode in (("Athlete", "name"), ("Email", "email"), ("Ext", "external_id")):
        r = client.post(
            url,
            headers=admin.headers,
            json={"upload_id": pv["upload_id"], "mapping": mapping, "athlete_column": column, "athlete_match": mode,
                  "date_column": "Test Date", "dry_run": True},
        )
        assert r.status_code == 201, r.text
        assert r.json()["created_count"] == 2, (mode, r.json()["errors"])
        assert [e["row"] for e in r.json()["errors"]] == [3]
    r = client.post(
        url,
        headers=admin.headers,
        json={"upload_id": pv["upload_id"], "mapping": mapping, "athlete_column": "Athlete", "athlete_match": "name",
              "date_column": "Test Date"},
    )
    subs = db.scalars(select(Submission).order_by(Submission.observed_at)).all()
    assert len(subs) == 2
    timed = next(s for s in subs if s.values["jump_height_cm"] == 38.4)
    # naive date-times are read in the org time zone (America/New_York, UTC-4 in October)
    assert timed.observed_at == dt.datetime(2026, 10, 5, 13, 30, tzinfo=dt.UTC)
    assert timed.computed["peak_power_rel"] == round(4100 / 81.2, 1)


def test_import_matching_respects_masking_and_scope(client: TestClient, db: Session) -> None:
    org = f.org(db)
    blinded = f.member(db, org, "staff")
    study = f.group(db, org, "Study", kind="study")
    f.assign(db, blinded, study, "researcher", identifiable=False)
    form = f.form(db, org, "study_measure", f.NUMBER_SCHEMA, sensitivity="research")
    f.athlete(db, org, "Hidden", "Person", code="S-1", email="hidden@example.com", groups=(study,))
    f.athlete(db, org, "Out", "Side", code="S-2")
    csv_bytes = b"code,email,value,date\nS-1,hidden@example.com,5,2026-10-01\nS-2,,6,2026-10-01\n"
    pv = preview(client, org.id, form.id, blinded.headers, "m.csv", csv_bytes)
    url = f"{API}/orgs/{org.id}/forms/{form.id}/imports"
    base = {"upload_id": pv["upload_id"], "mapping": {"value": "value"}, "date_column": "date", "dry_run": True}
    by_code = client.post(url, headers=blinded.headers, json={**base, "athlete_column": "code", "athlete_match": "code"})
    assert by_code.json()["created_count"] == 1  # S-2 is outside the researcher's scope
    by_email = client.post(url, headers=blinded.headers, json={**base, "athlete_column": "email", "athlete_match": "email"})
    assert by_email.json()["created_count"] == 0  # emails are masked for this researcher: no matching on them


def test_import_requests_validation(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    viewer = f.member(db, org, "staff")
    team = f.group(db, org, "T")
    f.assign(db, viewer, team, "viewer")
    form = f.form(db, org, "simple", f.NUMBER_SCHEMA)
    url = f"{API}/orgs/{org.id}/forms/{form.id}/imports"
    bad = client.post(f"{url}/preview", headers=admin.headers, files={"file": ("x.txt", b"a,b\n1,2\n", "text/plain")})
    assert bad.status_code == 400
    assert client.post(f"{url}/preview", headers=viewer.headers, files={"file": ("x.csv", b"a\n1\n", "text/csv")}).status_code == 403
    pv = preview(client, org.id, form.id, admin.headers, "x.csv", b"code;value\nA;1\n")  # semicolon dialect
    assert pv["columns"] == ["code", "value"]
    body = {"upload_id": pv["upload_id"], "mapping": {"value": "value"}, "athlete_column": "code", "athlete_match": "code"}
    assert client.post(url, headers=admin.headers, json=body).status_code == 400  # no date column nor default
    assert client.post(url, headers=admin.headers, json={**body, "mapping": {"nope": "value"},
                                                          "default_date": "2026-10-01"}).status_code == 400
    assert client.post(url, headers=admin.headers, json={**body, "mapping": {"value": "missing"},
                                                          "default_date": "2026-10-01"}).status_code == 400
    r = client.post(url, headers=admin.headers, json={**body, "default_date": "2026-10-01",
                                                      "upload_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404
    r = client.post(url, headers=admin.headers, json={**body, "default_date": "2026-10-01", "date_format": "%d/%m/%Y"})
    assert r.status_code == 201 and r.json()["errors"][0]["message"].endswith("no athlete matches 'A'")


def test_parse_helpers() -> None:
    from app.services.imports import parse_duration, parse_number, parse_when

    assert parse_number("1,5") == 1.5 and parse_number(" 12 ") == 12
    assert parse_duration("1:30") == 90 and parse_duration("0:01:30") == 1.5 and parse_duration("45") == 45
    observed, day = parse_when("05/10/2026 07:00", "%d/%m/%Y %H:%M", "Europe/Oslo")
    assert day == dt.date(2026, 10, 5) and observed is not None and observed.utcoffset() == dt.timedelta(hours=2)
    assert parse_when("2026-10-05", None, "UTC") == (None, dt.date(2026, 10, 5))
    observed, day = parse_when("2026-10-05T23:30:00-05:00", None, "UTC")
    assert day == dt.date(2026, 10, 6)
