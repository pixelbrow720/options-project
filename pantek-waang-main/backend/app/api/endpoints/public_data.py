"""Rev 5 — public-site data endpoints (session-JWT authenticated).

Thin wrappers around the existing data-fetching helpers in
``snapshot.py``, ``data.py``, and ``stream.py``. The only difference vs.
the ``/v1/...`` surface is the auth: callers present a Bearer
``user_sessions`` JWT instead of an ``X-API-Key`` header. Symbol ACLs
still come from the bridged ``api_keys`` row, so the operator only has
one place to configure access.

Endpoints
---------
* ``GET /public/{symbol}/snapshot``       — full snapshot (alias of /v1).
* ``GET /public/{symbol}/0dte``           — curated 0DTE / spot view.
* ``GET /public/{symbol}/futures-levels`` — futures-coordinate levels.
* ``GET /public/{symbol}/spot``           — standalone spot resolution.
* ``GET /public/{symbol}/last-close``     — freshest persisted snapshot,
  bypassing the RTH gate. Used by the public dashboard when the market
  is closed so users still see a meaningful screen.
* ``WS  /public/{symbol}/stream``         — same as the WS stream but
  authenticated via ``?token=<session-jwt>`` query param (browsers
  cannot set custom headers on the WS upgrade).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

import jwt
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, asc, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_user_symbol_access
from app.api.endpoints.snapshot import build_snapshot_payload
from app.api.endpoints.stream import (
    HEARTBEAT_INTERVAL_SECONDS,
    REVOCATION_CHECK_INTERVAL_SECONDS,
    WS_REVOKED_CODE,
    _frame,
    _published_frame,
    _ws_release,
    _ws_try_register,
)
from app.api.endpoints.stream_ticket import get_ticket_store
from app.api.schemas import DataEnvelope
from app.api.stream_notifier import get_stream_notifier
from app.api.tick_notifier import get_tick_notifier
from app.config import get_settings
from app.core.logging import get_logger
from app.core.security import (
    PUBLIC_SESSION_TOKEN_TYPE,
    decode_public_session_token,
)
from app.db.models import (
    ApiKey,
    ComputedMetric,
    FlowEvent,
    OptionsChain,
    User,
    UserSession,
)
from app.db.session import get_db, get_session_factory
from app.processing.futures_levels import build_futures_levels
from app.processing.session import (
    is_rth_now,
    next_business_day,
    session_open_today,
    session_snapshot,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/public", tags=["public-data"])

_SYMBOL_PATTERN = r"^[A-Z][A-Z0-9]{0,11}$"

# Public data endpoints serve read-only computed metrics that the
# pipeline refreshes every ``compute_interval_seconds`` (default 60s).
# A 15s cache + 30s stale-while-revalidate window is safe — clients
# never see data older than the next pipeline tick, and intermediate
# CDN caches (Cloudflare) absorb most of the burst.
_PUBLIC_CACHE_CONTROL = "public, max-age=15, stale-while-revalidate=30"
_NO_STORE = "no-store"


def _apply_public_cache_headers(response: Response) -> None:
    response.headers["Cache-Control"] = _PUBLIC_CACHE_CONTROL


def _apply_no_store_headers(response: Response) -> None:
    response.headers["Cache-Control"] = _NO_STORE


def _envelope(symbol: str, computed_at: datetime | None, data: dict[str, Any]) -> DataEnvelope:
    settings = get_settings()
    next_in = settings.compute_interval_seconds
    if computed_at is not None:
        elapsed = (datetime.now(UTC) - computed_at).total_seconds()
        next_in = max(0, int(settings.compute_interval_seconds - elapsed))
    return DataEnvelope(
        symbol=symbol.upper(),
        computed_at=computed_at,
        next_update_in_seconds=next_in,
        data=data,
    )


def _ensure_supported(symbol: str) -> str:
    sym = symbol.upper()
    if sym not in [s.upper() for s in get_settings().supported_symbols]:
        raise HTTPException(status_code=404, detail=f"Unsupported symbol {sym}")
    return sym


# ── Snapshot / 0DTE / spot / futures-levels (REST) ───────────────────────────


@router.get("/{symbol}/snapshot", response_model=DataEnvelope)
async def public_snapshot(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)
    payload, computed_at = await build_snapshot_payload(session, sym)
    _apply_public_cache_headers(response)
    return _envelope(symbol, computed_at, payload)


@router.get("/{symbol}/0dte", response_model=DataEnvelope)
async def public_zero_dte(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)
    full, computed_at = await build_snapshot_payload(session, sym)
    payload: dict[str, Any] = {
        "session_state": full.get("session_state"),
        "spot": full.get("spot"),
        "zero_dte": full.get("zero_dte"),
        "back_month": full.get("back_month"),
        "pin_probability": full.get("pin_probability"),
        "move_tracker": full.get("move_tracker"),
    }
    _apply_public_cache_headers(response)
    return _envelope(symbol, computed_at, payload)


@router.get("/{symbol}/spot", response_model=DataEnvelope)
async def public_spot(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)
    full, computed_at = await build_snapshot_payload(session, sym)
    payload = {
        "session_state": full.get("session_state"),
        "spot": full.get("spot"),
    }
    _apply_public_cache_headers(response)
    return _envelope(symbol, computed_at, payload)


@router.get("/{symbol}/futures-levels", response_model=DataEnvelope)
async def public_futures_levels(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    from dataclasses import asdict

    from app.api.endpoints.data import _latest_metrics, _walls_payload

    sym = _ensure_supported(symbol)

    spot_rows = await _latest_metrics(session, sym, "SPOT")
    spot_extra: dict[str, Any] | None = None
    spot_value: float | None = None
    spot_ts: datetime | None = None
    if spot_rows:
        r = spot_rows[0]
        spot_extra = dict(r.extra_json or {})
        spot_value = float(r.value) if r.value is not None else None
        spot_ts = r.ts

    gex_vol_rows = await _latest_metrics(session, sym, "GEX_NET_TOTAL_VOL")
    gex_oi_rows = await _latest_metrics(session, sym, "GEX_NET_TOTAL")
    gex_extra = dict(gex_vol_rows[0].extra_json or {}) if gex_vol_rows else None
    gex_oi_extra = dict(gex_oi_rows[0].extra_json or {}) if gex_oi_rows else None

    gex_0dte_vol_rows = await _latest_metrics(session, sym, "GEX_0DTE_NET_TOTAL_VOL")
    zero_dte_gex_extra = (
        dict(gex_0dte_vol_rows[0].extra_json or {}) if gex_0dte_vol_rows else None
    )

    mp_agg_rows = await _latest_metrics(session, sym, "MAX_PAIN_AGG")
    max_pain_aggregate: dict[str, Any] | None = None
    if mp_agg_rows:
        r = mp_agg_rows[0]
        max_pain_aggregate = {
            "strike": float(r.strike),
            "value": float(r.value or 0.0),
        }

    walls_oi_bundle = await _walls_payload(session, sym, "oi")
    walls_oi_payload = walls_oi_bundle.get("payload") or {}

    snapshot = build_futures_levels(
        cash_symbol=sym,
        spot_extra=spot_extra,
        spot_value=spot_value,
        spot_ts=spot_ts,
        gex_extra=gex_extra,
        gex_oi_extra=gex_oi_extra,
        walls_oi=walls_oi_payload,
        max_pain_aggregate=max_pain_aggregate,
        zero_dte_gex_extra=zero_dte_gex_extra,
    )

    candidates: list[datetime] = []
    for rows in (
        spot_rows, gex_vol_rows, gex_oi_rows, gex_0dte_vol_rows, mp_agg_rows,
    ):
        for r in rows:
            if r.ts is not None:
                candidates.append(r.ts)
    walls_ts = walls_oi_bundle.get("computed_at")
    if walls_ts is not None:
        candidates.append(walls_ts)
    computed_at = max(candidates, default=None) if candidates else None

    _apply_public_cache_headers(response)
    return _envelope(symbol, computed_at, asdict(snapshot))


# ── Last-close (no RTH gate) ─────────────────────────────────────────────────


@router.get("/{symbol}/last-close", response_model=DataEnvelope)
async def public_last_close(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """Return the freshest persisted snapshot, regardless of staleness.

    The regular ``/snapshot`` returns the latest persisted metrics too,
    but consumers expect that to be "live during RTH". This endpoint is
    explicit: it exists to serve a meaningful screen when the market is
    closed (weekends, off-hours), so the front-end can render a
    "last-close" banner with the age of the data and a countdown to the
    next session open.
    """
    sym = _ensure_supported(symbol)

    # Latest computed_metrics ts where the chain produced a real
    # snapshot — using GEX_NET_TOTAL as the canonical "the chain
    # processed" marker.
    latest_ts = (
        await session.execute(
            select(ComputedMetric.ts)
            .where(
                ComputedMetric.symbol == sym,
                ComputedMetric.metric_type == "GEX_NET_TOTAL",
            )
            .order_by(desc(ComputedMetric.ts))
            .limit(1)
        )
    ).scalar_one_or_none()

    payload, computed_at = await build_snapshot_payload(session, sym)
    if computed_at is None:
        computed_at = latest_ts

    now = datetime.now(UTC)
    hours_old: float | None = None
    if computed_at is not None:
        ts = computed_at if computed_at.tzinfo is not None else computed_at.replace(tzinfo=UTC)
        hours_old = max(0.0, (now - ts).total_seconds() / 3600.0)

    # Compute next session-open. If market is currently open we still
    # report it — front-end uses this to render countdowns.
    session_state = session_snapshot(symbol=sym)
    market_open_iso: str | None = None
    market_open_in_seconds: int | None = None
    if not is_rth_now():
        # If today's open already passed (after-hours), use the next
        # business day's open; otherwise today's open.
        today_open = session_open_today()
        if now >= today_open:
            target_day = next_business_day()
            target_open = today_open.replace(
                year=target_day.year, month=target_day.month, day=target_day.day
            )
        else:
            target_open = today_open
        market_open_iso = target_open.isoformat()
        market_open_in_seconds = max(
            0, int((target_open - now).total_seconds())
        )

    body = {
        "computed_at": computed_at.isoformat() if computed_at else None,
        "hours_old": round(hours_old, 4) if hours_old is not None else None,
        "data": payload,
        "session_state": session_state,
        "market_open_in_seconds": market_open_in_seconds,
        "market_open_iso": market_open_iso,
    }
    _apply_public_cache_headers(response)
    return _envelope(symbol, computed_at, body)


# ── Intraday / dealer / flow / pin / migration (Rev 5+) ─────────────────────
#
# These endpoints back the public dashboard's drilldown views. They all
# read directly from ``computed_metrics`` (and ``flow_events``) using the
# same patterns as ``_latest_metrics`` in ``data.py`` — but with our own
# ``factory()`` session so we can wrap heavy queries in try/except and
# degrade gracefully (return empty data with HTTP 200) instead of 500ing
# when a downstream table is empty or missing rows.


def _downsample(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    """Return at most ``max_points`` items, evenly spaced by index."""
    if max_points <= 0 or len(rows) <= max_points:
        return rows
    step = len(rows) / max_points
    out: list[dict[str, Any]] = []
    i = 0.0
    while int(i) < len(rows) and len(out) < max_points:
        out.append(rows[int(i)])
        i += step
    return out


async def _series_for_metric(
    session: AsyncSession,
    sym: str,
    metric_type: str,
    since: datetime,
    *,
    extra_key: str | None = None,
) -> list[dict[str, Any]]:
    """Pull a (ts, value) series for ``metric_type`` since ``since``.

    When ``extra_key`` is provided we read from ``extra_json[extra_key]``
    instead of ``value`` — used for the zero-gamma series, which lives
    inside the ``GEX_NET_TOTAL`` aggregate row's ``extra_json``.
    """
    stmt = (
        select(ComputedMetric.ts, ComputedMetric.value, ComputedMetric.extra_json)
        .where(
            ComputedMetric.symbol == sym,
            ComputedMetric.metric_type == metric_type,
            ComputedMetric.strike == 0,
            ComputedMetric.ts >= since,
        )
        .order_by(asc(ComputedMetric.ts))
    )
    rows = (await session.execute(stmt)).all()
    out: list[dict[str, Any]] = []
    for ts, value, extra in rows:
        if extra_key is not None:
            extra_dict = extra or {}
            v = extra_dict.get(extra_key)
            if v is None:
                continue
            try:
                out.append({"ts": ts, "value": float(v)})
            except (TypeError, ValueError):
                continue
        else:
            if value is None:
                continue
            out.append({"ts": ts, "value": float(value)})
    return out


@router.get("/{symbol}/intraday", response_model=DataEnvelope)
async def public_intraday(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    hours: int = Query(6, ge=1, le=12),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)
    since = datetime.now(UTC) - timedelta(hours=hours)

    factory = get_session_factory()
    series_keys = (
        ("spot_series", "SPOT", None),
        ("gex_net_series", "GEX_NET_TOTAL", None),
        ("gex_0dte_net_series", "GEX_0DTE_NET_TOTAL", None),
        ("charm_decay_series", "CHARM_0DTE_DECAY_RATE", None),
        ("flip_speed_series", "GEX_0DTE_FLIP_SPEED", None),
        ("zero_gamma_series", "GEX_NET_TOTAL", "zero_gamma"),
    )

    payload: dict[str, list[dict[str, Any]]] = {k: [] for k, _, _ in series_keys}
    latest_ts: datetime | None = None
    try:
        async with factory() as s:
            for key, metric_type, extra_key in series_keys:
                try:
                    series = await _series_for_metric(
                        s, sym, metric_type, since, extra_key=extra_key
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "public_intraday_series_failed",
                        symbol=sym,
                        metric_type=metric_type,
                    )
                    series = []
                series = _downsample(series, 200)
                payload[key] = [
                    {
                        "ts": r["ts"].isoformat() if isinstance(r["ts"], datetime) else r["ts"],
                        "value": r["value"],
                    }
                    for r in series
                ]
                if series:
                    last = series[-1]["ts"]
                    if isinstance(last, datetime):
                        if latest_ts is None or last > latest_ts:
                            latest_ts = last
    except Exception:  # noqa: BLE001
        logger.exception("public_intraday_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/dealer-positioning", response_model=DataEnvelope)
async def public_dealer_positioning(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    today = datetime.now(UTC).date()
    payload: dict[str, Any] = {
        "expiry": today.isoformat(),
        "spot": None,
        "strikes": [],
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            # Latest GEX_LEVEL rows for the symbol. The pipeline writes
            # GEX_LEVEL with a sentinel ``expiration`` (1970-01-01) — the
            # 0DTE-specific cohort lives under ``GEX_0DTE_LEVEL``. Prefer
            # the 0DTE cohort if present; otherwise fall back to the
            # full-chain ``GEX_LEVEL`` aggregate.
            chosen_metric = "GEX_0DTE_LEVEL"
            latest_ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == chosen_metric,
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(latest_ts_q)).scalar_one_or_none()
            if ts is None:
                chosen_metric = "GEX_LEVEL"
                latest_ts_q = (
                    select(ComputedMetric.ts)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == chosen_metric,
                    )
                    .order_by(desc(ComputedMetric.ts))
                    .limit(1)
                )
                ts = (await s.execute(latest_ts_q)).scalar_one_or_none()
            latest_ts = ts

            strikes_payload: list[dict[str, Any]] = []
            spot_value: float | None = None
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == chosen_metric,
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.strike))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                for r in rows:
                    extra = r.extra_json or {}
                    # Prefer explicit ``dealer_gamma`` if persisted, else
                    # derive from the standard call/put split. The pipeline
                    # writes ``net_gex = call_gex - |put_gex|`` (long
                    # gamma when calls dominate). The dealer is short the
                    # customer position, so dealer_gamma = -net_gex when
                    # the convention is "customer gamma".
                    dealer_gamma_raw = extra.get("dealer_gamma")
                    if dealer_gamma_raw is None:
                        net_gex = extra.get("net_gex")
                        if net_gex is None and r.value is not None:
                            net_gex = float(r.value)
                        dealer_gamma_raw = -float(net_gex) if net_gex is not None else 0.0
                    try:
                        dealer_gamma = float(dealer_gamma_raw)
                    except (TypeError, ValueError):
                        dealer_gamma = 0.0
                    if dealer_gamma > 0:
                        side = "long"
                    elif dealer_gamma < 0:
                        side = "short"
                    else:
                        side = "neutral"
                    strikes_payload.append(
                        {
                            "strike": float(r.strike),
                            "dealer_gamma": dealer_gamma,
                            "side": side,
                        }
                    )

            # Spot — read latest ``SPOT`` row.
            spot_q = (
                select(ComputedMetric.value, ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "SPOT",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            spot_row = (await s.execute(spot_q)).first()
            if spot_row is not None and spot_row[0] is not None:
                try:
                    spot_value = float(spot_row[0])
                except (TypeError, ValueError):
                    spot_value = None
                if latest_ts is None:
                    latest_ts = spot_row[1]

            payload["spot"] = spot_value
            payload["strikes"] = strikes_payload
    except Exception:  # noqa: BLE001
        logger.exception("public_dealer_positioning_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/flow", response_model=DataEnvelope)
async def public_flow(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    hours: int = Query(6, ge=1, le=24),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    since = datetime.now(UTC) - timedelta(hours=hours)
    payload: dict[str, Any] = {
        "cumulative_call_premium": 0.0,
        "cumulative_put_premium": 0.0,
        "net_premium": 0.0,
        "series": [],
        "top_blocks": [],
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            stmt = (
                select(FlowEvent)
                .where(FlowEvent.symbol == sym, FlowEvent.ts >= since)
                .order_by(asc(FlowEvent.ts))
            )
            events = list((await s.execute(stmt)).scalars().all())

            # Bucket into 1-minute slots so the front-end gets a smooth
            # series without us having to send thousands of events.
            buckets: dict[datetime, dict[str, float]] = defaultdict(
                lambda: {"call_prem": 0.0, "put_prem": 0.0}
            )
            cum_call = 0.0
            cum_put = 0.0
            blocks: list[dict[str, Any]] = []
            for ev in events:
                meta = ev.meta or {}
                premium_raw = meta.get("premium")
                if premium_raw is None and ev.price is not None:
                    try:
                        premium_raw = float(ev.price) * float(ev.size or 0) * 100.0
                    except (TypeError, ValueError):
                        premium_raw = 0.0
                try:
                    premium = float(premium_raw or 0.0)
                except (TypeError, ValueError):
                    premium = 0.0

                ts = ev.ts
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=UTC)
                bucket_ts = ts.replace(second=0, microsecond=0)
                if ev.option_type == "C":
                    buckets[bucket_ts]["call_prem"] += premium
                    cum_call += premium
                elif ev.option_type == "P":
                    buckets[bucket_ts]["put_prem"] += premium
                    cum_put += premium

                if ev.event_type == "BLOCK":
                    blocks.append(
                        {
                            "ts": ts.isoformat(),
                            "size": int(ev.size or 0),
                            "premium": premium,
                            "type": ev.event_type,
                            "side": ev.option_type,
                            "strike": float(ev.strike) if ev.strike is not None else None,
                        }
                    )

                if latest_ts is None or ts > latest_ts:
                    latest_ts = ts

            series = [
                {
                    "ts": bucket_ts.isoformat(),
                    "call_prem": values["call_prem"],
                    "put_prem": values["put_prem"],
                    "net": values["call_prem"] - values["put_prem"],
                }
                for bucket_ts, values in sorted(buckets.items())
            ]
            blocks.sort(key=lambda b: b["premium"], reverse=True)
            payload.update(
                {
                    "cumulative_call_premium": cum_call,
                    "cumulative_put_premium": cum_put,
                    "net_premium": cum_call - cum_put,
                    "series": series,
                    "top_blocks": blocks[:10],
                }
            )
    except Exception:  # noqa: BLE001
        logger.exception("public_flow_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/pin-risk", response_model=DataEnvelope)
async def public_pin_risk(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    today = datetime.now(UTC).date()
    payload: dict[str, Any] = {
        "spot": None,
        "expiry": today.isoformat(),
        "strikes": [],
        "top_pin": None,
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            latest_ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "PIN_PROBABILITY",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(latest_ts_q)).scalar_one_or_none()
            latest_ts = ts

            strikes: list[dict[str, Any]] = []
            top_pin: dict[str, Any] | None = None
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == "PIN_PROBABILITY",
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.strike))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                best_prob = -1.0
                for r in rows:
                    extra = r.extra_json or {}
                    prob = float(r.value or 0.0)
                    entry = {
                        "strike": float(r.strike),
                        "probability": prob,
                        "oi": extra.get("oi"),
                    }
                    strikes.append(entry)
                    if prob > best_prob:
                        best_prob = prob
                        top_pin = {"strike": entry["strike"], "probability": prob}

            spot_q = (
                select(ComputedMetric.value)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "SPOT",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            spot_value = (await s.execute(spot_q)).scalar_one_or_none()
            try:
                payload["spot"] = float(spot_value) if spot_value is not None else None
            except (TypeError, ValueError):
                payload["spot"] = None
            payload["strikes"] = strikes
            payload["top_pin"] = top_pin
    except Exception:  # noqa: BLE001
        logger.exception("public_pin_risk_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


async def _wall_snapshot_at(
    s: AsyncSession,
    sym: str,
    metric_type: str,
    *,
    at_or_before: datetime | None = None,
) -> tuple[datetime | None, list[dict[str, Any]]]:
    """Return (ts, top-3 rank rows) for ``metric_type``.

    When ``at_or_before`` is None, returns the most recent snapshot.
    Otherwise returns the latest snapshot whose ts is <= the cutoff.
    """
    ts_q = select(ComputedMetric.ts).where(
        ComputedMetric.symbol == sym,
        ComputedMetric.metric_type == metric_type,
    )
    if at_or_before is not None:
        ts_q = ts_q.where(ComputedMetric.ts <= at_or_before)
    ts_q = ts_q.order_by(desc(ComputedMetric.ts)).limit(1)
    ts = (await s.execute(ts_q)).scalar_one_or_none()
    if ts is None:
        return None, []
    rows_q = select(ComputedMetric).where(
        ComputedMetric.symbol == sym,
        ComputedMetric.metric_type == metric_type,
        ComputedMetric.ts == ts,
    )
    rows = list((await s.execute(rows_q)).scalars().all())
    entries = [
        {
            "strike": float(r.strike),
            "rank": int((r.extra_json or {}).get("rank", 0)),
            "value": float(r.value or 0.0),
        }
        for r in rows
    ]
    entries.sort(key=lambda e: e["rank"] or 999)
    return ts, entries[:3]


@router.get("/{symbol}/migration", response_model=DataEnvelope)
async def public_migration(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    one_hour_ago = datetime.now(UTC) - timedelta(hours=1)
    payload: dict[str, list[dict[str, Any]]] = {
        "call_walls_now": [],
        "call_walls_1h_ago": [],
        "put_walls_now": [],
        "put_walls_1h_ago": [],
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            call_now_ts, call_now = await _wall_snapshot_at(s, sym, "CALL_WALL_OI")
            call_old_ts, call_old = await _wall_snapshot_at(
                s, sym, "CALL_WALL_OI", at_or_before=one_hour_ago
            )
            put_now_ts, put_now = await _wall_snapshot_at(s, sym, "PUT_WALL_OI")
            put_old_ts, put_old = await _wall_snapshot_at(
                s, sym, "PUT_WALL_OI", at_or_before=one_hour_ago
            )

            payload["call_walls_now"] = call_now
            payload["call_walls_1h_ago"] = call_old or call_now
            payload["put_walls_now"] = put_now
            payload["put_walls_1h_ago"] = put_old or put_now

            for cand in (call_now_ts, put_now_ts):
                if cand is not None and (latest_ts is None or cand > latest_ts):
                    latest_ts = cand
    except Exception:  # noqa: BLE001
        logger.exception("public_migration_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


# ── SpotGamma/GEXBot-style endpoints (Rev 5+) ───────────────────────────────
#
# These endpoints expose the same metrics that already power the dashboard
# but in shapes that mirror SpotGamma/GEXBot conventions, so a third-party
# consumer can drop them into a familiar UI. Every handler returns 200 OK
# with empty/null payloads when the underlying tables are empty so the
# front-end can render a friendly placeholder instead of an error toast.


async def _latest_spot(s: AsyncSession, sym: str) -> tuple[float | None, datetime | None]:
    """Return the most recent ``(spot_price, ts)`` for ``sym`` or ``(None, None)``."""
    spot_q = (
        select(ComputedMetric.value, ComputedMetric.ts)
        .where(
            ComputedMetric.symbol == sym,
            ComputedMetric.metric_type == "SPOT",
        )
        .order_by(desc(ComputedMetric.ts))
        .limit(1)
    )
    row = (await s.execute(spot_q)).first()
    if row is None:
        return None, None
    try:
        return (float(row[0]) if row[0] is not None else None), row[1]
    except (TypeError, ValueError):
        return None, row[1]


@router.get("/{symbol}/hiro", response_model=DataEnvelope)
async def public_hiro(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    hours: int = Query(1, ge=1, le=24),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """HIRO cumulative signed-premium series.

    Reads ``computed_metrics`` rows where ``metric_type='HIRO'`` for the
    last ``hours`` hours. Each row is one persisted bucket — we expose
    ``call_premium`` / ``put_premium`` / ``net_signed`` from
    ``extra_json`` when present, falling back to the row ``value`` for
    the cumulative figure.

    Trend is derived from the slope of the last 10 minutes of data: a
    rising cumulative is bullish, falling is bearish, flat is neutral.
    """
    sym = _ensure_supported(symbol)
    since = datetime.now(UTC) - timedelta(hours=hours)

    factory = get_session_factory()
    series: list[dict[str, Any]] = []
    latest_ts: datetime | None = None
    current_cumulative = 0.0
    current_signed = 0.0
    trend = "neutral"

    try:
        async with factory() as s:
            stmt = (
                select(
                    ComputedMetric.ts,
                    ComputedMetric.value,
                    ComputedMetric.extra_json,
                )
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "HIRO",
                    ComputedMetric.ts >= since,
                )
                .order_by(asc(ComputedMetric.ts))
            )
            rows = (await s.execute(stmt)).all()
            running_cum = 0.0
            for ts, value, extra in rows:
                extra_d = extra or {}
                call_prem = extra_d.get("call_premium")
                put_prem = extra_d.get("put_premium")
                net_signed = extra_d.get("net_signed") or extra_d.get("net_premium")
                cumulative = extra_d.get("cumulative")
                if cumulative is None:
                    if value is not None:
                        try:
                            cumulative = float(value)
                        except (TypeError, ValueError):
                            cumulative = running_cum
                    else:
                        cumulative = running_cum
                try:
                    cumulative_f = float(cumulative)
                except (TypeError, ValueError):
                    cumulative_f = running_cum
                running_cum = cumulative_f

                def _f(x: Any) -> float | None:
                    if x is None:
                        return None
                    try:
                        return float(x)
                    except (TypeError, ValueError):
                        return None

                series.append(
                    {
                        "ts": ts.isoformat() if isinstance(ts, datetime) else ts,
                        "cumulative": cumulative_f,
                        "call_premium": _f(call_prem),
                        "put_premium": _f(put_prem),
                        "net_signed": _f(net_signed),
                    }
                )
                if isinstance(ts, datetime) and (latest_ts is None or ts > latest_ts):
                    latest_ts = ts

            if series:
                current_cumulative = float(series[-1]["cumulative"] or 0.0)
                current_signed = float(series[-1].get("net_signed") or 0.0)

                # Trend: slope over the last ~10 minutes. We don't assume a
                # fixed bucket size — we walk back until we cover ≥10
                # minutes of data, then compare endpoints.
                last_ts = series[-1]["ts"]
                try:
                    last_dt = datetime.fromisoformat(last_ts) if isinstance(last_ts, str) else last_ts
                except ValueError:
                    last_dt = None
                if last_dt is not None:
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=UTC)
                    cutoff = last_dt - timedelta(minutes=10)
                    head: dict[str, Any] | None = None
                    for entry in series:
                        try:
                            entry_dt = (
                                datetime.fromisoformat(entry["ts"])
                                if isinstance(entry["ts"], str)
                                else entry["ts"]
                            )
                        except ValueError:
                            continue
                        if entry_dt.tzinfo is None:
                            entry_dt = entry_dt.replace(tzinfo=UTC)
                        if entry_dt >= cutoff:
                            head = entry
                            break
                    if head is not None:
                        slope = current_cumulative - float(head.get("cumulative") or 0.0)
                        # Use a small tolerance relative to magnitude so a
                        # tiny wobble doesn't flip the label.
                        eps = max(1.0, abs(current_cumulative) * 0.001)
                        if slope > eps:
                            trend = "bullish"
                        elif slope < -eps:
                            trend = "bearish"
                        else:
                            trend = "neutral"
    except Exception:  # noqa: BLE001
        logger.exception("public_hiro_failed", symbol=sym)

    payload = {
        "series": series,
        "current_cumulative": current_cumulative,
        "current_signed": current_signed,
        "trend": trend,
    }
    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/chain", response_model=DataEnvelope)
async def public_chain(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    expiry: str | None = Query(default=None),
    strike_min: float | None = Query(default=None),
    strike_max: float | None = Query(default=None),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """Full options chain for a single expiry, latest snapshot per contract.

    Defaults: ``expiry`` = today (0DTE). ``strike_min`` / ``strike_max``
    default to spot ±10%. Up to 500 rows returned, grouped by strike with
    both ``call`` and ``put`` legs nested under each strike.

    The underlying ``options_chain`` table is a Timescale hypertable with
    one row per (ts, symbol, expiration, strike, option_type). We pick
    the latest ``ts`` per contract via a window query.
    """
    sym = _ensure_supported(symbol)

    # Parse expiry — default to today (UTC) when omitted.
    target_expiry: date | None = None
    if expiry:
        try:
            target_expiry = date.fromisoformat(expiry)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="expiry must be YYYY-MM-DD",
            ) from exc
    else:
        target_expiry = datetime.now(UTC).date()

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "expiry": target_expiry.isoformat(),
        "spot": None,
        "rows": [],
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            spot_value, spot_ts = await _latest_spot(s, sym)
            payload["spot"] = spot_value

            # Resolve strike window — explicit args win, else ±10% of spot.
            lo = strike_min
            hi = strike_max
            if (lo is None or hi is None) and spot_value is not None:
                if lo is None:
                    lo = spot_value * 0.90
                if hi is None:
                    hi = spot_value * 1.10

            # Latest ts per (strike, option_type) for the requested expiry.
            # We pull rows since the most recent global ts for this expiry
            # and dedupe in Python — Timescale handles the hot index well
            # and the resultset is bounded by the chain width.
            top_ts_q = (
                select(func.max(OptionsChain.ts))
                .where(
                    OptionsChain.symbol == sym,
                    OptionsChain.expiration == target_expiry,
                )
            )
            top_ts = (await s.execute(top_ts_q)).scalar_one_or_none()

            rows_payload: list[OptionsChain] = []
            if top_ts is not None:
                latest_ts = top_ts
                # Pull rows from a short window ending at top_ts so we get
                # near-coincident snapshots for every contract. 5 minutes
                # is well above the ingestion cadence and well below any
                # meaningful chain drift.
                window_start = top_ts - timedelta(minutes=5)
                conds = [
                    OptionsChain.symbol == sym,
                    OptionsChain.expiration == target_expiry,
                    OptionsChain.ts >= window_start,
                    OptionsChain.ts <= top_ts,
                ]
                if lo is not None:
                    conds.append(OptionsChain.strike >= lo)
                if hi is not None:
                    conds.append(OptionsChain.strike <= hi)
                rows_q = (
                    select(OptionsChain)
                    .where(and_(*conds))
                    .order_by(asc(OptionsChain.strike), desc(OptionsChain.ts))
                    .limit(2000)
                )
                rows_payload = list((await s.execute(rows_q)).scalars().all())

            # Dedupe to the latest row per (strike, option_type), then
            # group into call/put pairs sorted by strike asc.
            seen: dict[tuple[float, str], OptionsChain] = {}
            for r in rows_payload:
                key = (float(r.strike), r.option_type)
                prev = seen.get(key)
                if prev is None or r.ts > prev.ts:
                    seen[key] = r

            grouped: dict[float, dict[str, dict[str, Any]]] = {}
            for (strike, opt_type), r in seen.items():
                leg = {
                    "bid": float(r.bid) if r.bid is not None else None,
                    "ask": float(r.ask) if r.ask is not None else None,
                    "last": float(r.last_price) if r.last_price is not None else None,
                    "volume": int(r.volume) if r.volume is not None else None,
                    "oi": int(r.oi) if r.oi is not None else None,
                    "iv": float(r.iv) if r.iv is not None else None,
                    "delta": float(r.delta) if r.delta is not None else None,
                    "gamma": float(r.gamma) if r.gamma is not None else None,
                    # OptionsChain doesn't persist vanna/charm per-row —
                    # surface as None so the front-end can show "—".
                    "vanna": None,
                    "charm": None,
                }
                slot = grouped.setdefault(strike, {})
                slot["call" if opt_type == "C" else "put"] = leg

            rows_out = [
                {
                    "strike": strike,
                    "call": legs.get("call"),
                    "put": legs.get("put"),
                }
                for strike, legs in sorted(grouped.items())
            ]
            payload["rows"] = rows_out[:500]
            if spot_ts is not None and (latest_ts is None or spot_ts > latest_ts):
                latest_ts = spot_ts
    except Exception:  # noqa: BLE001
        logger.exception("public_chain_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/vol-trigger", response_model=DataEnvelope)
async def public_vol_trigger(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """The "Volatility Trigger" — strike below which dealers flip short gamma.

    Computed from the latest ``GEX_LEVEL`` snapshot:
      1. Walk strikes ascending and accumulate ``net_gex``.
      2. The cumulative crosses zero — when descending from spot, the
         first strike *below* spot at which cumulative gamma turns
         negative is the trigger. Below it, dealer gamma is short and
         volatility tends to expand; above it, dealer gamma is long and
         volatility tends to compress.

    When data is unavailable the endpoint returns ``vol_trigger=None``
    with ``regime="stable"`` so the UI can render a placeholder.
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "vol_trigger": None,
        "spot": None,
        "distance_pts": None,
        "distance_pct": None,
        "below_trigger": False,
        "regime": "stable",
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            spot_value, spot_ts = await _latest_spot(s, sym)
            payload["spot"] = spot_value

            # Latest GEX_LEVEL snapshot.
            ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "GEX_LEVEL",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(ts_q)).scalar_one_or_none()
            latest_ts = ts

            trigger: float | None = None
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == "GEX_LEVEL",
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.strike))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                # Ascending cumulative gamma curve.
                strikes_curve: list[tuple[float, float]] = []
                cum = 0.0
                for r in rows:
                    extra = r.extra_json or {}
                    net_gex_raw = extra.get("net_gex")
                    if net_gex_raw is None and r.value is not None:
                        net_gex_raw = float(r.value)
                    try:
                        net_gex = float(net_gex_raw or 0.0)
                    except (TypeError, ValueError):
                        net_gex = 0.0
                    cum += net_gex
                    strikes_curve.append((float(r.strike), cum))

                # Walk *down* from spot — the first strike at or below
                # spot whose cumulative gamma is negative is the
                # trigger. If no spot is known we fall back to the
                # zero-cross of the cumulative curve.
                if strikes_curve:
                    if spot_value is not None:
                        below = [
                            (k, c) for k, c in strikes_curve if k <= spot_value
                        ]
                        # Descending — most recent crossing nearest spot.
                        for k, c in reversed(below):
                            if c < 0:
                                trigger = k
                                break
                        if trigger is None:
                            # No negative crossing below spot — use the
                            # lowest strike where cumulative is closest
                            # to zero from above as a soft trigger.
                            if below:
                                trigger = min(below, key=lambda kc: abs(kc[1]))[0]
                    else:
                        # Without spot, locate the first sign change on
                        # the ascending curve.
                        for i in range(1, len(strikes_curve)):
                            prev = strikes_curve[i - 1][1]
                            cur = strikes_curve[i][1]
                            if prev > 0 >= cur:
                                trigger = strikes_curve[i][0]
                                break

            payload["vol_trigger"] = trigger
            if trigger is not None and spot_value is not None:
                dist = spot_value - trigger
                payload["distance_pts"] = float(dist)
                payload["distance_pct"] = (
                    float(dist / spot_value * 100.0) if spot_value else None
                )
                below = spot_value < trigger
                payload["below_trigger"] = bool(below)
                payload["regime"] = "vol_expansion" if below else "stable"
            if spot_ts is not None and (latest_ts is None or spot_ts > latest_ts):
                latest_ts = spot_ts
    except Exception:  # noqa: BLE001
        logger.exception("public_vol_trigger_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/absolute-gamma", response_model=DataEnvelope)
