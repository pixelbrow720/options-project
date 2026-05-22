"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi.errors import RateLimitExceeded

from app.api.deps import limiter
from app.api.endpoints import (
    admin,
    data,
    flow,
    health,
    hiro,
    inspector,
    public_auth,
    public_data,
    snapshot,
    stream,
    stream_ticket,
)
from app.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.security import is_default_admin_password, is_default_jwt_secret
from app.db.session import dispose_engine
from app.ingestion.bulk_writers import (
    get_flow_event_writer,
    get_futures_tick_writer,
    get_liquidity_snapshot_writer,
    get_options_trade_writer,
)
from app.ingestion.databento_eod_oi import run_eod_oi_ingestion
from app.ingestion.databento_globex import get_globex_live_ingester
from app.ingestion.databento_historical import (
    run_historical_backfill,
    run_historical_quotes_backfill,
)
from app.ingestion.databento_live import get_live_ingester
from app.ingestion.writer import get_writer
from app.processing.pipeline import run_pipeline_for_symbol
from app.processing.scheduler import start_scheduler

logger = get_logger(__name__)


def _testing_mode() -> bool:
    return os.getenv("PYTEST_CURRENT_TEST") is not None or os.getenv("APP_TESTING") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    _install_uvicorn_log_redaction()

    # ── Production guardrails ────────────────────────────────────────────
    # In non-test mode, refuse to boot with default ADMIN_PASSWORD or
    # JWT_SECRET. The bundled defaults are safe for local dev only —
    # leaving them in place on a publicly reachable instance is a
    # critical vulnerability, so we fail closed.
    if not _testing_mode():
        if is_default_admin_password(settings.admin_password):
            raise RuntimeError(
                "ADMIN_PASSWORD is unset or default; refusing to start in production mode"
            )
        if is_default_jwt_secret(settings.jwt_secret):
            raise RuntimeError(
                "JWT_SECRET is unset or default; refusing to start in production mode"
            )
        if (
            settings.public_session_jwt_secret
            and is_default_jwt_secret(settings.public_session_jwt_secret)
        ):
            logger.warning(
                "WARNING_DEFAULT_PUBLIC_SESSION_JWT_SECRET",
                detail=(
                    "PUBLIC_SESSION_JWT_SECRET matches a known default. "
                    "Rotate it before exposing the public site."
                ),
            )

    logger.info("startup", supported_symbols=settings.supported_symbols)

    background_tasks: list[asyncio.Task] = []
    scheduler = None

    if not _testing_mode():
        # Periodic flush of the in-memory writers (one per table).
        writer = get_writer()
        background_tasks.append(
            asyncio.create_task(writer.periodic_flush_loop(), name="writer_flush")
        )
        for w in (
            get_futures_tick_writer(),
            get_options_trade_writer(),
            get_flow_event_writer(),
            get_liquidity_snapshot_writer(),
        ):
            background_tasks.append(
                asyncio.create_task(
                    w.periodic_flush_loop(),
                    name=f"writer_flush_{w.model.__tablename__}",
                )
            )

        # Best-effort historical backfill (graceful no-op if API key missing).
        # Phase 1: contract definitions (strike/expiry/type per instrument_id).
        # Phase 2: cmbp-1 NBBO snapshot for the most recent close — gives the
        # pipeline real bid/ask so /last-close has computable metrics.
        registry: dict = {}
        try:
            registry = await run_historical_backfill()
        except Exception:  # noqa: BLE001
            logger.exception("historical_backfill_unhandled_error")
        try:
            await run_historical_quotes_backfill(registry)
        except Exception:  # noqa: BLE001
            logger.exception("historical_quotes_backfill_unhandled_error")

        # Pull EOD Open Interest so walls/GEX have real weights even when
        # live OI hasn't landed yet. Best-effort — diagnostics live in
        # ``databento_eod_oi`` so a silent zero-result is loud in the log.
        try:
            inserted_oi = await run_eod_oi_ingestion()
            logger.info("eod_oi_startup_done", rows=inserted_oi)
        except Exception:  # noqa: BLE001
            logger.exception("eod_oi_startup_error")

        # Force a single pipeline tick per supported symbol so the dashboard
        # has computed_metrics rows immediately even when the RTH gate is
        # off. Without this, /last-close would be empty until the scheduler
        # fires (which can be 60s+ later or skipped entirely off-hours).
        # Wrapped per-symbol so one failure can't kill startup.
        for symbol in settings.supported_symbols:
            try:
                result = await run_pipeline_for_symbol(symbol)
                logger.info(
                    "startup_pipeline_tick_done",
                    symbol=symbol,
                    has_result=result is not None,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "startup_pipeline_tick_error", symbol=symbol
                )

        # Live ingestion (graceful no-op if API key missing).
        try:
            get_live_ingester().start()
        except Exception:  # noqa: BLE001
            logger.exception("live_ingestion_start_failed")
        try:
            get_globex_live_ingester().start()
        except Exception:  # noqa: BLE001
            logger.exception("globex_live_start_failed")

        # 60s compute scheduler.
        try:
            scheduler = start_scheduler()
        except Exception:  # noqa: BLE001
            logger.exception("scheduler_start_failed")

    try:
        yield
    finally:
        logger.info("shutdown")
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
            except Exception:  # noqa: BLE001
                logger.exception("scheduler_shutdown_error")
        try:
            await get_live_ingester().stop()
        except Exception:  # noqa: BLE001
            logger.exception("live_ingester_stop_error")
        try:
            await get_globex_live_ingester().stop()
        except Exception:  # noqa: BLE001
            logger.exception("globex_ingester_stop_error")
        for t in background_tasks:
            t.cancel()
        for t in background_tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        try:
            await get_writer().flush()
        except Exception:  # noqa: BLE001
            logger.exception("final_flush_error")
        for w in (
            get_futures_tick_writer(),
            get_options_trade_writer(),
            get_flow_event_writer(),
            get_liquidity_snapshot_writer(),
        ):
            try:
                await w.flush()
            except Exception:  # noqa: BLE001
                logger.exception("final_bulk_flush_error", table=w.model.__tablename__)
        await dispose_engine()


