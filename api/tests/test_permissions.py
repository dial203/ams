"""Permission matrix: visibility by group scope, sensitivity tiers, masking, write rights, cross-org 404."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Athlete, AuditLog, Form, Group, Organization
from tests import factories as f

API = "/api/v1"
TODAY = dt.date.today()


@dataclass
class World:
    org: Organization
    other_org: Organization
    groups: dict[str, Group]
    athletes: dict[str, Athlete]
    actors: dict[str, f.Actor]
    forms: dict[str, Form]
    extra: dict[str, Any] = field(default_factory=dict)


@pytest.fixture
def world(db: Session) -> World:
    org = f.org(db, "Club")
    other = f.org(db, "Rival")
    athletics = f.group(db, org, "Athletics")
    sprints = f.group(db, org, "Sprints", parent=athletics, kind="squad")
    distance = f.group(db, org, "Distance", parent=athletics, kind="squad")
    study = f.group(db, org, "Pilot Study", kind="study")
    other_team = f.group(db, org, "Other")
    groups = {"athletics": athletics, "sprints": sprints, "distance": distance, "study": study, "other": other_team}

    athletes = {
        "s1": f.athlete(db, org, "Sam", "Sprinter", code="S-1", groups=(sprints,), email="sam@example.com"),
        "d1": f.athlete(db, org, "Dana", "Distance", code="D-1", groups=(distance,)),
        "st1": f.athlete(db, org, "Stu", "Study", code="ST-1", groups=(study,), email="stu@example.com"),
        "o1": f.athlete(db, org, "Oli", "Other", code="O-1", groups=(other_team,)),
        "left1": f.athlete(db, org, "Lee", "Left", code="L-1"),
        "future1": f.athlete(db, org, "Fay", "Future", code="F-1"),
        "x1": f.athlete(db, other, "Xen", "Rival", code="X-1"),
    }
    from app.models import AthleteGroup

    db.add(
        AthleteGroup(
            org_id=org.id,
            athlete_id=athletes["left1"].id,
            group_id=sprints.id,
            joined_on=TODAY - dt.timedelta(days=100),
            left_on=TODAY - dt.timedelta(days=10),
        )
    )
    db.add(
        AthleteGroup(
            org_id=org.id,
            athlete_id=athletes["future1"].id,
            group_id=sprints.id,
            joined_on=TODAY + dt.timedelta(days=5),
        )
    )
    db.commit()

    actors = {
        "owner": f.member(db, org, "owner"),
        "admin": f.member(db, org, "admin"),
        "coach": f.member(db, org, "staff"),
        "viewer": f.member(db, org, "staff"),
        "medic": f.member(db, org, "staff"),
        "researcher": f.member(db, org, "staff"),
        "multi": f.member(db, org, "staff"),
        "nobody": f.member(db, org, "staff"),
        "athlete": f.member(db, org, "athlete"),
        "rival_admin": f.member(db, other, "admin"),
    }
    f.assign(db, actors["coach"], athletics, "coach")
    f.assign(db, actors["viewer"], sprints, "viewer")
    f.assign(db, actors["medic"], athletics, "medical")
    f.assign(db, actors["researcher"], study, "researcher", identifiable=False)
    f.assign(db, actors["multi"], sprints, "coach", identifiable=False)
    f.assign(db, actors["multi"], athletics, "viewer", identifiable=True)
    athletes["s1"].user_id = actors["athlete"].id
    db.commit()

    num = f.NUMBER_SCHEMA
    forms = {
        "general": f.form(db, org, "wellness", num, sensitivity="general", athlete_can_view=True),
        "medical": f.form(
            db,
            org,
            "injury",
            num,
            sensitivity="medical",
            athlete_can_view=False,
            athlete_can_submit=False,
            kind="medical",
        ),
        "research": f.form(db, org, "study_q", num, sensitivity="research", athlete_can_view=False),
    }
    day = TODAY - dt.timedelta(days=1)
    for a in ("s1", "d1", "st1"):
        for fm in forms.values():
            f.submit(db, org, fm, athletes[a], {"value": 1}, day)
    return World(org, other, groups, athletes, actors, forms)


def codes(client: TestClient, w: World, actor: str, **params: Any) -> set[str]:
    r = client.get(f"{API}/orgs/{w.org.id}/athletes", headers=w.actors[actor].headers, params=params)
    assert r.status_code == 200, r.text
    return {a["code"] for a in r.json()["items"]}


VISIBLE = {
    "owner": {"S-1", "D-1", "ST-1", "O-1", "L-1", "F-1"},
    "admin": {"S-1", "D-1", "ST-1", "O-1", "L-1", "F-1"},
    "coach": {"S-1", "D-1"},
    "viewer": {"S-1"},
    "medic": {"S-1", "D-1"},
    "researcher": {"ST-1"},
    "multi": {"S-1", "D-1"},
    "nobody": set(),
    "athlete": {"S-1"},
}


@pytest.mark.parametrize("actor", list(VISIBLE))
def test_visible_athletes(client: TestClient, world: World, actor: str) -> None:
    assert codes(client, world, actor) == VISIBLE[actor]


@pytest.mark.parametrize("actor", list(VISIBLE))
@pytest.mark.parametrize("athlete", ["s1", "d1", "st1", "o1", "left1", "future1", "x1"])
def test_get_athlete_404_unless_visible(client: TestClient, world: World, actor: str, athlete: str) -> None:
    a = world.athletes[athlete]
    r = client.get(f"{API}/orgs/{world.org.id}/athletes/{a.id}", headers=world.actors[actor].headers)
    expected = 200 if a.code in VISIBLE[actor] else 404
    assert r.status_code == expected


WRITE_ATHLETE = {
    "owner": {"s1": 200, "d1": 200, "st1": 200},
    "admin": {"s1": 200, "d1": 200, "st1": 200},
    "coach": {"s1": 200, "d1": 200, "st1": 404},
    "viewer": {"s1": 403, "d1": 404, "st1": 404},
    "medic": {"s1": 200, "d1": 200, "st1": 404},
    "researcher": {"s1": 404, "d1": 404, "st1": 200},
    "multi": {"s1": 200, "d1": 403, "st1": 404},
    "nobody": {"s1": 404, "d1": 404, "st1": 404},
    "athlete": {"s1": 403, "d1": 404, "st1": 404},
}


@pytest.mark.parametrize("actor", list(WRITE_ATHLETE))
def test_patch_athlete(client: TestClient, world: World, actor: str) -> None:
    for name, expected in WRITE_ATHLETE[actor].items():
        a = world.athletes[name]
        r = client.patch(
            f"{API}/orgs/{world.org.id}/athletes/{a.id}", headers=world.actors[actor].headers, json={"position": "X"}
        )
        assert r.status_code == expected, (actor, name, r.text)


def test_masking_union_and_search(client: TestClient, world: World) -> None:
    # researcher: masked (assignment has can_view_identifiable=false)
    r = client.get(
        f"{API}/orgs/{world.org.id}/athletes/{world.athletes['st1'].id}", headers=world.actors["researcher"].headers
    )
    body = r.json()
    assert body["masked"] is True
    assert body["display_name"] == "ST-1"
    assert all(body[k] is None for k in ("first_name", "last_name", "preferred_name", "email", "date_of_birth"))
    # search by name must not match masked athletes; by code it does
    assert codes(client, world, "researcher", q="Stu") == set()
    assert codes(client, world, "researcher", q="stu@example") == set()
    assert codes(client, world, "researcher", q="ST-") == {"ST-1"}
    assert codes(client, world, "admin", q="Stu") == {"ST-1"}
    assert codes(client, world, "admin", q="sam@example") == {"S-1"}
    assert codes(client, world, "coach", q="sprinter") == {"S-1"}
    # multi: masked via Sprints coach scope, but identifiable via the Athletics viewer scope -> union = identifiable
    r = client.get(
        f"{API}/orgs/{world.org.id}/athletes/{world.athletes['s1'].id}", headers=world.actors["multi"].headers
    )
    assert r.json()["masked"] is False and r.json()["first_name"] == "Sam"
    # masked staff may not write PII fields
    r = client.patch(
        f"{API}/orgs/{world.org.id}/athletes/{world.athletes['st1'].id}",
        headers=world.actors["researcher"].headers,
        json={"first_name": "Nope"},
    )
    assert r.status_code == 403


READ_SUBMISSIONS = {
    "owner": {(a, s) for a in ("S-1", "D-1", "ST-1") for s in ("general", "medical", "research")},
    "admin": {(a, s) for a in ("S-1", "D-1", "ST-1") for s in ("general", "medical", "research")},
    "coach": {("S-1", "general"), ("D-1", "general")},
    "viewer": {("S-1", "general")},
    "medic": {("S-1", "general"), ("S-1", "medical"), ("D-1", "general"), ("D-1", "medical")},
    "researcher": {("ST-1", "general"), ("ST-1", "research")},
    "multi": {("S-1", "general"), ("D-1", "general")},
    "nobody": set(),
    "athlete": {("S-1", "general")},
}


@pytest.mark.parametrize("actor", list(READ_SUBMISSIONS))
def test_submission_read_matrix(client: TestClient, world: World, actor: str) -> None:
    r = client.get(f"{API}/orgs/{world.org.id}/submissions", headers=world.actors[actor].headers, params={"limit": 500})
    assert r.status_code == 200, r.text
    by_form = {str(fm.id): k for k, fm in world.forms.items()}
    by_athlete = {str(a.id): a.code for a in world.athletes.values()}
    seen = {(by_athlete[s["athlete_id"]], by_form[s["form_id"]]) for s in r.json()["items"]}
    assert seen == READ_SUBMISSIONS[actor]
    assert r.json()["total"] == len(seen)


WRITE_SUBMISSIONS = {
    # (athlete, sensitivity) -> status. A form whose sensitivity the caller cannot read at all is 404;
    # a readable form without write rights for that athlete is 403.
    "admin": {("s1", "general"): 201, ("s1", "medical"): 201, ("st1", "research"): 201},
    "coach": {("s1", "general"): 201, ("s1", "medical"): 404, ("st1", "general"): 404},
    "viewer": {("s1", "general"): 403},
    "medic": {("d1", "medical"): 201, ("d1", "research"): 404, ("d1", "general"): 201},
    "researcher": {("st1", "research"): 201, ("st1", "general"): 201, ("st1", "medical"): 404},
    "multi": {("s1", "general"): 201, ("d1", "general"): 403},
    "athlete": {("s1", "general"): 201, ("s1", "medical"): 404, ("d1", "general"): 404},
}


@pytest.mark.parametrize("actor", list(WRITE_SUBMISSIONS))
def test_submission_write_matrix(client: TestClient, world: World, actor: str) -> None:
    for (athlete, sens), expected in WRITE_SUBMISSIONS[actor].items():
        r = client.post(
            f"{API}/orgs/{world.org.id}/submissions",
            headers=world.actors[actor].headers,
            json={
                "form_id": str(world.forms[sens].id),
                "athlete_id": str(world.athletes[athlete].id),
                "values": {"value": 2},
            },
        )
        assert r.status_code == expected, (actor, athlete, sens, r.text)


@pytest.mark.parametrize(
    ("actor", "visible_forms"),
    [
        ("admin", {"wellness", "injury", "study_q"}),
        ("coach", {"wellness"}),
        ("medic", {"wellness", "injury"}),
        ("researcher", {"wellness", "study_q"}),
        ("nobody", set()),
        ("athlete", {"wellness", "study_q"}),  # athlete_can_submit or athlete_can_view
    ],
)
def test_form_listing_by_sensitivity(client: TestClient, world: World, actor: str, visible_forms: set[str]) -> None:
    r = client.get(f"{API}/orgs/{world.org.id}/forms", headers=world.actors[actor].headers)
    assert {x["slug"] for x in r.json()} == visible_forms
    injury = world.forms["medical"]
    r = client.get(f"{API}/orgs/{world.org.id}/forms/{injury.id}", headers=world.actors[actor].headers)
    assert r.status_code == (200 if "injury" in visible_forms else 404)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/groups", {"name": "G", "kind": "team"}),
        ("post", "/forms", {"name": "F", "kind": "questionnaire"}),
        ("get", "/form-templates", None),
        ("get", "/invitations", None),
        ("get", "/audit", None),
        ("patch", "", {"name": "Renamed"}),
        ("post", "/metrics", {"slug": "m", "name": "M", "source": "wearable:steps"}),
    ],
)
@pytest.mark.parametrize("actor", ["coach", "medic", "athlete"])
def test_admin_only_endpoints(client: TestClient, world: World, actor: str, method: str, path: str, body: Any) -> None:
    url = f"{API}/orgs/{world.org.id}{path}"
    kwargs: dict[str, Any] = {"headers": world.actors[actor].headers}
    if body is not None:
        kwargs["json"] = body
    assert getattr(client, method)(url, **kwargs).status_code == 403


@pytest.mark.parametrize("path", ["/metrics", "/series-sources", "/dashboards/readiness", "/members"])
def test_staff_only_endpoints(client: TestClient, world: World, path: str) -> None:
    url = f"{API}/orgs/{world.org.id}{path}"
    assert client.get(url, headers=world.actors["athlete"].headers).status_code == 403
    assert client.get(url, headers=world.actors["coach"].headers).status_code == 200


@pytest.mark.parametrize(
    "path",
    ["", "/athletes", "/groups", "/forms", "/submissions", "/metrics", "/dashboards/readiness", "/audit", "/members"],
)
def test_cross_org_is_404(client: TestClient, world: World, path: str) -> None:
    r = client.get(f"{API}/orgs/{world.org.id}{path}", headers=world.actors["rival_admin"].headers)
    assert r.status_code == 404


def test_cross_org_ids_are_404(client: TestClient, world: World) -> None:
    admin = world.actors["admin"].headers
    x1 = world.athletes["x1"]
    assert client.get(f"{API}/orgs/{world.org.id}/athletes/{x1.id}", headers=admin).status_code == 404
    r = client.post(
        f"{API}/orgs/{world.org.id}/submissions",
        headers=admin,
        json={"form_id": str(world.forms["general"].id), "athlete_id": str(x1.id), "values": {"value": 1}},
    )
    assert r.status_code == 404
    r = client.post(
        f"{API}/orgs/{world.org.id}/groups/{world.groups['sprints'].id}/athletes",
        headers=admin,
        json={"athlete_ids": [str(x1.id)]},
    )
    assert r.status_code == 404


def test_group_listing_for_staff_includes_ancestors(client: TestClient, world: World) -> None:
    r = client.get(f"{API}/orgs/{world.org.id}/groups", headers=world.actors["viewer"].headers)
    assert {g["name"] for g in r.json()} == {"Sprints", "Athletics"}
    counts = {g["name"]: g["athlete_count"] for g in r.json()}
    assert counts["Sprints"] == 1  # S-1 only: L-1 left, F-1 not yet joined
    r = client.get(f"{API}/orgs/{world.org.id}/groups", headers=world.actors["coach"].headers)
    assert {g["name"] for g in r.json()} == {"Athletics", "Sprints", "Distance"}
    r = client.get(f"{API}/orgs/{world.org.id}/groups", headers=world.actors["admin"].headers)
    assert len(r.json()) == 5
    r = client.get(
        f"{API}/orgs/{world.org.id}/groups/{world.groups['study'].id}", headers=world.actors["coach"].headers
    )
    assert r.status_code == 404


def test_group_membership_writes(client: TestClient, world: World) -> None:
    sprints, distance = world.groups["sprints"], world.groups["distance"]
    d1 = world.athletes["d1"]
    # viewer cannot write the group
    r = client.post(
        f"{API}/orgs/{world.org.id}/groups/{sprints.id}/athletes",
        headers=world.actors["viewer"].headers,
        json={"athlete_ids": [str(d1.id)]},
    )
    assert r.status_code == 403
    # coach can add a visible athlete
    r = client.post(
        f"{API}/orgs/{world.org.id}/groups/{sprints.id}/athletes",
        headers=world.actors["coach"].headers,
        json={"athlete_ids": [str(d1.id)]},
    )
    assert r.status_code == 200 and r.json()["athlete_count"] == 2
    # but not an athlete outside their scope (would be a privilege escalation)
    r = client.post(
        f"{API}/orgs/{world.org.id}/groups/{sprints.id}/athletes",
        headers=world.actors["coach"].headers,
        json={"athlete_ids": [str(world.athletes["o1"].id)]},
    )
    assert r.status_code == 404
    # viewer of Sprints now sees D-1 too
    assert codes(client, world, "viewer") == {"S-1", "D-1"}
    r = client.delete(
        f"{API}/orgs/{world.org.id}/groups/{sprints.id}/athletes/{d1.id}", headers=world.actors["coach"].headers
    )
    assert r.status_code == 204
    assert codes(client, world, "viewer") == {"S-1"}
    del distance


def test_athlete_create_rules(client: TestClient, world: World) -> None:
    url = f"{API}/orgs/{world.org.id}/athletes"
    body = {"first_name": "New", "last_name": "Kid", "group_ids": [str(world.groups["sprints"].id)]}
    assert client.post(url, headers=world.actors["coach"].headers, json=body).status_code == 201
    assert client.post(url, headers=world.actors["viewer"].headers, json=body).status_code == 403
    # staff must list groups they can write
    assert client.post(url, headers=world.actors["coach"].headers, json={**body, "group_ids": []}).status_code == 403
    other = {**body, "group_ids": [str(world.groups["study"].id)]}
    assert client.post(url, headers=world.actors["coach"].headers, json=other).status_code == 403
    assert client.post(url, headers=world.actors["admin"].headers, json={**body, "group_ids": []}).status_code == 201
    assert client.post(url, headers=world.actors["athlete"].headers, json=body).status_code == 403


def test_medical_reads_are_audited(client: TestClient, world: World, db: Session) -> None:
    medic = world.actors["medic"]
    r = client.get(
        f"{API}/orgs/{world.org.id}/submissions",
        headers=medic.headers,
        params={"form_id": str(world.forms["medical"].id)},
    )
    assert r.status_code == 200 and r.json()["total"] == 2
    entries = db.scalars(select(AuditLog).where(AuditLog.action == "submission.read")).all()
    assert len(entries) == 1
    assert entries[0].user_id == medic.id
    assert sorted(entries[0].details["submission_ids"]) == sorted(s["id"] for s in r.json()["items"])
    # general reads are not audited
    client.get(
        f"{API}/orgs/{world.org.id}/submissions",
        headers=medic.headers,
        params={"form_id": str(world.forms["general"].id)},
    )
    assert len(db.scalars(select(AuditLog).where(AuditLog.action == "submission.read")).all()) == 1
    # single read
    sub_id = r.json()["items"][0]["id"]
    assert client.get(f"{API}/orgs/{world.org.id}/submissions/{sub_id}", headers=medic.headers).status_code == 200
    assert len(db.scalars(select(AuditLog).where(AuditLog.action == "submission.read")).all()) == 2
    # coach cannot read it at all
    assert (
        client.get(f"{API}/orgs/{world.org.id}/submissions/{sub_id}", headers=world.actors["coach"].headers).status_code
        == 404
    )


def test_audit_endpoint(client: TestClient, world: World) -> None:
    admin = world.actors["admin"]
    a = world.athletes["s1"]
    client.patch(f"{API}/orgs/{world.org.id}/athletes/{a.id}", headers=admin.headers, json={"position": "100m"})
    r = client.get(
        f"{API}/orgs/{world.org.id}/audit",
        headers=admin.headers,
        params={"entity_type": "athlete", "entity_id": str(a.id)},
    )
    assert r.status_code == 200
    entry = r.json()["items"][0]
    assert entry["action"] == "athlete.update"
    assert entry["details"]["after"]["position"] == "100m"
    assert entry["user_id"] == str(admin.id)


def test_member_role_rules(client: TestClient, world: World) -> None:
    url = f"{API}/orgs/{world.org.id}/members"
    owner, admin = world.actors["owner"], world.actors["admin"]
    members = client.get(url, headers=world.actors["coach"].headers).json()
    coach_entry = next(m for m in members if m["user"]["id"] == str(world.actors["coach"].id))
    assert coach_entry["assignments"][0]["access_role"] == "coach"
    # cannot demote the last owner
    assert client.patch(f"{url}/{owner.id}", headers=owner.headers, json={"role": "admin"}).status_code == 409
    # admins cannot touch owners
    assert client.patch(f"{url}/{owner.id}", headers=admin.headers, json={"role": "admin"}).status_code == 403
    assert client.patch(f"{url}/{admin.id}", headers=admin.headers, json={"role": "owner"}).status_code == 403
    # owner promotes admin to owner, then can step down
    assert client.patch(f"{url}/{admin.id}", headers=owner.headers, json={"role": "owner"}).status_code == 200
    assert client.patch(f"{url}/{owner.id}", headers=owner.headers, json={"role": "admin"}).status_code == 200
    # removing a member drops their assignments
    coach = world.actors["coach"]
    assert client.delete(f"{url}/{coach.id}", headers=admin.headers).status_code == 204
    assert client.get(f"{API}/orgs/{world.org.id}", headers=coach.headers).status_code == 404


def test_athlete_self_scope(client: TestClient, world: World) -> None:
    me = world.actors["athlete"]
    r = client.get(f"{API}/orgs/{world.org.id}/me/athlete", headers=me.headers)
    assert r.status_code == 200 and r.json()["code"] == "S-1" and r.json()["masked"] is False
    r = client.get(f"{API}/orgs/{world.org.id}/me/submissions", headers=me.headers)
    assert {s["form_id"] for s in r.json()["items"]} == {str(world.forms["general"].id)}
    # staff without an athlete record cannot use /me
    assert client.get(f"{API}/orgs/{world.org.id}/me/athlete", headers=world.actors["coach"].headers).status_code == 403
