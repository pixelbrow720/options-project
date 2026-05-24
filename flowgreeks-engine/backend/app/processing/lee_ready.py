"""Lee-Ready trade-direction classifier.

The canonical algorithm from Lee & Ready (1991), *Inferring Trade
Direction from Intraday Data*, J. of Finance 46(2). For each trade,
classify whether it was buyer-initiated (+1) or seller-initiated (-1):

1.  **Quote-rule**: if the trade price is **above** the prevailing midpoint,
    classify as a buy (+1); if below, classify as a sell (-1).
2.  **Tick-rule** (only used when the trade lands exactly on the
    midpoint, the spread is zero, or quotes are missing): use the sign
    of the change relative to the previous *different* trade price.
    ``+1`` if the trade is higher than the last different trade price,
    ``-1`` if lower. If still tied (e.g. session open with no history,
    or a non-finite price) the trade is left unclassified (``side=0``).

Inputs (DataFrame columns expected, all required):

* ``ts`` — trade timestamp (any monotone column); rows must be sorted on
  this column before calling, OR ``sort=True`` (default) lets the function
  sort defensively.
* ``price`` — trade price (float).
* ``bid`` / ``ask`` — prevailing best quotes at trade time (float). Missing
  values (NaN / None) are tolerated and trigger the tick-rule fallback.

Returns a copy of the input DataFrame with three new columns added:

* ``mid``       — midpoint at trade time (NaN if either quote was missing).
* ``side``      — +1 (buy), -1 (sell), 0 (unclassified).
* ``signed_qty``— ``side`` times ``size`` if ``size`` is present in the
                   input, otherwise the bare ``side``.

After classification, a structured ``lee_ready_classified`` log event is
emitted with counts by classification method (quote vs tick vs unclassified)
to make diagnostics easy from production telemetry.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.core.logging import get_logger

logger = get_logger(__name__)


def classify_lee_ready(
    df: pd.DataFrame,
    *,
    sort: bool = True,
) -> pd.DataFrame:
    """Classify trades by initiator side using the Lee-Ready algorithm.

    See module docstring for the rule precedence and edge-case behavior.
    """
    required = {"price", "bid", "ask"}
    if df.empty:
        out = df.copy()
        out["mid"] = pd.Series(dtype=float)
        out["side"] = pd.Series(dtype="int8")
        out["signed_qty"] = pd.Series(dtype=float)
        return out
    missing = required.difference(df.columns)
    if missing:
        raise KeyError(f"Lee-Ready classifier requires {required}; missing {missing}")

    work = df.copy()
    if sort and "ts" in work.columns:
        work = work.sort_values("ts").reset_index(drop=True)

    bid = pd.to_numeric(work["bid"], errors="coerce").to_numpy(dtype=float)
    ask = pd.to_numeric(work["ask"], errors="coerce").to_numpy(dtype=float)
    price = pd.to_numeric(work["price"], errors="coerce").to_numpy(dtype=float)

    # ── Quote rule ───────────────────────────────────────────────────────
    # ``mid`` is NaN whenever either quote is missing — those rows fall
    # straight through to the tick rule because ``price > mid`` is False
    # for any NaN comparand. We also explicitly route zero-spread quotes
    # (bid == ask) through the tick rule: with the spread collapsed, the
    # quote rule degenerates to a strict price ≠ mid test which is too
    # noisy to be useful.
    mid = (bid + ask) / 2.0
    spread = ask - bid
    eps = 1e-9
    quote_eligible = np.isfinite(mid) & np.isfinite(spread) & (spread > eps)

    side = np.zeros_like(price, dtype=np.int8)
    side[quote_eligible & (price > mid + eps)] = 1
    side[quote_eligible & (price < mid - eps)] = -1
    quote_classified_mask = side != 0

    # ── Tick rule fallback ───────────────────────────────────────────────
    # Vectorised, with canonical Lee & Ready (1991) semantics: each
    # unclassified row is compared against the most recent **different**
    # trade price. We build that reference column once over the whole
    # series (no Python loop) and then turn the price-vs-reference sign
    # into the tick-rule side.
    #
    # The reference column is "the price that was current the last time
    # the price changed, observed strictly before this row":
    #   * row 0 → NaN  (no history)
    #   * any row whose price equals its predecessor → inherits the prev
    #     row's reference (so a zero-tick run keeps comparing against the
    #     same anchor)
    #   * any row whose price differs from its predecessor → the
    #     predecessor's price becomes the reference for the *next* row
    #
    # Concretely: mask out duplicate prices, ffill the rest, then shift(1)
    # so the reference for row i is the latest distinct price observed
    # before row i. Non-finite prices remain unclassified.
    tick_classified_mask = np.zeros_like(price, dtype=bool)
    if (side == 0).any():
        prices_s = pd.Series(price)
        not_dup = prices_s.diff().ne(0)  # NaN → True (treats row 0 as a new price)
        last_diff_price = (
            prices_s.where(not_dup).ffill().shift(1).to_numpy(dtype=float)
        )
        finite_price = np.isfinite(price)
        finite_ref = np.isfinite(last_diff_price)
        delta = np.where(finite_price & finite_ref, price - last_diff_price, np.nan)
        tick_side = np.where(
            np.isfinite(delta) & (delta > 0), 1,
            np.where(np.isfinite(delta) & (delta < 0), -1, 0),
        ).astype(np.int8)
        final_side = np.where(side != 0, side, tick_side).astype(np.int8)
        tick_classified_mask = (side == 0) & (final_side != 0)
        side = final_side

    work["mid"] = mid
    work["side"] = side
    if "size" in work.columns:
        size = pd.to_numeric(work["size"], errors="coerce").fillna(0).to_numpy()
        work["signed_qty"] = side.astype(float) * size
    else:
        work["signed_qty"] = side.astype(float)

    # ── Structured diagnostic log ────────────────────────────────────────
    total = int(price.size)
    quote_n = int(quote_classified_mask.sum())
    tick_n = int(tick_classified_mask.sum())
    unclassified_n = total - quote_n - tick_n
    logger.debug(
        "lee_ready_classified",
        total=total,
        quote_rule=quote_n,
        tick_rule=tick_n,
        unclassified=unclassified_n,
    )
    return work
