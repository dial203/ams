from __future__ import annotations

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
