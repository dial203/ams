"""The ``Connector`` interface for team systems (GPS units, force plates, velocity transducers, ...).

A connector turns a vendor's export or API into a :class:`Table` of string cells, suggests how
its columns map onto an AMS form, and from there the generic import pipeline
(``app.services.imports``) does the rest: athlete matching (code / email / name /
``attributes.external_id``), date handling, type parsing, validation through the form engine and
``source=import`` submissions grouped in an ``import_batch``.

How vendor presets plug in:

* **File presets** (a vendor's CSV/XLSX export with known headers): subclass
  :class:`~app.connectors.file_import.FileImportConnector`, set ``key``/``name``, the target
  ``template_key`` (e.g. ``"gps_session"``) and a fixed ``column_map`` (vendor header -> field key),
  plus ``athlete_column``/``athlete_match``/``date_column``/``date_format`` defaults. Override
  ``read`` if the export needs pre-processing (multi-row headers, unit rows, per-period rows to
  aggregate). Register it in ``app.connectors.REGISTRY``.
* **API-pull connectors** (vendor cloud APIs): implement :meth:`Connector.fetch` returning a
  :class:`Table` for a date range (credentials come from org settings / env), and reuse the same
  mapping and commit path. A Celery beat task can then pull on a schedule.

Per-athlete consumer wearables do **not** belong here: they go through Open Wearables
(``app.integrations.open_wearables``).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol, runtime_checkable


@dataclass
class Table:
    columns: list[str]
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class MappingSuggestion:
    mapping: dict[str, str]  # column -> field key
    athlete_column: str | None
    date_column: str | None


@runtime_checkable
class Connector(Protocol):
    key: ClassVar[str]
    name: ClassVar[str]

    def read(self, filename: str, data: bytes) -> Table:
        """Parse an uploaded export into a table of strings (header row -> column names)."""
        ...

    def suggest(self, table: Table, schema: dict[str, Any]) -> MappingSuggestion:
        """Suggest column -> field mapping and the athlete/date columns for a form schema."""
        ...

    def fetch(self, start: dt.date, end: dt.date) -> Table:  # pragma: no cover - API connectors only
        """API-pull connectors: rows for a date range. File connectors raise NotImplementedError."""
        ...


class ConnectorError(ValueError):
    """The upload cannot be read (bad encoding, empty file, unsupported type)."""
