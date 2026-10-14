from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, ConfigDict

OrgRole = Literal["owner", "admin", "staff", "athlete"]
AccessRole = Literal["viewer", "coach", "practitioner", "medical", "researcher"]
GroupKind = Literal["team", "squad", "unit", "section", "study", "cohort", "other"]
Sensitivity = Literal["general", "medical", "research"]
FormKind = Literal["questionnaire", "session", "test", "medical", "profile", "import"]
SubmissionSource = Literal["mobile", "web", "import", "api"]
Flag = Literal["green", "amber", "red"] | None
AthleteStatus = Literal["active", "inactive", "archived"]
Sex = Literal["female", "male", "other", "undisclosed"]
Recurrence = Literal["daily", "weekly", "once"]

Limit = Annotated[int, Query(ge=1, le=500)]
Offset = Annotated[int, Query(ge=0)]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int


class Detail(BaseModel):
    detail: str


PROVIDER_KEY_RE = re.compile(r"^[a-z0-9_]{1,32}$")


def check_provider_order(v: list[str] | None) -> list[str] | None:
    """A ranking of Open Wearables provider keys (e.g. ["oura", "garmin"]); duplicates dropped."""
    if v is None:
        return None
    if len(v) > 32:
        raise ValueError("at most 32 providers")
    for key in v:
        if not PROVIDER_KEY_RE.match(key):
            raise ValueError(f"invalid provider key {key!r}")
    return list(dict.fromkeys(v))
