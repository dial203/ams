from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.bootstrap import BootstrapError, bootstrap
from app.models import Organization, OrgMembership, User
from app.security import verify_password

ADMIN = {"org_name": "Riverside Rowing", "admin_email": "Head.Coach@example.org", "admin_password": "first-start-pass"}


def test_creates_org_and_owner_once(db: Session) -> None:
    done = bootstrap(db, org_timezone="America/Chicago", admin_name="Head Coach", **ADMIN)
    assert done == [
        "created organization Riverside Rowing",
        "created user head.coach@example.org",
        "made head.coach@example.org owner of Riverside Rowing",
    ]
    org = db.scalar(select(Organization).where(Organization.name == "Riverside Rowing"))
    assert org is not None and org.timezone == "America/Chicago"
    membership = db.scalar(select(OrgMembership).where(OrgMembership.org_id == org.id))
    assert membership is not None and membership.role == "owner"

    # every later start is a no-op, and never resets the password
    assert bootstrap(db, **{**ADMIN, "admin_password": "a-different-password"}) == []
    user = db.scalar(select(User).where(User.email == "head.coach@example.org"))
    assert user is not None and user.password_hash and verify_password("first-start-pass", user.password_hash)
    assert db.scalar(select(func.count()).select_from(Organization)) == 1


def test_second_admin_joins_as_admin(db: Session) -> None:
    bootstrap(db, **ADMIN)
    done = bootstrap(db, **{**ADMIN, "admin_email": "second@example.org"})
    assert done[-1] == "made second@example.org admin of Riverside Rowing"


@pytest.mark.parametrize(
    "partial", [{"org_name": "X"}, {"admin_email": "a@b.org", "admin_password": "long-enough-pass"}]
)
def test_partial_admin_settings_are_rejected(db: Session, partial: dict[str, str]) -> None:
    with pytest.raises(BootstrapError):
        bootstrap(db, **partial)


def test_short_password_is_rejected(db: Session) -> None:
    with pytest.raises(BootstrapError):
        bootstrap(db, **{**ADMIN, "admin_password": "short"})


def test_seed_demo_flag_is_idempotent(db: Session) -> None:
    today = dt.date(2026, 10, 12)
    assert bootstrap(db, seed_demo=True, demo_password="demo-pass-123", today=today) == [
        "seeded demo organization Demo Performance"
    ]
    assert bootstrap(db, seed_demo=True, demo_password="demo-pass-123", today=today) == []
    assert db.scalar(select(func.count()).select_from(Organization)) == 1
