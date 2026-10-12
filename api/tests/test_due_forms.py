from __future__ import annotations

import datetime as dt
import json

import httpx
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import FormSchedule, PushToken, ReminderSent
from app.services import reminders
from tests import factories as f

API = "/api/v1"


def setup_athlete(db: Session, tz: str = "UTC") -> tuple:
    org = f.org(db, timezone=tz)
    team = f.group(db, org, "Team")
    squad = f.group(db, org, "Squad", parent=team)
    athlete_actor = f.member(db, org, "athlete")
    a = f.athlete(db, org, "Ath", "Lete", groups=(squad,))
    a.user_id = athlete_actor.id
    db.commit()
    return org, team, squad, athlete_actor, a


def schedule(db: Session, org: object, form: object, group: object, **kw: object) -> FormSchedule:
    s = FormSchedule(org_id=org.id, form_id=form.id, group_id=group.id,  # type: ignore[attr-defined]
                     **{"recurrence": "daily", "days_of_week": [], "due_time": "08:00",
                        "start_date": dt.date(2026, 1, 1), "remind": False, "active": True, **kw})
    db.add(s)
    db.commit()
    return s


def test_me_forms_due_status(client: TestClient, db: Session) -> None:
    org, team, squad, me, a = setup_athlete(db)
    wellness = f.template_form(db, org, "wellness_hooper")
    srpe = f.template_form(db, org, "session_rpe")
    body = f.template_form(db, org, "body_mass")
    f.template_form(db, org, "injury_report")  # athletes cannot submit: never listed
    other_group = f.group(db, org, "Other")
    schedule(db, org, wellness, team, due_time="07:30")  # ancestor group applies
    schedule(db, org, srpe, squad, recurrence="weekly", days_of_week=[1, 3], due_time="18:00")  # Mon, Wed
    schedule(db, org, body, other_group)  # not the athlete's group
    url = f"{API}/orgs/{org.id}/me/forms"
    monday = "2026-10-12"
    forms = client.get(url, headers=me.headers, params={"date": monday}).json()
    assert [x["form"]["slug"] for x in forms] == ["wellness_hooper", "session_rpe", "body_mass"]
    assert [x["due_time"] for x in forms] == ["07:30", "18:00", None]
    assert [x["completed"] for x in forms] == [False, False, False]
    assert forms[0]["version"]["version"] == 1 and forms[0]["last_submitted_at"] is None
    tuesday = "2026-10-13"
    forms = client.get(url, headers=me.headers, params={"date": tuesday}).json()
    assert [(x["form"]["slug"], x["due_time"]) for x in forms] == [
        ("wellness_hooper", "07:30"), ("body_mass", None), ("session_rpe", None)
    ]
    # submit through the self-service endpoint (source mobile) and the day is completed
    r = client.post(f"{API}/orgs/{org.id}/me/submissions", headers=me.headers, json={
        "form_id": str(wellness.id), "local_date": monday,
        "values": {"sleep_quality": 3, "fatigue": 3, "stress": 3, "soreness": 3, "has_pain": False}})
    assert r.status_code == 201, r.text
    assert r.json()["source"] == "mobile" and r.json()["athlete_id"] == str(a.id)
    forms = client.get(url, headers=me.headers, params={"date": monday}).json()
    assert forms[0]["completed"] is True and forms[0]["last_submitted_at"] is not None
    # once schedules
    once = f.template_form(db, org, "body_mass", slug="checkin")
    schedule(db, org, once, squad, recurrence="once", start_date=dt.date(2026, 10, 14))
    on_day = client.get(url, headers=me.headers, params={"date": "2026-10-14"}).json()
    assert ("checkin", "08:00") in [(x["form"]["slug"], x["due_time"]) for x in on_day]
    next_day = client.get(url, headers=me.headers, params={"date": "2026-10-15"}).json()
    assert ("checkin", None) in [(x["form"]["slug"], x["due_time"]) for x in next_day]
    # inactive / ended schedules do not count
    db.execute(FormSchedule.__table__.update().values(active=False))
    db.commit()
    assert all(x["due_time"] is None for x in client.get(url, headers=me.headers, params={"date": monday}).json())


def test_me_submission_rules(client: TestClient, db: Session) -> None:
    org, team, squad, me, a = setup_athlete(db)
    injury = f.template_form(db, org, "injury_report")
    cmj = f.template_form(db, org, "cmj_test")  # view only
    r = client.post(f"{API}/orgs/{org.id}/me/submissions", headers=me.headers,
                    json={"form_id": str(injury.id), "values": {}})
    assert r.status_code == 404
    r = client.post(f"{API}/orgs/{org.id}/me/submissions", headers=me.headers,
                    json={"form_id": str(cmj.id), "values": {"jump_height_cm": 30, "body_mass_kg": 70}})
    assert r.status_code == 404
    # staff can record a CMJ the athlete can then view
    admin = f.member(db, org, "admin")
    client.post(f"{API}/orgs/{org.id}/submissions", headers=admin.headers, json={
        "form_id": str(cmj.id), "athlete_id": str(a.id), "values": {"jump_height_cm": 30, "body_mass_kg": 70}})
    client.post(f"{API}/orgs/{org.id}/submissions", headers=admin.headers, json={
        "form_id": str(injury.id), "athlete_id": str(a.id),
        "values": {"onset_date": "2026-10-01", "problem_type": "illness", "availability": "full"}})
    mine = client.get(f"{API}/orgs/{org.id}/me/submissions", headers=me.headers).json()
    assert [s["form_id"] for s in mine["items"]] == [str(cmj.id)]
    assert mine["items"][0]["athlete_display_name"] == "Ath Lete"


