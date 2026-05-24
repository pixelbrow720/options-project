# features/zero-dte

Zero-day-to-expiry GEX, charm, flip-speed.

**Backend payload:** `ZeroDtePayload` — `gex_oi`, `gex_volume`,
`charm_total`, `charm_decay_rate`, `flip_speed`. The 0DTE GEX payloads
include `tau_years` and an optional `reason` (e.g. `"no_0dte_today"`).

**What lives here:**
- Charm landscape (3D) — strike × charm magnitude. Decays as τ → 0,
  so the surface flattens into the X-axis as session-close approaches.
- Flip-speed dial: how fast the gamma exposure is rotating sign per
  unit time. High flip-speed near close is squeeze country.
- Session-close countdown (uses `session_state.minutes_to_close`).

**Domain note:** On non-0DTE days the backend still emits this payload
with `value=0` and `reason="no_0dte_today"`. The pane should render an
"awaiting next 0DTE expiry" state — DO NOT treat the empty payload as
an error. Charm decay rate is meaningful only inside the last 60min
of the session; outside that window mute it.
