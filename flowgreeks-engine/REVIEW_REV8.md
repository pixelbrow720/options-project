# Deep Review — Rev 8 (4-lens audit, post Rev 7)

Pass date: 2026-05-24. Four parallel review lenses run independently:
**architectural** (ARCH-*), **concurrency / operational** (OPS-*),
**adversarial security** (SEC-*), **numerical / quant** (NUM-*).

Rev 7 closed 24 file-level findings. Rev 8's job is to find what
file-level review missed: integration semantics, runtime behaviour
under load and failure, attacker-model surface, math at boundaries.

## Executive summary

| Severity | Count | Examples |
|----------|-------|----------|
| CRITICAL | 7 | ARCH-1 (Rev 7 C2 fix half-landed), OPS-1/2/3 (live ingester self-kill, half-day, EOD OI mis-date), NUM-1/2/3 (0DTE Greeks systematically wrong via 1-day τ floor in IV inversion) |
| HIGH     | 13 | ARCH-2/3/4/5/6 (run-finalize, streaming publish, pool peak, cold-start state, watcher fan-out), OPS-4/5/6/7/8/9 (single-flight, batch-flush, kill -9, session-open silent fallback, DST cron, head-of-line flush), SEC-1/2 (bcrypt amplification on legacy NULL key_lookup, no JWT server-side revocation), NUM-4/5 (pin charm-scaling over-correction, far-OTM 0DTE gamma underflow) |
| MEDIUM   | 15 | ARCH-7/8/9/10, OPS-10/11/12/13/14, SEC-3/4/5/6, NUM-6/7/8 |
| LOW      | 10 | SEC-7..12, NUM-9, ARCH cosmetics |

Full per-finding reports retained in agent transcripts. The closure log
is `FIXES_REV8.md`.

---

## CRITICAL — production blockers

### ARCH-1 — `set_available_expirations` is dead code; Rev 7 C2 only half-lands
- Defined `session.py:323`, called from **zero** non-docstring sites.
- All non-PIN_PROBABILITY callers fall through to static M/W/F fallback:
  - `pipeline.py:828` → `session_snapshot` → `pipeline_runs.is_expiration_day`
  - `pipeline.py:1175,1216` → session_open / session_close audit
  - `snapshot.py:351` → every `/snapshot` and WS frame's `session_state`
- On Tue/Thu SPXW expiry, telemetry/audit/WS lie. Frontend reads the lie.
- Fix shape: pipeline calls `set_available_expirations(symbol, result.available_expirations)` after `_compute_metrics`, before persist.

### OPS-1 — Live ingester self-kills after ~3min outage
- `databento_live.py:432-440`. `MAX_RECONNECTS=5` × exponential backoff (2s → 60s cap, cumulative ~120-180s) → `self._dead = True`. Recovery requires manual `reset_after_terminal()`.
- Routine network blip = OPRA permanently down until operator intervenes.
- Fix shape: unbounded backoff with longer cap (5min); auto-reset after idle window; pager metric on `live_ingester.terminated`.

### OPS-2 — Half-day market closes (13:00 ET) not handled
- `session.py:107-110` explicitly notes half-days are NOT treated specially.
- `RTH_CLOSE_TIME=16:15` hardcoded.
- On 2026-11-27 (day after Thanksgiving), pipeline runs OK against frozen book for ~3.25 hours past close. `pipeline_runs.status='ok'` is false-positive.
- Fix shape: half-day calendar primitive in `session.py` (e.g. `early_close_at(today)`); pipeline downgrades to `partial` after early close.

### OPS-3 — `eod_oi_daily` mis-dates rows on holidays
- `databento_eod_oi.py:124`: `oi_date = datetime.now(UTC).date()` unconditional.
- 22:30 UTC cron fires every day. On a holiday, prior trading day's OI gets stamped with today's date. The idempotency guard then blocks tomorrow's pull. Walls/GEX use stale-but-mis-dated weights.
- Fix shape: gate on `_is_business_day(today)` AND derive `oi_date` from source `ts_event`.

