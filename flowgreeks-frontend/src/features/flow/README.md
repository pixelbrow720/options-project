# features/flow

Real-time flow tape — sweeps, blocks, unusual options activity (UOA).

**Backend payload:** `FlowPayload` — `events` (last ~50 events) and
`counts` (event-type histogram).

**What lives here:**
- Tape view: virtualized scrolling list of events, newest first.
  Columns: time, ticker/expiry/strike/type, event type, size,
  premium (USD), side (+/−), legs.
- Side filter (buys / sells / both) + premium-min slider
- Event-type colorcoding: SWEEP = cyan, BLOCK = violet, UOA = teal

**Domain note:** Side is `+1 = customer buy, −1 = customer sell`
post-Lee-Ready. Premium is the dollar size of the trade. A
SWEEP > $1M with side=+1 on calls is canonical bullish; on puts it's
canonical bearish-hedging.

**Performance:** This pane is the worst offender for re-render
churn. NEVER pass the whole `events[]` array down through props as a
new reference each tick — memoize in Zustand or use TanStack Query
structural sharing. Virtualize the list (10–20 visible rows out of
50 total).
