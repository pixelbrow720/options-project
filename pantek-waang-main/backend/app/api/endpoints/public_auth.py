"""Rev 5 — public-site authentication endpoints.

Discord-OAuth-driven user onboarding for the public website. The flow:

  1. ``GET /public/auth/discord/start``
     → builds a Discord OAuth URL with a signed state token.
  2. The user authorises on Discord, Discord redirects them back to the
     public site's ``/auth/callback`` page with ``?code&state``.
  3. The public site forwards those query params to
     ``GET /public/auth/discord/callback``. The backend then:
       a. validates the state CSRF token,
       b. exchanges the OAuth code for an access token,
       c. fetches the user's Discord profile,
       d. checks they're a member of the configured Discord guild via the
          Bot API,
       e. upserts a ``users`` row, optionally records an
          ``access_requests`` row,
       f. either issues a session JWT (when status=approved) or returns
          a 403 with an explanation + invite URL + contact handles.

A second login path exists at ``POST /public/auth/login`` that accepts a
plaintext API key. This is the bridge for legacy admin-issued API keys
so they keep working even before the Discord OAuth gate is wired up.
The legacy bridge never *creates* a Discord-verified user — guild
verification is left as ``False`` so the admin can see they came in
through the bridge.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authenticate_user_session, rate_limit
from app.api.schemas import (
    AccessPendingResponse,
    DiscordStartResponse,
    PublicLoginRequest,
    PublicMeResponse,
    PublicSessionResponse,
    PublicUserSummary,
)
from app.config import get_settings
from app.core.discord_client import (
    DISCORD_OAUTH_SCOPES,
    DiscordError,
    build_oauth_url,
    exchange_code,
    fetch_user,
    is_member_of_guild,
)
from app.core.logging import get_logger
from app.core.security import (
    consume_discord_state_nonce,
    create_discord_state_token,
    create_public_session_token,
    decode_public_session_token,
    extract_discord_state_nonce,
    verify_api_key,
    verify_discord_state_token,
)
from app.db.models import AccessRequest, ApiKey, User, UserSession
from app.db.session import get_db

logger = get_logger(__name__)

router = APIRouter(prefix="/public", tags=["public-auth"])


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _summary_for(user: User, session: AsyncSession) -> PublicUserSummary:
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


async def _issue_session(
    user: User,
    session: AsyncSession,
    *,
    request: Request | None = None,
) -> PublicSessionResponse:
    """Create a ``user_sessions`` row and return a signed JWT for it."""
    settings = get_settings()
    expires_at = datetime.now(UTC) + timedelta(
        hours=settings.public_session_expire_hours
    )
    user_agent: str | None = None
    ip: str | None = None
    if request is not None:
        ua = request.headers.get("user-agent")
        if ua:
            user_agent = ua[:500]
        client = request.client
        if client and client.host:
            ip = client.host[:64]

    user_session = UserSession(
        user_id=user.id,
        expires_at=expires_at,
        revoked=False,
        user_agent=user_agent,
        ip=ip,
    )
    session.add(user_session)
    await session.flush()

    user.last_login_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(user_session)
    await session.refresh(user)

    token = create_public_session_token(
        user_id=user.id,
        session_id=str(user_session.id),
        expires_at=expires_at,
    )
    return PublicSessionResponse(
        token=token,
        expires_at=expires_at,
        user=await _summary_for(user, session),
    )


def _pending_response(
    user_summary: PublicUserSummary, *, detail: str
) -> AccessPendingResponse:
    settings = get_settings()
    return AccessPendingResponse(
        detail=detail,
        status=user_summary.status,
        discord_invite_url=settings.discord_invite_url,
        contact_handles=settings.discord_contact_handle_list,
        user=user_summary,
    )


def _redacted_summary(user_summary: PublicUserSummary) -> PublicUserSummary:
    """Strip PII from a summary returned in pending/rejected 403 responses.

    The user has not been approved (or has been rejected), so the
    public callback should not echo back the email, Discord id, or any
    bridged-key metadata that an attacker who phished a state token
    could harvest. ``discord_username`` is preserved because the user
    just typed it into the OAuth consent screen — confirming it back
    is harmless and improves the UX of the waiting page.
    """
    return user_summary.model_copy(
        update={
            "email": None,
            "discord_id": "redacted",
            "api_key_label": None,
            "api_key_prefix": None,
            "allowed_symbols": [],
            "has_api_key": False,
        }
    )


# ── Discord OAuth start ──────────────────────────────────────────────────────


@router.get(
    "/auth/discord/start",
    response_model=DiscordStartResponse,
    dependencies=[Depends(rate_limit(30, 60, key="public_auth"))],
)
async def discord_start() -> DiscordStartResponse:
    """Return the URL to redirect the browser to to begin the OAuth flow."""
    settings = get_settings()
    if not settings.discord_client_id or not settings.discord_redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Discord OAuth is not configured",
        )
    state = create_discord_state_token()
    url = build_oauth_url(
        client_id=settings.discord_client_id,
        redirect_uri=settings.discord_redirect_uri,
        state=state,
        scopes=DISCORD_OAUTH_SCOPES,
    )
    return DiscordStartResponse(url=url, state=state)


# ── Discord OAuth callback ───────────────────────────────────────────────────


@router.get(
    "/auth/discord/callback",
    dependencies=[Depends(rate_limit(30, 60, key="public_auth_callback"))],
)
async def discord_callback(
    code: str,
    state: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    """Exchange the Discord OAuth code, upsert the user, return a session JWT.

    Response shapes:
      * 200 + :class:`PublicSessionResponse` — user is approved + guild
        verified; session JWT issued.
      * 403 + :class:`AccessPendingResponse` — user not yet approved (or
        not in the guild). The body includes the invite URL and contact
        handles so the public site can render a friendly waiting page.
      * 400 — ``state`` did not validate.
      * 502 — Discord upstream rejected the request.
    """
    settings = get_settings()

    if not verify_discord_state_token(state):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired state token",
        )
    nonce = extract_discord_state_nonce(state)
    if nonce is None or not consume_discord_state_nonce(nonce):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="State nonce already used or unknown",
        )
    if not (settings.discord_client_id and settings.discord_client_secret):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Discord OAuth is not configured",
        )

    try:
        token_resp = await exchange_code(
            code,
            client_id=settings.discord_client_id,
            client_secret=settings.discord_client_secret,
            redirect_uri=settings.discord_redirect_uri,
        )
        discord_user = await fetch_user(token_resp.access_token)
    except DiscordError as exc:
        logger.warning(
            "discord.callback.upstream_error",
            status=exc.status_code,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Discord authentication failed",
        ) from exc

    # Guild membership probe is best-effort: we still create / load the
    # user row even if the bot can't see them, so admins have a record.
    # Tri-state: True = confirmed member, False = definitive non-member
    # (HTTP 404), None = unknown (transport/5xx). On unknown we keep the
    # previous ``guild_verified`` value rather than revoking on a blip.
    probe_result: bool | None = None
    if settings.discord_guild_id and settings.discord_bot_token:
        probe_result = await is_member_of_guild(
            user_id=discord_user.id,
            guild_id=settings.discord_guild_id,
            bot_token=settings.discord_bot_token,
        )

    # Upsert ``users`` row by ``discord_id``.
    existing = (
        await session.execute(select(User).where(User.discord_id == discord_user.id))
    ).scalar_one_or_none()

    if existing is None:
        guild_verified = bool(probe_result) if probe_result is not None else False
        user = User(
            discord_id=discord_user.id,
            discord_username=discord_user.username,
            discord_avatar=discord_user.avatar,
            email=discord_user.email,
            status="pending",
            guild_verified=guild_verified,
        )
        session.add(user)
        await session.flush()
        # Create the audit row only on first sighting — re-logins from
        # the same Discord user don't append.
        session.add(AccessRequest(user_id=user.id))
        await session.commit()
        await session.refresh(user)
    else:
        existing.discord_username = discord_user.username
        existing.discord_avatar = discord_user.avatar
        if discord_user.email:
            existing.email = discord_user.email
        existing_was_verified = bool(existing.guild_verified)
        if probe_result is True:
            existing.guild_verified = True
        elif probe_result is False:
            # Definitive 404. Only downgrade if the user wasn't
            # previously verified, so a transient probe glitch followed
            # by a real 404 still requires explicit admin action to
            # revoke. Keeping the existing True covers the case where
            # Discord is briefly returning the wrong status.
            if not existing_was_verified:
                existing.guild_verified = False
        else:
            # Unknown — keep whatever we already had.
            existing.guild_verified = existing_was_verified
        await session.commit()
        await session.refresh(existing)
        user = existing

    summary = await _summary_for(user, session)
    guild_verified = bool(user.guild_verified)

    if user.status == "banned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account banned",
        )

    if user.status == "rejected":
        return Response(
            content=_pending_response(
                _redacted_summary(summary),
                detail="Access was rejected by an administrator.",
            ).model_dump_json(),
            status_code=status.HTTP_403_FORBIDDEN,
            media_type="application/json",
        )

    if user.status == "approved" and guild_verified and user.api_key_id is not None:
        return await _issue_session(user, session, request=request)

    # Approved but missing the API key bridge — admins should fix this,
    # but treat it as pending for the user.
    detail = (
        "Pending approval — a moderator needs to approve your access."
        if user.status == "pending"
        else "Awaiting Discord guild verification — please join the server below."
        if not guild_verified
        else "Approved, but your API key has not been provisioned yet."
    )
    return Response(
        content=_pending_response(
            _redacted_summary(summary), detail=detail
        ).model_dump_json(),
        status_code=status.HTTP_403_FORBIDDEN,
        media_type="application/json",
    )


# ── Legacy API-key bridge ────────────────────────────────────────────────────


@router.post(
    "/auth/login",
    response_model=PublicSessionResponse,
    dependencies=[Depends(rate_limit(30, 60, key="public_auth"))],
)
async def login_with_api_key(
    payload: PublicLoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> PublicSessionResponse:
    """Trade an admin-issued API key for a public-session JWT.

    Used by users with a key issued before Discord OAuth was wired up.
    The bridged user row is marked ``guild_verified=False`` so admins
    can see who came in through this path.
    """
    api_key_value = payload.api_key.strip()
    prefix = api_key_value[:11]

    rows = (
        await session.execute(select(ApiKey).where(ApiKey.key_prefix == prefix))
    ).scalars().all()

    matched: ApiKey | None = None
    for candidate in rows:
        if verify_api_key(api_key_value, candidate.key_hash):
            matched = candidate
            break
    if matched is None or not matched.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    if matched.expires_at is not None:
        expires_at = matched.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="API key expired"
            )

    # Find or create the bridged ``users`` row.
    user = (
        await session.execute(select(User).where(User.api_key_id == matched.id))
    ).scalar_one_or_none()

    if user is None:
        # Synthesise a placeholder Discord-id so the unique constraint
        # holds. Format ``apikey:<key_id>`` makes the bridge obvious to
        # admins skimming the users table.
        synthetic_discord_id = f"apikey:{matched.id}"
        user = User(
            discord_id=synthetic_discord_id,
            discord_username=matched.label,
            discord_avatar=None,
            email=None,
            status="approved",
            guild_verified=False,
            api_key_id=matched.id,
            notes="Auto-bridged from legacy API key login.",
        )
        session.add(user)
        await session.flush()
        await session.commit()
        await session.refresh(user)

    if user.status != "approved":
        # An admin previously rejected / banned this bridge user — do
        # not silently re-approve them; they must talk to an admin.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Bridged account is {user.status}",
        )

    return await _issue_session(user, session, request=request)


# ── Session introspection / logout ───────────────────────────────────────────


@router.get("/me", response_model=PublicMeResponse)
async def get_me(
    response: Response,
    user: Annotated[User, Depends(authenticate_user_session)],
    session: AsyncSession = Depends(get_db),
) -> PublicMeResponse:
    summary = await _summary_for(user, session)
    response.headers["Cache-Control"] = "no-store"
    return PublicMeResponse(user=summary)


@router.post("/auth/logout", status_code=204, response_class=Response)
async def logout(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> Response:
    """Mark the bearer's ``user_sessions`` row as revoked.

    Idempotent — silently succeeds even when the token is already
    expired or has been revoked, so the public site doesn't have to
    inspect the response body.
    """
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return Response(status_code=204)
    token = auth.split(" ", 1)[1].strip()
    try:
        payload = decode_public_session_token(token)
    except Exception:  # noqa: BLE001
        return Response(status_code=204)

    sid = payload.get("sid")
    if not sid:
        return Response(status_code=204)
    try:
        session_uuid = uuid.UUID(str(sid))
    except (ValueError, TypeError):
        return Response(status_code=204)
    await session.execute(
        update(UserSession)
        .where(UserSession.id == session_uuid)
        .values(revoked=True)
    )
    await session.commit()
    return Response(status_code=204)


__all__ = ("router",)
