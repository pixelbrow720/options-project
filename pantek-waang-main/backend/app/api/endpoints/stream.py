"""Realtime streaming endpoints (Agent 5 — streaming API).

Two transports backed by the same in-process :mod:`stream_notifier`:

* ``WS  /v1/{symbol}/stream``      — preferred; bi-directional, low-overhead.
* ``GET /v1/{symbol}/stream/sse``  — Server-Sent Events fallback for
  environments that strip WebSocket upgrades (corporate proxies, etc.).

Both push a JSON frame whose ``data`` field matches the payload returned by
``/v1/{symbol}/snapshot``. Frames land on subscribers within milliseconds of
the chain pipeline calling :func:`stream_notifier.publish` at the end of
``run_pipeline_for_symbol``.

Authentication mirrors the REST API: a valid ``X-API-Key`` (header or
``?key=`` query param for WS clients that cannot set custom headers) bound to
the requested ``symbol`` is required.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    Path,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.snapshot import build_snapshot_payload
from app.api.stream_notifier import get_stream_notifier
from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import verify_api_key
from app.db.models import ApiKey
from app.db.session import get_session_factory

logger = get_logger(__name__)

router = APIRouter()


_SYMBOL_PATTERN = r"^[A-Z][A-Z0-9]{0,11}$"

# Heartbeat cadence: corporate proxies typically drop idle WS connections
# after 30–60 s. 25 s leaves comfortable margin without flooding.
HEARTBEAT_INTERVAL_SECONDS: float = 25.0

# How often _pump wakes up to recheck whether the API key (or session,
# for the public stream) has been revoked since connect. Doubles as the
# upper bound on get-from-queue blocking — picked so revocation lands
# within ~30s of an admin action without flooding the DB.
REVOCATION_CHECK_INTERVAL_SECONDS: float = 30.0

# Custom close code emitted when an active connection is severed because
# the underlying credential was revoked mid-stream. RFC 6455 reserves
# 4000–4999 for application use.
WS_REVOKED_CODE: int = 4401


# ── Per-key WS connection accounting ────────────────────────────────────────


_ws_connections_per_key: dict[str, int] = defaultdict(int)
_ws_lock = asyncio.Lock()


async def _ws_try_register(api_key_id: str) -> bool:
    """Atomically reserve a WS slot for ``api_key_id``.

    Returns ``True`` when the new connection fits under
    ``Settings.max_ws_connections_per_key``, ``False`` otherwise.
    """
    cap = get_settings().max_ws_connections_per_key
    async with _ws_lock:
        if _ws_connections_per_key[api_key_id] >= cap:
            return False
        _ws_connections_per_key[api_key_id] += 1
        return True


async def _ws_release(api_key_id: str) -> None:
    async with _ws_lock:
        current = _ws_connections_per_key.get(api_key_id, 0)
        if current <= 1:
            _ws_connections_per_key.pop(api_key_id, None)
        else:
            _ws_connections_per_key[api_key_id] = current - 1


def ws_connection_count(api_key_id: str) -> int:
    """Test helper: introspect the per-key counter."""
    return _ws_connections_per_key.get(api_key_id, 0)


def reset_ws_state_for_tests() -> None:
    """Test helper: clear all per-key accounting."""
    _ws_connections_per_key.clear()


# ── Authentication helpers ──────────────────────────────────────────────────


async def _authenticate_streaming_key(
    api_key: str | None, symbol: str, session: AsyncSession
) -> ApiKey | None:
    """Validate ``api_key`` against the DB and ``symbol``'s ACL.

    Returns the :class:`ApiKey` row on success, ``None`` on any failure. We
    intentionally return ``None`` rather than raising so the WS handler can
    pick the close code; the SSE handler uses the standard FastAPI dependency
    and raises a 401 automatically.
    """
    if not api_key:
        return None
    prefix = api_key[:11]
    rows = (
        await session.execute(select(ApiKey).where(ApiKey.key_prefix == prefix))
    ).scalars().all()
    matched: ApiKey | None = None
    for candidate in rows:
        if verify_api_key(api_key, candidate.key_hash):
            matched = candidate
            break
    if matched is None or not matched.is_active:
        return None
    if matched.expires_at is not None:
        expires_at = matched.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            return None
    sym_u = symbol.upper()
    if sym_u not in [s.upper() for s in (matched.allowed_symbols or [])]:
        return None
    return matched


# ── Wire format ─────────────────────────────────────────────────────────────


def _frame(symbol: str, computed_at: datetime | None, data: dict[str, Any]) -> dict[str, Any]:
    """Serialise a snapshot payload as the WS/SSE wire frame."""
    return {
        "symbol": symbol.upper(),
        "computed_at": computed_at.isoformat() if computed_at is not None else None,
        "data": data,
    }


def _published_frame(sym_u: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Normalise a payload pushed via :func:`stream_notifier.publish`."""
    computed_at = payload.get("computed_at")
    if isinstance(computed_at, datetime):
        computed_at = computed_at.isoformat()
    data = payload.get("data", payload)
    return {"symbol": sym_u, "computed_at": computed_at, "data": data}


