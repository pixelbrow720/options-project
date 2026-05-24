# features/walls

Call walls + put walls (top-N OI / volume strikes).

**Backend payload:** `WallsPayload` — four optional arrays:
`call_wall_oi`, `put_wall_oi`, `call_wall_volume`, `put_wall_volume`,
each ranked.

**What lives here:**
- 3D walls relief (composes `InstancedStrikeGrid`) — call walls render
  in `--color-call-wall` (cyan) above the strike axis; put walls in
  `--color-put-wall` (pink) below
- Top-3 wall list per side
- OI/volume mode toggle

**Domain note:** Walls are zones where dealer gamma exposure
concentrates and price tends to "stick" intraday. The OI variant is
sticky (multi-day); the volume variant moves intraday and is the
better day-trade signal.
