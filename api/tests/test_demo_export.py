"""The web demo fixtures (app/demo_export.py) are well-formed and match each role's view."""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

from sqlalchemy.orm import Session
from typer.testing import CliRunner

from app.demo_export import BOARD_DAYS, DEMO_ROLES, FORMAT, export_demo
from app.seed import DETERIORATING, FIRST, LAST, seed_demo

ANCHOR = dt.date(2026, 10, 12)
PILOT = {"A-0002", "A-0003", "A-0004", "A-0010", "A-0011", "A-0012"}


def _names(codes: set[str] | None = None) -> list[str]:
    return [n for i in range(16) if codes is None or f"A-{i + 1:04d}" in codes for n in (FIRST[i], LAST[i])]


def _mentions(text: str, names: list[str]) -> list[str]:
    return [n for n in names if re.search(rf"\b{re.escape(n)}\b", text)]


def test_export_demo_writes_role_correct_fixtures(db: Session, tmp_path: Path) -> None:
    seed_demo(db, "demo-pass-123", ANCHOR)
    db.commit()
    paths = export_demo(tmp_path)
    assert [p.name for p in paths] == [f"{role}.json" for role, _ in DEMO_ROLES]
    data = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in paths}

    for role, email in DEMO_ROLES:
        d = data[role]
        assert d["format"] == FORMAT and d["role"] == role and d["email"] == email
        assert d["generated_on"] == ANCHOR.isoformat()
        assert d["data_start"] == (ANCHOR - dt.timedelta(days=41)).isoformat()
        assert d["me"]["user"]["email"] == email
        assert d["org"]["slug"] == "demo-performance"
        # the honest demo state: Open Wearables is not configured
        assert d["wearables"]["providers"]["$error"]["status"] in (403, 503)

    owner = data["owner"]
    assert owner["access"]["is_admin"] is True
    assert len(owner["athletes"]) == 16 and not any(a["masked"] for a in owner["athletes"])
    assert {f["slug"] for f in owner["forms"]} >= {"wellness_hooper", "session_rpe", "injury_report"}
    assert all(not isinstance(v, dict) for v in owner["form_versions"].values())
    assert len(owner["submissions"]) > 900
    assert owner["invitations"] == [] and isinstance(owner["form_templates"], list)
    assert owner["wearables"]["providers"]["$error"] == {
        "status": 503,
        "body": {"detail": "Open Wearables is not configured (OW_BASE_URL / OW_API_KEY)"},
    }
    boards = owner["readiness"]["all"]
    assert sorted(boards) == [(ANCHOR - dt.timedelta(days=n)).isoformat() for n in range(BOARD_DAYS - 1, -1, -1)]
    today = boards[ANCHOR.isoformat()]
    flags = {r["athlete"]["code"]: r["cells"]["wellness_hooper"]["flag"] for r in today["rows"]}
    assert len(flags) == 16 and flags[DETERIORATING] == "red"
    # full series: every metric x athlete, one point per day of the seeded range
    series = owner["series"]["points"]
    assert set(series) == {m["slug"] for m in owner["metrics"]}
    assert all(len(points) == 42 for per_athlete in series.values() for points in per_athlete.values())
    daily = owner["wearables"]["daily"]
    assert len(daily) == 16 and all(p["local_date"] <= ANCHOR.isoformat() for pts in daily.values() for p in pts)

    coach = data["coach"]
    assert coach["access"]["is_admin"] is False
    assert len(coach["athletes"]) == 16
    assert "injury_report" not in {f["slug"] for f in coach["forms"]}
    assert coach["invitations"]["$error"]["status"] == 403
    assert coach["form_templates"]["$error"]["status"] == 403
    assert "injury_report" in {f["slug"] for f in data["medic"]["forms"]}

    researcher = data["researcher"]
    athletes = researcher["athletes"]
    assert {a["code"] for a in athletes} == PILOT
    assert all(a["masked"] and a["display_name"] == a["code"] and a["first_name"] is None for a in athletes)
    assert all(not r["identifiable"] for r in researcher["access"]["athletes"].values())
    text = json.dumps(researcher, ensure_ascii=False)
    # no athlete's name anywhere in the file (the member list shows staff only to non-admins)
    assert _mentions(text, _names()) == []
    board_codes = {r["athlete"]["display_name"] for r in researcher["readiness"]["all"][ANCHOR.isoformat()]["rows"]}
    assert board_codes == PILOT

    athlete = data["athlete"]
    assert athlete["readiness"]["$error"]["status"] == 403
    assert athlete["self"]["athlete"]["code"] == "A-0001"
    assert len(athlete["self"]["submissions"]) > 0


def test_group_board_is_the_all_groups_board_restricted_to_the_group(db: Session) -> None:
    """Why the exporter ships only all-groups boards: the demo derives group boards from them."""
    from fastapi.testclient import TestClient
    from sqlalchemy import select

    from app.main import app
    from app.models import Group, User
    from app.security import create_access_token

    org = seed_demo(db, "demo-pass-123", ANCHOR)
    db.commit()
    user = db.scalar(select(User).where(User.email == "admin@example.com"))
    sprints = db.scalar(select(Group).where(Group.name == "Sprints"))
    assert user is not None and sprints is not None
    headers = {"Authorization": f"Bearer {create_access_token(user.id)[0]}"}
    url = f"/api/v1/orgs/{org.id}/dashboards/readiness"
    with TestClient(app) as client:
        day = (ANCHOR - dt.timedelta(days=3)).isoformat()
        everyone = client.get(url, params={"date": day}, headers=headers).json()
        group = client.get(url, params={"date": day, "group_id": str(sprints.id)}, headers=headers).json()
    ids = {r["athlete"]["id"] for r in group["rows"]}
    assert len(ids) == 8
    assert group["rows"] == [r for r in everyone["rows"] if r["athlete"]["id"] in ids]
    assert group["columns"] == everyone["columns"]


def test_export_demo_cli_refuses_without_the_seed(db: Session, tmp_path: Path) -> None:
    from app.cli import cli

    result = CliRunner().invoke(cli, ["export-demo", "--out", str(tmp_path)])
    assert result.exit_code == 1
    assert "run seed-demo first" in result.output
    assert list(tmp_path.iterdir()) == []