def _sse_event(payload: dict[str, Any], event: str | None = None) -> str:
    """Encode ``payload`` as one SSE event."""
    body = json.dumps(payload, default=str)
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {body}\n\n"


# ── WebSocket endpoint ──────────────────────────────────────────────────────


@router.websocket("/v1/{symbol}/stream")
async def stream_ws(
    websocket: WebSocket,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    key: str | None = Query(default=None),
) -> None:
    """Push a JSON frame whenever the pipeline completes a cycle for ``symbol``.

    Auth (in priority order):
      * ``X-API-Key`` header — works for non-browser clients that can
        set custom headers on the upgrade.
      * ``?key=...`` query param — fallback for browser WebSocket clients
        that cannot set custom headers.

    Close codes:
    * ``1008`` (policy violation) — missing / invalid auth, symbol ACL
      miss, or per-key connection cap exceeded.
    * ``4401`` (custom) — auth was valid at connect but the underlying
      API key has been deactivated or expired mid-stream.
    """
    sym_u = symbol.upper()
    factory = get_session_factory()

    api_key_value = websocket.headers.get("x-api-key") or key
    async with factory() as session:
        api_key_row = await _authenticate_streaming_key(
            api_key_value, sym_u, session
        )

    if api_key_row is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    api_key_id = str(api_key_row.id)
    registered = await _ws_try_register(api_key_id)
    if not registered:
        # Accept-then-close so the client can read the policy-violation code
        # rather than seeing a generic handshake failure.
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Subscribe BEFORE accepting so a notifier failure cleanly releases the
    # slot without leaving an accepted-but-unpumped socket. We wrap the
    # subscribe + accept in try/except so any exception releases the slot
    # before propagating.
    notifier = get_stream_notifier()
    try:
        queue = notifier.subscribe(sym_u)
    except Exception:  # noqa: BLE001
        await _ws_release(api_key_id)
        logger.exception("stream_ws_subscribe_failed", symbol=sym_u)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        await websocket.accept()
    except Exception:  # noqa: BLE001
        notifier.unsubscribe(sym_u, queue)
        await _ws_release(api_key_id)
        raise

    async def _send_json(payload: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(payload, default=str))

    # Prime the connection with the latest snapshot so subscribers don't have
    # to wait a full pipeline cycle to see data.
    try:
        async with factory() as session:
            initial_payload, computed_at = await build_snapshot_payload(session, sym_u)
        await _send_json(_frame(sym_u, computed_at, initial_payload))
    except Exception:  # noqa: BLE001 - best-effort prime
        logger.exception("stream_ws_initial_snapshot_failed", symbol=sym_u)

    async def _heartbeat() -> None:
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                await _send_json(
                    {"type": "heartbeat", "ts": datetime.now(UTC).isoformat()}
                )
        except (WebSocketDisconnect, RuntimeError, ConnectionError):
            return

    async def _is_revoked() -> bool:
        """Return True if the API key has been deactivated/expired."""
        try:
            async with factory() as session:
                row = await session.get(ApiKey, api_key_row.id)
        except Exception:  # noqa: BLE001 - DB blip should not kick the client
            logger.exception("stream_ws_revocation_check_failed", symbol=sym_u)
            return False
        if row is None or not row.is_active:
            return True
        if row.expires_at is not None:
            expires_at = row.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at < datetime.now(UTC):
                return True
        return False

    async def _pump() -> None:
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(
                        queue.get(), timeout=REVOCATION_CHECK_INTERVAL_SECONDS
                    )
                except TimeoutError:
                    if await _is_revoked():
                        try:
                            await websocket.close(code=WS_REVOKED_CODE)
                        except (RuntimeError, ConnectionError):
                            pass
                        return
                    continue
                await _send_json(_published_frame(sym_u, payload))
        except (WebSocketDisconnect, RuntimeError, ConnectionError):
            return

    pump_task = asyncio.create_task(_pump(), name=f"ws_pump:{sym_u}")
    heartbeat_task = asyncio.create_task(_heartbeat(), name=f"ws_hb:{sym_u}")

    try:
        while True:
            # Block until the client disconnects; ``receive_text`` raises
            # ``WebSocketDisconnect`` when the peer closes.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("stream_ws_error", symbol=sym_u)
    finally:
        for t in (pump_task, heartbeat_task):
            t.cancel()
        for t in (pump_task, heartbeat_task):
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        notifier.unsubscribe(sym_u, queue)
        await _ws_release(api_key_id)


