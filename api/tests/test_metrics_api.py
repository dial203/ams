from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.metrics.builtins import BUILTIN_METRICS
from tests import factories as f

API = "/api/v1"
D0 = dt.date(2026, 9, 1)


def day(n: int) -> dt.date:
    return D0 + dt.timedelta(days=n)


def series(
    client: TestClient, org_id: object, headers: dict, slug: str, athlete_id: object, start: dt.date, end: dt.date
) -> dict:
    r = client.get(
        f"{API}/orgs/{org_id}/metrics/{slug}/series",
        headers=headers,
        params={"athlete_id": str(athlete_id), "start": start.isoformat(), "end": end.isoformat()},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_builtins_seeded_and_editable(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    staff = f.member(db, org, "staff")
    metrics = client.get(f"{API}/orgs/{org.id}/metrics", headers=staff.headers).json()
    assert {m["slug"] for m in metrics} == {m["slug"] for m in BUILTIN_METRICS}
    by_slug = {m["slug"]: m for m in metrics}
    assert all(m["builtin"] for m in metrics)
    assert by_slug["acwr"]["thresholds"] is None and "Lolli" in by_slug["acwr"]["description"]
    assert by_slug["acwr"]["params"] == {"acute": 7, "chronic": 28, "method": "ewma", "coupled": False}
    assert by_slug["hrv_z"]["params"] == {"ln": True, "smooth": 7, "baseline": 60, "min_periods": 21}
    assert by_slug["sleep_duration"]["thresholds"] == {"direction": "low_bad", "amber": 420.0, "red": 360.0}
    assert by_slug["wellness_hooper"]["athlete_visible"] is True
    mid = by_slug["rhr_z"]["id"]
    r = client.patch(
        f"{API}/orgs/{org.id}/metrics/{mid}",
        headers=admin.headers,
        json={"thresholds": {"direction": "high_bad", "amber": 1.5, "red": 2.5}},
    )
    assert r.status_code == 200 and r.json()["thresholds"]["amber"] == 1.5
    assert client.delete(f"{API}/orgs/{org.id}/metrics/{mid}", headers=admin.headers).status_code == 400
    # built-ins referencing missing template forms resolve to empty series, not errors
    a = f.athlete(db, org)
    s = series(client, org.id, admin.headers, "wellness_hooper", a.id, day(0), day(6))
    assert len(s["points"]) == 7 and all(p["value"] is None and p["flag"] is None for p in s["points"])
    assert series(client, org.id, admin.headers, "acwr", a.id, day(0), day(6))["points"][0]["value"] is None


def test_metric_create_validation(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    f.template_form(db, org, "session_rpe")
    url = f"{API}/orgs/{org.id}/metrics"
    ok = {
        "slug": "load_ewma",
        "name": "Load EWMA",
        "source": "form:session_rpe.srpe",
        "daily_agg": "sum",
        "fill_zero": True,
        "transform": "ewma",
        "params": {"span": 7},
    }
    r = client.post(url, headers=admin.headers, json=ok)
    assert r.status_code == 201, r.text
    assert r.json()["builtin"] is False
    assert client.post(url, headers=admin.headers, json=ok).status_code == 409
    for source in (
        "form:nope.x",
        "form:session_rpe.nope",
        "form:session_rpe.notes",
        "wearable:nope",
        "metric:nope",
        "garbage",
    ):
        r = client.post(url, headers=admin.headers, json={**ok, "slug": "x1", "source": source})
        assert r.status_code == 422, source
    assert client.post(url, headers=admin.headers, json={**ok, "slug": "x2", "params": {"span": 0}}).status_code == 422
    # cycles: a -> b -> a
    a = client.post(url, headers=admin.headers, json={**ok, "slug": "a", "source": "metric:load_ewma"})
    assert a.status_code == 201
    b = client.post(url, headers=admin.headers, json={**ok, "slug": "b", "source": "metric:a"})
    assert b.status_code == 201
    r = client.patch(f"{url}/{a.json()['id']}", headers=admin.headers, json={"source": "metric:b"})
    assert r.status_code == 422 and "circular" in r.json()["detail"]
    r = client.post(url, headers=admin.headers, json={**ok, "slug": "selfie", "source": "metric:selfie"})
    assert r.status_code == 422
    # dependents block deletion; leaves can be deleted
    assert client.delete(f"{url}/{a.json()['id']}", headers=admin.headers).status_code == 409
    assert client.delete(f"{url}/{b.json()['id']}", headers=admin.headers).status_code == 204


def test_load_series_fill_zero_and_history(client: TestClient, db: Session) -> None:
    org = f.org(db)
    staff = f.member(db, org, "admin")
    form = f.template_form(db, org, "session_rpe")
    a = f.athlete(db, org)
    sess = {"session_type": "field"}
    f.submit(db, org, form, a, {**sess, "rpe": 5, "duration": 60}, day(1))  # 300
    f.submit(db, org, form, a, {**sess, "rpe": 4, "duration": 50}, day(3))  # 200
    f.submit(db, org, form, a, {**sess, "rpe": 2, "duration": 50}, day(3))  # 100 (same day: summed)
    for n in range(4, 12):
        f.submit(db, org, form, a, {**sess, "rpe": 5, "duration": 20}, day(n))  # 100/day
    s = series(client, org.id, staff.headers, "srpe_load", a.id, day(0), day(4))
    assert [p["value"] for p in s["points"]] == [None, 300, 0, 300, 100]  # 0 only after the first session
    assert all(p["source"] is None for p in s["points"])
    # rolling 7-day sum on day 7 uses history before `start`: days 1..7 = 300+0+300+100*4
    s = series(client, org.id, staff.headers, "acute_load_7d", a.id, day(7), day(7))
    assert s["points"][0]["value"] == 1000
    # monotony over days 5..11 (all 100) -> sd 0 -> null; strain null too
    assert series(client, org.id, staff.headers, "monotony_7d", a.id, day(11), day(11))["points"][0]["value"] is None
    # after the last session the load keeps counting as rest days (0) up to `end`
    s = series(client, org.id, staff.headers, "srpe_load", a.id, day(12), day(13))
    assert [p["value"] for p in s["points"]] == [0, 0]


def test_zscore_same_source_after_device_switch(client: TestClient, db: Session) -> None:
    """The athlete switches from an Oura ring to a Garmin watch: the z-score must not use Oura days."""
    org = f.org(db)
    admin = f.member(db, org, "admin")
    a = f.athlete(db, org)
    for n in range(20):
        f.wearable(db, a, day(n), "hrv_rmssd_ms", 60 + 2 * (n % 2), provider="oura", device="Oura Ring Gen3")
    for n in range(20, 30):
        f.wearable(db, a, day(n), "hrv_rmssd_ms", 90 + 2 * (n % 2), provider="garmin", device="Forerunner 265")
    r = client.post(
        f"{API}/orgs/{org.id}/metrics",
        headers=admin.headers,
        json={
            "slug": "hrv_raw_z",
            "name": "HRV z",
            "source": "wearable:hrv_rmssd_ms",
            "transform": "zscore",
            "params": {"baseline": 28, "min_periods": 5},
            "decimals": 3,
            "thresholds": {"direction": "low_bad", "amber": -1, "red": -2},
        },
    )
    assert r.status_code == 201, r.text
    pts = series(client, org.id, admin.headers, "hrv_raw_z", a.id, day(15), day(29))["points"]
    by_day = {p["date"]: p for p in pts}
    # Oura days before the switch: normal z-scores against Oura history (values 60/62 -> |z| ~ 1)
    assert by_day[day(19).isoformat()]["value"] is not None
    assert by_day[day(19).isoformat()]["source"] == "oura/Oura Ring Gen3"
    # first 5 Garmin days: fewer than min_periods same-source baseline days -> null, not a huge spike
    for n in range(20, 25):
        p = by_day[day(n).isoformat()]
        assert p["value"] is None and p["flag"] is None and p["source"] == "garmin/Forerunner 265"
    # from day 25 on: baseline is Garmin-only; values alternate 90/92 so |z| stays around 1
    for n in range(25, 30):
        p = by_day[day(n).isoformat()]
        assert p["value"] is not None and abs(p["value"]) < 1.5, p
        assert p["flag"] in ("green", "amber")
    # sanity: a baseline that mixed devices would put day 25 at ~ +8 SD
    mixed = [60 + 2 * (n % 2) for n in range(20)] + [90 + 2 * (n % 2) for n in range(20, 25)]
    import statistics

    assert (90 - statistics.mean(mixed[-28:])) / statistics.stdev(mixed[-28:]) > 1.5


def test_builtin_hrv_z_with_ln_and_smoothing(client: TestClient, db: Session) -> None:
    org = f.org(db)
    staff = f.member(db, org, "admin")
    a = f.athlete(db, org)
    for n in range(40):
        value = 70 + (n % 5)  # stable
        if n >= 35:
            value = 45  # sharp drop over the last 5 days
        f.wearable(db, a, day(n), "hrv_rmssd_ms", value)
    pts = series(client, org.id, staff.headers, "hrv_z", a.id, day(30), day(39))["points"]
    assert pts[0]["value"] is not None  # >= 21 baseline days by day 30
    assert pts[0]["flag"] == "green"
    assert pts[-1]["value"] < -1 and pts[-1]["flag"] == "red"
    assert pts[-1]["source"] == "oura/Oura Ring Gen3"


def test_series_permissions(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    coach = f.member(db, org, "staff")
    team = f.group(db, org, "T")
    f.assign(db, coach, team, "coach")
    a = f.athlete(db, org, groups=(team,))
    hidden = f.athlete(db, org)
    f.form(db, org, "med", f.NUMBER_SCHEMA, sensitivity="medical")
    client.post(
        f"{API}/orgs/{org.id}/metrics",
        headers=admin.headers,
        json={"slug": "med_val", "name": "Medical value", "source": "form:med.value"},
    )
    url = f"{API}/orgs/{org.id}/metrics/med_val/series"
    assert client.get(url, headers=coach.headers, params={"athlete_id": str(a.id)}).status_code == 403
    assert client.get(url, headers=admin.headers, params={"athlete_id": str(a.id)}).status_code == 200
    from sqlalchemy import select

    from app.models import AuditLog

    entry = db.scalar(select(AuditLog).where(AuditLog.action == "metric.read"))
    assert entry is not None and entry.entity_id == a.id and entry.details["metric"] == "med_val"
    assert (
        client.get(
            f"{API}/orgs/{org.id}/metrics/sleep_duration/series",
            headers=coach.headers,
            params={"athlete_id": str(hidden.id)},
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"{API}/orgs/{org.id}/metrics/nope/series", headers=coach.headers, params={"athlete_id": str(a.id)}
        ).status_code
        == 404
    )


def test_series_sources(client: TestClient, db: Session) -> None:
    org = f.org(db)
    staff = f.member(db, org, "admin")
    f.template_form(db, org, "session_rpe")
    sources = client.get(f"{API}/orgs/{org.id}/series-sources", headers=staff.headers).json()
    refs = {s["ref"]: s for s in sources}
    assert "form:session_rpe.srpe" in refs and refs["form:session_rpe.srpe"]["unit"] == "AU"
    assert "form:session_rpe.rpe" in refs  # numeric select
    assert "form:session_rpe.notes" not in refs and "form:session_rpe.session_type" not in refs
    assert refs["wearable:hrv_rmssd_ms"]["kind"] == "wearable" and refs["wearable:hrv_rmssd_ms"]["unit"] == "ms"
    assert refs["metric:acwr"]["kind"] == "metric"


def test_readiness_board_and_due_forms(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    researcher = f.member(db, org, "staff")
    team = f.group(db, org, "Team")
    squad = f.group(db, org, "Squad", parent=team)
    study = f.group(db, org, "Study", kind="study")
    f.assign(db, researcher, study, "researcher", identifiable=False)
    wellness = f.template_form(db, org, "wellness_hooper")
    good = f.athlete(db, org, "Good", "Day", code="R-1", groups=(squad, study), position="Mid")
    bad = f.athlete(db, org, "Bad", "Day", code="R-2", groups=(squad,))
    outsider = f.athlete(db, org, "Out", "Side", code="R-3")
    board_day = dt.date(2026, 10, 10)
    f.submit(
        db,
        org,
        wellness,
        good,
        {"sleep_quality": 2, "fatigue": 2, "stress": 2, "soreness": 2, "has_pain": False},
        board_day,
    )
    f.submit(
        db,
        org,
        wellness,
        bad,
        {"sleep_quality": 6, "fatigue": 6, "stress": 5, "soreness": 6, "has_pain": False},
        board_day - dt.timedelta(days=2),
    )
    f.submit(
        db,
        org,
        wellness,
        outsider,
        {"sleep_quality": 1, "fatigue": 1, "stress": 1, "soreness": 1, "has_pain": False},
        board_day - dt.timedelta(days=5),
    )
    f.wearable(db, bad, board_day, "sleep_duration_min", 330, unit="min")
    f.wearable(db, good, board_day - dt.timedelta(days=1), "sleep_duration_min", 480, unit="min")
    # schedule on the parent group applies to the squad
    client.post(
        f"{API}/orgs/{org.id}/forms/{wellness.id}/schedules",
        headers=admin.headers,
        json={"group_id": str(team.id), "recurrence": "daily", "start_date": "2026-01-01", "due_time": "08:00"},
    )
    r = client.get(
        f"{API}/orgs/{org.id}/dashboards/readiness", headers=admin.headers, params={"date": board_day.isoformat()}
    )
    assert r.status_code == 200, r.text
    board = r.json()
    assert [c["slug"] for c in board["columns"]] == ["wellness_hooper", "hrv_z", "rhr_z", "sleep_duration", "acwr"]
    rows = {row["athlete"]["code"]: row for row in board["rows"]}
    assert set(rows) == {"R-1", "R-2", "R-3"}
    assert rows["R-1"]["cells"]["wellness_hooper"] == {"value": 8, "flag": "green", "date": board_day.isoformat()}
    assert rows["R-2"]["cells"]["wellness_hooper"] == {
        "value": 23,
        "flag": "red",
        "date": (board_day - dt.timedelta(days=2)).isoformat(),
    }
    # older than 3 days -> empty cell
    assert rows["R-3"]["cells"]["wellness_hooper"] == {"value": None, "flag": None, "date": None}
    assert rows["R-2"]["cells"]["sleep_duration"]["flag"] == "red"
    assert rows["R-1"]["cells"]["sleep_duration"]["value"] == 480
    assert rows["R-1"]["cells"]["acwr"]["value"] is None
    # due forms: R-1 submitted today; R-2 has not; R-3 is not in a scheduled group
    assert (rows["R-1"]["due_forms"], rows["R-2"]["due_forms"], rows["R-3"]["due_forms"]) == (0, 1, 0)
    assert rows["R-1"]["athlete"]["position"] == "Mid"
    # group filter (descendants included) and masking for blinded staff
    r = client.get(
        f"{API}/orgs/{org.id}/dashboards/readiness",
        headers=admin.headers,
        params={"date": board_day.isoformat(), "group_id": str(team.id)},
    )
    assert {row["athlete"]["code"] for row in r.json()["rows"]} == {"R-1", "R-2"}
    r = client.get(
        f"{API}/orgs/{org.id}/dashboards/readiness", headers=researcher.headers, params={"date": board_day.isoformat()}
    )
    rows = r.json()["rows"]
    assert [row["athlete"]["display_name"] for row in rows] == ["R-1"]
    assert rows[0]["cells"]["wellness_hooper"]["value"] == 8
