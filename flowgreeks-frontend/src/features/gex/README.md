# features/gex

Gamma exposure (GEX) visualizations.

**Backend payload:** `GexPayload` from
`@/contracts/types/snapshot` — fields: `net_total`, `curve` (per-strike
`{strike, net_gex, call_gex?, put_gex?}`), `top_positive`,
`top_negative`, `zero_gamma`, `underlying_price`.

**What lives here:**
- 3D GEX skyline (composes `InstancedStrikeGrid` from `shared/three`)
- 2D GEX curve as a uPlot fallback for the focus layout
- Net-total KPI card with sparkline
- Zero-gamma vertical-line annotation

**Domain note:** GEX is dealer-perspective. Positive net GEX → dealers
long gamma → suppress vol (mean reversion). Negative net GEX → dealers
short gamma → amplify vol (momentum / squeeze). The sign matters more
than the magnitude when interpreting regime.

**Color rule:** signed bars use long-green (positive) / short-red
(negative). The zero-gamma line uses `--color-zero-gamma` (violet) —
NEVER red, even though the regime "below zero gamma" is bearish-vol.