# ── Server-Sent Events fallback ─────────────────────────────────────────────


@router.get("/v1/{symbol}/stream/sse")
async def stream_sse(
    request: Request,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    key: str | None = Query(default=None),
) -> StreamingResponse:
    """Server-Sent Events fallback for clients that cannot use WebSockets.

    Auth (in priority order):
      * ``X-API-Key`` header — works for non-browser clients.
      * ``?key=...`` query param — fallback for browser ``EventSource``
        clients that cannot set custom headers (mirrors the WS endpoint).
    """
    sym_u = symbol.upper()

    api_key_value = request.headers.get("x-api-key") or key
    factory = get_session_factory()
    async with factory() as session:
        api_key_row = await _authenticate_streaming_key(
            api_key_value, sym_u, session
        )
    if api_key_row is None:
        raise HTTPException(status_code=401, detail="invalid_api_key")

    notifier = get_stream_notifier()
    queue = notifier.subscribe(sym_u)

    async def _is_revoked(api_key_id: Any) -> bool:
        """Return True if the API key has been deactivated/expired."""
        try:
            async with factory() as session:
                row = await session.get(ApiKey, api_key_id)
        except Exception:  # noqa: BLE001 - DB blip should not kick the client
            logger.exception("stream_sse_revocation_check_failed", symbol=sym_u)
            return False
        if row is None or not row.is_active:
            return True
        if row.expires_at is not None:
            expires_at = row.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at < datetime.now(UTC):
                return True
        return False

    async def _stream() -> Any:
        try:
            # Prime with the latest snapshot.
            try:
                async with factory() as session:
                    payload, computed_at = await build_snapshot_payload(session, sym_u)
                yield _sse_event(_frame(sym_u, computed_at, payload))
            except Exception:  # noqa: BLE001
                logger.exception("stream_sse_initial_snapshot_failed", symbol=sym_u)

            while True:
                try:
                    queued = await asyncio.wait_for(
                        queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS
                    )
                except TimeoutError:
                    if await _is_revoked(api_key_row.id):
                        break
                    yield _sse_event(
                        {"type": "heartbeat", "ts": datetime.now(UTC).isoformat()},
                        event="heartbeat",
                    )
                    continue
                yield _sse_event(_published_frame(sym_u, queued))
        finally:
            notifier.unsubscribe(sym_u, queue)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
