"""Operator CLI: ``uv run python -m app.cli --help``."""

from __future__ import annotations

import datetime as dt
import uuid
from pathlib import Path
from typing import Annotated

import typer
from sqlalchemy import select

from app.database import SessionLocal
from app.models import ORG_ROLES, Organization, OrgMembership
from app.security import MIN_PASSWORD_LENGTH
from app.services.orgs import add_member, create_org, create_user, get_user_by_email

cli = typer.Typer(help="AMS administration commands.", no_args_is_help=True, add_completion=False)
DEFAULT_DEMO_PASSWORD = "demo-password-change-me"


def _find_org(db: object, ref: str) -> Organization:
    from sqlalchemy.orm import Session

    assert isinstance(db, Session)
    org: Organization | None = None
    try:
        org = db.get(Organization, uuid.UUID(ref))
    except ValueError:
        org = db.scalar(select(Organization).where(Organization.slug == ref))
    if org is None:
        raise typer.BadParameter(f"organization {ref!r} not found (use its id or slug)")
    return org


@cli.command("create-org")
def create_org_cmd(
    name: Annotated[str, typer.Option(help="Organization name")],
    timezone: Annotated[str, typer.Option(help="IANA time zone, e.g. America/New_York")] = "UTC",
    slug: Annotated[str | None, typer.Option(help="URL slug (default from the name)")] = None,
) -> None:
    """Create an organization (with default settings and the built-in metrics)."""
    db = SessionLocal()
    try:
        org = create_org(db, name, timezone, slug)
        db.commit()
        typer.echo(f"{org.id} {org.slug}")
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    finally:
        db.close()


def _create_user(email: str, password: str, full_name: str, org_ref: str | None, role: str) -> None:
    if role not in ORG_ROLES:
        raise typer.BadParameter(f"role must be one of {', '.join(ORG_ROLES)}")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise typer.BadParameter(f"password must have at least {MIN_PASSWORD_LENGTH} characters")
    db = SessionLocal()
    try:
        user = get_user_by_email(db, email) or create_user(db, email, password, full_name)
        if org_ref:
            org = _find_org(db, org_ref)
            add_member(db, org, user, role)
        db.commit()
        typer.echo(str(user.id))
    finally:
        db.close()


@cli.command("create-user")
def create_user_cmd(
    email: Annotated[str, typer.Option()],
    password: Annotated[str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)],
    full_name: Annotated[str, typer.Option()] = "",
    org: Annotated[str | None, typer.Option(help="Organization id or slug to add the user to")] = None,
    role: Annotated[str, typer.Option(help="owner | admin | staff | athlete")] = "staff",
) -> None:
    """Create a user (or reuse an existing one) and optionally add them to an organization."""
    _create_user(email, password, full_name, org, role)


@cli.command("create-admin")
def create_admin_cmd(
    email: Annotated[str, typer.Option()],
    org: Annotated[str, typer.Option(help="Organization id or slug")],
    password: Annotated[str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)],
    full_name: Annotated[str, typer.Option()] = "",
) -> None:
    """Create an administrator: owner if the organization has none yet, else admin."""
    db = SessionLocal()
    try:
        organization = _find_org(db, org)
        has_owner = db.scalar(
            select(OrgMembership.id).where(OrgMembership.org_id == organization.id, OrgMembership.role == "owner")
        )
    finally:
        db.close()
    _create_user(email, password, full_name, org, "admin" if has_owner else "owner")


@cli.command("bootstrap")
def bootstrap_cmd() -> None:
    """First-start setup from environment variables (see app/bootstrap.py). Never fails the start."""
    from app.bootstrap import BootstrapError, bootstrap
    from app.config import settings

    db = SessionLocal()
    try:
        done = bootstrap(
            db,
            seed_demo=settings.ams_seed_demo,
            demo_password=settings.ams_demo_password or DEFAULT_DEMO_PASSWORD,
            org_name=settings.ams_org_name or None,
            org_timezone=settings.ams_org_timezone or "UTC",
            admin_email=settings.ams_admin_email or None,
            admin_password=settings.ams_admin_password or None,
            admin_name=settings.ams_admin_name,
        )
    except (BootstrapError, ValueError) as exc:
        db.rollback()
        typer.echo(f"bootstrap: not applied: {exc}", err=True)
        return
    finally:
        db.close()
    for line in done:
        typer.echo(f"bootstrap: {line}")


@cli.command("seed-demo")
def seed_demo_cmd(
    password: Annotated[
        str | None, typer.Option(help="Password for the demo users (default: $AMS_DEMO_PASSWORD or a fixed demo value)")
    ] = None,
    today: Annotated[str | None, typer.Option(help="Anchor date YYYY-MM-DD (default: today in New York)")] = None,
) -> None:
    """Create the "Demo Performance" organization with ~6 weeks of synthetic data."""
    from app.config import settings
    from app.seed import DemoExistsError, seed_demo

    pw = password or settings.ams_demo_password or DEFAULT_DEMO_PASSWORD
    anchor = dt.date.fromisoformat(today) if today else None
    db = SessionLocal()
    try:
        org = seed_demo(db, pw, anchor)
        db.commit()
    except DemoExistsError as exc:
        typer.echo(f"refusing: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    finally:
        db.close()
    typer.echo(f"seeded {org.name} ({org.id})")
    typer.echo("logins: admin@example.com (owner), coach@example.com, medic@example.com,")
    typer.echo("        researcher@example.com (blinded), athlete@example.com (athlete A-0001)")


@cli.command("export-demo")
def export_demo_cmd(
    out: Annotated[Path, typer.Option(help="Directory for the <role>.json files (created if missing)")],
) -> None:
    """Write the web demo fixtures (one JSON file per demo login) from a seed-demo database."""
    from app.demo_export import DemoNotSeededError, export_demo

    try:
        paths = export_demo(out)
    except DemoNotSeededError as exc:
        typer.echo(f"refusing: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    for path in paths:
        typer.echo(f"{path} {path.stat().st_size / 1024:.0f} KiB")


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