async def public_absolute_gamma(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """Absolute-gamma profile for support/resistance detection.

    Takes the latest ``GEX_LEVEL`` snapshot, computes ``abs(net_gex)``
    per strike, and returns the top 50 strikes within ±5% of spot. Also
    returns the top-5 "walls" by absolute gamma — these are the strikes
    where dealers are most likely to defend.
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "spot": None,
        "strikes": [],
        "top_5_walls": [],
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            spot_value, spot_ts = await _latest_spot(s, sym)
            payload["spot"] = spot_value

            ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "GEX_LEVEL",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(ts_q)).scalar_one_or_none()
            latest_ts = ts

            entries: list[dict[str, Any]] = []
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == "GEX_LEVEL",
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.strike))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                for r in rows:
                    extra = r.extra_json or {}
                    net_gex_raw = extra.get("net_gex")
                    if net_gex_raw is None and r.value is not None:
                        net_gex_raw = float(r.value)
                    try:
                        net_gex = float(net_gex_raw or 0.0)
                    except (TypeError, ValueError):
                        net_gex = 0.0
                    entries.append(
                        {
                            "strike": float(r.strike),
                            "abs_gamma": abs(net_gex),
                            "net_gamma": net_gex,
                        }
                    )

            # Filter to ±5% of spot if known, else keep all.
            if spot_value is not None:
                lo = spot_value * 0.95
                hi = spot_value * 1.05
                window = [e for e in entries if lo <= e["strike"] <= hi]
            else:
                window = entries

            # Sort by strike asc and cap to 50 around spot. If we have
            # more than 50, prefer the ones nearest spot.
            if spot_value is not None and len(window) > 50:
                window = sorted(window, key=lambda e: abs(e["strike"] - spot_value))[:50]
                window.sort(key=lambda e: e["strike"])
            else:
                window = sorted(window, key=lambda e: e["strike"])[:50]

            top_walls = sorted(entries, key=lambda e: e["abs_gamma"], reverse=True)[:5]
            payload["strikes"] = window
            payload["top_5_walls"] = top_walls
            if spot_ts is not None and (latest_ts is None or spot_ts > latest_ts):
                latest_ts = spot_ts
    except Exception:  # noqa: BLE001
        logger.exception("public_absolute_gamma_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/skew", response_model=DataEnvelope)
async def public_skew(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """IV skew curve across the nearest 8 expiries.

    Each row of ``IV_SKEW`` is one expiration with a scalar skew. We
    label rows by DTE (``0DTE`` / ``1D`` / ``ND`` / ``MMMDD``) so the
    front-end can render the curve without re-deriving labels. The
    25-delta risk reversal for the nearest expiry is included as
    ``current_25d_rr`` for callers that want a single-number summary.
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "by_expiry": [],
        "current_25d_rr": None,
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "IV_SKEW",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(ts_q)).scalar_one_or_none()
            latest_ts = ts

            today = datetime.now(UTC).date()
            entries: list[dict[str, Any]] = []
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == "IV_SKEW",
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.expiration))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                for r in rows:
                    if r.expiration is None:
                        continue
                    try:
                        dte = (r.expiration - today).days
                    except TypeError:
                        dte = None
                    if dte is None:
                        label = str(r.expiration)
                    elif dte <= 0:
                        label = "0DTE"
                    elif dte <= 7:
                        label = f"{dte}D"
                    else:
                        label = r.expiration.strftime("%b%d")
                    entries.append(
                        {
                            "expiry": str(r.expiration),
                            "skew": float(r.value or 0.0),
                            "label": label,
                            "dte": dte,
                        }
                    )

            # Take the 8 nearest expiries by DTE (forward-looking only,
            # but include 0DTE rows where dte == 0 / -1).
            future = [e for e in entries if e.get("dte") is None or e["dte"] >= -1]
            future.sort(key=lambda e: (e.get("dte") if e.get("dte") is not None else 9999))
            payload["by_expiry"] = future[:8]

            # 25d RR for the nearest expiry (if persisted).
            rr_q = (
                select(ComputedMetric)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "RISK_REVERSAL_25D",
                )
                .order_by(asc(ComputedMetric.expiration))
                .limit(1)
            )
            rr_row = (await s.execute(rr_q)).scalar_one_or_none()
            if rr_row is not None and rr_row.value is not None:
                try:
                    payload["current_25d_rr"] = float(rr_row.value)
                except (TypeError, ValueError):
                    payload["current_25d_rr"] = None
    except Exception:  # noqa: BLE001
        logger.exception("public_skew_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/term-structure", response_model=DataEnvelope)