class _SecurityHeadersMiddleware:
    """Inject conservative security headers on every HTTP response.

    Implemented as a pure-ASGI middleware (not Starlette's
    ``BaseHTTPMiddleware``) so it composes cleanly with httpx
    ``ASGITransport`` under tests — the same constraint that already
    keeps SlowAPI's middleware out of this app.

    Headers are only added when the underlying response did not already
    set them, so per-route overrides keep working.
    """

    _BASE_HEADERS: tuple[tuple[bytes, bytes], ...] = (
        (
            b"strict-transport-security",
            b"max-age=63072000; includeSubDomains; preload",
        ),
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"x-frame-options", b"DENY"),
        (
            b"permissions-policy",
            b"camera=(), microphone=(), geolocation=(), interest-cohort=()",
        ),
    )

    # Tight CSP for the HTML surfaces FastAPI renders itself
    # (``/docs``, ``/redoc``). The JSON API itself does not execute
    # script in a browser context, but those Swagger / ReDoc pages do —
    # so we lock script + style to self + the well-known CDNs that
    # FastAPI serves from, and disable plugins / framing entirely. JSON
    # responses get a stricter "deny everything" CSP because they should
    # never be interpreted as an HTML document.
    _HTML_CSP: bytes = (
        b"default-src 'self'; "
        b"script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        b"style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        b"img-src 'self' data: https://fastapi.tiangolo.com; "
        b"font-src 'self' data: https://cdn.jsdelivr.net; "
        b"connect-src 'self'; "
        b"frame-ancestors 'none'; "
        b"object-src 'none'; "
        b"base-uri 'self'"
    )
    _JSON_CSP: bytes = (
        b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                for k, v in self._BASE_HEADERS:
                    if k not in existing:
                        headers.append((k, v))
                if b"content-security-policy" not in existing:
                    content_type = b""
                    for k, v in headers:
                        if k.lower() == b"content-type":
                            content_type = v.lower()
                            break
                    if b"text/html" in content_type:
                        headers.append(
                            (b"content-security-policy", self._HTML_CSP)
                        )
                    else:
                        headers.append(
                            (b"content-security-policy", self._JSON_CSP)
                        )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


# ── Log redaction ────────────────────────────────────────────────────────────
#
# SSE / WebSocket auth tokens are passed in the query string because
# EventSource / browser WebSocket clients cannot set custom headers.
# Uvicorn's default access logger writes the full request line (including
# the query string) to stdout, which would expose those tokens to anyone
# who can read container logs. We install a logging filter on the
# uvicorn loggers that scrubs ``token=...`` and ``key=...`` query
# parameters before the line reaches a handler.

_SENSITIVE_QUERY_KEYS = (
    "token",
    "key",
    "code",
    "state",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "password",
    "client_secret",
    "bot_token",
)
_REDACTED = "REDACTED"
_QUERY_REDACT_RE = re.compile(
    r"([?&](?:" + "|".join(_SENSITIVE_QUERY_KEYS) + r")=)[^&\s\"]+",
    re.IGNORECASE,
)
_AUTH_HEADER_RE = re.compile(
    r"(authorization\s*:\s*\S+\s+)\S+", re.IGNORECASE
)


def _redact(value: str) -> str:
    value = _QUERY_REDACT_RE.sub(rf"\1{_REDACTED}", value)
    value = _AUTH_HEADER_RE.sub(rf"\1{_REDACTED}", value)
    return value


class _RedactSensitiveQueryFilter(logging.Filter):
    """Strip auth tokens out of stdlib log records before emission.

    Targeted at uvicorn's access logger but safe to attach broadly: the
    filter only rewrites the formatted message and known string args, so
    structured (``structlog``) records pass through unchanged.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        try:
            if isinstance(record.msg, str):
                record.msg = _redact(record.msg)
            if record.args:
                if isinstance(record.args, tuple):
                    record.args = tuple(
                        _redact(a) if isinstance(a, str) else a
                        for a in record.args
                    )
                elif isinstance(record.args, dict):
                    record.args = {
                        k: (_redact(v) if isinstance(v, str) else v)
                        for k, v in record.args.items()
                    }
        except Exception:  # noqa: BLE001 - never let the filter break logging
            return True
        return True


def _install_uvicorn_log_redaction() -> None:
    """Attach :class:`_RedactSensitiveQueryFilter` to the relevant loggers."""
    redact = _RedactSensitiveQueryFilter()
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", ""):
        target = logging.getLogger(name)
        # Avoid stacking duplicate filters across reloads.
        if not any(isinstance(f, _RedactSensitiveQueryFilter) for f in target.filters):
            target.addFilter(redact)


def create_app() -> FastAPI:
    settings = get_settings()
    docs_enabled = settings.enable_openapi_docs
    app = FastAPI(
        title="Options Flow Analytics Platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
    # Note: we deliberately do NOT add SlowAPIMiddleware. It is based on
    # Starlette's BaseHTTPMiddleware which is incompatible with httpx
    # ASGITransport + anyio task groups. The @limiter.limit decorators on
    # individual routes still enforce limits; the middleware only adds extra
    # response headers we don't depend on.
    cors_origins = settings.cors_origin_list or ["*"]
    use_wildcard = "*" in cors_origins
    app.add_middleware(
        CORSMiddleware,
        # Wildcard is honoured for local dev (the default config keeps
        # the existing behaviour), but production deployments should
        # set ``PUBLIC_CORS_ORIGINS`` / ``ADMIN_CORS_ORIGINS`` to
        # explicit origins. ``allow_credentials`` MUST be False whenever
        # the origin list is wildcard — browsers refuse the combination.
        allow_origins=cors_origins,
        allow_credentials=not use_wildcard,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-API-Key"],
        expose_headers=["Content-Type", "Cache-Control"],
        max_age=600,
    )
    # GZip compression for any response >= 1KB. Snapshot / inspector
    # payloads are routinely 5–50 KB JSON and compress to a fraction of
    # that, dramatically reducing bandwidth on the public Cloudflare
    # tunnel and improving TTFB for browser clients. Streaming
    # (text/event-stream) responses already set ``Cache-Control: no-cache``
    # and Starlette's GZipMiddleware skips them by virtue of the
    # incremental body iterator.
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    # Lightweight security-headers middleware. Pure ASGI (not
    # BaseHTTPMiddleware) so it stays compatible with httpx + anyio task
    # groups under tests. Defense-in-depth: even though the public site
    # also injects these via Vercel for its own surface, the API itself
    # serves error pages and OpenAPI docs that benefit from the same
    # baseline guarantees.
    app.add_middleware(_SecurityHeadersMiddleware)

    app.include_router(health.router)
    # Agent 5 streaming surface — registered BEFORE the broader data router so
    # the comprehensive snapshot in ``snapshot.py`` takes precedence over the
    # narrower legacy ``/v1/{symbol}/snapshot`` route registered by
    # ``data.py``. Route order matters: Starlette matches in declaration order.
    app.include_router(snapshot.router)
    app.include_router(stream.router)
    app.include_router(stream_ticket.router)
    app.include_router(flow.router)
    app.include_router(hiro.router)
    app.include_router(data.router)
    app.include_router(admin.router)
    app.include_router(inspector.router)
    # Rev 5 — public-site surface (Discord OAuth + session-JWT data routes).
    app.include_router(public_auth.router)
    app.include_router(public_data.router)
    return app


def _rate_limit_handler(request, exc: RateLimitExceeded):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


app = create_app()
