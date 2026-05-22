"""Admin endpoints (JWT-protected)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authenticate_admin, rate_limit
from app.api.schemas import (
    AccessApproveRequest,
    AccessApproveResponse,
    AccessRejectRequest,
    AccessRequestSummary,
    AdminLoginRequest,
    AdminLoginResponse,
    ApiKeyCreate,
    ApiKeyCreateResponse,
    ApiKeySummary,
    ApiKeyUpdate,
    DatabentoKeyCreate,
    DatabentoKeySummary,
    DatabentoKeyTestResult,
    DatabentoKeyUpdate,
    PipelineRunSummary,
    PublicUserSummary,
    SystemStatus,
    UserBanRequest,
)
from app.config import get_settings
from app.core.crypto import decrypt_secret, encrypt_secret, mask_prefix
from app.core.security import (
    create_jwt_token,
    display_prefix,
    generate_api_key,
    hash_api_key,
    verify_password,
)
from app.db.models import (
    AccessRequest,
    ApiKey,
    ComputedMetric,
    DatabentoApiKey,
    DeadLetterEntry,
    FlowEvent,
    FuturesTick,
    OptionsChain,
    PipelineRun,
    User,
    UserSession,
)
from app.db.session import get_db
from app.ingestion.databento_live import get_live_ingester
from app.ingestion.writer import get_writer
from app.processing.scheduler import get_pipeline_state

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Login ────────────────────────────────────────────────────────────────────

@router.post(
    "/login",
    response_model=AdminLoginResponse,
    dependencies=[Depends(rate_limit(5, 60, key="admin_login"))],
)
async def admin_login(payload: AdminLoginRequest) -> AdminLoginResponse:
    settings = get_settings()
    if payload.username != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    # The admin password is bootstrapped from env. We accept either:
    #   1) a plaintext value matching ADMIN_PASSWORD, or
    #   2) a bcrypt-hashed value matching the admin password (for prod).
    is_hash = settings.admin_password.startswith("$2")
    valid = (
        verify_password(payload.password, settings.admin_password)
        if is_hash
        else payload.password == settings.admin_password
    )
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    token = create_jwt_token(settings.admin_username)
    return AdminLoginResponse(
        access_token=token, expires_in_seconds=settings.jwt_expire_minutes * 60
    )


# ── API key CRUD ────────────────────────────────────────────────────────────


def _to_summary(row: ApiKey) -> ApiKeySummary:
    return ApiKeySummary(
        id=row.id,
        key_prefix=row.key_prefix,
        label=row.label,
        allowed_symbols=list(row.allowed_symbols or []),
        created_at=row.created_at,
        expires_at=row.expires_at,
        is_active=row.is_active,
        last_used_at=row.last_used_at,
        usage_count=row.usage_count or 0,
    )


@router.get("/api-keys", response_model=list[ApiKeySummary])
async def list_api_keys(
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> list[ApiKeySummary]:
    rows = (await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))).scalars().all()
    return [_to_summary(r) for r in rows]


@router.post("/api-keys", response_model=ApiKeyCreateResponse, status_code=201)
async def create_api_key(
    payload: ApiKeyCreate,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> ApiKeyCreateResponse:
    plaintext = generate_api_key()
    record = ApiKey(
        key_hash=hash_api_key(plaintext),
        key_prefix=display_prefix(plaintext),
        label=payload.label,
        allowed_symbols=payload.allowed_symbols,
        expires_at=payload.expires_at,
        is_active=True,
        usage_count=0,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return ApiKeyCreateResponse(key=_to_summary(record), plaintext_key=plaintext)


@router.patch("/api-keys/{key_id}", response_model=ApiKeySummary)
async def update_api_key(
    key_id: UUID,
    payload: ApiKeyUpdate,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> ApiKeySummary:
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="API key not found")
    if payload.label is not None:
        row.label = payload.label
    if payload.allowed_symbols is not None:
        row.allowed_symbols = payload.allowed_symbols
    if payload.expires_at is not None:
        row.expires_at = payload.expires_at
    if payload.is_active is not None:
        row.is_active = payload.is_active
    await session.commit()
    await session.refresh(row)
    return _to_summary(row)


@router.delete("/api-keys/{key_id}", status_code=204, response_class=Response)
async def delete_api_key(
    key_id: UUID,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> Response:
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="API key not found")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.get("/api-keys/{key_id}/usage")
async def api_key_usage(
    key_id: UUID,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> dict:
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="API key not found")
    return {
        "id": str(row.id),
        "label": row.label,
        "key_prefix": row.key_prefix,
        "usage_count": row.usage_count or 0,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "is_active": row.is_active,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


# ── System status ────────────────────────────────────────────────────────────


def _lag_ms(ts: datetime | None) -> float | None:
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return max(0.0, (datetime.now(UTC) - ts).total_seconds() * 1000.0)


@router.get("/system/status", response_model=SystemStatus)
async def system_status(
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> SystemStatus:
    settings = get_settings()
    state = get_pipeline_state()
    writer = get_writer()

    rows_per_symbol: dict[str, int] = {}
    metric_rows_per_symbol: dict[str, int] = {}
    for symbol in settings.supported_symbols:
        chain_count = (
            await session.execute(
                select(func.count())
                .select_from(OptionsChain)
                .where(OptionsChain.symbol == symbol)
            )
        ).scalar_one()
        metric_count = (
            await session.execute(
                select(func.count())
                .select_from(ComputedMetric)
                .where(ComputedMetric.symbol == symbol)
            )
        ).scalar_one()
        rows_per_symbol[symbol] = int(chain_count or 0)
        metric_rows_per_symbol[symbol] = int(metric_count or 0)

    active_keys = (
        await session.execute(
            select(func.count()).select_from(ApiKey).where(ApiKey.is_active.is_(True))
        )
    ).scalar_one()

    # ── Rev 3 operational telemetry ─────────────────────────────────────────
    futures_latest = (
        await session.execute(select(func.max(FuturesTick.ts)))
    ).scalar_one_or_none()
    opra_latest = (
        await session.execute(select(func.max(OptionsChain.ts)))
    ).scalar_one_or_none()
    dlq_pending = int(
        (
            await session.execute(
                select(func.count()).select_from(DeadLetterEntry)
            )
        ).scalar_one()
        or 0
    )
    cutoff_1h = datetime.now(UTC) - timedelta(hours=1)
    flow_events_last_hour = int(
        (
            await session.execute(
                select(func.count())
                .select_from(FlowEvent)
                .where(FlowEvent.ts > cutoff_1h)
            )
        ).scalar_one()
        or 0
    )

    # Last pipeline run per symbol.
    last_runs: list[PipelineRunSummary] = []
    for sym in settings.supported_symbols:
        row = (
            await session.execute(
                select(PipelineRun)
                .where(PipelineRun.symbol == sym)
                .order_by(desc(PipelineRun.started_at))
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None:
            continue
        last_runs.append(
            PipelineRunSummary(
                symbol=row.symbol,
                started_at=row.started_at,
                finished_at=row.finished_at,
                duration_ms=float(row.duration_ms or 0.0),
                status=row.status or "unknown",
                rows_read=int(row.rows_read or 0),
                metric_rows_written=int(row.metric_rows_written or 0),
                missing_metric_types=list(row.missing_metric_types or []),
                error=row.error,
            )
        )

    try:
        live_diag: dict[str, Any] = get_live_ingester().diagnostics()
    except Exception as exc:  # noqa: BLE001
        live_diag = {"error": str(exc)}

    return SystemStatus(
        pipeline_running=bool(state.last_run),
        last_databento_event=writer.last_event_ts,
        last_compute_per_symbol={
            sym: state.last_run.get(sym) for sym in settings.supported_symbols
        },
        last_compute_duration_ms={
            sym: float(state.last_duration_ms.get(sym, 0.0))
            for sym in settings.supported_symbols
        },
        rows_per_symbol=rows_per_symbol,
        metric_rows_per_symbol=metric_rows_per_symbol,
        active_api_keys=int(active_keys or 0),
        futures_lag_ms=_lag_ms(futures_latest),
        opra_lag_ms=_lag_ms(opra_latest),
        dlq_pending=dlq_pending,
        flow_events_last_hour=flow_events_last_hour,
        last_pipeline_runs=last_runs,
        live_ingester=live_diag,
    )


# ── Databento API key pool (Rev 4) ───────────────────────────────────────────


def _to_databento_summary(row: DatabentoApiKey) -> DatabentoKeySummary:
    return DatabentoKeySummary(
        id=row.id,
        label=row.label,
        dataset=row.dataset,
        api_key_prefix=row.api_key_prefix,
        priority=row.priority,
        is_active=row.is_active,
        last_used_at=row.last_used_at,
        last_error_at=row.last_error_at,
        last_error_msg=row.last_error_msg,
        error_count=row.error_count,
        created_at=row.created_at,
    )


@router.get("/databento-keys", response_model=list[DatabentoKeySummary])
async def list_databento_keys(
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> list[DatabentoKeySummary]:
    """Operator-visible Databento key pool, sorted by dataset + priority."""
    rows = (
        await session.execute(
            select(DatabentoApiKey).order_by(
                DatabentoApiKey.dataset, DatabentoApiKey.priority, DatabentoApiKey.id
            )
        )
    ).scalars().all()
    return [_to_databento_summary(r) for r in rows]


@router.post(
    "/databento-keys",
    response_model=DatabentoKeySummary,
    status_code=201,
)
async def create_databento_key(
    payload: DatabentoKeyCreate,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> DatabentoKeySummary:
    record = DatabentoApiKey(
        label=payload.label.strip(),
        dataset=payload.dataset,
        api_key_encrypted=encrypt_secret(payload.api_key),
        api_key_prefix=mask_prefix(payload.api_key, chars=8),
        priority=payload.priority,
        is_active=payload.is_active,
        error_count=0,
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return _to_databento_summary(record)


@router.patch("/databento-keys/{key_id}", response_model=DatabentoKeySummary)
async def update_databento_key(
    key_id: int,
    payload: DatabentoKeyUpdate,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> DatabentoKeySummary:
    row = await session.get(DatabentoApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Databento key not found")
    if payload.label is not None:
        row.label = payload.label.strip()
    if payload.priority is not None:
        row.priority = payload.priority
    if payload.is_active is not None:
        row.is_active = payload.is_active
        # Disabling does NOT clear error_count — re-enabling means
        # operator manually believes the key is healthy again.
    await session.commit()
    await session.refresh(row)
    return _to_databento_summary(row)


@router.delete(
    "/databento-keys/{key_id}", status_code=204, response_class=Response
)
async def delete_databento_key(
    key_id: int,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> Response:
    row = await session.get(DatabentoApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Databento key not found")
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)


@router.post(
    "/databento-keys/{key_id}/test", response_model=DatabentoKeyTestResult
)
async def test_databento_key(
    key_id: int,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> DatabentoKeyTestResult:
    """Light-weight sanity check that the encrypted key can be decrypted.

    A *real* network probe against Databento would require their CDN
    to confirm the key, which we don't want to do from a synchronous
    HTTP endpoint. The ingester records auth/connect errors against
    ``error_count`` so the operator can see them on the listing.
    """
    row = await session.get(DatabentoApiKey, key_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Databento key not found")
    try:
        plaintext = decrypt_secret(row.api_key_encrypted)
    except Exception as exc:  # noqa: BLE001
        return DatabentoKeyTestResult(
            ok=False,
            message=(
                f"Failed to decrypt stored key — JWT_SECRET may have changed: {exc}"
            ),
        )
    return DatabentoKeyTestResult(
        ok=True,
        message=(
            f"Stored key decrypts cleanly ({mask_prefix(plaintext, chars=6)}…). "
            "Live verification is performed by the ingester on the next connect."
        ),
    )


# ── Rev 5: public users + access-request workflow ───────────────────────────


async def _user_summary(user: User, session: AsyncSession) -> PublicUserSummary:
    api_key: ApiKey | None = None
    if user.api_key_id is not None:
        api_key = await session.get(ApiKey, user.api_key_id)
    return PublicUserSummary(
        id=user.id,
        discord_id=user.discord_id,
        discord_username=user.discord_username,
        discord_avatar=user.discord_avatar,
        email=user.email,
        status=user.status,
        guild_verified=bool(user.guild_verified),
        has_api_key=api_key is not None,
        api_key_label=api_key.label if api_key else None,
        api_key_prefix=api_key.key_prefix if api_key else None,
        allowed_symbols=list(api_key.allowed_symbols or []) if api_key else [],
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.get("/access-requests", response_model=list[AccessRequestSummary])
async def list_access_requests(
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
    pending_only: bool = True,
) -> list[AccessRequestSummary]:
    """List access requests, optionally filtering to pending users only."""
    q = select(AccessRequest).order_by(desc(AccessRequest.requested_at))
    rows = (await session.execute(q)).scalars().all()

    summaries: list[AccessRequestSummary] = []
    for req in rows:
        user = await session.get(User, req.user_id)
        if user is None:
            continue
        if pending_only and user.status != "pending":
            continue
        summaries.append(
            AccessRequestSummary(
                user=await _user_summary(user, session),
                requested_at=req.requested_at,
                approved_at=req.approved_at,
                approved_by=req.approved_by,
                rejected_at=req.rejected_at,
                rejected_by=req.rejected_by,
                rejection_reason=req.rejection_reason,
                api_key_id=req.api_key_id,
            )
        )
    return summaries


@router.post(
    "/access-requests/{user_id}/approve",
    response_model=AccessApproveResponse,
    dependencies=[Depends(rate_limit(60, 60, key="access_request_mutate"))],
)
async def approve_access_request(
    request: Request,
    user_id: int,
    payload: AccessApproveRequest,
    admin_user: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> AccessApproveResponse:
    """Approve a pending user.

    If ``api_key_id`` is supplied, that existing key is bridged to the
    user. Otherwise a fresh key is generated, labelled
    ``Public-{discord_username}``, with the requested or default
    ``allowed_symbols``. The plaintext key is returned exactly once.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status == "banned":
        raise HTTPException(
            status_code=409, detail="Cannot approve a banned user"
        )

    plaintext_returned: str | None = None
    api_key: ApiKey | None = None

    if payload.api_key_id is not None:
        api_key = await session.get(ApiKey, payload.api_key_id)
        if api_key is None:
            raise HTTPException(
                status_code=404, detail="Provided api_key_id not found"
            )
    else:
        symbols = payload.allowed_symbols or ["SPXW", "NDXP"]
        plaintext = generate_api_key()
        api_key = ApiKey(
            key_hash=hash_api_key(plaintext),
            key_prefix=display_prefix(plaintext),
            label=f"Public-{user.discord_username}",
            allowed_symbols=symbols,
            is_active=True,
            usage_count=0,
        )
        session.add(api_key)
        await session.flush()
        plaintext_returned = plaintext

    user.api_key_id = api_key.id
    user.status = "approved"

    # Update the most recent ``access_requests`` row for this user.
    latest_req = (
        await session.execute(
            select(AccessRequest)
            .where(AccessRequest.user_id == user_id)
            .order_by(desc(AccessRequest.requested_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest_req is not None:
        latest_req.approved_at = datetime.now(UTC)
        latest_req.approved_by = admin_user
        latest_req.api_key_id = api_key.id
        latest_req.rejected_at = None
        latest_req.rejected_by = None
        latest_req.rejection_reason = None

    await session.commit()
    await session.refresh(user)
    await session.refresh(api_key)

    summary = ApiKeySummary(
        id=api_key.id,
        key_prefix=api_key.key_prefix,
        label=api_key.label,
        allowed_symbols=list(api_key.allowed_symbols or []),
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
        is_active=api_key.is_active,
        last_used_at=api_key.last_used_at,
        usage_count=api_key.usage_count or 0,
    )
    return AccessApproveResponse(
        user=await _user_summary(user, session),
        api_key=summary,
        plaintext_key=plaintext_returned,
    )


@router.post(
    "/access-requests/{user_id}/reject",
    response_model=PublicUserSummary,
    dependencies=[Depends(rate_limit(60, 60, key="access_request_mutate"))],
)
async def reject_access_request(
    request: Request,
    user_id: int,
    payload: AccessRejectRequest,
    admin_user: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> PublicUserSummary:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = "rejected"

    latest_req = (
        await session.execute(
            select(AccessRequest)
            .where(AccessRequest.user_id == user_id)
            .order_by(desc(AccessRequest.requested_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest_req is not None:
        latest_req.rejected_at = datetime.now(UTC)
        latest_req.rejected_by = admin_user
        latest_req.rejection_reason = payload.reason

    # Revoke any active sessions so the rejection takes effect immediately.
    await session.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked.is_(False))
        .values(revoked=True)
    )

    await session.commit()
    await session.refresh(user)
    return await _user_summary(user, session)


@router.post("/users/{user_id}/ban", response_model=PublicUserSummary)
async def ban_user(
    user_id: int,
    payload: UserBanRequest,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> PublicUserSummary:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    user.status = "banned"
    user.notes = (
        f"{(user.notes or '').rstrip()}\nBanned: {payload.reason}".strip()
    )
    # Also disable the bridged API key so machine clients can't keep
    # using it after the ban.
    if user.api_key_id is not None:
        api_key = await session.get(ApiKey, user.api_key_id)
        if api_key is not None:
            api_key.is_active = False

    await session.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked.is_(False))
        .values(revoked=True)
    )
    await session.commit()
    await session.refresh(user)
    return await _user_summary(user, session)


@router.post("/users/{user_id}/revoke-sessions", status_code=204, response_class=Response)
async def revoke_user_sessions(
    user_id: int,
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
) -> Response:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await session.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked.is_(False))
        .values(revoked=True)
    )
    await session.commit()
    return Response(status_code=204)


@router.get("/users", response_model=list[PublicUserSummary])
async def list_users(
    _admin: Annotated[str, Depends(authenticate_admin)],
    session: AsyncSession = Depends(get_db),
    status_filter: str | None = None,
) -> list[PublicUserSummary]:
    q = select(User).order_by(desc(User.created_at))
    if status_filter:
        q = q.where(User.status == status_filter)
    rows = (await session.execute(q)).scalars().all()
    return [await _user_summary(r, session) for r in rows]
