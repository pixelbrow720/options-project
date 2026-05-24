"""FastAPI dependencies: API-key auth, JWT admin auth, and rate limiting."""

from __future__ import annotations

import os
import threading
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import monotonic
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import (
    api_key_lookup_digest,
    decode_jwt_token,
    verify_api_key,
)
from app.db.models import ApiKey
from app.db.session import get_db

# ── Rate limiter ─────────────────────────────────────────────────────────────


def _real_client_ip(request: Request) -> str:
    """Resolve the real client IP, optionally trusting reverse-proxy headers.

    When ``settings.trust_proxy_headers`` is False (default), this falls
    back to slowapi's ``get_remote_address`` which inspects only the
    socket peer. When True, the first comma-separated entry in
    ``X-Forwarded-For`` is preferred — that's the originating client
    when a trusted edge (Cloudflare / ingress) prepends to the header.
    Only enable when the front proxy strips client-supplied values,
    otherwise a remote client can spoof their IP.
    """
    settings = get_settings()
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",", 1)[0].strip()
            if first:
                return first
    return get_remote_address(request)


def _api_key_or_ip(request: Request) -> str:
    api_key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
    if api_key:
        return f"key:{api_key[:11]}"
    return f"ip:{_real_client_ip(request)}"


def _limiter_enabled() -> bool:
    """Disable rate limiting under pytest so tightly-budgeted decorators
    (e.g. ``5/minute`` on ``/admin/login``) don't fail the test suite — the
    ``app_client`` fixture is session-scoped, so all login calls across all
    tests share the same in-memory limiter window. Production behaviour is
    unchanged."""
    if os.getenv("PYTEST_CURRENT_TEST") is not None:
        return False
    if os.getenv("APP_TESTING") == "1":
        return False
    return True


limiter = Limiter(key_func=_api_key_or_ip, enabled=_limiter_enabled())


# ── Lightweight in-process rate limiter for body-Pydantic routes ────────────
#
# slowapi's ``@limiter.limit(...)`` decorator wraps the route in a function
# whose ``__globals__`` belong to the slowapi module. Combined with
# ``from __future__ import annotations``, FastAPI's forward-ref resolver
# cannot find Pydantic body classes (e.g. ``AdminLoginRequest``) declared
# in the route's own module, so the app fails to start. The existing
# ``@limiter.limit`` decorators on ``/v1/*`` GET routes work because they
# only use primitive (``str``) body params with no forward refs.
#
# For new tight-budget endpoints (admin login, OAuth start, etc.) we use a
# tiny sliding-window limiter exposed as a FastAPI ``Depends`` factory.
# This sits in front of the route, so FastAPI's signature inspection only
# ever sees the route's own globals.


class _SlidingWindowLimiter:
    """O(N) per-key sliding window. N = limit (small). Thread-safe."""

    def __init__(self) -> None:
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, period_seconds: float) -> bool:
        now = monotonic()
        cutoff = now - period_seconds
        with self._lock:
            bucket = self._buckets[key]
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True


_simple_limiter = _SlidingWindowLimiter()


def rate_limit(
    limit: int, period_seconds: int = 60, *, key: str = ""
) -> Callable[..., Awaitable[None]]:
    """Build a FastAPI dependency that enforces a per-IP rate limit.

    Usage::

        @router.post("/login", dependencies=[Depends(rate_limit(5, 60, key="login"))])

    Disabled automatically under pytest (see :func:`_limiter_enabled`)
    so test suites that exhaust budgets don't break.
    """

    async def _dep(request: Request) -> None:
        if not _limiter_enabled():
            return
        ip = _real_client_ip(request)
        bucket_key = f"{key}:{ip}"
        if not _simple_limiter.allow(bucket_key, limit, period_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {limit} per {period_seconds}s",
            )

    return _dep


def get_limiter() -> Limiter:
    return limiter


# ── API key auth ─────────────────────────────────────────────────────────────


async def authenticate_api_key(
    request: Request,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    session: AsyncSession = Depends(get_db),
) -> ApiKey:
    """Validate the X-API-Key header and return the matching ApiKey row.

    Increments ``usage_count`` and updates ``last_used_at`` on success.
    """
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )

    # O(1) lookup via the keyed BLAKE2b digest column. Falls back to the
    # legacy prefix scan + bcrypt loop when the row was issued before
    # migration 0010 (``key_lookup IS NULL``). On a successful verify we
    # backfill the digest so subsequent requests skip the slow path.
    matched: ApiKey | None = None
    lookup_digest = api_key_lookup_digest(x_api_key)
    fast = await session.execute(
        select(ApiKey).where(ApiKey.key_lookup == lookup_digest)
    )
    candidate = fast.scalar_one_or_none()
    if candidate is not None and verify_api_key(x_api_key, candidate.key_hash):
        matched = candidate

    if matched is None:
        prefix = x_api_key[:11]
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.key_prefix == prefix,
                ApiKey.key_lookup.is_(None),
            )
        )
        for row in result.scalars().all():
            if verify_api_key(x_api_key, row.key_hash):
                matched = row
                # Lazy backfill so future requests take the fast path.
                row.key_lookup = lookup_digest
                break

    if matched is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key"
        )

    if not matched.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="API key is inactive"
        )

    now = datetime.now(UTC)
    if matched.expires_at is not None:
        # Compare in UTC; row is stored as timezone-aware in PG.
        expires_at = matched.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="API key expired"
            )

    # Update usage stats. We avoid a second roundtrip by updating in-session.
    matched.usage_count = (matched.usage_count or 0) + 1
    matched.last_used_at = now
    await session.commit()
    await session.refresh(matched)

    request.state.api_key = matched
    return matched


def require_symbol_access(symbol_param: str = "symbol"):
    """Factory: dependency that ensures the API key is allowed to access the path symbol."""

    async def _dep(
        request: Request,
        api_key: Annotated[ApiKey, Depends(authenticate_api_key)],
    ) -> ApiKey:
        symbol = request.path_params.get(symbol_param)
        if symbol is None:
            return api_key
        symbol_u = symbol.upper()
        if symbol_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key not authorized for symbol {symbol_u}",
            )
        return api_key

    return _dep


# ── Admin (JWT) auth ─────────────────────────────────────────────────────────

bearer_scheme = HTTPBearer(auto_error=False)


async def authenticate_admin(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> str:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token"
        )
    try:
        payload = decode_jwt_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        ) from exc

    sub = payload.get("sub")
    settings = get_settings()
    if sub != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not an admin user"
        )
    return sub
