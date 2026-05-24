# features/basis

SPX cash vs. ES futures basis.

**Backend payload:** `SpotPayload` — `price`, `source`, `futures_price`,
`basis`, `basis_age_seconds`, `parity_price`, `parity_deviation_pct`.

**What lives here:**
- Basis pill: live USD basis with sign + age tag
- 60-second mini-chart of basis evolution
- Source provenance — `source` field tells us whether spot resolved
  via futures-basis EMA, put-call parity, or stale cache. Render a
  small "src" tag with the matching tone:
    - `futures_basis` → cyan dot
    - `parity` → teal dot
    - `stale_cache` → warn (yellow) dot

**Domain note:** A widening basis (futures premium expanding) often
precedes a directional move; sudden compression is risk-off. The
backend computes basis once per pipeline tick; the pane fades in old
values once `basis_age_seconds > 30`.
