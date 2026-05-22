"""Discord OAuth + Bot API helpers (Rev 5).

Pure async, ``httpx``-based wrappers around the small slice of the
Discord API the public-site authentication flow needs:

* :func:`exchange_code`     — OAuth2 ``authorization_code`` grant.
* :func:`fetch_user`        — ``GET /users/@me`` with the user access token.
* :func:`is_member_of_guild` — ``GET /guilds/{guild}/members/{user}`` via
  a Bot token, used to verify the OAuth-authenticated user actually
  belongs to the configured Discord guild.

Defensive by design: any ``httpx`` failure (timeout, network error,
non-200 response) returns ``False`` / raises a domain ``DiscordError``
rather than leaking ``httpx`` types into the FastAPI surface.

Secrets — ``access_token``, ``refresh_token``, the Bot token — are
never logged. Errors include only the response status and a short
context string.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


# Discord API base. The OAuth token endpoint and resource endpoints all
# live under this prefix. Kept as a module-level constant so tests can
# monkeypatch it to a local fake.
DISCORD_API_BASE: str = "https://discord.com/api"
DISCORD_OAUTH_AUTHORIZE: str = "https://discord.com/oauth2/authorize"

# OAuth scopes the public site needs:
#   * identify — user id, username, avatar
#   * email    — email field on the user object
#   * guilds   — listed for completeness; ``is_member_of_guild`` uses the
#     Bot token route which doesn't require this scope, but we keep it so
#     the consent screen advertises the guild check.
DISCORD_OAUTH_SCOPES: tuple[str, ...] = ("identify", "email", "guilds")

DEFAULT_TIMEOUT_SECONDS: float = 10.0


class DiscordError(RuntimeError):
    """Raised when the Discord API rejects a request we expected to succeed."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class DiscordTokenResponse:
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: str | None
    scope: str


@dataclass(frozen=True)
class DiscordUser:
    id: str
    username: str
    avatar: str | None
    email: str | None
    global_name: str | None = None
    discriminator: str | None = None


def build_oauth_url(
    *, client_id: str, redirect_uri: str, state: str, scopes: tuple[str, ...] = DISCORD_OAUTH_SCOPES
) -> str:
    """Return the URL the user should be redirected to to start OAuth.

    Pure helper — no I/O. Tested directly without mocking httpx.
    """
    from urllib.parse import urlencode

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": " ".join(scopes),
        "state": state,
        "prompt": "consent",
    }
    return f"{DISCORD_OAUTH_AUTHORIZE}?{urlencode(params)}"


async def exchange_code(
    code: str,
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> DiscordTokenResponse:
    """Exchange an authorization ``code`` for a user access token.

    Raises :class:`DiscordError` on any non-200 response. We deliberately
    never log the response body — it contains the access token.
    """
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.post(
                f"{DISCORD_API_BASE}/oauth2/token", data=data, headers=headers
            )
    except httpx.HTTPError as exc:
        logger.warning("discord.exchange_code.network_error", error=str(exc))
        raise DiscordError("Discord token exchange network error") from exc

    if resp.status_code != 200:
        logger.warning(
            "discord.exchange_code.failed",
            status=resp.status_code,
        )
        raise DiscordError(
            f"Discord token exchange failed (HTTP {resp.status_code})",
            status_code=resp.status_code,
        )

    body = resp.json()
    return DiscordTokenResponse(
        access_token=body["access_token"],
        token_type=body.get("token_type", "Bearer"),
        expires_in=int(body.get("expires_in", 0)),
        refresh_token=body.get("refresh_token"),
        scope=body.get("scope", ""),
    )


async def fetch_user(
    access_token: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS
) -> DiscordUser:
    """Return the Discord profile for the bearer of ``access_token``."""
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.get(
                f"{DISCORD_API_BASE}/users/@me", headers=headers
            )
    except httpx.HTTPError as exc:
        logger.warning("discord.fetch_user.network_error", error=str(exc))
        raise DiscordError("Discord /users/@me network error") from exc

    if resp.status_code != 200:
        logger.warning(
            "discord.fetch_user.failed",
            status=resp.status_code,
        )
        raise DiscordError(
            f"Discord /users/@me failed (HTTP {resp.status_code})",
            status_code=resp.status_code,
        )

    body = resp.json()
    return DiscordUser(
        id=str(body["id"]),
        username=body.get("username") or body.get("global_name") or "user",
        avatar=body.get("avatar"),
        email=body.get("email"),
        global_name=body.get("global_name"),
        discriminator=body.get("discriminator"),
    )


async def is_member_of_guild(
    user_id: str,
    guild_id: str,
    bot_token: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> bool | None:
    """Check whether ``user_id`` is a member of ``guild_id``.

    Tri-state return:
      * ``True``  — Discord confirmed membership (HTTP 200 + body).
      * ``False`` — Discord *definitively* says not-a-member (HTTP 404).
      * ``None``  — outcome unknown (transport error, 401/403/5xx,
        empty body). Callers should treat ``None`` as "do not change
        the cached guild_verified state" so transient blips don't
        revoke verification from already-verified users.

    Uses the Bot token route (``GET /guilds/{guild}/members/{user}``).
    The bot must be in the guild and have the GUILD_MEMBERS intent
    enabled in the developer portal — without it Discord will return
    403 even though the route looks fine.
    """
    if not (user_id and guild_id and bot_token):
        return None

    headers = {"Authorization": f"Bot {bot_token}"}
    url = f"{DISCORD_API_BASE}/guilds/{guild_id}/members/{user_id}"
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("discord.guild_membership.network_error", error=str(exc))
        return None

    if resp.status_code == 404:
        logger.info("discord.guild_membership.not_member", status=404)
        return False
    if resp.status_code != 200:
        logger.info(
            "discord.guild_membership.unknown",
            status=resp.status_code,
        )
        return None

    # A 200 with an empty body would be unusual — treat as unknown so
    # we don't revoke verification on a malformed Discord response.
    try:
        body = resp.json()
    except ValueError:
        return None
    if not body:
        return None
    return True
