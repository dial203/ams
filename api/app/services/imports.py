"""CSV/XLSX import: preview (store upload, suggest mapping) and commit (match, parse, validate, save)."""

from __future__ import annotations

import datetime as dt
import logging
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.config import settings
from app.connectors import REGISTRY, ConnectorError, Table
from app.forms.schema import FieldInfo, index_schema
from app.models import Athlete, Form, ImportBatch, ImportUpload
from app.permissions import AthleteRights, Principal
from app.schemas.domain import ImportBatchOut, ImportCommit, ImportPreview, ImportRowError
from app.services.submissions import DuplicateSubmissionError, SubmissionInvalidError, create_submission
from app.timeutil import local_date as to_local_date
from app.timeutil import local_noon, utcnow, zone

log = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_SUFFIXES = (".csv", ".xlsx")


class ParseError(ValueError):
    pass


def upload_dir() -> Path:
    path = Path(settings.ams_upload_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def cleanup_expired_uploads(db: Session) -> int:
    expired = db.scalars(select(ImportUpload).where(ImportUpload.expires_at <= utcnow())).all()
    for up in expired:
        Path(up.stored_path).unlink(missing_ok=True)
        db.delete(up)
    return len(expired)


def batch_out(b: ImportBatch) -> ImportBatchOut:
    return ImportBatchOut(
        id=b.id,
        form_id=b.form_id,
        filename=b.filename,
        created_by=b.created_by,
        created_at=b.created_at,
        row_count=b.row_count,
        created_count=b.created_count,
        skipped_count=b.skipped_count,
        errors=[ImportRowError(**e) for e in (b.errors or [])],
        dry_run=b.dry_run,
    )


def _connector() -> Any:
    return REGISTRY["file"]


def preview(db: Session, p: Principal, form: Form, filename: str, data: bytes) -> ImportPreview:
    if form.current_version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="form has no published version")
    suffix = Path(filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="upload a .csv or .xlsx file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="file too large (max 20 MB)")
    try:
        table = _connector().read(filename, data)
    except ConnectorError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    cleanup_expired_uploads(db)
    upload_id = uuid.uuid4()
    folder = upload_dir() / str(p.org_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{upload_id}{suffix}"
    path.write_bytes(data)
    db.add(
        ImportUpload(
            id=upload_id,
            org_id=p.org_id,
            form_id=form.id,
            filename=Path(filename).name[:255],
            stored_path=str(path),
            created_by=p.user_id,
            expires_at=utcnow() + dt.timedelta(hours=settings.upload_ttl_hours),
        )
    )
    suggestion = _connector().suggest(table, form.current_version.schema)
    return ImportPreview(
        upload_id=upload_id,
        columns=table.columns,
        row_count=len(table.rows),
        sample_rows=table.rows[:10],
        suggested_mapping=suggestion.mapping,
        suggested_athlete_column=suggestion.athlete_column,
        suggested_date_column=suggestion.date_column,
    )


# ----------------------------------------------------------------------------- athlete matching


def _norm_name(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


@dataclass
class AthleteIndex:
    by_key: dict[str, list[Athlete]] = field(default_factory=dict)

    def add(self, key: str, athlete: Athlete) -> None:
        if key:
            bucket = self.by_key.setdefault(key, [])
            if athlete not in bucket:
                bucket.append(athlete)

    def find(self, key: str) -> list[Athlete]:
        return self.by_key.get(key, [])


def build_index(athletes: list[Athlete], rights: dict[uuid.UUID, AthleteRights], mode: str) -> AthleteIndex:
    idx = AthleteIndex()
    for a in athletes:
        r = rights.get(a.id)
        if r is None:
            continue
        if mode == "code":
            idx.add(a.code.strip().lower(), a)
        elif mode == "external_id":
            ext = (a.attributes or {}).get("external_id")
            if ext not in (None, ""):
                idx.add(str(ext).strip().lower(), a)
        elif not r.identifiable:
            continue  # names / emails are masked for this caller: never match on them
        elif mode == "email":
            if a.email:
                idx.add(a.email.strip().lower(), a)
        elif mode == "name":
            first, last = a.first_name, a.last_name
            names = {f"{first} {last}", f"{last} {first}", f"{last}, {first}"}
            if a.preferred_name:
                names |= {f"{a.preferred_name} {last}", f"{last}, {a.preferred_name}"}
            for n in names:
                idx.add(_norm_name(n), a)
    return idx


def match_key(value: str, mode: str) -> str:
    return _norm_name(value) if mode == "name" else value.strip().lower()


# ----------------------------------------------------------------------------- value parsing

_TRUE = {"true", "t", "yes", "y", "1"}
_FALSE = {"false", "f", "no", "n", "0"}


def parse_number(text: str) -> float | int:
    t = text.strip().replace("\u00a0", "").replace(" ", "")
    if re.fullmatch(r"-?\d+,\d+", t):
        t = t.replace(",", ".")
    try:
        value = float(t)
    except ValueError as exc:
        raise ParseError(f"cannot parse {text!r} as a number") from exc
    if value != value or value in (float("inf"), float("-inf")):
        raise ParseError(f"cannot parse {text!r} as a number")
    return int(value) if value.is_integer() and abs(value) < 2**53 else value


def parse_duration(text: str) -> float | int:
    t = text.strip()
    m = re.fullmatch(r"(\d+):([0-5]\d)(?::([0-5]\d))?", t)
    if m:
        minutes = int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3)) / 60 if m.group(3) else 0)
        return int(minutes) if float(minutes).is_integer() else round(minutes, 4)
    return parse_number(t)


