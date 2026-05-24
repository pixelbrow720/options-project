# WebSocket frame contract

## Endpoints

- `wss://<host>/v1/{symbol}/stream` — pipeline-snapshot frames + heartbeat
- `wss://<host>/v1/{symbol}/stream/ticks` — raw spot/futures tick frames

## Auth

Pass API key as `X-API-Key` header on the upgrade request, or `?key=<token>`
query string. Server rejects with close code `4401` on auth failure.

Mid-stream revocation: server polls `api_keys` table every 30s; if the key
is revoked, the socket closes with `4401`.

## Snapshot frame

Sent on every pipeline tick (default 60s) and once on connect (primed from
the in-memory snapshot cache, ≤10s stale).

```json
{
  "type": "snapshot",
  "envelope": {
    "symbol": "SPXW",
    "computed_at": "2026-05-22T20:00:00Z",
    "next_update_in_seconds": 60,
    "data": { "...": "see SnapshotData in types/snapshot.ts" }
  }
}
```

## Tick frame

Sent only on `/stream/ticks` per spot/futures change.

```json
{
  "type": "tick",
  "symbol": "SPXW",
  "ts": "2026-05-22T19:59:42.124Z",
  "spot": 5234.18,
  "futures": 5236.85
}
```

## Heartbeat

Sent every 25s to keep the connection alive.

```json
{ "type": "heartbeat", "ts": "2026-05-22T20:00:25Z" }
```

If the client doesn't receive a heartbeat within 60s, treat the connection
as stale and reconnect.

## Error frame

Sent before close in degraded scenarios.

```json
{ "type": "error", "code": 503, "message": "pipeline degraded" }
```

## Reconnection

- Exponential backoff: 1s → 2s → 4s → 8s → max 30s
- On reconnect, hit `GET /v1/{symbol}/snapshot` first to prime UI, then
  reopen the WS. The first WS snapshot frame will arrive within ~10s.
- Reset backoff on successful reconnect after a stable 30s window.

## Connection limits

- Max 5 WS connections per API key (per `MAX_WS_CONNECTIONS_PER_KEY`)
- 6th connection rejected with close code `1008`

## Symbols

Currently `SPXW` and `NDXP`. Other symbols return close code `1003` (unsupported).
