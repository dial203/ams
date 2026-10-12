"""Team-system connectors (see ``app.connectors.base`` for the interface and how presets plug in)."""

from app.connectors.base import Connector, ConnectorError, MappingSuggestion, Table
from app.connectors.file_import import FileImportConnector

REGISTRY: dict[str, Connector] = {FileImportConnector.key: FileImportConnector()}

__all__ = ["REGISTRY", "Connector", "ConnectorError", "FileImportConnector", "MappingSuggestion", "Table"]
