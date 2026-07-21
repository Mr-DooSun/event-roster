from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from password_service.api import InvalidPayloadError, Kdf, router
from password_service.config import Settings
from password_service.kdf import DUMMY_PASSWORD_INPUT, PasswordKdf, is_policy_argon2id_phc


def create_app(settings: Settings | None = None, kdf: Kdf | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime_settings = settings or Settings.from_environment()
        configured_kdf = PasswordKdf(runtime_settings.password_pepper)
        if not is_policy_argon2id_phc(
            runtime_settings.dummy_argon2_phc
        ) or not configured_kdf.verify(
            DUMMY_PASSWORD_INPUT, runtime_settings.dummy_argon2_phc
        ):
            raise RuntimeError("DUMMY_ARGON2_PHC does not match PASSWORD_PEPPER")
        app.state.settings = runtime_settings
        app.state.kdf = kdf or configured_kdf
        yield

    app = FastAPI(lifespan=lifespan)
    app.include_router(router)

    @app.exception_handler(InvalidPayloadError)
    async def invalid_payload_handler(
        _request: Request, _error: InvalidPayloadError
    ) -> JSONResponse:
        return JSONResponse(status_code=422, content={"code": "VALIDATION_FAILED"})

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        _request: Request, _error: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(status_code=422, content={"code": "VALIDATION_FAILED"})

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
