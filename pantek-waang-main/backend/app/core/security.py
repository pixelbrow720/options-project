"""Security primitives: API key generation/hashing and JWT helpers."""

from __future__ import annotations

import hmac
import secrets
import threading
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import UTC, datetime, timedelta
from hashlib import sha256

import bcrypt
import jwt

from app.config import get_settings

API_KEY_PREFIX = "ak_"
API_KEY_RANDOM_BYTES = 24  # 32-char base64-urlsafe-no-pad
API_KEY_DISPLAY_PREFIX_LEN = 11  # "ak_" + 8 chars

# Bcrypt cost factor used for newly issued API keys + admin password hashes.
# 12 rounds ≈ 250ms per hash on a modern x86 server — cheap enough for the
# occasional admin login / API-key rotation, expensive enough that a stolen
# hash dump is impractical to brute-force. bcrypt's library default has been
# 12 since 2017; we pin it explicitly so the cost is auditable here. Existing
# hashes keep their stored cost — bcrypt encodes the cost in the digest, so
# raising this only affects hashes generated *after* the change.
BCRYPT_ROUNDS = 12

# Defaults shipped in the source tree / used by the test suite. These are
# safe for local dev but must NEVER be left in place in production: see
# ``is_default_admin_password`` / ``is_default_jwt_secret``.
DEFAULT_ADMIN_PASSWORD_VALUES = frozenset({"", "changeme"})
DEFAULT_JWT_SECRET_VALUES = frozenset(
    {
        "",
        "dev-only-change-me",
        "test_secret_for_local_dev_only_at_least_32_chars_long",
        "test-secret",
    }
)


def generate_api_key() -> str:
    """Return a fresh plaintext API key. Display prefix = first 11 chars."""
    token = secrets.token_urlsafe(API_KEY_RANDOM_BYTES)
    return f"{API_KEY_PREFIX}{token}"


def display_prefix(api_key: str) -> str:
    return api_key[:API_KEY_DISPLAY_PREFIX_LEN]