### NUM-1 — 0DTE IV inversion uses 1-day τ floor
- `iv.py:259-266`: `_years_to_expiry` returns `max(1, days)/365`.
- Every 0DTE IV inversion runs at τ=2.74e-3 (1 day) regardless of clock.
- 13:00 ET 0DTE: real τ=3.71e-4. ATM call $5 → solver finds σ≈4% vs real σ≈11%. **σ understated ~3×** for the entire 0DTE band all afternoon.
- Cascade: pin_probability, term_structure ATM IV, IV surface — all contaminated.
- Fix shape: when `expiration == today`, swap in `time_to_expiry_0dte_years(now=...)`, floor at canonical `TAU_FLOOR_YEARS`.

### NUM-2 — 0DTE filled gamma uses 1-day τ
- `iv.py:362-372`. `bsm.gamma(S, K, T, σ)` with `T=days/365`.
- γ ∝ 1/(S·σ·√τ). At 13:00 ET 0DTE: filled γ is ~37% of reality.
- `compute_gex(weight_col="oi", chain)` reads `df["gamma"]` directly — no τ override path. **0DTE GEX_OI rows systematically under-reported by ~3× through the afternoon**, biggest at close. The dashboard's "0DTE gamma squeeze" reading is muted.
- Fix shape: when filling Greeks, recompute τ per-row using session-aware τ when `expiration == today_eastern()`.

### NUM-3 — `compute_zero_gamma` on 0DTE-heavy chain uses 1-day τ
- `zero_gamma.py:90`: `work["tau"] = calendar_tau_years(...)` (default `floor_days=1`).
- For 0DTE rows the gamma grid is computed at τ=2.74e-3 instead of session-aware. Crossing point shifts. On 0DTE-OI-dominated chains (afternoon SPX), the reported flip is a calendar-floor artifact.
- Fix shape: pass session-aware τ override mirroring `vanna_charm`'s pattern.

---

## HIGH

| ID | One-liner | File:line |
|----|-----------|-----------|
| ARCH-2 | Pipeline_run finalize can silently fail; audit row stuck `running` 15min | pipeline.py:740,770 |
| ARCH-3 | `_publish_streaming_snapshot` failure logged but pipeline status stays `ok` | pipeline.py:933-937 |
| ARCH-4 | Connection-pool peak ~16 sessions for chain stage alone × 4 symbols | scheduler / pipeline |
| ARCH-5 | Module-state cold-start on mid-session restart (basis EMA, flip_speed, session-open price) | various |
| ARCH-6 | WS revocation watcher = 1 DB roundtrip per connection per 30s; same key polled by N watchers | stream.py:340 |
| OPS-4 | Snapshot prime cache has no single-flight; cold-cache reconnect storm = N parallel batch reads | snapshot.py:56-86 |
| OPS-5 | Deferred usage flush issues N round-trips serially (1k keys × 60s) | deps.py:211-218 |
| OPS-6 | `kill -9` loses up to 60s of usage_count | deps.py:172 |
| OPS-7 | `reset_session_state` silently falls back to overnight-stale price if GLBX offline at 09:29 ET | pipeline.py:1138-1148 |
| OPS-8 | DST/half-day cron offsets use modulo wraparound | scheduler.py:204-217 |
| OPS-9 | `BulkUpsertWriter.flush` head-of-line on slow DB; inline flush from `add()` | bulk_writers.py:146-185 |
| SEC-1 | Bcrypt amplification DoS on legacy `key_lookup IS NULL` rows; attacker pins core via known prefix | deps.py:284-304, stream.py:135-151 |
| SEC-2 | Admin JWT has no server-side revocation; 8h leak window | security.py:121-141 |
| NUM-4 | pin_probability Rev 7 fix (`\|charm\|·τ`) over-correcting — charm contribution 6 OOM smaller than OI | pin_probability.py:122 |
| NUM-5 | Far-OTM 0DTE gamma silently zeros via `φ(d1)` underflow at \|d1\|>36 | bsm.py:53 |

---

## MEDIUM

