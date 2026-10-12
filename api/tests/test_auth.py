from __future__ import annotations

import datetime as dt
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Athlete, Invitation, OrgMembership, PushToken, RefreshToken
from tests import factories as f

API = "/api/v1"


def login(client: TestClient, email: str, password: str = f.PASSWORD) -> dict:
    r = client.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get(f"{API}/openapi.json").status_code == 200
    assert client.get(f"{API}/docs").status_code == 200


def test_login_and_me(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "owner", email="Boss@Example.com", name="Boss")
    body = login(client, "boss@example.com")
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 30 * 60
    assert body["user"]["email"] == "boss@example.com"
    me = client.get(f"{API}/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
    assert me["user"]["id"] == str(admin.id)
    assert me["memberships"][0]["role"] == "owner"
    assert me["memberships"][0]["org"]["settings"]["terminology"]["athlete"] == "Athlete"
    assert me["memberships"][0]["org"]["settings"]["readiness_metrics"][0] == "wellness_hooper"
    assert me["memberships"][0]["athlete_id"] is None


def test_login_rejects_bad_credentials(client: TestClient, db: Session) -> None:
    org = f.org(db)
    f.member(db, org, "admin", email="a@example.com")
    assert client.post(f"{API}/auth/login", json={"email": "a@example.com", "password": "nope"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"email": "x@example.com", "password": "nope"}).status_code == 401


def test_unauthenticated_and_bad_tokens(client: TestClient, db: Session) -> None:
    assert client.get(f"{API}/me").status_code == 401
    assert client.get(f"{API}/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_refresh_rotation_and_reuse_detection(client: TestClient, db: Session) -> None:
    org = f.org(db)
    f.member(db, org, "admin", email="a@example.com")
    first = login(client, "a@example.com")
    r = client.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r.status_code == 200
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"]
    # the rotated-out token is revoked; reusing it revokes the whole family
    reuse = client.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert reuse.status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401
    db.expire_all()
    assert all(t.revoked_at is not None for t in db.scalars(select(RefreshToken)))
    # a fresh login starts a new family that works
    third = login(client, "a@example.com")
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": third["refresh_token"]}).status_code == 200


def test_logout_revokes(client: TestClient, db: Session) -> None:
    org = f.org(db)
    f.member(db, org, "admin", email="a@example.com")
    tokens = login(client, "a@example.com")
    assert client.post(f"{API}/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": "unknown"}).status_code == 401


def _token(invite_url: str) -> str:
    return parse_qs(urlparse(invite_url).query)["token"][0]


def test_staff_invitation_flow(client: TestClient, db: Session) -> None:
    org = f.org(db, name="Club")
    admin = f.member(db, org, "admin")
    r = client.post(
        f"{API}/orgs/{org.id}/invitations", headers=admin.headers, json={"email": "Coach@Example.com", "role": "staff"}
    )
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["invite_url"].startswith("https://ams.test/accept-invite?token=")
    assert inv["email"] == "coach@example.com"
    token = _token(inv["invite_url"])
    # token stored hashed only
    stored = db.scalar(select(Invitation))
    assert stored is not None and token not in (stored.token_hash, stored.token_salt)
    # listing reproduces the same URL
    listed = client.get(f"{API}/orgs/{org.id}/invitations", headers=admin.headers).json()
    assert listed[0]["invite_url"] == inv["invite_url"]
    info = client.get(f"{API}/auth/invite/{token}").json()
    assert info == {
        "email": "coach@example.com",
        "org_name": "Club",
        "role": "staff",
        "expires_at": info["expires_at"],
    }
    expires = dt.datetime.fromisoformat(info["expires_at"])
    assert dt.timedelta(days=6, hours=23) < expires - dt.datetime.now(dt.UTC) <= dt.timedelta(days=7)
    acc = client.post(f"{API}/auth/accept-invite", json={"token": token, "password": "new-password-1", "full_name": "C"})
    assert acc.status_code == 200, acc.text
    assert acc.json()["user"]["email"] == "coach@example.com"
    me = client.get(f"{API}/me", headers={"Authorization": f"Bearer {acc.json()['access_token']}"}).json()
    assert me["memberships"][0]["role"] == "staff"
    # token cannot be reused, and is no longer pending
    assert client.get(f"{API}/auth/invite/{token}").status_code == 404
    assert client.post(
        f"{API}/auth/accept-invite", json={"token": token, "password": "new-password-1", "full_name": "C"}
    ).status_code == 404
    assert client.get(f"{API}/orgs/{org.id}/invitations", headers=admin.headers).json() == []


def test_athlete_invitation_links_athlete(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    a = f.athlete(db, org, "Jo", "Swift", email="jo@example.com")
    r = client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/invite", headers=admin.headers, json={})
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["role"] == "athlete" and inv["athlete_id"] == str(a.id) and inv["email"] == "jo@example.com"
    acc = client.post(
        f"{API}/auth/accept-invite",
        json={"token": _token(inv["invite_url"]), "password": "athlete-pass-1", "full_name": "Jo Swift"},
    )
    assert acc.status_code == 200, acc.text
    db.expire_all()
    athlete = db.get(Athlete, a.id)
    assert athlete is not None and str(athlete.user_id) == acc.json()["user"]["id"]
    me = client.get(f"{API}/me", headers={"Authorization": f"Bearer {acc.json()['access_token']}"}).json()
    assert me["memberships"][0] == {**me["memberships"][0], "role": "athlete", "athlete_id": str(a.id)}
    # athlete now has a login: a second invite conflicts
    assert client.post(f"{API}/orgs/{org.id}/athletes/{a.id}/invite", headers=admin.headers, json={}).status_code == 409


def test_invitation_validation(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    r = client.post(f"{API}/orgs/{org.id}/invitations", headers=admin.headers, json={"email": "x@e.com", "role": "athlete"})
    assert r.status_code == 422
    # only owners invite owners
    r = client.post(f"{API}/orgs/{org.id}/invitations", headers=admin.headers, json={"email": "x@e.com", "role": "owner"})
    assert r.status_code == 403
    staff = f.member(db, org, "staff")
    r = client.post(f"{API}/orgs/{org.id}/invitations", headers=staff.headers, json={"email": "x@e.com", "role": "staff"})
    assert r.status_code == 403


def test_existing_user_must_prove_password_to_accept(client: TestClient, db: Session) -> None:
    org_a = f.org(db, name="A")
    org_b = f.org(db, name="B")
    f.member(db, org_a, "staff", email="multi@example.com")
    admin_b = f.member(db, org_b, "admin")
    inv = client.post(
        f"{API}/orgs/{org_b.id}/invitations", headers=admin_b.headers, json={"email": "multi@example.com", "role": "staff"}
    ).json()
    token = _token(inv["invite_url"])
    bad = client.post(f"{API}/auth/accept-invite", json={"token": token, "password": "wrong-password", "full_name": "M"})
    assert bad.status_code == 401
    ok = client.post(f"{API}/auth/accept-invite", json={"token": token, "password": f.PASSWORD, "full_name": "M"})
    assert ok.status_code == 200
    assert len(db.scalars(select(OrgMembership).where(OrgMembership.user_id == ok.json()["user"]["id"])).all()) == 2


def test_expired_invitation(client: TestClient, db: Session) -> None:
    org = f.org(db)
    admin = f.member(db, org, "admin")
    inv = client.post(
        f"{API}/orgs/{org.id}/invitations", headers=admin.headers, json={"email": "late@example.com", "role": "staff"}
    ).json()
    row = db.scalar(select(Invitation))
    assert row is not None
    row.expires_at = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)
    db.commit()
    assert client.get(f"{API}/auth/invite/{_token(inv['invite_url'])}").status_code == 400
    # delete
    assert client.delete(f"{API}/orgs/{org.id}/invitations/{inv['id']}", headers=admin.headers).status_code == 204


def test_patch_me_and_password_change(client: TestClient, db: Session) -> None:
    org = f.org(db)
    me = f.member(db, org, "staff", email="s@example.com")
    r = client.patch(f"{API}/me", headers=me.headers, json={"full_name": "New Name"})
    assert r.status_code == 200 and r.json()["full_name"] == "New Name"
    assert client.patch(f"{API}/me", headers=me.headers, json={"password": "another-pass-9"}).status_code == 403
    r = client.patch(
        f"{API}/me", headers=me.headers, json={"password": "another-pass-9", "current_password": f.PASSWORD}
    )
    assert r.status_code == 200
    login(client, "s@example.com", "another-pass-9")


def test_push_tokens(client: TestClient, db: Session) -> None:
    org = f.org(db)
    me = f.member(db, org, "athlete")
    body = {"token": "ExponentPushToken[abc]", "platform": "ios"}
    assert client.post(f"{API}/me/push-tokens", headers=me.headers, json=body).status_code == 204
    assert client.post(f"{API}/me/push-tokens", headers=me.headers, json={**body, "platform": "android"}).status_code == 204
    tokens = db.scalars(select(PushToken)).all()
    assert len(tokens) == 1 and tokens[0].platform == "android"
    assert client.delete(f"{API}/me/push-tokens/ExponentPushToken[abc]", headers=me.headers).status_code == 204
    db.expire_all()
    assert db.scalars(select(PushToken)).all() == []
