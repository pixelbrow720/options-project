# features/regime

OI-weighted vs volume-weighted regime card.

**Backend payload:** `RegimePayload` — `oi` and `vol` entries
each with `score`, `label` ("bullish" | "neutral" | "bearish"),
`call_wall_total`, `put_wall_total`, `net_gex`.

**What lives here:**
- Two side-by-side regime gauges (OI / vol) with score arc
- Label pill (bullish/neutral/bearish) — never use signed-value
  greens/reds here; use a third hue (`--color-zero-gamma` violet for
  neutral, `--color-success` for bullish, `--color-warn` for bearish).
  Reusing long-green for "bullish regime" creates a same-screen
  collision with signed P&L.
- 30-day score sparkline

**Domain note:** OI regime is multi-day sticky; vol regime is intraday
volatile. They diverge during news events — the divergence itself is
a signal worth surfacing.
