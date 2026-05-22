"""Rev 5 — public-user auth tests.

The integration-style tests use the shared ``app_client`` + ``db_session``
fixtures from ``conftest.py`` so they run against the same Postgres
testcontainer as the existing admin / API-key tests. They are skipped
automatically if no DB is available.

Pure-logic tests (state-token round-trip, signature mismatch, expiry)
have no DB dependency and always run.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.asyncio


# ── Pure-logic tests (no DB / no httpx) ──────────────────────────────────────


def test_state_token_roundtrip():
    from app.core.security import (
        create_discord_state_token,
        verify_discord_state_token,
    )

    token = create_discord_state_token()
    assert verify_discord_state_token(token) is True


def test_state_token_rejects_tampered_signature():
    from app.core.security import (
        create_discord_state_token,
        verify_discord_state_token,
    )

    token = create_discord_state_token()
    # Flip the last character of the signature segment.
    parts = token.split(".")
    parts[-1] = parts[-1][:-1] + ("A" if parts[-1][-1] != "A" else "B")
    tampered = ".".join(parts)
    assert verify_discord_state_token(tampered) is False


def test_state_token_rejects_expired_ttl():
    from app.core.security import (
        create_discord_state_token,
        verify_discord_state_token,
    )

    # Issue 5 minutes ago, then validate with a 60-second TTL.
    past = datetime.now(UTC) - timedelta(minutes=5)
    token = create_discord_state_token(now=past)
    assert verify_discord_state_token(token, ttl_seconds=60) is False
    # And succeeds with a generous TTL.
    assert verify_discord_state_token(token, ttl_seconds=10 * 60) is True


def test_state_token_rejects_garbage_inputs():
    from app.core.security import verify_discord_state_token

    assert verify_discord_state_token("") is False
    assert verify_discord_state_token("not-a-token") is False
    assert verify_discord_state_token("a.b") is False
    assert verify_discord_state_token("a.b.c") is False


def test_build_oauth_url_contains_required_params():
    from app.core.discord_client import build_oauth_url

    url = build_oauth_url(
        client_id="123",
        redirect_uri="http://x/cb",
        state="abc",
    )
    assert "client_id=123" in url
    assert "state=abc" in url
    assert "scope=identify" in url
    assert "response_type=code" in url


def test_public_session_token_roundtrip():
    from app.core.security import (
        create_public_session_token,
        decode_public_session_token,
    )

    expires = datetime.now(UTC) + timedelta(hours=1)
    token = create_public_session_token(
        user_id=42, session_id="11111111-1111-1111-1111-111111111111", expires_at=expires
    )
    decoded = decode_public_session_token(token)
    assert decoded["sub"] == "42"
    assert decoded["sid"] == "11111111-1111-1111-1111-111111111111"
    assert decoded["typ"] == "public_session"


def test_public_session_token_rejects_expired():
    import jwt

    from app.core.security import (
        create_public_session_token,
        decode_public_session_token,
    )

    # Token already expired by 5 seconds.
    expires = datetime.now(UTC) - timedelta(seconds=5)
    token = create_public_session_token(
        user_id=1, session_id="22222222-2222-2222-2222-222222222222", expires_at=expires
    )
    # PyJWT's default leeway is 0, so this raises immediately.
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_public_session_token(token)


# ── DB-backed integration tests ─────────────────────────────────────────────


async def _admin_login(app_client) -> str:
    resp = await app_client.post(
        "/admin/login", json={"username": "admin", "password": "test-password"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def _make_api_key(db_session, *, symbols=("SPXW", "NDXP"), is_active=True):
    from app.core.security import display_prefix, generate_api_key, hash_api_key
    from app.db.models import ApiKey

    plaintext = generate_api_key()
    record = ApiKey(
        key_hash=hash_api_key(plaintext),
        key_prefix=display_prefix(plaintext),
        label="legacy-key",
        allowed_symbols=list(symbols),
        is_active=is_active,
        usage_count=0,
    )
    db_session.add(record)
    await db_session.commit()
    await db_session.refresh(record)
    return plaintext, record


def _patch_discord_for_callback(monkeypatch, *, discord_id="discord_123", in_guild=True):
    """Stub out Discord OAuth so the callback test path exercises only us."""
    from app.api.endpoints import public_auth as pa
    from app.core.discord_client import DiscordTokenResponse, DiscordUser

    async def fake_exchange(code, **_):
        return DiscordTokenResponse(
            access_token="fake-access",
            token_type="Bearer",
            expires_in=3600,
            refresh_token=None,
            scope="identify email guilds",
        )

    async def fake_fetch_user(token, **_):
        return DiscordUser(
            id=discord_id,
            username=f"user_{discord_id}",
            avatar="abcd",
            email=f"{discord_id}@example.com",
        )

    async def fake_is_member(**_):
        return in_guild

    monkeypatch.setattr(pa, "exchange_code", fake_exchange)
    monkeypatch.setattr(pa, "fetch_user", fake_fetch_user)
    monkeypatch.setattr(pa, "is_member_of_guild", fake_is_member)


async def _start_oauth(app_client) -> str:
    """Hit /public/auth/discord/start and return the state token."""
    # Settings need a non-empty client id for the start endpoint.
    import os

    os.environ["DISCORD_CLIENT_ID"] = "test-client-id"
    os.environ["DISCORD_REDIRECT_URI"] = "http://localhost:3001/auth/callback"
    os.environ["DISCORD_CLIENT_SECRET"] = "test-secret"
    os.environ["DISCORD_GUILD_ID"] = "test-guild"
    os.environ["DISCORD_BOT_TOKEN"] = "test-bot"
    from app.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]

    resp = await app_client.get("/public/auth/discord/start")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["url"].startswith("https://discord.com/oauth2/authorize")
    return body["state"]


async def test_callback_creates_pending_user_and_audit_row(app_client, db_session, monkeypatch):
    from sqlalchemy import select

    from app.db.models import AccessRequest, User

    state = await _start_oauth(app_client)
    _patch_discord_for_callback(monkeypatch, discord_id="d_pending_1", in_guild=True)

    resp = await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state}
    )
    # Pending user — guild verified but admin hasn't approved yet.
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["discord_invite_url"].startswith("https://discord.gg/")
    assert isinstance(body["contact_handles"], list)

    user = (
        await db_session.execute(select(User).where(User.discord_id == "d_pending_1"))
    ).scalar_one()
    assert user.status == "pending"
    assert user.guild_verified is True

    audit = (
        await db_session.execute(
            select(AccessRequest).where(AccessRequest.user_id == user.id)
        )
    ).scalars().all()
    assert len(audit) == 1


async def test_callback_not_in_guild_returns_pending_with_invite(app_client, db_session, monkeypatch):
    state = await _start_oauth(app_client)
    _patch_discord_for_callback(monkeypatch, discord_id="d_no_guild", in_guild=False)

    resp = await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state}
    )
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["user"]["guild_verified"] is False
    assert "join" in body["detail"].lower() or body["discord_invite_url"]


async def test_callback_invalid_state_400(app_client, monkeypatch):
    _patch_discord_for_callback(monkeypatch)
    resp = await app_client.get(
        "/public/auth/discord/callback", params={"code": "x", "state": "tampered"}
    )
    assert resp.status_code == 400


async def test_callback_approved_user_returns_session_jwt(app_client, db_session, monkeypatch):
    from sqlalchemy import select

    from app.db.models import User

    state = await _start_oauth(app_client)
    _patch_discord_for_callback(monkeypatch, discord_id="d_approved_1", in_guild=True)

    # First call → creates pending user.
    resp = await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state}
    )
    assert resp.status_code == 403

    user = (
        await db_session.execute(select(User).where(User.discord_id == "d_approved_1"))
    ).scalar_one()

    # Admin approves them.
    token = await _admin_login(app_client)
    resp = await app_client.post(
        f"/admin/access-requests/{user.id}/approve",
        json={"allowed_symbols": ["SPXW"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    approve_body = resp.json()
    assert approve_body["plaintext_key"]
    assert approve_body["api_key"]["allowed_symbols"] == ["SPXW"]

    # Second callback for the same user → session JWT.
    state2 = await _start_oauth(app_client)
    resp = await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state2}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"]
    assert body["user"]["status"] == "approved"
    assert body["user"]["has_api_key"] is True


async def test_login_with_api_key_returns_session(app_client, db_session):
    plaintext, _ = await _make_api_key(db_session, symbols=["SPXW"])
    resp = await app_client.post(
        "/public/auth/login", json={"api_key": plaintext}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"]
    assert body["user"]["guild_verified"] is False  # bridged
    assert body["user"]["status"] == "approved"


async def test_login_with_invalid_api_key_returns_401(app_client):
    resp = await app_client.post(
        "/public/auth/login", json={"api_key": "ak_not_valid_xxxxxxxxx"}
    )
    assert resp.status_code == 401


async def test_me_requires_session_jwt(app_client):
    resp = await app_client.get("/public/me")
    assert resp.status_code == 401


async def test_me_returns_user_payload(app_client, db_session):
    plaintext, _ = await _make_api_key(db_session, symbols=["SPXW"])
    login = await app_client.post("/public/auth/login", json={"api_key": plaintext})
    token = login.json()["token"]

    resp = await app_client.get(
        "/public/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["status"] == "approved"
    assert body["user"]["has_api_key"] is True
    # Plaintext key must NEVER be on /me.
    assert "plaintext_key" not in body
    assert "api_key" not in body["user"] or "key_hash" not in str(body)


async def test_admin_approve_auto_creates_api_key(app_client, db_session, monkeypatch):
    from sqlalchemy import select

    from app.db.models import User

    state = await _start_oauth(app_client)
    _patch_discord_for_callback(monkeypatch, discord_id="d_auto_key", in_guild=True)

    await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state}
    )
    user = (
        await db_session.execute(select(User).where(User.discord_id == "d_auto_key"))
    ).scalar_one()

    token = await _admin_login(app_client)
    resp = await app_client.post(
        f"/admin/access-requests/{user.id}/approve",
        json={},  # no api_key_id, no symbols → defaults
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["plaintext_key"].startswith("ak_")
    assert sorted(body["api_key"]["allowed_symbols"]) == ["NDXP", "SPXW"]
    assert body["user"]["status"] == "approved"


async def test_admin_reject_records_reason(app_client, db_session, monkeypatch):
    from sqlalchemy import select

    from app.db.models import AccessRequest, User

    state = await _start_oauth(app_client)
    _patch_discord_for_callback(monkeypatch, discord_id="d_reject", in_guild=True)
    await app_client.get(
        "/public/auth/discord/callback", params={"code": "fake", "state": state}
    )
    user = (
        await db_session.execute(select(User).where(User.discord_id == "d_reject"))
    ).scalar_one()

    token = await _admin_login(app_client)
    resp = await app_client.post(
        f"/admin/access-requests/{user.id}/reject",
        json={"reason": "not a real human"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"

    audit = (
        await db_session.execute(
            select(AccessRequest).where(AccessRequest.user_id == user.id)
        )
    ).scalar_one()
    assert audit.rejection_reason == "not a real human"
    assert audit.rejected_by == "admin"


async def test_banned_user_cannot_use_session(app_client, db_session):
    # Login via legacy bridge (creates an approved user).
    plaintext, _ = await _make_api_key(db_session, symbols=["SPXW"])
    login = await app_client.post("/public/auth/login", json={"api_key": plaintext})
    token = login.json()["token"]
    user_id = login.json()["user"]["id"]

    # Admin bans them.
    admin_token = await _admin_login(app_client)
    resp = await app_client.post(
        f"/admin/users/{user_id}/ban",
        json={"reason": "spam"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "banned"

    # Old session JWT should now be rejected — both because the
    # ``user_sessions`` row is revoked and because the user status is banned.
    resp = await app_client.get(
        "/public/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code in (401, 403)


async def test_session_jwt_expired_returns_401(app_client, db_session):
    """Manually-issued expired token must be rejected."""
    import uuid as uuid_mod

    from app.core.security import create_public_session_token
    from app.db.models import User, UserSession

    user = User(
        discord_id="d_expired_login",
        discord_username="expired_user",
        status="approved",
        guild_verified=False,
    )
    db_session.add(user)
    await db_session.flush()

    expires = datetime.now(UTC) - timedelta(minutes=1)
    sess = UserSession(
        id=uuid_mod.uuid4(),
        user_id=user.id,
        expires_at=expires,
        revoked=False,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)

    token = create_public_session_token(
        user_id=user.id, session_id=str(sess.id), expires_at=expires
    )
    resp = await app_client.get(
        "/public/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 401


async def test_revoked_session_returns_401(app_client, db_session):
    plaintext, _ = await _make_api_key(db_session, symbols=["SPXW"])
    login = await app_client.post("/public/auth/login", json={"api_key": plaintext})
    token = login.json()["token"]

    # Logout marks the session as revoked.
    resp = await app_client.post(
        "/public/auth/logout", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 204

    resp = await app_client.get(
        "/public/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 401