async def public_term_structure(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """ATM IV by days-to-expiry.

    ``IV_TERM_STRUCTURE`` rows persist one entry per expiration with the
    ATM IV in ``value`` and the rest of the term-structure context in
    ``extra_json``. ``is_inverted`` flags the case where 0DTE IV exceeds
    the 30D IV — a classic "front-end stress" signal.
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "points": [],
        "is_inverted": False,
        "front_back_spread": None,
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            ts_q = (
                select(ComputedMetric.ts)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "IV_TERM_STRUCTURE",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            ts = (await s.execute(ts_q)).scalar_one_or_none()
            latest_ts = ts

            today = datetime.now(UTC).date()
            points: list[dict[str, Any]] = []
            if ts is not None:
                rows_q = (
                    select(ComputedMetric)
                    .where(
                        ComputedMetric.symbol == sym,
                        ComputedMetric.metric_type == "IV_TERM_STRUCTURE",
                        ComputedMetric.ts == ts,
                    )
                    .order_by(asc(ComputedMetric.expiration))
                )
                rows = list((await s.execute(rows_q)).scalars().all())
                for r in rows:
                    if r.expiration is None:
                        continue
                    try:
                        dte = (r.expiration - today).days
                    except TypeError:
                        dte = None
                    iv_val: float | None
                    if r.value is not None:
                        try:
                            iv_val = float(r.value)
                        except (TypeError, ValueError):
                            iv_val = None
                    else:
                        iv_val = None
                    if iv_val is None:
                        # Some pipelines stuff atm_iv into extra_json instead.
                        extra = r.extra_json or {}
                        try:
                            iv_val = float(extra.get("atm_iv")) if extra.get("atm_iv") is not None else None
                        except (TypeError, ValueError):
                            iv_val = None
                    points.append(
                        {
                            "dte": dte if dte is not None else 0,
                            "iv": iv_val,
                            "expiry": str(r.expiration),
                        }
                    )
                points.sort(key=lambda p: p["dte"])

            payload["points"] = points
            # Front (0DTE or smallest non-negative) vs ~30D.
            front = next(
                (p for p in points if p["iv"] is not None and p["dte"] >= 0),
                None,
            )
            back = None
            if points:
                # Closest to 30D among rows with iv set.
                with_iv = [p for p in points if p["iv"] is not None]
                if with_iv:
                    back = min(with_iv, key=lambda p: abs(p["dte"] - 30))
            if front is not None and back is not None and front is not back:
                spread = float(front["iv"] - back["iv"])
                payload["front_back_spread"] = spread
                payload["is_inverted"] = bool(spread > 0)
    except Exception:  # noqa: BLE001
        logger.exception("public_term_structure_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/move-tracker", response_model=DataEnvelope)
async def public_move_tracker(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """Realized vs implied move tracker.

    Pulls the latest ``MOVE_TRACKER`` row. ``regime`` is derived from the
    realized/implied ratio:
      * ``compressed`` — realized has used <60% of the implied move (range day).
      * ``in_range``  — realized is between 60% and 110% of implied.
      * ``expanded``  — realized has burst above 110% (trend day / vol expansion).
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "implied_move": None,
        "realized_move": None,
        "ratio": None,
        "regime": "in_range",
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            row_q = (
                select(ComputedMetric)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "MOVE_TRACKER",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            row = (await s.execute(row_q)).scalar_one_or_none()
            if row is not None:
                latest_ts = row.ts
                extra = row.extra_json or {}

                def _f(k: str) -> float | None:
                    v = extra.get(k)
                    if v is None:
                        return None
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return None

                implied_move = _f("implied_move")
                realized_move = _f("realized_move")
                ratio = _f("ratio")
                if ratio is None and row.value is not None:
                    try:
                        ratio = float(row.value)
                    except (TypeError, ValueError):
                        ratio = None
                if ratio is None and implied_move and realized_move is not None:
                    ratio = realized_move / implied_move if implied_move else None

                if ratio is None:
                    regime = "in_range"
                elif ratio < 0.60:
                    regime = "compressed"
                elif ratio > 1.10:
                    regime = "expanded"
                else:
                    regime = "in_range"

                payload.update(
                    {
                        "implied_move": implied_move,
                        "realized_move": realized_move,
                        "ratio": ratio,
                        "regime": regime,
                    }
                )
    except Exception:  # noqa: BLE001
        logger.exception("public_move_tracker_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


@router.get("/{symbol}/regime", response_model=DataEnvelope)
async def public_regime(
    response: Response,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    _auth: tuple[User, ApiKey] = Depends(require_user_symbol_access()),
) -> DataEnvelope:
    """Combined regime indicator: GEX × Vol × Flow.

    * ``gex_regime`` — ``positive`` / ``negative`` / ``neutral`` from
      ``REGIME_OI`` (label + signed score).
    * ``vol_regime`` — ``high`` / ``low`` derived from the front IV in
      ``IV_TERM_STRUCTURE`` (>25% → high, <15% → low, else medium).
    * ``flow_regime`` — derived from the slope of the trailing 10-min
      HIRO cumulative (same convention as ``/hiro``).
    """
    sym = _ensure_supported(symbol)

    factory = get_session_factory()
    payload: dict[str, Any] = {
        "gex_regime": "neutral",
        "gex_score": 0.0,
        "vol_regime": "low",
        "flow_regime": "neutral",
        "summary": "",
        "narrative": "",
    }
    latest_ts: datetime | None = None

    try:
        async with factory() as s:
            # GEX regime — REGIME_OI is the canonical "long/short gamma" view.
            gex_q = (
                select(ComputedMetric)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "REGIME_OI",
                )
                .order_by(desc(ComputedMetric.ts))
                .limit(1)
            )
            gex_row = (await s.execute(gex_q)).scalar_one_or_none()
            gex_score = 0.0
            gex_label = "neutral"
            if gex_row is not None:
                latest_ts = gex_row.ts
                try:
                    gex_score = float(gex_row.value or 0.0)
                except (TypeError, ValueError):
                    gex_score = 0.0
                extra = gex_row.extra_json or {}
                # Pipeline persists a textual label; prefer it but fall back
                # to a sign-based bucket so the API is still useful when the
                # pipeline schema drifts.
                raw_label = str(extra.get("label", "")).lower()
                if raw_label in {"positive", "long", "long_gamma", "bullish"}:
                    gex_label = "positive"
                elif raw_label in {"negative", "short", "short_gamma", "bearish"}:
                    gex_label = "negative"
                elif gex_score > 0.10:
                    gex_label = "positive"
                elif gex_score < -0.10:
                    gex_label = "negative"
                else:
                    gex_label = "neutral"

            # Vol regime — front IV on the term structure.
            vol_q = (
                select(ComputedMetric)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "IV_TERM_STRUCTURE",
                )
                .order_by(desc(ComputedMetric.ts), asc(ComputedMetric.expiration))
                .limit(1)
            )
            vol_row = (await s.execute(vol_q)).scalar_one_or_none()
            front_iv: float | None = None
            if vol_row is not None:
                if latest_ts is None or (vol_row.ts and vol_row.ts > latest_ts):
                    latest_ts = vol_row.ts
                try:
                    front_iv = (
                        float(vol_row.value) if vol_row.value is not None else None
                    )
                except (TypeError, ValueError):
                    front_iv = None
                if front_iv is None:
                    extra = vol_row.extra_json or {}
                    try:
                        front_iv = float(extra.get("atm_iv")) if extra.get("atm_iv") is not None else None
                    except (TypeError, ValueError):
                        front_iv = None
            if front_iv is None:
                vol_label = "low"
            elif front_iv >= 0.25:
                vol_label = "high"
            elif front_iv <= 0.15:
                vol_label = "low"
            else:
                vol_label = "medium"

            # Flow regime — last 10 min of HIRO cumulative.
            since = datetime.now(UTC) - timedelta(minutes=30)
            hiro_q = (
                select(ComputedMetric.ts, ComputedMetric.value)
                .where(
                    ComputedMetric.symbol == sym,
                    ComputedMetric.metric_type == "HIRO",
                    ComputedMetric.ts >= since,
                )
                .order_by(asc(ComputedMetric.ts))
            )
            hiro_rows = (await s.execute(hiro_q)).all()
            flow_label = "neutral"
            if len(hiro_rows) >= 2:
                last_ts_h = hiro_rows[-1][0]
                if isinstance(last_ts_h, datetime):
                    if last_ts_h.tzinfo is None:
                        last_ts_h = last_ts_h.replace(tzinfo=UTC)
                    cutoff = last_ts_h - timedelta(minutes=10)
                else:
                    cutoff = None
                head_val = float(hiro_rows[0][1] or 0.0)
                if cutoff is not None:
                    for ts_v, val in hiro_rows:
                        ts_norm = ts_v
                        if isinstance(ts_norm, datetime) and ts_norm.tzinfo is None:
                            ts_norm = ts_norm.replace(tzinfo=UTC)
                        if isinstance(ts_norm, datetime) and ts_norm >= cutoff:
                            try:
                                head_val = float(val or 0.0)
                            except (TypeError, ValueError):
                                head_val = 0.0
                            break
                tail_val = float(hiro_rows[-1][1] or 0.0)
                slope = tail_val - head_val
                eps = max(1.0, abs(tail_val) * 0.001)
                if slope > eps:
                    flow_label = "bullish"
                elif slope < -eps:
                    flow_label = "bearish"

            # Narrative — a short, deterministic English summary so the
            # front-end can render a heading without us shipping an LLM.
            gex_phrase = {
                "positive": "Dealers are long gamma — index moves get dampened, vol compressed",
                "negative": "Dealers are short gamma — index moves get amplified, vol expands",
                "neutral": "Dealer gamma is balanced — neutral hedging pressure",
            }[gex_label]
            vol_phrase = {
                "high": "front IV elevated",
                "medium": "front IV moderate",
                "low": "front IV calm",
            }[vol_label]
            flow_phrase = {
                "bullish": "calls bid",
                "bearish": "puts bid",
                "neutral": "two-sided flow",
            }[flow_label]
            summary_label = {
                "positive": "Positive gamma",
                "negative": "Negative gamma",
                "neutral": "Neutral gamma",
            }[gex_label]
            vol_summary = {
                "high": "High vol",
                "medium": "Medium vol",
                "low": "Low vol",
            }[vol_label]
            flow_summary = {
                "bullish": "Bullish flow",
                "bearish": "Bearish flow",
                "neutral": "Neutral flow",
            }[flow_label]
            summary = f"{summary_label} · {vol_summary} · {flow_summary}"
            narrative = (
                f"{gex_phrase}. With {vol_phrase} and {flow_phrase}, "
                f"the regime favours "
                + (
                    "a fade-the-extremes / mean-reversion stance."
                    if gex_label == "positive"
                    else "trend-following / vol-expansion plays."
                    if gex_label == "negative"
                    else "tactical setups around key gamma walls."
                )
            )
            payload.update(
                {
                    "gex_regime": gex_label,
                    "gex_score": gex_score,
                    "vol_regime": vol_label,
                    "flow_regime": flow_label,
                    "summary": summary,
                    "narrative": narrative,
                }
            )
    except Exception:  # noqa: BLE001
        logger.exception("public_regime_failed", symbol=sym)

    _apply_public_cache_headers(response)
    return _envelope(symbol, latest_ts, payload)


# ── WebSocket stream (Bearer via ?token=...) ────────────────────────────────


async def _resolve_session_user(
    token: str, session: AsyncSession
) -> tuple[User, ApiKey] | None:
    """Decode + validate a session JWT and return the (user, api_key) pair."""
    try:
        payload = decode_public_session_token(token)
    except (jwt.InvalidTokenError, Exception):  # noqa: BLE001
        return None
    if payload.get("typ") != PUBLIC_SESSION_TOKEN_TYPE:
        return None

    sid = payload.get("sid")
    sub = payload.get("sub")
    if not sid or not sub:
        return None
    try:
        sid_uuid = uuid.UUID(str(sid))
        user_id = int(sub)
    except (ValueError, TypeError):
        return None

    sess = await session.get(UserSession, sid_uuid)
    if sess is None or sess.revoked:
        return None
    expires_at = sess.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        return None

    user = await session.get(User, user_id)
    if user is None or user.status != "approved":
        return None
    if user.api_key_id is None:
        return None
    api_key = await session.get(ApiKey, user.api_key_id)
    if api_key is None or not api_key.is_active:
        return None
    return user, api_key


@router.websocket("/{symbol}/stream")
async def public_stream_ws(
    websocket: WebSocket,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    token: str | None = Query(default=None),
    ticket: str | None = Query(default=None),
) -> None:
    sym_u = symbol.upper()
    factory = get_session_factory()
    user: User | None = None
    api_key: ApiKey | None = None
    user_session_id: uuid.UUID | None = None

    if ticket:
        principal_id = get_ticket_store().consume(
            ticket, kind="public_session", symbol=sym_u
        )
        if principal_id is not None:
            try:
                user_id = int(principal_id)
            except (ValueError, TypeError):
                user_id = None
            if user_id is not None:
                async with factory() as session:
                    candidate_user = await session.get(User, user_id)
                    if (
                        candidate_user is not None
                        and candidate_user.status == "approved"
                        and candidate_user.api_key_id is not None
                    ):
                        candidate_key = await session.get(
                            ApiKey, candidate_user.api_key_id
                        )
                        if candidate_key is not None and candidate_key.is_active:
                            user = candidate_user
                            api_key = candidate_key

    if user is None or api_key is None:
        if not token:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        logger.warning(
            "public_stream_ws_legacy_token_query_param",
            symbol=sym_u,
            detail="Client used deprecated ?token= query param; migrate to ?ticket=",
        )
        async with factory() as session:
            resolved = await _resolve_session_user(token, session)
        if resolved is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user, api_key = resolved
        # Capture sid from the JWT for mid-stream revocation checks. The
        # session has already been validated above; we just decode again
        # to extract the sid without rerunning the full pipeline.
        try:
            jwt_payload = decode_public_session_token(token)
            sid_raw = jwt_payload.get("sid")
            if sid_raw is not None:
                user_session_id = uuid.UUID(str(sid_raw))
        except (jwt.InvalidTokenError, ValueError, TypeError, Exception):  # noqa: BLE001
            user_session_id = None

    if sym_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Reuse the existing per-key cap so the public + machine surfaces
    # share their connection budget.
    api_key_id = str(api_key.id)
    registered = await _ws_try_register(api_key_id)
    if not registered:
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    notifier = get_stream_notifier()
    try:
        queue = notifier.subscribe(sym_u)
    except Exception:  # noqa: BLE001
        await _ws_release(api_key_id)
        logger.exception("public_stream_ws_subscribe_failed", symbol=sym_u)
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

    try:
        async with factory() as s2:
            initial_payload, computed_at = await build_snapshot_payload(s2, sym_u)
        await _send_json(_frame(sym_u, computed_at, initial_payload))
    except Exception:  # noqa: BLE001 - best-effort prime
        logger.exception("public_stream_ws_initial_snapshot_failed", symbol=sym_u)

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
        """Return True if the API key, user, or session was revoked."""
        try:
            async with factory() as s3:
                fresh_key = await s3.get(ApiKey, api_key.id)
                fresh_user = await s3.get(User, user.id)
                fresh_session = (
                    await s3.get(UserSession, user_session_id)
                    if user_session_id is not None
                    else None
                )
        except Exception:  # noqa: BLE001 - DB blip should not kick the client
            logger.exception(
                "public_stream_ws_revocation_check_failed", symbol=sym_u
            )
            return False
        if fresh_key is None or not fresh_key.is_active:
            return True
        if fresh_key.expires_at is not None:
            expires_at = fresh_key.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at < datetime.now(UTC):
                return True
        if fresh_user is None or fresh_user.status != "approved":
            return True
        if fresh_session is not None and fresh_session.revoked:
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

    pump_task = asyncio.create_task(_pump(), name=f"public_ws_pump:{sym_u}")
    heartbeat_task = asyncio.create_task(_heartbeat(), name=f"public_ws_hb:{sym_u}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("public_stream_ws_error", symbol=sym_u, user_id=user.id)
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


# ── Real-time tick stream (sub-second futures fan-out) ──────────────────────
#
# A SEPARATE channel from the 30s snapshot stream above. Every futures trade
# tick (ES → SPXW, NQ → NDXP) is published to this fan-out so the public
# dashboard can render live spot/futures prices without waiting for the next
# pipeline cycle. Payload shape is intentionally tiny — see ``tick_notifier``.

# Heartbeat cadence for the tick channel. Tighter than the 25s snapshot
# heartbeat because subscribers expect this stream to feel "live" — a 15s
# silence on a quiet tape should still produce a keepalive so proxies do not
# close the connection.
_TICK_HEARTBEAT_INTERVAL_SECONDS: float = 15.0


@router.get("/{symbol}/ticks/sse")
async def public_tick_stream_sse(
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    token: str | None = Query(default=None),
) -> StreamingResponse:
    """Server-Sent Events stream of real-time price ticks.

    Auth mirrors :func:`public_stream_ws`: the session JWT is supplied via
    ``?token=...`` because EventSource (and most WS clients in browsers)
    cannot set custom headers. Symbol ACL enforcement is identical to the
    snapshot WebSocket.

    Response is intentionally uncached (``Cache-Control: no-store``).
    """
    sym_u = symbol.upper()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token"
        )

    factory = get_session_factory()
    async with factory() as session:
        resolved = await _resolve_session_user(token, session)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token"
        )
    user, api_key = resolved

    if sym_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="symbol not allowed"
        )

    notifier = get_tick_notifier()
    queue = notifier.subscribe(sym_u)

    async def _stream() -> Any:
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(
                        queue.get(), timeout=_TICK_HEARTBEAT_INTERVAL_SECONDS
                    )
                except TimeoutError:
                    # SSE comment line — clients ignore it but proxies see
                    # bytes flowing, which is enough to keep the connection
                    # open during quiet periods.
                    yield ": heartbeat\n\n"
                    continue
                yield f"data: {json.dumps(payload, default=str)}\n\n"
        finally:
            notifier.unsubscribe(sym_u, queue)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": _NO_STORE,
            # Disable proxy buffering (nginx) so each tick flushes immediately.
            "X-Accel-Buffering": "no",
        },
    )


