from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AthleteGroup, AuditLog
from tests import factories as f

API = "/api/v1"


def test_athlete_crud_and_codes(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    team = f.group(db, org, "Team")
    url = f"{API}/orgs/{org.id}/athletes"
    r = client.post(
        url,
        headers=admin.headers,
        json={
            "first_name": "Ada",
            "last_name": "Lovelace",
            "preferred_name": "Addy",
            "email": "ADA@example.com",
            "date_of_birth": "2001-05-04",
            "sex": "female",
            "position": "Sprinter",
            "attributes": {"external_id": "CAT-77"},
            "group_ids": [str(team.id)],
        },
    )
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["code"] == "A-0001"
    assert a["display_name"] == "Addy Lovelace"
    assert a["email"] == "ada@example.com"
    assert a["masked"] is False and a["status"] == "active"
    assert a["group_ids"] == [str(team.id)]
    assert a["timezone"] is None and a["ow_user_id"] is None and a["user_id"] is None
    r2 = client.post(url, headers=admin.headers, json={"first_name": "B", "last_name": "C"})
    assert r2.json()["code"] == "A-0002"
    assert (
        client.post(
            url, headers=admin.headers, json={"first_name": "D", "last_name": "E", "code": "a-0001"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            url, headers=admin.headers, json={"first_name": "D", "last_name": "E", "timezone": "Mars/Base"}
        ).status_code
        == 422
    )
    # update
    r = client.patch(f"{url}/{a['id']}", headers=admin.headers, json={"position": "Hurdles", "timezone": "Europe/Oslo"})
    assert r.status_code == 200 and r.json()["position"] == "Hurdles" and r.json()["timezone"] == "Europe/Oslo"
    assert client.patch(f"{url}/{a['id']}", headers=admin.headers, json={"code": "A-0002"}).status_code == 409
    assert client.patch(f"{url}/{a['id']}", headers=admin.headers, json={"first_name": None}).status_code == 400
    # list, filters, pagination
    page = client.get(url, headers=admin.headers, params={"limit": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1 and page["items"][0]["code"] == "A-0001"
    assert (
        client.get(url, headers=admin.headers, params={"limit": 1, "offset": 1}).json()["items"][0]["code"] == "A-0002"
    )
    assert client.get(url, headers=admin.headers, params={"limit": 501}).status_code == 422
    assert client.get(url, headers=admin.headers, params={"group_id": str(team.id)}).json()["total"] == 1
    assert client.get(url, headers=admin.headers, params={"q": "lovel"}).json()["total"] == 1
    assert client.get(url, headers=admin.headers, params={"q": "addy lovelace"}).json()["total"] == 1
    # archive (DELETE) hides from the default listing
    assert client.delete(f"{url}/{a['id']}", headers=admin.headers).status_code == 204
    assert client.get(url, headers=admin.headers).json()["total"] == 1
    archived = client.get(url, headers=admin.headers, params={"status": "archived"}).json()
    assert [x["code"] for x in archived["items"]] == ["A-0001"]
    # audit trail of athlete writes
    actions = [
        e.action for e in db.scalars(select(AuditLog).where(AuditLog.entity_type == "athlete").order_by(AuditLog.at))
    ]
    assert (
        actions[:2] == ["athlete.create", "athlete.create"]
        and "athlete.update" in actions
        and actions[-1] == "athlete.archive"
    )


def test_group_crud_tree_and_history(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    url = f"{API}/orgs/{org.id}/groups"
    top = client.post(url, headers=admin.headers, json={"name": "Athletics", "kind": "team"}).json()
    sub = client.post(
        url, headers=admin.headers, json={"name": "Sprints", "kind": "squad", "parent_id": top["id"]}
    ).json()
    assert sub["parent_id"] == top["id"] and sub["athlete_count"] == 0
    assert client.post(url, headers=admin.headers, json={"name": "X", "kind": "bogus"}).status_code == 422
    # cannot move a group under its own descendant
    assert client.patch(f"{url}/{top['id']}", headers=admin.headers, json={"parent_id": sub["id"]}).status_code == 400
    a = f.athlete(db, org, "Pat", "Fast", code="P-1")
    joined = (dt.date.today() - dt.timedelta(days=30)).isoformat()
    r = client.post(
        f"{url}/{sub['id']}/athletes", headers=admin.headers, json={"athlete_ids": [str(a.id)], "joined_on": joined}
    )
    assert r.status_code == 200 and r.json()["athlete_count"] == 1
    # idempotent add
    assert (
        client.post(f"{url}/{sub['id']}/athletes", headers=admin.headers, json={"athlete_ids": [str(a.id)]}).json()[
            "athlete_count"
        ]
        == 1
    )
    got = client.get(f"{API}/orgs/{org.id}/athletes/{a.id}", headers=admin.headers).json()
    assert got["group_ids"] == [sub["id"]]
    # group filter includes descendants
    assert (
        client.get(f"{API}/orgs/{org.id}/athletes", headers=admin.headers, params={"group_id": top["id"]}).json()[
            "total"
        ]
        == 1
    )
    # leave keeps history
    left = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    r = client.delete(f"{url}/{sub['id']}/athletes/{a.id}", headers=admin.headers, params={"left_on": left})
    assert r.status_code == 204
    rows = db.scalars(select(AthleteGroup).where(AthleteGroup.athlete_id == a.id)).all()
    assert len(rows) == 1 and rows[0].left_on is not None and rows[0].left_on.isoformat() == left
    assert client.get(f"{API}/orgs/{org.id}/athletes/{a.id}", headers=admin.headers).json()["group_ids"] == []
    assert client.delete(f"{url}/{sub['id']}/athletes/{a.id}", headers=admin.headers).status_code == 404
    # rejoin creates a new membership row
    client.post(f"{url}/{sub['id']}/athletes", headers=admin.headers, json={"athlete_ids": [str(a.id)]})
    assert len(db.scalars(select(AthleteGroup).where(AthleteGroup.athlete_id == a.id)).all()) == 2
    # PATCH athlete group_ids replaces current memberships (with history)
    r = client.patch(f"{API}/orgs/{org.id}/athletes/{a.id}", headers=admin.headers, json={"group_ids": [top["id"]]})
    assert r.json()["group_ids"] == [top["id"]]
    # archive group: hidden unless include_archived
    assert client.delete(f"{url}/{sub['id']}", headers=admin.headers).status_code == 204
    names = {g["name"] for g in client.get(url, headers=admin.headers).json()}
    assert names == {"Athletics"}
    names = {g["name"] for g in client.get(url, headers=admin.headers, params={"include_archived": True}).json()}
    assert names == {"Athletics", "Sprints"}


def test_staff_assignments(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    coach = f.member(db, org, "staff")
    athlete_user = f.member(db, org, "athlete")
    team = f.group(db, org, "Team")
    url = f"{API}/orgs/{org.id}/groups/{team.id}/staff"
    r = client.post(url, headers=admin.headers, json={"user_id": str(coach.id), "access_role": "coach"})
    assert r.status_code == 201 and r.json()["can_view_identifiable"] is True
    # upsert changes the role
    r = client.post(
        url,
        headers=admin.headers,
        json={"user_id": str(coach.id), "access_role": "medical", "can_view_identifiable": False},
    )
    assert r.json()["access_role"] == "medical" and r.json()["can_view_identifiable"] is False
    assert len(client.get(url, headers=admin.headers).json()) == 1
    assert (
        client.post(
            url, headers=admin.headers, json={"user_id": str(athlete_user.id), "access_role": "coach"}
        ).status_code
        == 400
    )
    assert client.get(url, headers=coach.headers).status_code == 403
    assert (
        client.delete(f"{API}/orgs/{org.id}/staff-assignments/{r.json()['id']}", headers=admin.headers).status_code
        == 204
    )
    assert client.get(url, headers=admin.headers).json() == []


def test_org_settings_update(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    staff = f.member(db, org, "staff")
    url = f"{API}/orgs/{org.id}"
    r = client.patch(
        url,
        headers=admin.headers,
        json={
            "timezone": "America/Chicago",
            "settings": {"terminology": {"athlete": "Operator"}, "readiness_metrics": ["hrv_z"]},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timezone"] == "America/Chicago"
    assert body["settings"]["terminology"] == {
        "athlete": "Operator",
        "athletes": "Athletes",
        "group": "Group",
        "groups": "Groups",
    }
    assert body["settings"]["readiness_metrics"] == ["hrv_z"]
    assert client.patch(url, headers=admin.headers, json={"timezone": "Nowhere/Land"}).status_code == 422
    assert client.get(url, headers=staff.headers).json()["settings"]["terminology"]["athlete"] == "Operator"
