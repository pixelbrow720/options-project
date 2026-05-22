"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Databento ────────────────────────────────────────────────────────────
    # ``DATABENTO_API_KEY`` is the legacy single-key fallback used when the
    # dataset-specific keys below are not set. New deployments should set
    # ``DATABENTO_API_KEY_OPRA`` (OPRA Pillar — options) and
    # ``DATABENTO_API_KEY_GLOBEX`` (GLBX.MDP3 — CME futures) explicitly so each
    # ingester authenticates with the correct subscription.
    databento_api_key: str = Field(default="", alias="DATABENTO_API_KEY")
    databento_api_key_opra: str = Field(default="", alias="DATABENTO_API_KEY_OPRA")
    databento_api_key_globex: str = Field(default="", alias="DATABENTO_API_KEY_GLOBEX")

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://options:options@db:5432/options_db",
        alias="DATABASE_URL",
    )
    # Connection-pool sizing for the async SQLAlchemy engine. Defaults are
    # conservative for a single-pod prod deployment under moderate load
    # (~ a few req/s sustained, occasional bursts). Operators running a
    # larger fleet should raise these via env vars.
    db_pool_size: int = Field(default=20, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=10, alias="DB_MAX_OVERFLOW")
    db_pool_recycle_seconds: int = Field(default=3600, alias="DB_POOL_RECYCLE_SECONDS")
    db_pool_pre_ping: bool = Field(default=True, alias="DB_POOL_PRE_PING")

    # ── Admin auth ───────────────────────────────────────────────────────────
    admin_username: str = Field(default="admin", alias="ADMIN_USERNAME")
    admin_password: str = Field(default="changeme", alias="ADMIN_PASSWORD")
    jwt_secret: str = Field(default="dev-only-change-me", alias="JWT_SECRET")
    jwt_expire_minutes: int = Field(default=480, alias="JWT_EXPIRE_MINUTES")
    jwt_algorithm: str = "HS256"

    # ── Options config ───────────────────────────────────────────────────────
    supported_symbols_raw: str = Field(default="SPXW,NDXP", alias="SUPPORTED_SYMBOLS")
    risk_free_rate: float = Field(default=0.05, alias="RISK_FREE_RATE")
    data_retention_days: int = Field(default=7, alias="DATA_RETENTION_DAYS")
    compute_interval_seconds: int = Field(default=60, alias="COMPUTE_INTERVAL_SECONDS")
    historical_backfill_days: int = Field(default=7, alias="HISTORICAL_BACKFILL_DAYS")

    # ── Ingestion behavior ───────────────────────────────────────────────────
    disable_live_ingestion: bool = Field(default=False, alias="DISABLE_LIVE_INGESTION")
    disable_historical_backfill: bool = Field(default=False, alias="DISABLE_HISTORICAL_BACKFILL")

    # ── Regime / processing thresholds ───────────────────────────────────────
    # Score threshold (absolute value) below which the regime is reported as
    # "neutral". Increase to add hysteresis around the zero-crossing and
    # prevent flickering when GEX_NET_TOTAL is small and noisy.
    gex_regime_threshold: float = Field(default=0.2, alias="GEX_REGIME_THRESHOLD")

    # ── Flow event detection thresholds (Agent 3) ────────────────────────────
    flow_sweep_min_premium: float = Field(
        default=50_000.0, alias="FLOW_SWEEP_MIN_PREMIUM"
    )
    """Minimum dollar premium (size × price × 100) for a multi-leg cluster
    to be flagged as a SWEEP. Sweeps are aggressive multi-venue prints."""

    flow_block_min_size: int = Field(default=100, alias="FLOW_BLOCK_MIN_SIZE")
    """Minimum single-print size (contracts) to be flagged as a BLOCK."""

    flow_uoa_vol_oi_ratio: float = Field(
        default=2.0, alias="FLOW_UOA_VOL_OI_RATIO"
    )
    """volume/OI ratio threshold for UOA classification when OI is known."""

    # ── Ingestion / DB write tuning (Agent 4 / 6) ────────────────────────────
    upsert_batch_size: int = Field(default=1000, alias="UPSERT_BATCH_SIZE")
    """Batch size used by ``BulkUpsertWriter`` / ``OptionsChainWriter``."""

    ingestion_max_pending_rows: int = Field(
        default=10_000, alias="INGESTION_MAX_PENDING_ROWS"
    )
    """Hard cap on rows in any single writer's pending buffer. Past this we
    log a WARNING and flush synchronously to apply backpressure."""

    ingestion_dlq_max_size: int = Field(
        default=1000, alias="INGESTION_DLQ_MAX_SIZE"
    )
    """Maximum dead-letter queue entries retained per ingester."""

    ingestion_registry_refresh_seconds: int = Field(
        default=4 * 60 * 60, alias="INGESTION_REGISTRY_REFRESH_SECONDS"
    )
    """How often the OPRA live ingester re-bootstraps its instrument registry
    to pick up new intraday contracts. Default 4 hours during RTH."""

    futures_feed_lag_warn_ms: int = Field(
        default=5_000, alias="FUTURES_FEED_LAG_WARN_MS"
    )
    """Log a WARNING when the freshest futures tick is older than this."""

    # ── Streaming API (Agent 5) ──────────────────────────────────────────────
    max_ws_connections_per_key: int = Field(
        default=5, alias="MAX_WS_CONNECTIONS_PER_KEY"
    )
    """Cap on simultaneous WebSocket connections per API key."""

    # ── Rev 4: RTH / 0DTE / spot resolver ────────────────────────────────────
    rth_open_time: str = Field(default="09:30", alias="RTH_OPEN_TIME")
    """RTH session open in America/New_York. Format ``HH:MM``."""

    rth_close_time: str = Field(default="16:15", alias="RTH_CLOSE_TIME")
    """RTH session close in America/New_York. SPX/NDX cash options stop
    trading at 16:00 ET; we keep a 15-minute buffer so the last pipeline
    tick still emits."""

    spot_parity_deviation_warn_pct: float = Field(
        default=0.5, alias="SPOT_PARITY_DEVIATION_WARN_PCT"
    )
    """Log a WARNING when the futures-basis spot vs. parity spot differ by
    more than this percent. Helps detect feed problems."""

    spot_stale_cache_max_age_seconds: float = Field(
        default=300.0, alias="SPOT_STALE_CACHE_MAX_AGE_SECONDS"
    )
    """Reject a stale-cache spot fallback older than this. Default 5 min."""

    spot_basis_ema_alpha: float = Field(
        default=0.1, alias="SPOT_BASIS_EMA_ALPHA"
    )
    """Smoothing factor (0–1) for the cash-minus-futures basis EMA."""

    atm_band_pct_0dte: float = Field(default=0.005, alias="ATM_BAND_PCT_0DTE")
    """Half-width of the ATM band used by 0DTE charm-rate computation.
    0.005 ⇒ ±0.5% of spot (so a 10-pt window at SPX ≈ 5000)."""

    override_rth_gate: bool = Field(default=False, alias="OVERRIDE_RTH_GATE")
    """Dev/testing only — when true, the scheduler skips the RTH gate and
    runs the chain pipeline regardless of session state. Useful for
    smoke-testing the analytics off-hours when the chain is stale but
    still queryable. Never set in production."""

    # ── Misc ─────────────────────────────────────────────────────────────────
    rate_limit_per_minute: int = Field(default=120, alias="RATE_LIMIT_PER_MINUTE")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ── Rev 5: public site / Discord OAuth ────────────────────────────────
    discord_client_id: str = Field(default="", alias="DISCORD_CLIENT_ID")
    discord_client_secret: str = Field(default="", alias="DISCORD_CLIENT_SECRET")
    discord_bot_token: str = Field(default="", alias="DISCORD_BOT_TOKEN")
    discord_guild_id: str = Field(default="", alias="DISCORD_GUILD_ID")
    discord_redirect_uri: str = Field(
        default="http://localhost:3001/auth/callback",
        alias="DISCORD_REDIRECT_URI",
    )
    discord_invite_url: str = Field(
        default="https://discord.gg/dy78P5vP62", alias="DISCORD_INVITE_URL"
    )
    discord_contact_handles: str = Field(
        default="@nods911_,@arveloon,@iqbal4o4",
        alias="DISCORD_CONTACT_HANDLES",
    )
    public_session_jwt_secret: str = Field(
        default="", alias="PUBLIC_SESSION_JWT_SECRET"
    )
    """Optional dedicated secret for public-session JWTs. Falls back to
    ``JWT_SECRET`` when empty so a single deployment can run unchanged."""
    public_session_expire_hours: int = Field(
        default=24 * 7, alias="PUBLIC_SESSION_EXPIRE_HOURS"
    )
    public_cors_origins: str = Field(
        default="http://localhost:3001", alias="PUBLIC_CORS_ORIGINS"
    )
    """Comma-separated list of allowed origins for the public site."""

    admin_cors_origins: str = Field(
        default="http://localhost:3000", alias="ADMIN_CORS_ORIGINS"
    )
    """Comma-separated list of allowed origins for the admin dashboard.

    Combined with ``public_cors_origins`` to form the actual
    ``Access-Control-Allow-Origin`` allowlist. Set to a wildcard (``*``)
    only for local dev — production deployments should pin both lists
    to the exact origins that should be able to call the API.
    """

    enable_openapi_docs: bool = Field(
        default=True, alias="ENABLE_OPENAPI_DOCS"
    )
    """When False, FastAPI's ``/docs``, ``/redoc`` and ``/openapi.json``
    endpoints are disabled entirely. Recommended in production where
    the schema does not need to be publicly browsable."""

    @field_validator("supported_symbols_raw")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def supported_symbols(self) -> list[str]:
        return [s.strip().upper() for s in self.supported_symbols_raw.split(",") if s.strip()]

    @property
    def opra_api_key(self) -> str:
        """API key used to authenticate against OPRA.PILLAR (options).

        Falls back to the legacy ``DATABENTO_API_KEY`` so existing single-key
        deployments keep working.
        """
        return self.databento_api_key_opra or self.databento_api_key

    @property
    def globex_api_key(self) -> str:
        """API key used to authenticate against GLBX.MDP3 (CME futures).

        Falls back to the legacy ``DATABENTO_API_KEY``.
        """
        return self.databento_api_key_globex or self.databento_api_key

    @property
    def public_session_secret(self) -> str:
        """Secret used to sign public-session JWTs.

        Falls back to ``jwt_secret`` so existing single-secret deployments
        keep working. Operators who want a dedicated secret for the public
        site (so admin tokens and user tokens can be rotated independently)
        can set ``PUBLIC_SESSION_JWT_SECRET``.
        """
        return self.public_session_jwt_secret or self.jwt_secret

    @property
    def public_cors_origin_list(self) -> list[str]:
        return [
            o.strip()
            for o in (self.public_cors_origins or "").split(",")
            if o.strip()
        ]

    @property
    def admin_cors_origin_list(self) -> list[str]:
        return [
            o.strip()
            for o in (self.admin_cors_origins or "").split(",")
            if o.strip()
        ]

    @property
    def cors_origin_list(self) -> list[str]:
        """Combined CORS allowlist for public + admin origins.

        Deduplicated, preserves order. ``["*"]`` is honoured (any list
        containing ``*`` collapses to wildcard) so local dev keeps
        working with the bundled defaults — production deployments
        should not include ``*`` here.
        """
        merged: list[str] = []
        for origin in (*self.public_cors_origin_list, *self.admin_cors_origin_list):
            if origin == "*":
                return ["*"]
            if origin and origin not in merged:
                merged.append(origin)
        return merged

    @property
    def discord_contact_handle_list(self) -> list[str]:
        return [
            h.strip()
            for h in (self.discord_contact_handles or "").split(",")
            if h.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
