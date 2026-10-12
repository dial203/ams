"""Deterministic demo data: ``python -m app.cli seed-demo``.

Org "Demo Performance" (America/New_York) with an owner, a coach, a medical staff member and a
blinded researcher; groups Athletics > Sprints / Distance and a "Pilot Study"; 16 athletes; every
template installed; a daily wellness schedule on Athletics; ~42 days of wellness, sRPE, weekly CMJ
and wearable data. A-0005 deteriorates over the last 10 days (readiness amber/red) and A-0010
switches from an Oura ring to a Garmin watch half-way through (its HRV baseline restarts).

Wearable rows are written to ``wearable_daily`` directly; demo athletes are *not* linked to Open
Wearables (fake OW users would make the nightly refresh wipe the demo window).
"""

from __future__ import annotations

import datetime as dt
import logging
import random
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Athlete, AthleteGroup, FormSchedule, Group, Organization, StaffAssignment, WearableDaily
from app.services.forms import install_template
from app.services.orgs import add_member, create_org, create_user, get_user_by_email
from app.services.submissions import create_submission
from app.templates import TEMPLATES
from app.timeutil import today_in, zone

log = logging.getLogger(__name__)

DEMO_ORG_SLUG = "demo-performance"
DEMO_ORG_NAME = "Demo Performance"
DEMO_TZ = "America/New_York"
DAYS = 42
SEED = 20261012
DETERIORATING = "A-0005"
DEVICE_SWITCH = "A-0010"

FIRST = [
    "Maya",
    "Leo",
    "Ana",
    "Sam",
    "Priya",
    "Jonas",
    "Zoe",
    "Kofi",
    "Elena",
    "Tom",
    "Aiko",
    "Mateo",
    "Lena",
    "Noah",
    "Ines",
    "Ravi",
]
LAST = [
    "Okafor",
    "Lindqvist",
    "Ruiz",
    "Patel",
    "Nguyen",
    "Weber",
    "Moreau",
    "Mensah",
    "Rossi",
    "Byrne",
    "Tanaka",
    "Silva",
    "Novak",
    "Kim",
    "Duarte",
    "Shah",
]
SPRINT_POSITIONS = ["100m", "200m", "400m", "110mH"]
DISTANCE_POSITIONS = ["800m", "1500m", "5000m", "10000m"]


class DemoExistsError(Exception):
    pass


@dataclass
class Profile:
    hooper_mean: float
    hrv: float
    rhr: float
    sleep: float
    steps: float
    jump: float
    mass: float


def _clamp(v: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, round(v)))


def _local(day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=zone(DEMO_TZ))


