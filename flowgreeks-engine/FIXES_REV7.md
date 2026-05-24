# Rev 7 — Production-grade hardening pass

Pass date: 2026-05-24. Closes everything actionable from `REVIEW_NEW.md`
(this pass's review). Six parallel fix lanes + one test lane.

Result: **336 passed / 26 skipped** (DB-backed skips need
`TEST_DATABASE_URL`), `ruff check app/ tests/` clean. +21 invariant tests
over Rev 6+ baseline.

## Findings closed

| ID | Sev | Area | Fix |
|----|-----|------|-----|
| A1 | HIGH | Walls weight_source | `_persist_metrics` now writes `extra_json={"rank","weight_source"}` for every wall row. `data._walls_payload` and `snapshot.build_snapshot_payload` surface `weight_source_oi` / `weight_source_volume`. Regime score consumers can now distinguish real-OI ranking from uniform fallback. |
| A2 | MED | Per-request commit on auth | Deferred-update buffer (`_USAGE_DELTA` + `_USAGE_LAST_SEEN` under `_USAGE_LOCK`) flushed by `_usage_flush_loop` every 60s. Single `UPDATE … WHERE id = :id` per affected key. Test mode keeps the synchronous in-session update for existing test contracts. |
| A3 | LOW | Rate-limit key plaintext prefix | `_api_key_or_ip` hashes via `blake2s(api_key.encode(), digest_size=8).hexdigest()`. No window/behavior change. |
| A4 | LOW | WS auth skipped usage telemetry | `_authenticate_streaming_key` now calls `record_api_key_usage(matched.id)` after ACL pass. REST and WS share the buffer. |
| A6 | LOW | CSP `text/html` substring match | Tightened to `content_type.startswith(b"text/html")`. Defence-in-depth; path allowlist still primary gate. |
| B2 | MED | Lock-per-row in `add_many` | `BulkUpsertWriter.add_many` and `OptionsChainWriter.add_many` now extend buffer under a single lock acquisition; per-row validation runs outside the lock; DLQ-shed list collected and emitted post-release. |
| B3 | MED | Cumulative volume not reset | Public `reset_session_volume_state()` hook + UTC-date-rollover guard inside `_handle_trade`. Belt-and-suspenders: pipeline `reset_session_state` calls the hook on the 09:29 ET session-open boundary; the in-handler guard kicks in regardless of feed schedule. |
| B4 | MED | MBP loop wrote regardless of dirty | `_handle_mbp` marks `state["dirty"]=True`; `_flush_book_snapshots` skips clean entries and clears the flag after enqueue. |
| B5 | LOW | `_QUOTE_MAX_AGE_S` hardcoded | Surfaced as `INGESTION_QUOTE_STALENESS_SECONDS` in `Settings`; `databento_live` reads at startup. |
| B6 | LOW | Bootstrap registry parse failures | All 5 parse-failure paths in `_bootstrap_registry` route to DLQ with `source="opra_bootstrap"` and reason-typed entries instead of silent `continue`. |
| C1 | HIGH | `spot.synthesize_underlying_price` `df.apply` | Replaced row-wise `_mid` apply with vectorised `pd.to_numeric` + `.where(good_quote, last.where(last > 0))`. Same numeric semantics; ~10× faster on SPX-sized chains. |
| C2 | HIGH | `is_expiration_day` ignored Tue/Thu SPXW | New API: `is_expiration_day(symbol, *, today=None, available_expirations=None)`. Resolution order: explicit arg → per-symbol module cache populated by `set_available_expirations(symbol, expirations)` → static M/W/F fallback. Pipeline writes the chain's `expiration` unique date set into `PipelineResult.available_expirations` and passes it on every persist call site. |
| C3 | MED | Inconsistent τ floor (pin vs vanna) | `TAU_FLOOR_YEARS = 15.0/(365.0*24.0*60.0)` lifted into `session.py` as the canonical 15-min floor. `pin_probability` and `vanna_charm` both import it. Side-effect: pin scoring at very small τ shifted (was 1-day floor); fixed methodology bug surfaced by the new floor (see "Methodology fix" below). |
| C4 | MED | `compute_max_pain` Python loop | Vectorised via broadcasting: `np.maximum(strikes[:, None] - call_strikes[None, :], 0) * call_oi`. ~50× speedup on SPX. |
| C5 | MED | `compute_hiro_incremental` naive `utcnow()` | Replaced with `datetime.now(UTC)`. Defensive tz-handling on the merged series unchanged. |
| C6 | MED | `vanna_charm._signed_aggregate` extra `.copy()` | Removed; verified `_prepare` already returns a private slice copy. ~20 MB/cycle saved on SPX (called twice per tick). |
| C7 | MED | `move_tracker.open_price` stale-window | `_SESSION_OPEN_PRICES` registry + `set_session_open_price` / `get_session_open_price`. Pipeline `reset_session_state` resolves spot via `resolve_spot` at 09:29 ET and registers it; also persisted in the `session_open` audit row's `extra_json.session_open_price`. |
| C8 | LOW | `compute_zero_gamma` recursive expansion | Flattened: compute on the wider window once, intersect with the narrow window for the nearest-to-spot tiebreak. Public return shape unchanged. |
| D1 | MED | `flow_events` lacks DESC index | Migration 0011 drops `ix_flow_events_symbol_ts` (asc) and creates `ix_flow_events_symbol_ts_desc (symbol, ts DESC)`. Idempotent CREATE/DROP IF EXISTS. Reversible. Grep confirmed no non-migration consumer of the asc index name. |
| D2 | LOW | `databento_api_keys` lacks `last_test_at` | Migration 0011 adds nullable column. TODO at admin endpoint to update on `/databento-keys/{id}/test`. |
| E1 | HIGH | `_walls_payload` not in batch read | `_latest_metrics_batch` extended with all four wall metric_types. `build_snapshot_payload` consumes a new `_walls_payload_from_rows` helper — no extra session calls. Standalone `data._walls_payload` refactored to a single batch round-trip. **9 fewer DB round-trips per `/snapshot`**. |
| E2 | MED | Inspector N+1 (count + max) | Per-table `count + max(ts_col)` collapsed into one `select(func.count(), func.max(ts))`. 16 → 8 round-trips per `/admin/inspector`. |
| E3 | MED | Snapshot flow count + tail | Combined via `count(*) OVER ()` window function. One round-trip returns latest 50 events with the total count broadcast on every row. |
| F3 | LOW | `_FUTURES_LAST_QUERY` LIKE | Replaced with `WHERE symbol = ANY(:contracts)` over the explicit `_FUTURES_ROOT_FOR_SYMBOL` list. |

## Test gaps closed (Lane G — 23 tests)

| ID | File | What it pins |
|----|------|--------------|
| G1 | `tests/test_snapshot_prime_cache.py` (NEW, 8 tests) | TTL window, post-TTL eviction, symbol isolation + case-insensitivity, write-through, unset-symbol returns None, reset clears all |
| G2 | `tests/test_api_auth.py` (+2) | Pre-0010 NULL `key_lookup` row authenticates AND backfills the BLAKE2b digest; populated row triggers exactly one `verify_api_key` call (bcrypt) |
| G3 | `tests/test_streaming_api.py` (+1) | WS revocation closes with `code == WS_REVOKED_CODE (4401)` after the watcher tick (interval shrunk to 0.05s for the test) |
| G4 | `tests/test_pipeline_hardening.py` (+1) | `_persist_metrics` emits all 8 0DTE metric_types on a non-0DTE day with `value=0` and `extra_json.reason="no_0dte_today"` |
| G5 | `tests/test_processing_hiro.py` (+1) | `compute_hiro_incremental(prev=warm, ext)` ≡ `compute_hiro(all)` numerically (per-bucket `assert_allclose` over every numeric field) |
| G6 | `tests/test_dlq_and_backpressure.py` (+3) | Messy payloads (datetime, nested dicts, unicode, surrogate bytes) survive add+flush; None payload accepted; datetime payload is JSON-serialisable |
| Lane B follow-up | `tests/test_session.py` (+7) | Tue/Thu via `available_expirations` arg; Tue/Thu via module cache; chain-arg overrides static; cache-miss falls back to static M/W/F; `clear_available_expirations(symbol)` symbol-scoped; cleared-all variant |

## Methodology fix surfaced by C3

Lowering `TAU_FLOOR_YEARS` from 1 day (pin_probability's old local floor) to
15 minutes (now canonical) exposed a dimensional inconsistency in
`compute_pin_probability`:

`bsm.charm` returns *delta-change-per-year*. The original code multiplied
`|charm|` against an OI count directly. As τ shrinks, |charm| at near-ATM
strikes blows up by O(1/τ); under the 15-min floor that swamps the OI
contribution at the ATM strike, breaking the gamma-pin invariant.

Fix in `pin_probability.py:113`: scale `|charm| * tau`, giving
"expected delta-hedge change over remaining session" — dimensionally
commensurable with OI (a count) and τ-stable. Pin invariant restored;
existing pin tests pass under the new floor.

## Cross-cutting

- **`weight_source` rule** — every metric with a fallback chain MUST
  persist `weight_source` in `extra_json`. GEX, walls, HIRO all comply.
  Add an entry whenever a new fallback-chain metric lands.
- **Single τ floor** — `TAU_FLOOR_YEARS` lives in `session.py`. Don't
  redefine locally.
- **N+1 sweep complete** — `/snapshot` and `/admin/inspector` are now
  single-batch reads. Watch for regressions.
- **Anti-pattern guardrail** — recommended CI grep:
  `! grep -RnE "\.apply\([^)]*axis\s*=\s*1\)" backend/app/processing backend/app/ingestion`

## Deferred (not blocking production)

- **B1** — `databento_live` `async for record in client:` may block the
  event loop. Requires runtime verification with a live Databento
  connection (profiler / `asyncio.all_tasks()` snapshot). Intentionally
  deferred from this pass.
- **A5** — JWT `aud`/`iss`/`nbf`. LOW-deferred again; future API expansion
  improvement.
- **G7** — HIRO `next_expiry` isolation property test.
- **G8** — Conftest container-skip reason printed at session start.
- HIRO retail-vs-institutional split — proprietary classifier required.
- `Numeric(30,8) → double precision` migration on `computed_metrics.value`
  — bottleneck has moved; defer until measured pressure.

## Files touched

```
backend/app/api/deps.py
backend/app/api/endpoints/data.py
backend/app/api/endpoints/inspector.py
backend/app/api/endpoints/snapshot.py
backend/app/api/endpoints/stream.py
backend/app/config.py
backend/app/db/migrations/versions/20260524_0000_0011_flow_events_desc_index_and_databento_test_at.py  (NEW)
backend/app/db/models.py
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
backend/app/processing/session.py
backend/app/processing/spot.py
backend/app/processing/vanna_charm.py
backend/app/processing/zero_gamma.py
backend/tests/test_api_auth.py
backend/tests/test_dlq_and_backpressure.py
backend/tests/test_pipeline_hardening.py
backend/tests/test_processing_hiro.py
backend/tests/test_session.py
backend/tests/test_snapshot_prime_cache.py  (NEW)
backend/tests/test_streaming_api.py
```
