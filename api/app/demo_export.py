"""Fixtures for the in-browser web demo: ``python -m app.cli export-demo --out <dir>``.

Precondition: the database holds the demo seed (``seed-demo``). The exporter drives the real
FastAPI app in-process (``fastapi.testclient.TestClient``) as each demo login and writes one JSON
file per role (``owner.json``, ``coach.json``, ``medic.json``, ``researcher.json``,
``athlete.json``). Every response comes from the API under that role, so visibility, masking and
form sensitivity are already applied; the web demo (``web/src/demo``) serves them back and applies
writes in memory.

Besides the responses, each file carries ``access``: the caller's per-athlete rights as computed by
``app.permissions.Principal``, so the browser can accept or refuse demo writes the way the API
would without re-deriving them. Open Wearables is forced off while exporting: the demo shows the
honest "not configured" state (the 503 the providers endpoint gives) and never calls a live OW.

The JSON shape is ``web/src/demo/fixture.ts`` (``format`` 1). Errors are stored as
``{"$error": {"status": 403, "body": {...}}}`` so the demo can replay them.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import secrets
import uuid
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.deps import athlete_id_for
from app.models import Organization, OrgMembership, Submission, User, WearableDaily
from app.permissions import Principal
from app.security import create_access_token
from app.seed import DEMO_ORG_SLUG
from app.templates import TEMPLATES

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

API = "/api/v1"
FORMAT = 1
BOARD_DAYS = 14
PAGE = 500

# (file name, login). Order matters only for the owner's audit page, which is read first.
DEMO_ROLES: tuple[tuple[str, str], ...] = (
    ("owner", "admin@example.com"),
    ("coach", "coach@example.com"),
    ("medic", "medic@example.com"),
    ("researcher", "researcher@example.com"),
    ("athlete", "athlete@example.com"),
)


class DemoNotSeededError(Exception):
    pass


Json = Any


@contextmanager
def _demo_settings() -> Iterator[None]:
    """Open Wearables off and a signing key for the in-process tokens; restored afterwards."""
    keys = ("ow_base_url", "ow_api_key", "ow_app_id", "ow_app_secret", "ams_secret_key")
    saved = {k: getattr(settings, k) for k in keys}
    try:
        settings.ow_base_url = None
        settings.ow_api_key = None
        settings.ow_app_id = None
        settings.ow_app_secret = None
        if len(settings.ams_secret_key or "") < 32:
            settings.ams_secret_key = secrets.token_hex(32)
        yield
    finally:
        for k, v in saved.items():
            setattr(settings, k, v)


class _Caller:
    """GETs against the app as one user; non-2xx responses become ``{"$error": ...}``."""

    def __init__(self, client: TestClient, user_id: uuid.UUID, org_id: uuid.UUID) -> None:
        token, _ = create_access_token(user_id)
        self.client = client
        self.headers = {"Authorization": f"Bearer {token}"}
        self.org = f"{API}/orgs/{org_id}"

    def get(self, path: str, **params: Any) -> Json:
        query = {k: v for k, v in params.items() if v is not None}
        r = self.client.get(path, params=query, headers=self.headers)
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = {"detail": r.text}
            return {"$error": {"status": r.status_code, "body": body}}
        return r.json()

    def all_pages(self, path: str, **params: Any) -> Json:
        items: list[Json] = []
        offset = 0
        while True:
            page = self.get(path, limit=PAGE, offset=offset, **params)
            if is_error(page):
                return page
            items.extend(page["items"])
            offset += PAGE
            if offset >= page["total"] or not page["items"]:
                return items


def is_error(value: Json) -> bool:
    return isinstance(value, dict) and "$error" in value


def _data_range(db: Session, org_id: uuid.UUID) -> tuple[dt.date, dt.date]:
    """First and last day with seeded data; the last one is the seed's "today"."""
    lo: list[dt.date] = []
    hi: list[dt.date] = []
    for col, org_col in ((Submission.local_date, Submission.org_id), (WearableDaily.local_date, WearableDaily.org_id)):
        first, last = db.execute(select(func.min(col), func.max(col)).where(org_col == org_id)).one()
        if first is not None:
            lo.append(first)
            hi.append(last)
    if not hi:
        raise DemoNotSeededError("the demo organization has no data; run seed-demo on a fresh database")
    return min(lo), max(hi)


