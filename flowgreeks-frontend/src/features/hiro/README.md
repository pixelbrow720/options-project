# features/hiro

HIRO (Hedging Imbalance / Real-time Options) — SpotGamma-style
delta-notional cumulative flow.

**Backend payload:** `HiroPayload` — `series` of bucketed
`{ts, cumulative, call_delta_notional, put_delta_notional, net_delta_notional, …}`,
plus aggregate `cumulative` and provenance flag (`weight_source`:
`delta_notional` | `signed_premium` | `mixed`).

**What lives here:**
- Cumulative ribbon (uPlot, last 60min window) — green above zero,
  red below, with a sign-flip marker at every crossing
- Call vs put split bars
- Provenance pill — when `weight_source === "signed_premium"` the data
  is a fallback; render a quiet warning so the trader knows the
  delta-notional path was unavailable

**Domain note:** Sign flips on HIRO are the actionable signal — they
mark rotation of customer-side flow. A persistent rising-positive
slope means customers are net-buying delta (bullish). A flip from
positive to negative during RTH on heavy size is the canonical
intraday reversal warning.
