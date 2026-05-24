# features/iv

Implied volatility surface and skew.

**Backend payload:** `IvPayload` — `atm_iv`, `skew_per_expiry`
(record of expiration → skew slope), `surface` (raw points).

**What lives here:**
- 3D IV surface (vol surface) — strike × expiration × IV mesh, with a
  custom shader that maps IV → height + glass tint. Use a low-poly
  parametric grid; do NOT triangulate the raw `surface[]` directly
  (the shape is too sparse for clean isolines).
- 2D skew curve per expiry (uPlot)
- Term-structure twist mini-chart

**Domain note:** ATM IV is the headline number; skew (puts vs calls)
encodes downside hedging demand. Surface twist (front-month >
back-month vs flat) is a regime tell — backwardation signals stress.
