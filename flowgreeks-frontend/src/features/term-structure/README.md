# features/term-structure

IV term-structure ribbon.

**Backend payload:** Front-month IV ladder lives partly inside
`IvPayload.skew_per_expiry`; the canonical term-structure metric is
emitted by the backend as its own `metric_type` and will be exposed in
the snapshot when the pane is built.

**Planned visualization:** 3D ribbon — expiration on x-axis, IV on
y-axis, color-scaled by skew at that expiration. Twist (front >
back vs back > front) is the actionable read.

**Status:** namespace reservation. Add types to `contracts` when the
backend exports the dedicated payload.
