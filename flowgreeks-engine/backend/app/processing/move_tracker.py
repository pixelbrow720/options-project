"""Realized vs Implied move tracker.

At session open we extract the *implied* daily move from the front-month
ATM straddle:

    implied_move_$ ≈ ATM_call_price + ATM_put_price        (front expiry)

This is the market's price of one standard deviation of underlying move
through expiration, scaled to a single trading day if the front expiry
is not 0DTE (using ``√(1/dte)`` rescaling).

Throughout the session, *realized* move = ``|last_price − open_price|``.

Output: a single record with both numbers and a ``ratio`` field. The
website surfaces this as a "vol crush" (ratio < 0.5) or "vol expansion"
(ratio > 1.5) signal.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from app.processing.session import _now_eastern


def _today_eastern() -> date:
    return _now_eastern().date()


# ── Session-open price registry ────────────────────────────────────────────
#
# ``compute_move_tracker``'s ``open_price`` argument was historically wired
# from the loader's earliest non-null ``underlying_price``. On the first
# tick of a session that's an overnight stale print from the prior
# afternoon — anchoring realized_move to the wrong reference. The pipeline
# session-open hook (``reset_session_state``) now records spot here on
# 09:29 ET so the tracker reads from a known-good 09:30 print.
_SESSION_OPEN_PRICES: dict[str, float] = {}


def set_session_open_price(symbol: str, price: float | None) -> None:
    """Record the session-open underlying price for ``symbol``."""
    if symbol is None or price is None:
        return
    if not np.isfinite(price) or price <= 0:
        return
    _SESSION_OPEN_PRICES[symbol.upper()] = float(price)


def get_session_open_price(symbol: str) -> float | None:
    """Return the recorded session-open price for ``symbol`` or ``None``."""
    if symbol is None:
        return None
    return _SESSION_OPEN_PRICES.get(symbol.upper())


def reset_session_open_prices() -> None:
    """Test helper: clear the registry."""
    _SESSION_OPEN_PRICES.clear()


@dataclass
class MoveSnapshot:
    underlying_price: float | None
    open_price: float | None
    realized_move: float | None
    implied_move: float | None
    implied_dte: int | None
    ratio: float | None
    reason: str | None = None


def compute_move_tracker(
    chain: pd.DataFrame,
    *,
    open_price: float | None,
    today: pd.Timestamp | None = None,
    symbol: str | None = None,
) -> MoveSnapshot:
    """Compute realized vs implied move for the front expiry.

    ``chain`` is the latest options chain DataFrame with columns
    ``strike, expiration, option_type, last_price, underlying_price``.

    ``open_price`` is the underlying's session-opening price. Resolution
    order:

    1. Caller-supplied ``open_price`` (highest priority).
    2. The session-open registry populated by ``reset_session_state``
       on the 09:29 ET hook (keyed by ``symbol``).
    3. Earliest non-null ``underlying_price`` in the chain (legacy
       fallback — may be a stale overnight tick).

    If none of these yield a usable open we report ``reason =
    "open_price_unset"`` and leave ``realized_move`` as ``None``.
    """
    if chain.empty:
        return MoveSnapshot(None, open_price, None, None, None, None, "open_price_unset" if open_price is None else None)

    spot_series = chain["underlying_price"].dropna()
    if spot_series.empty:
        return MoveSnapshot(None, open_price, None, None, None, None, "open_price_unset" if open_price is None else None)
    S = float(spot_series.iloc[-1])

    derived_reason: str | None = None
    if open_price is None and symbol is not None:
        registered = get_session_open_price(symbol)
        if registered is not None:
            open_price = registered
    if open_price is None:
        first = float(spot_series.iloc[0])
        if np.isfinite(first) and first > 0:
            open_price = first
        else:
            derived_reason = "open_price_unset"

    realized = None
    if open_price is not None and open_price > 0 and np.isfinite(S):
        realized = abs(S - open_price)

    if today is None:
        today_d = _today_eastern()
    else:
        today_d = today.date()

    work = chain.copy()
    work["last_price"] = pd.to_numeric(work["last_price"], errors="coerce")
    work["strike"] = pd.to_numeric(work["strike"], errors="coerce")
    work = work[work["last_price"].notna() & work["strike"].notna()]
    if work.empty:
        return MoveSnapshot(S, open_price, realized, None, None, None, derived_reason)

    # Find front expiry (smallest dte > 0).
    front_exp = None
    front_dte = None
    for exp in sorted(work["expiration"].unique()):
        try:
            exp_d = pd.Timestamp(exp).date()
        except (TypeError, ValueError):
            continue
        dte = (exp_d - today_d).days
        if dte >= 0:
            front_exp = exp
            front_dte = dte
            break
    if front_exp is None:
        return MoveSnapshot(S, open_price, realized, None, None, None, derived_reason)

    front = work[work["expiration"] == front_exp]
    if front.empty:
        return MoveSnapshot(S, open_price, realized, None, None, None, derived_reason)

    nearest = front.iloc[(front["strike"] - S).abs().argsort()]
    if nearest.empty:
        return MoveSnapshot(S, open_price, realized, None, None, None, derived_reason)
    atm_strike = float(nearest.iloc[0]["strike"])

    atm_call = front[
        (front["strike"] == atm_strike)
        & (front["option_type"].astype(str).str.upper() == "C")
    ]
    atm_put = front[
        (front["strike"] == atm_strike)
        & (front["option_type"].astype(str).str.upper() == "P")
    ]
    if atm_call.empty or atm_put.empty:
        return MoveSnapshot(S, open_price, realized, None, front_dte, None, derived_reason)

    call_p = float(atm_call.iloc[0]["last_price"])
    put_p = float(atm_put.iloc[0]["last_price"])
    if not (np.isfinite(call_p) and np.isfinite(put_p)):
        return MoveSnapshot(S, open_price, realized, None, front_dte, None, derived_reason)

    implied_total = call_p + put_p
    # Rescale to a single-day move when the front expiry is multi-day.
    daily_implied = implied_total
    if front_dte and front_dte > 1:
        daily_implied = implied_total / np.sqrt(front_dte)

    ratio = None
    if realized is not None and daily_implied > 0:
        ratio = float(realized / daily_implied)

    return MoveSnapshot(
        underlying_price=S,
        open_price=open_price,
        realized_move=realized,
        implied_move=float(daily_implied),
        implied_dte=int(front_dte) if front_dte is not None else None,
        ratio=ratio,
        reason=derived_reason,
    )
