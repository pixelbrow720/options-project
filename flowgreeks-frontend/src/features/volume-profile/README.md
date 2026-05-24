# features/volume-profile

Intraday volume profile.

**Backend payload:** Not in the snapshot envelope yet; lives under a
separate metric_type in the backend's `computed_metrics`. The endpoint
shape will land in `contracts/types/snapshot.ts` when the pane is
built. Until then this folder is a namespace reservation.

**Planned visualization:** horizontal histogram aligned to the spot
axis showing volume traded at price. Composed with the GEX skyline so
they share a strike axis.
