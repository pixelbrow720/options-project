# Deep Review — Rev 7 (post Rev 5/6 + pre-frontend polish)

Pass date: 2026-05-24. Read-only review of `flowgreeks-engine/backend/`. This pass
verifies the items REVIEW.md (Rev 5 + Rev 6 + Rev 6+) claims to have closed,
flags what is still open, and surfaces new findings against the current code
on `main`.

The bar: **only what's open now** — we deliberately do not restate items
already addressed by Rev 5/6 (constant-time admin login, mid-stream
revocation watcher, IV thread offload, HIRO delta-notional + incremental,
CSP path-scoping, key_lookup BLAKE2b, snapshot prime cache, pipeline
session collapse, env-default refusal, bulk-writer DLQ, vectorised GEX,
default-deny CSP for non-docs paths). Each of those was independently
verified in the live source; none have regressed.

## Executive summary

| Severity | Count | Areas |
|----------|-------|-------|
| CRITICAL | 0 | — |
| HIGH | 6 | walls weight-source provenance dropped at persistence; `spot.synthesize_underlying_price` row-wise `df.apply`; `is_expiration_day` ignores Tue/Thu SPXW expiries; missing tests for snapshot prime cache + key_lookup fast path + 4401 revocation; `databento_live` `async for record in client` may be sync-blocking; `_walls_payload` not in `_latest_metrics_batch` (8 extra round-trips per snapshot) |
| MEDIUM | 11 | bulk-writer lock-per-row in `add_many`; `_FUTURES_LAST_QUERY` LIKE prefix; pin_probability vs vanna_charm τ-floor inconsistency; `compute_max_pain` Python loop over strikes; `compute_hiro_incremental` naive `datetime.utcnow()` fallback; `databento_live._state` cumulative volume not reset; MBP snapshot loop writes regardless of dirty; `vanna_charm._signed_aggregate` extra `.copy()`; `move_tracker.open_price` not wired from session-open; `authenticate_api_key` commits per request; flow events DESC index missing |
| LOW | 9 | hardcoded `_QUOTE_MAX_AGE_S` quote-staleness; rate-limit key plaintext prefix (deferred); `compute_zero_gamma` recursive expansion duplicates work; `_HTML_CSP_PATHS` substring `text/html` match; HIRO non-rotatable domain key documented but not surfaced; WS auth doesn't increment `usage_count` (asymmetry vs REST); JWT `aud`/`iss`/`nbf` (deferred); `flow_events` ts-only index added 0007 but `(symbol, ts DESC)` still missing for "latest-N-per-symbol"; `inspector.py` per-table N+1 (count + max) could be one query |

Tests: 325 pass / 34 skip per Rev 6+ validation. Three high-leverage test
gaps below — adding them is a quick pass, not a redesign.

---

## Section A — Auth & security

### HIGH

