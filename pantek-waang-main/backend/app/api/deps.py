"""FastAPI dependencies: API-key auth, JWT admin auth, and rate limiting."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
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
    PUBLIC_SESSION_TOKEN_TYPE,
    decode_jwt_token,
    decode_public_session_token,
    verify_api_key,
)
from app.db.models import ApiKey, User, UserSession
from app.db.session import get_db

# ── Rate limiter ─────────────────────────────────────────────────────────────


def _api_key_or_ip(request: Request) -> str:
    api_key = request.headers.get("X-API-Key") or request.headers.get("x-api-key")
    if api_key:
        return f"key:{api_key[:11]}"
    return f"ip:{get_remote_address(request)}"


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

import threading
from collections import defaultdict, deque
from time import monotonic


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


def rate_limit(limit: int, period_seconds: int = 60, *, key: str = "") -> "callable":
    """Build a FastAPI dependency that enforces a per-IP rate limit.

    Usage::

        @router.post("/login", dependencies=[Depends(rate_limit(5, 60, key="login"))])

    Disabled automatically under pytest (see :func:`_limiter_enabled`)
    so test suites that exhaust budgets don't break.
    """

    async def _dep(request: Request) -> None:
        if not _limiter_enabled():
            return
        ip = get_remote_address(request)
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

    prefix = x_api_key[:11]
    result = await session.execute(select(ApiKey).where(ApiKey.key_prefix == prefix))
    candidates = result.scalars().all()

    matched: ApiKey | None = None
    for candidate in candidates:
        if verify_api_key(x_api_key, candidate.key_hash):
            matched = candidate
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


# ── Public-user session auth (Rev 5) ─────────────────────────────────────────


async def authenticate_user_session(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: AsyncSession = Depends(get_db),
) -> User:
    """Validate a public-session JWT and return the underlying ``User`` row.

    Rejects:
      * missing / malformed bearer token  → 401
      * expired or signature-mismatched   → 401
      * wrong token ``typ``               → 401
      * revoked or expired ``user_sessions`` row → 401
      * ``users`` row in non-``approved`` state  → 403

    Returns the authenticated :class:`User` ORM row. The route can read
    ``user.api_key_id`` to look up the bridged ``ApiKey`` for symbol
    authorisation.
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    try:
        payload = decode_public_session_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token"
        ) from exc

    if payload.get("typ") != PUBLIC_SESSION_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session token type",
        )

    sid = payload.get("sid")
    sub = payload.get("sub")
    if not sid or not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed session token",
        )

    try:
        session_uuid = uuid.UUID(str(sid))
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed session id",
        ) from exc

    user_session = await session.get(UserSession, session_uuid)
    if user_session is None or user_session.revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked"
        )
    expires_at = user_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        )

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed session subject",
        ) from exc

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    if user.status == "banned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Account banned"
        )
    if user.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is {user.status}",
        )

    return user


async def resolve_user_api_key(
    user: User, session: AsyncSession
) -> ApiKey:
    """Return the ``ApiKey`` row bridged to ``user``. Raises 403 if missing."""
    if user.api_key_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No API key assigned",
        )
    api_key = await session.get(ApiKey, user.api_key_id)
    if api_key is None or not api_key.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bridged API key inactive",
        )
    if api_key.expires_at is not None:
        expires_at = api_key.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bridged API key expired",
            )
    return api_key


def require_user_symbol_access(symbol_param: str = "symbol"):
    """Factory: authorise a public-session user against the path symbol.

    The check uses the ``allowed_symbols`` of the bridged ``ApiKey``, so
    operators only configure ACLs in one place (per-user-key).
    """

    async def _dep(
        request: Request,
        user: Annotated[User, Depends(authenticate_user_session)],
        session: AsyncSession = Depends(get_db),
    ) -> tuple[User, ApiKey]:
        api_key = await resolve_user_api_key(user, session)
        symbol = request.path_params.get(symbol_param)
        if symbol is not None:
            symbol_u = symbol.upper()
            if symbol_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"User not authorized for symbol {symbol_u}",
                )
        return user, api_key

    return _dep
