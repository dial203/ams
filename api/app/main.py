"""FastAPI application."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.integrations.open_wearables.errors import OpenWearablesError, OpenWearablesNotConfiguredError
from app.routes import (
    athlete_self,
    athletes,
    audit_log,
    auth,
    forms,
    groups,
    imports,
    metrics,
    orgs,
    submissions,
    wearables,
)

API_PREFIX = "/api/v1"

logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if len(settings.ams_secret_key) < 32:
        raise RuntimeError("AMS_SECRET_KEY must be set (at least 32 characters)")
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="AMS API",
        version="1.0.0",
        description="Athlete management system API. Contract: docs/API.md.",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    @app.exception_handler(OpenWearablesNotConfiguredError)
    async def _ow_not_configured(_: Request, exc: OpenWearablesNotConfiguredError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(OpenWearablesError)
    async def _ow_error(_: Request, exc: OpenWearablesError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": f"Open Wearables error: {exc}"})

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(f"{API_PREFIX}/health", tags=["system"], include_in_schema=False)
    def health_v1() -> dict[str, str]:
        return {"status": "ok"}

    for module in (
        auth,
        orgs,
        groups,
        athletes,
        forms,
        submissions,
        imports,
        athlete_self,
        wearables,
        metrics,
        audit_log,
    ):
        app.include_router(module.router, prefix=API_PREFIX)
    return app


app = create_app()
