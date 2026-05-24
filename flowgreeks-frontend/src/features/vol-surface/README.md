# features/vol-surface

Standalone IV surface focus view.

**Backend payload:** `IvPayload.surface` (raw points) plus
`atm_iv` and `skew_per_expiry`.

**What lives here:**
- Full-canvas vol surface — shares the parametric grid renderer with
  `features/iv/` but exposes camera presets (front, top, isometric)
  and surface-style toggle (mesh / solid / glass).

**Why a dedicated folder:** the IV pane on the main dashboard is a
budget-constrained tile; this is the "open in focus mode" version
where rendering quality and interactivity can take a 2× cost.
