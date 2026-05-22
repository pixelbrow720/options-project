"""Public health endpoint."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_db
from app.processing.scheduler import get_pipeline_state

logger = get_logger(__name__)

router = APIRouter()

# A live feed is "connected" when its most recent record was within this
# window. 5 minutes accommodates GLBX micro-gaps + brief OPRA reconnects
# without flapping. Outside RTH the feeds are silent by design — callers
# should interpret False during off-hours as "expected".
_LIVE_FEED_FRESH_SECONDS = 5 * 60


def _is_recent(ts_iso: str | None, *, max_age_seconds: int) -> bool:
    if not ts_iso:
        return False
    try:
        ts = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
    except ValueError:
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return (datetime.now(UTC) - ts) <= timedelta(seconds=max_age_seconds)


@router.get("/health")
async def health(
    response: Response,
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Operational health probe.

    Always returns HTTP 200 with a JSON body so naïve uptime checks
    (e.g. Cloudflare health monitors) treat the service as reachable;
    callers that need a deeper signal can inspect the boolean fields
    (``db_connected``, ``live_opra_connected``, etc.). Failures of any
    individual probe never propagate as 5xx — the body is the contract.
    """
    settings = get_settings()
    state = get_pipeline_state()

    # ── Fast PG ping. Single round-trip; cap per-call budget by relying on
    # the pool's pre_ping + the underlying asyncpg timeout.
    db_connected = False
    try:
        await session.execute(text("SELECT 1"))
        db_connected = True
    except Exception:  # noqa: BLE001
        # The probe may legitimately fail during pool exhaustion or DB
        # restart; we surface that via the boolean rather than blowing up.
        logger.warning("health.db_ping_failed")

    # ── Live ingester freshness ──────────────────────────────────────────
    live_opra_connected = False
    live_globex_connected = False
    try:
        from app.ingestion.databento_live import get_live_ingester

        opra_diag = get_live_ingester().diagnostics()
        live_opra_connected = _is_recent(
            opra_diag.get("last_record_at"),
            max_age_seconds=_LIVE_FEED_FRESH_SECONDS,
        )
    except Exception:  # noqa: BLE001
        live_opra_connected = False
    try:
        from app.ingestion.databento_globex import get_globex_live_ingester

        globex_diag = get_globex_live_ingester().diagnostics()
        live_globex_connected = _is_recent(
            globex_diag.get("last_record_at"),
            max_age_seconds=_LIVE_FEED_FRESH_SECONDS,
        )
    except Exception:  # noqa: BLE001
        live_globex_connected = False

    # ── Pipeline state ───────────────────────────────────────────────────
    pipeline_running = bool(state.last_run)

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "ok",
        "now": datetime.now(UTC).isoformat(),
        "supported_symbols": settings.supported_symbols,
        "compute_interval_seconds": settings.compute_interval_seconds,
        "last_compute_per_symbol": {
            sym: ts.isoformat() if ts else None for sym, ts in state.last_run.items()
        },
        "db_connected": db_connected,
        "live_opra_connected": live_opra_connected,
        "live_globex_connected": live_globex_connected,
        "pipeline_running": pipeline_running,
    }
