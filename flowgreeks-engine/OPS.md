# OPS.md — Operator Runbook

This document covers operational tasks for **pantek-waang** that go beyond
"docker compose up". Read it before deploying to a real environment.

The audience is the operator who manages secrets, runs migrations, watches
logs, and rotates credentials.

---

## 1. Initial deployment checklist

Before exposing the service publicly:

```bash
cp .env.example .env
```

Then edit `.env` and set, at minimum:

| Var | Why |
|-----|-----|
| `DATABENTO_API_KEY_OPRA` | Required for live + historical OPRA Pillar (options chain). Skip via `DISABLE_LIVE_INGESTION=true` and `DISABLE_HISTORICAL_BACKFILL=true` only for dev. |
| `DATABENTO_API_KEY_GLOBEX` | Required for GLBX.MDP3 (CME futures tape). |
| `ADMIN_PASSWORD` | **Refuses to boot at default.** Use a strong value or a bcrypt hash starting with `$2`. |
| `JWT_SECRET` | **Refuses to boot at default.** ≥ 32 chars random. HMAC signing key for admin sessions. |
| `DB_ENCRYPTION_KEY` | At-rest encryption for the Databento key pool (`databento_api_keys.api_key_encrypted`). See section 3. |
| `ADMIN_CORS_ORIGINS` | Comma-separated origins allowed to call the API from a browser. Never leave `*` in production. |
| `ENABLE_OPENAPI_DOCS` | `false` in production removes `/docs`, `/redoc`, `/openapi.json` from the public surface. |
| `LOADER_SNAPSHOT_WINDOW_HOURS` | Default `6`. Raise toward `48` only if your feed has multi-hour gaps; tighter = less hypertable scan cost per pipeline tick. |

Then:

```bash
docker compose up --build
```

The backend container runs `alembic upgrade head` automatically on startup.
Verify the boot banner does not WARN about default secrets.

---

## 2. Migrations

Alembic versions live in `backend/app/db/migrations/versions/`. The two
operationally-meaningful upgrades since the original Rev 4 are:

* **0009** — drops the redundant `ix_computed_metrics_symbol_type_ts` index. Halves write amplification on metric upserts. No data change; safe to roll forward and back.
* **0010** — adds `api_keys.key_lookup` (keyed BLAKE2b digest column with a unique constraint) for O(1) API-key lookup. Backward-compatible: existing rows have `NULL` `key_lookup`; the auth path lazily backfills on first successful verify.

Apply manually if Alembic auto-run is disabled:

```bash
docker exec -it ofa-backend alembic upgrade head
```

### 2a. Eager backfill of `key_lookup` (recommended at scale)

