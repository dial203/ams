"""Celery app and beat schedule.

Run with:
    celery -A app.worker worker --loglevel=INFO
    celery -A app.worker beat --loglevel=INFO
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery("ams", broker=settings.redis_url, include=["app.tasks"])
celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=False,
    task_ignore_result=True,
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "nightly-wearable-refresh": {
            "task": "ams.refresh_all_wearables",
            "schedule": crontab(hour=3, minute=17),
            "kwargs": {"days": 7},
        },
        "due-form-reminders": {
            "task": "ams.send_due_reminders",
            "schedule": crontab(minute="*/15"),
        },
    },
)

app = celery_app
