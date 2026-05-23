"""Databento Live ingestion with reconnect / exponential backoff.

Subscribes to OPRA Pillar definition + cmbp-1 + trades + statistics for each
configured parent symbol. Maintains an in-memory contract registry keyed by
Databento's ``instrument_id`` so we can map live updates back to (symbol,
expiry, strike, type) when writing rows to TimescaleDB.

Notes on schema choice:
    OPRA.PILLAR's quote schema is ``cmbp-1`` (consolidated MBP-1) — the
    plain ``mbp-1`` name in some older docs / examples is **not** valid
    against this dataset and gets dropped at connect time. Records in
    ``cmbp-1`` carry ``levels[0].bid_px`` / ``levels[0].ask_px`` rather
    than the legacy ``bid_px_00`` / ``ask_px_00`` flat fields.

Failure modes handled:
  - Missing API key  -> log + return without crashing
  - ``databento`` package not installed  -> log + return
  - Stream disconnect -> exponential backoff up to ``MAX_RECONNECTS``
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import get_settings
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.ingestion.bulk_writers import (
    BulkUpsertWriter,
    get_options_trade_writer,
)
from app.ingestion.key_pool import (
    KeyCandidate,
    iter_keys,
    record_key_error,
    record_key_success,
)
from app.ingestion.writer import OptionsChainWriter, get_writer

logger = get_logger(__name__)

# Allowlist of attribute names captured into ``sample_record_attrs`` for
# diagnostics. ErrorMsg and SystemMsg frames may carry auth tokens / URLs
# in other attrs; capturing ``dir(record)`` would leak those.
_DIAGNOSTICS_ATTR_ALLOWLIST: frozenset[str] = frozenset({
    "bid_px",
    "ask_px",
    "bid_sz",
    "ask_sz",
    "instrument_id",
    "raw_symbol",
    "ts_event",
    "ts_recv",
    "stat_type",
    "quantity",
    "value",
    "price",
    "size",
    "aggressor_side",
    "publisher_id",
    "expiration",
    "expiration_date",
    "strike_price",
    "instrument_class",
    "option_type",
    "msg",
    "err",
})

# Maximum age of a cached NBBO quote (seconds) before we treat it as stale
# in the inline quote-rule classifier. Beyond this we skip side / signed
# premium rather than tagging a trade with a stale book.
_QUOTE_MAX_AGE_S = 5.0

# Auth-style error fragments that imply a schema-drop event but did not
# match one of the explicit ``"<schema> not authorized"`` substrings.
_AUTH_ERROR_FRAGMENTS: tuple[str, ...] = (
    "unauthorized",
    "forbidden",
    "not authorized",
    "not supported",
)


def pd_to_date(value: Any):
    """Convert a Databento expiration value (date, datetime, ns int) to ``date``."""
    from datetime import date

    import pandas as pd

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return pd.Timestamp(value).date()
    except Exception:  # noqa: BLE001
        try:
            return datetime.fromtimestamp(int(value) / 1e9, tz=UTC).date()
        except (TypeError, ValueError):
            return None

DATASET = "OPRA.PILLAR"
PARENT_SUFFIX = ".OPT"
MAX_RECONNECTS = 5
INITIAL_BACKOFF_S = 2.0
DEFAULT_SCHEMAS = ("definition", "trades", "statistics", "cmbp-1")


def _parent(symbol: str) -> str:
    return f"{symbol.upper()}{PARENT_SUFFIX}"


def _scale_price(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    # Databento commonly uses int64 fixed-point with 1e9 scaling.
    if abs(f) > 1e6:
        f /= 1e9
    return f


def _coerce_str(value: Any) -> str | None:
    """Coerce gateway-supplied identifiers (often int) to a Text-friendly str.

    asyncpg refuses to insert an int into a ``Text`` column, which would
    silently fail an entire ``options_trades`` batch.
    """
    if value is None:
        return None
    return str(value)


class DatabentoLiveIngester:
    """Live OPRA Pillar ingester with an in-memory contract registry."""

    def __init__(
        self,
        writer: OptionsChainWriter | None = None,
        *,
        trade_writer: BulkUpsertWriter | None = None,
    ) -> None:
        self._settings = get_settings()
        self._writer = writer or get_writer()
        self._trade_writer = trade_writer or get_options_trade_writer()
        # instrument_id -> {symbol, expiration, strike, option_type}
        self._registry: dict[int, dict[str, Any]] = {}
        # instrument_id -> latest oi / volume / underlying_price etc.
        self._state: dict[int, dict[str, Any]] = {}
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._registry_refresh_task: asyncio.Task | None = None
        self._last_registry_refresh_at: datetime | None = None
        # Schemas mutated at runtime as the gateway tells us which are unsupported.
        self._schemas: list[str] = list(DEFAULT_SCHEMAS)
        # Telemetry: count records by type since the last log dump.
        self._record_counts: dict[str, int] = {}
        self._last_telemetry_at = 0.0
        self._telemetry_interval_s = 30.0
        # Persistent diagnostics (never cleared) so the admin Data Inspector
        # can surface them long after the periodic log dump.
        self._cumulative_record_counts: dict[str, int] = {}
        self._dropped_schemas: list[str] = []
        self._sample_record_attrs: dict[str, dict[str, Any]] = {}
        self._first_record_at: datetime | None = None
        self._last_record_at: datetime | None = None
        self._connection_attempts: int = 0
        self._last_error: str | None = None
        # Captured gateway frames (SystemMsg / ErrorMsg). Most recent first.
        self._system_messages: list[str] = []
        self._error_messages: list[str] = []
        # Terminal-failure flag — set after MAX_RECONNECTS or no schemas left.
        # Manual recovery via ``reset_after_terminal()``.
        self._dead: bool = False
        # Counters surfaced via diagnostics for operator visibility.
        self._dropped_no_ts_count: int = 0
        self._unmatched_total: int = 0
        self._unmatched_count: int = 0
        self._last_unmatched_bootstrap_at: datetime | None = None
        # Most recent KeyCandidate label that successfully connected — surfaced
        # in diagnostics so operators can tell which key the live stream is on.
        self._active_key_label: str | None = None

    # ── Diagnostics surface (read by /admin/inspector) ──────────────────────
    def diagnostics(self) -> dict[str, Any]:
        return {
            "registry_size": len(self._registry),
            "last_registry_refresh_at": (
                self._last_registry_refresh_at.isoformat()
                if self._last_registry_refresh_at
                else None
            ),
            "schemas_active": list(self._schemas),
            "schemas_dropped": list(self._dropped_schemas),
            "record_counts": dict(self._cumulative_record_counts),
            "sample_record_attrs": dict(self._sample_record_attrs),
            "first_record_at": (
                self._first_record_at.isoformat() if self._first_record_at else None
            ),
            "last_record_at": (
                self._last_record_at.isoformat() if self._last_record_at else None
            ),
            "connection_attempts": self._connection_attempts,
            "last_error": self._last_error,
            "system_messages": list(self._system_messages),
            "error_messages": list(self._error_messages),
            "supported_symbols": self._settings.supported_symbols,
            "writer_pending": self._writer.pending,
            "writer_shed_rows": self._writer.shed_rows,
            "terminated": self._dead,
            "attempts_remaining_until_terminal_reset": (
                0 if self._dead
                else max(0, MAX_RECONNECTS - self._connection_attempts)
            ),
            "dropped_no_ts_count": self._dropped_no_ts_count,
            "unmatched_total": self._unmatched_total,
            "active_key_label": self._active_key_label,
        }

    def reset_after_terminal(self) -> None:
        """Clear the terminal-failure flag so :meth:`start` can be called again.

        Operators trigger this via the admin UI after registering / fixing
        a Databento key. Auto-resume is intentionally out of scope: the
        operator should restart the stream explicitly.
        """
        self._dead = False
        self._connection_attempts = 0
        self._last_error = None

    # ── Public API ──────────────────────────────────────────────────────────
    def start(self) -> None:
        if self._task is not None:
            return
        if self._dead:
            logger.error(
                "live_ingestion_start_blocked_terminal_state",
                hint="call reset_after_terminal() before retrying",
            )
            return
        self._task = asyncio.create_task(self._run_with_reconnect(), name="databento_live")
        self._registry_refresh_task = asyncio.create_task(
            self._registry_refresh_loop(), name="databento_live_registry_refresh"
        )

    async def stop(self) -> None:
        """Signal the ingester to stop and wait for graceful shutdown.

        Cancels the main stream task and the registry refresh task, then
        flushes any pending buffered rows so we don't lose in-flight data.
        """
        if self._task is None:
            return
        self._stop.set()
        tasks = [t for t in (self._task, self._registry_refresh_task) if t is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        self._registry_refresh_task = None
        # Final flush so buffered rows are not lost on shutdown.
        try:
            await self._writer.flush()
            await self._trade_writer.flush()
        except Exception:  # noqa: BLE001
            logger.exception("live_ingester_shutdown_flush_failed")

    async def _registry_refresh_loop(self) -> None:
        """Periodically re-bootstrap the contract registry.

        On long-running deployments new strikes appear during the session
        (especially weekly expiries near the open). A periodic refresh
        guards against the registry going stale.
        """
        interval_s = max(60, self._settings.ingestion_registry_refresh_seconds)
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval_s)
                return  # _stop fired, exit cleanly
            except TimeoutError:
                pass
            if self._stop.is_set():
                return
            try:
                logger.info("live_registry_refresh_start")
                await self._bootstrap_registry()
                self._last_registry_refresh_at = datetime.now(UTC)
                logger.info(
                    "live_registry_refresh_done",
                    contracts=len(self._registry),
                )
            except Exception:  # noqa: BLE001
                logger.exception("live_registry_refresh_failed")

    # ── Internals ───────────────────────────────────────────────────────────
    async def _run_with_reconnect(self) -> None:
        if self._settings.disable_live_ingestion:
            logger.info("live_ingestion_disabled")
            return

        try:
            import databento as db  # noqa: F401
        except ImportError:
            logger.warning("databento_import_failed_for_live")
            return

        backoff = INITIAL_BACKOFF_S
        attempt = 0
        while attempt < MAX_RECONNECTS:
            if self._stop.is_set():
                return
            attempt += 1
            self._connection_attempts = attempt

            # Resolve the key candidate list at the *start* of every attempt
            # so newly-registered DB keys / rotated env vars are picked up
            # without a service restart.
            candidates = await self._resolve_candidates()
            if not candidates:
                logger.warning("live_ingestion_skipped_no_api_key")
                # No keys at all → nothing useful to retry; bail out instead
                # of busy-looping the reconnect loop.
                self._dead = True
                logger.error(
                    "live_ingestion_terminated_no_keys",
                    hint="manual intervention required: register a Databento key",
                )
                return

            connected = False
            for candidate in candidates:
                if self._stop.is_set():
                    return
                try:
                    logger.info(
                        "live_ingestion_connecting",
                        attempt=attempt,
                        schemas=self._schemas,
                        key_label=candidate.label,
                        key_source=candidate.source,
                    )
                    # Bootstrap the registry on every candidate switch so the
                    # in-memory map matches the key we're about to stream
                    # against (different subscription tiers expose different
                    # contracts).
                    await self._bootstrap_registry(candidate.api_key)
                    self._active_key_label = candidate.label
                    await self._stream_once(candidate)
                    # Stream returned cleanly (close/stop); reset backoff.
                    backoff = INITIAL_BACKOFF_S
                    connected = True
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    msg = str(exc)
                    self._last_error = msg[:500]
                    dropped = self._drop_unsupported_schema(msg)
                    if dropped:
                        self._dropped_schemas.append(dropped)
                        logger.warning(
                            "live_dropping_unsupported_schema",
                            dropped=dropped,
                            remaining=self._schemas,
                        )
                        if not self._schemas:
                            self._dead = True
                            logger.error(
                                "live_ingestion_no_schemas_left",
                                hint=(
                                    "register a key with appropriate "
                                    "Databento entitlements"
                                ),
                            )
                            return
                        # Don't burn an attempt for a config-time fix; retry
                        # the SAME candidate with the trimmed schema list.
                        attempt -= 1
                        connected = True  # treat as resolved for backoff
                        break
                    logger.exception(
                        "live_ingestion_stream_failed",
                        error=msg,
                        key_label=candidate.label,
                    )
                    await self._record_candidate_error(candidate, msg)
                    # Try the next candidate before consuming a reconnect
                    # attempt — failover is the whole point of the pool.
                    continue

            if connected:
                continue

            if attempt >= MAX_RECONNECTS:
                self._dead = True
                logger.error(
                    "live_ingestion_giving_up",
                    attempts=attempt,
                    hint="manual intervention required",
                )
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)

    async def _resolve_candidates(self) -> list[KeyCandidate]:
        """Resolve the prioritised candidate list (env first, then DB pool)."""
        try:
            factory = get_session_factory()
            async with factory() as session:
                return await iter_keys(session, DATASET)
        except Exception:  # noqa: BLE001 — degrade to env-only on DB failure
            logger.exception("live_ingestion_key_pool_resolve_failed")
            env_key = self._settings.opra_api_key
            if env_key:
                return [
                    KeyCandidate(
                        label=f"env:{DATASET}",
                        api_key=env_key,
                        source="env",
                    )
                ]
            return []

    async def _record_candidate_error(
        self, candidate: KeyCandidate, error_msg: str
    ) -> None:
        if candidate.source != "db":
            return
        try:
            factory = get_session_factory()
            async with factory() as session:
                await record_key_error(session, candidate, error_msg=error_msg)
        except Exception:  # noqa: BLE001
            logger.exception(
                "live_ingestion_record_key_error_failed",
                key_label=candidate.label,
            )

    async def _record_candidate_success(self, candidate: KeyCandidate) -> None:
        if candidate.source != "db":
            return
        try:
            factory = get_session_factory()
            async with factory() as session:
                await record_key_success(session, candidate)
        except Exception:  # noqa: BLE001
            logger.exception(
                "live_ingestion_record_key_success_failed",
                key_label=candidate.label,
            )

    async def _bootstrap_registry(self, api_key: str | None = None) -> None:
        """Populate ``self._registry`` from the Historical definition schema.

        We pull the latest available trading day's definitions for each
        configured parent symbol and load them into the registry so live
        trade / statistics records can be mapped back to a contract.

        ``api_key`` is the resolved candidate's key — falls back to the
        env-configured one when called from a context that doesn't have a
        candidate yet (e.g. the periodic refresh loop).
        """
        try:
            import databento as db
        except ImportError:
            return

        key = api_key or self._settings.opra_api_key
        if not key:
            return

        client = db.Historical(key=key)
        # Use a 30-min buffer below "now" to stay safely inside the published
        # data window (mirrors ``databento_historical.py``).
        end = datetime.now(UTC) - timedelta(minutes=30)
        start = end - timedelta(days=2)
        loaded = 0
        for underlying in self._settings.supported_symbols:
            parent = f"{underlying.upper()}{PARENT_SUFFIX}"
            try:
                data = await asyncio.to_thread(
                    client.timeseries.get_range,
                    dataset=DATASET,
                    schema="definition",
                    symbols=[parent],
                    stype_in="parent",
                    start=start,
                    end=end,
                )
                df = await asyncio.to_thread(data.to_df)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "live_registry_bootstrap_failed",
                    symbol=underlying,
                    error=str(exc),
                )
                continue
            if df is None or df.empty:
                continue
            for _, row in df.iterrows():
                instrument_id = row.get("instrument_id")
                strike = _scale_price(row.get("strike_price"))
                expiry = row.get("expiration") or row.get("expiration_date")
                opt = row.get("instrument_class") or row.get("option_type")
                if instrument_id is None or strike is None or expiry is None or opt is None:
                    continue
                try:
                    instrument_id = int(instrument_id)
                except (TypeError, ValueError):
                    continue
                opt_u = str(opt).upper()
                if opt_u in ("C", "CALL"):
                    opt_char = "C"
                elif opt_u in ("P", "PUT"):
                    opt_char = "P"
                else:
                    continue
                try:
                    expiry_d = pd_to_date(expiry)
                except Exception:  # noqa: BLE001
                    continue
                if expiry_d is None:
                    continue
                self._registry[instrument_id] = {
                    "symbol": underlying.upper(),
                    "expiration": expiry_d,
                    "strike": strike,
                    "option_type": opt_char,
                }
                loaded += 1
        logger.info("live_registry_bootstrapped", contracts=loaded)

    def _drop_unsupported_schema(self, error_message: str) -> str | None:
        """If the error names a schema, drop it from the active list and return its name."""
        msg = error_message.lower()
        for schema in list(self._schemas):
            s = schema.lower()
            if (
                f"{s} schema not supported" in msg
                or f"not authorized for {s}" in msg
                or f"not authorized for {s} schema" in msg
                or f"unauthorized for {s}" in msg
            ):
                self._schemas.remove(schema)
                return schema
        # Fallback: the gateway changed its error format. Don't drop a
        # schema speculatively (we'd burn entitlements for non-schema errors)
        # but log loudly so operators can update the matcher.
        if any(fragment in msg for fragment in _AUTH_ERROR_FRAGMENTS):
            logger.warning(
                "schema_drop_unrecognized_error_format",
                schemas_active=list(self._schemas),
                error=error_message[:300],
            )
        return None

    async def _stream_once(self, candidate: KeyCandidate) -> None:
        import databento as db

        client = db.Live(key=candidate.api_key)
        for symbol in self._settings.supported_symbols:
            parent = _parent(symbol)
            for schema in self._schemas:
                client.subscribe(
                    dataset=DATASET,
                    schema=schema,
                    symbols=[parent],
                    stype_in="parent",
                )

        first_record_seen = False
        async for record in client:
            if self._stop.is_set():
                break
            if not first_record_seen:
                first_record_seen = True
                # Reset error counters / mark last_used_at on the row that
                # connected. We only do this once per stream so a brief
                # success on a flaky key doesn't repeatedly thrash the row.
                await self._record_candidate_success(candidate)
            try:
                await self._handle_record(record)
            except Exception:  # noqa: BLE001
                logger.exception("record_processing_error")

    # ── Record handlers ─────────────────────────────────────────────────────
    async def _handle_record(self, record: Any) -> None:
        rtype = type(record).__name__
        self._record_counts[rtype] = self._record_counts.get(rtype, 0) + 1
        self._cumulative_record_counts[rtype] = (
            self._cumulative_record_counts.get(rtype, 0) + 1
        )
        if self._first_record_at is None:
            self._first_record_at = datetime.now(UTC)
        self._last_record_at = datetime.now(UTC)
        # Capture a snapshot of the first record of each type — invaluable for
        # diagnosing why fields like bid/ask aren't being parsed (e.g. Databento
        # SDK normalised the field name differently than expected). We use an
        # explicit allowlist rather than ``dir(record)`` so ErrorMsg / SystemMsg
        # frames don't leak auth tokens, URLs, or headers via diagnostics.
        if rtype not in self._sample_record_attrs:
            attrs: dict[str, Any] = {}
            for name in _DIAGNOSTICS_ATTR_ALLOWLIST:
                if not hasattr(record, name):
                    continue
                try:
                    val = getattr(record, name)
                except Exception:  # noqa: BLE001
                    continue
                if callable(val):
                    continue
                # Stringify exotic types so the JSON encoder is happy.
                try:
                    if isinstance(val, str | int | float | bool | type(None)):
                        attrs[name] = val
                    elif isinstance(val, list | tuple):
                        attrs[name] = [str(x)[:200] for x in val[:3]]
                    else:
                        attrs[name] = str(val)[:200]
                except Exception:  # noqa: BLE001
                    attrs[name] = "<unserialisable>"
            self._sample_record_attrs[rtype] = attrs
        self._maybe_log_telemetry()

        if "Definition" in rtype:
            await self._handle_definition(record)
        elif "CMBP" in rtype or "Cmbp" in rtype or "Consolidated" in rtype:
            await self._handle_cmbp(record)
        elif "MBP" in rtype or "Mbp" in rtype:
            await self._handle_mbp(record)
        elif "Trade" in rtype:
            await self._handle_trade(record)
        elif "Stat" in rtype:
            await self._handle_statistics(record)
        elif "Error" in rtype:
            msg = (
                getattr(record, "err", None)
                or getattr(record, "msg", None)
                or str(record)
            )
            text = str(msg)[:300]
            self._last_error = text
            self._error_messages.append(text)
            self._error_messages = self._error_messages[-10:]
            logger.warning("live_gateway_error", msg=text)
        elif "System" in rtype:
            msg = getattr(record, "msg", None) or str(record)
            text = str(msg)[:300]
            self._system_messages.append(text)
            self._system_messages = self._system_messages[-10:]
            logger.info("live_gateway_system", msg=text)
        # Ignore other message types (symbol-mapping etc.).

    def _maybe_log_telemetry(self) -> None:
        loop = asyncio.get_event_loop()
        now = loop.time()
        if now - self._last_telemetry_at < self._telemetry_interval_s:
            return
        self._last_telemetry_at = now
        if not self._record_counts:
            return
        logger.info(
            "live_ingestion_telemetry",
            record_counts=dict(self._record_counts),
            registry_size=len(self._registry),
        )
        self._record_counts.clear()

    async def _maybe_refresh_registry_for_misses(self) -> None:
        """Re-bootstrap the registry when persistent unmatched trades pile up.

        A small cooldown stops a noisy stream from spamming definition-schema
        calls (each is a Historical request).
        """
        cooldown = timedelta(minutes=5)
        now = datetime.now(UTC)
        last = self._last_unmatched_bootstrap_at
        if last is not None and (now - last) < cooldown:
            return
        self._last_unmatched_bootstrap_at = now
        try:
            await self._bootstrap_registry()
        except Exception:  # noqa: BLE001
            logger.exception("live_unmatched_registry_refresh_failed")

    async def _handle_trade(self, record: Any) -> None:
        instrument_id = getattr(record, "instrument_id", None)
        contract = self._registry.get(instrument_id) if instrument_id else None
        if contract is None:
            self._unmatched_total += 1
            # Keep the legacy "first 5" log so a fresh deployment still surfaces
            # a sample in plain logs; everything after that goes to the periodic
            # rollup at the 100-multiple boundary.
            self._unmatched_count = self._unmatched_count + 1
            if self._unmatched_count <= 5:
                logger.info(
                    "live_trade_unmatched_instrument",
                    instrument_id=instrument_id,
                    raw_symbol=getattr(record, "raw_symbol", None),
                    registry_sample=list(self._registry.keys())[:3],
                )
            if self._unmatched_total % 100 == 0:
                logger.warning(
                    "live_trade_unmatched_rollup",
                    unmatched_total=self._unmatched_total,
                    registry_size=len(self._registry),
                )
            # Trigger an out-of-cycle registry refresh after a sustained miss
            # streak — bounded by a cooldown so a noisy stream can't spam
            # bootstrap calls.
            if self._unmatched_total % 50 == 0:
                await self._maybe_refresh_registry_for_misses()
            return

        price = _scale_price(getattr(record, "price", None))
        size = getattr(record, "size", None)

        state = self._state.setdefault(instrument_id, {})
        if price is not None:
            state["last_price"] = price
        if size is not None:
            try:
                state["volume"] = (state.get("volume") or 0) + int(size)
            except (TypeError, ValueError):
                pass

        await self._emit_row(instrument_id, record)
        await self._emit_trade(instrument_id, record, price=price, size=size)

    async def _emit_trade(
        self,
        instrument_id: int,
        record: Any,
        *,
        price: float | None,
        size: Any,
    ) -> None:
        """Persist the trade-tape row used by Lee-Ready / HIRO / flow events."""
        if price is None or size is None:
            return
        try:
            size_int = int(size)
        except (TypeError, ValueError):
            return
        ts = self._record_ts(record)
        if ts is None:
            self._dropped_no_ts_count += 1
            logger.warning(
                "live_trade_dropped_no_ts",
                instrument_id=instrument_id,
                dropped_total=self._dropped_no_ts_count,
            )
            return
        contract = self._registry[instrument_id]
        state = self._state.get(instrument_id, {})

        seq = getattr(record, "sequence", None) or getattr(record, "ts_event", 0)
        try:
            seq_int = int(seq)
        except (TypeError, ValueError):
            seq_int = 0

        # Quote-rule classifier inline (kept simple — full Lee-Ready with
        # tick fallback runs in the pipeline against the persisted rows).
        # Reject stale NBBO so the side / signed_premium columns never
        # carry quote-rule output computed against a multi-second-old book.
        bid = state.get("bid")
        ask = state.get("ask")
        quote_ts = state.get("quote_ts")
        quote_fresh = (
            quote_ts is not None
            and (ts - quote_ts).total_seconds() <= _QUOTE_MAX_AGE_S
            and (ts - quote_ts).total_seconds() >= 0
        )
        side: int | None = None
        if (
            quote_fresh
            and bid is not None
            and ask is not None
            and bid > 0
            and ask > 0
        ):
            mid = (bid + ask) / 2.0
            if price > mid:
                side = 1
            elif price < mid:
                side = -1
            else:
                side = 0

        signed_premium: float | None = None
        if side is not None and side != 0:
            # Dealer side is the opposite of customer.
            signed_premium = -side * size_int * price * 100.0

        await self._trade_writer.add({
            "ts": ts,
            "symbol": contract["symbol"],
            "expiration": contract["expiration"],
            "strike": contract["strike"],
            "option_type": contract["option_type"],
            "seq": seq_int,
            "price": price,
            "size": size_int,
            "bid": bid if quote_fresh else None,
            "ask": ask if quote_fresh else None,
            "exchange": _coerce_str(getattr(record, "publisher_id", None)),
            "side": side,
            "signed_premium": signed_premium,
        })

    async def _handle_definition(self, record: Any) -> None:
        instrument_id = getattr(record, "instrument_id", None)
        raw_symbol = getattr(record, "raw_symbol", None) or getattr(record, "symbol", None)
        expiration = getattr(record, "expiration", None) or getattr(record, "expiration_date", None)
        strike = _scale_price(getattr(record, "strike_price", None))
        instrument_class = getattr(record, "instrument_class", None) or getattr(
            record, "option_type", None
        )

        if instrument_id is None or expiration is None or strike is None or instrument_class is None:
            return

        underlying = self._underlying_for_raw_symbol(raw_symbol)
        if underlying is None:
            return

        opt = str(instrument_class).upper()
        if opt in ("C", "CALL"):
            opt_char = "C"
        elif opt in ("P", "PUT"):
            opt_char = "P"
        else:
            return

        try:
            from datetime import date

            if isinstance(expiration, datetime):
                expiry_date = expiration.date()
            elif isinstance(expiration, date):
                expiry_date = expiration
            else:
                expiry_date = datetime.fromtimestamp(int(expiration) / 1e9, tz=UTC).date()
        except Exception:  # noqa: BLE001
            return

        self._registry[instrument_id] = {
            "symbol": underlying,
            "expiration": expiry_date,
            "strike": strike,
            "option_type": opt_char,
        }

    def _underlying_for_raw_symbol(self, raw_symbol: str | None) -> str | None:
        if not raw_symbol:
            return None
        for sym in self._settings.supported_symbols:
            if raw_symbol.upper().startswith(sym.upper()):
                return sym.upper()
        return None

    async def _handle_mbp(self, record: Any) -> None:
        """Legacy ``mbp-1`` schema (flat ``bid_px_00`` / ``ask_px_00``).

        Kept for non-OPRA datasets that still use the older format. OPRA
        Pillar live records use ``cmbp-1`` and are dispatched to
        :meth:`_handle_cmbp` instead.
        """
        instrument_id = getattr(record, "instrument_id", None)
        contract = self._registry.get(instrument_id) if instrument_id else None
        if contract is None:
            return

        bid = _scale_price(getattr(record, "bid_px_00", None))
        ask = _scale_price(getattr(record, "ask_px_00", None))
        last_price = _scale_price(
            getattr(record, "last_price", None) or getattr(record, "price", None)
        )

        state = self._state.setdefault(instrument_id, {})
        if bid is not None:
            state["bid"] = bid
        if ask is not None:
            state["ask"] = ask
        if last_price is not None:
            state["last_price"] = last_price
        # Mirror the cmbp path: stamp the quote with the record's ts so the
        # trade path can drop stale NBBO before computing side / signed_premium.
        if bid is not None or ask is not None:
            ts = self._record_ts(record)
            state["quote_ts"] = ts if ts is not None else datetime.now(UTC)

        await self._emit_row(instrument_id, record)

    async def _handle_cmbp(self, record: Any) -> None:
        """Consolidated MBP-1 (OPRA Pillar quote schema).

        ``record.levels`` is a list of ``ConsolidatedBidAskPair`` entries with
        ``bid_px`` / ``ask_px`` / ``bid_sz`` / ``ask_sz`` fields. Top of book
        (level 0) is what we want for mid-price / spread metrics.
        """
        instrument_id = getattr(record, "instrument_id", None)
        contract = self._registry.get(instrument_id) if instrument_id else None
        if contract is None:
            return

        levels = getattr(record, "levels", None)
        bid: float | None = None
        ask: float | None = None
        if levels:
            try:
                top = levels[0]
            except (IndexError, TypeError):
                top = None
            if top is not None:
                bid = _scale_price(getattr(top, "bid_px", None))
                ask = _scale_price(getattr(top, "ask_px", None))

        # Fallback to legacy flat fields just in case the SDK normalises
        # differently in the future.
        if bid is None:
            bid = _scale_price(getattr(record, "bid_px_00", None))
        if ask is None:
            ask = _scale_price(getattr(record, "ask_px_00", None))

        state = self._state.setdefault(instrument_id, {})
        if bid is not None:
            state["bid"] = bid
        if ask is not None:
            state["ask"] = ask
        # Stamp the quote with whichever timestamp we can find — the trade
        # path uses this to discard stale NBBO. Falls back to wall clock if
        # the record carries no usable ts_event so a working book without
        # ts is still usable for the freshness window.
        if bid is not None or ask is not None:
            ts = self._record_ts(record)
            state["quote_ts"] = ts if ts is not None else datetime.now(UTC)

        await self._emit_row(instrument_id, record)

    async def _handle_statistics(self, record: Any) -> None:
        instrument_id = getattr(record, "instrument_id", None)
        contract = self._registry.get(instrument_id) if instrument_id else None
        if contract is None:
            return

        stat_type = getattr(record, "stat_type", None)
        # Don't fall through on a legitimate ``quantity == 0`` — only swap to
        # ``value`` when ``quantity`` was actually missing.
        q = getattr(record, "quantity", None)
        value = q if q is not None else getattr(record, "value", None)

        state = self._state.setdefault(instrument_id, {})
        # Databento stat_type values: 9 -> open interest, 10 -> cumulative volume (approximate).
        if stat_type in (9, "open_interest", "OPEN_INTEREST"):
            try:
                state["oi"] = int(value)
            except (TypeError, ValueError):
                pass
        elif stat_type in (10, "cumulative_volume", "CUMULATIVE_VOLUME", "VOLUME"):
            try:
                state["volume"] = int(value)
            except (TypeError, ValueError):
                pass

        await self._emit_row(instrument_id, record)

    async def _emit_row(self, instrument_id: int, record: Any) -> None:
        contract = self._registry[instrument_id]
        state = self._state.get(instrument_id, {})
        ts = self._record_ts(record)
        if ts is None:
            self._dropped_no_ts_count += 1
            logger.warning(
                "live_chain_row_dropped_no_ts",
                instrument_id=instrument_id,
                dropped_total=self._dropped_no_ts_count,
            )
            return
        row = {
            "ts": ts,
            "symbol": contract["symbol"],
            "expiration": contract["expiration"],
            "strike": contract["strike"],
            "option_type": contract["option_type"],
            "oi": state.get("oi"),
            "volume": state.get("volume"),
            "iv": state.get("iv"),
            "delta": state.get("delta"),
            "gamma": state.get("gamma"),
            "last_price": state.get("last_price"),
            "bid": state.get("bid"),
            "ask": state.get("ask"),
            "underlying_price": state.get("underlying_price"),
        }
        await self._writer.add(row)

    @staticmethod
    def _record_ts(record: Any) -> datetime | None:
        """Convert ``record.ts_event`` (ns int) into a UTC datetime.

        Returns ``None`` on parse failure so callers can skip + count the
        drop. Fabricating ``datetime.now(UTC)`` would create batch-wide PK
        collisions under load.
        """
        ts_event = getattr(record, "ts_event", None)
        if ts_event is None:
            return None
        try:
            # Databento ts_event is nanoseconds since epoch.
            return datetime.fromtimestamp(int(ts_event) / 1e9, tz=UTC)
        except (TypeError, ValueError, OverflowError):
            return None


_ingester: DatabentoLiveIngester | None = None


def get_live_ingester() -> DatabentoLiveIngester:
    global _ingester
    if _ingester is None:
        _ingester = DatabentoLiveIngester()
    return _ingester