@router.websocket("/{symbol}/ticks")
async def public_tick_stream_ws(
    websocket: WebSocket,
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    token: str | None = Query(default=None),
) -> None:
    """WebSocket variant of the real-time tick stream.

    Same auth + ACL pattern as :func:`public_stream_ws`. Subscribes to
    :func:`get_tick_notifier` instead of the 30s snapshot stream. No initial
    prime — the client receives the first tick whenever the next futures
    trade prints.
    """
    sym_u = symbol.upper()
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    factory = get_session_factory()
    async with factory() as session:
        resolved = await _resolve_session_user(token, session)
    if resolved is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user, api_key = resolved

    if sym_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    api_key_id = str(api_key.id)
    registered = await _ws_try_register(api_key_id)
    if not registered:
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    notifier = get_tick_notifier()
    queue = notifier.subscribe(sym_u)

    async def _send_json(payload: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(payload, default=str))

    async def _heartbeat() -> None:
        try:
            while True:
                await asyncio.sleep(_TICK_HEARTBEAT_INTERVAL_SECONDS)
                await _send_json(
                    {"type": "heartbeat", "ts": datetime.now(UTC).isoformat()}
                )
        except (WebSocketDisconnect, RuntimeError, ConnectionError):
            return

    async def _pump() -> None:
        try:
            while True:
                payload = await queue.get()
                await _send_json(payload)
        except (WebSocketDisconnect, RuntimeError, ConnectionError):
            return

    pump_task = asyncio.create_task(_pump(), name=f"public_ticks_pump:{sym_u}")
    heartbeat_task = asyncio.create_task(
        _heartbeat(), name=f"public_ticks_hb:{sym_u}"
    )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception(
            "public_tick_stream_ws_error", symbol=sym_u, user_id=user.id
        )
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