def seed_demo(db: Session, password: str, today: dt.date | None = None) -> Organization:
    if db.scalar(select(Organization.id).where(Organization.slug == DEMO_ORG_SLUG)) is not None:
        raise DemoExistsError(f"organization {DEMO_ORG_SLUG!r} already exists; drop it or use a fresh database")
    today = today or today_in(DEMO_TZ)
    org = create_org(db, DEMO_ORG_NAME, DEMO_TZ, slug=DEMO_ORG_SLUG)

    def user(email: str, name: str, role: str) -> Any:
        u = get_user_by_email(db, email) or create_user(db, email, password, name)
        add_member(db, org, u, role)
        return u

    user("admin@example.com", "Avery Admin", "owner")
    coach = user("coach@example.com", "Casey Coach", "staff")
    medic = user("medic@example.com", "Morgan Medic", "staff")
    researcher = user("researcher@example.com", "Riley Researcher", "staff")

    def group(name: str, kind: str, parent: Group | None = None, description: str | None = None) -> Group:
        g = Group(org_id=org.id, name=name, kind=kind, parent_id=parent.id if parent else None, description=description)
        db.add(g)
        db.flush()
        return g

    athletics = group("Athletics", "team", description="Track and field squad")
    sprints = group("Sprints", "squad", athletics)
    distance = group("Distance", "squad", athletics)
    study = group("Pilot Study", "study", description="HRV-guided training pilot (blinded analysis)")
    db.add_all(
        [
            StaffAssignment(org_id=org.id, user_id=coach.id, group_id=athletics.id, access_role="coach"),
            StaffAssignment(org_id=org.id, user_id=medic.id, group_id=athletics.id, access_role="medical"),
            StaffAssignment(
                org_id=org.id,
                user_id=researcher.id,
                group_id=study.id,
                access_role="researcher",
                can_view_identifiable=False,
            ),
        ]
    )

    forms = {key: install_template(db, org, tpl, None) for key, tpl in TEMPLATES.items()}
    start = today - dt.timedelta(days=DAYS - 1)
    db.add(
        FormSchedule(
            org_id=org.id,
            form_id=forms["wellness_hooper"].id,
            group_id=athletics.id,
            recurrence="daily",
            days_of_week=[],
            due_time="09:00",
            start_date=start,
            remind=True,
            active=True,
        )
    )
    db.add(
        FormSchedule(
            org_id=org.id,
            form_id=forms["session_rpe"].id,
            group_id=athletics.id,
            recurrence="weekly",
            days_of_week=[1, 2, 3, 4, 5, 6],
            due_time="20:00",
            start_date=start,
            remind=False,
            active=True,
        )
    )

    rng = random.Random(SEED)
    athletes: list[tuple[Athlete, Profile, bool]] = []
    for i in range(16):
        sprinter = i < 8
        code = f"A-{i + 1:04d}"
        a = Athlete(
            org_id=org.id,
            code=code,
            first_name=FIRST[i],
            last_name=LAST[i],
            email=f"{FIRST[i].lower()}.{LAST[i].lower()}@example.com",
            date_of_birth=dt.date(1998 + i % 7, 1 + (i * 5) % 12, 1 + (i * 7) % 27),
            sex="female" if i % 2 == 0 else "male",
            position=(SPRINT_POSITIONS if sprinter else DISTANCE_POSITIONS)[i % 4],
            status="active",
            attributes={"external_id": f"EXT-{1000 + i}"},
        )
        db.add(a)
        db.flush()
        joined = start - dt.timedelta(days=120)
        db.add(
            AthleteGroup(
                org_id=org.id, athlete_id=a.id, group_id=(sprints if sprinter else distance).id, joined_on=joined
            )
        )
        if i % 8 in (1, 2, 3):  # 6 athletes in the pilot study
            db.add(AthleteGroup(org_id=org.id, athlete_id=a.id, group_id=study.id, joined_on=start))
        profile = Profile(
            hooper_mean=rng.uniform(2.3, 3.2),
            hrv=rng.uniform(55, 95) if not sprinter else rng.uniform(45, 80),
            rhr=rng.uniform(42, 50) if not sprinter else rng.uniform(48, 58),
            sleep=rng.uniform(440, 500),
            steps=rng.uniform(9000, 14000),
            jump=rng.uniform(38, 48) if sprinter else rng.uniform(28, 36),
            mass=rng.uniform(58, 82),
        )
        athletes.append((a, profile, sprinter))

    # The first athlete has a login for the mobile app demo.
    first_athlete = athletes[0][0]
    athlete_user = get_user_by_email(db, "athlete@example.com") or create_user(
        db, "athlete@example.com", password, f"{first_athlete.first_name} {first_athlete.last_name}"
    )
    add_member(db, org, athlete_user, "athlete")
    first_athlete.user_id = athlete_user.id
    db.flush()

    wearable_rows: list[WearableDaily] = []
    for a, prof, sprinter in athletes:
        arng = random.Random(f"{SEED}-{a.code}")
        for n in range(DAYS):
            day = start + dt.timedelta(days=n)
            decline = max(0, n - (DAYS - 11)) if a.code == DETERIORATING else 0  # 0..10 over the last 10 days
            # ---- wellness (most mornings; ~half the squad has not filled it in yet today)
            skip = arng.random() < 0.08 or (day == today and arng.random() < 0.5)
            if not skip:
                items = [_clamp(prof.hooper_mean + arng.gauss(0, 0.8) + 0.35 * decline, 1, 7) for _ in range(4)]
                pain = arng.random() < 0.06 or decline > 6
                values: dict[str, Any] = {
                    "sleep_quality": items[0],
                    "fatigue": items[1],
                    "stress": items[2],
                    "soreness": items[3],
                    "sleep_hours": round((prof.sleep - 25 * decline + arng.gauss(0, 25)) / 60 * 4) / 4,
                    "has_pain": pain,
                }
                if pain:
                    values["pain_location"] = ["hip_groin"] if decline else [arng.choice(["knee", "lower_leg", "back"])]
                    values["pain_score"] = min(10, 2 + decline // 2 + arng.randint(0, 2))
                create_submission(
                    db,
                    org=org,
                    form=forms["wellness_hooper"],
                    athlete=a,
                    values=values,
                    user_id=a.user_id,
                    source="mobile",
                    observed_at=_local(day, 7, arng.randint(0, 59)),
                    local_date=day,
                    record_audit=False,
                )
            # ---- training: rest on Sundays, double session on some Wednesdays
            if day.isoweekday() != 7 and day < today:
                sessions = 2 if day.isoweekday() == 3 and arng.random() < 0.5 else 1
                for s in range(sessions):
                    rpe = _clamp(arng.gauss(5.5 if sprinter else 5, 1.4) + 0.25 * decline, 1, 10)
                    duration = int(arng.choice([45, 60, 75, 90, 105]) * (1 + 0.04 * decline))
                    create_submission(
                        db,
                        org=org,
                        form=forms["session_rpe"],
                        athlete=a,
                        values={
                            "session_type": "gym" if s == 1 else ("field" if arng.random() < 0.8 else "conditioning"),
                            "rpe": rpe,
                            "duration": min(duration, 600),
                        },
                        user_id=a.user_id,
                        source="mobile",
                        observed_at=_local(day, 17 + s, 30),
                        local_date=day,
                        record_audit=False,
                    )
            # ---- weekly CMJ (Mondays) for sprinters
            if sprinter and day.isoweekday() == 1:
                jump = prof.jump + arng.gauss(0, 1.2) - 0.4 * decline
                create_submission(
                    db,
                    org=org,
                    form=forms["cmj_test"],
                    athlete=a,
                    values={
                        "jump_height_cm": round(jump, 1),
                        "rsi_mod": round(jump / 100 / 0.78, 2),
                        "time_to_takeoff_ms": 780,
                        "peak_power_w": round(prof.mass * (55 + jump / 2)),
                        "body_mass_kg": round(prof.mass + arng.gauss(0, 0.4), 1),
                        "trials": 3,
                    },
                    user_id=None,
                    source="import",
                    observed_at=_local(day, 10),
                    local_date=day,
                    record_audit=False,
                )
            # ---- wearables (nightly values belong to the morning's date)
            if a.code == DEVICE_SWITCH and n >= DAYS // 2:
                provider, device, hrv_scale = "garmin", "Forerunner 265", 0.62  # different device, different RMSSD
            else:
                provider, device, hrv_scale = "oura", "Oura Ring Gen3", 1.0
            if arng.random() < 0.05:
                continue  # ring left on the charger
            hrv = prof.hrv * hrv_scale * (1 + arng.gauss(0, 0.08)) * (1 - 0.045 * decline)
            rhr = prof.rhr + arng.gauss(0, 1.5) + 0.9 * decline
            sleep = prof.sleep + arng.gauss(0, 30) - 13 * decline
            steps = prof.steps * (1 + arng.gauss(0, 0.15)) * (0.6 if day.isoweekday() == 7 else 1.0)
            for metric, value, unit in (
                ("hrv_rmssd_ms", round(hrv, 1), "ms"),
                ("resting_hr_bpm", round(rhr), "bpm"),
                ("sleep_duration_min", round(sleep), "min"),
                ("steps", round(steps), "steps"),
            ):
                wearable_rows.append(
                    WearableDaily(
                        org_id=org.id,
                        athlete_id=a.id,
                        local_date=day,
                        metric=metric,
                        value=value,
                        unit=unit,
                        provider=provider,
                        device=device,
                    )
                )
    db.add_all(wearable_rows)
    db.flush()
    log.info("seeded %s with %d athletes", org.name, len(athletes))
    return org
