"""First-start setup from environment variables, for container platforms without a console.

Runs on every API container start (``python -m app.cli bootstrap``) and only ever adds what is
missing, so it is safe to leave configured:

* ``AMS_SEED_DEMO=true`` seeds the "Demo Performance" organization unless it already exists.
* ``AMS_ORG_NAME`` + ``AMS_ADMIN_EMAIL`` + ``AMS_ADMIN_PASSWORD`` create that organization if no
  organization has that name yet, and make the admin its owner (or an admin, when it already has an
  owner). An existing user's password is never changed: the variable only sets it at creation.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Organization, OrgMembership
from app.security import MIN_PASSWORD_LENGTH
from app.services.orgs import add_member, create_org, create_user, get_user_by_email


class BootstrapError(ValueError):
    pass


def bootstrap(
    db: Session,
    *,
    seed_demo: bool = False,
    demo_password: str = "",
    org_name: str | None = None,
    org_timezone: str = "UTC",
    admin_email: str | None = None,
    admin_password: str | None = None,
    admin_name: str = "",
    today: dt.date | None = None,
) -> list[str]:
    """Apply the requested setup; returns one line per action taken. Commits on success."""
    done: list[str] = []
    if seed_demo:
        from app.seed import DemoExistsError
        from app.seed import seed_demo as run_seed

        try:
            org = run_seed(db, demo_password, today)
            db.commit()
            done.append(f"seeded demo organization {org.name}")
        except DemoExistsError:
            db.rollback()

    if org_name or admin_email or admin_password:
        if not (org_name and admin_email and admin_password):
            raise BootstrapError("AMS_ORG_NAME, AMS_ADMIN_EMAIL and AMS_ADMIN_PASSWORD must be set together")
        org = db.scalar(select(Organization).where(Organization.name == org_name))
        if org is None:
            org = create_org(db, org_name, org_timezone)
            done.append(f"created organization {org.name}")
        user = get_user_by_email(db, admin_email)
        if user is None:
            if len(admin_password) < MIN_PASSWORD_LENGTH:
                raise BootstrapError(f"AMS_ADMIN_PASSWORD must have at least {MIN_PASSWORD_LENGTH} characters")
            user = create_user(db, admin_email, admin_password, admin_name)
            done.append(f"created user {user.email}")
        is_member = db.scalar(
            select(OrgMembership.id).where(OrgMembership.org_id == org.id, OrgMembership.user_id == user.id)
        )
        if not is_member:
            has_owner = db.scalar(
                select(OrgMembership.id).where(OrgMembership.org_id == org.id, OrgMembership.role == "owner")
            )
            role = "admin" if has_owner else "owner"
            add_member(db, org, user, role)
            done.append(f"made {user.email} {role} of {org.name}")
        db.commit()
    return done
