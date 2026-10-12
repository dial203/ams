from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from typer.testing import CliRunner

from app.models import Athlete, Form, FormVersion, Organization, Submission, WearableDaily
from app.seed import DEVICE_SWITCH, seed_demo

API = "/api/v1"
ANCHOR = dt.date(2026, 10, 12)


def test_seed_demo_on_empty_database(client: TestClient, db: Session) -> None:
    org = seed_demo(db, "demo-pass-123", ANCHOR)
    db.commit()
    assert org.timezone == "America/New_York"
    assert db.scalar(select(func.count()).select_from(Athlete)) == 16
    forms = db.scalars(select(Form)).unique().all()
    assert {f.slug for f in forms} == {
        "wellness_hooper",
        "session_rpe",
        "injury_report",
        "cmj_test",
        "gps_session",
        "body_mass",
    }
    assert db.scalar(select(func.count()).select_from(FormVersion)) == 6
    assert db.scalar(select(func.count()).select_from(Submission)) > 900
    switch = db.scalar(select(Athlete).where(Athlete.code == DEVICE_SWITCH))
    devices = set(db.scalars(select(WearableDaily.device).where(WearableDaily.athlete_id == switch.id)))  # type: ignore[union-attr]
    assert devices == {"Oura Ring Gen3", "Forerunner 265"}

    tokens = client.post(f"{API}/auth/login", json={"email": "admin@example.com", "password": "demo-pass-123"}).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    board = client.get(
        f"{API}/orgs/{org.id}/dashboards/readiness", headers=headers, params={"date": ANCHOR.isoformat()}
    ).json()
    rows = {r["athlete"]["code"]: r for r in board["rows"]}
    assert len(rows) == 16
    flags = {(code, slug): cell["flag"] for code, r in rows.items() for slug, cell in r["cells"].items()}
    assert flags[("A-0005", "wellness_hooper")] == "red"
    assert flags[("A-0005", "hrv_z")] in ("amber", "red")
    assert flags[("A-0005", "sleep_duration")] in ("amber", "red")
    assert rows[DEVICE_SWITCH]["cells"]["hrv_z"]["value"] is None  # baseline restarted after the device change
    assert sum(r["due_forms"] for r in rows.values()) > 0

    # the blinded researcher sees only the pilot-study athletes, by code
    tokens = client.post(
        f"{API}/auth/login", json={"email": "researcher@example.com", "password": "demo-pass-123"}
    ).json()
    r = client.get(f"{API}/orgs/{org.id}/athletes", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    items = r.json()["items"]
    assert len(items) == 6 and all(a["masked"] and a["display_name"] == a["code"] for a in items)


def test_seed_demo_cli_refuses_twice(db: Session) -> None:
    from app.cli import cli

    runner = CliRunner()
    first = runner.invoke(cli, ["seed-demo", "--password", "demo-pass-123", "--today", ANCHOR.isoformat()])
    assert first.exit_code == 0, first.output
    assert "seeded Demo Performance" in first.output
    second = runner.invoke(cli, ["seed-demo", "--password", "demo-pass-123"])
    assert second.exit_code == 1
    assert db.scalar(select(func.count()).select_from(Organization)) == 1


def test_cli_create_org_and_admin(db: Session) -> None:
    from app.cli import cli

    runner = CliRunner()
    r = runner.invoke(cli, ["create-org", "--name", "Unit 7", "--timezone", "Europe/Berlin"])
    assert r.exit_code == 0, r.output
    org_id, slug = r.output.split()
    assert slug == "unit-7"
    r = runner.invoke(
        cli,
        [
            "create-admin",
            "--email",
            "boss@example.com",
            "--org",
            slug,
            "--password",
            "boss-pass-1",
            "--full-name",
            "Boss",
        ],
    )
    assert r.exit_code == 0, r.output
    r = runner.invoke(
        cli, ["create-admin", "--email", "second@example.com", "--org", org_id, "--password", "second-pass-1"]
    )
    assert r.exit_code == 0, r.output
    r = runner.invoke(
        cli,
        ["create-user", "--email", "coach@example.com", "--org", slug, "--role", "staff", "--password", "coach-pass-1"],
    )
    assert r.exit_code == 0, r.output
    from app.models import OrgMembership

    roles = sorted(db.scalars(select(OrgMembership.role)).all())
    assert roles == ["admin", "owner", "staff"]
    assert runner.invoke(cli, ["create-org", "--name", "Bad", "--timezone", "Nowhere"]).exit_code != 0


def _fingerprint(db: Session) -> list[tuple]:
    subs = db.execute(
        select(Athlete.code, Submission.local_date, Form.slug, Submission.values)
        .join(Athlete, Athlete.id == Submission.athlete_id)
        .join(Form, Form.id == Submission.form_id)
    ).all()
    wear = db.execute(
        select(Athlete.code, WearableDaily.local_date, WearableDaily.metric, WearableDaily.value).join(
            Athlete, Athlete.id == WearableDaily.athlete_id
        )
    ).all()
    return sorted((str(r[0]), str(r[1]), str(r[2]), repr(r[3])) for r in [*subs, *wear])


def test_seed_demo_is_deterministic(db: Session) -> None:
    seed_demo(db, "demo-pass-123", ANCHOR)
    first = _fingerprint(db)
    db.rollback()
    seed_demo(db, "demo-pass-123", ANCHOR)
    assert _fingerprint(db) == first
    db.rollback()
