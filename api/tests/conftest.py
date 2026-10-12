"""Test configuration.

Tests need Postgres: ``TEST_DATABASE_URL`` (default ``postgresql+psycopg://postgres@localhost:5433/ams_test``).
The schema is rebuilt with ``alembic upgrade head`` once per session; every test that touches the
database truncates all tables afterwards. Celery runs eagerly; Open Wearables and Expo are mocked
with respx.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator

_UPLOADS = tempfile.mkdtemp(prefix="ams-test-uploads-")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5433/ams_test"
)
os.environ.update(
    {
        "AMS_SECRET_KEY": "test-secret-key-for-ams-api-tests-0123456789",
        "WEB_BASE_URL": "https://ams.test",
        "OW_BASE_URL": "http://ow.test",
        "OW_API_KEY": "ow-test-key",
        "OW_APP_ID": "app-id",
        "OW_APP_SECRET": "app-secret",
        "OW_WEBHOOK_SECRET": "whsec_dGVzdC13ZWJob29rLXNlY3JldC0wMTIzNDU2Nzg5",
        "AMS_UPLOAD_DIR": _UPLOADS,
        "CELERY_TASK_ALWAYS_EAGER": "true",
        "EXPO_PUSH_ENABLED": "false",
        "REDIS_URL": "memory://",
    }
)

import pytest  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app import security  # noqa: E402
from app.database import Base, SessionLocal, get_engine  # noqa: E402

# Fast argon2id parameters for tests (still argon2id).
security._hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)


def _run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def _schema() -> Iterator[None]:
    _run_migrations()
    yield


def _truncate() -> None:
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db(_schema: None) -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        _truncate()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    from app.main import app

    with TestClient(app) as c:
        yield c