- **A1 — Walls weight-source dropped at persistence (observability blind spot)**
  [`pipeline.py:300-316`](backend/app/processing/pipeline.py#L300)
  Persists `CALL_WALL_OI` / `PUT_WALL_VOL` etc. with `extra_json={"rank": rank}`
  only. `WallsSummary.by_oi["weight_source"]` (which encodes the
  fallback chain `oi → volume_fallback → premium_fallback → uniform_fallback`,
  see [`walls.py:142-164`](backend/app/processing/walls.py#L142)) is never
  written. Consumers of `CALL_WALL_OI` cannot tell whether the strike
  ranking was driven by real OI or by the uniform-weight fallback —
  which is a meaningfully different signal. Fix: include
  `weight_source` in the per-metric `extra_json` (mirror what GEX
  already does at [`pipeline.py:243-253`](backend/app/processing/pipeline.py#L243)).
  Update `data._walls_payload` and `snapshot.build_snapshot_payload`
  to surface it. Why it matters: the regime score
  ([`regime._wall_dominance`](backend/app/processing/regime.py#L90))
  feeds off these wall totals; a uniform-fallback wall stack
  silently flipping the regime label is the worst possible kind of
  silent metric drift.

### MEDIUM

- **A2 — `authenticate_api_key` commits the session on every authed call**
  [`deps.py:215-218`](backend/app/api/deps.py#L215). Updates
  `usage_count` and `last_used_at` then `await session.commit()` per
  request. At 120/min/key x N keys this is a real write-amp source on
  the hottest table. Defer the update with a periodic flush
  (in-memory `usage_delta` keyed by `api_key_id`, drained every 60s)
  or use `RETURNING` + bulk update. Minimum-cost fix: drop
  `last_used_at` precision to per-minute and skip the update when the
  in-memory value hasn't changed in the last 60s.

### LOW

- **A3 — Rate-limit key is plaintext API-key prefix** [`deps.py:54-57`](backend/app/api/deps.py#L54).
  Already in REVIEW.md MEDIUM-deferred. `f"key:{api_key[:11]}"` lands
  in slowapi state and any traceback. `blake2s` it. Trivially small
  PR.

- **A4 — WS auth path skips `usage_count`/`last_used_at`** [`stream.py:120-171`](backend/app/api/endpoints/stream.py#L120).
  REST `authenticate_api_key` does both
  ([`deps.py:215-218`](backend/app/api/deps.py#L215)); WS path
  doesn't. Operators looking at a key's usage to decide whether to
  rotate it will see suspiciously quiet keys that are actually
  pumping a WS firehose. One `update().values(...)` after the
  successful verify, fire-and-forget.

- **A5 — JWT lacks `aud`/`iss`/`nbf`** [`security.py:125-149`](backend/app/core/security.py#L125).
  REVIEW.md deferred. Worth noting because the operator-facing
  Prometheus scrape (`GET /admin/metrics`) inherits the same JWT —
  pinning audience makes future API expansion easier.

- **A6 — `_HTML_CSP_PATHS` matches `b"text/html" in content_type`**
  [`main.py:317`](backend/app/main.py#L317). Substring match — an
  attacker-controlled `Content-Type` header that contains the literal
  bytes `text/html` would still pass the `is_html_csp_path` gate. The
  path allowlist closes the door (only Swagger/ReDoc paths apply), so
  this is genuinely defence-in-depth. Tighten to `content_type.startswith(b"text/html")`.

---

## Section B — Ingestion & resilience

### HIGH

- **B1 — `databento_live` may block the event loop on iteration**
  [`databento_live.py:600`](backend/app/ingestion/databento_live.py#L600)
  `async for record in client:` — REVIEW.md deferred. Bootstrap uses
  `asyncio.to_thread(client.timeseries.get_range, ...)` (line 499)
  which strongly implies the Historical client is sync, and the Live
  SDK exposes `__aiter__` that bridges sync/async via internal
  threading. If the SDK's iteration internally blocks on a socket
  recv without yielding, this freezes the entire async loop — no
  WS frames, no rate-limiter ticks, no scheduler. **Verification
  required**: in a dev env, run a profiler / `asyncio.all_tasks()`
  while a stream is hot and confirm other coroutines are still
  scheduled. If sync, wrap the iteration body in
  `await asyncio.to_thread(next, client.iter())` or use the SDK's
  documented async client.

### MEDIUM

- **B2 — `BulkUpsertWriter.add_many` acquires the lock per row**
  [`bulk_writers.py:111-113`](backend/app/ingestion/bulk_writers.py#L111).
  `for r in rows: await self.add(r)` — every loop iteration grabs
  `self._lock`. On a 10k-row sweep this is 10k lock acquire/release
  cycles + potentially 10k DLQ write paths. Refactor to a single
  buffer extend under one lock + one possible flush at the end.
  Same applies to `OptionsChainWriter.add_many`
  ([`writer.py:114-116`](backend/app/ingestion/writer.py#L114)).

- **B3 — `_state` cumulative volume not reset on session boundary**
  [`databento_live.py:752-753`](backend/app/ingestion/databento_live.py#L752).
  `state["volume"] = (state.get("volume") or 0) + int(size)` —
  unbounded accumulation across days. The 4h registry refresh GCs
  contracts that fall out of the new registry, but contracts that
  remain in the registry (front-month SPXW) keep accumulating
  forever. REVIEW.md deferred. Either reset in `reset_session_state`
  or trust `stat_type=10` (CUMULATIVE_VOLUME) snapshots and stop
  hand-summing.

- **B4 — MBP snapshot loop writes regardless of book change**
  [`databento_globex.py:738-764`](backend/app/ingestion/databento_globex.py#L738).
  REVIEW.md deferred. `_book_snapshot_loop` flushes every
  `SNAPSHOT_INTERVAL_S=1.0`s whether the book changed or not. ES
  alone publishes ~1 snapshot/s × current contracts → meaningful
  liquidity_snapshots churn. Gate by a `state["dirty"]=True` flag
  set inside `_handle_mbp` and cleared after flush.

### LOW

- **B5 — Hardcoded `_QUOTE_MAX_AGE_S = 5.0`** [`databento_live.py:75`](backend/app/ingestion/databento_live.py#L75).
  Not configurable. 5s is reasonable but on a slow off-hours feed a
  legitimate quote could age out and trades go un-classified for a
  preventable reason. Surface as `INGESTION_QUOTE_STALENESS_SECONDS`
  in `Settings`.

- **B6 — Definition-schema parse failures don't reach DLQ**
  [`databento_live._bootstrap_registry:518-547`](backend/app/ingestion/databento_live.py#L518).
  Per-row `try/except` silently `continue`s on bad strikes/expiries.
  A noisy day on the gateway would erode the registry without any
  audit trail. Route the offending row → DLQ with
  `source="opra_bootstrap"`.

---

## Section C — Processing engine

### HIGH

- **C1 — `spot.synthesize_underlying_price` per-row `df.apply`**
  [`spot.py:217`](backend/app/processing/spot.py#L217).
  ```
  work["mid"] = work.apply(_mid, axis=1)
  ```
  This is the exact anti-pattern called out by `CLAUDE.md` ("New
  per-row `df.apply(...)` patterns over the chain are a regression").
  Runs every pipeline tick, every symbol. SPX snapshot is ~10k rows.
  Fix is one expression:
  ```
  bid = pd.to_numeric(work["bid"], errors="coerce")
  ask = pd.to_numeric(work["ask"], errors="coerce")
  last = pd.to_numeric(work["last_price"], errors="coerce")
  mid = (bid + ask) / 2.0
  good_quote = (bid > 0) & (ask > 0)
  work["mid"] = mid.where(good_quote, last.where(last > 0))
  ```
  Same shape as `iv._row_price` but vectorised; both modules should
  share the helper.

- **C2 — `is_expiration_day` ignores Tue/Thu SPXW expirations**
  [`session.py:56,309-324`](backend/app/processing/session.py#L56).
  `_DEFAULT_EXPIRY_WEEKDAYS = {0, 2, 4}` (Mon/Wed/Fri). CBOE listed
  Tue weekly SPX/SPXW in 2022 and Thu weekly in 2022; both are
  active and traded. The module docstring even says *"Tuesday +
  Thursday expirations are detected automatically when the symbol's
  listed contracts include them"* — but the implementation is a
  static weekday lookup that never inspects the chain. Downstream
  consequences:

  * [`pipeline.py:503`](backend/app/processing/pipeline.py#L503) —
    empty pin payload on a real 0DTE Tue/Thu gets
    `reason="no_0dte_today"` instead of `"empty_pin_result"`
    (incorrect classification of a real partial run).
  * [`pipeline.py:818,899,1132`](backend/app/processing/pipeline.py#L818) —
    `pipeline_runs.is_expiration_day` is False on a real expiry day
    → admin telemetry paints the wrong picture.
  * Consumers reading `session_state.is_expiration_day` from
    `/snapshot` make wrong UI decisions on T/Th.

  The 0DTE compute itself is unaffected — `split_by_expiry` matches
  on the chain's actual `expiration` date — so this is a metadata
  correctness bug, not a metric-math bug. Fix: read the chain's
  earliest expiry from the cached snapshot or from the chain
  loader; if today appears, it's an expiration day, regardless of
  weekday. Add Tue+Thu test cases.

### MEDIUM

- **C3 — `pin_probability` τ-floor differs from vanna_charm**
  [`pin_probability.py:101`](backend/app/processing/pin_probability.py#L101)
  uses `max(1.0/365.0, ...)` (1 day). vanna_charm
  ([`vanna_charm.py:38`](backend/app/processing/vanna_charm.py#L38))
  uses `TAU_FLOOR_YEARS = 15min`. REVIEW.md flagged. Same
  underlying numerical-stability concern, two different
  conventions → inconsistent CHARM_0DTE_LEVEL vs PIN_PROBABILITY
  treatment in the last 60 minutes before close. Standardise on the
  15-min floor (matches the BSM stability boundary; the 1-day floor
  is overly conservative now that 0DTE is the explicit headline
  feature).

- **C4 — `compute_max_pain` per-strike Python loop**
  [`max_pain.py:78-91`](backend/app/processing/max_pain.py#L78).
  `for s_star in strikes: ... np.maximum(s_star - call_strikes, 0.0) * call_oi`.
  Inside the loop, numpy aggregates run vectorised — but the outer
  Python loop iterates ~1000 strikes on SPX. Vectorise via
  broadcasting: `np.maximum(strikes[:, None] - call_strikes[None, :], 0)`
  → one `(n_strikes × n_calls)` matrix multiply. ~50× speedup on
  SPX from a back-of-envelope, similar to the GEX vectorisation
  applied in Rev 5.

- **C5 — `compute_hiro_incremental` naive datetime fallback**
  [`hiro.py:395`](backend/app/processing/hiro.py#L395).
  ```
  cutoff_dt = (now or datetime.utcnow()) - timedelta(...)
  ```
  `datetime.utcnow()` is naive; the merged series carries
  tz-aware ISO strings. The defensive code on lines 400-414 handles
  the mismatch via `replace(tzinfo=...)`, but the lexicographic
  fallback at line 412 silently keeps everything when tz suffixes
  differ. The flow pipeline always passes `now=datetime.now(UTC)`,
  so this never bites in production — but it's a bug-in-waiting and
  ruff would flag the deprecated `utcnow()`. Replace with
  `datetime.now(UTC)`.

- **C6 — `vanna_charm._signed_aggregate` extra `.copy()`**
  [`vanna_charm.py:127`](backend/app/processing/vanna_charm.py#L127).
  REVIEW.md deferred. `work = work.copy()` inside the helper, called
  from both `compute_vanna` and `compute_charm` per tick → 2 extra
  10-MB allocations on SPX per pipeline cycle. The function only
  reads `option_type` and the `value_col`, then writes `_signed`,
  then groupby-sums — the in-place write into the pre-`_prepare`'d
  frame is safe because that frame is already a private copy.

- **C7 — `move_tracker.open_price` wired from loader's stale window**
  [`move_tracker.py:65-67`](backend/app/processing/move_tracker.py#L65).
  Comment is honest — `TODO: wire the 09:30 ET print in from a
  session-open hook`. Right now realized_move at 09:31 ET reads the
  earliest non-null `underlying_price` in the loader's
  `LOADER_SNAPSHOT_WINDOW_HOURS=6h` window — which can be an
  overnight stale tick from yesterday afternoon when the session is
  fresh. `reset_session_state`
  ([`pipeline.py:1094`](backend/app/processing/pipeline.py#L1094))
  is the natural place: capture spot at session-open into a
  module-level dict and let `compute_move_tracker` read from it.

### LOW

- **C8 — `compute_zero_gamma` recursive expansion**
  [`zero_gamma.py:149-160`](backend/app/processing/zero_gamma.py#L149).
  When the ±5% window doesn't cross zero, the function recurses
  with ±12% — duplicating the entire chain prep + grid scan. Refactor
  to compute on the wider window once and intersect with the narrow
  window for the "nearest-to-spot" tiebreak. Minor; the fallback
  path is rare on a healthy chain.

---

## Section D — Database & migrations

Migrations 0001–0010 reviewed in series. Plain-Postgres compatibility is
preserved via `safe_execute_tsdb` and `_has_timescaledb` guards. Migration
0009 (drop redundant index) and 0010 (add `key_lookup` + unique constraint)
are reversible and idempotent. `key_hash` + `key_lookup` both have unique
constraints (Rev 6 added one; the bcrypt one shipped in 0001).

### MEDIUM

- **D1 — `flow_events` lacks `(symbol, ts DESC)` index**
  REVIEW.md deferred. [`models.py:281-284`](backend/app/db/models.py#L281)
  defines `ix_flow_events_symbol_ts` (asc) and 0004
  (`ix_flow_events_symbol_type_ts` asc). Every read in `flow.py` and
  `snapshot.py` is `ORDER BY ts DESC LIMIT N`. With ascending
  indexes Postgres has to walk the whole partition — adds ~5–20ms
  per call at scale. Add `Index("ix_flow_events_symbol_ts_desc",
  "symbol", text("ts DESC"))` and drop the asc one.

### LOW

- **D2 — `databento_api_keys` has no `last_test_at`** —
  `/admin/databento-keys/{id}/test` is currently fire-and-forget.
  Storing the last test timestamp would let the admin UI show
  "tested 5m ago / never" without operator memory.

- **D3 — `dead_letter_queue` not a hypertable** — already noted in
  migration 0007. Operators expected to schedule a periodic
  `DELETE FROM dead_letter_queue WHERE ts < ...`. The
  `ix_dead_letter_queue_ts_only` index makes this cheap. No action;
  documented.

---

## Section E — API surface

### HIGH

- **E1 — `_walls_payload` not migrated to `_latest_metrics_batch`**
  [`snapshot.py:187-188`](backend/app/api/endpoints/snapshot.py#L187),
  [`data.py:231-255`](backend/app/api/endpoints/data.py#L231).
  `_walls_payload(session, sym, "oi")` and the volume variant each
  call `_latest_metrics(session, ...)` 2× (CALL_WALL_OI +
  PUT_WALL_OI; CALL_WALL_VOL + PUT_WALL_VOL). Each `_latest_metrics`
  is a 2-roundtrip pattern (latest_ts then rows). So
  `build_snapshot_payload` pays **8 extra DB round-trips per
  request** on top of the batch read it already collapsed for the
  rest of the metric_types. Fix: extend `_latest_metrics_batch` to
  return the four wall metric_types in the same trip. Same fix
  benefits `/v1/{symbol}/walls`, `/snapshot`, and `/futures-levels`.

### MEDIUM

- **E2 — `inspector.py:_TABLES` does N+1 (count + max)**
  [`inspector.py:96-110`](backend/app/api/endpoints/inspector.py#L96).
  Two queries per table × 8 tables = 16 round-trips. One
  `SELECT count(*), max(ts_col) FROM <table>` collapses each pair to
  one. REVIEW.md MEDIUM-deferred (`approximate_row_count`). The
  collapse is independent of Timescale and lands the win on plain
  Postgres too.

- **E3 — `flow_events_last_hour` count + flow_tail = 2 round-trips**
  [`snapshot.py:357-369`](backend/app/api/endpoints/snapshot.py#L357).
  `select(func.count(...))` + `select(FlowEvent).limit(50)`. Could
  be `OVER()` or `RETURNING`-style single trip. Marginal win, but
  combined with E1 the snapshot envelope drops 9 round-trips.

### LOW

- **E4 — Snapshot endpoint declares `extra="allow"` schemas but
  several payloads (`vanna_total`, `charm_total`, `regime`) are
  loosely-typed `dict[str, Any]`** — the `contracts/types/snapshot.ts`
  is the source of truth for the shape, but the Pydantic
  `DataEnvelope` only verifies `symbol/computed_at/data` — `data` is
  `Any`. Acceptable trade-off given the variability of `extra_json`,
  but it means OpenAPI consumers must consult the TS contract.

---

## Section F — Operational / lifecycle

### LOW

- **F1 — `_install_uvicorn_log_redaction` runs on every lifespan
  start; filter is process-global** [`main.py:398-405`](backend/app/main.py#L398).
  Idempotency guard is correct (`isinstance(f, _RedactSensitiveQueryFilter)`).
  Note the filter is attached to the **root** logger too (line 401:
  `for name in (..., "")`). Any third-party library that logs an
  X-API-Key in error context will pass through the same redactor —
  good. Cosmetic: `_SENSITIVE_QUERY_KEYS` includes `"key"` which
  would also match an unrelated `key=foo` query in some unrelated
  surface. Acceptable false-positive rate.

- **F2 — Pipeline-runs orphan sweep runs every startup**
  [`main.py:84-104`](backend/app/main.py#L84). Fine. One observation:
  the sweep is best-effort and the next status check considers
  anything `status='running'` for >15min as `aborted`. Combined with
  scheduler `max_instances=1` the worst case is a single dangling
  row per process — well-bounded.

- **F3 — `_FUTURES_LAST_QUERY` uses `LIKE :prefix` over the
  hypertable** [`spot.py:381-390`](backend/app/processing/spot.py#L381).
  REVIEW.md deferred. The candidate set is 4–8 contracts max
  (`ES`, `NQ` rolling); switch to
  `WHERE symbol = ANY(:contracts)` and pass the explicit contract
  list from `_FUTURES_ROOT_FOR_SYMBOL`. Faster index hit, cheaper
  plan, and easier to read.

- **F4 — Scheduler RTH gate uses `is_rth_now()` only**
  [`scheduler.py:142`](backend/app/processing/scheduler.py#L142).
  Holiday handling is correct (NYSE-preferred → hardcoded
  fallback). One sharp edge: when `OVERRIDE_RTH_GATE=true`, the
  per-tick `is_rth_now()` is bypassed, but the **session_open /
  session_close hooks** are wall-clock cron jobs — they still fire
  at 09:29 / 16:16 ET regardless. Off-hours dev runs get spurious
  `session_open` audit rows. Acceptable for dev, but worth a one-line
  doc note in `OPS.md`.

---

## Section G — Tests

The Rev 5/6 hardening pass added invariant tests in
`test_pipeline_hardening.py`, `test_processing_hiro.py` (delta-notional +
incremental), and `test_property_hiro_sign.py`. Three high-leverage gaps
remain.

### HIGH

- **G1 — No test for snapshot prime cache TTL/correctness**
  Searched: `_SNAPSHOT_CACHE_TTL`, `get_cached_snapshot`,
  `set_cached_snapshot` — zero matches in `tests/`. The cache is the
  centerpiece of Rev 6 #5 and the contract is "10s TTL, write-through
  from pipeline". Add a test against `app.api.endpoints.snapshot`:
  set, `get_cached_snapshot` → hit; advance `monotonic` past TTL →
  miss; pipeline write-through populates a fresh cache. Pure-function
  test — no DB needed.

- **G2 — No test for `key_lookup` fast-path or lazy backfill**
  Auth path in `deps.py:165-191` and `stream.py:135-159` is not
  exercised. Add: (a) a row with NULL `key_lookup` authenticates
  via the prefix-scan fallback **and** the row's `key_lookup` is
  backfilled afterwards; (b) a row with the digest pre-populated is
  matched in O(1) and bcrypt is called exactly once. DB-backed,
  belongs alongside `test_api_auth.py`.

- **G3 — No test asserting WS revocation closes with code 4401**
  `test_streaming_api.py:test_sse_stream_revocation` ends a stream
  but never asserts the close code. Add a WS test that opens a
  connection, flips `is_active=False` on the row, and asserts the
  client sees `WebSocketDisconnect.code == 4401`.

### MEDIUM

- **G4 — No test for the 0DTE-on-non-0DTE-day persistence rule**
  `pipeline.EXPECTED_METRIC_TYPES` requires every 0DTE metric_type
  to be persisted **even on non-0DTE days** with `value=0` and
  `extra_json.reason="no_0dte_today"`. The test would reach into
  `_persist_metrics` with a `ZeroDteSummary(has_0dte=False)` and
  assert all eight `GEX_0DTE*` / `CHARM_0DTE*` / `GEX_0DTE_FLIP_SPEED`
  rows are present in the persisted set. Cheap to add.

- **G5 — No test for HIRO incremental == HIRO full when warm**
  `test_processing_hiro.py:197` only tests `prev_series=None`. The
  defining incremental invariant — *"calling
  `compute_hiro_incremental` on a warm cache equals
  `compute_hiro` on the full window"* — is not pinned. Cross-path
  agreement test would catch any future divergence.

- **G6 — No test for DLQ payload roundtrip**
  `test_dlq_and_backpressure.py` exercises the in-memory ring buffer
  but not the JSONB persistence path with messy payloads
  (datetime objects, nested dicts, unicode strings). The
  `record_dlq` -> `flush()` -> read-back path matters because all
  failed bulk-writer batches funnel through here.

### LOW

- **G7 — Property test depth** — `test_property_hiro_sign.py` covers
  the 4-case sign matrix at ~480 examples. Worth pinning the
  `next_expiry` isolation invariant as a property too: for any
  set of trades with mixed expirations, the
  `next_expiry_delta_notional` always equals the
  `delta_notional` filtered to `expiration == min(expirations)`.

- **G8 — Conftest container fallback** — `_try_start_testcontainer`
  silently returns `None` when Docker isn't available. CI
  visibility would improve with a structured skip reason printed
  once at session start ("postgres testcontainer skipped: docker
  unreachable") — currently the 34 skips are opaque.

---

## Cross-cutting recommendations

1. **Surface `weight_source` provenance everywhere.** GEX does it,
   walls don't, HIRO does it. Make this a project rule: any metric
   with a fallback chain MUST persist `weight_source` in
   `extra_json`. The regime score depends on walls — silently
   computed off uniform-fallback walls is a measurement-correctness
   issue. (A1)

2. **One last anti-pattern sweep.** `df.apply(axis=1)` survives in
   `spot.synthesize_underlying_price` (C1). Add a CI grep:
   `! grep -RnE "\.apply\([^)]*axis\s*=\s*1\)" app/processing app/ingestion`.
   If a future module adds one the build fails.

3. **Standardise τ floors.** `TAU_FLOOR_YEARS = 15min` in
   `vanna_charm` is the right floor for a 0DTE dashboard.
   `pin_probability` floors at 1 day. Pull both behind a single
   constant in `session.py` and import. (C3)

4. **Collapse remaining N+1 query sites** (E1 + E2 + E3): the
   remaining round-trip costs are concentrated in three call sites
   that share the same `_latest_metrics` legacy pattern. Single
   refactor, ~9 round-trip reduction per snapshot, no observable
   behavior change.

5. **Pin the post-Rev 6 contract with three small tests** (G1 + G2
   + G3). Each is < 30 LOC; collectively they cover the hardening
   surface that has zero invariant pinning today.

6. **Verify the Databento Live SDK iteration model** (B1). One
   end-to-end test (or `asyncio.all_tasks()` snapshot during a hot
   stream) settles whether B1 is a real production blocker or a
   non-issue documented away.

---

## Out of scope / deferred (not flagged here)

* `Numeric(30, 8) → double precision` migration on
  `computed_metrics.value` — REVIEW.md deferred. Migration cost real,
  bottleneck has moved.
* HIRO retail-vs-institutional split — proprietary classifier
  needed. Deferred indefinitely.
* `approximate_row_count` swap on inspector — folded into E2.
* JWT `aud`/`iss`/`nbf` — A5 above; LOW.
* Frontend redesign — explicitly out of scope; this pass is
  backend-only.

---

## Files referenced

```
backend/app/api/deps.py
backend/app/api/endpoints/data.py
backend/app/api/endpoints/inspector.py
backend/app/api/endpoints/snapshot.py
backend/app/api/endpoints/stream.py
backend/app/core/security.py
backend/app/db/models.py
backend/app/db/migrations/versions/20261201_0000_0009_drop_redundant_metric_index.py
backend/app/db/migrations/versions/20270115_0000_0010_api_key_lookup.py
backend/app/ingestion/bulk_writers.py
backend/app/ingestion/databento_globex.py
backend/app/ingestion/databento_live.py
backend/app/ingestion/writer.py
backend/app/main.py
backend/app/processing/hiro.py
backend/app/processing/max_pain.py
backend/app/processing/move_tracker.py
backend/app/processing/pin_probability.py
backend/app/processing/pipeline.py
backend/app/processing/scheduler.py
backend/app/processing/session.py
backend/app/processing/spot.py
backend/app/processing/vanna_charm.py
backend/app/processing/walls.py
backend/app/processing/zero_gamma.py
backend/tests/conftest.py
backend/tests/test_pipeline_hardening.py
backend/tests/test_processing_hiro.py
backend/tests/test_streaming_api.py
```