The lazy backfill works fine, but if you have many active API keys and want
the unique-index path active for every key immediately (so one
prefix-collision row doesn't pay extra bcrypt verifies), run a one-shot
backfill **after** applying migration 0010.

You only need this if you can present the **plaintext** key — bcrypt is
one-way. In practice that means:

1. **Keep the plaintext temporarily.** When you create a new key via
   `/admin/api-keys`, the response shows the plaintext **once**. If you
   captured it, run:

   ```python
   import hashlib
   _KEY = b"pantek-waang.api-key-lookup.v1"
   digest = hashlib.blake2b(plaintext.encode("utf-8"), key=_KEY, digest_size=32).hexdigest()
   ```

   Then `UPDATE api_keys SET key_lookup = '<digest>' WHERE id = '<id>'`.

2. **Otherwise: rotate.** For keys whose plaintext is lost, the operationally
   sound path is to issue replacement keys through `/admin/api-keys` (which
   populates `key_lookup` on create), distribute them, and revoke the old
   ones. The lazy-backfill behaviour ensures no traffic disruption while
   you do this.

If you don't backfill at all, nothing breaks — the auth path simply scans
the prefix index for `key_lookup IS NULL` rows and writes the digest on
first verify. Throughput goes up automatically as keys are used.

---

## 3. `DB_ENCRYPTION_KEY` rollout

`databento_api_keys.api_key_encrypted` is Fernet-encrypted with a key
derived from `DB_ENCRYPTION_KEY` (HKDF-SHA-256, salt `pantek-waang.crypto.v1`).

**Pre-Rev 6 deployments derived this key from `JWT_SECRET`.** Rev 6
introduced a separate `DB_ENCRYPTION_KEY` so JWT rotation no longer
invalidates the encrypted Databento pool. The fallback chain is:

1. `DB_ENCRYPTION_KEY` if set
2. `JWT_SECRET` if `DB_ENCRYPTION_KEY` is empty (legacy compat)

### 3a. Rolling out on an existing deployment

If you have encrypted Databento keys in your DB (added via
`/admin/databento-keys`), do this **once**, in order:

1. Set `DB_ENCRYPTION_KEY` in `.env` to the **current value of `JWT_SECRET`**. This keeps the derivation identical, so existing encrypted rows still decrypt cleanly.

   ```bash
   # Inside the host shell
   echo "DB_ENCRYPTION_KEY=$(grep '^JWT_SECRET=' .env | cut -d= -f2-)" >> .env
   ```

2. Restart the backend.

3. Verify: open the admin dashboard → Databento Keys → click "Test" on each row. They should all return `ok: true`. If they don't, the secret values diverged — restore from backup before going further.

4. **Now** you can rotate `JWT_SECRET` freely. The Databento pool stays decryptable as long as `DB_ENCRYPTION_KEY` doesn't change.

### 3b. Rotating `DB_ENCRYPTION_KEY` itself

There is **no in-place re-encryption job**. To rotate the at-rest key:

1. Open admin → Databento Keys. Note every label + dataset + plaintext (you'll need to re-paste the plaintexts).
2. Rotate `DB_ENCRYPTION_KEY` in `.env`.
3. Restart the backend.
4. Existing rows now fail to decrypt. The ingester will start failing over through them, mark them with `error_count`, and eventually skip them. **Manually delete each old row** via `DELETE /admin/databento-keys/{id}` — they are dead weight.
5. Re-create each key via `POST /admin/databento-keys` with the same label / dataset / priority / plaintext. They get encrypted with the new key.

Do this during a maintenance window — the ingester degrades to env-var keys
during the rotation if the env keys are still set.

### 3c. Detecting a misconfigured `DB_ENCRYPTION_KEY`

Symptoms:
* Live ingester logs `live_ingestion_record_key_error_failed` or auth errors against rows that used to work.
* Admin → Databento Keys "Test" returns `ok: false` with `Invalid token`.
* `databento_api_keys.error_count` rapidly rising on every row.

Recovery: confirm `DB_ENCRYPTION_KEY` matches the value used at the time
the rows were encrypted. If lost, fall back to environment-only credentials
(`DATABENTO_API_KEY_OPRA`, `DATABENTO_API_KEY_GLOBEX`) and re-create the
DB pool from scratch.

---

## 4. Observability

### 4a. Built-in admin telemetry

Without external metrics tooling, the source of truth is
`GET /admin/system/status`:

* `pipeline_running` — boolean. False ⇒ scheduler stopped.
* `last_compute_per_symbol[<symbol>]` — last successful pipeline tick per symbol. Stale > `2 × COMPUTE_INTERVAL_SECONDS` ⇒ pipeline stuck.
* `opra_lag_ms` / `futures_lag_ms` — `now - max(table.ts)`. Stale > `FUTURES_FEED_LAG_WARN_MS` ⇒ feed gap.
* `dlq_pending` — count in `dead_letter_queue`. Sustained growth ⇒ ingester dropping rows. Drill into `/admin/inspector/dlq` for samples.
* `last_pipeline_runs[]` — most recent run per symbol with `status` ∈ `{ok, partial, failed}`. Persistent `partial` ⇒ check `missing_metric_types`.
* `live_ingester` block — record counters by type, schemas active/dropped, sample record attrs, registry size, terminal-failure flag.

A 30s admin-dashboard polling loop on this endpoint is sufficient for most
operational visibility.

### 4b. `GET /admin/metrics` *(Rev 6)*

Prometheus-style text exposition for the same gauges, suitable for scraping
by an external Prometheus + Alertmanager. Same auth as the rest of `/admin/*`
(JWT bearer).

Available gauges (as of Rev 6):

```
ofa_pipeline_running                 0|1
ofa_last_compute_age_seconds{symbol="SPXW"}    seconds since last successful tick
ofa_db_pool_size                     pool_size config
ofa_db_pool_checked_out              connections in use
ofa_db_pool_overflow                 connections beyond pool_size
ofa_dlq_pending                      dead_letter_queue row count
ofa_opra_lag_ms                      ms since last options_chain row
ofa_futures_lag_ms                   ms since last futures_ticks row
ofa_active_api_keys                  count of active API keys
```

Recommended Prometheus alerts:

```yaml
- alert: PipelineStuck
  expr: ofa_last_compute_age_seconds > 180
  for: 2m
  annotations:
    summary: "Pipeline tick > 3min stale for {{ $labels.symbol }}"

- alert: DLQGrowing
  expr: increase(ofa_dlq_pending[5m]) > 100
  annotations:
    summary: "DLQ grew by {{ $value }} rows in 5min"

- alert: DBPoolSaturating
  expr: ofa_db_pool_checked_out / ofa_db_pool_size > 0.9
  for: 1m
  annotations:
    summary: "DB pool {{ $value | humanizePercentage }} utilised"
```

### 4c. Logs

Backend logs are JSON via structlog. Key event names:

* `pipeline_complete` (status, duration_ms, rows_read, missing) — every tick
* `pipeline_partial` / `pipeline_low_coverage` — investigate
* `live_ingestion_*` — connect, schema drop, telemetry, registry refresh
* `live_trade_unmatched_rollup` — registry needs refresh (auto-fires)
* `bulk_writer_flush_failed` — DB issue, batch landed in DLQ
* `stream_ws_error` / `stream_ws_revocation_watcher_error` — WS plumbing

Avoid grepping `key=` or `token=` — uvicorn access logs have those scrubbed
out by `_install_uvicorn_log_redaction` at startup, but third-party logs
might not.

---

## 5. Common operational tasks

### 5a. Add a Databento API key

1. Get the key from your Databento dashboard.
2. Admin → Databento Keys → "Add key".
3. Choose dataset (`OPRA.PILLAR` for options, `GLBX.MDP3` for CME futures, `BOTH` for keys with full entitlements).
4. Set `priority` lower than env keys to make it a fallback, higher to prefer it.
5. Click "Test" after creation — that runs `decrypt_secret` and confirms the at-rest crypto round-trip works.

The ingester picks up new rows on the **next reconnect attempt** without a
restart.

### 5b. Investigate "pipeline_no_data"

```
$ docker exec -it ofa-backend python -c "
from app.db.session import get_engine
import asyncio
async def main():
    engine = get_engine()
    async with engine.connect() as conn:
        result = await conn.exec_driver_sql(
            \"SELECT symbol, count(*), max(ts) FROM options_chain WHERE ts > NOW() - INTERVAL '1 hour' GROUP BY symbol\"
        )
        for row in result: print(row)
asyncio.run(main())
"
```

If counts are zero → ingestion is failing. Check `/admin/inspector` →
`live_ingester` block for the most-recent error. Common causes:

* All Databento keys exhausted (`error_count >= 5` on every row + cooldown active)
* Schema dropped (`schemas_dropped` non-empty) — key lacks entitlement for OPRA cmbp-1, etc.
* Network: the OPRA gateway is unreachable from your container's egress

### 5c. Force a session reset

Daily at 09:29 ET the scheduler runs `reset_session_state` which clears the
basis cache, flip-speed cache, and HIRO incremental state. To do it manually:

```bash
docker exec -it ofa-backend python -c "
import asyncio
from app.processing.pipeline import reset_session_state
asyncio.run(reset_session_state(['SPXW', 'NDXP']))
"
```

You should rarely need this; the cron job covers it.

### 5d. Revoke an API key

`DELETE /admin/api-keys/{id}` — immediate. Active WS streams from that key
close with code `4401` within 30s (the revocation watcher polls at that
cadence). New requests get `401`.

---

## 6. Backup & disaster recovery

The `db_data` Docker volume holds Postgres data. Take a logical backup:

```bash
docker exec -t ofa-db pg_dump -U options -d options_db -F c > options_db_$(date +%F).pgdump
```

Restore:

```bash
docker exec -i ofa-db pg_restore -U options -d options_db --clean --if-exists < options_db_2026-06-01.pgdump
```

What's safe to lose vs. precious:

| Table | Lose? | Notes |
|-------|-------|-------|
| `options_chain`, `options_trades`, `futures_ticks`, `liquidity_snapshots` | yes | Time-series, 7-day retention. Backfill from Databento on rebuild (`run_historical_backfill`). |
| `computed_metrics` | yes | Re-derived from chain on next pipeline tick. |
| `flow_events`, `pipeline_runs`, `session_events` | yes | Historical audit; re-derives forward. |
| `api_keys` | **no** | Plaintext keys are not stored anywhere. Lose this and you must re-issue every consumer key. |
| `databento_api_keys` | **no** | Plaintext keys are encrypted but the row itself is the only copy. Same caveat as `api_keys` — keep this backed up. |
| `alert_rules` | **no** | Operator-configured. |
| `dead_letter_queue` | yes | Diagnostic only. |
| `eod_open_interest` | yes | Re-fetchable via `run_eod_oi_ingestion`. |

---

## 7. Where to file a bug

If a pipeline run logs `pipeline_error` with a stack trace, capture:
1. The exact log line + traceback
2. `GET /admin/system/status` snapshot
3. `GET /admin/inspector/dlq?limit=20` if DLQ is involved
4. The relevant `pipeline_runs` row (`SELECT * FROM pipeline_runs WHERE symbol=... ORDER BY started_at DESC LIMIT 5`)

That's enough context for a developer to reproduce locally with
`APP_TESTING=1 pytest tests/test_pipeline_hardening.py`.
