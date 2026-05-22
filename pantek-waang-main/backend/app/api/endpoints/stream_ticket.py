"""Short-lived stream tickets — eliminate token-in-URL on WS/SSE.

Browser WebSocket and EventSource clients cannot set custom headers, so
the legacy streaming endpoints accept ``?key=`` / ``?token=`` query
params. Those values land in proxy access logs, browser history, and
referer headers, where they linger far longer than any session.

This module hands out a single-use, 60s ticket bound to a (kind,
principal_id, symbol) tuple. The WS/SSE handlers consume the ticket on
connect — by the time it appears in any log it is already invalid, and
no API key or session JWT ever rides in the URL.
"""

from __future__ import annotations

import secrets
import threading
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authenticate_api_key, authenticate_user_session
from app.db.models import ApiKey, User
from app.db.session import get_db

router = APIRouter()


_TICKET_TTL_SECONDS = 60
_MAX_TICKETS = 10000


class _TicketStore:
    """In-process ticket cache. Single-process by design — multi-worker
    deployments need a shared backend (Redis) before this can scale out.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # ticket_id -> (kind, principal_id, symbol, expiry_epoch)
        self._tickets: dict[str, tuple[str, str, str, float]] = {}

    def issue(self, *, kind: str, principal_id: str, symbol: str) -> str:
        ticket = secrets.token_urlsafe(32)
        expiry = time.time() + _TICKET_TTL_SECONDS
        with self._lock:
            now = time.time()
            expired = [t for t, (_, _, _, e) in self._tickets.items() if e < now]
            for t in expired:
                self._tickets.pop(t, None)
            if len(self._tickets) >= _MAX_TICKETS:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Too many active stream tickets",
                )
            self._tickets[ticket] = (kind, principal_id, symbol, expiry)
        return ticket

    def consume(self, ticket: str, *, kind: str, symbol: str) -> str | None:
        """Pop and return ``principal_id`` if the ticket validates, else ``None``.

        Tickets are single-use: a successful match removes the entry, so
        a leaked URL cannot be replayed. Mismatches still pop the entry
        if present so an attacker spamming malformed kinds cannot grow
        the store.
        """
        if not ticket:
            return None
        with self._lock:
            entry = self._tickets.pop(ticket, None)
        if entry is None:
            return None
        t_kind, principal_id, t_symbol, expiry = entry
        if t_kind != kind:
            return None
        if t_symbol.upper() != symbol.upper():
            return None
        if expiry < time.time():
            return None
        return principal_id


_store = _TicketStore()


def get_ticket_store() -> _TicketStore:
    return _store


@router.post("/v1/{symbol}/stream-ticket")
async def issue_v1_ticket(
    symbol: str,
    api_key: Annotated[ApiKey, Depends(authenticate_api_key)],
) -> dict:
    sym_u = symbol.upper()
    if sym_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API key not authorized for {sym_u}",
        )
    ticket = _store.issue(kind="api_key", principal_id=str(api_key.id), symbol=sym_u)
    return {"ticket": ticket, "ttl_seconds": _TICKET_TTL_SECONDS}


@router.post("/public/{symbol}/stream-ticket")
async def issue_public_ticket(
    symbol: str,
    user: Annotated[User, Depends(authenticate_user_session)],
    session: AsyncSession = Depends(get_db),
) -> dict:
    from app.api.deps import resolve_user_api_key

    api_key = await resolve_user_api_key(user, session)
    sym_u = symbol.upper()
    if sym_u not in [s.upper() for s in (api_key.allowed_symbols or [])]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User not authorized for {sym_u}",
        )
    ticket = _store.issue(
        kind="public_session", principal_id=str(user.id), symbol=sym_u
    )
    return {"ticket": ticket, "ttl_seconds": _TICKET_TTL_SECONDS}
