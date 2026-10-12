from __future__ import annotations


class OpenWearablesNotConfiguredError(Exception):
    """OW (or the part of it a call needs) is not configured. The API answers 503."""


class OpenWearablesError(Exception):
    """OW failed or answered unexpectedly. The API answers 502."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenWearablesConflictError(OpenWearablesError):
    """OW answered 409 (e.g. a user with this email already exists)."""