def _option(text: str, options: list[dict[str, Any]]) -> Any:
    values = [o.get("value") for o in options]
    numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values)
    t = text.strip()
    for o in options:
        if str(o.get("value")).lower() == t.lower() or str(o.get("label", "")).strip().lower() == t.lower():
            return o.get("value")
    if numeric:
        try:
            return parse_number(t)
        except ParseError:
            pass
    return t  # unknown option: the form engine reports invalid_option


def parse_value(f: FieldInfo, text: str, tz_name: str) -> Any:
    t = text.strip()
    if t == "":
        return None
    ftype = f.type
    if ftype in ("number", "scale"):
        return parse_number(t)
    if ftype == "duration":
        return parse_duration(t)
    if ftype == "boolean":
        low = t.lower()
        if low in _TRUE:
            return True
        if low in _FALSE:
            return False
        raise ParseError(f"cannot parse {text!r} as yes/no")
    if ftype == "select":
        return _option(t, f.spec.get("options") or [])
    if ftype == "multiselect":
        parts = [x for x in re.split(r"[;|,]", t) if x.strip()]
        return [_option(x, f.spec.get("options") or []) for x in parts]
    if ftype == "date":
        return t[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", t) else t
    if ftype == "time":
        m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::\d{2})?", t)
        return f"{int(m.group(1)):02d}:{m.group(2)}" if m else t
    if ftype == "datetime":
        try:
            moment = dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
        except ValueError:
            return t
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=zone(tz_name))
        return moment.isoformat()
    return t


def parse_when(text: str, fmt: str | None, tz_name: str) -> tuple[dt.datetime | None, dt.date]:
    """Returns (observed_at or None for date-only, local date in tz_name)."""
    t = text.strip()
    if not t:
        raise ParseError("missing date")
    if fmt:
        try:
            parsed = dt.datetime.strptime(t, fmt)
        except ValueError as exc:
            raise ParseError(f"date {text!r} does not match format {fmt!r}") from exc
        if not re.search(r"%[HIMSfp]", fmt):
            return None, parsed.date()
        moment = parsed if parsed.tzinfo else parsed.replace(tzinfo=zone(tz_name))
        return moment, moment.astimezone(zone(tz_name)).date()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t) or re.fullmatch(r"\d{4}/\d{2}/\d{2}", t):
        try:
            return None, dt.date.fromisoformat(t.replace("/", "-"))
        except ValueError as exc:
            raise ParseError(f"invalid date {text!r}") from exc
    try:
        moment = dt.datetime.fromisoformat(t.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ParseError(f"cannot parse date {text!r}; use ISO 8601 or pass date_format") from exc
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=zone(tz_name))
    return moment, moment.astimezone(zone(tz_name)).date()


# ----------------------------------------------------------------------------- commit


def _load_upload(db: Session, p: Principal, form: Form, upload_id: uuid.UUID) -> tuple[ImportUpload, Table]:
    up = db.get(ImportUpload, upload_id)
    if up is None or up.org_id != p.org_id or up.form_id != form.id or up.expires_at <= utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="upload not found or expired; preview again")
    path = Path(up.stored_path)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="upload not found or expired; preview again")
    try:
        table = _connector().read(up.filename, path.read_bytes())
    except ConnectorError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return up, table