def test_me_metrics(client: TestClient, db: Session) -> None:
    org, team, squad, me, a = setup_athlete(db)
    wellness = f.template_form(db, org, "wellness_hooper")
    day = dt.date(2026, 10, 5)
    f.submit(db, org, wellness, a, {"sleep_quality": 5, "fatigue": 5, "stress": 5, "soreness": 5, "has_pain": False}, day)
    r = client.get(f"{API}/orgs/{org.id}/me/metrics", headers=me.headers,
                   params={"start": "2026-10-04", "end": "2026-10-06"})
    assert r.status_code == 200
    by_slug = {m["metric"]["slug"]: m for m in r.json()}
    assert set(by_slug) == {"wellness_hooper", "srpe_load", "sleep_duration"}
    assert [p["value"] for p in by_slug["wellness_hooper"]["points"]] == [None, 20, None]
    assert by_slug["wellness_hooper"]["points"][1]["flag"] == "amber"
    # athlete can read athlete_visible series directly, but not staff-only metrics
    url = f"{API}/orgs/{org.id}/metrics"
    assert client.get(f"{url}/wellness_hooper/series", headers=me.headers, params={"athlete_id": str(a.id)}).status_code == 200
    assert client.get(f"{url}/acwr/series", headers=me.headers, params={"athlete_id": str(a.id)}).status_code == 404


@respx.mock
def test_send_due_reminders_once_per_day(db: Session, monkeypatch: object) -> None:
    org, team, squad, me, a = setup_athlete(db, tz="America/New_York")
    wellness = f.template_form(db, org, "wellness_hooper")
    schedule(db, org, wellness, team, due_time="08:00", remind=True)
    db.add(PushToken(user_id=me.id, token="ExponentPushToken[ok]", platform="ios"))
    db.add(PushToken(user_id=me.id, token="ExponentPushToken[gone]", platform="android"))
    db.commit()
    monkeypatch.setattr(settings, "expo_push_enabled", True)  # type: ignore[attr-defined]
    route = respx.post(settings.expo_push_url).mock(
        return_value=httpx.Response(200, json={"data": [
            {"status": "ok", "id": "1"},
            {"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}},
        ]})
    )
    # 06:30 New York (10:30Z): more than an hour before 08:00 -> nothing yet
    early = dt.datetime(2026, 10, 12, 10, 30, tzinfo=dt.UTC)
    assert reminders.send_due_reminders(db, early) == 0
    assert not route.called
    # 07:15 New York: within the 60 min lead -> one reminder
    now = dt.datetime(2026, 10, 12, 11, 15, tzinfo=dt.UTC)
    assert reminders.send_due_reminders(db, now) == 1
    db.commit()
    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    assert {m["to"] for m in sent} == {"ExponentPushToken[ok]", "ExponentPushToken[gone]"}
    assert sent[0]["data"]["form_id"] == str(wellness.id) and sent[0]["data"]["local_date"] == "2026-10-12"
    # the unregistered device token is dropped
    assert [t.token for t in db.scalars(select(PushToken))] == ["ExponentPushToken[ok]"]
    # second run the same day: already reminded
    assert reminders.send_due_reminders(db, now + dt.timedelta(minutes=15)) == 0
    assert route.call_count == 1
    assert len(db.scalars(select(ReminderSent)).all()) == 1
    # completing the form prevents tomorrow's reminder
    f.submit(db, org, wellness, a, {"sleep_quality": 3, "fatigue": 3, "stress": 3, "soreness": 3, "has_pain": False},
             dt.date(2026, 10, 13))
    assert reminders.send_due_reminders(db, now + dt.timedelta(days=1)) == 0
    # the day after that: reminded again
    assert reminders.send_due_reminders(db, now + dt.timedelta(days=2)) == 1


def test_reminders_disabled_or_not_requested(db: Session) -> None:
    org, team, squad, me, a = setup_athlete(db)
    wellness = f.template_form(db, org, "wellness_hooper")
    schedule(db, org, wellness, team, due_time="08:00", remind=False)
    now = dt.datetime(2026, 10, 12, 9, 0, tzinfo=dt.UTC)
    assert reminders.pending_reminders(db, now) == []
    db.execute(FormSchedule.__table__.update().values(remind=True))
    db.commit()
    assert len(reminders.pending_reminders(db, now)) == 1
    assert reminders.send_due_reminders(db, now) == 0  # EXPO_PUSH_ENABLED=false: logged only
    assert db.scalars(select(ReminderSent)).all() == []


def test_celery_task_wrapper(db: Session) -> None:
    from app.tasks import send_due_reminders

    setup_athlete(db)
    assert send_due_reminders.delay().get() == 0
