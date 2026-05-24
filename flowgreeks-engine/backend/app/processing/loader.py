"""Load the latest options-chain snapshot per (expiration, strike, option_type) for a symbol.

When live OI is missing/zero (common for OPRA Pillar definition-only feeds),
we fall back to the most recently ingested end-of-day Open Interest snapshot
from ``eod_open_interest`` so downstream metrics (GEX-by-OI, walls-by-OI) still
have meaningful weights to use.

Underlying spot synthesis lives in :mod:`app.processing.spot`. Rev 4 wires
:func:`app.processing.spot.resolve_spot` directly from
:mod:`app.processing.pipeline`, which then overwrites ``underlying_price``
on every chain row before metrics run — so the loader does not attempt to
populate spot here.
"""

from __future__ import annotations

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings

# Window is parameterised at call time (settings are loaded once per process
# but the pipeline can run with overridden settings during tests). The query
# itself is cached as a single ``text()`` so SQLAlchemy compiles it once.
SNAPSHOT_QUERY = text(
    """
    SELECT DISTINCT ON (expiration, strike, option_type)
        ts, symbol, expiration, strike, option_type,
        oi, volume, iv, delta, gamma, last_price, bid, ask, underlying_price
    FROM options_chain
    WHERE symbol = :symbol
      AND ts > NOW() - make_interval(hours => :window_hours)
    ORDER BY expiration, strike, option_type, ts DESC
    """
)


EOD_OI_QUERY = text(
    """
    SELECT expiration, strike, option_type, open_interest
    FROM eod_open_interest
    WHERE symbol = :symbol
    """
)


async def load_latest_snapshot(session: AsyncSession, symbol: str) -> pd.DataFrame:
    settings = get_settings()
    result = await session.execute(
        SNAPSHOT_QUERY,
        {
            "symbol": symbol,
            "window_hours": int(settings.loader_snapshot_window_hours),
        },
    )
    rows = result.mappings().all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame.from_records([dict(r) for r in rows])
    # Coerce numeric columns to floats for downstream math.
    for col in ("strike", "iv", "delta", "gamma", "last_price", "bid", "ask", "underlying_price"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("oi", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Fold in EOD OI fallback for any rows where live OI is null/zero.
    df = await _apply_eod_oi_fallback(session, symbol, df)
    return df


async def _apply_eod_oi_fallback(
    session: AsyncSession, symbol: str, df: pd.DataFrame
) -> pd.DataFrame:
    """Fill rows where ``oi`` is null or zero from ``eod_open_interest``."""
    if df.empty or "oi" not in df.columns:
        return df

    needs_fill = df["oi"].isna() | (df["oi"].fillna(0) == 0)
    if not needs_fill.any():
        return df

    result = await session.execute(EOD_OI_QUERY, {"symbol": symbol})
    rows = result.mappings().all()
    if not rows:
        return df

    eod = pd.DataFrame.from_records([dict(r) for r in rows])
    if eod.empty:
        return df
    eod["strike"] = pd.to_numeric(eod["strike"], errors="coerce")
    eod["open_interest"] = pd.to_numeric(eod["open_interest"], errors="coerce").fillna(0)
    eod["option_type"] = eod["option_type"].astype(str).str.upper()
    df["option_type"] = df["option_type"].astype(str).str.upper()

    merged = df.merge(
        eod[["expiration", "strike", "option_type", "open_interest"]],
        on=["expiration", "strike", "option_type"],
        how="left",
    )
    fallback = merged["open_interest"].fillna(0)
    df.loc[needs_fill, "oi"] = fallback[needs_fill].values
    return df
