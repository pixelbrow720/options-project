# features/max-pain

Max-pain magnetism gauge.

**Backend payload:** `MaxPainPayload` — `per_expiry` (per-expiration
strike + pain) and `aggregate` (single OI-weighted strike across
expiries).

**What lives here:**
- Magnetism gauge: distance from spot to aggregate max-pain, animated
  as a force-line that grows as gamma compresses near expiry
- Per-expiry chip strip — one chip per future expiration, sorted by
  date, showing strike + pain magnitude
- Hover tooltip with payoff curve preview

**Domain note:** Max-pain is the strike at which the largest open
interest dollar value would expire worthless. Useful as a magnet for
0DTE pinning, much weaker for further-dated expirations. The gauge
should de-emphasise (lower opacity) max-pain values for expiries > 7
days.