def hash_api_key(api_key: str) -> str:
    """Hash an API key with bcrypt at the project-pinned cost factor."""
    return bcrypt.hashpw(
        api_key.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")


def verify_api_key(api_key: str, key_hash: str) -> bool:
    try:
        return bcrypt.checkpw(api_key.encode("utf-8"), key_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def is_default_admin_password(password: str | None) -> bool:
    """Return True when ``password`` matches a known dev/test default."""
    if password is None:
        return True
    return password in DEFAULT_ADMIN_PASSWORD_VALUES


def is_default_jwt_secret(secret: str | None) -> bool:
    """Return True when ``secret`` is a known dev/test default.

    Used by the startup banner to log a loud WARNING when the operator
    has not rotated the bundled secrets before exposing the server.
    """
    if secret is None:
        return True
    if secret in DEFAULT_JWT_SECRET_VALUES:
        return True
    if len(secret) < 32:
        return True
    return False


ADMIN_TOKEN_TYPE = "admin"


def create_jwt_token(subject: str, *, expires_minutes: int | None = None) -> str:
    settings = get_settings()
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=expires_minutes or settings.jwt_expire_minutes)
    payload = {
        "sub": subject,
        "typ": ADMIN_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_jwt_token(token: str) -> dict:
    settings = get_settings()
    payload = jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    # Verify ``typ`` only when present so legacy tokens issued before
    # this guard was added keep working until they expire. New tokens
    # always carry ``typ=admin`` so cross-use with public-session tokens
    # (which carry ``typ=public_session``) is rejected.
    typ = payload.get("typ")
    if typ is not None and typ != ADMIN_TOKEN_TYPE:
        raise jwt.InvalidTokenError("Wrong token type")
    return payload


# ── Rev 5: public-session JWTs + Discord OAuth state tokens ────────────────


PUBLIC_SESSION_TOKEN_TYPE = "public_session"


def create_public_session_token(
    *,
    user_id: int,
    session_id: str,
    expires_at: datetime,
) -> str:
    """Encode a JWT for a public (Discord-OAuth) user.

    ``sub`` is the user id (string). ``sid`` is the ``user_sessions.id``
    so the API can reject revoked sessions in O(1).
    """
    settings = get_settings()
    now = datetime.now(UTC)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    payload = {
        "sub": str(user_id),
        "sid": session_id,
        "typ": PUBLIC_SESSION_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(
        payload, settings.public_session_secret, algorithm=settings.jwt_algorithm
    )


def decode_public_session_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.public_session_secret,
        algorithms=[settings.jwt_algorithm],
    )


# ── Discord OAuth state CSRF token ──────────────────────────────────────────
#
# The state we hand to Discord is ``base64(timestamp).base64(nonce).hmac``.
# We sign it with the public-session secret. Validating the state
# guarantees:
#   1. The callback we're handling was kicked off by *this* deployment
#      (HMAC check).
#   2. It was started in the last ``ttl_seconds`` window (timestamp check).
# The nonce makes the state unique per /start call so an attacker
# replaying a captured state is foiled by the TTL.

_STATE_DELIMITER: bytes = b"."
_DEFAULT_STATE_TTL_SECONDS: int = 600  # 10 minutes


def _b64u_encode(value: bytes) -> bytes:
    return urlsafe_b64encode(value).rstrip(b"=")


def _b64u_decode(value: bytes) -> bytes:
    pad = b"=" * (-len(value) % 4)
    return urlsafe_b64decode(value + pad)


def _state_secret() -> bytes:
    return get_settings().public_session_secret.encode("utf-8")


def create_discord_state_token(*, now: datetime | None = None) -> str:
    """Return a fresh signed state token for the Discord OAuth flow.

    Also registers the embedded nonce in the server-side single-use
    store so the matching ``/callback`` request can verify the flow
    actually originated from a ``/start`` we issued.
    """
    moment = now or datetime.now(UTC)
    ts = str(int(moment.timestamp())).encode("ascii")
    nonce = secrets.token_bytes(16)
    nonce_b = _b64u_encode(nonce)
    payload = _b64u_encode(ts) + _STATE_DELIMITER + nonce_b
    sig = hmac.new(_state_secret(), payload, sha256).digest()
    register_discord_state_nonce(nonce_b.decode("ascii"))
    return (payload + _STATE_DELIMITER + _b64u_encode(sig)).decode("ascii")


def verify_discord_state_token(
    token: str,
    *,
    ttl_seconds: int = _DEFAULT_STATE_TTL_SECONDS,
    now: datetime | None = None,
) -> bool:
    """Validate a state token. Returns ``True`` iff signature + TTL OK."""
    if not token or not isinstance(token, str):
        return False
    try:
        ts_b, nonce_b, sig_b = token.encode("ascii").split(_STATE_DELIMITER)
    except ValueError:
        return False
    payload = ts_b + _STATE_DELIMITER + nonce_b
    try:
        expected = hmac.new(_state_secret(), payload, sha256).digest()
        actual = _b64u_decode(sig_b)
    except Exception:  # noqa: BLE001
        return False
    if not hmac.compare_digest(expected, actual):
        return False
    try:
        ts_value = int(_b64u_decode(ts_b))
    except (ValueError, Exception):  # noqa: BLE001
        return False
    moment = now or datetime.now(UTC)
    age = int(moment.timestamp()) - ts_value
    if age < 0 or age > ttl_seconds:
        return False
    return True


# Exposed so tests can override the TTL without touching internals.
DEFAULT_DISCORD_STATE_TTL_SECONDS = _DEFAULT_STATE_TTL_SECONDS


def _now_ts() -> int:  # pragma: no cover - trivial
    return int(time.time())


# ── Single-use state nonce store ──────────────────────────────────────────
#
# The signed state token above proves the callback was kicked off by
# *some* /start invocation against this deployment, but on its own does
# not bind the callback to the specific browser tab that initiated the
# flow. To raise the bar for state replay / CSRF, we additionally store
# each issued nonce server-side and pop it on the matching callback.
#
# This is an in-memory dict guarded by a threading.Lock — fine for a
# single-process deployment. For multi-process (gunicorn workers > 1)
# or horizontally scaled deployments this should move to Redis with a
# short TTL.

_NONCE_STORE: dict[str, float] = {}
_NONCE_LOCK = threading.Lock()


def _purge_expired_nonces(now: float) -> None:
    expired = [n for n, exp in _NONCE_STORE.items() if exp < now]
    for n in expired:
        _NONCE_STORE.pop(n, None)


def register_discord_state_nonce(
    nonce: str,
    *,
    ttl_seconds: int = _DEFAULT_STATE_TTL_SECONDS,
) -> None:
    """Record a nonce so the matching callback can consume it once."""
    if not nonce:
        return
    expiry = time.time() + float(ttl_seconds)
    with _NONCE_LOCK:
        _purge_expired_nonces(time.time())
        _NONCE_STORE[nonce] = expiry


def consume_discord_state_nonce(nonce: str) -> bool:
    """Atomically validate + remove a nonce. Returns True iff present and unexpired."""
    if not nonce:
        return False
    now = time.time()
    with _NONCE_LOCK:
        _purge_expired_nonces(now)
        expiry = _NONCE_STORE.pop(nonce, None)
    if expiry is None:
        return False
    return expiry >= now


def reset_discord_state_nonces() -> None:
    """Test helper: drop all in-memory nonces."""
    with _NONCE_LOCK:
        _NONCE_STORE.clear()


def extract_discord_state_nonce(token: str) -> str | None:
    """Return the base64 nonce segment from a state token, or None."""
    if not token or not isinstance(token, str):
        return None
    try:
        _ts_b, nonce_b, _sig_b = token.encode("ascii").split(_STATE_DELIMITER)
    except ValueError:
        return None
    return nonce_b.decode("ascii")
