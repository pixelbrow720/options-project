"""Consolidated snapshot endpoint (Agent 5 — streaming API).

Returns every metric type the pipeline produces in a single envelope so
client indicators can populate their entire UI in one round-trip.

The payload returned here is also re-used by the WebSocket and SSE
streaming endpoints (`stream.py`) — they push a fresh copy of this
payload after every successful pipeline tick.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import limiter, require_symbol_access
from app.api.endpoints.data import _latest_metrics, _latest_metrics_batch, _walls_payload
from app.api.schemas import DataEnvelope
from app.config import get_settings
from app.db.models import FlowEvent
from app.db.session import get_db
from app.processing.futures_levels import build_futures_levels
from app.processing.session import session_snapshot

router = APIRouter()


_SYMBOL_PATTERN = r"^[A-Z][A-Z0-9]{0,11}$"


async def build_snapshot_payload(session: AsyncSession, symbol: str) -> tuple[dict[str, Any], datetime | None]:
    """Build the comprehensive snapshot ``data`` payload for ``symbol``.

    Returns ``(payload, computed_at)`` where ``computed_at`` is the
    freshest ``ComputedMetric.ts`` observed across all queried metric
    types, or ``None`` when no metrics are stored yet.

    The payload is also the shape pushed by the streaming endpoints.
    """
    sym = symbol.upper()

    # Batch every per-metric_type lookup into 2 round-trips total. Each
    # bucket below is a ``list[ComputedMetric]`` ordered by Postgres
    # natural sort — same shape ``_latest_metrics`` would return — so the
    # downstream payload-building code is unchanged. Walls and the flow
    # count remain on their own helpers / queries.
    _METRIC_TYPES = (
        "GEX_NET_TOTAL",
        "GEX_NET_TOTAL_VOL",
        "MAX_PAIN",
        "MAX_PAIN_AGG",
        "ATM_IV",
        "IV_SKEW",
        "IV_SURFACE",
        "VANNA_NET_TOTAL",
        "CHARM_NET_TOTAL",
        "VANNA_LEVEL",
        "CHARM_LEVEL",
        "REGIME_OI",
        "REGIME_VOL",
        "PIN_PROBABILITY",
        "MOVE_TRACKER",
        "IV_TERM_STRUCTURE",
        "RISK_REVERSAL_25D",
        "HIRO",
        "GEX_0DTE_NET_TOTAL",
        "GEX_0DTE_NET_TOTAL_VOL",
        "GEX_BACK_NET_TOTAL",
        "GEX_BACK_NET_TOTAL_VOL",
        "CHARM_0DTE_NET_TOTAL",
        "CHARM_0DTE_DECAY_RATE",
        "GEX_0DTE_FLIP_SPEED",
        "SPOT",
    )
    metrics = await _latest_metrics_batch(session, sym, _METRIC_TYPES)

    gex_rows = metrics["GEX_NET_TOTAL"]
    gex_payload: dict[str, Any] = {
        "net_total": 0.0,
        "curve": [],
        "top_positive": [],
        "top_negative": [],
        "zero_gamma": None,
    }
    if gex_rows:
        r = gex_rows[0]
        gex_payload = dict(r.extra_json or {})
        gex_payload["net_total"] = float(r.value or 0)
        gex_payload.setdefault("zero_gamma", None)

    gex_vol_rows = metrics["GEX_NET_TOTAL_VOL"]
    gex_vol_payload: dict[str, Any] = {
        "net_total": 0.0,
        "curve": [],
        "top_positive": [],
        "top_negative": [],
        "zero_gamma": None,
    }
    if gex_vol_rows:
        r = gex_vol_rows[0]
        gex_vol_payload = dict(r.extra_json or {})
        gex_vol_payload["net_total"] = float(r.value or 0)
        gex_vol_payload.setdefault("zero_gamma", None)

    # Top-level zero_gamma summary: prefer the volume-weighted variant
    # (what the MotiveWave indicator renders by default) but expose both.
    zero_gamma: float | None = (
        gex_vol_payload.get("zero_gamma")
        if gex_vol_payload.get("zero_gamma") is not None
        else gex_payload.get("zero_gamma")
    )

    mp_rows = metrics["MAX_PAIN"]
    mp_agg_rows = metrics["MAX_PAIN_AGG"]
    max_pain_payload = {
        "per_expiry": sorted(
            [
                {
                    "expiration": str(r.expiration),
                    "strike": float(r.strike),
                    "pain": float(r.value or 0),
                }
                for r in mp_rows
            ],
            key=lambda x: x["expiration"],
        ),
        "aggregate": (
            {"strike": float(mp_agg_rows[0].strike), "value": float(mp_agg_rows[0].value or 0)}
            if mp_agg_rows
            else None
        ),
    }

    walls_oi = await _walls_payload(session, sym, "oi")
    walls_volume = await _walls_payload(session, sym, "volume")

    iv_atm = metrics["ATM_IV"]
    iv_skew = metrics["IV_SKEW"]
    iv_surface = metrics["IV_SURFACE"]
    iv_payload = {
        "atm_iv": float(iv_atm[0].value) if iv_atm and iv_atm[0].value is not None else None,
        "skew_per_expiry": {str(r.expiration): float(r.value or 0) for r in iv_skew},
        "surface": (iv_surface[0].extra_json or {}).get("surface") if iv_surface else [],
    }

    # Vanna & Charm — total ("net") + per-strike level curve.
    vanna_total_rows = metrics["VANNA_NET_TOTAL"]
    charm_total_rows = metrics["CHARM_NET_TOTAL"]
    vanna_level_rows = metrics["VANNA_LEVEL"]
    charm_level_rows = metrics["CHARM_LEVEL"]

    def _greek_total(rows: list) -> dict[str, Any]:
        if not rows:
            return {"net_total": 0.0, "curve": [], "top_positive": [], "top_negative": []}
        r = rows[0]
        payload = dict(r.extra_json or {})
        payload["net_total"] = float(r.value or 0)
        return payload

    def _greek_level(rows: list) -> list[dict[str, Any]]:
        return sorted(
            [
                {**(r.extra_json or {}), "strike": float(r.strike), "value": float(r.value or 0)}
                for r in rows
            ],
            key=lambda x: x.get("strike", 0.0),
        )

    vanna_total = _greek_total(vanna_total_rows)
    charm_total = _greek_total(charm_total_rows)
    vanna_level = _greek_level(vanna_level_rows)
    charm_level = _greek_level(charm_level_rows)

    # Regime — OI + volume scores with labels.
    regime_oi_rows = metrics["REGIME_OI"]
    regime_vol_rows = metrics["REGIME_VOL"]

    def _regime_entry(rows: list) -> dict[str, Any] | None:
        if not rows:
            return None
        r = rows[0]
        extra = dict(r.extra_json or {})
        return {
            "score": float(r.value or 0.0),
            "label": extra.get("label", "neutral"),
            "call_wall_total": float(extra.get("call_wall_total") or 0.0),
            "put_wall_total": float(extra.get("put_wall_total") or 0.0),
            "net_gex": float(extra.get("net_gex") or 0.0),
        }

    regime_payload = {
        "oi": _regime_entry(regime_oi_rows),
        "vol": _regime_entry(regime_vol_rows),
        "label": (_regime_entry(regime_oi_rows) or {}).get("label", "neutral"),
        "score": (_regime_entry(regime_oi_rows) or {}).get("score", 0.0),
    }

    # Pin probability — heatmap entries persisted per strike.
    pin_rows = metrics["PIN_PROBABILITY"]
    pin_probability = sorted(
        [
            {**(r.extra_json or {}), "strike": float(r.strike), "prob": float(r.value or 0.0)}
            for r in pin_rows
        ],
        key=lambda x: x.get("strike", 0.0),
    )

    # Realised vs implied move tracker (single row).
    move_rows = metrics["MOVE_TRACKER"]
    move_tracker = dict(move_rows[0].extra_json or {}) if move_rows else None

    # IV term structure + risk reversal — one row per expiration.
    term_rows = metrics["IV_TERM_STRUCTURE"]
    iv_term_structure = sorted(
        [dict(r.extra_json or {}) for r in term_rows],
        key=lambda x: str(x.get("expiration", "")),
    )
    rr_rows = metrics["RISK_REVERSAL_25D"]
    risk_reversal_25d = sorted(
        [
            {
                "expiration": str(r.expiration),
                "value": float(r.value or 0.0),
                **(r.extra_json or {}),
            }
            for r in rr_rows
        ],
        key=lambda x: x.get("expiration", ""),
    )

    # HIRO — cumulative signed premium of the most-recent bucket.
    hiro_rows = await _latest_metrics(session, sym, "HIRO")
    hiro_cumulative = float(hiro_rows[0].value or 0.0) if hiro_rows else 0.0

    # Rev 4 — 0DTE/back-month cohort splits.
    gex_0dte_oi_rows = await _latest_metrics(session, sym, "GEX_0DTE_NET_TOTAL")
    gex_0dte_vol_rows = await _latest_metrics(session, sym, "GEX_0DTE_NET_TOTAL_VOL")
    gex_back_oi_rows = await _latest_metrics(session, sym, "GEX_BACK_NET_TOTAL")
    gex_back_vol_rows = await _latest_metrics(session, sym, "GEX_BACK_NET_TOTAL_VOL")
    charm_0dte_rows = await _latest_metrics(session, sym, "CHARM_0DTE_NET_TOTAL")
    charm_decay_rows = await _latest_metrics(session, sym, "CHARM_0DTE_DECAY_RATE")
    flip_rows = await _latest_metrics(session, sym, "GEX_0DTE_FLIP_SPEED")

    def _gex_summary(rows: list) -> dict[str, Any]:
        if not rows:
            return {
                "net_total": 0.0,
                "curve": [],
                "top_positive": [],
                "top_negative": [],
                "zero_gamma": None,
                "reason": "no_0dte_today",
            }
        r = rows[0]
        payload = dict(r.extra_json or {})
        payload["net_total"] = float(r.value or 0)
        return payload

    zero_dte_payload = {
        "gex_oi": _gex_summary(gex_0dte_oi_rows),
        "gex_volume": _gex_summary(gex_0dte_vol_rows),
        "charm_total": _gex_summary(charm_0dte_rows),
        "charm_decay_rate": (
            float(charm_decay_rows[0].value or 0.0) if charm_decay_rows else 0.0
        ),
        "flip_speed": float(flip_rows[0].value or 0.0) if flip_rows else 0.0,
    }
    back_month_payload = {
        "gex_oi": _gex_summary(gex_back_oi_rows),
        "gex_volume": _gex_summary(gex_back_vol_rows),
    }

    # Rev 4 — session_state block (RTH gate + 0DTE tau snapshot).
    session_state = session_snapshot(symbol=sym)

    # Rev 4 — spot resolution block (futures_basis | parity | stale_cache).
    spot_rows = await _latest_metrics(session, sym, "SPOT")
    spot_payload: dict[str, Any] | None = None
    if spot_rows:
        r = spot_rows[0]
        spot_payload = dict(r.extra_json or {})
        spot_payload.setdefault("price", float(r.value or 0.0))

    # Flow events in the last hour (count only — series lives at /flow).
    since = datetime.now(UTC) - timedelta(hours=1)
    flow_count_q = select(func.count(FlowEvent.id)).where(
        FlowEvent.symbol == sym, FlowEvent.ts >= since
    )
    flow_events_last_hour = int((await session.execute(flow_count_q)).scalar_one() or 0)

    payload = {
        "gex": gex_payload,
        "gex_volume": gex_vol_payload,
        "max_pain": max_pain_payload,
        "walls_oi": walls_oi["payload"],
        "walls_volume": walls_volume["payload"],
        # Back-compat: legacy ``walls`` shape used by the older indicator
        # builds; combines both modes into a single dict like the existing
        # /walls endpoint.
        "walls": {**walls_oi["payload"], **walls_volume["payload"]},
        "iv": iv_payload,
        "vanna_total": vanna_total,
        "charm_total": charm_total,
        "vanna_level": vanna_level,
        "charm_level": charm_level,
        "regime": regime_payload,
        "zero_gamma": zero_gamma,
        "pin_probability": pin_probability,
        "move_tracker": move_tracker,
        "risk_reversal_25d": risk_reversal_25d,
        "iv_term_structure": iv_term_structure,
        "hiro_cumulative": hiro_cumulative,
        "flow_events_last_hour": flow_events_last_hour,
        # Rev 4 additions.
        "session_state": session_state,
        "spot": spot_payload,
        "zero_dte": zero_dte_payload,
        "back_month": back_month_payload,
    }

    all_rows = (
        gex_rows + gex_vol_rows + mp_rows + mp_agg_rows
        + iv_atm + iv_skew + iv_surface
        + vanna_total_rows + charm_total_rows + vanna_level_rows + charm_level_rows
        + regime_oi_rows + regime_vol_rows
        + pin_rows + move_rows + term_rows + rr_rows + hiro_rows
        # Rev 4 metric rows
        + gex_0dte_oi_rows + gex_0dte_vol_rows
        + gex_back_oi_rows + gex_back_vol_rows
        + charm_0dte_rows + charm_decay_rows + flip_rows
        + spot_rows
    )
    candidates = [r.ts for r in all_rows if r.ts is not None]
    for ts_candidate in (walls_oi.get("computed_at"), walls_volume.get("computed_at")):
        if ts_candidate is not None:
            candidates.append(ts_candidate)
    computed_at = max(candidates, default=None) if candidates else None

    return payload, computed_at


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


@router.get("/v1/{symbol}/snapshot", response_model=DataEnvelope)
@limiter.limit(lambda: f"{get_settings().rate_limit_per_minute}/minute")
async def get_snapshot(
    request: Request,  # noqa: ARG001
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _api_key=Depends(require_symbol_access()),
) -> DataEnvelope:
    sym = symbol.upper()
    if sym not in [s.upper() for s in get_settings().supported_symbols]:
        raise HTTPException(status_code=404, detail=f"Unsupported symbol {sym}")
    payload, computed_at = await build_snapshot_payload(session, sym)
    return _envelope(symbol, computed_at, payload)


@router.get("/v1/{symbol}/0dte", response_model=DataEnvelope)
@limiter.limit(lambda: f"{get_settings().rate_limit_per_minute}/minute")
async def get_zero_dte(
    request: Request,  # noqa: ARG001
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _api_key=Depends(require_symbol_access()),
) -> DataEnvelope:
    """Rev 4 — thin envelope around the 0DTE + back-month cohorts.

    Returns the same data the snapshot would, but filtered down to the
    Rev 4 0DTE-first fields so the 0DTE-focused page can fetch a
    smaller payload. ``session_state`` is included so the front-end can
    show the RTH banner without a second roundtrip.
    """
    sym = symbol.upper()
    if sym not in [s.upper() for s in get_settings().supported_symbols]:
        raise HTTPException(status_code=404, detail=f"Unsupported symbol {sym}")
    full, computed_at = await build_snapshot_payload(session, sym)
    # Curate the response — only the 0DTE-relevant blocks.
    payload: dict[str, Any] = {
        "session_state": full.get("session_state"),
        "spot": full.get("spot"),
        "zero_dte": full.get("zero_dte"),
        "back_month": full.get("back_month"),
        "pin_probability": full.get("pin_probability"),
        "move_tracker": full.get("move_tracker"),
    }
    return _envelope(symbol, computed_at, payload)


@router.get("/v1/{symbol}/spot", response_model=DataEnvelope)
@limiter.limit(lambda: f"{get_settings().rate_limit_per_minute}/minute")
async def get_spot(
    request: Request,  # noqa: ARG001
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _api_key=Depends(require_symbol_access()),
) -> DataEnvelope:
    """Rev 4 — standalone spot resolution endpoint.

    Useful for the dashboard's spot-source badge and for downstream
    consumers that only need the current spot price plus its
    provenance (``futures_basis`` / ``parity`` / ``stale_cache``).
    """
    sym = symbol.upper()
    if sym not in [s.upper() for s in get_settings().supported_symbols]:
        raise HTTPException(status_code=404, detail=f"Unsupported symbol {sym}")
    full, computed_at = await build_snapshot_payload(session, sym)
    payload: dict[str, Any] = {
        "session_state": full.get("session_state"),
        "spot": full.get("spot"),
    }
    return _envelope(symbol, computed_at, payload)


@router.get("/v1/{symbol}/futures-levels", response_model=DataEnvelope)
@limiter.limit(lambda: f"{get_settings().rate_limit_per_minute}/minute")
async def get_futures_levels(
    request: Request,  # noqa: ARG001
    symbol: str = Path(..., min_length=1, max_length=20, pattern=_SYMBOL_PATTERN),
    session: AsyncSession = Depends(get_db),
    _api_key=Depends(require_symbol_access()),
) -> DataEnvelope:
    """Rev 4 — SpotGamma-style key levels translated into futures space.

    The chain that drives Zero Gamma / Call Wall / Put Wall / Max Pain
    / top GEX strikes is in cash index space (SPXW / NDXP). Most of our
    users trade the corresponding CME future (ES / NQ), so this endpoint
    translates every level into futures coordinates using the EMA basis
    persisted by the spot resolver: ``futures_level = cash_strike - basis``.

    When the futures feed is offline (no ``basis`` or ``futures_price``)
    the response still includes the cash levels with ``futures_level``
    set, but ``distance_pts`` / ``distance_pct`` are ``None`` so the
    front-end can render a "futures feed offline" banner.
    """
    sym = symbol.upper()
    if sym not in [s.upper() for s in get_settings().supported_symbols]:
        raise HTTPException(status_code=404, detail=f"Unsupported symbol {sym}")

    # SPOT (basis + futures price + provenance).
    spot_rows = await _latest_metrics(session, sym, "SPOT")
    spot_extra: dict[str, Any] | None = None
    spot_value: float | None = None
    spot_ts: datetime | None = None
    if spot_rows:
        r = spot_rows[0]
        spot_extra = dict(r.extra_json or {})
        spot_value = float(r.value) if r.value is not None else None
        spot_ts = r.ts

    # GEX (volume-weighted preferred for flip + top GEX, OI as fallback).
    gex_vol_rows = await _latest_metrics(session, sym, "GEX_NET_TOTAL_VOL")
    gex_oi_rows = await _latest_metrics(session, sym, "GEX_NET_TOTAL")
    gex_extra = dict(gex_vol_rows[0].extra_json or {}) if gex_vol_rows else None
    gex_oi_extra = dict(gex_oi_rows[0].extra_json or {}) if gex_oi_rows else None

    # 0DTE GEX cohort.
    gex_0dte_vol_rows = await _latest_metrics(session, sym, "GEX_0DTE_NET_TOTAL_VOL")
    zero_dte_gex_extra = (
        dict(gex_0dte_vol_rows[0].extra_json or {}) if gex_0dte_vol_rows else None
    )

    # Aggregate Max Pain.
    mp_agg_rows = await _latest_metrics(session, sym, "MAX_PAIN_AGG")
    max_pain_aggregate: dict[str, Any] | None = None
    if mp_agg_rows:
        r = mp_agg_rows[0]
        max_pain_aggregate = {
            "strike": float(r.strike),
            "value": float(r.value or 0.0),
        }

    # Walls (OI-weighted) — reuse the helper from data.py for consistent shape.
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

    # Pick the freshest ts among everything we read.
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

    payload = asdict(snapshot)
    # ``levels`` is already a list of dicts after asdict; explicit no-op for clarity.
    return _envelope(symbol, computed_at, payload)