| ID | One-liner |
|----|-----------|
| ARCH-7 | `_publish_streaming_snapshot` re-reads DB it just wrote — pure waste |
| ARCH-8 | `_USAGE_LOCK` constructed at module import; future cross-loop call would silently break |
| ARCH-9 | Stale-spot signal not lifted to envelope `next_update_in_seconds` |
| ARCH-10 | `_AVAILABLE_EXPIRATIONS` cache has no eviction (bounded by `len(supported_symbols)` — flagged for completeness) |
| OPS-10 | `dead_letter_queue` table grows unbounded; no retention/cleanup |
| OPS-11 | DLQ ring evictions counted but not paged |
| OPS-12 | `pipeline_partial` accumulation has no alerting hook |
| OPS-13 | Stale-spot cache silent for up to 5min; not surfaced to clients |
| OPS-14 | No anti-storm on 4401 close — buggy client can tight-loop reconnect |
| SEC-3 | Auth-failure response enumerates state (revoked vs expired vs ACL-deny) |
| SEC-4 | No request-body size cap (100MB body parse on `/admin/login`) |
| SEC-5 | `hmac.compare_digest` length-dependent timing leak on plaintext admin password path |
| SEC-6 | WS revocation polled every 30s — revoked key keeps streaming up to 30s |
| NUM-6 | τ-year unit drift across modules (365 vs 365.25 vs 252) |
| NUM-7 | `term_structure._delta_iv` no proximity threshold — reports 50Δ as 25Δ on sparse expiry |
| NUM-8 | pin_probability gaussian over-smooths last 15 min via floored τ in σ_pts |

---

## LOW

| ID | One-liner |
|----|-----------|
| SEC-7 | `/admin/databento-keys/{id}/test` leaks Fernet exception class and stale `JWT_SECRET` hint |
| SEC-8 | Log redaction misses URL-encoded sensitive keys (`%6Bey=`) |
| SEC-9 | `/health` discloses `supported_symbols` and per-symbol last-compute anonymously |
| SEC-10 | `/admin/api-keys/{id}` DELETE is hard-delete with no audit row |
| SEC-11 | Lazy `key_lookup` backfill only on success — failed auths never advance migration |
| SEC-12 | `ApiKeyCreate.allowed_symbols` not constrained to `SUPPORTED_SYMBOLS` |
| NUM-9 | HIRO incremental `cumulative` field re-summed on bucket overlap (restart/replay path) |

---

## Confirmed-OK across all four lenses

- BLAKE2b lookup key is a domain-separation constant (not a secret); cannot forge `key_hash`
- JWT alg-confusion closed (single-algorithm decode list)
- WS connection cap atomic via `_ws_lock`
- Snapshot notifier queue bounded with drop-oldest
- APScheduler `max_instances=1, coalesce=True` prevents tick backlog
- Pipeline persist atomic (single INSERT ON CONFLICT with explicit rollback)
- `_persist_metrics` correctly emits 0DTE rows on non-0DTE days (G4 test pinned)
- HIRO incremental == full when warm (G5 test pinned)
- DLQ ring buffer roundtrips messy payloads (G6 tests pinned)
- `flush_usage_deltas` swaps under lock and releases before issuing UPDATE
- Bulk-writer `add_many` regression closed (Rev 7 B2)
- `bsm.charm` call/put algebra matches Hull §19
- `compute_max_pain` vectorized matches loop on edge tie
- `regime` deadband clean (no state-dependent hysteresis)
- Symbol path regex blocks `..%2f`; SQL fully parameterized
- Constant-time admin login still holds (Rev 5)
- CSP `'unsafe-inline'` gated by both path allowlist AND `startswith(b"text/html")`

---

## Files referenced

```
backend/app/api/deps.py
backend/app/api/endpoints/admin.py
backend/app/api/endpoints/health.py
backend/app/api/endpoints/snapshot.py
backend/app/api/endpoints/stream.py
backend/app/api/schemas.py
backend/app/core/security.py
backend/app/db/models.py
backend/app/ingestion/bulk_writers.py
backend/app/ingestion/databento_eod_oi.py
backend/app/ingestion/databento_live.py
backend/app/ingestion/dlq.py
backend/app/ingestion/writer.py
backend/app/main.py
backend/app/processing/bsm.py
backend/app/processing/hiro.py
backend/app/processing/iv.py
backend/app/processing/move_tracker.py
backend/app/processing/pin_probability.py
backend/app/processing/pipeline.py
backend/app/processing/scheduler.py
backend/app/processing/session.py
backend/app/processing/spot.py
backend/app/processing/term_structure.py
backend/app/processing/vanna_charm.py
backend/app/processing/zero_dte.py
backend/app/processing/zero_gamma.py
```