def _access(db: Session, user: User, org: Organization, athlete_ids: list[str]) -> Json:
    membership = db.scalar(
        select(OrgMembership).where(OrgMembership.org_id == org.id, OrgMembership.user_id == user.id)
    )
    assert membership is not None
    p = Principal(db, user, org, membership, athlete_id_for(db, org.id, user.id))
    rights = p.rights_for(uuid.UUID(a) for a in athlete_ids)
    return {
        "role": p.role,
        "is_admin": p.is_admin,
        "is_owner": p.is_owner,
        "athlete_id": str(p.athlete_id) if p.athlete_id else None,
        "readable_sensitivities": sorted(p.readable_sensitivities),
        "writable_sensitivities": sorted(p.writable_sensitivities),
        "writable_group_ids": None if p.is_admin else sorted(str(g) for g in p.writable_group_ids),
        "identifiable_group_ids": None if p.is_admin else sorted(str(g) for g in p.identifiable_group_ids),
        "athletes": {
            str(aid): {
                "identifiable": r.identifiable,
                "write": r.write,
                "read": sorted(r.read),
                "write_forms": sorted(r.write_forms),
            }
            for aid, r in rights.items()
        },
    }


def _compact_points(points: list[Json]) -> list[Json]:
    """MetricPoint objects as ``[date, value, flag, source]`` (a third of the size)."""
    return [[pt["date"], pt["value"], pt["flag"], pt["source"]] for pt in points]