def commit(db: Session, p: Principal, form: Form, body: ImportCommit) -> ImportBatch:
    version = form.current_version
    if version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="form has no published version")
    up, table = _load_upload(db, p, form, body.upload_id)
    fields = {f.key: f for f in index_schema(version.schema).input_fields}
    for col, key in body.mapping.items():
        if col not in table.columns:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"column {col!r} is not in the file")
        if key not in fields:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"{key!r} is not an input field of the form")
    if len(set(body.mapping.values())) != len(body.mapping):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="two columns map to the same field")
    if body.athlete_column not in table.columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"column {body.athlete_column!r} is not in the file")
    if body.date_column is not None and body.date_column not in table.columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"column {body.date_column!r} is not in the file")
    if body.date_column is None and body.default_date is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="give date_column or default_date")

    athletes = list(
        db.scalars(select(Athlete).where(Athlete.org_id == p.org_id, p.visible_athletes_clause(Athlete.id)))
    )
    rights = p.rights_for(a.id for a in athletes)
    index = build_index(athletes, rights, body.athlete_match)

    batch = ImportBatch(
        id=uuid.uuid4(),
        org_id=p.org_id,
        form_id=form.id,
        upload_id=up.id,
        filename=up.filename,
        created_by=p.user_id,
        row_count=len(table.rows),
        dry_run=body.dry_run,
        config=body.model_dump(mode="json", exclude={"upload_id"}),
    )
    if not body.dry_run:
        db.add(batch)
        db.flush()
    errors: list[dict[str, Any]] = []
    created = 0
    pending: set[tuple[uuid.UUID, dt.date]] = set()
    for i, row in enumerate(table.rows, start=1):
        key_text = row.get(body.athlete_column, "")
        if not key_text.strip():
            errors.append({"row": i, "message": f"{body.athlete_column}: empty athlete identifier"})
            continue
        matches = index.find(match_key(key_text, body.athlete_match))
        if not matches:
            errors.append({"row": i, "message": f"{body.athlete_column}: no athlete matches {key_text!r}"})
            continue
        if len(matches) > 1:
            errors.append({"row": i, "message": f"{body.athlete_column}: {key_text!r} matches several athletes"})
            continue
        athlete = matches[0]
        if not p.can_write_form_data(form, athlete.id, rights.get(athlete.id)):
            errors.append({"row": i, "message": f"not allowed to write this form for athlete {athlete.code}"})
            continue
        tz_name = body.timezone or athlete.timezone or p.org.timezone
        try:
            if body.date_column is not None:
                observed, day = parse_when(row.get(body.date_column, ""), body.date_format, tz_name)
            else:
                observed, day = None, body.default_date  # type: ignore[assignment]
            values: dict[str, Any] = {}
            for col, key in body.mapping.items():
                try:
                    parsed = parse_value(fields[key], row.get(col, ""), tz_name)
                except ParseError as exc:
                    raise ParseError(f"{col}: {exc}") from exc
                if parsed is not None:
                    values[key] = parsed
        except ParseError as exc:
            errors.append({"row": i, "message": str(exc)})
            continue
        try:
            with db.begin_nested():
                create_submission(
                    db,
                    org=p.org,
                    form=form,
                    athlete=athlete,
                    values=values,
                    user_id=p.user_id,
                    source="import",
                    observed_at=observed or local_noon(day, athlete.timezone, p.org.timezone),
                    local_date=day if observed is None else to_local_date(observed, tz_name),
                    import_batch_id=None if body.dry_run else batch.id,
                    pending_days=pending,
                    dry_run=body.dry_run,
                )
        except SubmissionInvalidError as exc:
            detail = ", ".join(f"{k}: {v}" for k, v in exc.field_errors.items())
            errors.append({"row": i, "message": f"invalid values ({detail})"})
            continue
        except DuplicateSubmissionError:
            errors.append({"row": i, "message": f"athlete {athlete.code} already has a submission on {day}"})
            continue
        created += 1
    batch.created_count = created
    batch.skipped_count = len(table.rows) - created
    batch.errors = errors
    if body.dry_run:
        db.add(batch)
        db.flush()
    audit.record(
        db,
        org_id=p.org_id,
        user_id=p.user_id,
        action="import.dry_run" if body.dry_run else "import.commit",
        entity_type="import_batch",
        entity_id=batch.id,
        details={"form_id": form.id, "rows": len(table.rows), "created": created, "skipped": batch.skipped_count},
    )
    return batch
