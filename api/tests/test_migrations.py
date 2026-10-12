"""`alembic upgrade head` on an empty database produces exactly the models (no pending autogenerate diff)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url

import app.models  # noqa: F401
from app.database import Base

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


@pytest.fixture
def empty_database() -> Iterator[Engine]:
    url = make_url(os.environ["DATABASE_URL"])
    name = f"ams_migrations_{uuid.uuid4().hex[:8]}"
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(url.set(database=name))
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _config(conn: object) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.attributes["configure_logger"] = False
    cfg.attributes["connection"] = conn
    return cfg


def test_upgrade_head_matches_models_and_downgrades(empty_database: Engine) -> None:
    with empty_database.begin() as conn:
        command.upgrade(_config(conn), "head")
    with empty_database.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(context, Base.metadata)
    assert diff == [], f"models and migrations differ: {diff}"
    with empty_database.begin() as conn:
        command.downgrade(_config(conn), "base")
    with empty_database.connect() as conn:
        tables = conn.execute(text("select tablename from pg_tables where schemaname = 'public'")).scalars().all()
    assert set(tables) <= {"alembic_version"}