def export_role(
    client: TestClient,
    db: Session,
    org: Organization,
    user: User,
    role: str,
    first_day: dt.date,
    today: dt.date,
) -> Json:
    c = _Caller(client, user.id, org.id)
    o = c.org
    out: dict[str, Json] = {
        "format": FORMAT,
        "role": role,
        "email": user.email,
        "generated_on": today.isoformat(),
        "data_start": first_day.isoformat(),
        "org_id": str(org.id),
    }
    # First, before any read below adds audit entries of its own.
    out["audit"] = c.get(f"{o}/audit", limit=50)
    out["me"] = c.get(f"{API}/me")
    out["org"] = c.get(o)
    out["members"] = c.get(f"{o}/members")
    out["invitations"] = c.get(f"{o}/invitations")

    groups = c.get(f"{o}/groups", include_archived=True)
    out["groups"] = groups
    group_ids = [g["id"] for g in groups] if not is_error(groups) else []
    staff: Json = {}
    for gid in group_ids:
        s = c.get(f"{o}/groups/{gid}/staff")
        if is_error(s):
            staff = s
            break
        staff[gid] = s
    out["staff"] = staff

    athletes = c.all_pages(f"{o}/athletes")
    archived = c.all_pages(f"{o}/athletes", status="archived")
    if not is_error(athletes) and not is_error(archived):
        athletes = athletes + archived
    out["athletes"] = athletes
    athlete_ids = [a["id"] for a in athletes] if not is_error(athletes) else []
    out["access"] = _access(db, user, org, athlete_ids)

    forms = c.get(f"{o}/forms", include_archived=True)
    out["forms"] = forms
    form_ids = [f["id"] for f in forms] if not is_error(forms) else []
    out["form_versions"] = {fid: c.get(f"{o}/forms/{fid}/versions") for fid in form_ids}
    out["schedules"] = {fid: c.get(f"{o}/forms/{fid}/schedules") for fid in form_ids}
    out["form_templates"] = c.get(f"{o}/form-templates")
    out["template_settings"] = {
        key: {
            "athlete_can_submit": t.athlete_can_submit,
            "athlete_can_view": t.athlete_can_view,
            "allow_multiple_per_day": t.allow_multiple_per_day,
        }
        for key, t in TEMPLATES.items()
    }

    out["submissions"] = c.all_pages(f"{o}/submissions")
    out["imports"] = c.get(f"{o}/imports")

    metrics = c.get(f"{o}/metrics")
    out["metrics"] = metrics
    out["series_sources"] = c.get(f"{o}/series-sources")
    series: Json = metrics if is_error(metrics) else {}
    if not is_error(metrics):
        for m in metrics:
            per_athlete: dict[str, Json] = {}
            for aid in athlete_ids:
                s = c.get(
                    f"{o}/metrics/{m['slug']}/series",
                    athlete_id=aid,
                    start=first_day.isoformat(),
                    end=today.isoformat(),
                )
                per_athlete[aid] = s if is_error(s) else _compact_points(s["points"])
            series[m["slug"]] = per_athlete
    out["series"] = {"start": first_day.isoformat(), "end": today.isoformat(), "points": series}

    # The all-groups board of each of the last BOARD_DAYS days. A group's board is the same rows
    # restricted to the group's athletes (cells and due counts are per athlete), so the demo derives
    # it from current membership instead of exporting one board per group and day.
    boards: Json = {}
    for n in range(BOARD_DAYS - 1, -1, -1):
        day = (today - dt.timedelta(days=n)).isoformat()
        board = c.get(f"{o}/dashboards/readiness", date=day)
        if is_error(board):
            boards = board  # not staff: one error stands for every board
            break
        boards[day] = board
    out["readiness"] = boards if is_error(boards) else {"all": boards}

    out["wearables"] = {
        "providers": c.get(f"{o}/wearables/providers"),
        "status": {aid: c.get(f"{o}/athletes/{aid}/wearables") for aid in athlete_ids},
        "daily": {
            aid: c.get(f"{o}/athletes/{aid}/wearables/daily", start=first_day.isoformat(), end=today.isoformat())
            for aid in athlete_ids
        },
    }

    if out["access"]["athlete_id"] is not None:
        out["self"] = {
            "athlete": c.get(f"{o}/me/athlete"),
            "forms": c.get(f"{o}/me/forms", date=today.isoformat()),
            "submissions": c.all_pages(f"{o}/me/submissions"),
            "wearables": c.get(f"{o}/me/wearables"),
        }
    return out


def export_demo(out_dir: Path, roles: tuple[tuple[str, str], ...] = DEMO_ROLES) -> list[Path]:
    """Writes ``<out_dir>/<role>.json`` for each demo login; returns the paths."""
    with warnings.catch_warnings():  # "Using httpx with starlette.testclient is deprecated"
        warnings.simplefilter("ignore")
        from fastapi.testclient import TestClient

    from app.main import app

    logging.getLogger("httpx").setLevel(logging.WARNING)  # one INFO line per in-process request otherwise
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    with _demo_settings():
        db = SessionLocal()
        try:
            org = db.scalar(select(Organization).where(Organization.slug == DEMO_ORG_SLUG))
            if org is None:
                raise DemoNotSeededError(f"organization {DEMO_ORG_SLUG!r} not found; run seed-demo first")
            first_day, today = _data_range(db, org.id)
            client = TestClient(app)  # no lifespan: the secret-key check is ours (_demo_settings)
            for role, email in roles:
                user = db.scalar(select(User).where(User.email == email))
                if user is None:
                    raise DemoNotSeededError(f"demo user {email} not found; run seed-demo first")
                data = export_role(client, db, org, user, role, first_day, today)
                db.rollback()  # drop the Principal's cached reads before the next role
                path = out_dir / f"{role}.json"
                path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                written.append(path)
        finally:
            db.close()
    return written
